import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Usb, Zap } from 'lucide-react';
import { Modal } from './Controls';
import { findDevice, type Light } from './model';
import { connections } from './transport';
import { disconnectFlasher, resetFlasher } from './flashing';
import firmwareTargets from '../shared/firmware/targets.json';

export function Flasher({ close, added }: { close: () => void; added: (light: Light, configure?: boolean) => void }) {
  const [port, setPort] = useState<SerialPort | null>(null);
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [log, setLog] = useState('');
  const logElement = useRef<HTMLPreElement>(null);
  const supported = Boolean(navigator.serial) && 'usb' in navigator;
  useEffect(() => { if (logElement.current) logElement.current.scrollTop = logElement.current.scrollHeight; }, [log]);

  async function configure() {
    if (!port) return;
    setBusy(true); setError(''); setStatus('Connecting to Luxio…');
    try { added(await findDevice('usb'), true); }
    catch (error) { setError(String(error)); setStatus(installed ? 'Firmware installed. Wait for your board to restart, then try connecting again.' : ''); }
    finally { setBusy(false); }
  }

  async function flash() {
    if (!port || busy) return;
    setBusy(true); setError(''); setLog(''); setProgress(0); setStatus('Detecting your ESP32…');
    let transport: import('esptool-js').Transport | undefined;
    try {
      for (const connection of connections.values()) if (connection.device === port) await connection.close();
      const { ESPLoader, Transport } = await import('esptool-js');
      transport = new Transport(port);
      const loader = new ESPLoader({ transport, baudrate: 460800, romBaudrate: 115200, terminal: {
        clean: () => setLog(''), write: text => setLog(previous => (previous + text).slice(-20000)), writeLine: text => setLog(previous => (previous + text + '\n').slice(-20000)),
      } });
      const detected = await loader.main();
      const chip = loader.chip.CHIP_NAME.toLowerCase().replace(/[^a-z0-9]/g, '');
      const hardware = firmwareTargets.find(target => target.chip === chip);
      if (!hardware) throw new Error(`Unsupported chip: ${detected}. Available firmware targets: ${firmwareTargets.map(target => target.chip).join(', ')}.`);
      const flashBytes = (await loader.getFlashSize()) * 1024;
      if (!Number.isFinite(flashBytes) || flashBytes < hardware.minimumFlashSize) throw new Error(`Luxio for ${chip} requires at least ${hardware.minimumFlashSize / 1048576} MB of detected flash memory.`);
      setStatus('Downloading and verifying firmware…');
      const response = await fetch(`https://api.luxio.lighting/updates?chip=${chip}&target=${hardware.target}&build=0&channel=0`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Firmware service returned HTTP ${response.status}`);
      const manifest = await response.json() as { chip: string; target: string; minimumFlashSize?: number; size: number; sha256: string; parts: { address: number; url: string; sha256: string; size?: number }[] } | null;
      if (!manifest) throw new Error(`No public recovery build is available for ${detected} yet`);
      if (manifest.chip !== chip || manifest.target !== hardware.target || !Array.isArray(manifest.parts) || !manifest.parts.length) throw new Error('Invalid recovery firmware manifest');
      if (manifest.minimumFlashSize !== undefined && manifest.minimumFlashSize !== hardware.minimumFlashSize) throw new Error('Incompatible firmware flash requirement');
      const limits = new Map([[hardware.bootloaderAddress, 0x8000 - hardware.bootloaderAddress], [0x8000, 0x1000], [0xe000, 0x2000], [0x10000, hardware.recoverySize], [hardware.applicationAddress, hardware.applicationSize]]);
      if (manifest.parts.length !== limits.size || new Set(manifest.parts.map(part => part.address)).size !== limits.size || manifest.parts.some(part => !limits.has(part.address))) throw new Error('Flash parts do not match this chip’s recovery layout');
      const application = manifest.parts.find(part => part.address === hardware.applicationAddress)!;
      if (!Number.isInteger(manifest.size) || manifest.size < 288 || manifest.size > hardware.applicationSize || application.sha256 !== manifest.sha256) throw new Error('USB and OTA application must match');
      const files = [];
      for (const part of manifest.parts) {
        if (!Number.isInteger(part.address) || part.address < 0 || !part.url.startsWith('https://')) throw new Error('Invalid flash manifest');
        const response = await fetch(part.url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(`Firmware download returned HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length || bytes.length > limits.get(part.address)! || (part.size !== undefined && part.size !== bytes.length)) throw new Error('Firmware part does not fit its partition or declared size');
        if (part.address === hardware.applicationAddress && bytes.length !== manifest.size) throw new Error('Application size does not match manifest');
        if ([hardware.bootloaderAddress, 0x10000, hardware.applicationAddress].includes(part.address) && (bytes.length < 24 || bytes[0] !== 0xe9 || new DataView(bytes.buffer).getUint16(12, true) !== hardware.imageChipId)) throw new Error('Firmware image is for a different chip');
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (digest !== part.sha256) throw new Error('Firmware download checksum does not match');
        let data = ''; for (let offset = 0; offset < bytes.length; offset += 8192) data += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        files.push({ address: part.address, data });
      }
      setStatus('Installing Luxio. Keep your ESP32 connected.');
      await loader.writeFlash({ fileArray: files, flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep', eraseAll: false, compress: true,
        reportProgress: (file, written, total) => setProgress(((file + written / total) / files.length) * 100) });
      setStatus('Restarting Luxio…');
      await resetFlasher(transport);
      await disconnectFlasher(transport); transport = undefined;
      setInstalled(true); setProgress(100); setStatus('Firmware installed. Waiting for Luxio to restart…');
      const deadline = Date.now() + 60000;
      let connectionError = '';
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        setStatus('Firmware installed. Connecting to Luxio via USB…');
        try { added(await findDevice('usb', port), true); return; }
        catch (error) {
          connectionError = error instanceof Error ? error.message : String(error);
          setLog(previous => `${previous}\nUSB reconnect: ${connectionError}`.slice(-20000));
        }
      }
      setStatus('Firmware installed. Luxio has not reconnected yet. Press RESET on the board without holding BOOT, then select its USB port below.');
      setError(connectionError);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); setStatus(''); }
    finally { if (transport) await disconnectFlasher(transport).catch(() => {}); setBusy(false); }
  }

  return <Modal title="Set up Luxio" close={() => { if (!busy) close(); }}><div className="sheet-body flasher-body">
    <ol className="setup-steps" aria-label="Setup progress"><li className={!port ? 'current' : ''} aria-current={!port ? 'step' : undefined}><button disabled={!port || busy || installed} onClick={() => { setPort(null); setProgress(null); setError(''); setLog(''); setStatus(''); }}><b>1</b> Connect</button></li><li className={port ? 'current' : ''} aria-current={port ? 'step' : undefined}><b>2</b> Install</li><li><b>3</b> Configure</li></ol>
    <div className="flasher-intro"><span className="empty-icon"><Zap size={32} /></span><h3>{installed ? 'Luxio is installed' : port ? 'Install Luxio' : 'Flash your ESP32'}</h3><p>{installed ? 'Your light will open automatically when its USB connection is ready.' : port ? 'Install the latest Luxio firmware on your ESP32.' : 'Plug in your ESP32 with a USB data cable, then select it below.'}</p></div>
    {!supported && <p className="field-note">Flashing requires Google Chrome on a computer with USB. You can still use the simulator here.</p>}
    {!port ? <button className="primary-button full" disabled={!supported || busy} onClick={async () => {
      setError(''); setBusy(true);
      try { setPort(await navigator.serial.requestPort()); }
      catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) setError(String(error)); }
      finally { setBusy(false); }
    }}><Usb size={17} /> Connect ESP32</button> : <div className="flasher-actions">{!installed && <div className="flash-install">{busy && <progress className="flash-progress" value={progress ?? 0} max={100} aria-label="Firmware installation progress" />}<button className="primary-button full" disabled={busy} onClick={() => void flash()}>{busy ? <><LoaderCircle size={16} className="spinning" /> Flashing…</> : 'Install Luxio'}</button></div>}{installed && !busy && <button className="primary-button full" onClick={() => void configure()}>Connect to Luxio</button>}</div>}
    {status && <p className="field-note" role="status">{status}</p>}
    {log && <details className="flash-log"><summary>Installation log</summary><pre ref={logElement}>{log}</pre></details>}
    {error && <p role="alert" className="error">{error}</p>}
  </div></Modal>;
}
