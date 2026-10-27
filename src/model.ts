import { colorSchema, configSchema, savedColorSchema, gradientSchema, scriptSchema, requestHttp, type Color, type State, type Script, type Gradient, type SavedColor, type Request, type Response } from '../shared/protocol/src/index';
import { parseParameters, updateParameters } from '../shared/protocol/src/parameters';
import { parsePreview } from '../shared/protocol/src/preview';

export type Library = { colors: SavedColor[]; gradients: Gradient[]; scripts: Script[] };
export type Light = { id: string; address: string; state: State; online: boolean; simulator?: boolean; library: Library; source?: string; network?: Response['networkStatus'] };
export type Item = { id: string; name: string; mode: number; colors: Color[]; source?: string };
export const emptyColor: Color = { red: 0, green: 0, blue: 0, white: 0, warmWhite: 0, coolWhite: 0 };
export const modes = ['Color', 'Gradient', 'Animation'];
export const plural = ['Colors', 'Gradients', 'Animations'];
export let lights: Light[] = [];
export let storageError = '';
const listeners = new Set<() => void>();
const queues = new Map<string, Promise<unknown>>();
let requestID = 1;

try {
  const stored = JSON.parse(localStorage.getItem('luxio-app-v1') ?? '[]');
  if (Array.isArray(stored)) for (const light of stored) {
    try {
      if (typeof light.id !== 'string' || typeof light.address !== 'string') continue;
      light.state.config = configSchema.parse(light.state.config);
      light.state.color = colorSchema.parse(light.state.color);
      if (!Number.isInteger(light.state.brightness) || light.state.brightness < 1 || light.state.brightness > 256) continue;
      if (typeof light.state.on !== 'boolean' || ![0, 1, 2].includes(light.state.mode ?? 0)) continue;
      light.library = {
        colors: (light.library?.colors ?? []).map((c: SavedColor) => savedColorSchema.parse(c)),
        gradients: (light.library?.gradients ?? []).map((g: Gradient) => gradientSchema.parse(g)),
        scripts: (light.library?.scripts ?? []).map((s: Script) => scriptSchema.parse(s)),
      };
      if (light.state.gradient) light.state.gradient = gradientSchema.parse(light.state.gradient);
      if (light.source) parseParameters(light.source, light.state.parameters);
      light.online = Boolean(light.simulator);
      lights.push(light);
    } catch { /* A malformed device must not prevent other devices from loading. */ }
  }
} catch { storageError = 'Browser storage is unavailable. Changes will last for this session only.'; }

export function publish() {
  lights = [...lights];
  try { localStorage.setItem('luxio-app-v1', JSON.stringify(lights)); }
  catch { storageError = 'Your browser could not save changes. Keep this tab open to retain your simulator and saved items.'; }
  listeners.forEach(listener => listener());
}
export const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const snapshot = () => lights;

export function addSimulator() {
  const existing = lights.find(light => light.simulator);
  if (existing) return existing;
  const light: Light = {
    id: crypto.randomUUID(), address: '', simulator: true, online: true,
    state: { deviceId: 'simulator', build: 36, config: { name: 'Luxio Simulator', stripType: 'WS2805', ledCount: 60, gpio: 16, channel: 100 }, brightness: 180, on: true,
      color: { ...emptyColor, green: 210, blue: 255 }, activeScriptId: '', lanIp: '', mode: 0 },
    library: { colors: [], gradients: [], scripts: [] },
  };
  lights.push(light); publish(); return light;
}

export async function connect(input: string) {
  const address = new URL(input.includes('://') ? input.trim() : `http://${input.trim()}`);
  if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password) throw new Error('Enter an IP address or hostname.');
  const response = await requestHttp(address.origin, { id: requestID++, operation: 0 });
  if (!response.state?.deviceId || !response.state.config) throw new Error('This address did not return a Luxio device.');
  let light = lights.find(light => !light.simulator && light.id === response.state!.deviceId);
  if (light) {
    if (light.state.animationRevision !== response.state.animationRevision || light.state.scriptName !== response.state.scriptName || light.state.activeScriptId !== response.state.activeScriptId) light.source = undefined;
    Object.assign(light, { address: address.origin, state: response.state, network: response.networkStatus, online: true });
  }
  else {
    light = { id: response.state.deviceId, address: address.origin, state: response.state, network: response.networkStatus, online: true, library: { colors: [], gradients: [], scripts: [] } };
    lights.push(light);
  }
  publish(); return light;
}

