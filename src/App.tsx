import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, Bluetooth, Usb, LightbulbOff, LoaderCircle, Monitor, MoreHorizontal, Plus, RefreshCw, Search, SlidersHorizontal, Wifi, X } from 'lucide-react';
import { addSimulator, discoverDevices, findDevice, needsChrome, emptyColor, lights, loadLibrary, modes, paletteCSS, plural, refresh, send, snapshot, storageError, subscribe, type Item, type Light } from './model';
import { Backdrop, Brightness, ColorWheel, Modal, Power } from './Controls';
import { Settings } from './Settings';
import { Flasher } from './Flasher';
import { Studio } from './Studio';
import { parseParameters } from '../shared/protocol/src/parameters';
import type { Color, Request } from '../shared/protocol/src/index';
import colorPresets from './colors.json';
import presets from './presets.json';
import './styles.css';

const builtins: Item[] = [
  ...colorPresets.map(preset => ({ id: `color-${preset.name}`, name: preset.name, mode: 0, colors: preset.colors.map(rgb => ({ ...emptyColor, red: rgb[0], green: rgb[1], blue: rgb[2] })) })),
  ...presets.map(preset => ({ id: `preset-${preset.name}`, name: preset.name, mode: preset.isGradient ? 1 : 2, colors: (preset.isGradient ? preset.colors : preset.previewColors).map(rgb => ({ ...emptyColor, red: rgb[0], green: rgb[1], blue: rgb[2] })), source: preset.source })),
];

