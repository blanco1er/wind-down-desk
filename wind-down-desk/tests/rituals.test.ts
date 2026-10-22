import assert from 'node:assert/strict';
import { test } from 'node:test';
import { breathAt, breathCaption, breathLine, BreatheSession, BREATH_LINES, DEFAULT_BREATH, MAX_CYCLES, opennessFromCurl } from '../src/logic/breathe.ts';
import { initialRelease, overWater, releaseCaption, stepRelease, WATER_BOWL, type ReleaseEvent } from '../src/logic/release.ts';
import { lampLines, lineKey } from '../src/logic/lamp-lines.ts';

// ------------------------------------------------------------------ Breathe

test('breathe: 4 in, 6 out, six cycles, settle then close (≈ 72 s)', () => {
  const p = DEFAULT_BREATH;
  assert.equal(p.inhale + p.exhale, 10, '6 breaths a minute');
  assert.equal(breathAt(p, 0).phase, 'settle');
  assert.equal(breathAt(p, p.settle + 0.1).phase, 'in');
  assert.equal(breathAt(p, p.settle + 4.1).phase, 'out');
  assert.equal(breathAt(p, p.settle + 10.1).cycle, 1);
  const end = p.settle + p.cycles * 10;
  assert.equal(breathAt(p, end - 0.1).phase, 'out');
  assert.equal(breathAt(p, end + 0.1).phase, 'close');
  assert.equal(breathAt(p, end + p.close + 0.1).phase, 'done');
  assert.ok(end + p.close > 65 && end + p.close < 80);
});

test('breathe: the light swells on the inhale and fades on the exhale, continuously', () => {
  const p = DEFAULT_BREATH;
  const s = p.settle;
  assert.ok(breathAt(p, s + 0.01).level < 0.01);
  assert.ok(Math.abs(breathAt(p, s + 2).level - 0.5) < 1e-9);
  assert.ok(breathAt(p, s + 3.99).level > 0.99);
  assert.ok(Math.abs(breathAt(p, s + 4 + 3).level - 0.5) < 1e-9);
  // No jump anywhere: level and presence move by small steps at 72 Hz.
  let prev = breathAt(p, 0);
  for (let t = 1 / 72; t < s + p.cycles * 10 + p.close + 1; t += 1 / 72) {
    const f = breathAt(p, t);
    assert.ok(Math.abs(f.level - prev.level) < 0.02, `level jump at ${t.toFixed(2)}`);
    assert.ok(Math.abs(f.presence - prev.presence) < 0.02, `presence jump at ${t.toFixed(2)}`);
    prev = f;
  }
});

test('breathe: finishing early deflates gently from the current fullness, then ends', () => {
  const b = new BreatheSession();
  b.begin(100);
  const t = 100 + DEFAULT_BREATH.settle + 3; // late in the first inhale
  const before = b.frame(t).level;
  b.finish(t);
  assert.ok(b.finishing);
  assert.equal(b.frame(t).phase, 'close');
  assert.ok(Math.abs(b.frame(t).level - before) < 1e-9, 'no jump when finishing');
  assert.ok(b.frame(t + 1.5).level < before && b.frame(t + 1.5).level > 0, 'a slow last exhale');
  assert.equal(b.frame(t + 3 * before + 0.01).presence > 0.99, true);
  assert.equal(b.frame(t + 3 * before + DEFAULT_BREATH.close + 0.1).phase, 'done');
  assert.equal(b.frame(t + 30).completed, 0);
  assert.equal(b.longer(), false, 'no "longer" once closing');
});

test('breathe: "longer" adds four cycles, up to twelve', () => {
  const b = new BreatheSession();
  b.begin(0);
  assert.equal(b.longer(), true);
  assert.equal(b.pattern.cycles, 10);
  assert.equal(b.longer(), true);
  assert.equal(b.pattern.cycles, MAX_CYCLES);
  assert.equal(b.longer(), false);
  assert.equal(DEFAULT_BREATH.cycles, 6, 'the default pattern is never mutated');
});

test('breathe: hand-follow is detected, optional, and per cycle', () => {
  const b = new BreatheSession();
  b.begin(0);
  const s = DEFAULT_BREATH.settle;
  // Cycle 0: hands open on the inhale, close on the exhale.
  for (let t = s; t < s + 4; t += 0.1) b.sample(t, opennessFromCurl(0.1 + 0.07 * ((t - s) / 4)));
  for (let t = s + 4; t < s + 10; t += 0.1) b.sample(t, opennessFromCurl(0.17 - 0.07 * ((t - s - 4) / 6)));
  // Cycle 1: hands still (not tracked at all for the exhale).
  for (let t = s + 10; t < s + 14; t += 0.1) b.sample(t, 0.8);
  for (let t = s + 14; t < s + 20; t += 0.1) b.sample(t, null);
  assert.equal(b.followed(0), true);
  assert.equal(b.followed(1), false);
  assert.equal(b.followedCount(), 1);
  assert.equal(opennessFromCurl(0.2), 1);
  assert.equal(opennessFromCurl(0.05), 0);
});

