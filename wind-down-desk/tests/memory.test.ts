import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eveningDate, RitualMemory, starPosition, STORAGE_KEY, type KeyValueStore } from '../src/logic/memory.ts';

function store(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const at = (iso: string) => () => new Date(iso);

test('an evening runs past midnight', () => {
  assert.equal(eveningDate(new Date('2026-10-18T23:30:00')), '2026-10-18');
  assert.equal(eveningDate(new Date('2026-10-19T01:30:00')), '2026-10-18');
  assert.equal(eveningDate(new Date('2026-10-19T06:00:00')), '2026-10-19');
});

test('streak counts consecutive evenings and survives reloads', () => {
  const s = store();
  const summary = { tomorrow: ['Reply to landlord'], later: [], letGo: ['That comment'] };
  new RitualMemory(s, at('2026-10-16T22:00:00')).recordNight(summary);
  new RitualMemory(s, at('2026-10-17T23:50:00')).recordNight(summary);
  const tonight = new RitualMemory(s, at('2026-10-19T00:40:00')); // still the evening of the 18th
  assert.equal(tonight.streak(), 2, 'last night counts until tonight is done');
  tonight.recordNight(summary);
  assert.equal(new RitualMemory(s, at('2026-10-19T00:45:00')).streak(), 3);
  assert.equal(new RitualMemory(s, at('2026-10-21T21:00:00')).streak(), 0, 'a missed evening resets');
});

test('every worry let go becomes one star, with a stable position', () => {
  const s = store();
  const m = new RitualMemory(s, at('2026-10-18T22:00:00'));
  m.recordNight({ tomorrow: [], later: [], letGo: ['That comment'] });
  m.recordNight({ tomorrow: [], later: [], letGo: ['That comment', 'What they think'] });
  assert.equal(m.stars().length, 2, 'no duplicate star on re-save');
  const p1 = starPosition(m.stars()[0].seed);
  const p2 = starPosition(m.stars()[0].seed);
  assert.deepEqual(p1, p2);
  assert.ok(p1.y > 0.25 && p1.z < 0, 'stars sit above and behind the desk');
  assert.match(new RitualMemory(s, at('2026-10-19T21:00:00')).welcomeLine(), /2 stars/u);
});

test('recurring worries are noticed, kindly', () => {
  const s = store();
  new RitualMemory(s, at('2026-10-10T22:00:00')).recordNight({ tomorrow: [], later: [], letGo: ['That awkward comment'] });
  new RitualMemory(s, at('2026-10-14T22:00:00')).recordNight({ tomorrow: [], later: [], letGo: ['awkward comment at work'] });
  const m = new RitualMemory(s, at('2026-10-18T22:00:00'));
  assert.equal(m.timesLetGoBefore('the awkward comment'), 2);
  assert.equal(m.cameBack('That awkward comment again')?.date, '2026-10-14');
  assert.equal(m.cameBack('Dentist'), null);
});

test('the kept plan comes back the next morning, once', () => {
  const s = store();
  const plan = [{ title: 'Landlord', step: 'Draft 3 lines', when: '09:30', minutes: 10 }];
  new RitualMemory(s, at('2026-10-18T23:00:00')).recordNight({ tomorrow: ['Landlord'], later: [], letGo: [] }, plan, true);
  const morning = new RitualMemory(s, at('2026-10-19T08:00:00'));
  assert.deepEqual(morning.morningPlan(), { date: '2026-10-18', tomorrow: ['Landlord'], plan });
  morning.markMorningSeen();
  assert.equal(new RitualMemory(s, at('2026-10-19T09:00:00')).morningPlan(), null);
  assert.equal(new RitualMemory(s, at('2026-10-19T20:00:00')).morningPlan(), null, 'evenings are for the ritual');
});

test('Later items resurface after a week; corrupt storage is survived', () => {
  const s = store();
  new RitualMemory(s, at('2026-10-01T22:00:00')).recordNight({ tomorrow: [], later: ['Renew passport'], letGo: [] });
  assert.deepEqual(new RitualMemory(s, at('2026-10-05T22:00:00')).dueLater(), []);
  const m = new RitualMemory(s, at('2026-10-09T22:00:00'));
  assert.deepEqual(m.dueLater(), ['Renew passport']);
  m.resolveLater(['Renew passport']);
  assert.deepEqual(m.dueLater(), []);
  s.data.set(STORAGE_KEY, '{oops');
  assert.equal(new RitualMemory(s).streak(), 0);
  assert.equal(new RitualMemory(null).welcomeLine(), 'First evening at your desk.');
});

test('a demo history (film only) gives a streak and a sky, and no morning plan', async () => {
  const { RitualMemory } = await import('../src/logic/memory.ts');
  const store = new Map<string, string>();
  const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const memory = new RitualMemory(kv, () => new Date(2026, 9, 18, 22, 30));
  memory.seedHistory(21);
  assert.equal(memory.streak(), 21);
  assert.ok(memory.totalLetGo() >= 21 && memory.totalLetGo() <= 63);
  assert.match(memory.welcomeLine(), /^Evening 21 in a row\. \d+ stars in your sky\.$/u);
  const morning = new RitualMemory(kv, () => new Date(2026, 9, 19, 8, 0));
  assert.equal(morning.morningPlan(), null);
});

test('a second evening shows its number from the first seconds (progress visible)', () => {
  const store = new Map<string, string>();
  const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const first = new RitualMemory(s, () => new Date('2026-10-20T21:00:00'));
  first.recordNight({ tomorrow: ['Call the dentist'], later: [], letGo: ['That comment'] });
  const second = new RitualMemory(s, () => new Date('2026-10-22T21:00:00'));
  assert.equal(second.welcomeLine(), 'Evening 2 at your desk. 1 star in your sky.');
});
