import assert from 'node:assert/strict';
import { test } from 'node:test';
import { caption, initialRitual, step, type RitualState } from '../src/logic/ritual.ts';
import { rms, VadSegmenter } from '../src/logic/vad.ts';

test('VAD opens on sustained speech and closes after a pause', () => {
  const vad = new VadSegmenter({ attackMs: 100, hangoverMs: 600 });
  const events: Array<[string, number]> = [];
  const feed = (level: number, from: number, to: number) => {
    for (let t = from; t < to; t += 33) {
      const e = vad.push(level, t);
      if (e != null) events.push([e, t]);
    }
  };
  feed(0.004, 0, 1000); // room noise
  feed(0.08, 1000, 1050); // a click: too short
  feed(0.004, 1050, 1500);
  feed(0.09, 1500, 3500); // speech
  feed(0.005, 3500, 4500); // pause
  assert.deepEqual(events.map((e) => e[0]), ['start', 'end']);
  assert.ok(events[0][1] >= 1600 && events[0][1] < 1700);
  assert.ok(events[1][1] >= 4100);
});

test('VAD caps very long utterances', () => {
  const vad = new VadSegmenter({ maxUtteranceMs: 2000, attackMs: 66 });
  let ends = 0;
  for (let t = 0; t < 5000; t += 33) if (vad.push(0.1, t) === 'end') ends++;
  assert.ok(ends >= 2);
  assert.ok(Math.abs(rms(new Float32Array([0.5, -0.5, 0.5, -0.5])) - 0.5) < 1e-9);
});

test('scripted evening: onboarding reaches the first sort well under 60 s', () => {
  // Timings from the demo script: arrive, talk ~20 s, agent places tokens, sort.
  let s: RitualState = initialRitual();
  s = step(s, { type: 'placed' }, 2.5);
  assert.equal(s.phase, 'dump');
  assert.match(caption(s, { listening: true, micAvailable: true, unsorted: 0 }), /What is on your mind/u);
  s = step(s, { type: 'tokens-added', count: 5 }, 24);
  s = step(s, { type: 'dump-done' }, 27);
  assert.equal(s.phase, 'sort');
  for (let remaining = 4; remaining >= 0; remaining--) {
    s = step(s, { type: 'sorted', remaining }, 33 + (4 - remaining) * 6);
  }
  assert.equal(s.phase, 'plan');
  assert.ok((s.milestones.firstToken ?? 99) < 30);
  assert.ok((s.milestones.firstSort ?? 99) < 60, `first sort at ${s.milestones.firstSort}s`);
  s = step(s, { type: 'plan-kept' }, 62);
  assert.equal(s.phase, 'night');
  assert.equal(caption(s, { listening: false, micAvailable: true, unsorted: 0 }), 'Your desk is clear. Good night.');
});

test('sorting while still talking is allowed and an empty dump cannot advance', () => {
  let s = step(initialRitual(), { type: 'placed' }, 1);
  s = step(s, { type: 'dump-done' }, 2);
  assert.equal(s.phase, 'dump', 'nothing to sort yet');
  s = step(s, { type: 'tokens-added', count: 2 }, 5);
  s = step(s, { type: 'sorted', remaining: 1 }, 8);
  assert.equal(s.phase, 'sort');
});