test('breathe: captions match the concept, voice guides then lets silence carry it', () => {
  const p = DEFAULT_BREATH;
  const s = p.settle;
  assert.equal(breathCaption(breathAt(p, s + 1), p).text, 'Breathe in… 4');
  assert.equal(breathCaption(breathAt(p, s + 5), p).text, '…and out. 6');
  assert.match(breathCaption(breathAt(p, s + 60 + 1), p).sub, /6 slow breaths/u);
  const spoken = Array.from({ length: p.cycles }, (_, c) => [breathLine(breathAt(p, s + c * 10 + 0.1), p), breathLine(breathAt(p, s + c * 10 + 4.1), p)]);
  assert.deepEqual(spoken[0], ['Breathe in.', 'And out, slowly.']);
  assert.deepEqual(spoken[2], [null, null], 'quiet in the middle');
  assert.deepEqual(spoken[5], ['Last one. Breathe in.', 'And out.']);
  const keys = new Set(lampLines().map(lineKey));
  for (const line of BREATH_LINES) assert.ok(keys.has(lineKey(line)), `not voiced: ${line}`);
});

// ------------------------------------------------------------------ Release

test('release: ask → forming → hold → over → sinking → gone → done', () => {
  let s = initialRelease();
  assert.equal(s.phase, 'ask');
  const run = (...events: ReleaseEvent[]) => events.forEach((e) => (s = stepRelease(s, e)));
  run({ type: 'heard', title: 'The meeting with Paul' });
  assert.equal(s.phase, 'forming');
  run({ type: 'formed' }, { type: 'over', over: true });
  assert.equal(s.phase, 'over');
  run({ type: 'over', over: false });
  assert.equal(s.phase, 'hold');
  run({ type: 'over', over: true }, { type: 'drop', overWater: true });
  assert.equal(s.phase, 'sinking');
  assert.equal(s.released, false, 'nothing recorded until it has sunk');
  run({ type: 'sunk' });
  assert.equal(s.phase, 'gone');
  assert.equal(s.released, true);
  assert.equal(s.via, 'hand');
  run({ type: 'settled' });
  assert.equal(s.phase, 'done');
  assert.equal(releaseCaption(s, true).text, 'Gone. Breathe out.');
});

test('release: a drop away from the water returns the stone; voice can always let it sink', () => {
  let s = initialRelease('Money');
  assert.equal(s.phase, 'forming', 'what was heard by the agent skips the question');
  s = stepRelease(s, { type: 'formed' });
  s = stepRelease(s, { type: 'drop', overWater: false });
  assert.equal(s.phase, 'hold');
  assert.equal(s.misses, 1);
  assert.match(releaseCaption(s, true).sub, /let it go/u);
  s = stepRelease(s, { type: 'voice-sink' });
  assert.equal(s.phase, 'sinking');
  assert.equal(s.via, 'voice');
  // Out-of-order events are ignored.
  assert.equal(stepRelease(initialRelease(), { type: 'sunk' }).phase, 'ask');
  assert.equal(stepRelease(initialRelease(), { type: 'drop', overWater: true }).phase, 'ask');
  assert.equal(stepRelease(initialRelease(), { type: 'heard', title: '  ' }).phase, 'ask');
  assert.equal(stepRelease(s, { type: 'cancel' }).phase, 'done');
});

test('release: "over the water" is inside the rim, above the surface, within reach', () => {
  const c = { x: WATER_BOWL.x, z: WATER_BOWL.z };
  assert.equal(overWater({ ...c, y: WATER_BOWL.water + 0.1 }), true);
  assert.equal(overWater({ x: c.x + WATER_BOWL.inner - 0.01, y: 0.12, z: c.z }), true);
  assert.equal(overWater({ x: c.x + WATER_BOWL.outer + 0.03, y: 0.12, z: c.z }), false);
  assert.equal(overWater({ ...c, y: 0.6 }), false, 'too high: not "holding it over" any more');
  assert.equal(releaseCaption(initialRelease(), false).sub.includes('Touch one of tonight'), true, 'no microphone: a hand path');
  assert.equal(releaseCaption(initialRelease(), true, true).sub.includes('Say'), false, 'quiet evening: never asked to talk');
});

test('the evening darkens with you: blue hour, deeper each ritual, night at Good night, never a jump', async () => {
  const { eveningTarget, eveningStep } = await import('../src/logic/evening-light.ts');
  let t = eveningTarget('arrive', 0, 0);
  assert.ok(t > 0.05 && t < 0.2, 'blue hour on arrival');
  t = eveningTarget('unload', 0, t);
  const afterRelease = eveningTarget('choose', 2, eveningTarget('release', 1, t));
  assert.ok(afterRelease >= 0.52, 'never lighter after a ritual');
  assert.ok(eveningTarget('night', 3, afterRelease) > 0.9, 'night at Good night');
  assert.equal(eveningTarget('choose', 0, 0.6), 0.6, 'monotonic during the evening');
  assert.equal(eveningTarget('morning', 0, 0.9), 0, 'the morning is light again');
  // Slow: one frame never moves more than a hair.
  assert.ok(eveningStep(0.1, 0.95, 1 / 72) - 0.1 < 0.001);
});
