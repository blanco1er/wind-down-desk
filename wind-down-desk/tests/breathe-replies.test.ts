import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breatheReplyPose, MOON, moonCentreY } from '../src/desk/geometry.ts';
import { createDeskLayout } from '../src/logic/desk-layout.ts';

/**
 * 28 Oct (film review): at the default seated head height (tools/stage.sh), the moon hid "Longer" / "Enough".
 * From the seat, with the moon at its fullest (inhaled radius), each reply must be: never behind the moon, never in
 * front of the moon or of the tray, at least 4.4 cm, within ±37° of the gaze to the tray centre, and ≤ 60 cm from
 * the shoulder (25 cm under the eyes, 5 cm back, as tools/onboarding/reach-fov.mjs). Head heights −10, −5, 0, +5,
 * +10 cm, head 5 cm left / right, normal and large text.
 * Eye (desk-local) measured in the emulator after `sh tools/stage.sh 54 30`: (0, 0.391, 0.582).
 */
type V = [number, number, number];
const SEAT: V = [0, 0.391, 0.582];
/** Reply capsule, measured in the emulator (tools/fixes-28oct/breathe-check.mjs): 10.5 × 4.9 cm, × large-text scale. */
const CHIP = { w: 0.105, h: 0.049 };
const layout = createDeskLayout();
const R = MOON.inhaled;
const C: V = [MOON.x, moonCentreY(R, MOON.foot), MOON.z];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const deg = (r: number) => (r * 180) / Math.PI;

function audit(eye: V, side: -1 | 1, ck: number) {
  const p = breatheReplyPose(side, ck);
  const r = { behindMoon: 0, overMoon: 0, overTray: 0, maxAngle: 0, reach: 0 };
  const shoulder: V = [eye[0], eye[1] - 0.25, eye[2] + 0.05];
  r.reach = Math.hypot(...sub([p.x, p.y, p.z], shoulder));
  const pitch0 = Math.atan2(-eye[1], Math.hypot(eye[0], eye[2]));
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 2; j++) {
      const lx = (-0.5 + i / 4) * CHIP.w * ck;
      const ly = (-0.5 + j / 2) * CHIP.h * ck;
      const q: V = [p.x + lx, p.y + ly * Math.cos(p.tilt), p.z + ly * Math.sin(p.tilt)];
      const d = sub(q, eye);
      const o = sub(eye, C);
      const a = dot(d, d);
      const b = 2 * dot(o, d);
      const disc = b * b - 4 * a * (dot(o, o) - R * R);
      if (disc >= 0) {
        const t = (-b - Math.sqrt(disc)) / (2 * a);
        if (t > 0.001 && t < 1) r.behindMoon++;
        else if (t >= 1) r.overMoon++;
      }
      if (d[1] < 0) {
        const t = (0.012 - eye[1]) / d[1];
        const x = eye[0] + d[0] * t;
        const z = eye[2] + d[2] * t;
        if (t > 1 && Math.abs(x) <= layout.width / 2 && Math.abs(z) <= layout.depth / 2) r.overTray++;
      }
      const h = deg(Math.atan2(d[0], -d[2]));
      const v = deg(Math.atan2(d[1], Math.hypot(d[0], d[2])) - pitch0);
      r.maxAngle = Math.max(r.maxAngle, Math.abs(h), Math.abs(v));
    }
  }
  return r;
}

test('Breathe: "Longer" / "Enough" stay visible and reachable beside the full moon, at several head heights', () => {
  for (const dy of [-0.1, -0.05, 0, 0.05, 0.1]) {
    for (const dx of [-0.05, 0, 0.05]) {
      for (const ck of [1, 1.1]) {
        for (const side of [-1, 1] as const) {
          const eye: V = [SEAT[0] + dx, SEAT[1] + dy, SEAT[2]];
          const r = audit(eye, side, ck);
          const where = `head ${dy * 100} cm, ${dx * 100} cm aside, text ×${ck}, ${side < 0 ? 'Longer' : 'Enough'}`;
          assert.equal(r.behindMoon, 0, `${where}: ${r.behindMoon}/15 points hidden by the moon`);
          assert.equal(r.overMoon, 0, `${where}: stands in front of the moon`);
          assert.equal(r.overTray, 0, `${where}: stands in front of the tray`);
          assert.ok(r.maxAngle <= 37, `${where}: ${r.maxAngle.toFixed(1)}° from the gaze`);
          assert.ok(r.reach <= 0.6, `${where}: ${(r.reach * 100).toFixed(1)} cm from the shoulder`);
          assert.ok(CHIP.h * ck >= 0.044, 'touch target ≥ 4.4 cm');
        }
      }
    }
  }
});

test('the moon formula keeps the resting lamp height when the globe is small', () => {
  assert.ok(Math.abs(moonCentreY(0.025, 1) - 0.0319) < 0.001);
  assert.ok(moonCentreY(MOON.inhaled, MOON.foot) > moonCentreY(MOON.exhaled, MOON.foot));
});
