import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bubbleLines, DONE_BUBBLE, HESITATE_AFTER, WORRY_BUBBLES, type BubbleContext } from '../src/logic/bubbles.ts';
import { parseIntent } from '../src/logic/voice-intents.ts';

const base: BubbleContext = { quiet: false, mode: 'unload', phase: 'dump', stones: 0, toSort: 0, idle: HESITATE_AFTER, used: new Set(), seed: 0 };

test('hesitating 5 s on a voice evening: three bubbles, never more; nothing before, nothing on a quiet evening', () => {
  assert.deepEqual(bubbleLines(base), WORRY_BUBBLES.slice(0, 3));
  assert.equal(bubbleLines({ ...base, idle: 4.9 }), null);
  assert.equal(bubbleLines({ ...base, quiet: true }), null);
  assert.equal(bubbleLines({ ...base, toSort: 1 }), null, 'a stone waits: the tray comes first');
  assert.equal(bubbleLines({ ...base, mode: 'breathe' }), null);
});

test('after sorting: two more worries and a way to end; used bubbles never come back; it rotates', () => {
  const used = new Set([WORRY_BUBBLES[0]]);
  const lines = bubbleLines({ ...base, stones: 2, used }) ?? [];
  assert.equal(lines.length, 3);
  assert.equal(lines[2], DONE_BUBBLE);
  assert.ok(!lines.includes(WORRY_BUBBLES[0]));
  assert.notDeepEqual(bubbleLines({ ...base, seed: 4 }), bubbleLines(base));
});

test('a touched bubble is read exactly like the same sentence spoken', () => {
  const ctx = { tokens: [], gazedId: null, lastId: null };
  assert.equal(parseIntent(DONE_BUBBLE, ctx, 'dump').type, 'done');
  assert.equal(parseIntent(WORRY_BUBBLES[1], ctx, 'dump').type, 'none', 'a worry is content for the brain dump');
});
