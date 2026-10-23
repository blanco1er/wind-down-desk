import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanSummary, crisisInModelText, crisisSignal, CRISIS_REPLY, HELP_RESOURCES, TALK_SYSTEM } from '../src/shared/agent/safety.ts';
import { parseTalkReply, deviceTalk } from '../src/shared/agent/talk.ts';
import { LlmAgent } from '../src/shared/agent/llm-agent.ts';

// Direct, indirect (ending, feeling in the way, not waking, disappearing) and self-harm phrasings, incl. the
// owner's live test of 25 Oct (the first one).
const CRISIS = [
  'Honestly sometimes I think everyone would be better off if I just ended it.',
  'I want to kill myself', 'sometimes I think about suicide', 'I have been cutting myself', 'I just want to end it all',
  "I don't want to live anymore", "I don't want to be here anymore", 'they would be better off without me',
  'I wish I could just not wake up', "I don't want to wake up", 'I want to disappear forever', 'I want to die',
  'what if I just ended it', 'I might end it tonight', 'there is no point in living', 'I wish I was dead',
];
// Ordinary evening words that must never raise the card.
const ORDINARY = [
  'I am dead tired', 'this deadline is killing me', 'my phone died', 'I hurt my back at the gym', 'the plants are dying',
  'I did not wake up on time', "I don't want to wake up early tomorrow", "I don't want to go on the trip",
  "let's end it here for tonight", 'everyone would be better off with a clear plan', 'I want to end the meeting early',
  'I disappeared into a book', 'the film had a twist ending', "I'm better off without coffee",
];

test('the person: every crisis phrasing is caught, ordinary evening words are not', () => {
  for (const s of CRISIS) assert.equal(crisisSignal(s), true, `missed: ${s}`);
  for (const s of ORDINARY) assert.equal(crisisSignal(s), false, `false alarm: ${s}`);
});

test('the second net: the model reply or summary speaking of a crisis is caught; normal replies are not', () => {
  assert.equal(crisisInModelText('They expressed thoughts of ending their life.'), true);
  assert.equal(crisisInModelText('Please let a person help you right now.'), true);
  assert.equal(crisisInModelText('That sounds heavy. What part of it weighs the most?'), false);
  assert.equal(cleanSummary('Worried about work. They expressed thoughts of ending their life. Misses their sister.'), 'Worried about work. Misses their sister.');
});

test('a model turn that slipped through becomes the fixed answer, no stone, and nothing of it in the summary', async () => {
  const input = { text: 'it is all too much', summary: 'Worried about work.', turns: [], weights: [] };
  const r = parseTalkReply('{"reply":"Please let a person help you right now.","weights":["Ending it"],"summary":"Worried about work. Expressed thoughts of ending their life."}', input);
  assert.deepEqual(r, { reply: CRISIS_REPLY, weights: [], summary: 'Worried about work.', crisis: true });
  // The LLM path end to end, with a fake model that writes the crisis into its summary only.
  const agent = new LlmAgent({ name: 'fake', complete: async () => '{"reply":"I hear you.","weights":[],"summary":"Mentioned wanting to die."}' });
  const t = await agent.talk(input);
  assert.equal(t.crisis, true);
  assert.ok(!/die|ending/u.test(t.summary));
  // A crisis sentence never reaches the model, the extraction or the summary.
  let called = 0;
  const watched = new LlmAgent({ name: 'fake', complete: async () => { called++; return '{}'; } });
  assert.equal((await watched.talk({ ...input, text: CRISIS[0] })).crisis, true);
  assert.deepEqual(await watched.extract(CRISIS[0]), []);
  assert.equal(called, 0);
  assert.equal(deviceTalk({ ...input, text: CRISIS[0], summary: 'A. They spoke of suicide.' }, () => [], 0).summary, 'A.');
});

test('the fixed answer gives no advice; only checked resources, no invented number; the prompt forbids diagnosis', () => {
  assert.ok(!/should|try to|you need to take|medication/iu.test(CRISIS_REPLY));
  assert.deepEqual(HELP_RESOURCES.map((r) => r.url).filter(Boolean), ['https://findahelpline.com', 'https://988lifeline.org', 'https://3114.fr', 'https://www.samaritans.org']);
  assert.match(TALK_SYSTEM, /never diagnose/u);
  assert.match(TALK_SYSTEM, /NOT a therapist/u);
});
