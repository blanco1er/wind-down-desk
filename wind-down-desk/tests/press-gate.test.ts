import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GLOBE_STEP_S, PressGate, SAME_PRESS_S } from '../src/logic/press-gate.ts';

test('press gate: a shaking fingertip on the same button is one touch', () => {
  const g = new PressGate();
  assert.equal(g.allow('setting:text', 10), true);
  assert.equal(g.allow('setting:text', 10 + SAME_PRESS_S - 0.05), false, 'the tremor re-entry is ignored');
  assert.equal(g.allow('setting:text', 10 + SAME_PRESS_S + 0.3), true, 'a real second touch later still counts');
});

test('press gate: different buttons never block each other; the globe arrows repeat faster', () => {
  const g = new PressGate();
  assert.equal(g.allow('places', 5), true);
  assert.equal(g.allow('rituals', 5.05), true);
  assert.equal(g.allow('globe-next', 6), true);
  assert.equal(g.allow('globe-next', 6 + GLOBE_STEP_S + 0.01), true);
  assert.equal(g.allow('globe-next', 6 + GLOBE_STEP_S + 0.05), false);
});
