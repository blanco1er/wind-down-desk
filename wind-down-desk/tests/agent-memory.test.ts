import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followUpQuestion, RitualMemory, STORAGE_KEY, type KeyValueStore } from '../src/logic/memory.ts';

function store(): KeyValueStore & { data: Map<string, string>; removeItem: (k: string) => void } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
const at = (iso: string) => () => new Date(iso);

test('the lamp opens a returning evening with one true sentence and the open Tomorrow items', () => {
  const s = store();
  new RitualMemory(s, at('2026-10-21T22:00:00')).recordNight({ tomorrow: ['Call the dentist', 'Reply to the landlord'], later: ['Tax forms'], letGo: ['That comment', 'The slow reply', 'Being late'] });
  const r = new RitualMemory(s, at('2026-10-22T21:30:00')).recall();
  assert.equal(r.sentence, 'Last night you let go of 3 things.');
  assert.deepEqual(r.followUps, ['Call the dentist', 'Reply to the landlord']);
  assert.equal(followUpQuestion(r.followUps[0]), 'Did you call the dentist?');
  assert.equal(followUpQuestion(r.followUps[1], false), 'And did you reply to the landlord?');
  assert.equal(followUpQuestion('The meeting with Paul'), 'What about “The meeting with Paul”?');
});

test('days later the sentence names the day; a first evening has nothing to recall', () => {
  const s = store();
  assert.deepEqual(new RitualMemory(s, at('2026-10-19T21:00:00')).recall(), { sentence: null, followUps: [] });
  new RitualMemory(s, at('2026-10-19T21:00:00')).recordNight({ tomorrow: ['Book the venue'], later: [], letGo: [] });
  assert.equal(new RitualMemory(s, at('2026-10-22T21:00:00')).recall().sentence, 'On Monday you kept one thing for the next day.');
  assert.equal(new RitualMemory(s, at('2026-10-30T21:00:00')).recall().sentence, 'Last time you kept one thing for the next day.');
});

test('done items never come back; sorted-again items belong to the newer evening; at most 3, newest first', () => {
  const s = store();
  new RitualMemory(s, at('2026-10-18T22:00:00')).recordNight({ tomorrow: ['Old one', 'Pay rent'], later: [], letGo: [] });
  new RitualMemory(s, at('2026-10-20T22:00:00')).recordNight({ tomorrow: ['Call the dentist', 'Email Sam', 'Buy a gift'], later: ['Pay rent'], letGo: [] });
  const m = new RitualMemory(s, at('2026-10-21T21:00:00'));
  assert.deepEqual(m.followUps(), ['Call the dentist', 'Email Sam', 'Buy a gift']);
  m.markDone('Call the dentist');
  assert.deepEqual(m.followUps(), ['Email Sam', 'Buy a gift', 'Old one'], 'Pay rent went to Later: not a follow-up any more');
  assert.deepEqual(new RitualMemory(s, at('2026-10-22T08:00:00')).morningPlan()?.done, ['Call the dentist'], 'the morning card cites it');
  assert.deepEqual(new RitualMemory(s, at('2026-11-10T21:00:00')).followUps(), [], 'after two weeks, nothing is chased');
});

test('"forget everything" erases every evening on this device', () => {
  const s = store();
  const m = new RitualMemory(s, at('2026-10-21T22:00:00'));
  m.recordNight({ tomorrow: ['Call the dentist'], later: [], letGo: ['That comment'] });
  m.forget();
  const after = new RitualMemory(s, at('2026-10-22T21:00:00'));
  assert.deepEqual(after.recall(), { sentence: null, followUps: [] });
  assert.equal(after.totalLetGo(), 0);
  assert.equal(after.welcomeLine(), 'First evening at your desk.');
  assert.equal(JSON.parse(s.data.get(STORAGE_KEY) ?? '{}').nights.length, 0);
});

test('the Privacy page button erases the same storage key the lamp uses', async () => {
  const { readFileSync } = await import('node:fs');
  assert.ok(readFileSync(new URL('../public/privacy.html', import.meta.url), 'utf8').includes(`'${STORAGE_KEY}'`));
});

test('29 Oct — back in XR the same evening: what was already sorted tonight is not asked again', () => {
  const s = store();
  new RitualMemory(s, at('2026-10-27T22:00:00')).recordNight({ tomorrow: ['Work', 'Email Sam'], later: [], letGo: [] });
  const tonight = new RitualMemory(s, at('2026-10-28T21:00:00'));
  assert.deepEqual(tonight.followUps(), ['Work', 'Email Sam'], 'on arrival: last night\'s open items');
  // Tonight "Work" is placed in Tomorrow again, then the person leaves XR and comes back.
  tonight.recordNight({ tomorrow: ['Work'], later: [], letGo: [] });
  assert.deepEqual(new RitualMemory(s, at('2026-10-28T21:20:00')).followUps(), ['Email Sam']);
});
