import test from 'node:test';
import assert from 'node:assert/strict';
import { Transport } from 'esptool-js';
import { disconnectFlasher } from '../src/flashing';
import { DeviceConnection } from '../src/transport';
import { decodeRequest, encodeResponse, frame, FrameDecoder } from '../shared/protocol/src/index';

test('the actual flashing transport releases its USB lock before the app reconnects', { timeout: 2000 }, async () => {
  let opened = false, opens = 0, closes = 0, hostReady = false;
  let incoming: ReadableStreamDefaultController<Uint8Array>;
  const decoder = new FrameDecoder();
  const port = {
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    async setSignals(signals: SerialOutputSignals) { hostReady = signals.dataTerminalReady === true && signals.requestToSend === false; },
    async open() {
      assert.equal(opened, false, 'The flasher must close the port before reopening it');
      opened = true; opens++; hostReady = false;
      port.readable = new ReadableStream({ start(controller) { incoming = controller; } });
      port.writable = new WritableStream({ write(bytes) {
        assert.equal(hostReady, true, 'USB CDC must be initialized again after flashing');
        for (const message of decoder.push(bytes)) {
          const request = decodeRequest(message);
          incoming.enqueue(frame(encodeResponse({ id: request.id, error: '', scripts: [] })));
        }
      } });
    },
    async close() {
      assert.equal(port.readable?.locked, false, 'Read lock must be released before closing');
      assert.equal(port.writable?.locked, false, 'Write lock must be released before closing');
      opened = false; closes++; port.readable = null; port.writable = null;
    },
  };
  const transport = new Transport(port as unknown as SerialPort);
  await transport.connect();
  const flashingStream = port.readable!;
  assert.equal(flashingStream.locked, true);
  await disconnectFlasher(transport);
  assert.equal(flashingStream.locked, false);
  assert.equal(closes, 1);

  const connection = new DeviceConnection('usb', port as unknown as SerialPort);
  await connection.open();
  assert.equal((await connection.request({ id: 42, operation: 0 })).id, 42);
  await connection.close();
  assert.equal(opens, 2); assert.equal(closes, 2);
});

test('flasher cleanup releases an errored reader after USB disappears during restart', { timeout: 2000 }, async () => {
  let incoming: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const port = {
    readable: new ReadableStream<Uint8Array>({ start(controller) { incoming = controller; } }),
    writable: new WritableStream<Uint8Array>(),
    async open() {},
    async close() { assert.equal(port.readable.locked, false); closed = true; },
  };
  const transport = new Transport(port as unknown as SerialPort);
  await transport.connect();
  incoming!.error(new Error('USB disconnected'));
  await disconnectFlasher(transport);
  assert.equal(closed, true);
});
