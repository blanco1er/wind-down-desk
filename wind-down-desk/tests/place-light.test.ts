import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adaptLight, ROOM_LIGHT, type PlaceMeasure } from '../src/logic/places.ts';

const dusk: PlaceMeasure = { sky: [0.14, 0.12, 0.13], ground: [0.1, 0.09, 0.08], lum: 0.12 };
const night: PlaceMeasure = { sky: [0.01, 0.014, 0.03], ground: [0.012, 0.01, 0.008], lum: 0.012 };

test('a dusk place keeps the hand-tuned key', () => {
  const l = adaptLight(ROOM_LIGHT, dusk);
  assert.ok(Math.abs(l.key[0] - ROOM_LIGHT.key[0]) < 1e-9);
});

test('a night place lowers the key: the lamp becomes the light', () => {
  const l = adaptLight(ROOM_LIGHT, night);
  assert.ok(l.key[0] < ROOM_LIGHT.key[0] * 0.45, `key ${l.key[0]}`);
  assert.ok(l.key[0] >= ROOM_LIGHT.key[0] * 0.22 - 1e-9, 'never pitch black');
});

test('a night sky tints the sky fill toward blue, never a cast', () => {
  const l = adaptLight(ROOM_LIGHT, night);
  assert.ok(l.fillSky[2] / l.fillSky[0] > ROOM_LIGHT.fillSky[2] / ROOM_LIGHT.fillSky[0]);
  for (const c of l.fillSky) assert.ok(c > 0 && c < 0.2);
});

test('"Table stays" keeps half the effect (the real room still lights the tray)', () => {
  const full = adaptLight(ROOM_LIGHT, night, 1).key[0];
  const table = adaptLight(ROOM_LIGHT, night, 0).key[0];
  assert.ok(table > full && table < ROOM_LIGHT.key[0]);
});

test('no measure yet: unchanged', () => {
  assert.deepEqual(adaptLight(ROOM_LIGHT, null), ROOM_LIGHT);
});
