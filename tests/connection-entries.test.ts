import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceConnection, connections } from '../src/transport';
import { decodeRequest, encodeResponse, type Request, type Response as DeviceResponse, type State, type Script } from '../shared/protocol/src/index';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalFetch = globalThis.fetch;
const originalOpen = DeviceConnection.prototype.open;
const originalRequest = DeviceConnection.prototype.request;
const originalClose = DeviceConnection.prototype.close;
const base: State = { deviceId: 'shared-board', build: 36, config: { name: 'Desk', stripType: 'WS2805', ledCount: 60, gpio: 16, channel: 100 }, brightness: 180, on: true, color: { red: 0, green: 210, blue: 255, white: 0, warmWhite: 0, coolWhite: 0 }, activeScriptId: '', lanIp: '192.0.2.5', mode: 0 };
const memory = new Map([['luxio-app-v1', JSON.stringify([{ id: 'legacy-board', address: 'http://192.0.2.6', transport: 'usb', state: { ...base, deviceId: 'legacy-board' }, library: { colors: [], gradients: [], scripts: [] } }])]]);
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) } });
const usb = {}, bluetooth = {};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Chrome/142', serial: { requestPort: async () => usb }, bluetooth: { requestDevice: async () => bluetooth } } });
const model = await import('../src/model');
let state = structuredClone(base);
let scripts: Script[] = [];
const calls: { kind: string; operation: number }[] = [];
let holdWifi: Promise<void> | undefined;
let failWifi = false;
let resetReply: 'accept' | 'missing' | 'disconnect' = 'accept';
async function respond(kind: string, request: Request): Promise<DeviceResponse> {
  calls.push({ kind, operation: request.operation });
  if (kind === 'wifi' && failWifi) throw new Error('Wi-Fi unavailable');
  if (request.operation === 33) {
    assert.equal(request.factoryResetConfirmed, true);
    if (resetReply === 'disconnect') throw new Error('Disconnected before acknowledgement');
    return { id: request.id, error: '', factoryResetAccepted: resetReply === 'accept' } as DeviceResponse;
  }
  if (request.operation === 2) state.brightness = request.brightness!;
  if (request.operation === 15) state.on = request.on!;
  if (request.operation === 1) { state.color = request.color!; state.mode = 0; }
  if (request.operation === 31) { state.mode = 2; state.scriptName = request.script!.name; state.animationRevision = (state.animationRevision ?? 0) + 1; }
  if (request.operation === 7) scripts.push(request.script!);
  const result: DeviceResponse = { id: request.id, error: '', pairingCode: '', pairingQr: '', availableBuild: 0, state: structuredClone(state), scripts: request.operation === 5 ? scripts : [], colors: [], gradients: [], script: request.operation === 7 ? request.script : request.operation === 6 ? scripts.find(script => script.id === request.scriptId) : undefined };
  if (kind === 'wifi' && holdWifi) await holdWifi;
  return result;
}
DeviceConnection.prototype.open = async function () {};
DeviceConnection.prototype.request = async function (request) { return respond(this.kind, request); };
DeviceConnection.prototype.close = async function () { this.ondisconnect?.(); };
globalThis.fetch = async (_url, init) => new Response(new Uint8Array(encodeResponse(await respond('wifi', decodeRequest(new Uint8Array(init!.body as Uint8Array))))).buffer);

test('legacy USB entries migrate without losing the Wi-Fi entry or duplicating the transport', () => {
  const wifi = model.lights.find(light => light.id === 'legacy-board')!;
  const usb = model.lights.find(light => light.id === 'usb:legacy-board')!;
  assert.ok(wifi); assert.ok(usb);
  assert.equal(wifi.transport, undefined); assert.equal(wifi.address, 'http://192.0.2.6');
  assert.equal(usb.transport, 'usb'); assert.equal(usb.address, '');
  assert.equal(wifi.online, false); assert.equal(usb.online, false);
});

