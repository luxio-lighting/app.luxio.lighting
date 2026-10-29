import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Usb } from 'lucide-react';
import { Modal } from './Controls';
import { findDevice, type Light } from './model';
import { connections } from './transport';
import { checkFlashSize, disconnectFlasher, resetFlasher } from './flashing';
import firmwareTargets from '../shared/firmware/targets.json';

export function Flasher({ close, added }: { close: () => void; added: (light: Light, configure?: boolean) => void }) {
  const [port, setPort] = useState<SerialPort | null>(null);
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [title, setTitle] = useState('Flash your ESP32');
  const [progress, setProgress] = useState<number | null>(null);
  const [log, setLog] = useState('');
  const logElement = useRef<HTMLPreElement>(null);
  const supported = Boolean(navigator.serial) && 'usb' in navigator;
  useEffect(() => { if (logElement.current) logElement.current.scrollTop = logElement.current.scrollHeight; }, [log]);

  async function configure() {
    if (!port) return;
    setBusy(true); setError(''); setTitle('Connecting…'); setStatus('Connecting to Luxio via USB…');
    try { added(await findDevice('usb'), true); }
    catch (error) { setTitle('Luxio is installed'); setError(String(error)); setStatus(installed ? 'Firmware installed. Wait for your board to restart, then try connecting again.' : ''); }
    finally { setBusy(false); }
  }

  async function flash() {
    if (!port || busy) return;
    setBusy(true); setError(''); setLog(''); setProgress(0); setTitle('Flashing…'); setStatus('Detecting your ESP32…');
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
      const flashBytes = await checkFlashSize(loader, hardware.minimumFlashSize);
      setLog(previous => `${previous}\nDetected flash: ${flashBytes / 1048576} MB\n`);
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
        files.push({ address: part.address, data: bytes });
      }
      setStatus('Installing Luxio. Keep your ESP32 connected.');
      await loader.writeFlash({ fileArray: files, flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep', eraseAll: false, compress: true,
        reportProgress: (file, written, total) => setProgress(((file + written / total) / files.length) * 100) });
      setTitle('Restarting…'); setStatus('Firmware installed. Waiting for Luxio to restart…');
      await resetFlasher(transport);
      await disconnectFlasher(transport); transport = undefined;
      setInstalled(true); setProgress(100); setStatus('Firmware installed. Waiting for Luxio to restart…');
      const deadline = Date.now() + 60000;
      let connectionError = '';
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        setTitle('Connecting…'); setStatus('Connecting to Luxio via USB…');
        try { added(await findDevice('usb', port), true); return; }
        catch (error) {
          connectionError = error instanceof Error ? error.message : String(error);
          setLog(previous => `${previous}\nUSB reconnect: ${connectionError}`.slice(-20000));
        }
      }
      setTitle('Luxio is installed');
      setStatus('Firmware installed. Luxio has not reconnected yet. Press RESET on the board without holding BOOT, then select its USB port below.');
      setError(connectionError);
    } catch (error) { setTitle('Installation failed'); setError(error instanceof Error ? error.message : String(error)); setStatus('Check the installation log, then try again.'); }
    finally { if (transport) await disconnectFlasher(transport).catch(() => {}); setBusy(false); }
  }

  return <Modal title="Set up Luxio" close={() => { if (!busy) close(); }}><div className="sheet-body flasher-body">
    <ol className="setup-steps" aria-label="Setup progress"><li className={!port ? 'current' : ''} aria-current={!port ? 'step' : undefined}><button disabled={!port || busy || installed} onClick={() => { setPort(null); setProgress(null); setError(''); setLog(''); setStatus(''); setTitle('Flash your ESP32'); }}><b>1</b> Connect</button></li><li className={port ? 'current' : ''} aria-current={port ? 'step' : undefined}><b>2</b> Install</li><li><b>3</b> Configure</li></ol>
    <div className="flasher-intro" role="status" aria-live="polite"><span className="empty-icon">{busy ? <LoaderCircle size={32} className="spinning" /> : installed ? <Check size={32} /> : <Usb size={32} />}</span><h3>{title}</h3><p>{status || (installed ? 'Your light will open automatically when its USB connection is ready.' : port ? 'Install the latest Luxio firmware on your ESP32.' : 'Plug in your ESP32 with a USB data cable, then select it below.')}</p></div>
    {!supported && <p className="field-note">Flashing requires Google Chrome on a computer with USB. You can still use the simulator here.</p>}
    {!port ? <button className="primary-button full" disabled={!supported || busy} onClick={async () => {
      setError(''); setBusy(true); setTitle('Connecting…'); setStatus('Select your ESP32’s USB port.');
      try { setPort(await navigator.serial.requestPort()); setTitle('Install Luxio'); }
      catch (error) { setTitle('Flash your ESP32'); if (!(error instanceof DOMException && error.name === 'NotFoundError')) setError(String(error)); }
      finally { setBusy(false); setStatus(''); }
    }}><Usb size={17} /> Connect ESP32</button> : <div className="flasher-actions">{!installed && <div className={`flash-install${busy ? ' is-flashing' : ''}`}><progress className="flash-progress" value={progress ?? 0} max={100} aria-label="Firmware installation progress" aria-hidden={!busy} /><button className="primary-button full" disabled={busy} aria-hidden={busy} tabIndex={busy ? -1 : undefined} onClick={() => void flash()}>Install Luxio</button></div>}{installed && !busy && <button className="primary-button full" onClick={() => void configure()}>Connect to Luxio</button>}</div>}
    {log && <details className="flash-log"><summary>Installation log</summary><pre ref={logElement}>{log}</pre></details>}
    {error && <p role="alert" className="error">{error}</p>}
  </div></Modal>;
}