export default function App() {
  const devices = useSyncExternalStore(subscribe, snapshot);
  const [selected, setSelected] = useState('');
  const [add, setAdd] = useState(false);
  const [notice, setNotice] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [settings, setSettings] = useState(false);
  const [finding, setFinding] = useState(false);
  const [mobileAppBanner, setMobileAppBanner] = useState(() => {
    try { return localStorage.getItem('luxio-mobile-app-banner-dismissed') !== 'true'; }
    catch { return true; }
  });
  const [toastTarget, setToastTarget] = useState<Element>(document.body);
  const selectedLight = devices.find(light => light.id === selected);
  const discoveringRef = useRef(false);
  const discoverAbort = useRef<AbortController | null>(null);

  function open(light: Light) { setSelected(light.id); history.pushState({ light: light.id }, '', `#${encodeURIComponent(light.id)}`); }
  useEffect(() => {
    const navigate = () => { const id = decodeURIComponent(location.hash.slice(1)); setSelected(lights.some(light => light.id === id) ? id : ''); setSettings(false); };
    navigate(); window.addEventListener('popstate', navigate);
    void discover(false);
    const timer = setInterval(() => { if (!document.hidden) for (const light of lights) void refresh(light).catch(() => {}); }, 4000);
    return () => { clearInterval(timer); discoverAbort.current?.abort(); window.removeEventListener('popstate', navigate); };
  }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 8000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const observer = new MutationObserver(() => setToastTarget(document.querySelector('dialog[open]') ?? document.body));
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, []);

  async function discover(userInitiated: boolean) {
    if (discoveringRef.current) return;
    discoveringRef.current = true; setDiscovering(true);
    const controller = new AbortController(); discoverAbort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('https://api.luxio.lighting/devices', { signal: controller.signal });
      if (!response.ok) throw new Error('Discovery unavailable. Add Luxio by its IP address.');
      const found: unknown = await response.json();
      if (!Array.isArray(found)) throw new Error('Discovery returned an invalid device list.');
      discoverDevices(found);
      await Promise.allSettled(lights.filter(light => !light.simulator).map(light => refresh(light)));
      if (userInitiated && selectedLight && selectedLight.online && !needsChrome(selectedLight)) await loadLibrary(selectedLight);
    } catch (error) { if (userInitiated) setNotice(error instanceof Error && error.name !== 'AbortError' ? error.message : 'Discovery timed out. Add Luxio by its IP address.'); }
    finally { clearTimeout(timeout); discoveringRef.current = false; setDiscovering(false); }
  }

  async function action(light: Light, request: Omit<Request, 'id'>) {
    try { await send(light, request); }
    catch (error) { setNotice(`Couldn’t update ${light.state.config.name}. ${error instanceof Error ? error.message : String(error)}`); }
  }

  async function find(kind: 'usb' | 'bluetooth') {
    setFinding(true);
    try { open(await findDevice(kind)); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setFinding(false); }
  }

  return <div className={`app ${selectedLight ? 'has-selection' : ''}`}>
    <aside className="sidebar">
      <div className="sidebar-header"><div className="brand"><img className="brand-mark" src="/luxio-jellyfish.png" alt="" width={32} height={32} /><strong>Luxio</strong></div><div className="row-actions sidebar-actions"><button className="icon-button refresh-button" aria-label="Refresh devices" disabled={discovering} onClick={() => void discover(true)}><RefreshCw size={18} className={discovering ? 'spinning' : ''} /></button><button className="icon-button" aria-label="Add Device" onClick={() => setAdd(true)}><Plus size={23} /></button></div></div>
      <div className="device-list">
        {devices.map(light => <article key={light.id} className={`device-card ${light.state.on && light.stateKnown !== false ? 'powered' : ''} ${selected === light.id ? 'selected' : ''} ${light.online ? '' : 'offline'}`}>
          <Backdrop light={light} /><div className="device-card-content"><div className="device-card-row"><button className="device-open" onClick={() => open(light)} aria-label={`Open ${light.state.config.name}${light.simulator ? '' : ` via ${light.transport === 'usb' ? 'USB' : light.transport === 'bluetooth' ? 'Bluetooth' : 'Wi-Fi'}`}`} title={light.simulator ? 'Simulator' : light.transport === 'usb' ? 'USB' : light.transport === 'bluetooth' ? 'Bluetooth' : 'Wi-Fi'}>{light.simulator ? <Monitor size={18} /> : light.transport === 'bluetooth' ? <Bluetooth size={18} /> : light.transport === 'usb' ? <Usb size={18} /> : <Wifi size={18} />}<span>{light.state.config.name}</span></button><Power on={light.state.on} change={on => void action(light, { operation: 15, on })} label={`${light.state.config.name}${light.simulator ? '' : ` ${light.transport === 'usb' ? 'USB' : light.transport === 'bluetooth' ? 'Bluetooth' : 'Wi-Fi'}`} power`} disabled={!light.online} /></div>
          <div className="device-brightness" inert={!light.state.on || light.stateKnown === false}><div><Brightness label={`${light.state.config.name}${light.simulator ? '' : ` ${light.transport === 'usb' ? 'USB' : light.transport === 'bluetooth' ? 'Bluetooth' : 'Wi-Fi'}`} brightness`} value={light.state.brightness} change={brightness => void action(light, { operation: 2, brightness })} disabled={!light.online || !light.state.on} /></div></div>
          {!light.online && !needsChrome(light) && <span className="offline-label">Offline</span>}</div>
        </article>)}
        {!devices.length && <div className="empty-devices"><span className="empty-icon"><LightbulbOff size={30} /></span><h2>No Luxio Devices Found</h2><p>Turn your ESP32 into a Luxio light.</p><button className="primary-button" onClick={() => setAdd(true)}>Flash my ESP32</button><button className="text-button simulator-link" onClick={() => open(addSimulator())}>Try the Simulator</button></div>}
      </div>
        {mobileAppBanner && <section className="mobile-app-banner" aria-label="Get the Luxio app for iOS and Android">
          <div className="mobile-app-banner-heading"><p>Get the Luxio app for iOS and Android</p><button className="icon-button" aria-label="Dismiss mobile app banner" onClick={() => {
            setMobileAppBanner(false);
            try { localStorage.setItem('luxio-mobile-app-banner-dismissed', 'true'); } catch { /* Dismiss for this session when storage is unavailable. */ }
          }}><X size={14} /></button></div>
          <div className="mobile-app-badges"><a href="https://apps.apple.com/app/luxio/id6464080905" target="_blank" rel="noopener noreferrer"><img src="/app-store.svg" alt="Download on the App Store" width={203} height={60} /></a><a href="https://play.google.com/store/apps/details?id=lighting.luxio.android" target="_blank" rel="noopener noreferrer"><img src="/play-store.svg" alt="Get it on Google Play" width={202} height={60} /></a></div>
        </section>}
      <footer className="sidebar-footer"><button className="secondary-button" disabled={finding} onClick={() => void find('bluetooth')}><Bluetooth size={17} /> Connect via Bluetooth</button><button className="secondary-button" disabled={finding} onClick={() => void find('usb')}><Usb size={17} /> Connect via USB</button>
        <button className="secondary-button" onClick={() => open(addSimulator())}><Monitor size={17} /> Add Simulator</button>
      </footer>
    </aside>
    <main className="main">
      {selectedLight ? <>
        {needsChrome(selectedLight) ? <div className="browser-guidance"><button className="icon-button back-button" aria-label="Back" onClick={() => { setSelected(''); history.pushState({}, '', location.pathname); }}><ArrowLeft size={22} /></button><img src="/luxio-jellyfish.png" width={64} height={64} alt="" /><h1>{selectedLight.state.config.name}</h1><h2>Use Google Chrome</h2><p>Luxio uses HTTP on your local network. Safari blocks this secure web app from accessing that HTTP connection.</p><p>Open this app in Google Chrome on desktop or Android and allow local network access when prompted. Chrome on iPhone uses the same browser engine as Safari; use the Luxio iOS app there.</p><a className="primary-button" href="https://www.google.com/chrome/">Get Google Chrome <ArrowUpRight size={16} /></a></div> : selectedLight.stateKnown === false ? <div className="browser-guidance"><button className="icon-button back-button" aria-label="Back" onClick={() => { setSelected(''); history.pushState({}, '', location.pathname); }}><ArrowLeft size={22} /></button><h1>{selectedLight.state.config.name}</h1><h2>Unable to connect</h2><p>Connect to the same Wi-Fi network and allow local network access in Chrome.</p><button className="primary-button" onClick={() => void refresh(selectedLight).catch(error => setNotice(String(error)))}>Retry</button></div> : <Control key={selectedLight.id} light={selectedLight} back={() => { setSelected(''); history.pushState({}, '', location.pathname); }} settings={() => setSettings(true)} notice={setNotice} />}
        {settings && <Settings light={selectedLight} close={() => setSettings(false)} removed={() => { setSettings(false); setSelected(''); history.replaceState({}, '', location.pathname); }} notice={setNotice} />}
      </> : <div className="welcome"><img src="/luxio-jellyfish.png" width={80} height={80} alt="" /><p>Select a Luxio</p></div>}
    </main>
    {add && <Flasher close={() => setAdd(false)} added={(light, configure) => { setAdd(false); open(light); if (configure) setSettings(true); }} />}
    {(notice || storageError) && createPortal(<div className="toast" role="alert"><span>{notice || storageError}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={18} /></button></div>, toastTarget)}
  </div>;
}

