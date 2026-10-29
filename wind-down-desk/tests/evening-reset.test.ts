import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startFresh, type EveningSpan } from '../src/logic/evening-reset.ts';
import { deskCap, SortingSession } from '../src/logic/session.ts';

/**
 * 29 Oct (long session in the emulator): one page kept open, evening after evening. The stones of earlier evenings
 * stayed active in their bowls, 2 more each evening, until the desk's cap: Unload refused new stones.
 */
function evening(session: SortingSession, n: number): void {
  // An evening by hand: three stones, Tomorrow, Later, Let go (released).
  const ids = [0, 1, 2].map((k) => session.add(`evening ${n}, thing ${k}`).id);
  session.assign(ids[0], 'tomorrow');
  session.assign(ids[1], 'later');
  session.assign(ids[2], 'let-go');
  session.release(ids[2]);
}

test('five evenings in a row without a reload: a fresh desk each time, never more than 2 stones at the start, Unload always accepted', () => {
  let session = new SortingSession();
  let span: EveningSpan = { startedOn: null, goodnight: false, placed: 0 };
  for (let n = 1; n <= 5; n++) {
    const tonight = `2026-11-0${n}`;
    if (startFresh(span, tonight)) session = new SortingSession();
    // Up to two stones may come back on their own (last week's Later, last night's follow-ups).
    if (n > 1) session.add(`carried back ${n}`, { source: 'carried' });
    assert.ok(session.active().length <= 2, `evening ${n} starts with ${session.active().length} stones`);
    assert.doesNotThrow(() => evening(session, n), `evening ${n}: Unload accepts new stones`);
    span = { startedOn: tonight, goodnight: true, placed: 3 };
  }
});

test('before the fix (the session kept): the cap is reached on the 4th evening', () => {
  const session = new SortingSession();
  assert.throws(() => {
    for (let n = 1; n <= 5; n++) evening(session, n);
  }, /desk is full/u);
  assert.equal(deskCap.max, 8);
});

test('which XR re-entry starts fresh', () => {
  const tonight = '2026-10-29';
  assert.equal(startFresh({ startedOn: null, goodnight: false, placed: 0 }, tonight), false, 'the first entry');
  assert.equal(startFresh({ startedOn: tonight, goodnight: false, placed: 0 }, tonight), false, 'a pause before any stone: the desk is kept');
  assert.equal(startFresh({ startedOn: tonight, goodnight: false, placed: 1 }, tonight), true, 'left after placing a stone (two pauses, a relaunched demo)');
  assert.equal(startFresh({ startedOn: tonight, goodnight: true, placed: 0 }, tonight), true, 'after Good night');
  assert.equal(startFresh({ startedOn: '2026-10-28', goodnight: false, placed: 0 }, tonight), true, 'the next evening');
});
