import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkoutLine, CHECKOUT_LINES, nightSummary, parseTension, RAIL, railTouch, TENSION_WORDS, tensionArrow, TensionDial, tensionU, tensionValue, tensionWord } from '../src/logic/tension.ts';
import { proposeRitual, PROPOSAL_LINES } from '../src/logic/evening.ts';
import { RitualMemory, type KeyValueStore } from '../src/logic/memory.ts';
import { lampLines, lineKey } from '../src/logic/lamp-lines.ts';

function store(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}
const at = (iso: string) => () => new Date(iso);

test('the rail maps 0..1 to 0..10 and back', () => {
  assert.equal(tensionValue(0), 0);
  assert.equal(tensionValue(0.68), 7);
  assert.equal(tensionValue(1.4), 10, 'clamped');
  assert.equal(tensionU(3), 0.3);
  assert.equal(tensionWord(1), 'light');
  assert.equal(tensionWord(7), 'heavy');
  assert.equal(tensionWord(10), 'very heavy');
});

test('a fingertip touches the rail only near it (≥ 4.4 cm band, a little past the ends)', () => {
  const mid = { x: 0, y: RAIL.y, z: RAIL.z };
  assert.equal(railTouch(mid), 0.5);
  assert.equal(railTouch({ ...mid, x: RAIL.x0 - 0.02 }), 0, 'just past the light end: the bead stops at 0');
  assert.equal(railTouch({ ...mid, x: RAIL.x1 + 0.1 }), null, 'far past the end');
  assert.equal(railTouch({ ...mid, z: RAIL.z + 0.06 }), null, 'in front of the rail');
  assert.equal(railTouch({ ...mid, y: RAIL.y + 0.1 }), null, 'a hand passing over it');
  assert.ok(RAIL.touchZ * 2 >= 0.044, 'touch band at least 4.4 cm deep');
  assert.ok(RAIL.touchAbove + RAIL.touchBelow >= 0.044, 'and 4.4 cm tall');
});

test('the bead follows the finger and is kept once the finger has left and it is still', () => {
  const d = new TensionDial(0.5);
  assert.equal(d.finger(0.5, 0), true, 'first touch');
  for (let t = 0; t <= 1; t += 0.05) {
    d.finger(0.5 + t * 0.3, t);
    assert.equal(d.tick(t, 0.05), null, 'never kept while the finger is on it');
  }
  d.finger(null, 1.05);
  assert.equal(d.tick(1.5, 0.05), null, 'not yet: 0.45 s after');
  const kept = d.tick(2.0, 0.05);
  assert.equal(kept, 8);
  assert.equal(d.tick(2.5, 0.05), null, 'kept once');
  assert.equal(d.committed, 8);
});

test('without a touch nothing is ever kept (the lamp waits)', () => {
  const d = new TensionDial(0.5);
  for (let t = 0; t < 30; t += 0.5) assert.equal(d.tick(t, 0.5), null);
});

test('voice: numbers, words, "skip"; anything else is not an answer', () => {
  assert.equal(parseTension('seven'), 7);
  assert.equal(parseTension('About a 7'), 7);
  assert.equal(parseTension('I would say six out of ten'), 6);
  assert.equal(parseTension('maybe 3'), 3);
  assert.equal(parseTension('pretty heavy'), 8);
  assert.equal(parseTension('very heavy tonight'), 9);
  assert.equal(parseTension('a bit heavy'), 6);
  assert.equal(parseTension('light'), 2);
  assert.equal(parseTension('so so'), 5);
  assert.equal(parseTension('skip'), 'skip');
  assert.equal(parseTension('not now'), 'skip');
  assert.equal(parseTension('eleven'), null);
  assert.equal(parseTension('42'), null);
  assert.equal(parseTension('I need to call the dentist tomorrow'), null, 'a brain dump is not an answer');
  for (const w of TENSION_WORDS) assert.equal(parseTension(w.label), w.value, `the touch word "${w.label}" and its voice agree`);
});

test('before Good night: the lamp names the change, never a score', () => {
  assert.equal(checkoutLine(7, 3), CHECKOUT_LINES.lighter);
  assert.equal(checkoutLine(5, 6), CHECKOUT_LINES.same);
  assert.equal(checkoutLine(3, 6), CHECKOUT_LINES.heavier);
  assert.equal(checkoutLine(undefined, 4), CHECKOUT_LINES.only);
  for (const line of Object.values(CHECKOUT_LINES)) assert.doesNotMatch(line, /\d/u);
  assert.equal(tensionArrow(7, 3), '7 → 3');
  assert.equal(tensionArrow(null, 3), '3');
});

test('the evening summary is true to what was recorded', () => {
  assert.equal(nightSummary({ letGo: 3, breaths: 6, kept: 0, tensionIn: 7, tensionOut: 3 }), 'Tonight: 3 let go · 6 breaths · 7 → 3');
  assert.equal(nightSummary({ letGo: 1, breaths: 0, kept: 3 }), 'Tonight: 1 let go · 3 good things kept');
  assert.equal(nightSummary({ letGo: 0, breaths: 0, kept: 0, tensionIn: 5 }), 'A quiet evening.', 'one side alone is not a change');
});

test('memory keeps tonight\'s bead, in and out, with the evening (and only on this device)', () => {
  const s = store();
  const m = new RitualMemory(s, at('2026-10-28T21:00:00'));
  assert.equal(m.tonightRecord(), null);
  m.recordTension('in', 7.4);
  m.recordNight({ tomorrow: ['Call the dentist'], later: [], letGo: ['That email tone'] });
  m.recordTension('out', 3);
  const again = new RitualMemory(s, at('2026-10-28T23:30:00'));
  const night = again.tonightRecord();
  assert.equal(night?.tensionIn, 7);
  assert.equal(night?.tensionOut, 3);
  assert.deepEqual(night?.letGo, ['That email tone'], 'recordNight keeps the bead');
  m.recordTension('in', -4);
  assert.equal(m.tonightRecord()?.tensionIn, 0, 'clamped');
});

test('the bead shapes the first proposal only; the person still decides', () => {
  const base = { hour: 21, doneTonight: [] as never[] };
  const heavy = proposeRitual({ ...base, tension: 8 });
  assert.equal(heavy.ritual, 'unload');
  assert.equal(heavy.line, PROPOSAL_LINES.weight);
  const heavyLate = proposeRitual({ ...base, hour: 23, tension: 8 });
  assert.equal(heavyLate.ritual, 'breathe');
  const light = proposeRitual({ ...base, tension: 2 });
  assert.equal(light.ritual, 'keep');
  assert.equal(proposeRitual({ ...base, tension: 5 }).ritual, 'unload', 'middle: as before');
  assert.equal(proposeRitual({ ...base, tension: null }).line, PROPOSAL_LINES.start, 'no bead: as before');
  assert.equal(proposeRitual({ hour: 21, doneTonight: ['unload'], tension: 8 }).ritual, 'release', 'once a ritual is done the bead no longer leads');
  assert.equal(proposeRitual({ ...base, tension: 9, firstEvening: true }).ritual, 'unload', 'a first evening still goes to the core gesture');
});

test('every new line of the lamp is in the voice catalogue', () => {
  const keys = new Set(lampLines().map(lineKey));
  for (const line of [...Object.values(CHECKOUT_LINES), 'How heavy is tonight? Slide the bead.', 'Before you sleep: how heavy now?', 'Thank you. I will remember it.', PROPOSAL_LINES.weight, PROPOSAL_LINES.light]) {
    assert.ok(keys.has(lineKey(line)), line);
  }
});
