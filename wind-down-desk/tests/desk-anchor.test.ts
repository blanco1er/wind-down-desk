import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ANCHOR,
  anchorsToPrune,
  bearingOf,
  decideAfterRestore,
  frameFromPose,
  judgeRestored,
  newRecord,
  parseSaved,
  poseQuaternion,
  shouldFollow,
  type SavedDesk,
} from '../src/logic/desk-anchor.ts';
import type { PlaneCandidate } from '../src/logic/placement.ts';

const seated = { position: { x: 0, y: 1.2, z: 0 }, forward: { x: 0, z: -1 } };
const desk = { x: 0, y: 0.76, z: -0.55, yaw: 0 };
const saved: SavedDesk = newRecord('1b4e28ba-2fa1-11d2-883f-0016d3cca427', 'table', 'plane', 1_700_000_000_000);

test('saved record: round trip, and anything malformed means nothing saved', () => {
  assert.deepEqual(parseSaved(JSON.stringify(saved)), saved);
  for (const raw of [null, '', '{', '[]', 'null', '{"v":2,"uuid":"1b4e28ba-2fa1","mode":"table"}', '{"v":1,"uuid":"x","mode":"table"}', '{"v":1,"uuid":"1b4e28ba-2fa1","mode":"sofa"}']) {
    assert.equal(parseSaved(raw), null, String(raw));
  }
  assert.equal(parseSaved('{"v":1,"uuid":"1b4e28ba-2fa1","mode":"floating","misses":-3}')?.misses, 0);
});

test('anchor pose ↔ desk frame: yaw survives the round trip, a little runtime roll does not change it', () => {
  for (const yaw of [0, 0.7, -2.4, Math.PI - 0.01]) {
    const f = frameFromPose({ x: 1, y: 0.8, z: -2 }, poseQuaternion(yaw));
    assert.ok(Math.abs(f.yaw - yaw) < 1e-9, `yaw ${yaw}`);
  }
  const roll = 0.02;
  const q = { x: 0, y: Math.sin(0.35), z: Math.sin(roll / 2) * Math.cos(0.35), w: Math.cos(0.35) };
  assert.ok(Math.abs(frameFromPose({ x: 0, y: 0, z: 0 }, q).yaw - 0.7) < 0.02);
});

test('bearing: ahead / left / right / behind from where you look', () => {
  assert.equal(bearingOf(desk, seated).bearing, 'ahead');
  assert.equal(bearingOf({ ...desk, x: 0.6, z: 0 }, seated).bearing, 'right');
  assert.equal(bearingOf({ ...desk, x: -0.6, z: 0 }, seated).bearing, 'left');
  assert.equal(bearingOf({ ...desk, z: 0.6 }, seated).bearing, 'behind');
});

test('restored desk near you comes back exactly there, in view or not', () => {
  const ahead = judgeRestored(desk, seated, 'table');
  assert.equal(ahead.kind, 'restore');
  const side = judgeRestored({ ...desk, x: -0.7, z: -0.1 }, seated, 'table');
  assert.equal(side.kind, 'restore');
  assert.equal(side.kind === 'restore' && side.bearing, 'left');
  if (side.kind === 'restore') assert.equal(side.frame.x, -0.7, 'not moved into view');
});

test('restored desk at another seat, under the floor or above the eyes is refused', () => {
  assert.equal(judgeRestored({ ...desk, z: -2 }, seated, 'table').kind, 'too-far');
  assert.equal(judgeRestored({ ...desk, y: 0.05 }, seated, 'table').kind, 'implausible');
  assert.equal(judgeRestored({ ...desk, y: 1.25 }, seated, 'table').kind, 'implausible');
  assert.equal(judgeRestored({ ...desk, x: Number.NaN }, seated, 'table').kind, 'implausible');
});