function Control({ light, back, settings, notice }: { light: Light; back: () => void; settings: () => void; notice: (value: string) => void }) {
  const state = light.state;
  const [mode, setMode] = useState(state.mode ?? 0);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ item: Item; rename?: boolean } | null>(null);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [parameters, setParameters] = useState(false);
  const [studio, setStudio] = useState<{ item?: Item } | null>(null);
  const [draftColors, setDraftColors] = useState<Color[] | null>(null);
  const queuedColors = useRef<Color[] | null>(null);
  const sendingColors = useRef(false);
  const activeRef = useRef(true);
  const colors = draftColors ?? (mode === 1 ? state.gradient?.colors ?? [state.color, { ...emptyColor, red: 125, green: 45, blue: 255 }] : [state.color]);
  const saved: Item[] = mode === 0 ? light.library.colors.map(item => ({ ...item, mode: 0, colors: [item.color] })) : mode === 1 ? light.library.gradients.map(item => ({ ...item, mode: 1 })) : light.library.scripts.map(item => ({ ...item, mode: 2, colors: item.preview ?? [] }));
  const filtered = builtins.filter(item => item.mode === mode);

  useEffect(() => {
    activeRef.current = true; setLibraryLoading(true);
    void loadLibrary(light).catch(error => notice(`Couldn’t load saved items. ${String(error)}`)).finally(() => { if (activeRef.current) setLibraryLoading(false); });
    void refresh(light).catch(() => {});
    return () => { activeRef.current = false; };
  }, [light.id]);
  useEffect(() => { if (state.config.ledCount <= 1 && mode === 1) { setMode(0); setDraftColors(null); } }, [state.config.ledCount]);

  async function apply(item: Item, saved = false) {
    if (busy || sendingColors.current) return;
    if (item.mode === 2 && state.mode === 2 && state.on && (saved ? state.activeScriptId === item.id : state.scriptName === `Luxio · ${item.name}`)) return;
    setBusy(true); setApplying(`${saved ? 'saved' : 'preset'}:${item.id}`);
    try {
      if (saved) {
        await send(light, { operation: [30, 23, 10][item.mode], colorId: item.mode === 0 ? item.id : undefined, gradientId: item.mode === 1 ? item.id : undefined, scriptId: item.mode === 2 ? item.id : undefined });
        if (item.mode === 2) {
          let overrides;
          try { overrides = JSON.parse(localStorage.getItem(`luxio-parameters-${light.simulator ? light.id : light.state.deviceId}-${item.id}`) ?? '[]'); } catch { overrides = []; }
          if (overrides.length) await send(light, { operation: 32, scriptId: item.id, parameters: parseParameters(item.source!, overrides) });
        }
      }
      else if (item.mode === 0) await send(light, { operation: 1, color: item.colors[0] });
      else if (item.mode === 1) await send(light, { operation: 17, gradient: { id: crypto.randomUUID(), name: '', colors: item.colors } });
      else {
        let overrides;
        try { overrides = JSON.parse(localStorage.getItem(`luxio-parameters-${light.simulator ? light.id : light.state.deviceId}-${item.id}`) ?? '[]'); } catch { overrides = []; }
        await send(light, { operation: 31, script: { id: '', name: `Luxio · ${item.name}`, source: item.source!, mode: 2 } });
        if (Array.isArray(overrides) && overrides.length) await send(light, { operation: 32, script: { id: '', name: `Luxio · ${item.name}`, source: '' }, parameters: parseParameters(item.source!, overrides) });
      }
      setDraftColors(null);
    } catch (error) { notice(`Couldn’t apply ${item.name}. ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); setApplying(null); }
  }

  async function editColors(next: Color[]) {
    setDraftColors(next); queuedColors.current = next;
    if (sendingColors.current) return;
    sendingColors.current = true; setBusy(true);
    try {
      while (queuedColors.current) {
        const snapshot = queuedColors.current; queuedColors.current = null;
        await send(light, snapshot.length > 1 ? { operation: 17, gradient: { id: crypto.randomUUID(), name: '', colors: snapshot } } : { operation: 1, color: snapshot[0] });
      }
    } catch (error) { queuedColors.current = null; notice(`Couldn’t change color. ${String(error)}`); }
    finally { sendingColors.current = false; setDraftColors(null); setBusy(false); }
  }

  async function save() {
    if (!naming) return; setBusy(true);
    try {
      const item = naming.item, trimmed = name.trim();
      if (new TextEncoder().encode(trimmed).length > 63) throw new Error('Names must be at most 63 bytes.');
      if (item.mode === 0) await send(light, { operation: naming.rename ? 28 : 27, savedColor: { id: item.id, name: trimmed, color: item.colors[0] } });
      else if (item.mode === 1) await send(light, { operation: naming.rename ? 21 : 20, gradient: { id: item.id, name: trimmed, colors: item.colors } });
      else await send(light, { operation: naming.rename ? 8 : 7, script: { id: item.id, name: trimmed, source: item.source!, mode: 2, parameters: parseParameters(item.source!, state.scriptName === `Luxio · ${item.name}` || state.activeScriptId === item.id ? state.parameters : undefined) } });
      await loadLibrary(light); setNaming(null); setSearch(''); notice(naming.rename ? 'Renamed.' : `Saved to ${light.simulator ? 'your simulator' : light.state.config.name}.`);
    } catch (error) { notice(`Couldn’t save. ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  }

  const activeColors = state.mode === 1 ? state.gradient?.colors ?? [] : [state.color];
  return <div className="control-view">
    <header className="control-header"><Backdrop light={light} /><div className="control-header-content"><div className="control-topbar"><button className="icon-button glass back-button" aria-label="Back" onClick={back}><ArrowLeft size={22} /></button><div className="device-title"><h1>{state.config.name}</h1></div><button className="icon-button glass more-button" aria-label="Luxio settings" onClick={settings}><MoreHorizontal size={23} /></button><Power on={state.on} label="Power" disabled={!light.online} change={on => { void send(light, { operation: 15, on }).catch(error => notice(String(error))); }} /></div>
      <Brightness value={state.brightness} change={brightness => { void send(light, { operation: 2, brightness }).catch(error => notice(String(error))); }} disabled={!light.online} />
      <div className="mode-picker" role="tablist" aria-label="Light mode">{modes.map((name, index) => index === 1 && state.config.ledCount <= 1 ? null : <button key={name} role="tab" id={`mode-${index}`} aria-controls="mode-content" aria-selected={mode === index} aria-disabled={busy} onClick={() => { if (busy) return; setMode(index); setSearch(''); setDraftColors(null); window.scrollTo({ top: 0 }); }}>{name}</button>)}</div>
    </div></header>
    {!light.online && <div className="connection-banner">This light is offline. Check its power and network, then refresh.<button onClick={() => void refresh(light).catch(error => notice(String(error)))}>Retry</button></div>}
    {light.animationError && <div className="connection-banner" role="alert">{light.animationError}</div>}
    <div className={`control-content ${mode === 2 ? 'animation-layout' : ''}`} id="mode-content" role="tabpanel" aria-labelledby={`mode-${mode}`}>
      {mode !== 2 && <div className="editor-column"><ColorWheel key={`${mode}-${state.config.stripType}`} colors={colors} strip={state.config.stripType} gradient={mode === 1} change={next => { if (light.online) void editColors(next); }} /></div>}
      <section className="library" aria-label="Preset library"><div className="section-heading"><h2>Presets</h2></div>
        <div className="preset-grid">{filtered.map(item => {
          const selected = state.mode === item.mode && (item.mode === 2 ? state.scriptName === `Luxio · ${item.name}` : JSON.stringify(activeColors) === JSON.stringify(item.colors));
          return <div className={`preset-card ${selected ? 'selected' : ''}`} key={item.id}>
            <button className="preset-main" aria-label={`${mode === 2 ? 'Play' : 'Apply'} ${item.name}`} aria-pressed={selected} disabled={!light.online} aria-disabled={busy || !light.online} aria-busy={applying === `preset:${item.id}`} onClick={() => void apply(item)} onContextMenu={event => { if (mode === 2) { event.preventDefault(); setMenu(item); } }}><span className="swatch" style={{ background: paletteCSS(item.colors) }}>{applying === `preset:${item.id}` ? <LoaderCircle size={20} className="spinning" role="status" aria-label={`Applying ${item.name}`} /> : selected && <Check size={19} />}</span><span>{item.name}</span></button>
            {mode === 2 && selected && Boolean(state.parameters?.length) && <button className="preset-options animation-settings" aria-label={`Settings for ${item.name}`} onClick={() => setParameters(true)}><SlidersHorizontal size={15} /></button>}
          </div>;
        })}</div>
        <div className="section-heading saved-heading"><h2>My {plural[mode]}</h2><div className="row-actions"><button className="icon-button" aria-label="Refresh saved items" disabled={libraryLoading} aria-disabled={libraryLoading || busy} onClick={() => { if (busy || libraryLoading) return; setLibraryLoading(true); void loadLibrary(light).catch(error => notice(String(error))).finally(() => setLibraryLoading(false)); }}><RefreshCw size={15} className={libraryLoading ? 'spinning' : ''} /></button></div></div>
        {saved.length > 0 && <label className="search-field"><Search size={16} /><input placeholder={`Search my ${plural[mode].toLowerCase()}`} aria-label={`Search my ${plural[mode].toLowerCase()}`} value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</label>}
        <div className="preset-grid saved-grid">{saved.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).map(item => <div key={item.id} className={`preset-card ${[state.activeColorId, state.activeGradientId, state.activeScriptId].includes(item.id) ? 'selected' : ''}`}><button className="preset-main" disabled={!light.online} aria-disabled={busy || !light.online} aria-busy={applying === `saved:${item.id}`} aria-label={`Apply saved ${item.name}`} onClick={() => void apply(item, true)} onContextMenu={event => { event.preventDefault(); setMenu(item); }}><span className="swatch" style={{ background: paletteCSS(item.colors) }}>{applying === `saved:${item.id}` && <LoaderCircle size={20} className="spinning" role="status" aria-label={`Applying ${item.name}`} />}</span><span>{item.name}</span></button><button className="preset-options" aria-label={`Options for ${item.name}`} onClick={() => setMenu(item)}><MoreHorizontal size={16} /></button>{mode === 2 && state.activeScriptId === item.id && Boolean(state.parameters?.length) && <div className="animation-actions"><button aria-label={`Settings for ${item.name}`} onClick={() => setParameters(true)}><SlidersHorizontal size={15} /></button></div>}</div>)}
          {mode === 2 && !search && <button className="preset-card save-card" disabled={!light.online || busy} onClick={() => setStudio({})}><span className="swatch"><Plus size={24} /></span><span>Create</span></button>}
          {mode !== 2 && !search && <button className="preset-card save-card" disabled={!light.online} aria-disabled={busy || !light.online} onClick={() => { if (busy) return; setName(''); setNaming({ item: { id: crypto.randomUUID(), name: '', mode, colors } }); }}><span className="swatch"><Plus size={24} /></span><span>Save</span></button>}
        </div>
        {search && !saved.some(item => item.name.toLowerCase().includes(search.toLowerCase())) && <p className="empty-library">No matching {plural[mode].toLowerCase()}.</p>}

      </section>
    </div>
    {studio && <Studio light={light} item={studio.item} close={() => setStudio(null)} notice={notice} />}
    {naming && <Modal title={`${naming.rename ? 'Rename' : 'Save'} ${modes[naming.item.mode]}`} close={() => { if (!busy) setNaming(null); }}><form className="sheet-body" onSubmit={event => { event.preventDefault(); void save(); }}><label className="field-label" htmlFor="preset-name">NAME</label><input autoFocus id="preset-name" placeholder={`My ${modes[naming.item.mode].toLowerCase()}`} maxLength={63} required value={name} onChange={event => setName(event.target.value)} /><p className="field-note">Saved {light.simulator ? 'in this browser with your simulator' : 'on your Luxio device'}.</p><button className="primary-button full" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button></form></Modal>}
    {menu && <Modal title={menu.name} close={() => setMenu(null)}><div className="sheet-body menu-actions">{menu.mode === 2 && saved.some(item => item.id === menu.id) && <button className="link-row" onClick={() => { setStudio({ item: menu }); setMenu(null); }}>Edit in Studio <ChevronRight size={16} /></button>}{saved.some(item => item.id === menu.id) ? <><button className="link-row" onClick={() => { setNaming({ item: menu, rename: true }); setName(menu.name); setMenu(null); }}>Rename <ChevronRight size={16} /></button><button className="link-row danger" onClick={() => { setDeleting(menu); setMenu(null); }}>Delete <ChevronRight size={16} /></button></> : <button className="link-row" onClick={() => { setNaming({ item: { ...menu, id: crypto.randomUUID() } }); setName(menu.name); setMenu(null); }}>Save to {light.simulator ? 'simulator' : 'device'} <Plus size={17} /></button>}{mode === 2 && state.mode === 2 && Boolean(state.parameters?.length) && (state.scriptName === `Luxio · ${menu.name}` || state.activeScriptId === menu.id) && <button className="link-row" onClick={() => { setMenu(null); setParameters(true); }}>Animation settings <SlidersHorizontal size={16} /></button>}</div></Modal>}
    {deleting && <Modal title={`Delete ${deleting.name}?`} close={() => setDeleting(null)}><div className="sheet-body"><p>This removes the saved {modes[deleting.mode].toLowerCase()} from {light.simulator ? 'your simulator' : 'this light'}.</p><button className="danger-button full" disabled={busy} onClick={async () => { setBusy(true); try { await send(light, { operation: [29, 22, 9][deleting.mode], colorId: deleting.id, gradientId: deleting.id, scriptId: deleting.id }); await loadLibrary(light); setDeleting(null); } catch (error) { notice(String(error)); } finally { setBusy(false); } }}>Delete</button></div></Modal>}
    {parameters && <Modal title={state.scriptName?.replace(/^Luxio · /, '') || 'Animation settings'} close={() => setParameters(false)}><div className="sheet-body parameter-controls">{(state.parameters ?? []).map(parameter => <label key={parameter.name} className={parameter.boolean || parameter.numberInput ? 'setting-row' : 'parameter-row'}><span>{parameter.name}</span>{parameter.boolean ? <input type="checkbox" checked={Boolean(parameter.value)} onChange={event => void updateParameter(parameter.name, event.target.checked ? 1 : 0)} /> : parameter.numberInput ? <input aria-label={parameter.name} type="number" min={parameter.minimum} max={parameter.maximum} defaultValue={parameter.value} key={`${parameter.name}-${parameter.value}`} onBlur={event => { const value = Number(event.target.value); if (event.target.value && value >= parameter.minimum && value <= parameter.maximum) void updateParameter(parameter.name, value); else notice(`${parameter.name} must be between ${parameter.minimum} and ${parameter.maximum}.`); }} /> : <><output>{parameter.value}</output><input aria-label={parameter.name} type="range" min={parameter.minimum} max={parameter.maximum} value={parameter.value} onChange={event => void updateParameter(parameter.name, Number(event.target.value))} /></>}</label>)}<button className="secondary-button full" onClick={() => void updateParameter('', 0, true)}>Reset to Defaults</button></div></Modal>}
  </div>;

  async function updateParameter(name: string, value: number, reset = false) {
    const values = (state.parameters ?? []).map(parameter => ({ ...parameter, value: reset ? parameter.defaultValue : parameter.name === name ? value : parameter.value }));
    try {
      await send(light, { operation: 32, scriptId: state.activeScriptId || undefined, script: state.activeScriptId ? undefined : { id: '', name: state.scriptName ?? '', source: '' }, parameters: values });
      const preset = builtins.find(item => state.scriptName === `Luxio · ${item.name}`);
      localStorage.setItem(`luxio-parameters-${light.simulator ? light.id : light.state.deviceId}-${preset?.id ?? state.activeScriptId}`, JSON.stringify(values));
    } catch (error) { notice(`Couldn’t change animation settings. ${String(error)}`); }
  }
}

