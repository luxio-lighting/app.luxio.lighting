import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Minus, Plus, Sun, X } from 'lucide-react';
import { colorCSS, emptyColor, paletteCSS, type Light } from './model';
import type { Color } from '../shared/protocol/src/index';

export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} aria-label={title} className="sheet" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
    <div className="sheet-inner"><header className="sheet-header"><h2>{title}</h2><button className="icon-button" aria-label="Close" onClick={close}><X size={20} /></button></header>{children}</div>
  </dialog>;
}

export function Power({ on, change, label, disabled }: { on: boolean; change: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={on} className={`power ${on ? 'on' : ''}`} disabled={disabled} onClick={() => change(!on)}><span /></button>;
}

export function Brightness({ value, change, label = 'Brightness', disabled = false, detailed = false }: { value: number; change: (value: number) => void; label?: string; disabled?: boolean; detailed?: boolean }) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(value); }, [value]);
  return <div className={`brightness ${detailed ? 'detailed' : ''}`}>
    {detailed && <div className="brightness-label"><span><Sun size={15} /> Brightness</span><span>{Math.round(draft / 256 * 100)}%</span></div>}
    <input type="range" min="1" max="256" value={draft} disabled={disabled} aria-label={label} aria-valuetext={`${Math.round(draft / 256 * 100)} percent`}
      style={{ '--progress': `${(draft - 1) / 255 * 100}%` } as React.CSSProperties}
      onPointerDown={() => { editing.current = true; }} onChange={event => setDraft(Number(event.target.value))}
      onPointerUp={event => { editing.current = false; change(Number(event.currentTarget.value)); }}
      onPointerCancel={() => { editing.current = false; setDraft(value); }}
      onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) change(Number(event.currentTarget.value)); }} />
  </div>;
}

export function Backdrop({ light }: { light: Light }) {
  const element = useRef<HTMLDivElement>(null);
  const worker = useRef<Worker | null>(null);
  const state = light.state;
  const palette = state.mode === 2 ? state.animationPreview ?? [] : state.mode === 1 ? state.gradient?.colors ?? [] : [state.color];
  const rendered = useRef<number[][]>([]);
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(!document.hidden);
  const [reduced, setReduced] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting));
    if (element.current) observer.observe(element.current);
    const visibility = () => setActive(!document.hidden);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(media.matches);
    document.addEventListener('visibilitychange', visibility); media.addEventListener('change', motion);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', motion); };
  }, []);
  useEffect(() => {
    let target: number[][] = [], frame = 0;
    const started = performance.now();
    const from = rendered.current;
    // Interpolate equal-size opaque palettes, including single colors and power off.
    const paint = (now: number) => {
      frame = 0;
      const progress = reduced || !active || !visible || !from.length ? 1 : Math.min(1, (now - started) / 400);
      const eased = progress * progress * (3 - 2 * progress);
      rendered.current = target.map((color, i) => color.map((value, channel) => (from[i]?.[channel] ?? value) * (1 - eased) + value * eased));
      if (element.current) element.current.style.background = `linear-gradient(110deg, ${rendered.current.map(rgb => `rgb(${rgb.join(',')})`).join(',')})`;
      if (progress < 1) frame = requestAnimationFrame(paint);
    };
    const update = (colors: Color[]) => {
      const rgb = (colors.length ? colors : [{ ...emptyColor, red: 38, green: 38, blue: 38 }]).map(c => [Math.min(255, c.red + c.white + c.warmWhite + c.coolWhite * .8), Math.min(255, c.green + c.white + c.warmWhite * .73 + c.coolWhite * .9), Math.min(255, c.blue + c.white + c.warmWhite * .4 + c.coolWhite)]);
      target = Array.from({ length: 65 }, (_, index) => {
        const position = index / 64 * (rgb.length - 1), low = Math.floor(position), high = Math.min(rgb.length - 1, low + 1);
        return rgb[low].map((value, channel) => value + (rgb[high][channel] - value) * (position - low));
      });
      if (!frame) frame = requestAnimationFrame(paint);
    };
    update(state.on ? palette : []);
    let runtime: Worker | null = null, watchdog: ReturnType<typeof setInterval> | undefined;
    if (state.on && state.mode === 2 && light.source && active && visible && !reduced) {
      runtime = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
      worker.current = runtime;
      let lastFrame = performance.now();
      watchdog = setInterval(() => { if (performance.now() - lastFrame > 2500) { runtime?.terminate(); clearInterval(watchdog); update(palette); } }, 1000);
      runtime.onmessage = event => {
        lastFrame = performance.now();
        if (event.data.error) { runtime?.terminate(); clearInterval(watchdog); update(palette); }
        if (event.data.pixels) update(event.data.pixels as Color[]);
      };
      runtime.onerror = () => { runtime?.terminate(); clearInterval(watchdog); update(palette); };
      runtime.postMessage({ source: light.source, count: state.config.ledCount, stripType: state.config.stripType, parameters: state.parameters });
    }
    return () => { cancelAnimationFrame(frame); runtime?.terminate(); clearInterval(watchdog); worker.current = null; };
  }, [light.source, state.mode, state.on, state.animationRevision, state.config.ledCount, state.config.stripType, active, visible, reduced, JSON.stringify(palette)]);
  useEffect(() => { worker.current?.postMessage({ parameters: state.parameters ?? [] }); }, [JSON.stringify(state.parameters)]);
  return <div className="light-backdrop" ref={element} aria-hidden="true" />;
}

