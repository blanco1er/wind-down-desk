import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { groundProfile, KEEPSAKE_SHADOW, SHADOW_LIFT, TOUCH_TOLERANCE } from '../src/logic/keepsake-ground.ts';

/** Reads the POSITION data of each named node of public/models/keepsakes.glb (no three.js in node tests). */
function modelPositions(): Record<string, Float32Array> {
  const b = readFileSync(new URL('../public/models/keepsakes.glb', import.meta.url));
  const len = b.readUInt32LE(12);
  const gltf = JSON.parse(b.subarray(20, 20 + len).toString());
  const bin = 20 + len + 8;
  const out: Record<string, Float32Array> = {};
  for (const node of gltf.nodes) {
    assert.ok(node.translation == null && node.scale == null && node.rotation == null, `${node.name}: no node transform (keepsakes.ts places the raw vertices)`);
    const acc = gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION];
    const view = gltf.bufferViews[acc.bufferView];
    const stride = view.byteStride ?? 12;
    const p = new Float32Array(acc.count * 3);
    for (let i = 0; i < acc.count; i++) for (let c = 0; c < 3; c++) p[i * 3 + c] = b.readFloatLE(bin + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0) + i * stride + c * 4);
    out[node.name] = p;
  }
  return out;
}

const models = modelPositions();

test('29 Oct: the pebble, the cup (its saucer) and the plant each touch the table', () => {
  for (const name of ['pebble', 'cup', 'plant'] as const) {
    const { minY } = groundProfile(models[name]);
    assert.ok(Math.abs(minY) <= TOUCH_TOLERANCE, `${name}: lowest point ${(minY * 1000).toFixed(2)} mm from the table`);
  }
});

test('the saucer rests on its foot ring, not on a single point', () => {
  const { rings } = groundProfile(models.cup);
  // Its foot (2 to 4 cm from the centre) is on the table all the way round.
  const foot = rings.filter((r) => r.r >= 0.02 && r.r < 0.035);
  assert.ok(foot.some((r) => r.y <= TOUCH_TOLERANCE), 'a ring of the foot touches');
  // Nothing of the saucer hangs lower than the table, and its rim never rises more than a real saucer's (≤ 8 mm).
  assert.ok(rings.every((r) => r.y >= -TOUCH_TOLERANCE && r.y <= 0.008), JSON.stringify(rings));
});

test('each contact shadow reaches beyond the object, so the saucer rim casts onto the table instead of floating', () => {
  for (const name of ['pebble', 'cup', 'plant'] as const) {
    const { footprint } = groundProfile(models[name]);
    const s = KEEPSAKE_SHADOW[name];
    assert.ok(s.radius > footprint && s.radius < footprint * 1.6, `${name}: shadow ${s.radius} m for a ${footprint.toFixed(3)} m footprint`);
    assert.ok(s.dark > 0.3 && s.dark < 0.8);
  }
  assert.ok(SHADOW_LIFT > 0 && SHADOW_LIFT < 0.001, 'the shadow lies on the table (under 1 mm)');
});
