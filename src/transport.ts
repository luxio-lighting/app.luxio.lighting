import { decodeResponse, encodeRequest, frame, FrameDecoder, type Request, type Response } from '../shared/protocol/src/index';

export const serviceUUID = 'e97b1000-3c27-4a20-9df4-7d025bc7e451';
export const connections = new Map<string, DeviceConnection>();

// Each connection owns its decoder and request queue. Never retry a mutation.
export class DeviceConnection {
  private decoder = new FrameDecoder();
  private pending?: { id: number; resolve: (response: Response) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  private queue: Promise<unknown> = Promise.resolve();
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private writer?: WritableStreamDefaultWriter<Uint8Array>;
  private rx?: BluetoothRemoteGATTCharacteristic;
  private tx?: BluetoothRemoteGATTCharacteristic;
  private reading?: Promise<void>;
  private closed = false;
  ondisconnect?: () => void;
  constructor(public kind: 'usb' | 'bluetooth', private device: SerialPort | BluetoothDevice) {}

  async open() {
    if (this.kind === 'usb') {
      const port = this.device as SerialPort;
      await port.open({ baudRate: 115200 });
      if (!port.readable || !port.writable) throw new Error('USB serial streams are unavailable.');
      this.reader = port.readable.getReader(); this.writer = port.writable.getWriter();
      this.reading = (async () => {
        try {
          while (!this.closed) {
            const { value, done } = await this.reader!.read();
            if (done) break;
            this.receive(value);
          }
        } catch (error) { this.fail(error); }
        finally { void this.close(); }
      })();
    } else {
      const device = this.device as BluetoothDevice;
      device.addEventListener('gattserverdisconnected', this.disconnected);
      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService(serviceUUID);
      this.rx = await service.getCharacteristic('e97b1001-3c27-4a20-9df4-7d025bc7e451');
      this.tx = await service.getCharacteristic('e97b1002-3c27-4a20-9df4-7d025bc7e451');
      this.tx.addEventListener('characteristicvaluechanged', this.notification);
      await this.tx.startNotifications();
    }
  }
  private disconnected = () => { void this.close(); };
  private notification = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (value) this.receive(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  };
  private receive(bytes: Uint8Array) {
    try {
      for (const message of this.decoder.push(bytes)) {
        const response = decodeResponse(message);
        if (response.id !== this.pending?.id) continue;
        const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer);
        if (response.error) pending.reject(new Error(response.error)); else pending.resolve(response);
      }
    } catch (error) { this.fail(error); void this.close(); }
  }
  private fail(error: unknown) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(error instanceof Error ? error : new Error(String(error)));
    this.pending = undefined;
  }
  request(request: Request): Promise<Response> {
    const task = this.queue.catch(() => {}).then(async () => {
      const scripts: Response['scripts'] = [], gradients: NonNullable<Response['gradients']> = [], colors: NonNullable<Response['colors']> = [];
      let offset = request.colorOffset ?? request.gradientOffset ?? request.scriptOffset ?? 0;
      while (true) {
        if (this.closed) throw new Error('Device disconnected. Find Luxio again to reconnect.');
        const bytes = frame(encodeRequest({ ...request, ...(request.operation === 25 ? { colorOffset: offset } : request.operation === 18 ? { gradientOffset: offset } : { scriptOffset: offset }) }));
        const result = await new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => { this.fail(new Error('Device did not respond. Reconnect before trying again.')); void this.close(); }, 15000);
          this.pending = { id: request.id, resolve, reject, timer };
          void (async () => {
            if (this.writer) await this.writer.write(bytes);
            else if (this.rx) {
              for (let index = 0; index < bytes.length; index += 20) {
                if (this.closed) throw new Error('Bluetooth disconnected.');
                await this.rx.writeValueWithResponse(bytes.slice(index, index + 20));
              }
            } else throw new Error('Connect the device first.');
          })().catch(error => { this.fail(error); void this.close(); });
        });
        scripts.push(...result.scripts); gradients.push(...(result.gradients ?? [])); colors.push(...(result.colors ?? []));
        const next = request.operation === 25 ? result.nextColorOffset : request.operation === 18 ? result.nextGradientOffset : request.operation === 5 ? result.nextScriptOffset : 0;
        if (!next) return { ...result, scripts, gradients, colors };
        const page = request.operation === 25 ? result.colors : request.operation === 18 ? result.gradients : result.scripts;
        if (next <= offset || !page?.length) throw new Error('Invalid device library continuation.');
        offset = next;
      }
    });
    this.queue = task;
    return task;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.fail(new Error('Device disconnected.'));
    this.ondisconnect?.();
    if (this.kind === 'usb') {
      await this.reader?.cancel().catch(() => {});
      await this.reading;
      this.reader?.releaseLock(); this.writer?.releaseLock();
      await (this.device as SerialPort).close().catch(() => {});
    } else {
      this.tx?.removeEventListener('characteristicvaluechanged', this.notification);
      (this.device as BluetoothDevice).removeEventListener('gattserverdisconnected', this.disconnected);
      (this.device as BluetoothDevice).gatt?.disconnect();
    }
  }
}
