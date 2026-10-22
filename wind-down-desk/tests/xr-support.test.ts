import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isComputer, planLanding, sessionModeFor, shortAddress } from '../src/logic/xr-support.ts';

const laptop = { finePointer: true, width: 1440, previewParam: false };
const iphone = { finePointer: false, width: 390, previewParam: false };

test('a Quest gets passthrough, a VR-only headset gets VR, everything else gets no button', () => {
  assert.equal(sessionModeFor({ api: true, ar: true, vr: true }), 'immersive-ar');
  assert.equal(sessionModeFor({ api: true, ar: false, vr: true }), 'immersive-vr');
  assert.equal(sessionModeFor({ api: true, ar: false, vr: false }), 'none', 'desktop Chrome without a headset');
  assert.equal(sessionModeFor({ api: true, ar: null, vr: null }), 'none', 'no answer in time');
  assert.equal(sessionModeFor({ api: false, ar: null, vr: null }), 'none', 'iPhone Safari: no navigator.xr');
});

test('the emulated preview is offered on a computer only, and started only when asked', () => {
  const none = { api: true, ar: false, vr: false };
  assert.deepEqual(planLanding(none, laptop), { mode: 'none', offerPreview: true, startPreview: false });
  assert.deepEqual(planLanding(none, { ...laptop, previewParam: true }), { mode: 'none', offerPreview: true, startPreview: true });
  assert.deepEqual(planLanding({ api: false, ar: null, vr: null }, { ...iphone, previewParam: true }), { mode: 'none', offerPreview: false, startPreview: false }, 'never on a phone');
  assert.equal(planLanding({ api: true, ar: true, vr: true }, laptop).offerPreview, false, 'a headset browser gets Begin');
  assert.equal(planLanding({ api: true, ar: false, vr: true }, { ...laptop, previewParam: true }).startPreview, true, 'after a failed PC session, preview on request');
  assert.equal(isComputer(true, 899), false);
  assert.equal(isComputer(false, 1600), false, 'a big touch screen');
});

test('the address on the card is short and readable', () => {
  assert.equal(shortAddress('https://wind-down-desk.onrender.com/'), 'wind-down-desk.onrender.com');
  assert.equal(shortAddress('https://wind-down-desk.onrender.com/', 'winddown.desk'), 'winddown.desk');
  assert.equal(shortAddress('http://localhost:8799/'), 'localhost:8799');
  assert.equal(shortAddress('https://example.org/app/'), 'example.org/app');
});
