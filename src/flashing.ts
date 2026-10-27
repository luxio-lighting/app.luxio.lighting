import type { Transport } from 'esptool-js';

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
