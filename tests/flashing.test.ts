import test from 'node:test';
import assert from 'node:assert/strict';
import { ESPLoader, Transport } from 'esptool-js';
import { ESP32C6ROM } from 'esptool-js/lib/targets/esp32c6';
import { parseSecurityFlags } from 'esptool-js/lib/types/securityInfo';
import firmwareTargets from '../shared/firmware/targets.json';
import { ESP32S31ROM } from 'esptool-js/lib/targets/esp32s31';
import { ESP32C3ROM } from 'esptool-js/lib/targets/esp32c3';
import { checkFlashSize, disconnectFlasher, resetFlasher } from '../src/flashing';
import { DeviceConnection } from '../src/transport';
import { decodeRequest, encodeResponse, frame, FrameDecoder } from '../shared/protocol/src/index';

test('C6 flash detection reads the correct SPI controller and distinguishes unknown from undersized flash', async () => {
  const loader = new ESPLoader({ transport: new Transport({ getInfo: () => ({}) } as SerialPort), baudrate: 115200, romBaudrate: 115200,
    terminal: { clean() {}, write() {}, writeLine() {} } });
  loader.chip = new ESP32C6ROM();
  let flashId = 0x1640ef;
  const addresses: number[] = [];
  loader.readReg = async address => { addresses.push(address); return address === 0x60003058 ? flashId : 0; };
  loader.writeReg = async address => { addresses.push(address); };
  assert.equal(await checkFlashSize(loader, 4194304), 4194304);
  assert.ok(addresses.includes(0x60003058));
  assert.ok(addresses.every(address => address >= 0x60003000 && address < 0x60003100));
  flashId = 0x1740ef;
  assert.equal(await checkFlashSize(loader, 4194304), 8388608);
  flashId = 0x1540ef;
  await assert.rejects(checkFlashSize(loader, 4194304), /Detected 2 MB.*requires at least 4 MB/);
  for (flashId of [0, 0xffffff]) await assert.rejects(checkFlashSize(loader, 4194304), /Could not detect flash capacity/);
  loader.chip = new ESP32C3ROM();
  loader.readReg = async address => address === 0x60002058 ? 0x1640ef : 0;
  assert.equal(await checkFlashSize(loader, 4194304), 4194304);
  assert.equal(loader.chip.SPI_REG_BASE, 0x60002000);
});

test('post-flash reset settles the bridge before pulsing EN and closing the port', async () => {
  let bootHeld = true, resetHeld = true, idleAt = 0, resetAt = 0, bootAt = 0;
  const port = {
    async setSignals(signals: SerialOutputSignals) {
      if (signals.dataTerminalReady !== undefined) bootHeld = signals.dataTerminalReady;
      if (signals.requestToSend === undefined) return;
      assert.equal(bootHeld, false, 'GPIO0 must stay released to boot the application');
      if (signals.requestToSend) {
        assert.equal(resetHeld, false, 'The bridge must leave its previous reset state first');
        assert.ok(performance.now() - idleAt >= 190, 'Allow control lines to settle before resetting');
        resetAt = performance.now();
      } else if (resetAt) {
        assert.ok(performance.now() - resetAt >= 190, 'Hold reset long enough for the bridge');
        bootAt = performance.now();
      } else idleAt = performance.now();
      resetHeld = signals.requestToSend;
    },
  };
  await resetFlasher(new Transport(port as unknown as SerialPort));
  assert.equal(resetHeld, false);
  assert.ok(bootAt > 0);
  assert.ok(performance.now() - bootAt >= 190, 'Allow reset release to settle before disconnecting');
});

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
  void transport.readLoop();
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
  void transport.readLoop();
  incoming!.error(new Error('USB disconnected'));
  await disconnectFlasher(transport);
  assert.equal(closed, true);
});


test('S31 detection uses security chip ID 32, never the colliding P4 magic register', async () => {
  const transport = new Transport({ getInfo: () => ({}) } as SerialPort);
  transport.connect = async () => {};
  transport.readLoop = async () => {};
  const loader = new ESPLoader({ transport, baudrate: 115200, romBaudrate: 115200,
    terminal: { clean() {}, write() {}, writeLine() {} } });
  loader._connectAttempt = async () => 'success';
  loader.getSecurityInfo = async () => ({ flags: 0, parsedFlags: parseSecurityFlags(0), flashCryptCnt: 0, keyPurposes: [], chipId: 32, apiVersion: 0 });
  loader.readReg = async () => { throw new Error('Magic-register detection must not be used'); };
  await loader.detectChip('no_reset', 1);
  assert.ok(loader.chip instanceof ESP32S31ROM);
  const target = firmwareTargets.find(target => target.chip === 'esp32s31')!;
  assert.equal(loader.chip.IMAGE_CHIP_ID, target.imageChipId);
  assert.equal(loader.chip.BOOTLOADER_FLASH_OFFSET, target.bootloaderAddress);
  assert.equal(target.architecture, 'riscv');
  const addresses: number[] = [];
  loader.readReg = async address => { addresses.push(address); return address === 0x20501058 ? 0x1740ef : 0; };
  loader.writeReg = async address => { addresses.push(address); };
  assert.equal(await checkFlashSize(loader, target.minimumFlashSize), 8388608);
  assert.ok(addresses.includes(0x20501058));
  loader.readReg = async address => address === 0x20501058 ? 0x1640ef : 0;
  await assert.rejects(checkFlashSize(loader, target.minimumFlashSize), /Detected 4 MB.*requires at least 8 MB/);
});