test('Wi-Fi, USB, and Bluetooth keep distinct entries, synchronize state and libraries, and retain independent availability', async () => {
  const [wifi] = model.discoverDevices([{ deviceId: state.deviceId, lan_ip: '192.0.2.5', name: 'Desk' }]);
  const [other] = model.discoverDevices([{ deviceId: 'other-board', lan_ip: '192.0.2.7', name: 'Other' }]);
  await model.refresh(wifi);
  const usbLight = await model.findDevice('usb');
  const usbConnection = connections.get(usbLight.id);
  const bleLight = await model.findDevice('bluetooth');
  assert.equal(usbLight.id, 'usb:shared-board'); assert.equal(bleLight.id, 'bluetooth:shared-board');
  assert.equal(model.lights.filter(light => light.state.deviceId === state.deviceId).length, 3);
  assert.equal(connections.get(usbLight.id), usbConnection);
  assert.equal(wifi.transport, undefined); assert.equal(wifi.address, 'http://192.0.2.5');
  assert.equal(usbLight.online, true); assert.equal(bleLight.online, true);

  await model.send(usbLight, { operation: 15, on: false });
  assert.equal(wifi.state.on, false); assert.equal(bleLight.state.on, false);
  assert.equal(calls.filter(call => call.operation === 15).length, 1);
  assert.equal(calls.find(call => call.operation === 15)?.kind, 'usb');
  assert.equal(other.stateKnown, false);
  await model.send(bleLight, { operation: 2, brightness: 75 });
  assert.equal(wifi.state.brightness, 75); assert.equal(usbLight.state.brightness, 75);
  const color = { ...base.color, red: 255, green: 0, blue: 0 };
  await model.send(wifi, { operation: 1, color });
  assert.deepEqual(usbLight.state.color, color); assert.deepEqual(bleLight.state.color, color);

  let release!: () => void;
  holdWifi = new Promise(resolve => { release = resolve; });
  calls.length = 0;
  const oldPoll = model.refresh(wifi);
  await new Promise(resolve => setTimeout(resolve, 0));
  const mutation = model.send(bleLight, { operation: 2, brightness: 210 });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, [{ kind: 'wifi', operation: 0 }]);
  release(); holdWifi = undefined;
  await Promise.all([oldPoll, mutation]);
  for (const light of [wifi, usbLight, bleLight]) assert.equal(light.state.brightness, 210);
  calls.length = 0;
  await Promise.all([model.refresh(wifi), model.refresh(usbLight), model.refresh(bleLight)]);
  assert.deepEqual(calls.filter(call => call.operation === 0).map(call => call.kind), ['wifi', 'usb', 'bluetooth']);

  const script = { id: crypto.randomUUID(), name: 'Together', source: '-- @preview ff0000\nfunction loop() luxio_fill(255, 0, 0) end', mode: 2 };
  await model.send(bleLight, { operation: 31, script });
  assert.equal(wifi.state.mode, 2); assert.equal(usbLight.state.scriptName, 'Together');
  assert.equal(wifi.source, script.source); assert.equal(usbLight.source, script.source);
  await model.send(usbLight, { operation: 7, script });
  await model.loadLibrary(usbLight);
  assert.equal(wifi.library.scripts[0].id, script.id); assert.equal(bleLight.library.scripts[0].source, script.source);

  const originalBle = connections.get(bleLight.id);
  assert.equal(await model.connect('192.0.2.5'), wifi);
  assert.equal(await model.findDevice('usb'), usbLight);
  assert.equal(connections.get(bleLight.id), originalBle);
  assert.equal(model.lights.filter(light => light.state.deviceId === state.deviceId).length, 3);
  model.discoverDevices([{ deviceId: state.deviceId, lan_ip: '192.0.2.8', name: 'Desk' }]);
  assert.equal(wifi.address, 'http://192.0.2.8'); assert.equal(usbLight.address, ''); assert.equal(bleLight.address, '');

  await connections.get(usbLight.id)!.close();
  assert.equal(usbLight.online, false); assert.equal(wifi.online, true); assert.equal(bleLight.online, true);
  failWifi = true;
  await assert.rejects(model.refresh(wifi), /Wi-Fi unavailable/);
  assert.equal(wifi.online, false); assert.equal(bleLight.online, true);
  await model.send(bleLight, { operation: 15, on: true });
  assert.equal(usbLight.state.on, true); assert.equal(wifi.state.on, true);
  assert.equal(usbLight.online, false); assert.equal(wifi.online, false);
  assert.equal(await model.findDevice('usb'), usbLight);
  assert.equal(usbLight.online, true); assert.equal(wifi.online, false);
});


