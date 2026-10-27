import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, CircleHelp, Lightbulb, LightbulbOff, LoaderCircle, Monitor, MoreHorizontal, Plus, RefreshCw, Search, SlidersHorizontal, Square, Wifi, X } from 'lucide-react';
import { addSimulator, colorCSS, connect, emptyColor, lights, loadLibrary, modes, paletteCSS, plural, refresh, send, snapshot, storageError, subscribe, type Item, type Light } from './model';
import { Backdrop, Brightness, ColorWheel, Modal, Power } from './Controls';
import { Settings } from './Settings';
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
  const [help, setHelp] = useState(false);
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
      await Promise.allSettled(lights.filter(light => !light.simulator).map(light => refresh(light)));
      const response = await fetch('https://api.luxio.lighting/devices', { signal: controller.signal });
      if (!response.ok) throw new Error('Discovery unavailable. Add Luxio by its IP address.');
      const found: unknown = await response.json();
      if (!Array.isArray(found)) throw new Error('Discovery returned an invalid device list.');
      await Promise.allSettled(found.filter(d => typeof d.lan_ip === 'string').map(d => connect(d.lan_ip)));
      if (userInitiated && selectedLight) await loadLibrary(selectedLight);
    } catch (error) { if (userInitiated) setNotice(error instanceof Error && error.name !== 'AbortError' ? error.message : 'Discovery timed out. Add Luxio by its IP address.'); }
    finally { clearTimeout(timeout); discoveringRef.current = false; setDiscovering(false); }
  }

  async function action(light: Light, request: Omit<Request, 'id'>) {
    try { await send(light, request); }
    catch (error) { setNotice(`Couldn’t update ${light.state.config.name}. ${error instanceof Error ? error.message : String(error)}`); }
  }

  return <div className={`app ${selectedLight ? 'has-selection' : ''}`}>
    <aside className="sidebar">
      <header className="brand-row"><button className="brand" onClick={() => { setSelected(''); history.pushState({}, '', location.pathname); }}>Luxio<span className="brand-dot" /></button><div className="row-actions"><button className="icon-button refresh-button" aria-label="Refresh devices" disabled={discovering} onClick={() => void discover(true)}><RefreshCw size={18} className={discovering ? 'spinning' : ''} /></button><button className="icon-button" aria-label="Add Device" onClick={() => setAdd(true)}><Plus size={23} /></button></div></header>
      <div className="sidebar-heading"><span>YOUR LIGHTS</span><span>{devices.length}</span></div>
      <div className="device-list">
        {devices.map(light => <article key={light.id} className={`device-card ${light.state.on ? 'powered' : ''} ${selected === light.id ? 'selected' : ''} ${light.online ? '' : 'offline'}`}>
          <Backdrop light={light} /><div className="device-card-content"><div className="device-card-row"><button className="device-open" onClick={() => open(light)} aria-label={`Open ${light.state.config.name}`}>{light.simulator ? <Monitor size={18} /> : <Wifi size={18} />}<span>{light.state.config.name}</span></button><Power on={light.state.on} change={on => void action(light, { operation: 15, on })} label={`${light.state.config.name} power`} disabled={!light.online} /></div>
          {light.state.on && <Brightness label={`${light.state.config.name} brightness`} value={light.state.brightness} change={brightness => void action(light, { operation: 2, brightness })} disabled={!light.online} />}
          {!light.online && <span className="offline-label">Offline · checking connection</span>}</div>
        </article>)}
        {!devices.length && <div className="empty-devices"><span className="empty-icon"><LightbulbOff size={30} /></span><h2>No Luxio Devices Found</h2><p>Connect Luxio to the same Wi-Fi network to get started.</p><button className="secondary-button" onClick={() => setAdd(true)}><Plus size={17} /> Add Luxio</button><button className="text-button simulator-link" onClick={() => open(addSimulator())}>Try the Simulator</button></div>}
      </div>
      <footer className="sidebar-footer"><span><span className={`status-dot ${discovering ? 'searching' : ''}`} />{discovering ? 'Finding Luxio devices…' : `${devices.filter(light => light.online).length} ${devices.filter(light => light.online).length === 1 ? 'light' : 'lights'} available`}</span><button className="icon-button" aria-label="About Luxio web" onClick={() => setHelp(true)}><CircleHelp size={17} /></button></footer>
    </aside>
    <main className="main">
      {selectedLight ? <>
        <Control key={selectedLight.id} light={selectedLight} back={() => { setSelected(''); history.pushState({}, '', location.pathname); }} settings={() => setSettings(true)} notice={setNotice} />
        {settings && <Settings light={selectedLight} close={() => setSettings(false)} removed={() => { setSettings(false); setSelected(''); history.replaceState({}, '', location.pathname); }} notice={setNotice} />}
      </> : <div className="welcome"><div className="welcome-art" aria-hidden="true"><span /><span /><span /><Lightbulb size={54} strokeWidth={1.3} /></div><h1>A little light.<br />A different atmosphere.</h1><p>{devices.length ? 'Choose a light to make it yours.' : 'Your colors, gradients, and animations.\nAll together, wherever you are.'}</p><button className="primary-button" onClick={() => devices.length ? open(devices[0]) : setAdd(true)}>{devices.length ? 'Control your lights' : 'Add Luxio'}<ChevronRight size={18} /></button>{!devices.length && <button className="text-button" onClick={() => open(addSimulator())}>Explore with the simulator <ArrowUpRight size={14} /></button>}</div>}
    </main>
    {add && <AddLuxio close={() => setAdd(false)} added={light => { setAdd(false); open(light); }} />}
    {help && <Modal title="Luxio for the web" close={() => setHelp(false)}><div className="sheet-body"><p>The same colors, gradients, and animations as Luxio for iOS, with room for all your lights.</p><h3>Connect to a light</h3><p>Keep your computer and Luxio on the same network. For HTTPS-to-local-device access, use current desktop or Android Chrome and allow local network access when prompted. Other browsers may block the connection.</p><p>Browser discovery uses the Luxio device directory. You can also connect by IP address. Native Bluetooth discovery is available in the iOS app.</p><h3>Try it anywhere</h3><p>The simulator runs in your browser. Your settings and saved library stay on this browser, with no account needed.</p><a className="link-row" href="https://luxio.lighting/" target="_blank" rel="noreferrer">Build your own Luxio <ArrowUpRight size={18} /></a><a className="link-row" href="https://studio.luxio.lighting/" target="_blank" rel="noreferrer">Create animations in Luxio Studio <ArrowUpRight size={18} /></a></div></Modal>}
    {(notice || storageError) && createPortal(<div className="toast" role="alert"><span>{notice || storageError}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={18} /></button></div>, toastTarget)}
  </div>;
}

