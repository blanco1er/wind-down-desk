import assert from 'node:assert/strict';
import { test } from 'node:test';
import { goodThing, isKeepDone, KEEP_CHOICES, KEPT_CROWN, KEEP_LINES, keepChoices, keepLine, keptCrown, keptPlace, keptSummary } from '../src/logic/keep.ts';
import { dateLabel, entryRows, entrySubtitle, isJournalCommand, journalEntries, parseJournalCommand, recurring, weekSummary } from '../src/logic/journal.ts';
import { ceilingPoint, CEILING_CONE_DEG, DimGesture, dimStrokeSeconds, findCeiling, parseSleepCommand, SLEEP_CLOSE_SUB, SLEEP_FADE_S, SLEEP_LINES, sleepLevels } from '../src/logic/sleep.ts';
import { RitualMemory, type KeyValueStore, type NightRecord } from '../src/logic/memory.ts';
import { lampLines, lineKey } from '../src/logic/lamp-lines.ts';
import { parseRitualCommand, proposeRitual } from '../src/logic/evening.ts';
import type { PlaneCandidate } from '../src/logic/placement.ts';

function store(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const at = (iso: string) => () => new Date(iso);

// ------------------------------------------------------------------ Keep

test('Keep: a sentence becomes a short good thing', () => {
  assert.equal(goodThing("I'm really grateful for the long call with my sister today."), 'The long call with my sister');
  assert.equal(goodThing('thankful for rest'), 'Rest');
  assert.equal(goodThing('A good thing today was the soup'), 'The soup');
  assert.equal(goodThing('the walk by the river after work with Tom'), 'The walk by the river after', 'six words at most');
  assert.equal(goodThing('   '), null);
  assert.ok(isKeepDone("That's all"));
  assert.ok(!isKeepDone('A good meal'));
});

test('Keep: three lines, touch words never offered twice, lights spread around the desk (never in front)', () => {
  assert.equal(keepLine(1), KEEP_LINES.one);
  assert.equal(keepLine(3), KEEP_LINES.three);
  const used = new Set<string>([KEEP_CHOICES[0]]);
  assert.ok(!keepChoices(used).includes(KEEP_CHOICES[0]));
  assert.ok(keepChoices(new Set()).length <= 6);
  const places = Array.from({ length: 12 }, (_, i) => keptPlace(i, (i * 2654435761) >>> 0));
  for (const p of places) {
    assert.ok(p.z < 0.05, 'behind or beside the tray, never between you and it');
    assert.ok(p.y >= 0.18 && p.y <= 0.5);
    assert.ok(Math.hypot(p.x, p.z) > 0.35, 'clear of the tray');
  }
  for (let i = 0; i < places.length; i++) for (let j = i + 1; j < places.length; j++) {
    const d = Math.hypot(places[i].x - places[j].x, places[i].y - places[j].y, places[i].z - places[j].z);
    assert.ok(d > 0.02, `lights ${i} and ${j} do not overlap`);
  }
});

test('Keep: kept on this device, one light per good thing, duplicates ignored', () => {
  const s = store();
  const m = new RitualMemory(s, at('2026-10-27T21:00:00'));
  m.recordKept('A good meal');
  m.recordKept('a good meal');
  m.recordKept('Someone kind');
  const later = new RitualMemory(s, at('2026-10-28T21:00:00'));
  later.recordKept('Rest');
  const lights = later.keptLights();
  assert.deepEqual(lights.map((l) => l.text), ['A good meal', 'Someone kind', 'Rest']);
  assert.equal(new Set(lights.map((l) => l.seed)).size, 3);
  assert.deepEqual(later.keptLights().map((l) => l.seed), lights.map((l) => l.seed), 'same place every evening');
});

test('Keep is proposed by a good sentence or a light bead, and picked by name', () => {
  const p = proposeRitual({ hour: 21, doneTonight: [], heard: 'I had a lovely day, I feel happy' });
  assert.equal(p.ritual, 'keep');
  assert.equal(proposeRitual({ hour: 21, doneTonight: [], heard: 'happy but so stressed and anxious' }).ritual, 'breathe', 'tension wins');
  assert.deepEqual(parseRitualCommand('three good things', 'choose'), { type: 'pick', ritual: 'keep' });
  assert.equal(parseRitualCommand('keep it', 'unload'), null, 'the plan keep-it is untouched');
});

// ------------------------------------------------------------------ Journal

const nights: NightRecord[] = [
  { date: '2026-10-20', tomorrow: [], later: [], letGo: ['Work emails'], plan: [], planKept: false, rituals: ['unload'] },
  { date: '2026-10-22', tomorrow: [], later: [], letGo: [], plan: [], planKept: false },
  { date: '2026-10-24', tomorrow: ['Call the dentist'], later: [], letGo: ['That email tone', 'Work email'], plan: [], planKept: false, rituals: ['unload', 'breathe'], breaths: 6, tensionIn: 7, tensionOut: 3, kept: ['A good meal'] },
  { date: '2026-10-27', tomorrow: [], later: [], letGo: ['Work emails again'], sunk: ['What he said'], plan: [], planKept: false, rituals: ['release'], tensionIn: 6, tensionOut: 4 },
];

test('journal: one page per evening that holds something, newest first', () => {
  const e = journalEntries(nights);
  assert.deepEqual(e.map((x) => x.date), ['2026-10-27', '2026-10-24', '2026-10-20'], 'the empty evening has no page');
  assert.equal(e[1].label, 'Saturday 24 Oct');
  assert.equal(dateLabel('2026-10-28'), 'Wednesday 28 Oct');
  assert.equal(entrySubtitle(e[1]), 'Arrived heavy, left light · 6 slow breaths · Unload, Breathe');
  assert.equal(entrySubtitle({ ...e[1], tensionOut: null, breaths: 0, rituals: [] }), 'Arrived heavy', 'the bead in words, never a bare number');
  assert.deepEqual(entryRows(e[1]).map((r) => r.detail), ['Let go', 'Let go', 'Kept', 'For the next day']);
  assert.deepEqual(e[0].letGo, ['Work emails again', 'What he said'], 'what sank counts as let go');
  const many = { ...e[1], letGo: ['a', 'b', 'c', 'd', 'e', 'f'] };
  assert.equal(entryRows(many).length, 5);
  assert.equal(entryRows(many)[4].title, 'And 4 more');
  const twice = { ...e[1], letGo: ['Process the statement', 'process the statement '], kept: [], tomorrow: [] };
  assert.deepEqual(entryRows(twice), [{ title: 'Process the statement', detail: 'Let go · twice' }], 'the same thing in the same bowl is one row');
});

test('journal: one true sentence about the week (nothing invented)', () => {
  const s = weekSummary(nights, '2026-10-27');
  // The 20th is 7 days before the 27th: not this week. 24th: 2, 27th: 1 let go + 1 sunk.
  assert.match(s, /^This week you let go of 4 things\./u);
  assert.match(s, /“Work email” came back twice/u, 'two wordings, one theme');
  assert.match(s, /You came in at 7 on average and left at 4\./u);
  assert.equal(weekSummary([], '2026-10-27'), 'Your sky starts tonight.');
  assert.match(weekSummary(nights, '2026-11-20'), /A quiet week/u, 'old evenings are not this week');
  assert.equal(recurring(['a', 'b']), null);
});

test('journal by voice', () => {
  assert.equal(parseJournalCommand('earlier'), 'earlier');
  assert.equal(parseJournalCommand('next'), 'later');
  assert.equal(parseJournalCommand('close'), 'close');
  assert.equal(parseJournalCommand('this week'), 'newest');
  assert.ok(isJournalCommand('show me my journal'));
  assert.ok(isJournalCommand('what did i let go this week'));
  assert.ok(!isJournalCommand('i need to write in my journal tomorrow'));
});

// ------------------------------------------------------------------ The night

test('the close: light and sound sink together over about 20 s, the breath slows from 6 to 5, then it ends', () => {
  const a = sleepLevels(0);
  assert.equal(a.light, 1);
  assert.equal(a.sound, 1);
  assert.equal(a.breathsPerMinute, 6);
  assert.equal(SLEEP_FADE_S, 20, 'nobody sleeps in a headset: a short fade, no timer');
  const mid = sleepLevels(10);
  assert.ok(mid.light > 0.4 && mid.light < 0.6);
  assert.ok(mid.sound < mid.light, 'sound a little ahead of the light');
  const end = sleepLevels(20);
  assert.equal(end.done, true);
  assert.equal(end.breathsPerMinute, 5);
  assert.equal(sleepLevels(0, dimStrokeSeconds() * 7).done, true, 'seven dimmer strokes end the fade');
  for (let t = 0; t < 20; t += 0.5) assert.ok(sleepLevels(t + 0.5).light <= sleepLevels(t).light, 'never brighter');
  assert.equal(SLEEP_CLOSE_SUB, 'You can take the headset off now.');
});

test('the dimmer: an open hand lowered 10 cm; once per stroke; a fist or a lost hand never counts', () => {
  const g = new DimGesture();
  let strokes = 0;
  for (let i = 0; i <= 10; i++) if (g.sample(i * 0.1, 1.0 - i * 0.012, 0.9)) strokes++;
  assert.equal(strokes, 1);
  for (let i = 0; i <= 10; i++) if (g.sample(2 + i * 0.1, 0.88 - i * 0.012, 0.9)) strokes++;
  assert.equal(strokes, 1, 'still going down: the same stroke');
  for (let i = 0; i <= 10; i++) g.sample(4 + i * 0.1, 0.8 + i * 0.02, 0.9);
  for (let i = 0; i <= 10; i++) if (g.sample(6 + i * 0.1, 1.0 - i * 0.012, 0.9)) strokes++;
  assert.equal(strokes, 2, 'raised again: a new stroke');
  const f = new DimGesture();
  for (let i = 0; i <= 10; i++) assert.equal(f.sample(i * 0.1, 1.0 - i * 0.02, 0.1), false, 'a fist');
  for (let i = 0; i <= 10; i++) assert.equal(f.sample(i * 0.1, null, null), false);
  const slow = new DimGesture();
  for (let i = 0; i <= 40; i++) assert.equal(slow.sample(i * 0.1, 1.0 - i * 0.003, 0.9), false, 'resting hands sinking slowly into the lap');
});

test('the night by voice', () => {
  // 29 Oct: no sleep timer any more — "stay" and minutes are not night commands.
  assert.equal(parseSleepCommand('stay with me'), null);
  assert.equal(parseSleepCommand('twenty minutes'), null);
  assert.deepEqual(parseSleepCommand('lights out'), { type: 'leave' });
  assert.deepEqual(parseSleepCommand('dimmer'), { type: 'dimmer' });
  assert.equal(parseSleepCommand('i stayed late at work'), null);
});

const plane = (label: string, y: number, orientation = 'horizontal'): PlaneCandidate => ({ id: label, orientation, label, center: { x: 0, y, z: 0 }, yaw: 0, halfX: 1, halfZ: 1, offsetX: 0, offsetZ: 0 });

test('the ceiling: a ceiling plane, else a high plane, else a ceiling volume, else a dome', () => {
  const head = 1.2;
  assert.deepEqual(findCeiling([plane('table', 0.74), plane('ceiling', 2.5)], [], head), { y: 2.5, source: 'plane' });
  assert.deepEqual(findCeiling([plane('', 2.4)], [], head), { y: 2.4, source: 'plane' });
  assert.equal(findCeiling([plane('', 1.5)], [], head).source, 'dome', 'a shelf just above the head is not a ceiling');
  const mesh = { id: 'm', label: 'ceiling', isBounded3D: true, position: { x: 0, y: 2.6, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, min: { x: -2, y: -0.05, z: -2 }, max: { x: 2, y: 0.05, z: 2 } };
  const m = findCeiling([], [mesh], head);
  assert.equal(m.source, 'mesh');
  assert.ok(Math.abs(m.y - 2.55) < 1e-9);
  assert.deepEqual(findCeiling([], [], head), { y: 2.3, source: 'dome' });
});

test('ceiling stars stay inside the 50° cone above the seat, and on the ceiling', () => {
  const head = { x: 0, y: 1.2, z: 0 };
  const forward = { x: 0, z: -1 };
  for (const ceiling of [{ y: 2.5, source: 'plane' as const }, { y: 2.3, source: 'dome' as const }]) {
    for (let i = 0; i < 200; i++) {
      const p = ceilingPoint((i * 2654435761) >>> 0, head, forward, ceiling);
      const horiz = Math.hypot(p.x - head.x, p.z - head.z);
      const angle = (Math.atan2(horiz, p.y - head.y) * 180) / Math.PI;
      assert.ok(angle <= CEILING_CONE_DEG + 0.5, `${angle.toFixed(1)}°`);
      if (ceiling.source === 'plane') assert.ok(Math.abs(p.y - 2.49) < 1e-9);
      else assert.ok(Math.abs(Math.hypot(p.x - head.x, p.y - head.y, p.z - head.z) - 1.1) < 1e-9);
    }
  }
});

test('every new line is voiced', () => {
  const keys = new Set(lampLines().map(lineKey));
  for (const line of [...Object.values(KEEP_LINES), ...Object.values(SLEEP_LINES)]) assert.ok(keys.has(lineKey(line)), line);
});

test('Your sky: one or two true sentences about what was kept and let go (nothing invented)', () => {
  const n = (date: string, kept: string[], letGo: string[] = []): NightRecord => ({ date, tomorrow: [], later: [], letGo, plan: [], planKept: false, kept });
  assert.equal(keptSummary([], '2026-10-29'), 'Your sky starts tonight. Keep a good thing, or let one go.');
  assert.equal(keptSummary([n('2026-10-29', [], ['Work'])], '2026-10-29'), 'One star for what you let go.');
  assert.equal(keptSummary([n('2026-10-28', ['A good meal']), n('2026-10-29', ['Rest'])], '2026-10-29'), 'Two good things these two weeks.');
  const nights = [n('2026-10-10', ['Old thing']), n('2026-10-27', ['Someone kind', 'A good meal'], ['Work', 'Money']), n('2026-10-29', ['someone kind', 'Rest'], ['Taxes'])];
  assert.equal(keptSummary(nights, '2026-10-29'), 'Four good things these two weeks, and three stars for what you let go. Someone kind came back twice.', 'older than 14 days does not count; the stars count all evenings');
});

test('Your sky: the kept lights float in a crown around the seat, in front, never under the desk glass', () => {
  const head = { x: 0, y: 1.2, z: 0 };
  const forward = { x: 0, z: -1 };
  for (const n of [1, 3, 12, 36]) {
    const seen: Array<{ x: number; y: number; z: number }> = [];
    for (let i = 0; i < n; i++) {
      const p = keptCrown(i, n, (i * 2654435761) >>> 0, head, forward);
      const dx = p.x - head.x;
      const dy = p.y - head.y;
      const dz = p.z - head.z;
      const flat = Math.hypot(dx, dz);
      const dist = Math.hypot(flat, dy);
      assert.ok(dist >= KEPT_CROWN.near - 1e-6 && dist <= KEPT_CROWN.far + 1e-6, `distance ${dist}`);
      const yaw = (Math.atan2(dx, -dz) * 180) / Math.PI;
      assert.ok(Math.abs(yaw) <= KEPT_CROWN.yaw + 1e-6, `yaw ${yaw}`);
      const pitch = (Math.atan2(dy, flat) * 180) / Math.PI;
      assert.ok(pitch >= KEPT_CROWN.low - 1e-6 && pitch <= KEPT_CROWN.high + 1e-6, `pitch ${pitch}`);
      for (const q of seen) assert.ok(Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) > 0.03, 'no two lights on top of each other');
      seen.push(p);
    }
  }
  const newest = keptCrown(35, 36, 7, head, forward);
  assert.ok(Math.abs(Math.atan2(newest.x, -newest.z)) < (40 * Math.PI) / 180, 'the newest stays near the middle');
});
