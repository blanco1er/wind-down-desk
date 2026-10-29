import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyFeeling, parseRitualCommand, PROPOSAL_LINES, proposeRitual, RITUAL_MENU } from '../src/logic/evening.ts';
import { lampLines, lineKey } from '../src/logic/lamp-lines.ts';
import { RitualMemory, type KeyValueStore } from '../src/logic/memory.ts';
import { cleanWeightTitle, weightTitle } from '../src/shared/agent/weight.ts';
import { SimulatedAgent } from '../src/shared/agent/simulated.ts';

test('agent hears how you are: tense, one heavy thing, a full head, or nothing special', () => {
  assert.equal(classifyFeeling("I'm so stressed, my heart is pounding"), 'tense');
  assert.equal(classifyFeeling("I can't stop thinking about the meeting with Paul"), 'heavy');
  assert.equal(classifyFeeling('The landlord, the dentist, the slides for Monday and my passport'), 'many');
  assert.equal(classifyFeeling('So much to do tomorrow'), 'many');
  assert.equal(classifyFeeling('Fine, thanks'), 'neutral');
  assert.equal(classifyFeeling(''), 'neutral');
});

test('proposal from what it hears ("You sound tense. Shall we breathe first?")', () => {
  const base = { hour: 21, doneTonight: [] };
  const tense = proposeRitual({ ...base, heard: 'Honestly I feel tense and wired tonight' });
  assert.equal(tense.ritual, 'breathe');
  assert.equal(tense.line, 'You sound tense. Shall we breathe first?');
  const heavy = proposeRitual({ ...base, heard: "I keep replaying the meeting with Paul" });
  assert.equal(heavy.ritual, 'release');
  assert.equal(heavy.carry, 'I keep replaying the meeting with Paul', 'the heavy thing is carried into Release');
  const many = proposeRitual({ ...base, heard: 'The landlord, the dentist, and the slides for Monday' });
  assert.equal(many.ritual, 'unload');
  assert.equal(many.reason, 'many');
});

test('proposal from the time and from tonight (chain: Unload → Release → Breathe → sleep)', () => {
  assert.equal(proposeRitual({ hour: 21, doneTonight: [] }).line, PROPOSAL_LINES.start);
  assert.equal(proposeRitual({ hour: 23, doneTonight: [] }).ritual, 'breathe');
  assert.equal(proposeRitual({ hour: 1, doneTonight: [] }).reason, 'late');
  assert.equal(proposeRitual({ hour: 21, doneTonight: ['unload'], justDone: 'unload' }).ritual, 'release');
  assert.equal(proposeRitual({ hour: 21, doneTonight: ['unload', 'release'], justDone: 'release' }).ritual, 'breathe');
  assert.equal(proposeRitual({ hour: 21, doneTonight: ['unload', 'release', 'breathe'], justDone: 'breathe' }).ritual, 'sleep');
  // Never proposes what was already done tonight.
  assert.equal(proposeRitual({ hour: 21, doneTonight: ['breathe', 'release'], justDone: 'release' }).ritual, 'sleep');
  assert.equal(proposeRitual({ hour: 21, doneTonight: ['release'], justDone: 'release' }).ritual, 'breathe');
  assert.equal(proposeRitual({ hour: 21, doneTonight: ['unload'] }).ritual, 'release');
});

test('every proposal line is pre-voiced', () => {
  const keys = new Set(lampLines().map(lineKey));
  for (const line of Object.values(PROPOSAL_LINES)) assert.ok(keys.has(lineKey(line)), `not voiced: ${line}`);
  // 28 Oct: Squeeze, Keep and Your sky (the journal) joined the menu; Good night stays last.
  assert.deepEqual(RITUAL_MENU.map((r) => r.name), ['Unload', 'Breathe', 'Squeeze', 'Release', 'Keep', 'Talk it through', 'Your sky', 'Good night']);
});

