import { simulatorStripTypes } from '../shared/protocol/src/index';
import { useEffect, useRef, useState, type RefObject } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/basic-languages/lua/lua.contribution';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { Play, Square, Plus, ChevronDown, ChevronRight, FileCode2, Monitor, RefreshCw, Save, MoreHorizontal, PanelLeft, X, Check, LoaderCircle, Radio, ExternalLink } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from './components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from './components/ui/dropdown-menu';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from './components/ui/context-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/ui/collapsible';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './components/ui/resizable';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip';
import type { Color, Request } from '../shared/protocol/src/index';
import type { StudioConnection } from '../src/Studio';
import { parsePreview } from '../shared/protocol/src/preview';
import { parseParameters, type AnimationParameter } from '../shared/protocol/src/parameters';
import presets from '../src/presets.json';
import { starterSource } from './starter';
import './styles.css';

// randomUUID is restricted to secure contexts; keep HTTP development usable.
crypto.randomUUID ??= () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

(self as unknown as { MonacoEnvironment: object }).MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });
monaco.editor.defineTheme('luxio', {
  base: 'vs-dark', inherit: true,
  rules: [{ token: 'keyword', foreground: 'CB9EF3' }, { token: 'string', foreground: 'A7D99C' }, { token: 'number', foreground: 'E9BF80' }, { token: 'comment', foreground: '737373' }],
  colors: { 'editor.background': '#141414', 'editor.foreground': '#e5e5e5', 'editorLineNumber.foreground': '#737373', 'editorLineNumber.activeForeground': '#d4d4d4', 'editor.lineHighlightBackground': '#1f1f1f', 'editor.selectionBackground': '#ffffff26', 'editorCursor.foreground': '#fafafa', 'editorIndentGuide.background1': '#303030', 'editorWidget.background': '#262626' },
});