// Serialize each light's requests. A failed mutation is never replayed automatically.
export function send(light: Light, payload: Omit<Request, 'id'>): Promise<Response> {
  const request = { ...payload, id: requestID++ };
  const task = (queues.get(light.id) ?? Promise.resolve()).catch(() => {}).then(async () => {
    let result: Partial<Response> = {};
    if (!light.simulator) {
      try {
        result = await requestHttp(light.address, request);
        light.online = true;
        if (result.state) {
          if (light.state.animationRevision !== result.state.animationRevision || light.state.scriptName !== result.state.scriptName || light.state.activeScriptId !== result.state.activeScriptId) light.source = undefined;
          light.state = result.state;
        }
        if (result.networkStatus) light.network = result.networkStatus;
        if (result.script?.source && (!payload.scriptId || payload.scriptId === light.state.activeScriptId)) light.source = result.script.source;
        if (payload.operation === 31 && payload.script) light.source = payload.script.source;
        if (payload.operation !== 0 && !result.state) {
          const status = await requestHttp(light.address, { id: requestID++, operation: 0 });
          if (status.state) light.state = status.state;
        }
      } catch (error) {
        if (payload.operation === 0) light.online = false;
        publish(); throw error;
      }
    } else {
      const state = structuredClone(light.state);
      switch (request.operation) {
        case 0: break;
        case 1: case 30: {
          const saved = light.library.colors.find(item => item.id === request.colorId);
          if (request.operation === 30 && !saved) throw new Error('Color not found.');
          state.color = colorSchema.parse(saved?.color ?? request.color); state.mode = 0;
          state.activeColorId = saved?.id ?? ''; state.on = true; break;
        }
        case 2:
          if (!Number.isInteger(request.brightness) || request.brightness! < 1 || request.brightness! > 256) throw new Error('Brightness must be between 1 and 256.');
          state.brightness = request.brightness!; break;
        case 15: state.on = Boolean(request.on); break;
        case 3: {
          const config = configSchema.parse(request.config);
          if (config.stripType !== state.config.stripType || config.ledCount !== state.config.ledCount) {
            state.mode = 0; state.color = { ...emptyColor, red: 255, green: 110, blue: 25 }; state.activeColorId = '';
          }
          state.config = config; break;
        }
        case 17: case 23: {
          const gradient = request.operation === 23 ? light.library.gradients.find(item => item.id === request.gradientId) : request.gradient;
          state.gradient = gradientSchema.parse({ ...gradient, id: gradient?.id || crypto.randomUUID(), name: gradient?.name || 'Custom gradient' });
          if (state.config.ledCount < 2) throw new Error('Gradients require more than one LED.');
          state.mode = 1; state.activeGradientId = request.operation === 23 ? state.gradient.id : ''; state.on = true; break;
        }
        case 10: case 31: {
          const script = request.operation === 10 ? light.library.scripts.find(item => item.id === request.scriptId) : request.script;
          const validated = scriptSchema.parse({ ...script, id: script?.id || crypto.randomUUID() });
          state.parameters = parseParameters(validated.source, validated.parameters);
          state.animationPreview = parsePreview(validated.source);
          state.mode = 2; state.scriptName = validated.name; state.activeScriptId = request.operation === 10 ? validated.id : '';
          state.animationRevision = (state.animationRevision ?? 0) + 1;
          state.on = true; light.source = validated.source; break;
        }
        case 11: state.mode = 0; break;
        case 32:
          if (state.mode !== 2 || (request.scriptId ? request.scriptId !== state.activeScriptId : request.script?.name !== state.scriptName)) throw new Error('The active animation changed.');
          state.parameters = updateParameters(state.parameters ?? [], request.parameters ?? []); break;
        case 5: result.scripts = light.library.scripts; break;
        case 18: result.gradients = light.library.gradients; break;
        case 25: result.colors = light.library.colors; break;
        case 6: result.script = request.scriptId ? light.library.scripts.find(item => item.id === request.scriptId) : { id: state.activeScriptId, name: state.scriptName ?? '', source: light.source ?? '', parameters: state.parameters }; break;
        case 19: result.gradient = light.library.gradients.find(item => item.id === request.gradientId); break;
        case 26: result.savedColor = light.library.colors.find(item => item.id === request.colorId); break;
        case 7: case 8: {
          const script = scriptSchema.parse({ ...request.script, id: request.operation === 7 ? crypto.randomUUID() : request.script?.id });
          script.parameters = parseParameters(script.source, script.parameters); script.preview = parsePreview(script.source);
          light.library.scripts = [...light.library.scripts.filter(item => item.id !== script.id), script]; result.script = script; break;
        }
        case 20: case 21: {
          const gradient = gradientSchema.parse({ ...request.gradient, id: request.operation === 20 ? crypto.randomUUID() : request.gradient?.id });
          light.library.gradients = [...light.library.gradients.filter(item => item.id !== gradient.id), gradient]; result.gradient = gradient; break;
        }
        case 27: case 28: {
          const color = savedColorSchema.parse({ ...request.savedColor, id: request.operation === 27 ? crypto.randomUUID() : request.savedColor?.id });
          light.library.colors = [...light.library.colors.filter(item => item.id !== color.id), color]; result.savedColor = color; break;
        }
        case 9: light.library.scripts = light.library.scripts.filter(item => item.id !== request.scriptId); if (state.activeScriptId === request.scriptId) state.mode = 0; break;
        case 22: light.library.gradients = light.library.gradients.filter(item => item.id !== request.gradientId); if (state.activeGradientId === request.gradientId) state.activeGradientId = ''; break;
        case 29: light.library.colors = light.library.colors.filter(item => item.id !== request.colorId); if (state.activeColorId === request.colorId) state.activeColorId = ''; break;
        default: throw new Error('This operation requires a physical Luxio.');
      }
      const channels = state.mode === 1 ? state.gradient?.colors ?? [] : state.mode === 0 ? [state.color] : [];
      const strip = state.config.stripType;
      if (channels.some(color => strip === 'WS2812' ? color.white || color.warmWhite || color.coolWhite : strip === 'WS2805' ? color.white : color.warmWhite || color.coolWhite)) throw new Error('This color uses channels unavailable on this strip type.');
      if (state.mode !== 2) { state.activeScriptId = ''; state.scriptName = ''; state.parameters = []; state.animationPreview = []; light.source = undefined; }
      if (state.mode !== 1) { state.gradient = undefined; state.activeGradientId = ''; }
      if (state.mode !== 0) state.activeColorId = '';
      light.state = state; result.state = state;
    }
    publish(); return { id: request.id, scripts: [], error: '', ...result } as Response;
  });
  queues.set(light.id, task);
  void task.finally(() => { if (queues.get(light.id) === task) queues.delete(light.id); }).catch(() => {});
  return task;
}