test('ritual commands: whole sentences only, phase-aware', () => {
  assert.deepEqual(parseRitualCommand("Let's breathe", 'choose'), { type: 'pick', ritual: 'breathe' });
  assert.deepEqual(parseRitualCommand('Release', 'unload'), { type: 'pick', ritual: 'release' });
  assert.deepEqual(parseRitualCommand('Empty my head', 'choose'), { type: 'pick', ritual: 'unload' });
  assert.deepEqual(parseRitualCommand('Yes please', 'choose'), { type: 'accept' });
  assert.deepEqual(parseRitualCommand('Sure.', 'choose'), { type: 'accept' });
  assert.deepEqual(parseRitualCommand('Not now', 'choose'), { type: 'decline' });
  assert.deepEqual(parseRitualCommand('Rituals', 'unload'), { type: 'menu' });
  assert.deepEqual(parseRitualCommand("That's enough", 'breathe'), { type: 'finish' });
  assert.deepEqual(parseRitualCommand('Longer', 'breathe'), { type: 'longer' });
  assert.deepEqual(parseRitualCommand('Let it go', 'release'), { type: 'sink' });
  assert.deepEqual(parseRitualCommand('Good night', 'breathe'), { type: 'goodnight' });
  // A brain dump that mentions breathing or letting go never switches ritual.
  assert.equal(parseRitualCommand('I need to breathe more at work', 'unload'), null);
  assert.equal(parseRitualCommand('Let it go', 'unload'), null, 'in Unload, "let it go" is the bowl');
  assert.equal(parseRitualCommand('yes', 'unload'), null, '"yes" only answers a proposal');
  assert.equal(parseRitualCommand("That's it", 'choose'), null);
  assert.equal(parseRitualCommand('Breathe', 'breathe'), null, 'already breathing');
});

test('Release stone engraving: ≤ 4 words, their own words', () => {
  assert.equal(weightTitle("I can't stop thinking about the meeting with Paul tomorrow, I'm dreading it."), 'The meeting with Paul');
  assert.equal(weightTitle('I keep replaying the awkward comment I made in the meeting'), 'The awkward comment');
  assert.equal(weightTitle("I'm worried about my mum's health"), "My mum's health");
  assert.equal(weightTitle('uh'), 'This weight');
  for (const s of ['So, um, what weighs on me is the argument with my sister about money', 'I feel guilty about missing Emma’s birthday party last week', 'a b c d e f g h']) {
    const t = weightTitle(s);
    assert.ok(t.split(' ').length <= 4 && t.length <= 24, `${s} → ${t}`);
  }
  assert.equal(cleanWeightTitle('The meeting with Paul.', 'x'), 'The meeting with Paul');
  assert.equal(cleanWeightTitle('A very long answer that does not fit at all', 'the email from my boss'), 'Email from my boss');
  assert.equal(cleanWeightTitle(42, 'money'), 'Money');
});

test('simulated agent summarises for Release', async () => {
  assert.equal(await new SimulatedAgent().summarize('The meeting with Paul.'), 'The meeting with Paul');
});

function mapStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}
const at = (iso: string) => () => new Date(iso);

test('memory: rituals tonight, breaths, and what sank becomes a star', () => {
  const s = mapStore();
  const m = new RitualMemory(s, at('2026-10-18T22:00:00'));
  assert.deepEqual(m.doneTonight(), []);
  m.recordRitual('unload');
  m.recordRitual('release', { sunk: 'The meeting with Paul' });
  m.recordRitual('breathe', { breaths: 6 });
  assert.deepEqual(m.doneTonight(), ['unload', 'release', 'breathe']);
  assert.equal(m.totalBreaths(), 6);
  assert.equal(m.totalLetGo(), 1, 'a sunk stone is a star');
  // After midnight it is still the same evening; the next evening starts fresh.
  assert.deepEqual(new RitualMemory(s, at('2026-10-19T01:30:00')).doneTonight(), ['unload', 'release', 'breathe']);
  const next = new RitualMemory(s, at('2026-10-19T21:00:00'));
  assert.deepEqual(next.doneTonight(), []);
  assert.equal(next.ritualEvenings('release'), 1);
  assert.equal(next.streak(), 1);
  assert.equal(next.timesLetGoBefore('the meeting with Paul'), 1, 'recurring weights are noticed');
  // Older records without rituals still load.
  s.setItem('wind-down-desk.memory.v1', JSON.stringify({ version: 1, nights: [{ date: '2026-10-17', tomorrow: [], later: [], letGo: ['x'], plan: [], planKept: false }], stars: [], laterPool: [], morningSeen: null }));
  const old = new RitualMemory(s, at('2026-10-18T21:00:00'));
  assert.deepEqual(old.doneTonight(), []);
  assert.equal(old.ritualEvenings('unload'), 0);
});
