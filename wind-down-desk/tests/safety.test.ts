import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crisisSignal, CRISIS_REPLY, HELP_RESOURCES, TALK_SYSTEM } from '../src/shared/agent/safety.ts';

test('suicide and self-harm are recognised, in many phrasings', () => {
  for (const s of ['I want to kill myself', 'sometimes I think about suicide', "I don't want to live anymore", 'I have been cutting myself', 'I just want to end it all', 'everyone would be better off dead without me']) {
    assert.equal(crisisSignal(s), true, s);
  }
});

test('ordinary evening worries are not crises (no false alarm on "dead tired", "killing me")', () => {
  for (const s of ['I am dead tired', 'this deadline is killing me', 'my phone died', 'I hurt my back at the gym', 'the plants are dying']) {
    assert.equal(crisisSignal(s), false, s);
  }
});

test('the fixed answer gives no advice; only checked resources, no invented number; the prompt forbids diagnosis', () => {
  assert.ok(!/should|try to|you need to take|medication/iu.test(CRISIS_REPLY));
  assert.deepEqual(HELP_RESOURCES.map((r) => r.url).filter(Boolean), ['https://findahelpline.com', 'https://988lifeline.org', 'https://3114.fr', 'https://www.samaritans.org']);
  assert.match(TALK_SYSTEM, /never diagnose/u);
  assert.match(TALK_SYSTEM, /NOT a therapist/u);
});
