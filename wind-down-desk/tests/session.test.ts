import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TOKENS, SortingSession } from '../src/logic/session.ts';

test('session sorts, re-sorts and summarizes', () => {
  const s = new SortingSession();
  const a = s.add('Reply to landlord', { suggestion: 'tomorrow' });
  const b = s.add('Dentist');
  const c = s.add('Awkward comment');
  assert.equal(s.assign(a.id, 'tomorrow'), 0);
  assert.equal(s.assign(b.id, 'tomorrow'), 1);
  assert.equal(s.isComplete(), false);
  s.assign(b.id, 'later');
  assert.equal(s.assign(c.id, 'let-go'), 0);
  s.release(c.id);
  assert.deepEqual(s.summary(), { tomorrow: ['Reply to landlord'], later: ['Dentist'], letGo: ['Awkward comment'], unsorted: [] });
  assert.equal(s.isComplete(), true);
  assert.equal(s.get(a.id)?.suggestion, 'tomorrow');
});

test('undo reverts placements but never resurrects a release', () => {
  const s = new SortingSession();
  const a = s.add('Slides');
  const b = s.add('Comment');
  s.assign(a.id, 'tomorrow');
  s.assign(a.id, 'later');
  s.assign(b.id, 'let-go');
  s.release(b.id);
  const first = s.undo();
  assert.equal(first?.token.id, a.id);
  assert.equal(first?.from, 'later');
  assert.equal(first?.to, 'tomorrow');
  assert.equal(s.undo()?.to, null);
  assert.equal(s.undo(), null, 'released token must stay released');
  assert.equal(s.get(b.id)?.released, true);
});

test('released tokens are final, empty text is rejected, the desk has a cap', () => {
  const s = new SortingSession();
  const t = s.add('x');
  assert.throws(() => s.release(t.id));
  s.assign(t.id, 'let-go');
  s.release(t.id);
  assert.throws(() => s.assign(t.id, 'later'));
  assert.throws(() => s.add('   '));
  for (let i = 0; i < MAX_TOKENS; i++) {
    s.add(`worry ${i}`);
  }
  assert.throws(() => s.add('one too many'));
});

test('discard removes a mis-heard token', () => {
  const s = new SortingSession();
  const t = s.add('Uh');
  s.discard(t.id);
  assert.equal(s.all().length, 0);
});
