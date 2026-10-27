import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Copy, LoaderCircle, RefreshCw, Wifi, Bluetooth, Usb } from 'lucide-react';
import { Modal, Power } from './Controls';
import { remove, send, type Light } from './model';
import { configSchema, type WifiNetwork } from '../shared/protocol/src/index';

export function Settings({ light, close, removed, notice }: { light: Light; close: () => void; removed: () => void; notice: (message: string) => void }) {
  const [config, setConfig] = useState(structuredClone(light.state.config));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmWifi, setConfirmWifi] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [wifi, setWifi] = useState(false);
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [secured, setSecured] = useState(true);
  const [pairing, setPairing] = useState('');
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [available, setAvailable] = useState(0);
  const [update, setUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const valid = configSchema.safeParse(config).success && new TextEncoder().encode(config.name.trim()).length <= 63 && (!config.relay?.enabled || config.relay.gpio !== config.gpio);

  async function save() {
    setBusy(true); setError('');
    try { await send(light, { operation: 3, config: configSchema.parse(config) }); close(); }
    catch (error) { setError(`Couldn’t save settings. ${String(error)}`); }
    finally { setBusy(false); }
  }

  return <Modal title={wifi ? 'Wi-Fi' : update ? 'Firmware Update' : 'Settings'} close={() => { if (!busy) { if (wifi) { setWifi(false); setPassword(''); setError(''); } else if (update) setUpdate(false); else close(); } }}><div className="sheet-body settings-body">
    {wifi ? <>
      <div className="section-heading"><h3>Choose a network</h3><button className="icon-button" aria-label="Scan Wi-Fi networks" disabled={busy} onClick={() => void scanWifi()}><RefreshCw size={18} /></button></div>
      <div className="group">{networks.map((network, index) => <button className="link-row" key={`${network.ssid}-${index}`} onClick={() => { setSsid(network.ssid); setSecured(network.passwordRequired); setPassword(''); }}><span><Wifi size={16} /> {network.ssid}</span><small>{network.rssi} dBm</small></button>)}{!networks.length && <p className="field-note">Scan for networks or enter a hidden network below.</p>}</div>
      <form onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError('');
        try {
          if (new TextEncoder().encode(ssid).length > 32) throw new Error('Network names must be 32 bytes or fewer.');
          if (secured && !((password.length >= 8 && new TextEncoder().encode(password).length <= 63) || /^[a-f\d]{64}$/i.test(password))) throw new Error('Use 8–63 characters or a 64-digit hexadecimal password.');
          await send(light, { operation: 4, wifi: { ssid, password: secured ? password : '' } });
          setPassword(''); notice('Wi-Fi settings sent. Luxio may disconnect while joining the network.'); setWifi(false);
        } catch (error) { setError(String(error)); } finally { setBusy(false); }
      }}><div className="group"><label className="setting-row"><span>Network name</span><input required maxLength={32} value={ssid} onChange={event => setSsid(event.target.value)} /></label><label className="setting-row"><span>Password required</span><input type="checkbox" checked={secured} onChange={event => { setSecured(event.target.checked); setPassword(''); }} /></label>{secured && <label className="setting-row"><span>Password</span><input required type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>}</div><p className="field-note">Credentials are sent directly to Luxio and are never stored in the app.</p><button className="primary-button full" disabled={busy || !ssid.trim()}>{busy ? 'Connecting…' : 'Connect'}</button></form>
    </> : update ? <div className="update-panel"><span className="empty-icon"><RefreshCw size={30} className={busy ? 'spinning' : ''} /></span><h3>{updateStatus === 'complete' ? 'Update Installed' : busy ? 'Installing Update' : 'Update Available'}</h3><p>{updateStatus === 'complete' ? `Luxio is now running build ${available}.` : `Build ${available} is ready to install. Keep Luxio powered on while it updates.`}</p>{progress !== null && <progress max={1} value={progress} aria-label="Download progress" />}{updateStatus && updateStatus !== 'complete' && <p role="status">{updateStatus}</p>}{!busy && updateStatus !== 'complete' && !updateStatus && <button className="primary-button full" onClick={() => void install()}>Install</button>}{!busy && light.address && updateStatus && updateStatus !== 'complete' && <a className="secondary-button" href={light.address} target="_blank" rel="noreferrer">Open Recovery <ArrowUpRight size={16} /></a>}{updateStatus === 'complete' && <button className="primary-button full" onClick={() => { setUpdate(false); setAvailable(0); }}>Done</button>}</div> : <>
      {!light.simulator && <><p className="field-label">CONNECTION</p><div className="group"><div className="setting-row"><span>Type</span><span className="muted">{light.transport === 'usb' ? <Usb size={15} /> : light.transport === 'bluetooth' ? <Bluetooth size={15} /> : <Wifi size={15} />} {light.transport === 'usb' ? 'USB' : light.transport === 'bluetooth' ? 'Bluetooth' : 'Wi-Fi'}</span></div><div className="setting-row"><span>IP Address</span><span className="muted">{light.state.lanIp || (light.address ? new URL(light.address).hostname : '—')}</span></div></div></>}
      <form id="settings-form" onSubmit={event => { event.preventDefault(); if (!light.simulator && light.state.config.wifi?.enabled !== false && config.wifi?.enabled === false) setConfirmWifi(true); else void save(); }}>
        <p className="field-label">LED STRIP</p><div className="group"><label className="setting-row"><span>Name</span><input aria-label="Device name" required maxLength={63} value={config.name} onChange={event => setConfig({ ...config, name: event.target.value })} /></label><label className="setting-row"><span>Type</span><select aria-label="Strip type" value={config.stripType} onChange={event => setConfig({ ...config, stripType: event.target.value as typeof config.stripType })}>{['WS2805', 'WS2814', 'WS2812', 'SK6812'].map(type => <option key={type}>{type}</option>)}</select></label><label className="setting-row"><span>LED Count</span><input aria-label="LED Count" type="number" min={1} max={1024} required value={config.ledCount || ''} onChange={event => setConfig({ ...config, ledCount: Number(event.target.value) })} /></label>{!light.simulator && <label className="setting-row"><span>Data Pin</span><input aria-label="Data Pin" type="number" min={0} max={54} required value={config.gpio} onChange={event => setConfig({ ...config, gpio: Number(event.target.value) })} /></label>}</div>
        {!light.simulator && <>
          <p className="field-label">RELAY</p><div className="group"><div className="setting-row"><span>Enable Relay</span><Power label="Enable Relay" on={config.relay?.enabled ?? false} disabled={light.state.build < 27} change={enabled => setConfig({ ...config, relay: { gpio: 0, inverted: false, ...config.relay, enabled } })} /></div>{config.relay?.enabled && <><label className="setting-row"><span>Relay GPIO</span><input aria-label="Relay GPIO" type="number" required min={0} max={54} value={config.relay.gpio} onChange={event => setConfig({ ...config, relay: { ...config.relay!, gpio: Number(event.target.value) } })} /></label><div className="setting-row"><span>Invert Relay</span><Power label="Invert Relay" on={config.relay.inverted} change={inverted => setConfig({ ...config, relay: { ...config.relay!, inverted } })} /></div></>}</div><p className="field-note">A relay switches power to the LED strip. Its GPIO must differ from Data Pin.{light.state.build < 27 ? ' Requires firmware build 27 or newer.' : ''}</p>
          <p className="field-label">WI-FI</p><div className="group"><div className="setting-row"><span>Enable Wi-Fi</span><Power label="Enable Wi-Fi" disabled={light.state.build < 34} on={config.wifi?.enabled !== false} change={enabled => setConfig({ ...config, wifi: { enabled } })} /></div>{config.wifi?.enabled !== false && <><div className="setting-row"><span>SSID</span><span className="muted">{light.network?.ssid || '—'}</span></div><div className="setting-row"><span>Gateway</span><span className="muted">{light.network?.gateway || '—'}</span></div><div className="setting-row"><span>DNS</span><span className="muted">{light.network?.dns?.join(', ') || '—'}</span></div><button type="button" className="link-row" disabled={busy || light.state.build < 24} onClick={() => { setWifi(true); void scanWifi(); }}>Configure Wi-Fi <Wifi size={16} /></button></>}</div><p className="field-note">Changing Enable Wi-Fi restarts Luxio. Reconnect using Bluetooth or USB to re-enable Wi-Fi.</p>
          {!light.state.matterDisabled && <><p className="field-label">MATTER</p><div className="group"><div className="setting-row"><span>Enable Matter</span><Power label="Enable Matter" disabled={light.state.build < 34} on={config.matter?.enabled !== false} change={enabled => setConfig({ ...config, matter: { enabled } })} /></div>{config.matter?.enabled !== false && config.wifi?.enabled !== false && <button type="button" className="link-row" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const result = await send(light, { operation: 12 }); const { default: QRCode } = await import('qrcode'); setPairing(result.pairingCode); setQr(result.pairingQr ? await QRCode.toDataURL(result.pairingQr, { margin: 2, width: 220 }) : ''); } catch (error) { setError(String(error)); } finally { setBusy(false); } }}>Show Pairing Code <ArrowUpRight size={16} /></button>}{pairing && <div className="pairing">{qr && <img src={qr} alt="Matter pairing QR code" width={220} height={220} />}<div><code>{pairing}</code><button type="button" className="icon-button" aria-label="Copy pairing code" onClick={() => { void navigator.clipboard.writeText(pairing).then(() => setCopied(true)).catch(error => setError(String(error))); }}>{copied ? <Check size={18} /> : <Copy size={18} />}</button></div></div>}</div><p className="field-note">Connect Luxio to a compatible smart home. Changing Enable Matter restarts Luxio; existing pairings are retained.</p></>}
          <p className="field-label">FIRMWARE</p><div className="group"><div className="setting-row"><span>Build</span><span className="muted">{light.state.build}</span></div><button type="button" className="link-row" disabled={busy} onClick={() => void checkUpdate()}>{busy ? 'Working…' : 'Check for Updates'}<RefreshCw size={16} /></button>{available > 0 && <button type="button" className="link-row" onClick={() => { setUpdate(true); setUpdateStatus(''); }}>Build {available} available <ArrowUpRight size={16} /></button>}</div>
        </>}
        {light.simulator && <><p className="field-label">SIMULATOR</p><div className="group"><p className="field-note padded">A virtual Luxio running in this browser. Settings and saved items are kept on this device.</p><button type="button" className="link-row danger" onClick={() => setConfirmRemove(true)}>Remove Simulator</button></div></>}
        {!light.simulator && <button type="button" className="text-button danger forget" onClick={() => setConfirmRemove(true)}>Forget this light</button>}
        {!valid && <p className="error">Enter a name, 1–1024 LEDs, and valid, different GPIO pins (0–54).</p>}
        <div className="settings-save"><button className="primary-button full" disabled={!valid || busy}>{busy ? <><LoaderCircle size={16} className="spinning" /> Saving…</> : 'Save'}</button></div>
      </form>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
    {confirmWifi && <div className="inline-confirm" role="alert"><h3>Disable Wi-Fi?</h3><p>Saving will restart Luxio and disconnect this browser and Matter. Reconnect using Bluetooth or USB to enable Wi-Fi again.</p><button className="danger-button" disabled={busy} onClick={() => { setConfirmWifi(false); void save(); }}>Disable Wi-Fi</button><button className="text-button" onClick={() => setConfirmWifi(false)}>Cancel</button></div>}
    {confirmRemove && <div className="inline-confirm" role="alert"><h3>{light.simulator ? 'Remove Simulator?' : 'Forget this light?'}</h3><p>{light.simulator ? 'Its settings and saved library will be removed from this browser.' : 'The device and its saved presets will remain unchanged.'}</p><button className="danger-button" onClick={() => { remove(light); removed(); }}>Remove</button><button className="text-button" onClick={() => setConfirmRemove(false)}>Cancel</button></div>}
  </div></Modal>;

  async function scanWifi() {
    setBusy(true); setError('');
    try {
      let result = await send(light, { operation: 16 });
      for (let i = 0; result.wifiScanning && i < 30 && mounted.current; i++) { await new Promise(resolve => setTimeout(resolve, 1000)); result = await send(light, { operation: 0 }); }
      if (!mounted.current) return;
      if (result.wifiScanError) throw new Error(result.wifiScanError);
      if (result.wifiScanning) throw new Error('Network scan timed out. Try again.');
      setNetworks(result.wifiNetworks ?? []);
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }
  async function checkUpdate() {
    setBusy(true); setError('');
    try {
      let result = await send(light, { operation: 13 });
      for (let i = 0; result.updateChecking && i < 45 && mounted.current; i++) { await new Promise(resolve => setTimeout(resolve, 1000)); result = await send(light, { operation: 0 }); }
      if (!mounted.current) return;
      if (result.updateError) throw new Error(result.updateError);
      if (result.updateChecking) throw new Error('Update check timed out. Try again.');
      setAvailable(result.availableBuild);
      if (result.availableBuild > light.state.build) { setUpdate(true); setUpdateStatus(''); } else notice('Your Luxio is up to date.');
    } catch (error) { setError(String(error)); } finally { setBusy(false); }
  }
  async function install() {
    setBusy(true); setError(''); setProgress(null); setUpdateStatus('Starting update…');
    try {
      await send(light, { operation: 14 });
      setUpdateStatus('Waiting for Luxio to restart…');
      const deadline = Date.now() + 300000;
      while (Date.now() < deadline && mounted.current) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          if (!light.address) throw new Error('No recovery address');
          const response = await fetch(`${light.address}/status`, { signal: AbortSignal.timeout(3000) });
          if (response.ok) {
            const status = await response.json();
            if (status.build === available) {
              if (status.error) { setError(status.error); setUpdateStatus('Update interrupted. Open recovery to continue.'); return; }
              if (status.size > 0 && Number.isFinite(status.received)) { setProgress(Math.min(1, status.received / status.size)); setUpdateStatus(status.received >= status.size ? 'Verifying firmware and restarting…' : 'Downloading firmware…'); }
            }
          }
        } catch { /* Recovery endpoint is unavailable during reboot. */ }
        try { const result = await send(light, { operation: 0 }); if (result.state?.build === available) { setUpdateStatus('complete'); return; } } catch { /* Verify the expected build after reconnecting. */ }
      }
      setUpdateStatus('Luxio has not reconnected yet. The update may still be running.');
    } catch (error) { setError(String(error)); setUpdateStatus('Could not confirm the update. Check the light before retrying.'); }
    finally { setBusy(false); }
  }
}
