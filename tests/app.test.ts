import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeRequest, encodeResponse, type Response as DeviceResponse } from '../shared/protocol/src/index';
import { Animation } from '../shared/device/src/lua';
import { parseParameters } from '../shared/protocol/src/parameters';

const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
}, configurable: true });
const model = await import('../src/model');
const presets = JSON.parse(readFileSync(new URL('../src/presets.json', import.meta.url), 'utf8')) as { name: string; source: string; isGradient: boolean }[];
const light = model.addSimulator();

test('simulator is a singleton, has native defaults, and sends no network requests', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected network request'); };
  try {
    assert.equal(model.addSimulator(), light);
    assert.equal(light.state.config.ledCount, 60);
    await model.send(light, { operation: 1, color: { ...model.emptyColor, red: 255 } });
    await model.send(light, { operation: 2, brightness: 96 });
    await model.send(light, { operation: 15, on: false });
    assert.equal(light.state.on, false);
    assert.equal(light.state.brightness, 96);
    await model.send(light, { operation: 15, on: true });
    assert.equal(light.state.brightness, 96);
    assert.deepEqual(JSON.parse(memory.get('luxio-app-v1')!)[0].state, JSON.parse(JSON.stringify(light.state)));
  } finally { globalThis.fetch = original; }
});

test('color library saves, applies, renames and deletes independently of gradients', async () => {
  const saved = (await model.send(light, { operation: 27, savedColor: { id: crypto.randomUUID(), name: 'Evening', color: { ...model.emptyColor, blue: 255 } } })).savedColor!;
  await model.send(light, { operation: 30, colorId: saved.id });
  assert.equal(light.state.color.blue, 255); assert.equal(light.state.activeColorId, saved.id);
  await model.send(light, { operation: 28, savedColor: { ...saved, name: 'Evening blue' } });
  assert.equal(light.library.colors[0].name, 'Evening blue');
  await model.send(light, { operation: 29, colorId: saved.id });
  assert.equal(light.library.colors.length, 0); assert.equal(light.state.activeColorId, '');
});

test('gradient edits remain in RAM until saved, support eight stops, and validate channels', async () => {
  const colors = [{ ...model.emptyColor, red: 255 }, { ...model.emptyColor, blue: 255 }];
  await model.send(light, { operation: 17, gradient: { id: crypto.randomUUID(), name: 'Preview', colors } });
  assert.equal(light.state.mode, 1); assert.equal(light.library.gradients.length, 0);
  const saved = (await model.send(light, { operation: 20, gradient: { id: crypto.randomUUID(), name: 'Sunset', colors } })).gradient!;
  await model.send(light, { operation: 23, gradientId: saved.id });
  assert.equal(light.state.activeGradientId, saved.id);
  await assert.rejects(model.send(light, { operation: 17, gradient: { ...saved, colors: Array(9).fill(colors[0]) } }));
  await model.send(light, { operation: 3, config: { ...light.state.config, stripType: 'WS2812' } });
  await assert.rejects(model.send(light, { operation: 1, color: { ...model.emptyColor, white: 255 } }), /unavailable/);
  await model.send(light, { operation: 3, config: { ...light.state.config, ledCount: 1 } });
  await assert.rejects(model.send(light, { operation: 17, gradient: saved }), /more than one LED/);
  await model.send(light, { operation: 3, config: { ...light.state.config, stripType: 'WS2805', ledCount: 60 } });
});

test('all ten iOS animations execute in the local Lua runtime for every supported strip', () => {
  const animations = presets.filter(preset => !preset.isGradient);
  assert.equal(animations.length, 10);
  for (const strip of ['WS2805', 'WS2814', 'WS2812', 'SK6812']) for (const preset of animations) {
    const animation = new Animation(preset.source, 60, strip);
    try {
      for (let frame = 0; frame < 5; frame++) {
        const pixels = animation.tick();
        assert.equal(pixels.length, 60, `${strip} / ${preset.name}`);
        assert.ok(pixels.some(pixel => Object.values(pixel).some(value => value > 0)), `${strip} / ${preset.name}`);
        assert.ok(pixels.every(pixel => Object.values(pixel).every(value => value >= 0 && value <= 255)));
      }
    } finally { animation.close(); }
  }
});