export async function loadLibrary(light: Light) {
  if (light.simulator) return;
  // Listings only contain names and IDs. Fetch the full resources for accurate swatches.
  const colors = (await send(light, { operation: 25 })).colors ?? [];
  const gradients = (await send(light, { operation: 18 })).gradients ?? [];
  const scripts = (await send(light, { operation: 5 })).scripts ?? [];
  const library: Library = { colors: [], gradients: [], scripts: [] };
  for (const item of colors) {
    const result = await send(light, { operation: 26, colorId: item.id });
    if (result.savedColor) library.colors.push(result.savedColor);
  }
  for (const item of gradients) {
    const result = await send(light, { operation: 19, gradientId: item.id });
    if (result.gradient) library.gradients.push(result.gradient);
  }
  for (const item of scripts) {
    const result = await send(light, { operation: 6, scriptId: item.id });
    if (result.script) library.scripts.push(result.script);
  }
  light.library = library; publish();
}

export async function refresh(light: Light) {
  if (light.simulator || queues.has(light.id)) return;
  const revision = light.state.animationRevision;
  await send(light, { operation: 0 });
  if (light.state.mode === 2 && (!light.source || revision !== light.state.animationRevision)) await send(light, { operation: 6 });
}

export function remove(light: Light) { lights = lights.filter(item => item.id !== light.id); publish(); }

export function colorCSS(color: Color) {
  return `rgb(${Math.min(255, color.red + color.white + color.warmWhite + color.coolWhite * .8)},${Math.min(255, color.green + color.white + color.warmWhite * .73 + color.coolWhite * .9)},${Math.min(255, color.blue + color.white + color.warmWhite * .4 + color.coolWhite)})`;
}

export function paletteCSS(colors: Color[]) {
  return colors.length > 1 ? `linear-gradient(110deg, ${colors.map(colorCSS).join(',')})` : colors.length ? colorCSS(colors[0]) : '#403439';
}
