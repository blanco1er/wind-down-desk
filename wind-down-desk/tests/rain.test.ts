import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLACES } from '../src/logic/places.ts';
import { dropSeeds, roofEdge, sheltered } from '../src/logic/rain-layout.ts';

const spec = PLACES['rain-veranda'].rain!;

test('v8 rain: you stay sheltered — under the roof and behind you, no rain', () => {
  assert.equal(sheltered(spec, 0, -0.6), true); // the desk, just ahead
  assert.equal(sheltered(spec, 0, -1.4), true); // still under the eave (front 1.5 m)
  assert.equal(sheltered(spec, 0, -2.0), false); // past the eave: rain
  assert.equal(sheltered(spec, 2.4, 0), true); // to the side, under the roof (2.6 m)
  assert.equal(sheltered(spec, 0, 3), true); // behind you: the house
  assert.ok(Math.abs(roofEdge(spec, 0) - spec.roofFront) < 1e-9);
});

test('v8 rain: every drop (three distance layers + eave drips) starts outside the roof, within budget', () => {
  const seeds = dropSeeds(spec);
  const n = seeds.length / 4;
  assert.equal(n, spec.drops[0] + spec.drops[1] + spec.drops[2] + 40);
  const layers = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const [yaw, r, , layer] = seeds.slice(i * 4, i * 4 + 4);
    layers[Math.min(3, Math.floor(layer))]++;
    const x = Math.sin(yaw) * r;
    const z = -Math.cos(yaw) * r;
    assert.ok(r >= roofEdge(spec, yaw), `drop ${i} inside the roof`);
    if (layer < 3) assert.equal(sheltered(spec, x, z), false, `drop ${i} sheltered`);
    assert.ok(r <= 24.01);
  }
  assert.deepEqual(layers, [...spec.drops, 40]);
});
