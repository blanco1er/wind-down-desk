import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gradedRadiance, irradiance, projectSH } from '../src/logic/sh-light.ts';

const W = 64;
const H = 32;
const flat = (v: number) => {
  const r = new Float32Array(W * H * 3);
  r.fill(v);
  return r;
};

test('a uniform place lights a matte surface with its own brightness, from every side', () => {
  const sh = projectSH(flat(0.1), W, H, 0);
  for (const n of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [0, 0, -1]] as const) {
    const e = irradiance(sh, [...n]);
    for (const c of e) assert.ok(Math.abs(c - 0.1) < 0.004, `${n}: ${c}`);
  }
});

test('a bright sky over a dark ground: the top of the tray is lit, the underside is not', () => {
  const r = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let i = 0; i < W * 3; i++) r[y * W * 3 + i] = y < H / 2 ? 0.2 : 0.01;
  const sh = projectSH(r, W, H, 0);
  assert.ok(irradiance(sh, [0, 1, 0])[0] > 3 * irradiance(sh, [0, -1, 0])[0]);
});

test('the panorama turn (yaw) turns the light with it: a fire in front lights the front', () => {
  const r = new Float32Array(W * H * 3);
  // A warm patch at u = 0.5 (straight ahead, −z, with yaw 0), on the horizon.
  for (let y = H / 2 - 2; y < H / 2 + 2; y++) for (let x = W / 2 - 3; x < W / 2 + 3; x++) r.set([2, 0.8, 0.2], (y * W + x) * 3);
  const ahead = projectSH(r, W, H, 0);
  assert.ok(irradiance(ahead, [0, 0, -1])[0] > 5 * irradiance(ahead, [0, 0, 1])[0]);
  const turned = projectSH(r, W, H, Math.PI);
  assert.ok(irradiance(turned, [0, 0, 1])[0] > 5 * irradiance(turned, [0, 0, -1])[0]);
});

test('"Table stays": the real room lights you from below, the place from above', () => {
  const sh = projectSH(flat(0.2), W, H, 0, 0, [0.02, 0.02, 0.02]);
  assert.ok(irradiance(sh, [0, -1, 0])[0] < irradiance(sh, [0, 1, 0])[0] * 0.6);
});

test('grading follows the panorama shader: exposure and the ground sinking into shadow', () => {
  const px = new Uint8ClampedArray(W * H * 4).fill(128);
  const g = gradedRadiance(px, W, H, { exposure: 0.5, tint: [1, 1, 1], saturation: 1, night: 0 });
  const top = g[(2 * W) * 3];
  const bottom = g[((H - 2) * W) * 3];
  assert.ok(Math.abs(top - 0.2158 * 0.5) < 0.01, `top ${top}`);
  assert.ok(bottom < top * 0.3);
});
