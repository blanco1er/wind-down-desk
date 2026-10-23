import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ghostFrame, ghostTarget, ONBOARDING, onboardingStep, type OnboardingInput } from '../src/logic/onboarding.ts';
import { proposeRitual } from '../src/logic/evening.ts';
import { easeToward, GAZE, GazeFocus, gazePick } from '../src/logic/gaze.ts';

const base: OnboardingInput = { firstEvening: true, mode: 'unload', phase: 'dump', stonesOnDesk: 0, sortedThisSession: 0, holding: false, idle: 0, exampleShown: false };

test('silence for 8 s with an empty tray → one example stone, once', () => {
  assert.equal(onboardingStep({ ...base, idle: 7.9 }).spawnExample, false);
  assert.equal(onboardingStep({ ...base, idle: 8 }).spawnExample, true);
  assert.equal(onboardingStep({ ...base, idle: 20, exampleShown: true }).spawnExample, false, 'never twice');
  assert.equal(onboardingStep({ ...base, idle: 20, stonesOnDesk: 1 }).spawnExample, false, 'they already talked');
  assert.equal(onboardingStep({ ...base, idle: 20, mode: 'breathe' }).spawnExample, false, 'not in another ritual');
});

test('the ghost hand shows the gesture after 2 s of idle hands, until the first stone is placed', () => {
  const withStone = { ...base, phase: 'sort', stonesOnDesk: 1 };
  assert.equal(onboardingStep({ ...withStone, idle: 1 }).ghost, false);
  assert.equal(onboardingStep({ ...withStone, idle: 2 }).ghost, true);
  assert.equal(onboardingStep({ ...withStone, idle: 5, holding: true }).ghost, false, 'a stone in the hand: they got it');
  assert.equal(onboardingStep({ ...withStone, idle: 5, sortedThisSession: 1 }).ghost, false, 'first stone placed: done');
  assert.equal(onboardingStep({ ...withStone, idle: 5, firstEvening: false }).ghost, false, 'regulars are not lectured');
  assert.equal(onboardingStep({ ...withStone, idle: ONBOARDING.ghostAfterReturning, firstEvening: false }).ghost, true);
});

test('the ghost demonstrates on the first unsorted stone, toward the bowl it belongs to', () => {
  assert.deepEqual(ghostTarget([{ id: 'a', bin: 'later', suggestion: 'later', released: false }, { id: 'b', bin: null, suggestion: 'let-go', released: false }]), { stone: 'b', bin: 'let-go' });
  assert.deepEqual(ghostTarget([{ id: 'c', bin: null, suggestion: null, released: false }]), { stone: 'c', bin: 'tomorrow' });
  assert.equal(ghostTarget([]), null);
});

test('one demonstration loop: approach, pinch, carry, open, fade', () => {
  const at = (t: number) => ghostFrame(t);
  assert.equal(at(0).alpha, 0);
  assert.ok(at(0.6).lift > at(1.0).lift, 'comes down onto the stone');
  assert.ok(at(1.15).pinch > 0.95, 'pinched');
  assert.ok(at(1.75).travel > 0.3 && at(1.75).travel < 0.7 && at(1.75).pinch > 0.95, 'carried');
  assert.ok(at(2.6).travel > 0.99 && at(2.6).pinch < 0.05, 'opened over the bowl');
  assert.equal(at(3.3).alpha, 0, 'rest');
  assert.deepEqual(at(ONBOARDING.cycle + 1.15), at(1.15), 'loops');
});

test('first evening: the lamp starts with Unload even when it is late (the core gesture first)', () => {
  const late = proposeRitual({ hour: 0, doneTonight: [], firstEvening: true });
  assert.equal(late.ritual, 'unload');
  assert.equal(proposeRitual({ hour: 0, doneTonight: [] }).ritual, 'breathe', 'regulars at midnight still get Breathe');
});

test('head-gaze focus: 250 ms dwell to take, hysteresis to keep, 0.3 s grace to let go (no flicker)', () => {
  const g = new GazeFocus();
  const run = (pick: string | null, keep: boolean, seconds: number) => {
    let r: string | null = null;
    for (let t = 0; t < seconds - 1e-9; t += 1 / 72) r = g.update(pick, keep, 1 / 72);
    return r;
  };
  assert.equal(run('a', false, 0.2), null, 'a glance is not a focus');
  assert.equal(run('a', false, 0.1), 'a', 'held 300 ms → focused');
  assert.equal(run(null, true, 2), 'a', 'drifting inside the keep cone keeps it');
  assert.equal(run('b', true, 0.2), 'a', 'a neighbour must be held too');
  assert.equal(run('b', true, 0.1), 'b');
  assert.equal(run(null, false, 0.2), 'b', 'grace');
  assert.equal(run(null, false, 0.15), null, 'released');
});


test('gaze reactions rise and fall softly (no flash): < 30 % after 100 ms, ≥ 300 ms to reach 63 %, settled by 1 s', () => {
  let k = 0;
  for (let t = 0; t < 0.1; t += 1 / 72) k = easeToward(k, 1, 1 / 72);
  assert.ok(k < 0.3, `after 100 ms: ${k}`);
  let t63 = 0;
  k = 0;
  for (let t = 0; k < 0.632; t += 1 / 72) {
    k = easeToward(k, 1, 1 / 72);
    t63 = t;
  }
  assert.ok(t63 >= 0.27, `63 % reached at ${t63.toFixed(2)} s`);
  for (let t = 0; t < 1; t += 1 / 72) k = easeToward(k, 1, 1 / 72);
  assert.ok(k > 0.95);
  for (let t = 0; t < 0.1; t += 1 / 72) k = easeToward(k, 0, 1 / 72);
  assert.ok(k > 0.65, 'falls softly too (no snap off)');
  assert.equal(GAZE.calm, 0.5);
});

test('one object at a time: the target nearest the gaze ray wins, never two', () => {
  const head = { x: 0, y: 1.2, z: 0 };
  const dir = { x: 0, y: -0.5, z: -1 };
  const lamp = { id: 'lamp', x: 0.3, y: 0.85, z: -0.6 };
  const a = { id: 'a', x: 0.02, y: 0.72, z: -0.95 };
  const b = { id: 'b', x: -0.06, y: 0.72, z: -0.95 };
  const pick = gazePick(head, dir, [lamp, a, b], GAZE.take);
  assert.equal(pick, 'a');
  assert.equal(typeof pick, 'string', 'a single id, not a list');
});