type Document = { id: string; name: string; source: string | null; mode: number; address?: string; scriptId?: string; savedName: string; savedSource: string | null; parameters?: AnimationParameter[]; savedParameters?: AnimationParameter[]; example?: boolean };
export default function StudioEditor({ connection, close, closeAction }: { connection: StudioConnection; close: () => void; closeAction: RefObject<(() => Promise<void>) | null> }) {
  const { target, item } = connection;
  const workspaceKey = `luxio-studio-workspace-${target}`;
  const nextId = useRef(1);
  const [launch] = useState(() => {
    let documents: Document[] = [];
    try {
      const stored = JSON.parse(localStorage.getItem(workspaceKey) ?? '[]');
      if (Array.isArray(stored) && stored.every(d => typeof d.id === 'string' && typeof d.name === 'string' && (typeof d.source === 'string' || d.source === null))) documents = stored;
    } catch { /* Keep the editor usable without browser storage. */ }
    let selected = item && documents.find(document => document.scriptId === item.id);
    if (!selected) {
      const source = item?.source ?? starterSource;
      selected = { id: crypto.randomUUID(), name: item?.name ?? 'Untitled', source, mode: 2, address: target, scriptId: item?.id, savedName: item?.name ?? '', savedSource: item?.source ?? '' };
      documents.push(selected);
    }
    return { documents, selected: selected.id };
  });
  async function requestDevice(address: string, request: Request) {
    if (address !== target) throw new Error('This animation belongs to a different Luxio.');
    return connection.request(request);
  }
  const [documents, setDocuments] = useState(launch.documents);
  const [examples, setExamples] = useState<Document[]>(() => presets.filter(preset => !preset.isGradient).map(preset => ({ id: `example-${preset.name}`, name: preset.name, source: preset.source, savedName: preset.name, savedSource: preset.source, mode: 2, example: true })));
  const [selected, setSelected] = useState(launch.selected);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [rename, setRename] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(() => window.innerWidth >= 720);
  const [simulatorOpen, setSimulatorOpen] = useState(true);
  const [count, setCount] = useState(60);
  const [stripType, setStripType] = useState('WS2805');
  const [supportedStripTypes, setSupportedStripTypes] = useState<string[]>(simulatorStripTypes);
  const [position, setPosition] = useState({ lineNumber: 1, column: 1 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pixels = useRef<Color[]>([]);
  const preview = useRef<{ address: string; id: string } | null>(null);
  const playback = useRef<{ documentId: string; source: string } | null>(null);
  const parameterUpdates = useRef<Promise<void>>(Promise.resolve());
  const cleanup = useRef<Promise<void> | null>(null);
  const actions = useRef({ save: () => {}, test: () => {} });
  const visible = documents.filter(d => target === 'simulator' ? !d.address : d.address === target);
  const current = examples.find(d => d.id === selected) ?? visible.find(d => d.id === selected) ?? visible[0];
  const dirty = current && !current.example && (current.name !== current.savedName || current.source !== current.savedSource || JSON.stringify(current.parameters ?? []) !== JSON.stringify(current.savedParameters ?? []));
  let parameters: AnimationParameter[] = [], parameterError = '';
  try { parsePreview(current?.source ?? ''); parameters = parseParameters(current?.source ?? '', current?.parameters ?? []); }
  catch (error) { parameterError = String(error); }

  useEffect(() => {
    try { localStorage.setItem(workspaceKey, JSON.stringify(documents)); }
    catch { setMessage('Browser storage is full. Download your animations to keep a copy.'); }
  }, [documents]);

  useEffect(() => {
    return () => { worker.current?.terminate(); clearTimeout(watchdog.current); };
  }, []);
  useEffect(() => {
    closeAction.current = async () => {
      if (busy) return;
      setBusy(true);
      try { await stop(); close(); }
      catch (error) { setMessage(`Could not stop the test animation. ${String(error)}`); setBusy(false); }
    };
    return () => { closeAction.current = null; };
  });

  useEffect(() => {
    if (target === 'simulator') return;
    let cancelled = false;
    setLoading(true);
    Promise.all([requestDevice(target, { id: nextId.current++, operation: 0 }), requestDevice(target, { id: nextId.current++, operation: 5 })]).then(([status, list]) => {
      if (cancelled) return;
      if (status.state) { setCount(status.state.config.ledCount); setStripType(status.state.config.stripType); setSupportedStripTypes(status.state.supportedStripTypes?.length ? status.state.supportedStripTypes : [status.state.config.stripType]); }
      setDocuments(previous => {
        const merged = previous.filter(d => d.address !== target || !d.scriptId || list.scripts.some(script => script.id === d.scriptId));
        // Keep edits to animations removed on the device as local simulator drafts.
        for (const doc of previous) {
          if (doc.address === target && doc.scriptId && !list.scripts.some(script => script.id === doc.scriptId)
            && (doc.name !== doc.savedName || doc.source !== doc.savedSource || JSON.stringify(doc.parameters ?? []) !== JSON.stringify(doc.savedParameters ?? []))) {
            merged.push({ ...doc, address: undefined, scriptId: undefined });
          }
        }
        for (const script of list.scripts) {
          const index = merged.findIndex(d => d.address === target && d.scriptId === script.id);
          const found = merged[index];
          if (!found) merged.push({ id: crypto.randomUUID(), address: target, scriptId: script.id, name: script.name, source: null, mode: 2, savedName: script.name, savedSource: null });
          else if (found.name === found.savedName && found.source === found.savedSource && JSON.stringify(found.parameters ?? []) === JSON.stringify(found.savedParameters ?? [])) {
            merged[index] = { ...found, name: script.name, savedName: script.name, source: null, savedSource: null };
          }
        }
        return merged;
      });
      setNotice('');
    }).catch(error => { if (!cancelled) setMessage(String(error)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; setLoading(false); };
  }, [target]);

  useEffect(() => {
    if (!current?.address || !current.scriptId || current.source !== null) return;
    let cancelled = false;
    requestDevice(current.address, { id: nextId.current++, operation: 6, scriptId: current.scriptId }).then(result => {
      if (!result.script) throw new Error('Device did not return the animation');
      if (!cancelled) setDocuments(previous => previous.map(d => d.id === current.id ? { ...d, source: result.script!.source, savedSource: result.script!.source, parameters: result.script!.parameters ?? [], savedParameters: result.script!.parameters ?? [] } : d));
    }).catch(error => { if (!cancelled) setMessage(String(error)); });
    return () => { cancelled = true; };
  }, [current?.id, current?.source]);

  useEffect(() => {
    if (!canvas.current || !simulatorOpen) return;
    const element = canvas.current;
    let frame: number;
    const draw = () => {
      const bounds = element.getBoundingClientRect();
      const scale = devicePixelRatio;
      if (element.width !== Math.round(bounds.width * scale) || element.height !== Math.round(bounds.height * scale)) { element.width = bounds.width * scale; element.height = bounds.height * scale; }
      const ctx = element.getContext('2d')!;
      ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, bounds.width, bounds.height);
      const cell = (bounds.width - 40) / count;
      const y = bounds.height / 2;
      ctx.fillStyle = '#303030'; ctx.fillRect(18, y - 6, bounds.width - 36, 12);
      for (let i = 0; i < count; i++) {
        const pixel = pixels.current[i];
        const level = 1;
        const r = pixel ? Math.min(255, pixel.red + pixel.white + pixel.warmWhite + pixel.coolWhite * .8) * level : 54;
        const g = pixel ? Math.min(255, pixel.green + pixel.white + pixel.warmWhite * .73 + pixel.coolWhite * .9) * level : 54;
        const b = pixel ? Math.min(255, pixel.blue + pixel.white + pixel.warmWhite * .4 + pixel.coolWhite) * level : 54;
        ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = pixel ? 16 : 0;
        ctx.fillRect(20 + i * cell, y - 3, Math.max(.5, cell - 2), 6);
      }
      ctx.shadowBlur = 0; frame = requestAnimationFrame(draw);
    };
    draw(); return () => cancelAnimationFrame(frame);
  }, [count, simulatorOpen]);

  async function changeParameter(parameter: AnimationParameter, value: number) {
    if (!current) return;
    const values = parameters.map(p => p.name === parameter.name ? { ...p, value } : p);
    if (current.example) setExamples(previous => previous.map(d => d.id === current.id ? { ...d, parameters: values } : d));
    else setDocuments(previous => previous.map(d => d.id === current.id ? { ...d, parameters: values } : d));
    setNotice('');
    if (running && playback.current?.documentId === current.id && playback.current.source === current.source) {
      worker.current?.postMessage({ parameters: values });
      const active = preview.current;
      if (active) {
        parameterUpdates.current = parameterUpdates.current.then(async () => {
          if (preview.current !== active) return;
          await requestDevice(active.address, { id: nextId.current++, operation: 32, script: { id: '', name: active.id, source: '' }, parameters: values });
        }).catch(error => setMessage(String(error)));
        await parameterUpdates.current;
      }
    }
  }

  async function stop() {
    worker.current?.terminate(); worker.current = null; clearTimeout(watchdog.current); setRunning(false); playback.current = null;
    await parameterUpdates.current;
    if (cleanup.current) { await cleanup.current; return; }
    if (preview.current) {
      const active = preview.current;
      const pending = (async () => {
        await requestDevice(active.address, { id: nextId.current++, operation: 11, script: { id: '', name: active.id, source: '' } });
        if (preview.current === active) {
          preview.current = null;
          
        }
      })();
      cleanup.current = pending;
      try { await pending; }
      finally { if (cleanup.current === pending) cleanup.current = null; }
    }
  }

  async function test() {
    if (busy) return;
    setMessage(''); setNotice(''); setBusy(true);
    try {
      const wasRunning = running;
      await stop();
      if (wasRunning) return;
      if (!current?.source) throw new Error('Select an animation to test.');
      const source = current.example ? current.source : monaco.editor.getModel(monaco.Uri.parse(`${current.id}.lua`))?.getValue() ?? current.source;
      parsePreview(source);
      const values = parseParameters(source, current.parameters ?? []);
      if (target !== 'simulator' && !current.example) {
        if (values.length) {
          const requiredBuild = /^\s*-- @parameter [^,]+,\s*(Slider|Checkbox)\s*,/m.test(source) ? 21 : 14;
          if (((await requestDevice(target, { id: nextId.current++, operation: 0 })).state?.build ?? 0) < requiredBuild) throw new Error(`These animation parameters require firmware build ${requiredBuild} or newer.`);
        }
        const name = `Studio preview ${crypto.randomUUID()}`;
        await requestDevice(target, { id: nextId.current++, operation: 31, script: { id: '', name, source, mode: 2, parameters: values } });
        preview.current = { address: target, id: name };
        
      }
      worker.current = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      const fail = (error: string) => { void stop().catch(e => setMessage(`${error}. ${String(e)}`)); setMessage(error); };
      watchdog.current = setTimeout(() => fail('Animation stopped responding.'), 5000);
      worker.current.onmessage = event => {
        clearTimeout(watchdog.current);
        if (event.data.error) { fail(event.data.error); return; }
        watchdog.current = setTimeout(() => fail('Animation stopped responding.'), 5000);
        if (event.data.pixels) pixels.current = event.data.pixels;
      };
      worker.current.onerror = event => fail(event.message);
      worker.current.postMessage({ source, count, stripType, mode: 2, parameters: values });
      playback.current = { documentId: current.id, source };
      setRunning(true);
    } catch (error) { setMessage(String(error)); await stop().catch(() => {}); }
    finally { setBusy(false); }
  }

  async function save(doc = current) {
    if (busy || !doc || doc.example) return;
    setBusy(true); setMessage(''); setNotice('');
    try {
      const name = doc.name.trim();
      let savedValues = doc.parameters ?? [];
      let source = doc.source === null ? null : monaco.editor.getModel(monaco.Uri.parse(`${doc.id}.lua`))?.getValue() ?? doc.source;
      if (!name || new TextEncoder().encode(name).length > 63) throw new Error('Use a name of 1–63 bytes.');
      if (source === null && doc.address && doc.scriptId) {
        const result = await requestDevice(doc.address, { id: nextId.current++, operation: 6, scriptId: doc.scriptId });
        if (!result.script) throw new Error('Device did not return the animation');
        source = result.script.source; savedValues = result.script.parameters ?? [];
      }
      if (!source || new TextEncoder().encode(source).length > 16384) throw new Error('Animations must contain 1–16,384 bytes.');
      parsePreview(source);
      const values = parseParameters(source, savedValues);
      let scriptId = doc.scriptId;
      if (target !== 'simulator') {
        if (values.length) {
          const requiredBuild = /^\s*-- @parameter [^,]+,\s*(Slider|Checkbox)\s*,/m.test(source) ? 21 : 14;
          if (((await requestDevice(target, { id: nextId.current++, operation: 0 })).state?.build ?? 0) < requiredBuild) throw new Error(`These animation parameters require firmware build ${requiredBuild} or newer.`);
        }
        const existing = doc.address === target ? doc.scriptId : undefined;
        const result = await requestDevice(target, { id: nextId.current++, operation: existing ? 8 : 7, script: { id: existing ?? crypto.randomUUID(), name, source, mode: 2, parameters: values } });
        if (!result.script?.id) throw new Error('Device did not return an animation ID');
        scriptId = result.script.id;
      } else localStorage.setItem(workspaceKey, JSON.stringify(documents.map(d => d.id === doc.id ? { ...d, name, source, savedName: name, savedSource: source, parameters: values, savedParameters: values } : d)));
      setDocuments(previous => previous.map(d => d.id === doc.id ? { ...d, name, source, savedName: name, savedSource: source, parameters: values, savedParameters: values, ...(target !== 'simulator' ? { address: target, scriptId } : {}) } : d));
      setNotice(target === 'simulator' ? 'Saved in this browser' : 'Saved to device');
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }
  actions.current = { save: () => void save(), test: () => void test() };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === 's' || event.key === 'Enter')) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Enter') actions.current.test(); else actions.current.save();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return <TooltipProvider delayDuration={400}><div className="studio">
    <header className="toolbar">
      <div className="toolbar-controls">
        <a className="documentation-link" href="/docs.html" target="_blank" rel="noopener noreferrer" aria-label="Documentation" title="Documentation"><span>Documentation</span><ExternalLink aria-hidden="true" /></a>
        <Button variant="secondary" size="lg" disabled={busy || loading || (!running && !current?.source)} onClick={() => void test()} aria-label={running ? 'Stop test' : current?.example ? 'Simulate' : 'Test'} className={`studio-action ${running ? 'test-active' : ''}`}>{running ? <Square className="fill-current" /> : <Play className="fill-current" />}<span>{running ? 'Stop' : current?.example ? 'Simulate' : 'Test'}</span></Button>
        <Button size="lg" className="studio-action" disabled={busy || !current?.source || !dirty} onClick={() => void save()}><Save />Save</Button>
        <Button variant="ghost" size="icon-sm" aria-label="Close Studio" disabled={busy} onClick={() => void closeAction.current?.()}><X /></Button>
      </div>
    </header>
    <main className="workspace"><ResizablePanelGroup orientation="horizontal">
      {sidebar && <><ResizablePanel defaultSize="230px" minSize="170px" maxSize="360px"><aside className="sidebar">
        <div className="pane-heading"><span>Animations</span><Button variant="ghost" size="icon-xs" className="close-files" aria-label="Hide animations" onClick={() => setSidebar(false)}><X /></Button><Button variant="ghost" size="icon-xs" aria-label="New animation" disabled={busy} onClick={() => {
          const id = crypto.randomUUID(); const name = 'Untitled';
          setDocuments(previous => [...previous, { id, name, address: target === 'simulator' ? undefined : target, source: starterSource, mode: 2, savedName: '', savedSource: '' }]); setSelected(id); setRename(id);
        }}><Plus /></Button></div>
        <div className="file-sections"><div className="file-list" aria-label="Animations">
          {visible.map(doc => <ContextMenu key={doc.id} onOpenChange={open => { if (open) setSelected(doc.id); }}><ContextMenuTrigger asChild disabled={busy}><div className={`file-row ${current?.id === doc.id ? 'selected' : ''}`}>
            <button className="file-select" aria-label={`Open ${doc.name}.lua`} disabled={busy} onClick={() => { setSelected(doc.id); setMessage(''); setNotice(''); }} onDoubleClick={() => setRename(doc.id)}><FileCode2 /><span className="file-title">{rename === doc.id ? <input autoFocus disabled={busy} aria-label="Animation name" defaultValue={doc.name} onClick={e => e.stopPropagation()} onFocus={e => e.target.select()} onBlur={e => {
              const name = e.currentTarget.value.trim(); setRename(null);
              if (name === doc.name) return;
              setDocuments(previous => previous.map(d => d.id === doc.id ? { ...d, name } : d));
              void save({ ...doc, name });
            }} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); if (e.key === 'Escape') e.currentTarget.value = doc.name; e.currentTarget.blur(); } e.stopPropagation(); }} /> : <span>{doc.name}</span>}<small>.lua</small></span>{(doc.name !== doc.savedName || doc.source !== doc.savedSource || JSON.stringify(doc.parameters ?? []) !== JSON.stringify(doc.savedParameters ?? [])) && <span className="dirty-dot" aria-label="Unsaved changes" />}</button>
            <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="file-menu" aria-label={`Actions for ${doc.name}`} disabled={busy}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="start" onCloseAutoFocus={event => { if (rename) event.preventDefault(); }}>
              <DropdownMenuItem onSelect={() => { setSelected(doc.id); setRename(doc.id); }}>Rename</DropdownMenuItem>
              <DropdownMenuItem disabled={doc.source === null} onSelect={() => { const id = crypto.randomUUID(); setDocuments(previous => [...previous, { ...doc, id, name: `${doc.name} copy`, address: target === 'simulator' ? undefined : target, scriptId: undefined, savedName: '', savedSource: '' }]); setSelected(id); }}>Duplicate</DropdownMenuItem>
              <DropdownMenuItem disabled={doc.source === null} onSelect={() => { const url = URL.createObjectURL(new Blob([doc.source!], { type: 'text/plain' })); const link = document.createElement('a'); link.href = url; link.download = `${doc.name.replace(/[/\\]/g, '-') || 'animation'}.lua`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download .lua</DropdownMenuItem>
              <DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => setDeleteId(doc.id)}>Delete</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu>
          </div></ContextMenuTrigger><ContextMenuContent onCloseAutoFocus={event => { if (rename) event.preventDefault(); }}>
            <ContextMenuItem disabled={busy} onSelect={() => { setSelected(doc.id); setRename(doc.id); }}>Rename</ContextMenuItem>
            <ContextMenuItem disabled={busy || doc.source === null} onSelect={() => { const id = crypto.randomUUID(); setDocuments(previous => [...previous, { ...doc, id, name: `${doc.name} copy`, address: target === 'simulator' ? undefined : target, scriptId: undefined, savedName: '', savedSource: '' }]); setSelected(id); }}>Duplicate</ContextMenuItem>
            <ContextMenuItem disabled={busy || doc.source === null} onSelect={() => { const url = URL.createObjectURL(new Blob([doc.source!], { type: 'text/plain' })); const link = document.createElement('a'); link.href = url; link.download = `${doc.name.replace(/[/\\]/g, '-') || 'animation'}.lua`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download .lua</ContextMenuItem>
            <ContextMenuSeparator /><ContextMenuItem variant="destructive" disabled={busy} onSelect={() => setDeleteId(doc.id)}>Delete</ContextMenuItem>
          </ContextMenuContent></ContextMenu>)}
          {loading && <div className="sidebar-status"><LoaderCircle className="animate-spin" />Loading animations…</div>}
        </div>
        <div className="pane-heading examples-heading"><span>Examples</span><span>Read-only</span></div>
        <div className="file-list" aria-label="Examples">
          {examples.map(doc => <div key={doc.id} className={`file-row ${current?.id === doc.id ? 'selected' : ''}`}>
            <button className="file-select" aria-label={`Open example ${doc.name}.lua`} disabled={busy} onClick={() => { setSelected(doc.id); setRename(null); setMessage(''); setNotice(''); }}><FileCode2 /><span className="file-title"><span>{doc.name}</span><small>.lua</small></span></button>
          </div>)}
        </div></div>
      </aside></ResizablePanel><ResizableHandle /></>}
      <ResizablePanel minSize="250px"><section className="editor-pane">
        <div className="editor-tabs"><Button variant="ghost" size="icon-xs" aria-label="Toggle sidebar" onClick={() => setSidebar(!sidebar)}><PanelLeft /></Button>{current && <div className="editor-tab"><FileCode2 /><span className="animation-title-field" data-name={current.name || " "}><input className="animation-title" aria-label="Animation name" value={current.name} readOnly={current.example} disabled={busy} onChange={event => setDocuments(previous => previous.map(document => document.id === current.id ? { ...document, name: event.target.value } : document))} /></span><span className="extension">.lua</span>{dirty && <span className="dirty-dot" />}</div>}</div>
        <div className="editor-container">{current ? <Editor path={`${current.id}.lua`} value={current.source ?? ''} language="lua" theme="luxio" loading={<span className="editor-empty">Loading editor…</span>} onMount={editor => {
          editor.onDidChangeCursorPosition(event => setPosition(event.position));
          editor.onDidChangeModelContent(() => {
            const model = editor.getModel(); if (!model) return;
            const id = model.uri.path.replace(/^\//, '').replace(/\.lua$/, ''); const source = model.getValue();
            setDocuments(previous => previous.map(d => d.id === id && d.source !== null && d.source !== source ? { ...d, source } : d));
          });
        }} options={{ readOnly: busy || !!current.example || current.source === null, fontSize: 13, fontFamily: '"SF Mono", Menlo, Monaco, monospace', lineHeight: 23, minimap: { enabled: false }, padding: { top: 18 }, scrollBeyondLastLine: false, smoothScrolling: true, tabSize: 2, automaticLayout: true, renderLineHighlight: 'all', overviewRulerLanes: 0, hideCursorInOverviewRuler: true, scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 }, fixedOverflowWidgets: true }} /> : <div className="editor-empty"><FileCode2 /><p>Select an animation or create a new one.</p></div>}</div>
        {message && <div className="error-message" role="alert"><span>{message}</span><Button variant="ghost" size="icon-xs" aria-label="Dismiss error" onClick={() => setMessage('')}><X /></Button></div>}
        {(parameters.length > 0 || parameterError) && <section className="parameter-panel" aria-label="Animation parameters">
        <div className="parameter-heading"><span>Parameters</span>{current?.parameters?.length ? <Button variant="ghost" size="xs" disabled={busy || running} onClick={() => {
          if (current.example) setExamples(previous => previous.map(d => d.id === current.id ? { ...d, parameters: [] } : d));
          else setDocuments(previous => previous.map(d => d.id === current.id ? { ...d, parameters: [] } : d));
        }}>Reset values</Button> : null}</div>
        {parameterError ? <p className="parameter-error" role="alert">{parameterError}</p> : parameters.map(parameter => <label className="parameter-control" key={parameter.name}>
          <span>{parameter.name}</span>
          {parameter.boolean ? <input type="checkbox" checked={parameter.value !== 0} disabled={busy || (running && playback.current?.source !== current?.source)} onChange={event => void changeParameter(parameter, event.target.checked ? 1 : 0)} />  : parameter.numberInput ? <Input key={`${current?.id}-${parameter.name}-${parameter.value}`} type="number" min={parameter.minimum} max={parameter.maximum} step="any" defaultValue={parameter.value} disabled={busy || (running && playback.current?.source !== current?.source)} onBlur={event => {
            const value = event.currentTarget.valueAsNumber;
            if (!Number.isFinite(value) || value < parameter.minimum || value > parameter.maximum) {
              event.currentTarget.value = String(parameter.value); setMessage(`${parameter.name} must be between ${parameter.minimum} and ${parameter.maximum}.`); return;
            }
            if (value !== parameter.value) void changeParameter(parameter, value);
          }} onKeyDown={event => { if (event.key === 'Enter' || event.key === 'Escape') { if (event.key === 'Escape') event.currentTarget.value = String(parameter.value); event.currentTarget.blur(); } }} /> : <><input type="range" min={parameter.minimum} max={parameter.maximum} step="any" value={parameter.value} disabled={busy || (running && playback.current?.source !== current?.source)} onChange={event => void changeParameter(parameter, Number(event.target.value))} /><output>{Number(parameter.value.toFixed(2))}</output></>}
        </label>)}
      </section>}
      <Collapsible open={simulatorOpen} onOpenChange={setSimulatorOpen} className="simulator">
          <div className="simulator-heading"><CollapsibleTrigger asChild><Button variant="ghost" size="sm" aria-label={simulatorOpen ? 'Collapse simulator' : 'Expand simulator'}>{simulatorOpen ? <ChevronDown /> : <ChevronRight />}<Monitor />Simulator</Button></CollapsibleTrigger><span className={`simulation-state ${running ? 'running' : ''}`}><span />{running ? 'Running' : 'Stopped'}</span></div>
          <CollapsibleContent><div className="simulation-settings">
            <Select value={stripType} disabled={running || target !== 'simulator'} onValueChange={setStripType}><SelectTrigger aria-label="Strip type"><SelectValue /></SelectTrigger><SelectContent>{(target === 'simulator' ? simulatorStripTypes : supportedStripTypes).map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select>
            <label className="count-control"><Input aria-label="LED count" type="number" min={1} max={1024} value={count} disabled={running || target !== 'simulator'} onChange={e => setCount(Math.min(1024, Math.max(1, Number(e.target.value) || 1)))} /><span>LEDs</span></label>
          </div><canvas ref={canvas} className="strip-canvas" aria-label="Simulated LED strip" /></CollapsibleContent>
        </Collapsible>
        <footer className="statusbar"><span role="status">{busy ? <><LoaderCircle className="animate-spin" />Working…</> : notice ? <><Check />{notice}</> : null}</span><span>Ln {position.lineNumber}, Col {position.column}<span className="status-separator">UTF-8</span><span>Lua</span></span></footer>
      </section></ResizablePanel>
    </ResizablePanelGroup></main>
    <Dialog open={!!deleteId} onOpenChange={open => { if (!open && !busy) setDeleteId(null); }}><DialogContent><DialogHeader><DialogTitle>Delete {documents.find(d => d.id === deleteId)?.name}.lua?</DialogTitle><DialogDescription>{documents.find(d => d.id === deleteId)?.address ? 'This removes the saved animation from the device.' : 'This removes the animation from this browser.'}</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setDeleteId(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={async () => {
      const doc = documents.find(d => d.id === deleteId); if (!doc) return; setBusy(true);
      try { if (doc.address && doc.scriptId) await requestDevice(doc.address, { id: nextId.current++, operation: 9, scriptId: doc.scriptId }); setDocuments(previous => previous.filter(d => d.id !== doc.id)); if (selected === doc.id) setSelected(visible.find(d => d.id !== doc.id)?.id ?? ''); setDeleteId(null); }
      catch (error) { setMessage(String(error)); setDeleteId(null); } finally { setBusy(false); }
    }}>Delete</Button></DialogFooter></DialogContent></Dialog>
  </div></TooltipProvider>;
}
