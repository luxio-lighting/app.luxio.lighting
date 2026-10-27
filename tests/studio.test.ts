import test from 'node:test';
import assert from 'node:assert/strict';
import { starterSource } from '../studio/starter';
import { Animation } from '../shared/device/src/lua';
import { parseParameters } from '../shared/protocol/src/parameters';
import { parsePreview } from '../shared/protocol/src/preview';

test('new animation loops the Luxio gradient every 20 seconds on each strip type', () => {
  assert.equal(parsePreview(starterSource).length, 2);
  const [speed] = parseParameters(starterSource);
  assert.equal(speed.name, 'Speed');
  assert.equal(speed.numberInput, false);
  assert.equal(speed.value, 1);
  for (const strip of ['WS2805', 'WS2814', 'WS2812', 'SK6812']) for (const count of [1, 60, 1024]) {
    const animation = new Animation(starterSource, count, strip);
    try {
      const first = structuredClone(animation.tick(0));
      assert.deepEqual([first[0].red, first[0].green, first[0].blue], [0, 210, 255]);
      if (count > 1) assert.deepEqual([first.at(-1)!.red, first.at(-1)!.green, first.at(-1)!.blue], [79, 255, 127]);
      const moving = structuredClone(animation.tick(5000));
      assert.notDeepEqual(moving, first);
      assert(moving.every(pixel => Object.values(pixel).every(value => value >= 0 && value <= 255)));
      assert.deepEqual(animation.tick(15000), first);
    } finally { animation.close(); }
  }
});

test('starter speed slider changes the cycle speed without jumping on adjustment', () => {
  const slow = new Animation(starterSource, 60, 'WS2812');
  const fast = new Animation(starterSource, 60, 'WS2812', parseParameters(starterSource).map(p => ({ ...p, value: 2 })));
  try {
    assert.deepEqual(fast.tick(5000), slow.tick(10000));
    const before = structuredClone(slow.tick(1000));
    slow.update(parseParameters(starterSource).map(p => ({ ...p, value: 5 })));
    assert.deepEqual(slow.tick(0), before);
    assert.notDeepEqual(slow.tick(1000), before);
  } finally { slow.close(); fast.close(); }
});