for (const kind of ['wifi', 'usb', 'bluetooth'] as const) test(`factory reset over ${kind} requires confirmation and acknowledgement, never retries, and clears all aliases`, async () => {
  failWifi = false;
  state = { ...structuredClone(base), deviceId: `reset-${kind}`, build: 37, factoryResetSupported: true };
  const wifi = await model.connect('192.0.2.9');
  const usbLight = await model.findDevice('usb');
  const bluetoothLight = await model.findDevice('bluetooth');
  const selected = kind === 'wifi' ? wifi : kind === 'usb' ? usbLight : bluetoothLight;
  const unrelated = model.lights.find(light => light.state.deviceId === 'other-board')!;
  calls.length = 0;
  await assert.rejects(model.send(selected, { operation: 33 }), /confirmation/);
  assert.equal(calls.length, 0);
  selected.state.factoryResetSupported = false;
  await assert.rejects(model.send(selected, { operation: 33, factoryResetConfirmed: true }), /supported firmware/);
  assert.equal(calls.length, 0);
  selected.state.factoryResetSupported = true;
  for (const reply of ['missing', 'disconnect'] as const) {
    resetReply = reply; calls.length = 0;
    await assert.rejects(model.send(selected, { operation: 33, factoryResetConfirmed: true }), /acknowledge/);
    assert.deepEqual(calls, [{ kind, operation: 33 }]);
    assert.equal(model.lights.filter(light => light.state.deviceId === state.deviceId).length, 3);
    assert.ok(connections.has(usbLight.id) && connections.has(bluetoothLight.id));
  }
  resetReply = 'accept'; calls.length = 0;
  const reply = await model.send(selected, { operation: 33, factoryResetConfirmed: true });
  assert.equal(reply.factoryResetAccepted, true);
  assert.deepEqual(calls, [{ kind, operation: 33 }]); // No follow-up status request after reset.
  assert.equal(model.lights.some(light => light.state.deviceId === state.deviceId), false);
  assert.equal(connections.has(usbLight.id), false);
  assert.equal(connections.has(bluetoothLight.id), false);
  assert.equal(JSON.parse(memory.get('luxio-app-v1')!).some((light: {id: string}) => light.id === selected.id), false);
  assert.ok(model.lights.includes(unrelated));
  model.discoverDevices([{ deviceId: state.deviceId, lan_ip: '192.0.2.9', name: 'Stale registration' }]);
  assert.equal(model.lights.some(light => light.state.deviceId === state.deviceId), false);
  assert.ok(JSON.parse(memory.get('luxio-reset-devices-v1')!).some(([id]: [string]) => id === state.deviceId));
  const [fresh] = model.discoverDevices([{ deviceId: `${state.deviceId}-new`, lan_ip: '192.0.2.9', name: 'Luxio' }]);
  assert.equal(fresh.state.deviceId, `${state.deviceId}-new`);
});

test.after(async () => {
  for (const connection of connections.values()) await connection.close();
  DeviceConnection.prototype.open = originalOpen;
  DeviceConnection.prototype.request = originalRequest;
  DeviceConnection.prototype.close = originalClose;
  globalThis.fetch = originalFetch;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
});
