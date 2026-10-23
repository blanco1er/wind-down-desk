import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floorForMemory, FrameGovernor, knobsFor } from '../src/logic/quality.ts';
import { decideSafeMode, markBadStart, markSessionStart, markSettled } from '../src/logic/safe-mode.ts';
import { cleanErrorMessage, ErrorReports, errorType } from '../src/logic/error-report.ts';

/** Feeds the governor `seconds` of frames at `fps`, `cpu` ms each, with a share of `slow` frames at 2× the interval. */
function run(g: FrameGovernor, t0: number, seconds: number, fps: number, cpu: number, slow = 0): { t: number; changes: number[] } {
  const changes: number[] = [];
  let t = t0;
  let i = 0;
  while (t < t0 + seconds) {
    const missed = slow > 0 && i % Math.round(1 / slow) === 0;
    const dt = (1000 / fps) * (missed ? 2 : 1);
    t += dt / 1000;
    const r = g.sample(dt, cpu, t);
    if (r != null) changes.push(r);
    i++;
  }
  return { t, changes };
}

test('adaptive quality: a steady 72 Hz never changes anything; missed frames step down one level at a time', () => {
  const g = new FrameGovernor({ displayHz: 72 });
  let r = run(g, 0, 60, 72, 5);
  assert.deepEqual(r.changes, [], 'calm 72 Hz: level 0 all evening');
  r = run(g, r.t, 4, 72, 5, 0.2);
  assert.deepEqual(r.changes, [1], '20 % missed frames → level 1 after two evaluations');
  r = run(g, r.t, 8, 72, 5, 0.2);
  assert.ok(r.changes.length >= 1 && r.changes.every((c, i) => c === 2 + i), `then 2, 3… one by one (${r.changes})`);
});

test('adaptive quality: the app’s own CPU near the frame budget steps down too (a slow app at a steady rate)', () => {
  const g = new FrameGovernor({ displayHz: 72 });
  const r = run(g, 0, 12, 72, 12.5);
  assert.equal(r.changes[0], 1);
});

test('adaptive quality: a calm margin brings the level back up after 20 s; a level that fails again is locked', () => {
  const g = new FrameGovernor({ displayHz: 72 });
  let r = run(g, 0, 10, 72, 5, 0.25);
  assert.ok(g.level >= 1);
  const low = g.level;
  r = run(g, r.t, 30, 72, 4);
  assert.equal(g.level, low - 1, 'one level back up after a calm stretch (20 s)');
  r = run(g, r.t, 5, 72, 5, 0.25);
  assert.equal(g.level, low, 'it failed again → back down');
  r = run(g, r.t, 90, 72, 4);
  assert.equal(g.level, low, 'and that level is not tried again this evening');
});

test('adaptive quality: without the session rate, the display interval is estimated (a 60 Hz desktop is not "slow")', () => {
  const g = new FrameGovernor({ displayHz: null });
  const r = run(g, 0, 30, 60, 4);
  assert.deepEqual(r.changes, []);
  assert.ok(Math.abs(g.last.nominalMs - 16.67) < 0.5);
});

test('quality knobs: 8k off from level 2, living layers simplified at 3, safe mode keeps the evening but no extras', () => {
  assert.deepEqual(knobsFor(0), { aura: 1, dust: 1, hd: true, living: 'full' });
  assert.equal(knobsFor(2).hd, false);
  assert.equal(knobsFor(3).living, 'simple');
  assert.deepEqual(knobsFor(0, true), { aura: 0, dust: 0, hd: false, living: 'off' });
});

test('safe mode: ?safe=1 now and remembered, ?safe=0 resets, two bad starts in a week turn it on', () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  const day = 86_400_000;
  assert.equal(decideSafeMode('', store, 0).safe, false);
  // A session that never settled, twice: safe mode.
  markSessionStart(store);
  assert.equal(decideSafeMode('', store, 1000).safe, false, 'one bad start: not yet');
  markSessionStart(store);
  const d = decideSafeMode('', store, 2000);
  assert.deepEqual([d.safe, d.why, d.badStarts], [true, 'crashes', 2]);
  assert.equal(decideSafeMode('', store, 3000).why, 'remembered');
  assert.equal(decideSafeMode('?safe=0', store, 4000).safe, false);
  assert.equal(decideSafeMode('', store, 5000).safe, false, 'reset for good');
  // A settled session is never counted; old bad starts expire after a week.
  markSessionStart(store);
  markSettled(store);
  assert.equal(decideSafeMode('', store, 6000).badStarts, 0);
  markBadStart(store, 0);
  assert.equal(decideSafeMode('', store, 8 * day).badStarts, 0);
  assert.equal(decideSafeMode('?safe=1', store, 9 * day).why, 'param');
  assert.equal(decideSafeMode('', store, 10 * day).safe, true, 'remembered');
  // No storage (private mode): never in the way.
  assert.equal(decideSafeMode('', null, 0).safe, false);
});

test('error reports: type and a short cleaned message, never quoted text, each once, 8 at most', () => {
  assert.equal(cleanErrorMessage('Cannot read properties of undefined (reading "position")'), 'Cannot read properties of undefined (reading …)');
  assert.equal(cleanErrorMessage(`Failed to parse "I can't sleep because of my boss"`), 'Failed to parse …');
  assert.ok(!cleanErrorMessage('fetch https://example.com/api/talk?text=my%20secret failed').includes('secret'));
  assert.ok(cleanErrorMessage('x'.repeat(300)).length <= 80);
  assert.equal(errorType(new TypeError('x')), 'TypeError');
  const r = new ErrorReports(2);
  assert.equal(r.accept('window', 'TypeError', 'a'), true);
  assert.equal(r.accept('window', 'TypeError', 'a'), false);
  assert.equal(r.accept('window', 'TypeError', 'b'), true);
  assert.equal(r.accept('window', 'TypeError', 'c'), false, 'at most 2 here');
});

test('low memory: 4 GB or less never loads the 8k places; unknown memory is not a limit', () => {
  assert.equal(floorForMemory(2), 2);
  assert.equal(floorForMemory(4), 2);
  assert.equal(floorForMemory(8), 0);
  assert.equal(floorForMemory(undefined), 0);
});

test('the server re-cleans error messages from the page (never trusts it) and keeps the new safety events', async () => {
  const { cleanMsg, EVENTS } = await import('../server/visits.ts');
  assert.equal(cleanMsg('Failed to parse "my landlord never answers"'), 'Failed to parse …');
  assert.equal(cleanMsg(''), null);
  assert.equal(cleanMsg(42), null);
  for (const e of ['client-error', 'quality', 'safe-mode', 'gl-lost', 'input', 'voice-down']) assert.ok(EVENTS[e] != null, e);
  assert.deepEqual(EVENTS['client-error'], ['where', 'type', 'msg']);
});
