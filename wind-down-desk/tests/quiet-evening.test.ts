import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onboardingStep } from '../src/logic/onboarding.ts';
import { caption, initialRitual, step, type RitualState } from '../src/logic/ritual.ts';

/**
 * 28 Oct (film review): on a quiet evening, a touched word becomes a stone and the words fold away until it is
 * sorted (by design) — but the caption still said "Touch more words". The caption must ask for the real next
 * action (place the stone), then say "Touch more words" again once the stone is placed and the words are back.
 */
const quiet = (unsorted: number) => ({ listening: false, micAvailable: false, unsorted, quiet: true });

function quietDumpWithOneStone(): RitualState {
  let s = step(initialRitual(), { type: 'placed' }, 1);
  s = step(s, { type: 'tokens-added', count: 1 }, 3);
  return s;
}

test('quiet evening: a stone waiting folds the words away, so the caption asks to place it', () => {
  const s = quietDumpWithOneStone();
  assert.equal(s.phase, 'dump');
  const text = caption(s, quiet(1));
  assert.doesNotMatch(text, /Touch more words/u, 'no words to touch while a stone waits');
  assert.match(text, /place the stone/u);
  assert.match(caption(s, quiet(2)), /place the stones/u);
});

test('quiet evening: once the stone is placed the words come back, and so does "Touch more words"', () => {
  let s = quietDumpWithOneStone();
  s = step(s, { type: 'sorted', remaining: 0, keepDump: true }, 8);
  assert.equal(s.phase, 'dump', 'sorting does not end a quiet Unload (the words come back)');
  assert.equal(s.milestones.firstSort, 8);
  assert.match(caption(s, quiet(0)), /^Touch more words/u);
  // A second word, a second stone: the caption asks for it again.
  s = step(s, { type: 'tokens-added', count: 1 }, 10);
  assert.match(caption(s, quiet(1)), /place the stone/u);
  s = step(s, { type: 'sorted', remaining: 0, keepDump: true }, 14);
  // "That's all" with every stone already sorted: straight to the plan (never an empty sorting phase).
  s = step(s, { type: 'dump-done', unsorted: 0 }, 16);
  assert.equal(s.phase, 'plan');
  assert.equal(s.milestones.planShown, 16);
});

test('quiet evening: back to the words after a sort, the example stone never comes (they already know)', () => {
  const idle = { firstEvening: true, mode: 'unload', phase: 'dump', stonesOnDesk: 0, holding: false, idle: 30, exampleShown: false };
  assert.equal(onboardingStep({ ...idle, sortedThisSession: 0 }).spawnExample, true, 'nothing yet: the example');
  assert.equal(onboardingStep({ ...idle, sortedThisSession: 1 }).spawnExample, false);
});

test('quiet evening: "That\'s all" with a stone still waiting goes to sorting', () => {
  const s = step(quietDumpWithOneStone(), { type: 'dump-done', unsorted: 1 }, 6);
  assert.equal(s.phase, 'sort');
});

test('talk evening unchanged: the first sort ends the dump, the last one brings the plan', () => {
  let s = quietDumpWithOneStone();
  s = step(s, { type: 'tokens-added', count: 1 }, 4);
  s = step(s, { type: 'sorted', remaining: 1 }, 6);
  assert.equal(s.phase, 'sort');
  s = step(s, { type: 'sorted', remaining: 0 }, 7);
  assert.equal(s.phase, 'plan');
  // Voice "that's it" (no count given) still starts the sorting.
  assert.equal(step(quietDumpWithOneStone(), { type: 'dump-done' }, 5).phase, 'sort');
});
