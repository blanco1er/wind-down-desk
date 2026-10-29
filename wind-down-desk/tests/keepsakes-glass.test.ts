import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KEEPSAKE_AT, Keepsakes, STEAM } from '../src/desk/keepsakes.ts';
import { createOrbMaterial } from '../src/desk/materials.ts';
import { GLOBE_STARS, starInGlobe } from '../src/logic/milestones.ts';

test('the cup steams only when you come back: eased in, then it fades out and stops', () => {
  assert.equal(Keepsakes.steamAt(-1), 0, 'not steaming');
  assert.equal(Keepsakes.steamAt(0), 0);
  assert.ok(Keepsakes.steamAt(1) > 0 && Keepsakes.steamAt(1) < 1, 'rising');
  assert.equal(Keepsakes.steamAt(STEAM.fadeIn + 1), 1);
  assert.ok(Keepsakes.steamAt(STEAM.seconds - 2) < 0.1, 'almost gone');
  assert.equal(Keepsakes.steamAt(STEAM.seconds + 1), 0, 'stopped');
  const k = new Keepsakes();
  k.set(['pebble', 'cup'], 0);
  for (let i = 0; i < 20; i++) k.update(0.5);
  assert.ok(k.steam > 0.5, `steams after arrival (${k.steam})`);
  for (let i = 0; i < 120; i++) k.update(0.5);
  assert.equal(k.steam, 0, 'quiet for the rest of the evening');
  k.set(['pebble'], 0);
  k.update(1);
  assert.equal(k.steam, 0, 'no cup, no steam');
});

test('keepsakes stand off the tray (its edge at x = −0.42 m) and apart from each other', () => {
  // Half-widths (m) of the Tripo models at their real size (tools/objets-28oct/keepsakes.json): pebble, cup + saucer, plant.
  const r = { pebble: 0.02, cup: 0.053, plant: 0.029 } as const;
  for (const [k, at] of Object.entries(KEEPSAKE_AT) as Array<[keyof typeof r, { x: number; z: number }]>) {
    assert.ok(at.x + r[k] < -0.425, `${k} clear of the tray`);
  }
  const keys = Object.keys(KEEPSAKE_AT) as Array<keyof typeof r>;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = KEEPSAKE_AT[keys[i]];
      const b = KEEPSAKE_AT[keys[j]];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > r[keys[i]] + r[keys[j]] + 0.015, `${keys[i]} / ${keys[j]} apart`);
    }
  }
});

test('the glass lamp: see-through (premultiplied), your stars addressable at starInGlobe(k), no candle anywhere', () => {
  const m = createOrbMaterial();
  assert.equal(m.transparent, true);
  assert.equal(m.uniforms.uStars.value.length, GLOBE_STARS);
  assert.deepEqual(m.uniforms.uStars.value[5].toArray(), starInGlobe(5));
  assert.match(m.fragmentShader, /innerLife/);
  assert.ok(!/candle/i.test(Object.keys(KEEPSAKE_AT).join(' ')));
});