function AddLuxio({ close, added }: { close: () => void; added: (light: Light) => void }) {
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Modal title="Add Luxio" close={() => { if (!busy) close(); }}><div className="sheet-body">
    <div className="add-guide"><Lightbulb size={42} /><h3>Create your own Luxio</h3><p>Turn an ESP32 and an LED strip into your own smart light. Our guide will help you get started.</p><a href="https://luxio.lighting/" target="_blank" rel="noreferrer" className="primary-button">View the Guide <ArrowUpRight size={17} /></a></div>
    <form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { added(await connect(address)); } catch (error) { setError(`Couldn’t connect. Check the address, network, and local network permission. ${error instanceof Error ? error.message : ''}`); } finally { setBusy(false); } }}>
      <label className="field-label" htmlFor="device-address">CONNECT BY IP ADDRESS</label><div className="group"><input id="device-address" autoComplete="off" spellCheck={false} placeholder="192.168.1.42" value={address} onChange={event => setAddress(event.target.value)} disabled={busy} required /><button className="link-row" disabled={!address.trim() || busy}>{busy ? <><LoaderCircle size={16} className="spinning" /> Connecting…</> : <>Connect <ChevronRight size={18} /></>}</button></div>
      <p className="field-note">Connect to the same Wi-Fi network. Use desktop or Android Chrome and allow local network access when prompted.</p>{error && <p role="alert" className="error">{error}</p>}
    </form><button className="text-button simulator-link" disabled={busy} onClick={() => added(addSimulator())}>Add a virtual device</button>
  </div></Modal>;
}

