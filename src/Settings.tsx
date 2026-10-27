import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, RotateCcw, QrCode, ChevronDown, LockKeyhole, Check, Copy, LoaderCircle, RefreshCw, Wifi, Bluetooth, Usb } from 'lucide-react';
import { Modal, Power } from './Controls';
import { discoverDevices, remove, send, type Light } from './model';
import { configSchema, type WifiNetwork } from '../shared/protocol/src/index';

export function Settings({ light, close, removed, notice }: { light: Light; close: () => void; removed: () => void; notice: (message: string) => void }) {
  // Build 37 can restore the old false capability flag from its OTA snapshot.
  const factoryResetSupported = light.state.factoryResetSupported || light.state.build === 37;
  const [config, setConfig] = useState(structuredClone(light.state.config));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmWifi, setConfirmWifi] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [wifi, setWifi] = useState(false);
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [selectedNetwork, setSelectedNetwork] = useState<WifiNetwork | null>(null);
  const [customNetwork, setCustomNetwork] = useState<'' | 'secured' | 'open'>('');
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [networkOpen, setNetworkOpen] = useState(false);
  const scanGeneration = useRef(0);
  const networkPicker = useRef<HTMLDivElement>(null);
  const networkTrigger = useRef<HTMLButtonElement>(null);
  const networkList = useRef<HTMLUListElement>(null);
  const customSsid = useRef<HTMLInputElement>(null);
  const secured = customNetwork ? customNetwork === 'secured' : selectedNetwork?.passwordRequired ?? false;
  const selectedValue = customNetwork || (selectedNetwork ? JSON.stringify([selectedNetwork.ssid, selectedNetwork.passwordRequired]) : '');
  const networkOptions = [...networks];
  if (selectedNetwork && !networkOptions.some(item => item.ssid === selectedNetwork.ssid && item.passwordRequired === selectedNetwork.passwordRequired)) networkOptions.push(selectedNetwork);
  const options = [
    ...networkOptions.map(item => ({ value: JSON.stringify([item.ssid, item.passwordRequired]), label: item.ssid, network: item })),
    { value: 'secured', label: 'Other secured network…', network: null },
    { value: 'open', label: 'Other open network…', network: null },
  ];
  useEffect(() => {
    if (!networkOpen) return;
    (networkList.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? networkList.current?.querySelector<HTMLElement>('[role="option"]'))?.focus();
    const dismiss = (event: PointerEvent) => { if (!networkPicker.current?.contains(event.target as Node)) setNetworkOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [networkOpen]);
  useEffect(() => { if (customNetwork) customSsid.current?.focus(); }, [customNetwork]);
  const [pairing, setPairing] = useState('');
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [available, setAvailable] = useState(0);
  const [update, setUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; scanGeneration.current++; }; }, []);
  const valid = configSchema.safeParse(config).success && new TextEncoder().encode(config.name.trim()).length <= 63 && (!config.relay?.enabled || config.relay.gpio !== config.gpio);

  async function save() {
    setBusy(true); setError('');
    try { await send(light, { operation: 3, config: configSchema.parse(config) }); close(); }
    catch (error) { setError(`Couldn’t save settings. ${String(error)}`); }
    finally { setBusy(false); }
  }

  return <Modal className="settings-sheet" title={confirmReset ? 'Factory Reset' : wifi ? 'Wi-Fi' : update ? 'Firmware Update' : 'Settings'} close={() => { if (!busy) { if (confirmReset) { setConfirmReset(false); setError(''); } else if (wifi) { scanGeneration.current++; setScanning(false); setNetworkOpen(false); setWifi(false); setPassword(''); setError(''); } else if (update) setUpdate(false); else close(); } }}><div className="sheet-body settings-body">
    {confirmReset ? <div className="factory-reset-confirm">
      <span className="empty-icon danger"><RotateCcw size={30} className={busy ? 'spinning' : ''} /></span>
      <h3>Reset {light.state.config.name}?</h3>
      <p>This permanently deletes all settings, saved colors, gradients, animations, Wi-Fi credentials, Bluetooth bonds and Matter pairings. Luxio will restart and need to be set up again.</p>
      <p>The installed firmware stays on your device.</p>
      <button type="button" className="danger-button full" disabled={busy} onClick={async () => {
        if (busy) return;
        setBusy(true); setError('');
        try {
          await send(light, { operation: 33, factoryResetConfirmed: true });
          removed(); notice('Factory reset requested. Luxio will restart. Reconnect using USB or Bluetooth to set it up again.');
        } catch (error) { setError(`Could not confirm the factory reset. Check the light before retrying. ${error instanceof Error ? error.message : String(error)}`); }
        finally { setBusy(false); }
      }}>{busy ? <><LoaderCircle size={16} className="spinning" />Resetting…</> : 'Delete All Data & Reset'}</button>
      <button type="button" autoFocus className="secondary-button full" disabled={busy} onClick={() => { setConfirmReset(false); setError(''); }}>Cancel</button>
    </div> : wifi ? <form className="wifi-form" onSubmit={async event => {
      event.preventDefault();
      if (busy || scanning || !selectedValue || !ssid) return;
      setBusy(true); setError('');
      try {
        if (new TextEncoder().encode(ssid).length > 32) throw new Error('Network names must be 32 bytes or fewer.');
        const passwordBytes = new TextEncoder().encode(password).length;
        if (secured && !((passwordBytes >= 8 && passwordBytes <= 63) || /^[a-f\d]{64}$/i.test(password))) throw new Error('Use an 8–63 byte password or a 64-digit hexadecimal password.');
        const before = (await send(light, { operation: 0 })).networkStatus;
        if (!mounted.current) return;
        await send(light, { operation: 4, wifi: { ssid, password: secured ? password : '' } });
        const deadline = Date.now() + 60000;
        let rejoined = !before?.connected || before.ssid !== ssid;
        while (mounted.current && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (!mounted.current) return;
          try {
            const result = await send(light, { operation: 0 });
            if (!mounted.current) return;
            const network = result.networkStatus;
            // When reconnecting to the same SSID, ignore the old connection
            // until the device has actually disconnected or restarted.
            if (network && (!network.connected || (network.disconnectCount ?? 0) > (before?.disconnectCount ?? 0) || (network.uptimeMs ?? Infinity) < (before?.uptimeMs ?? 0))) rejoined = true;
            if (rejoined && network?.connected && network.ssid === ssid && result.state?.lanIp && result.state.lanIp !== '0.0.0.0') {
              setPassword(''); setWifi(false); notice(`Connected to ${ssid}.`); return;
            }
          } catch {
            // USB/BLE can stay connected while Wi-Fi changes. An HTTP device
            // may obtain a new address; resolve it by the same device identity.
            if (!light.transport && mounted.current && Date.now() < deadline) {
              try {
                const response = await fetch('https://api.luxio.lighting/devices', { signal: AbortSignal.timeout(3000) });
                if (response.ok) {
                  const found: unknown = await response.json();
                  if (mounted.current && Array.isArray(found)) discoverDevices(found.filter(device => device?.deviceId === light.state.deviceId));
                }
              } catch { /* Keep waiting for a confirmed connection until the deadline. */ }
            }
          }
        }
        if (mounted.current) setError(`Couldn’t confirm connection to ${ssid}. Check the password and network, then try again.${light.transport ? '' : ' If Luxio changed networks, reconnect using USB or Bluetooth.'}`);
      } catch (error) { if (mounted.current) setError(String(error)); } finally { if (mounted.current) setBusy(false); }
    }}>
      <label id="wifi-network-label">SSID</label>
      <div className="wifi-picker" ref={networkPicker} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setNetworkOpen(false); }} onKeyDown={event => {
        if (event.key === 'Escape' && networkOpen) { event.preventDefault(); event.stopPropagation(); setNetworkOpen(false); networkTrigger.current?.focus(); }
      }}>
        <button ref={networkTrigger} id="wifi-network-trigger" type="button" className="wifi-select" disabled={busy} aria-haspopup="listbox" aria-expanded={networkOpen} aria-controls="wifi-network-options" aria-labelledby="wifi-network-label wifi-network-value" aria-describedby="wifi-scan-status" onClick={() => setNetworkOpen(!networkOpen)} onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setNetworkOpen(true); }
        }}>
          <span id="wifi-network-value" className={`wifi-selected ${selectedValue ? '' : 'muted'}`}>
            {selectedNetwork && !customNetwork && <span className="wifi-network-icon" role="img" aria-label={`${selectedNetwork.rssi} dBm, ${secured ? 'password required' : 'open network'}`}>
              <svg className={`wifi-signal strength-${selectedNetwork.rssi >= -55 ? 3 : selectedNetwork.rssi >= -70 ? 2 : selectedNetwork.rssi >= -80 ? 1 : 0}`} viewBox="0 0 24 24" aria-hidden="true"><path className="outer" d="M2 8a16 16 0 0 1 20 0"/><path className="middle" d="M5 12a11 11 0 0 1 14 0"/><path className="inner" d="M8.5 16a5.5 5.5 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg>
              {secured && <LockKeyhole className="wifi-lock" />}
            </span>}
            <span className="wifi-network-name">{options.find(option => option.value === selectedValue)?.label || 'Select a network'}</span>
          </span><ChevronDown size={14} />
        </button>
        <button type="button" className="wifi-refresh" aria-label="Refresh Wi-Fi networks" title="Refresh Wi-Fi networks" aria-busy={scanning} disabled={busy || scanning} onClick={() => void scanWifi()}><RefreshCw size={16} className={scanning ? 'spinning' : ''} /></button>
        <ul ref={networkList} id="wifi-network-options" className="wifi-options" role="listbox" aria-labelledby="wifi-network-label" hidden={!networkOpen} onKeyDown={event => {
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'));
          const index = items.indexOf(document.activeElement as HTMLElement);
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); items[index]?.click(); }
          else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            [...items.slice(index + 1), ...items.slice(0, index + 1)].find(item => item.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()))?.focus();
          }
        }}>
          {options.map(option => <li key={option.value} role="option" tabIndex={-1} aria-selected={selectedValue === option.value} onClick={() => {
            if (selectedValue !== option.value) {
              setSelectedNetwork(option.network); setCustomNetwork(option.network ? '' : option.value as 'secured' | 'open');
              setSsid(option.network?.ssid ?? ''); setPassword(''); setError('');
            }
            setNetworkOpen(false); networkTrigger.current?.focus();
            if (!option.network) customSsid.current?.focus();
          }}>
            {option.network && <span className="wifi-network-icon" role="img" aria-label={`${option.network.rssi >= -55 ? 'Strong' : option.network.rssi >= -70 ? 'Good' : option.network.rssi >= -80 ? 'Fair' : 'Weak'} signal, ${option.network.rssi} dBm, ${option.network.passwordRequired ? 'password required' : 'open network'}`}>
              <svg className={`wifi-signal strength-${option.network.rssi >= -55 ? 3 : option.network.rssi >= -70 ? 2 : option.network.rssi >= -80 ? 1 : 0}`} viewBox="0 0 24 24" aria-hidden="true"><path className="outer" d="M2 8a16 16 0 0 1 20 0"/><path className="middle" d="M5 12a11 11 0 0 1 14 0"/><path className="inner" d="M8.5 16a5.5 5.5 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/></svg>
              {option.network.passwordRequired && <LockKeyhole className="wifi-lock" />}
            </span>}
            <span className="wifi-network-name">{option.label}</span>
          </li>)}
        </ul>
      </div>
      {customNetwork && <input ref={customSsid} aria-label="Custom SSID" placeholder="Enter SSID" required maxLength={32} autoComplete="off" disabled={busy} value={ssid} onChange={event => setSsid(event.target.value)} />}
      {secured && <label className="wifi-password">Password<input required type="password" maxLength={64} autoComplete="new-password" disabled={busy} value={password} onChange={event => setPassword(event.target.value)} /></label>}
      <span id="wifi-scan-status" className="wifi-scan-status" role="status" aria-live="polite">{scanStatus}</span>
      <button className="primary-button full" aria-busy={busy} disabled={busy || scanning || !selectedValue || !ssid || (secured && !password)}>{busy ? <><LoaderCircle size={16} className="spinning" /> Connecting…</> : 'Connect'}</button>
    </form> : update ? <div className="update-panel"><span className="empty-icon"><RefreshCw size={30} className={busy ? 'spinning' : ''} /></span><h3>{updateStatus === 'complete' ? 'Update Installed' : busy ? 'Installing Update' : 'Update Available'}</h3><p>{updateStatus === 'complete' ? `Luxio is now running build ${available}.` : `Build ${available} is ready to install. Keep Luxio powered on while it updates.`}</p>{progress !== null && <progress max={1} value={progress} aria-label="Download progress" />}{updateStatus && updateStatus !== 'complete' && <p role="status">{updateStatus}</p>}{!busy && updateStatus !== 'complete' && !updateStatus && <button className="primary-button full" onClick={() => void install()}>Install</button>}{!busy && light.address && updateStatus && updateStatus !== 'complete' && <a className="secondary-button" href={light.address} target="_blank" rel="noreferrer">Open Recovery <ArrowUpRight size={16} /></a>}{updateStatus === 'complete' && <button className="primary-button full" onClick={() => { setUpdate(false); setAvailable(0); }}>Done</button>}</div> : <>
      {!light.simulator && <><p className="field-label">CONNECTION</p><div className="group"><div className="setting-row"><span>Type</span><span className="muted">{light.transport === 'usb' ? <Usb size={15} /> : light.transport === 'bluetooth' ? <Bluetooth size={15} /> : <Wifi size={15} />} {light.transport === 'usb' ? 'USB' : light.transport === 'bluetooth' ? 'Bluetooth' : 'Wi-Fi'}</span></div></div></>}
      <form id="settings-form" onSubmit={event => { event.preventDefault(); if (!light.simulator && light.state.config.wifi?.enabled !== false && config.wifi?.enabled === false) setConfirmWifi(true); else void save(); }}>
        <p className="field-label">LED STRIP</p><div className="group"><label className="setting-row"><span>Name</span><input aria-label="Device name" required maxLength={63} value={config.name} onChange={event => setConfig({ ...config, name: event.target.value })} /></label><label className="setting-row"><span>Type</span><select aria-label="Strip type" value={config.stripType} onChange={event => setConfig({ ...config, stripType: event.target.value as typeof config.stripType })}>{['WS2805', 'WS2814', 'WS2812', 'SK6812'].map(type => <option key={type}>{type}</option>)}</select></label><label className="setting-row"><span>LED Count</span><input aria-label="LED Count" type="number" min={1} max={1024} required value={config.ledCount || ''} onChange={event => setConfig({ ...config, ledCount: Number(event.target.value) })} /></label>{!light.simulator && <label className="setting-row"><span>Data Pin</span><input aria-label="Data Pin" type="number" min={0} max={54} required value={config.gpio} onChange={event => setConfig({ ...config, gpio: Number(event.target.value) })} /></label>}</div>
        {!light.simulator && <>
          <p className="field-label">RELAY</p><div className="group"><div className="setting-row"><span>Enable Relay</span><Power label="Enable Relay" on={config.relay?.enabled ?? false} disabled={light.state.build < 27} change={enabled => setConfig({ ...config, relay: { gpio: 0, inverted: false, ...config.relay, enabled } })} /></div>{config.relay?.enabled && <><label className="setting-row"><span>Relay GPIO</span><input aria-label="Relay GPIO" type="number" required min={0} max={54} value={config.relay.gpio} onChange={event => setConfig({ ...config, relay: { ...config.relay!, gpio: Number(event.target.value) } })} /></label><div className="setting-row"><span>Invert Relay</span><Power label="Invert Relay" on={config.relay.inverted} change={inverted => setConfig({ ...config, relay: { ...config.relay!, inverted } })} /></div></>}</div><p className="field-note">A relay switches power to the LED strip. Its GPIO must differ from Data Pin.{light.state.build < 27 ? ' Requires firmware build 27 or newer.' : ''}</p>
          <p className="field-label">WI-FI</p><div className="group"><div className="setting-row"><span>Enable Wi-Fi</span><Power label="Enable Wi-Fi" disabled={light.state.build < 34} on={config.wifi?.enabled !== false} change={enabled => setConfig({ ...config, wifi: { enabled } })} /></div>{config.wifi?.enabled !== false && <><div className="setting-row"><span>SSID</span><span className="muted">{light.network?.ssid || '—'}</span></div><div className="setting-row"><span>IP Address</span><span className="muted">{light.state.lanIp || (light.address ? new URL(light.address).hostname : '—')}</span></div><div className="setting-row"><span>Gateway</span><span className="muted">{light.network?.gateway || '—'}</span></div><div className="setting-row"><span>DNS</span><span className="muted">{light.network?.dns?.join(', ') || '—'}</span></div><button type="button" className="link-row" disabled={busy || light.state.build < 24} onClick={() => { setWifi(true); void scanWifi(); }}><span className="settings-action"><Wifi size={16} />Configure Wi-Fi</span></button></>}</div><p className="field-note">Changing Enable Wi-Fi restarts Luxio. Reconnect using Bluetooth or USB to re-enable Wi-Fi.</p>
          {!light.state.matterDisabled && <><p className="field-label">MATTER</p><div className="group"><div className="setting-row"><span>Enable Matter</span><Power label="Enable Matter" disabled={light.state.build < 34} on={config.matter?.enabled !== false} change={enabled => setConfig({ ...config, matter: { enabled } })} /></div>{config.matter?.enabled !== false && config.wifi?.enabled !== false && <button type="button" className="link-row" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const result = await send(light, { operation: 12 }); const { default: QRCode } = await import('qrcode'); setPairing(result.pairingCode); setQr(result.pairingQr ? await QRCode.toDataURL(result.pairingQr, { margin: 2, width: 220 }) : ''); } catch (error) { setError(String(error)); } finally { setBusy(false); } }}><span className="settings-action"><QrCode size={16} />Show Pairing Code</span></button>}{pairing && <div className="pairing">{qr && <img src={qr} alt="Matter pairing QR code" width={220} height={220} />}<div><code>{pairing}</code><button type="button" className="icon-button" aria-label="Copy pairing code" onClick={() => { void navigator.clipboard.writeText(pairing).then(() => setCopied(true)).catch(error => setError(String(error))); }}>{copied ? <Check size={18} /> : <Copy size={18} />}</button></div></div>}</div><p className="field-note">Connect Luxio to a compatible smart home. Changing Enable Matter restarts Luxio; existing pairings are retained.</p></>}
          <p className="field-label">FIRMWARE</p><div className="group"><div className="setting-row"><span>Build</span><span className="muted">{light.state.build}</span></div><button type="button" className="link-row" disabled={busy} onClick={() => void checkUpdate()}><span className="settings-action"><RefreshCw size={16} />{busy ? 'Checking...' : 'Check for Updates'}</span></button>{available > 0 && <button type="button" className="link-row" onClick={() => { setUpdate(true); setUpdateStatus(''); }}>Build {available} available <ArrowUpRight size={16} /></button>}</div>
        </>}
        {!light.simulator && <><p className="field-label">RESET</p><div className="group"><button type="button" className="link-row danger" disabled={busy || !light.online || !factoryResetSupported} onClick={() => { setError(''); setConfirmReset(true); }}><span className="settings-action"><RotateCcw size={16} />Factory Reset</span></button></div>{!factoryResetSupported && <p className="field-note">Update Luxio’s firmware to enable Factory Reset.</p>}</>}
        {light.simulator && <><p className="field-label">SIMULATOR</p><div className="group"><p className="field-note padded">A virtual Luxio running in this browser. Settings and saved items are kept on this device.</p><button type="button" className="link-row danger" onClick={() => setConfirmRemove(true)}>Remove Simulator</button></div></>}
        {!valid && <p className="error">Enter a name, 1–1024 LEDs, and valid, different GPIO pins (0–54).</p>}
      </form>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
    {confirmWifi && <div className="inline-confirm" role="alert"><h3>Disable Wi-Fi?</h3><p>Saving will restart Luxio and disconnect this browser and Matter. Reconnect using Bluetooth or USB to enable Wi-Fi again.</p><button className="danger-button" disabled={busy} onClick={() => { setConfirmWifi(false); void save(); }}>Disable Wi-Fi</button><button className="text-button" onClick={() => setConfirmWifi(false)}>Cancel</button></div>}
    {light.simulator && confirmRemove && <div className="inline-confirm" role="alert"><h3>Remove Simulator?</h3><p>Its settings and saved library will be removed from this browser.</p><button className="danger-button" onClick={() => { remove(light); removed(); }}>Remove</button><button className="text-button" onClick={() => setConfirmRemove(false)}>Cancel</button></div>}
  </div>{!wifi && !update && !confirmReset && <footer className="settings-save"><button type="submit" form="settings-form" className="primary-button full" disabled={!valid || busy}>{busy ? <><LoaderCircle size={16} className="spinning" /> Saving…</> : 'Save'}</button></footer>}</Modal>;

  async function scanWifi() {
    if (scanning) return;
    const generation = ++scanGeneration.current;
    setScanning(true); setScanStatus('Scanning…');
    try {
      let result = await send(light, { operation: 16 });
      const deadline = Date.now() + 20000;
      while (result.wifiScanning && mounted.current && generation === scanGeneration.current) {
        if (Date.now() >= deadline) throw new Error('Scan timed out.');
        await new Promise(resolve => setTimeout(resolve, 500));
        if (!mounted.current || generation !== scanGeneration.current) return;
        result = await send(light, { operation: 0 });
      }
      if (!mounted.current || generation !== scanGeneration.current) return;
      if (result.wifiScanError) throw new Error(result.wifiScanError);
      const found = (result.wifiNetworks ?? []).filter(item => item.ssid).sort((a, b) => b.rssi - a.rssi);
      setNetworks(found.filter((item, index) => found.findIndex(other => other.ssid === item.ssid && other.passwordRequired === item.passwordRequired) === index));
      setSelectedNetwork(previous => found.find(item => item.ssid === previous?.ssid && item.passwordRequired === previous.passwordRequired) ?? previous);
      setScanStatus(found.length ? '' : 'No networks found. Enter another network or refresh.');
    } catch (error) {
      if (mounted.current && generation === scanGeneration.current) setScanStatus(`Could not scan networks. Enter another network or refresh. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (mounted.current && generation === scanGeneration.current) setScanning(false);
    }
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
