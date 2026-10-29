import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bubbleLines, DONE_BUBBLE, hesitation, HESITATE_AFTER, NOISE_GRACE } from '../src/logic/bubbles.ts';
import { dumpEndsOnSort, initialRitual, step, type RitualState } from '../src/logic/ritual.ts';
import { DONE_LABEL, unloadChoices } from '../src/logic/style.ts';
import { parseIntent } from '../src/logic/voice-intents.ts';

/**
 * 29 Oct (solidity, "fully usable with hands, end to end"): on a talk evening (the default style, Quiet NOT chosen
 * on the landing page), someone who never speaks — microphone allowed or not — touched a word (or the example
 * stone landed), pinched the stone into a bowl… and the dump ended: picking a stone meant "I'm done talking". No
 * words came back, so a second worry was impossible by hand. Found in the emulator (tools/solidite-29oct).
 * Rule now: only a person who has spoken in this dump ends it by picking a stone.
 */

/** What ritual-system does with a pick and a sort, with the same pure pieces. */
function pickAndSort(s: RitualState, c: { quiet: boolean; spoke: boolean }, remaining: number, t: number): RitualState {
  if (s.phase === 'dump' && dumpEndsOnSort(c)) s = step(s, { type: 'dump-done' }, t);
  return step(s, { type: 'sorted', remaining, keepDump: !dumpEndsOnSort(c) }, t + 1);
}

/** The touch targets the desk offers in a dump with nothing to sort (word grid or bubbles). */
function targets(c: { quiet: boolean; mic: 'off' | 'listening' | 'denied'; stones: number; idle: number; touchOnly: boolean }): string[] {
  const talkVoice = !c.quiet && c.mic !== 'denied';
  if (!talkVoice) return unloadChoices(new Set(), c.stones).map((w) => w.label);
  const idle = hesitation({ sinceActivity: c.idle, sinceInput: c.idle, touchOnly: c.touchOnly });
  return bubbleLines({ quiet: c.quiet, mode: 'unload', phase: 'dump', stones: c.stones, toSort: 0, idle, used: new Set(), seed: 3 }) ?? [];
}

for (const mic of ['off', 'listening', 'denied'] as const) {
  test(`talk evening, never a word spoken (microphone ${mic}): two stones by hand, then "That's all" → the plan`, () => {
    const who = { quiet: false, spoke: false };
    let s = step(initialRitual(), { type: 'placed' }, 1);
    // 1st stone (a touched word / bubble, or the example stone), pinched into a bowl.
    s = step(s, { type: 'tokens-added', count: 1 }, 2);
    s = pickAndSort(s, who, 0, 4);
    assert.equal(s.phase, 'dump', 'the dump stays open after the first stone');
    // Targets are back at once (no hesitation needed for someone who only touches).
    const after1 = targets({ quiet: false, mic, stones: 1, idle: 0, touchOnly: true });
    assert.ok(after1.length >= 2, `words to touch after the first stone (${after1.join(' | ')})`);
    // 2nd stone.
    s = step(s, { type: 'tokens-added', count: 1 }, 6);
    s = pickAndSort(s, who, 0, 8);
    assert.equal(s.phase, 'dump');
    const after2 = targets({ quiet: false, mic, stones: 2, idle: 0, touchOnly: true });
    const done = after2.find((l) => l === DONE_LABEL || l === DONE_BUBBLE);
    assert.ok(done != null, 'a way to end the dump is offered by touch');
    // "That's all" (word grid: dump-done with the unsorted count; bubble: the same path as the spoken sentence).
    if (done === DONE_BUBBLE) assert.equal(parseIntent(DONE_BUBBLE, { tokens: [], gazedId: null, lastId: null }, 'dump').type, 'done');
    s = step(s, { type: 'dump-done', unsorted: 0 }, 10);
    assert.equal(s.phase, 'plan', 'every stone sorted → the plan, never an empty sorting phase');
  });
}

test('someone who talks keeps the voice flow: picking a stone means "I am done talking"', () => {
  let s = step(initialRitual(), { type: 'placed' }, 1);
  s = step(s, { type: 'tokens-added', count: 2 }, 2);
  s = pickAndSort(s, { quiet: false, spoke: true }, 1, 4);
  assert.equal(s.phase, 'sort');
  s = pickAndSort(s, { quiet: false, spoke: true }, 0, 6);
  assert.equal(s.phase, 'plan');
});

test('a quiet evening is unchanged (the dump stays open whatever was said)', () => {
  assert.equal(dumpEndsOnSort({ quiet: true, spoke: true }), false);
  assert.equal(dumpEndsOnSort({ quiet: true, spoke: false }), false);
});

test('"that\'s it" spoken with every stone already sorted goes to the plan (it used to leave an empty sort phase)', () => {
  let s = step(initialRitual(), { type: 'placed' }, 1);
  s = step(s, { type: 'tokens-added', count: 1 }, 2);
  s = step(s, { type: 'sorted', remaining: 0, keepDump: true }, 3);
  assert.equal(step(s, { type: 'dump-done' }, 4).phase, 'sort', 'without the count: the old dead end');
  assert.equal(step(s, { type: 'dump-done', unsorted: 0 }, 4).phase, 'plan');
});

test('bubbles: a noisy microphone (no words, activity reset every frame) cannot hide them forever', () => {
  // Voice user hesitating normally: 5 s.
  assert.equal(hesitation({ sinceActivity: 5, sinceInput: 5, touchOnly: false }), 5);
  // Noise keeps "recording" (sinceActivity ≈ 0) but no sentence and no touch for a while: they come anyway.
  const idle = hesitation({ sinceActivity: 0, sinceInput: NOISE_GRACE + HESITATE_AFTER, touchOnly: false });
  assert.ok(idle >= HESITATE_AFTER);
  assert.ok(bubbleLines({ quiet: false, mode: 'unload', phase: 'dump', stones: 0, toSort: 0, idle, used: new Set(), seed: 0 }) != null);
  // Someone who only touches: no hesitation needed.
  assert.ok(hesitation({ sinceActivity: 0, sinceInput: 0, touchOnly: true }) >= HESITATE_AFTER);
});

test('"That\'s all" with stones the ritual never counted (Talk\'s weights, last night\'s follow-ups) still ends the dump', () => {
  // Talk left two stones on the desk without a 'tokens-added'; both let go by hand; then "That's all".
  let s = step(initialRitual(), { type: 'placed' }, 1);
  s = step(s, { type: 'sorted', remaining: 1, keepDump: true }, 2);
  s = step(s, { type: 'sorted', remaining: 0, keepDump: true }, 3);
  assert.equal(s.tokensOnDesk, 0, 'the ritual never heard of them');
  assert.equal(step(s, { type: 'dump-done', unsorted: 0 }, 4).phase, 'dump', 'the old dead end: nothing happened');
  assert.equal(step(s, { type: 'dump-done', unsorted: 0, stones: 2 }, 4).phase, 'plan', 'the real count decides');
  // And an empty desk still cannot be "done".
  assert.equal(step(step(initialRitual(), { type: 'placed' }, 1), { type: 'dump-done', unsorted: 0, stones: 0 }, 2).phase, 'dump');
});
