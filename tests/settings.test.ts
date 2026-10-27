import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Settings } from '../src/Settings';
import type { Light } from '../src/model';

for (const [build, capability, supported] of [
  [36, false, false], [37, false, true], [37, undefined, true],
  [37, true, true], [38, true, true], [38, false, false],
] as const) test(`settings reset availability: build ${build}, capability ${capability}`, () => {
  const light: Light = { id: 'test', address: 'http://192.0.2.1', online: true,
    state: { build, factoryResetSupported: capability, deviceId: 'test', config: { name: 'Test', stripType: 'WS2812', ledCount: 60, gpio: 16, channel: 0 }, on: true, brightness: 100, color: { red: 255, green: 0, blue: 0, white: 0, warmWhite: 0, coolWhite: 0 }, activeScriptId: '', lanIp: '192.0.2.1' },
    library: { colors: [], gradients: [], scripts: [] } };
  const html = renderToStaticMarkup(createElement(Settings, { light, close() {}, removed() {}, notice() {} }));
  const button = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)!.find(button => button.includes('Factory Reset'))!;
  assert.ok(button);
  assert.equal(/^<button[^>]* disabled=/.test(button), !supported);
  assert.equal(html.includes('Update Luxio’s firmware to enable Factory Reset.'), !supported);
});