export function ColorWheel({ colors, change, strip, gradient }: { colors: Color[]; change: (colors: Color[]) => void; strip: string; gradient: boolean }) {
  const [points, setPoints] = useState(colors);
  const [selected, setSelected] = useState(0);
  const [white, setWhite] = useState(Boolean(colors[0]?.white || colors[0]?.warmWhite || colors[0]?.coolWhite));
  const wheel = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const latest = useRef(points);
  useEffect(() => {
    if (dragging.current) return;
    setPoints(colors); latest.current = colors;
    setSelected(index => Math.min(index, colors.length - 1));
    const current = colors[Math.min(selected, colors.length - 1)];
    setWhite(Boolean(current?.white || current?.warmWhite || current?.coolWhite));
  }, [JSON.stringify(colors)]);
  const current = points[selected] ?? points[0] ?? emptyColor;
  const max = Math.max(current.red, current.green, current.blue), min = Math.min(current.red, current.green, current.blue), delta = max - min;
  let hue = delta === 0 ? 0 : max === current.red ? ((current.green - current.blue) / delta / 6 + 1) % 1 : max === current.green ? ((current.blue - current.red) / delta + 2) / 6 : ((current.red - current.green) / delta + 4) / 6;
  const saturation = max === 0 ? 0 : delta / max;
  const temperature = current.coolWhite / (current.coolWhite + current.warmWhite || 1);

  function move(x: number, y: number, commit = false) {
    let color: Color;
    if (white && strip !== 'WS2812') {
      const cool = Math.round(Math.min(1, Math.max(0, (y + 1) / 2)) * 255);
      color = strip === 'WS2805' ? { ...emptyColor, warmWhite: 255 - cool, coolWhite: cool } : { ...emptyColor, white: 255 };
    } else {
      const h = ((Math.atan2(y, x) / (2 * Math.PI) + 1 + 1 / 3) % 1) * 6;
      const s = Math.min(1, Math.hypot(x, y));
      const low = 1 - s, down = 1 - (h - Math.floor(h)) * s, up = 1 - (1 - (h - Math.floor(h))) * s;
      const rgb = [[1, up, low], [down, 1, low], [low, 1, up], [low, down, 1], [up, low, 1], [1, low, down]][Math.floor(h) % 6];
      color = { ...emptyColor, red: Math.round(rgb[0] * 255), green: Math.round(rgb[1] * 255), blue: Math.round(rgb[2] * 255) };
    }
    const next = latest.current.map((point, index) => index === selected ? color : point);
    latest.current = next; setPoints(next); if (commit) change(next);
  }

  return <section className="color-editor" aria-label={gradient ? 'Gradient editor' : 'Color editor'}>
    <div className={`color-wheel ${white ? strip === 'WS2805' ? 'temperature' : 'neutral' : ''}`} ref={wheel}
      role="slider" tabIndex={0} aria-label={white ? 'White temperature' : 'Color wheel'} aria-valuemin={0} aria-valuemax={white ? 100 : 360}
      aria-valuenow={Math.round(white ? temperature * 100 : hue * 360)} aria-valuetext={white ? `White temperature ${Math.round(temperature * 100)} percent` : `Hue ${Math.round(hue * 360)} degrees, saturation ${Math.round(saturation * 100)} percent`}
      onPointerDown={event => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); const box = event.currentTarget.getBoundingClientRect(); move((event.clientX - box.left) / box.width * 2 - 1, (event.clientY - box.top) / box.height * 2 - 1); }}
      onPointerMove={event => { if (!dragging.current) return; const box = event.currentTarget.getBoundingClientRect(); move((event.clientX - box.left) / box.width * 2 - 1, (event.clientY - box.top) / box.height * 2 - 1); }}
      onPointerUp={() => { dragging.current = false; change(latest.current); }}
      onPointerCancel={() => { dragging.current = false; setPoints(colors); latest.current = colors; }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const d = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? .02 : -.02;
        if (white) move(0, (temperature + d) * 2 - 1, true);
        else { hue += ['ArrowLeft', 'ArrowRight'].includes(event.key) ? d : 0; const s = Math.max(0, Math.min(1, saturation + (['ArrowUp', 'ArrowDown'].includes(event.key) ? d : 0))); move(Math.cos(hue * Math.PI * 2 - Math.PI * 2 / 3) * s, Math.sin(hue * Math.PI * 2 - Math.PI * 2 / 3) * s, true); }
      }}>
      {points.map((point, index) => {
        const isWhite = Boolean(point.white || point.warmWhite || point.coolWhite);
        if (isWhite !== white) return null;
        const high = Math.max(point.red, point.green, point.blue), low = Math.min(point.red, point.green, point.blue), d = high - low;
        const h = d === 0 ? 0 : high === point.red ? ((point.green - point.blue) / d / 6 + 1) % 1 : high === point.green ? ((point.blue - point.red) / d + 2) / 6 : ((point.red - point.green) / d + 4) / 6;
        const s = high ? d / high : 0;
        const x = white ? 0 : Math.cos(h * Math.PI * 2 - Math.PI * 2 / 3) * s;
        const y = white ? strip === 'WS2805' ? point.coolWhite / (point.warmWhite + point.coolWhite || 1) * 2 - 1 : 0 : Math.sin(h * Math.PI * 2 - Math.PI * 2 / 3) * s;
        return <span key={index} className={`wheel-point ${selected === index ? 'selected' : ''}`} style={{ left: `${50 + x * 47}%`, top: `${50 + y * 47}%`, background: colorCSS(point) }} aria-hidden="true">{gradient ? index + 1 : ''}</span>;
      })}
    </div>
    <div className="wheel-toolbar">
      <div className="wheel-modes"><button className={!white ? 'selected' : ''} aria-label="Use color wheel" aria-pressed={!white} onClick={() => { setWhite(false); const next = points.map((p, i) => i === selected ? { ...emptyColor, red: 255 } : p); setPoints(next); latest.current = next; change(next); }}><span className="rainbow-disc" /></button>
        {strip !== 'WS2812' && <button className={white ? 'selected' : ''} aria-label={strip === 'WS2805' ? 'Use white temperature' : 'Use white channel'} aria-pressed={white} onClick={() => { setWhite(true); const next = points.map((p, i) => i === selected ? strip === 'WS2805' ? { ...emptyColor, warmWhite: 128, coolWhite: 127 } : { ...emptyColor, white: 255 } : p); setPoints(next); latest.current = next; change(next); }}><span className={strip === 'WS2805' ? 'white-disc' : 'neutral-disc'} /></button>}
      </div>

    </div>
    {gradient && <div className="gradient-controls">
      <div className="gradient-preview" style={{ background: paletteCSS(points) }} /><div className="endpoints"><span>START</span><span>END</span></div>
      <div className="gradient-points">{points.map((point, index) => <button key={index} aria-label={`Select point ${index + 1}`} aria-pressed={selected === index} className={selected === index ? 'selected' : ''} onClick={() => { setSelected(index); setWhite(Boolean(point.white || point.warmWhite || point.coolWhite)); }}><span style={{ background: colorCSS(point) }}>{index + 1}</span></button>)}
        <button className="point-action" aria-label="Add point" disabled={points.length >= 8} onClick={() => { const next = [...points, { ...emptyColor, red: 125, green: 45, blue: 255 }]; setSelected(next.length - 1); setWhite(false); setPoints(next); latest.current = next; change(next); }}><Plus size={20} /></button>
        <button className="point-action" aria-label="Remove point" disabled={points.length <= 2} onClick={() => { const next = points.filter((_, i) => i !== selected); setSelected(Math.min(selected, next.length - 1)); setPoints(next); latest.current = next; change(next); }}><Minus size={20} /></button>
      </div>
    </div>}

  </section>;
}
