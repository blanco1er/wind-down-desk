import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerOf, isForgetCommand } from '../src/logic/recall.ts';
import { normalize } from '../src/logic/text.ts';

test('short answers to the lamp: done / not yet; anything longer is not an answer', () => {
  assert.equal(answerOf(normalize('Done!')), 'yes');
  assert.equal(answerOf(normalize('Yes, I did it')), 'yes');
  assert.equal(answerOf(normalize('Not yet.')), 'no');
  assert.equal(answerOf(normalize("I didn't")), 'no');
  assert.equal(answerOf(normalize('I need to call the dentist again tomorrow morning')), null);
});

test('"forget everything" is recognised; a worry about forgetting is not', () => {
  assert.equal(isForgetCommand(normalize('Forget everything.')), true);
  assert.equal(isForgetCommand(normalize('Erase my data')), true);
  assert.equal(isForgetCommand(normalize('I always forget everything at work')), false);
});