test('animation parameters update without restarting, persist, and reject stale targets', async () => {
  const preset = presets.find(preset => preset.name === 'Rainbow')!;
  const script = { id: crypto.randomUUID(), name: 'Luxio · Rainbow', source: preset.source, mode: 2 };
  await model.send(light, { operation: 31, script });
  const revision = light.state.animationRevision;
  const parameters = parseParameters(preset.source).map(p => ({ ...p, value: p.name === 'Speed' ? 75 : p.value }));
  await model.send(light, { operation: 32, script: { ...script, source: '' }, parameters });
  assert.equal(light.state.parameters?.find(p => p.name === 'Speed')?.value, 75);
  assert.equal(light.state.animationRevision, revision);
  assert.equal(light.library.scripts.length, 0);
  await assert.rejects(model.send(light, { operation: 32, scriptId: 'stale-id', parameters }), /changed/);
  assert.equal(JSON.parse(memory.get('luxio-app-v1')!)[0].source, preset.source);
  const saved = (await model.send(light, { operation: 7, script: { ...script, parameters } })).script!;
  await model.send(light, { operation: 11 });
  await model.send(light, { operation: 10, scriptId: saved.id });
  assert.equal(light.state.parameters?.find(p => p.name === 'Speed')?.value, 75);
  await model.send(light, { operation: 9, scriptId: saved.id });
  assert.equal(light.state.mode, 0); assert.equal(light.library.scripts.length, 0);
});

test('HTTP transport validates devices, follows library pages, and never retries mutations', async () => {
  const original = globalThis.fetch;
  const calls: { operation: number; colorOffset?: number }[] = [];
  let failMutation = false;
  const first = { id: crypto.randomUUID(), name: 'First', color: { ...model.emptyColor, red: 255 } };
  const second = { id: crypto.randomUUID(), name: 'Second', color: { ...model.emptyColor, blue: 255 } };
  globalThis.fetch = async (_input, init) => {
    const request = decodeRequest(init?.body as Uint8Array); calls.push(request);
    if (failMutation && request.operation === 15) throw new Error('Network disconnected');
    let result: Partial<DeviceResponse> = { id: request.id };
    if (request.operation === 0 || request.operation === 15) result.state = { ...light.state, deviceId: 'fixture-device', config: { ...light.state.config, name: 'Fixture light' } };
    if (request.operation === 25) result = { ...result, colors: request.colorOffset ? [second] : [first], nextColorOffset: request.colorOffset ? 0 : 1 };
    if (request.operation === 26) result.savedColor = request.colorId === first.id ? first : second;
    return new Response(encodeResponse(result) as BodyInit, { status: 200 });
  };
  try {
    const hardware = await model.connect('192.0.2.42');
    assert.equal(hardware.state.config.name, 'Fixture light');
    await model.loadLibrary(hardware);
    assert.deepEqual(hardware.library.colors.map(color => color.name), ['First', 'Second']);
    assert.deepEqual(calls.filter(request => request.operation === 25).map(request => request.colorOffset), [0, 1]);
    failMutation = true;
    await assert.rejects(model.send(hardware, { operation: 15, on: false }), /disconnected/);
    assert.equal(calls.filter(request => request.operation === 15).length, 1);
    failMutation = false;
    await model.send(hardware, { operation: 0 });
    assert.equal(hardware.online, true);
    model.remove(hardware);
  } finally { globalThis.fetch = original; }
});

test('invalid changes do not corrupt the simulator and removal persists', async () => {
  const before = structuredClone(light.state);
  await assert.rejects(model.send(light, { operation: 3, config: { ...light.state.config, ledCount: 1025 } }));
  await assert.rejects(model.send(light, { operation: 2, brightness: 0 }));
  assert.deepEqual(light.state, before);
  model.remove(light);
  assert.deepEqual(JSON.parse(memory.get('luxio-app-v1')!), []);
});
