import type { ESPLoader, Transport } from 'esptool-js';

export async function checkFlashSize(loader: ESPLoader, minimumBytes: number) {
  // esptool-js 0.5.7 uses the C3's SPI base for C6. Match Espressif's C6 target:
  // https://github.com/espressif/esptool/blob/v5.1.0/esptool/targets/esp32c6.py
  if (loader.chip.CHIP_NAME === 'ESP32-C6') loader.chip.SPI_REG_BASE = 0x60003000;
  const bytes = (await loader.getFlashSize()) * 1024;
  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error('Could not detect flash capacity. Reconnect your ESP32 and try again.');
  if (bytes < minimumBytes) throw new Error(`Detected ${bytes / 1048576} MB of flash. Luxio for ${loader.chip.CHIP_NAME} requires at least ${minimumBytes / 1048576} MB.`);
  return bytes;
}

export async function resetFlasher(transport: Transport) {
  // CH340 reset circuits need a settled idle state before the EN pulse.
  // Keep GPIO0 released throughout so the board boots the installed firmware.
  await transport.setDTR(false);
  await transport.setRTS(false);
  await new Promise(resolve => setTimeout(resolve, 200));
  await transport.setRTS(true);
  await new Promise(resolve => setTimeout(resolve, 200));
  await transport.setRTS(false);
  await new Promise(resolve => setTimeout(resolve, 200));
}

export async function disconnectFlasher(transport: Transport) {
  // esptool-js 0.5.7 cancels its reader but never releases its lock before
  // waiting for unlocked streams. Release it explicitly on success and failure.
  const serial = transport as unknown as { reader?: ReadableStreamDefaultReader<Uint8Array> };
  if (serial.reader) {
    try { await serial.reader.cancel(); }
    catch { /* The board may have already disconnected during its reset. */ }
    finally { serial.reader.releaseLock(); serial.reader = undefined; }
  }
  await transport.disconnect();
}
