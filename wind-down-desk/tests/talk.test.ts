import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deviceTalk, mergeWeights, parseTalkReply, spokenCut, TALK, talkClock, talkUser, type TalkInput } from '../src/shared/agent/talk.ts';
import { CRISIS_REPLY } from '../src/shared/agent/safety.ts';

const input = (n: number): TalkInput => ({
  text: 'And the meeting tomorrow.',
  summary: 's'.repeat(2000),
  turns: Array.from({ length: n }, (_, i) => ({ who: i % 2 ? 'lamp' : 'you', text: `turn ${i} ${'x'.repeat(1000)}` })),
  weights: [],
});

test('a turn costs the same after 2 minutes or 45: summary + last 6 exchanges only', () => {
  const short = talkUser(input(6)).length;
  const long = talkUser(input(400)).length;
  assert.equal(long, short);
  assert.ok(long < 4000, `${long} chars`);
});

test('spoken replies: ≤ 260 characters, cut at a sentence end, no markdown', () => {
  const r = spokenCut(`**First.** ${'Second sentence goes on. '.repeat(20)}`);
  assert.ok(r.length <= TALK.replyChars);
  assert.ok(r.endsWith('.'));
  assert.ok(!r.includes('*'));
});

test('weights: at most 2 new per turn, 5 in all, 2–4 words, no duplicates', () => {
  assert.deepEqual(mergeWeights(['The deadline'], ['the deadline', 'Sam message today and more words', 'Rent', 'Car']), ['Sam message today and', 'Rent']);
  assert.deepEqual(mergeWeights(['a', 'b', 'c', 'd', 'e'], ['f']), []);
});

test('the model reply is parsed defensively; a reply drifting into crisis becomes the fixed answer', () => {
  const ok = parseTalkReply('```json\n{"reply":"That sounds like a lot.","weights":["The meeting"],"summary":"Worried about a meeting."}\n```', input(0));
  assert.equal(ok?.reply, 'That sounds like a lot.');
  assert.deepEqual(ok?.weights, ['The meeting']);
  assert.equal(parseTalkReply('not json', input(0)), null);
  assert.equal(parseTalkReply('{"reply":"Maybe you want to end your life","weights":[]}', input(0))?.reply, CRISIS_REPLY);
});

test('45 minutes at most: the end is announced at 40, then a gentle close; the on-device listener answers too', () => {
  assert.equal(talkClock(10, false), 'talk');
  assert.equal(talkClock(40, false), 'announce');
  assert.equal(talkClock(41, true), 'talk');
  assert.equal(talkClock(45, true), 'close');
  const r = deviceTalk({ text: 'I need to call my sister and I feel bad about it', summary: '', turns: [], weights: [] }, () => ['Call my sister'], 0);
  assert.equal(r.crisis, false);
  assert.deepEqual(r.weights, ['Call my sister']);
  assert.ok(r.reply.includes('?'));
  assert.equal(deviceTalk({ text: 'I want to die', summary: '', turns: [], weights: [] }, () => [], 1).reply, CRISIS_REPLY);
});
