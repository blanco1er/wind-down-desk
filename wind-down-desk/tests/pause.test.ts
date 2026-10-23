import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PauseGate, xrVisible } from '../src/logic/pause.ts';

test('Meta button (visible-blurred) or headset off (hidden) pauses; visible again resumes', () => {
  const g = new PauseGate();
  assert.equal(g.set('xr', xrVisible('visible-blurred')), 'pause');
  assert.equal(g.set('xr', xrVisible('hidden')), null, 'already paused: nothing twice');
  assert.equal(g.set('xr', xrVisible('visible')), 'resume');
  assert.equal(g.set('xr', xrVisible('visible')), null, 'already running: never resumes twice (no double listening)');
});

test('both sources must be visible to resume; a session end clears its source', () => {
  const g = new PauseGate();
  g.set('xr', false);
  assert.equal(g.set('page', false), null);
  assert.equal(g.set('xr', true), null, 'the page is still hidden');
  assert.equal(g.set('page', true), 'resume');
  g.set('xr', false);
  assert.equal(g.clear('xr'), 'resume');
  assert.equal(xrVisible(undefined), true);
});
