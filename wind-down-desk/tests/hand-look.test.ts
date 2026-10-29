import assert from 'node:assert/strict';
import { test } from 'node:test';
import { curlStrength, FILL_OPACITY, fillOpacity, fingerOfJoint, handStage, META_HAND, nearness, pinchStrength } from '../src/logic/hand-look.ts';

const hex = (c: readonly number[]) => c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');

test("Meta's hand colours: two dark greys by fresnel, a light grey outline, white when a finger pinches", () => {
  assert.equal(hex(META_HAND.fillFace), '323436');
  assert.equal(hex(META_HAND.fillEdge), '1f2021');
  assert.equal(hex(META_HAND.outline), '898989');
  assert.equal(hex(META_HAND.outlineLit), 'ffffff');
  // Never the warm "glass" hands of 23 Oct: neutral greys, the fill darker than the outline.
  for (const c of [META_HAND.fillFace, META_HAND.fillEdge, META_HAND.outline]) assert.ok(Math.max(...c) - Math.min(...c) < 0.02, 'neutral grey');
  assert.ok(META_HAND.fillFace[0] < META_HAND.outline[0]);
  assert.ok(META_HAND.wristFade[0] > 0 && META_HAND.wristFade[1] > META_HAND.wristFade[0], 'fades out toward the wrist');
});

test('stage: Full immersion is VR; otherwise passthrough on a headset, simulated in an emulator', () => {
  assert.equal(handStage(true, false), 'vr');
  assert.equal(handStage(true, true), 'vr');
  assert.equal(handStage(false, false), 'passthrough');
  assert.equal(handStage(false, true), 'simulated');
});

test("fill: Meta's 0.79 in VR; in passthrough a faint tint over the real hand that grows near a stone or a pinch", () => {
  assert.equal(fillOpacity('vr', 0, 0), 0.79);
  assert.equal(fillOpacity('vr', 1, 1), 0.79);
  const [rest, close] = FILL_OPACITY.passthrough;
  assert.ok(rest <= 0.15, 'your real hand stays visible through it');
  assert.equal(fillOpacity('passthrough', 0, 0), rest);
  assert.equal(fillOpacity('passthrough', 1, 0), close);
  assert.equal(fillOpacity('passthrough', 0, 1), close);
  assert.ok(fillOpacity('passthrough', 0.5, 0) > rest && fillOpacity('passthrough', 0.5, 0) < close);
  assert.ok(FILL_OPACITY.simulated[0] < META_HAND.vrOpacity, 'still transparent in the emulator');
  assert.equal(fillOpacity('simulated', 7, -3), FILL_OPACITY.simulated[1], 'clamped');
});

test('pinch, curl and nearness are 0..1 and monotonic', () => {
  assert.equal(pinchStrength(0.1), 0);
  assert.equal(pinchStrength(0.01), 1);
  assert.ok(pinchStrength(0.03) > pinchStrength(0.05));
  assert.equal(curlStrength(0.17), 0, 'open hand');
  assert.equal(curlStrength(0.1), 1, 'fist');
  assert.equal(nearness(0.3), 0);
  assert.equal(nearness(0.02), 1);
  assert.ok(nearness(0.08) > nearness(0.12));
});

test('finger of each WebXR joint (which outline lights up)', () => {
  assert.equal(fingerOfJoint('thumb-metacarpal'), 0);
  assert.equal(fingerOfJoint('thumb-tip'), 0);
  assert.equal(fingerOfJoint('index-finger-phalanx-distal'), 1);
  assert.equal(fingerOfJoint('middle-finger-tip'), 2);
  assert.equal(fingerOfJoint('ring-finger-tip'), 3);
  assert.equal(fingerOfJoint('pinky-finger-phalanx-proximal'), 3);
  assert.equal(fingerOfJoint('index-finger-metacarpal'), -1, 'palm');
  assert.equal(fingerOfJoint('wrist'), -1);
});