test('a detected table right under a restored desk corrects small vertical drift (≤ 6 cm), never more', () => {
  const table: PlaneCandidate = { id: 't', orientation: 'horizontal', label: 'table', center: { x: 0, y: 0.73, z: -0.6 }, yaw: 0, halfX: 0.6, halfZ: 0.4, offsetX: 0, offsetZ: 0 };
  const r = judgeRestored({ ...desk, y: 0.775 }, seated, 'table', [table], 0.018);
  assert.equal(r.kind, 'restore');
  if (r.kind === 'restore') assert.ok(Math.abs(r.frame.y - 0.748) < 1e-9);
  const far = judgeRestored({ ...desk, y: 0.9 }, seated, 'table', [table], 0.018);
  if (far.kind === 'restore') assert.equal(far.frame.y, 0.9, 'a 15 cm gap is another surface: untouched');
  const floating = judgeRestored({ ...desk, y: 0.775 }, seated, 'floating', [table], 0.018);
  if (floating.kind === 'restore') assert.equal(floating.frame.y, 0.775, 'a floating desk is not snapped');
});

// ------------------------------------------------------------ the evening-after-evening cycle

test('cycle: first evening → anchor and save; next evening → back in place; headset forgot → anchor again', () => {
  const first = decideAfterRestore({ kind: 'no-record' }, null, seated);
  assert.deepEqual([first.place, first.persist, first.record], ['surfaces', 'replace', undefined]);

  const back = decideAfterRestore({ kind: 'pose', frame: desk }, saved, seated);
  assert.equal(back.place, 'anchor');
  assert.equal(back.persist, 'keep');
  assert.deepEqual(back.frame, desk);
  assert.equal(back.mode, 'table');

  const forgot = decideAfterRestore({ kind: 'rejected' }, saved, seated);
  assert.deepEqual([forgot.place, forgot.persist, forgot.record], ['surfaces', 'replace', null]);
});

test('cycle: another seat tonight → the table is found again and the new place replaces the old', () => {
  const d = decideAfterRestore({ kind: 'pose', frame: { ...desk, x: 2.5 } }, saved, seated);
  assert.deepEqual([d.place, d.persist, d.record], ['surfaces', 'replace', null]);
});

test('cycle: a slow headset (no answer in time) keeps the saved place for tomorrow, gives up after 3 evenings', () => {
  let record: SavedDesk | null = saved;
  for (let evening = 1; evening < ANCHOR.maxMisses; evening++) {
    const d = decideAfterRestore({ kind: 'timeout' }, record, seated);
    assert.equal(d.place, 'surfaces');
    assert.equal(d.persist, 'session-only', `evening ${evening}`);
    assert.equal(d.record?.misses, evening);
    record = d.record ?? null;
  }
  const last = decideAfterRestore({ kind: 'timeout' }, record, seated);
  assert.deepEqual([last.persist, last.record], ['replace', null]);
  // A successful restore resets the count.
  assert.equal(decideAfterRestore({ kind: 'pose', frame: desk }, { ...saved, misses: 2 }, seated).record?.misses, 0);
});

test('cycle: no persistence in this browser (private mode, VR session) → tonight only, never an error', () => {
  const d = decideAfterRestore({ kind: 'unsupported' }, saved, seated);
  assert.deepEqual([d.place, d.persist, d.record], ['surfaces', 'session-only', undefined]);
});

test('a floating desk restores as floating (no shadow on a table that is not there)', () => {
  const d = decideAfterRestore({ kind: 'pose', frame: { ...desk, y: 0.7 } }, { ...saved, mode: 'floating', source: 'floating' }, seated);
  assert.equal(d.mode, 'floating');
});

test('follow the anchor only for real corrections (≥ 5 mm or ≥ 0.6°), not for float noise', () => {
  assert.equal(shouldFollow(desk, { ...desk, x: desk.x + 0.001 }), false);
  assert.equal(shouldFollow(desk, { ...desk, x: desk.x + 0.008 }), true);
  assert.equal(shouldFollow(desk, { ...desk, yaw: 0.02 }), true);
  assert.equal(shouldFollow({ ...desk, yaw: Math.PI - 0.001 }, { ...desk, yaw: -Math.PI + 0.001 }), false, 'wrap-around');
});

test('site limit (8 per site on Quest): leftovers are pruned, ours and IWSDK’s never', () => {
  assert.deepEqual(anchorsToPrune(['a', 'b', 'c'], ['a']), []);
  const list = ['old1', 'ours', 'old2', 'iwsdk', 'old3', 'old4', 'old5', 'old6'];
  const prune = anchorsToPrune(list, ['ours', 'iwsdk', null]);
  assert.deepEqual(prune, ['old1', 'old2']);
  assert.ok(!prune.includes('ours') && !prune.includes('iwsdk'));
});
