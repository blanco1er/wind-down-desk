import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectBin, isDeskMove, parseIntent, resolveTokens, type IntentContext } from '../src/logic/voice-intents.ts';

const ctx: IntentContext = {
  tokens: [
    { id: 't1', text: 'Reply to the landlord' },
    { id: 't2', text: 'Book the dentist' },
    { id: 't3', text: 'Slides for Monday' },
    { id: 't4', text: 'That awkward comment' },
    { id: 't5', text: 'Passport expires in March' },
  ],
  gazedId: 't3',
  lastId: 't5',
};

test('every placement gesture has a spoken form', () => {
  assert.deepEqual(parseIntent('Dentist, tomorrow', ctx), { type: 'move', tokenId: 't2', bin: 'tomorrow' });
  assert.deepEqual(parseIntent('put the slides in later', ctx), { type: 'move', tokenId: 't3', bin: 'later' });
  assert.deepEqual(parseIntent('let go of that comment', ctx), { type: 'move', tokenId: 't4', bin: 'let-go' });
  assert.deepEqual(parseIntent('release the passport one', ctx), { type: 'move', tokenId: 't5', bin: 'let-go' });
  assert.deepEqual(parseIntent('landlord first thing in the morning', ctx), { type: 'move', tokenId: 't1', bin: 'tomorrow' });
  assert.deepEqual(parseIntent('the second one, next week', ctx), { type: 'move', tokenId: 't2', bin: 'later' });
});

test('"this one" uses head gaze, then the last touched token', () => {
  assert.deepEqual(parseIntent('this one, later', ctx), { type: 'move', tokenId: 't3', bin: 'later' });
  assert.deepEqual(parseIntent('let it go', { ...ctx, gazedId: null }), { type: 'move', tokenId: 't5', bin: 'let-go' });
});

test('control words: undo, help, done, mute, plan answers, good night', () => {
  assert.equal(parseIntent('undo', ctx).type, 'undo');
  assert.equal(parseIntent('oops put it back', ctx).type, 'undo');
  assert.equal(parseIntent('what can I say', ctx).type, 'help');
  assert.equal(parseIntent("That's it", ctx, 'dump').type, 'done');
  assert.equal(parseIntent('stop listening', ctx).type, 'mute');
  assert.equal(parseIntent('keep it', ctx, 'plan').type, 'confirm');
  assert.equal(parseIntent('make it lighter', ctx, 'plan').type, 'lighter');
  assert.equal(parseIntent('good night', ctx).type, 'goodnight');
  assert.equal(parseIntent('move the desk', ctx).type, 'recenter');
  assert.equal(parseIntent('move my desk', ctx).type, 'recenter');
  assert.equal(parseIntent('move my desk here', ctx).type, 'recenter');
  assert.equal(parseIntent('bring my desk closer', ctx).type, 'recenter');
  assert.ok(isDeskMove('move my desk') && isDeskMove('find my table') && !isDeskMove('i need to move my desk at work tomorrow') && !isDeskMove('move my desk to the window this weekend'));
  assert.equal(parseIntent('sort them for me', ctx).type, 'move-all-suggested');
});

test('during the brain dump free speech is content, not a command', () => {
  assert.deepEqual(parseIntent('I need to call my mum', ctx, 'dump'), { type: 'none', text: 'I need to call my mum' });
  assert.deepEqual(parseIntent('add: water the plants', ctx, 'dump'), { type: 'add', text: 'water the plants' });
});

test('ambiguity is reported instead of guessed', () => {
  const two: IntentContext = { tokens: [{ id: 'a', text: 'Call mum' }, { id: 'b', text: 'Call dad' }] };
  const intent = parseIntent('call, tomorrow', two);
  assert.equal(intent.type, 'ambiguous');
  assert.equal(resolveTokens('xylophone tomorrow', ctx).length, 0);
  assert.equal(detectBin('I have no idea'), null);
});
