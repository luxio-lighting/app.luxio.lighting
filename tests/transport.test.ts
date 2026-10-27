import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceConnection } from '../src/transport';
import { decodeRequest, encodeResponse, frame, FrameDecoder } from '../shared/protocol/src/index';

test('USB handles fragmented frames, boot text, paginated libraries, serialization and disconnects', async () => {
  let incoming: ReadableStreamDefaultController<Uint8Array>;
  const decoder = new FrameDecoder();
  const operations: number[] = [];
  let closed = false;
  const port = {
    open: async () => {}, close: async () => { closed = true; },
    setSignals: async (signals: SerialOutputSignals) => { assert.deepEqual(signals, { dataTerminalReady: true, requestToSend: false }); },
    readable: new ReadableStream<Uint8Array>({ start(controller) { incoming = controller; } }),
    writable: new WritableStream<Uint8Array>({ write(bytes) {
      for (const message of decoder.push(bytes)) {
        const request = decodeRequest(message); operations.push(request.operation);
        if (request.operation === 15) continue;
        const response = frame(encodeResponse({ id: request.id, error: '', scripts: [],
          ...(request.operation === 25 ? { colors: [{ id: request.colorOffset ? 'two' : 'one', name: 'Color', color: { red: 255, green: 0, blue: 0, white: 0, warmWhite: 0, coolWhite: 0 } }], nextColorOffset: request.colorOffset ? 0 : 1 } : {}) }));
        incoming.enqueue(new TextEncoder().encode('boot diagnostics\n'));
        incoming.enqueue(response.slice(0, 5)); incoming.enqueue(response.slice(5, 11)); incoming.enqueue(response.slice(11));
      }
    } }),
  } as unknown as SerialPort;
  const connection = new DeviceConnection('usb', port);
  await connection.open();
  const [listing, state] = await Promise.all([connection.request({ id: 1, operation: 25 }), connection.request({ id: 2, operation: 0 })]);
  assert.deepEqual(listing.colors?.map(c => c.id), ['one', 'two']);
  assert.equal(state.id, 2); assert.deepEqual(operations, [25, 25, 0]);
  const pending = connection.request({ id: 3, operation: 15, on: true });
  const rejected = assert.rejects(pending, /disconnected/);
  await new Promise(resolve => setTimeout(resolve, 0));
  await connection.close(); await rejected;
  assert.equal(closed, true);
  assert.equal(operations.filter(op => op === 15).length, 1);
  await assert.rejects(connection.request({ id: 4, operation: 0 }), /disconnected/);
});

test('BLE subscribes before writes, frames chunks of at most 20 bytes, and fails pending work on disconnect', async () => {
  const device = new EventTarget() as BluetoothDevice;
  const tx = new EventTarget() as BluetoothRemoteGATTCharacteristic;
  const decoder = new FrameDecoder();
  let subscribed = false;
  const sizes: number[] = [];
  Object.assign(tx, { startNotifications: async () => { subscribed = true; return tx; } });
  const rx = { async writeValueWithResponse(bytes: Uint8Array) {
    assert.equal(subscribed, true); sizes.push(bytes.length);
    for (const message of decoder.push(bytes)) {
      const request = decodeRequest(message);
      if (request.operation === 15) continue;
      const response = frame(encodeResponse({ id: request.id, error: '', scripts: [] }));
      for (let offset = 0; offset < response.length; offset += 3) {
        const part = response.slice(offset, offset + 3);
        Object.defineProperty(tx, 'value', { value: new DataView(part.buffer), configurable: true });
        tx.dispatchEvent(new Event('characteristicvaluechanged'));
      }
    }
  } };
  Object.assign(device, { gatt: { connect: async () => ({ getPrimaryService: async () => ({ getCharacteristic: async (uuid: string) => uuid.includes('1001') ? rx : tx }) }), disconnect: () => {} } });
  const connection = new DeviceConnection('bluetooth', device);
  await connection.open();
  const response = await connection.request({ id: 7, operation: 31, script: { id: '', name: 'Test', source: 'function loop() end'.repeat(10) } });
  assert.equal(response.id, 7); assert.ok(sizes.length > 2); assert.ok(sizes.every(size => size <= 20));
  const pending = connection.request({ id: 8, operation: 15, on: true });
  const rejected = assert.rejects(pending, /disconnected/);
  await new Promise(resolve => setTimeout(resolve, 0));
  device.dispatchEvent(new Event('gattserverdisconnected'));
  await rejected; await connection.close();
});

test('Setup hands an already selected USB port to the app without another picker and releases an existing connection', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let pickerCalls = 0, opens = 0, closes = 0, hostReady = false;
  const decoder = new FrameDecoder();
  let incoming: ReadableStreamDefaultController<Uint8Array>;
  const port = {
    readable: undefined as ReadableStream<Uint8Array> | undefined,
    writable: undefined as WritableStream<Uint8Array> | undefined,
    setSignals: async (signals: SerialOutputSignals) => { hostReady = signals.dataTerminalReady === true && signals.requestToSend === false; },
    open: async () => {
      opens++; hostReady = false;
      port.readable = new ReadableStream({ start(controller) { incoming = controller; } });
      port.writable = new WritableStream({ write(bytes) {
        assert.equal(hostReady, true, 'USB CDC cannot reply until the host-ready signal is set');
        for (const body of decoder.push(bytes)) {
          const request = decodeRequest(body);
          incoming.enqueue(frame(encodeResponse({ id: request.id, error: '', scripts: [], state: {
            deviceId: 'setup-handoff', activeScriptId: '', lanIp: '', build: 36, mode: 0, on: true, brightness: 180,
            config: { name: 'New Luxio', stripType: 'WS2805', ledCount: 60, gpio: 16, channel: 100 },
            color: { red: 0, green: 210, blue: 255, white: 0, warmWhite: 0, coolWhite: 0 },
          } })));
        }
      } });
    },
    close: async () => { closes++; },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: { requestPort: async () => { pickerCalls++; return port; } } } });
  const { findDevice, remove } = await import('../src/model');
  const { connections } = await import('../src/transport');
  try {
    const light = await findDevice('usb', port as unknown as SerialPort);
    assert.equal(light.id, 'usb:setup-handoff'); assert.equal(light.transport, 'usb'); assert.equal(light.online, true);
    const previous = connections.get(light.id);
    const same = await findDevice('usb', port as unknown as SerialPort);
    assert.equal(same, light); assert.notEqual(connections.get(light.id), previous);
    assert.equal(pickerCalls, 0); assert.equal(opens, 2); assert.equal(closes, 1);
    await connections.get(light.id)?.close(); remove(light);
    assert.equal(closes, 2);
  } finally {
    await connections.get('usb:setup-handoff')?.close();
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