function Control({ light, back, settings, notice }: { light: Light; back: () => void; settings: () => void; notice: (value: string) => void }) {
  const state = light.state;
  const [mode, setMode] = useState(state.mode ?? 0);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [naming, setNaming] = useState<{ item: Item; rename?: boolean } | null>(null);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [parameters, setParameters] = useState(false);
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
    setBusy(true);
    try {
      if (saved) {
        await send(light, { operation: [30, 23, 10][item.mode], colorId: item.mode === 0 ? item.id : undefined, gradientId: item.mode === 1 ? item.id : undefined, scriptId: item.mode === 2 ? item.id : undefined });
        if (item.mode === 2) {
          let overrides;
          try { overrides = JSON.parse(localStorage.getItem(`luxio-parameters-${light.id}-${item.id}`) ?? '[]'); } catch { overrides = []; }
          if (overrides.length) await send(light, { operation: 32, scriptId: item.id, parameters: parseParameters(item.source!, overrides) });
        }
      }
      else if (item.mode === 0) await send(light, { operation: 1, color: item.colors[0] });
      else if (item.mode === 1) await send(light, { operation: 17, gradient: { id: crypto.randomUUID(), name: '', colors: item.colors } });
      else {
        let overrides;
        try { overrides = JSON.parse(localStorage.getItem(`luxio-parameters-${light.id}-${item.id}`) ?? '[]'); } catch { overrides = []; }
        const parameters = parseParameters(item.source!, overrides);
        await send(light, { operation: 31, script: { id: crypto.randomUUID(), name: `Luxio · ${item.name}`, source: item.source!, mode: 2, parameters } });
      }
      setDraftColors(null);
    } catch (error) { notice(`Couldn’t apply ${item.name}. ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
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
    <header className="control-header"><Backdrop light={light} /><div className="control-header-content"><div className="control-topbar"><button className="icon-button glass back-button" aria-label="Back" onClick={back}><ArrowLeft size={22} /></button><div className="device-title"><h1>{state.config.name}</h1><span>{light.simulator ? 'Virtual device' : light.online ? 'Connected via Wi-Fi' : 'Offline'}<span className="title-divider">·</span>{state.config.ledCount} LEDs</span></div><button className="icon-button glass" aria-label="Luxio settings" onClick={settings}><MoreHorizontal size={23} /></button><Power on={state.on} label="Power" disabled={!light.online} change={on => { void send(light, { operation: 15, on }).catch(error => notice(String(error))); }} /></div>
      <Brightness detailed value={state.brightness} change={brightness => { void send(light, { operation: 2, brightness }).catch(error => notice(String(error))); }} disabled={!light.online} />
      <div className="mode-picker" role="tablist" aria-label="Light mode">{modes.map((name, index) => index === 1 && state.config.ledCount <= 1 ? null : <button key={name} role="tab" id={`mode-${index}`} aria-controls="mode-content" aria-selected={mode === index} disabled={busy} onClick={() => { setMode(index); setSearch(''); setDraftColors(null); window.scrollTo({ top: 0 }); }}>{name}</button>)}</div>
    </div></header>
    {!light.online && <div className="connection-banner">This light is offline. Check its power and network, then refresh.<button onClick={() => void refresh(light).catch(error => notice(String(error)))}>Retry</button></div>}
    <div className={`control-content ${mode === 2 ? 'animation-layout' : ''}`} id="mode-content" role="tabpanel" aria-labelledby={`mode-${mode}`}>
      <div className="editor-column">
        {mode !== 2 ? <><ColorWheel key={`${mode}-${state.config.stripType}`} colors={colors} strip={state.config.stripType} gradient={mode === 1} change={next => { if (light.online) void editColors(next); }} /><div className="editor-summary"><span><span className="status-dot" />{busy ? 'Updating light…' : state.on ? 'Live on your light' : 'Light is off'}</span><button className="text-button" disabled={busy || !light.online} onClick={() => { setName(''); setNaming({ item: { id: crypto.randomUUID(), name: '', mode, colors } }); }}><Plus size={15} /> Save {modes[mode].toLowerCase()}</button></div></> : <div className="now-playing"><div className="now-playing-orb" style={{ background: paletteCSS(state.mode === 2 ? state.animationPreview ?? [] : [state.color]) }}><Backdrop light={light} /></div><p className="eyebrow">{state.mode === 2 ? 'NOW PLAYING' : 'MAKE IT MOVE'}</p><h2>{state.mode === 2 ? state.scriptName?.replace(/^Luxio · /, '') : 'Light in motion'}</h2><p>{state.mode === 2 ? 'A little atmosphere, on repeat.' : 'Choose an animation to bring your light to life.'}</p>{state.mode === 2 && <div className="playing-actions"><button className="secondary-button" disabled={busy} onClick={() => { void send(light, { operation: 11 }).catch(error => notice(String(error))); }}><Square size={14} /> Stop</button>{Boolean(state.parameters?.length) && <button className="secondary-button" onClick={() => setParameters(true)}><SlidersHorizontal size={16} /> Settings</button>}</div>}<a className="studio-link" href="https://studio.luxio.lighting/" target="_blank" rel="noreferrer">Create your own in Luxio Studio <ArrowUpRight size={14} /></a></div>}
      </div>
      <section className="library" aria-label="Preset library"><div className="section-heading"><h2>Presets</h2><span>{filtered.length}</span></div>
        <div className="preset-grid">{filtered.map(item => {
          const selected = state.mode === item.mode && (item.mode === 2 ? state.scriptName === `Luxio · ${item.name}` : JSON.stringify(activeColors) === JSON.stringify(item.colors));
          return <div className={`preset-card ${selected ? 'selected' : ''}`} key={item.id}>
            <button className="preset-main" aria-label={`${mode === 2 ? 'Play' : 'Apply'} ${item.name}`} aria-pressed={selected} disabled={busy || !light.online} onClick={() => void apply(item)} onContextMenu={event => { if (mode === 2) { event.preventDefault(); setMenu(item); } }}><span className="swatch" style={{ background: paletteCSS(item.colors) }}>{selected && <Check size={19} />}</span><span>{item.name}</span></button>
            {mode === 2 && <button className="preset-options" aria-label={`Options for ${item.name}`} onClick={() => setMenu(item)}><MoreHorizontal size={16} /></button>}
          </div>;
        })}</div>
        <div className="section-heading saved-heading"><h2>My {plural[mode]}</h2><div className="row-actions"><span>{saved.length}</span><button className="icon-button" aria-label="Refresh saved items" disabled={libraryLoading || busy} onClick={() => { setLibraryLoading(true); void loadLibrary(light).catch(error => notice(String(error))).finally(() => setLibraryLoading(false)); }}><RefreshCw size={15} className={libraryLoading ? 'spinning' : ''} /></button></div></div>
        {saved.length > 0 && <label className="search-field"><Search size={16} /><input placeholder={`Search my ${plural[mode].toLowerCase()}`} aria-label={`Search my ${plural[mode].toLowerCase()}`} value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</label>}
        <div className="preset-grid saved-grid">{saved.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).map(item => <div key={item.id} className={`preset-card ${[state.activeColorId, state.activeGradientId, state.activeScriptId].includes(item.id) ? 'selected' : ''}`}><button className="preset-main" disabled={busy || !light.online} aria-label={`Apply saved ${item.name}`} onClick={() => void apply(item, true)} onContextMenu={event => { event.preventDefault(); setMenu(item); }}><span className="swatch" style={{ background: paletteCSS(item.colors) }} /><span>{item.name}</span></button><button className="preset-options" aria-label={`Options for ${item.name}`} onClick={() => setMenu(item)}><MoreHorizontal size={16} /></button></div>)}
          {mode !== 2 && !search && <button className="preset-card save-card" disabled={busy || !light.online} onClick={() => { setName(''); setNaming({ item: { id: crypto.randomUUID(), name: '', mode, colors } }); }}><span className="swatch"><Plus size={24} /></span><span>Save</span></button>}
        </div>
        {search && !saved.some(item => item.name.toLowerCase().includes(search.toLowerCase())) && <p className="empty-library">No matching {plural[mode].toLowerCase()}.</p>}
        {mode === 2 && saved.length === 0 && <div className="empty-library"><p>No saved animations yet.</p><span>Open a preset’s menu to save it, or create your own in <a href="https://studio.luxio.lighting/" target="_blank" rel="noreferrer">Luxio Studio <ArrowUpRight size={12} /></a>.</span></div>}
      </section>
    </div>
    {naming && <Modal title={`${naming.rename ? 'Rename' : 'Save'} ${modes[naming.item.mode]}`} close={() => { if (!busy) setNaming(null); }}><form className="sheet-body" onSubmit={event => { event.preventDefault(); void save(); }}><label className="field-label" htmlFor="preset-name">NAME</label><input autoFocus id="preset-name" placeholder={`My ${modes[naming.item.mode].toLowerCase()}`} maxLength={63} required value={name} onChange={event => setName(event.target.value)} /><p className="field-note">Saved {light.simulator ? 'in this browser with your simulator' : 'on your Luxio device'}.</p><button className="primary-button full" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button></form></Modal>}
    {menu && <Modal title={menu.name} close={() => setMenu(null)}><div className="sheet-body menu-actions">{saved.some(item => item.id === menu.id) ? <><button className="link-row" onClick={() => { setNaming({ item: menu, rename: true }); setName(menu.name); setMenu(null); }}>Rename <ChevronRight size={16} /></button><button className="link-row danger" onClick={() => { setDeleting(menu); setMenu(null); }}>Delete <ChevronRight size={16} /></button></> : <button className="link-row" onClick={() => { setNaming({ item: { ...menu, id: crypto.randomUUID() } }); setName(menu.name); setMenu(null); }}>Save to {light.simulator ? 'simulator' : 'device'} <Plus size={17} /></button>}{mode === 2 && state.mode === 2 && Boolean(state.parameters?.length) && (state.scriptName === `Luxio · ${menu.name}` || state.activeScriptId === menu.id) && <button className="link-row" onClick={() => { setMenu(null); setParameters(true); }}>Animation settings <SlidersHorizontal size={16} /></button>}</div></Modal>}
    {deleting && <Modal title={`Delete ${deleting.name}?`} close={() => setDeleting(null)}><div className="sheet-body"><p>This removes the saved {modes[deleting.mode].toLowerCase()} from {light.simulator ? 'your simulator' : 'this light'}.</p><button className="danger-button full" disabled={busy} onClick={async () => { setBusy(true); try { await send(light, { operation: [29, 22, 9][deleting.mode], colorId: deleting.id, gradientId: deleting.id, scriptId: deleting.id }); await loadLibrary(light); setDeleting(null); } catch (error) { notice(String(error)); } finally { setBusy(false); } }}>Delete</button></div></Modal>}
    {parameters && <Modal title={state.scriptName?.replace(/^Luxio · /, '') || 'Animation settings'} close={() => setParameters(false)}><div className="sheet-body parameter-controls">{(state.parameters ?? []).map(parameter => <label key={parameter.name} className={parameter.boolean || parameter.numberInput ? 'setting-row' : 'parameter-row'}><span>{parameter.name}</span>{parameter.boolean ? <input type="checkbox" checked={Boolean(parameter.value)} onChange={event => void updateParameter(parameter.name, event.target.checked ? 1 : 0)} /> : parameter.numberInput ? <input aria-label={parameter.name} type="number" min={parameter.minimum} max={parameter.maximum} defaultValue={parameter.value} key={`${parameter.name}-${parameter.value}`} onBlur={event => { const value = Number(event.target.value); if (event.target.value && value >= parameter.minimum && value <= parameter.maximum) void updateParameter(parameter.name, value); else notice(`${parameter.name} must be between ${parameter.minimum} and ${parameter.maximum}.`); }} /> : <><output>{parameter.value}</output><input aria-label={parameter.name} type="range" min={parameter.minimum} max={parameter.maximum} value={parameter.value} onChange={event => void updateParameter(parameter.name, Number(event.target.value))} /></>}</label>)}<button className="secondary-button full" onClick={() => void updateParameter('', 0, true)}>Reset to Defaults</button><p className="field-note">Remembered for this light and animation in this browser.</p></div></Modal>}
  </div>;

  async function updateParameter(name: string, value: number, reset = false) {
    const values = (state.parameters ?? []).map(parameter => ({ ...parameter, value: reset ? parameter.defaultValue : parameter.name === name ? value : parameter.value }));
    try {
      await send(light, { operation: 32, scriptId: state.activeScriptId || undefined, script: state.activeScriptId ? undefined : { id: '', name: state.scriptName ?? '', source: '' }, parameters: values });
      const preset = builtins.find(item => state.scriptName === `Luxio · ${item.name}`);
      localStorage.setItem(`luxio-parameters-${light.id}-${preset?.id ?? state.activeScriptId}`, JSON.stringify(values));
    } catch (error) { notice(`Couldn’t change animation settings. ${String(error)}`); }
  }
}

