import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SQUEEZE, FistState, MAX_ROUNDS, MIN_SQUEEZE, SQUEEZE_LINES, squeezeAt, squeezeButton, squeezeCaption, squeezeLine, SqueezeSession, squeezeTotal } from '../src/logic/squeeze.ts';
import { opennessFromCurl } from '../src/logic/breathe.ts';
import { parseRitualCommand, proposeRitual, PROPOSAL_LINES } from '../src/logic/evening.ts';
import { lampLines, lineKey } from '../src/logic/lamp-lines.ts';

const P = DEFAULT_SQUEEZE;

test('the whole ritual: settle, three rounds of fists, shoulders, jaw, close — about a minute', () => {
  const total = squeezeTotal(P);
  assert.ok(total >= 55 && total <= 95, `${total} s`);
  const phases: string[] = [];
  for (let t = 0; t <= total + 1; t += 0.25) {
    const f = squeezeAt(P, t);
    if (phases.at(-1) !== f.phase) phases.push(f.phase);
  }
  assert.deepEqual(phases, ['settle', 'squeeze', 'release', 'squeeze', 'release', 'squeeze', 'release', 'shoulders-up', 'shoulders-down', 'jaw', 'close', 'done']);
});

test('the light gathers while squeezing and escapes quickly on release', () => {
  const s0 = P.settle;
  assert.equal(squeezeAt(P, s0).tight, 0);
  assert.ok(squeezeAt(P, s0 + P.squeeze * 0.8).tight > 0.99, 'fully gathered before the end of the squeeze');
  const r = s0 + P.squeeze;
  assert.ok(squeezeAt(P, r + 0.1).tight > 0.9);
  assert.ok(squeezeAt(P, r + 1.3).tight < 0.01, 'gone in about a second');
  assert.equal(squeezeAt(P, r).completed, 1);
});

test('opening the fists after 2 s of squeezing starts the release now; earlier it does nothing', () => {
  const s = new SqueezeSession();
  s.begin(10);
  const inSqueeze = 10 + P.settle + 1;
  assert.equal(s.unclench(inSqueeze), false, `under ${MIN_SQUEEZE} s: ignored (a flicker of the tracking)`);
  assert.equal(s.frame(inSqueeze).phase, 'squeeze');
  assert.equal(s.clench(inSqueeze), true);
  assert.equal(s.clench(inSqueeze + 0.5), false, 'once per round');
  const later = 10 + P.settle + 2.5;
  assert.equal(s.unclench(later), true);
  const f = s.frame(later);
  assert.equal(f.phase, 'release');
  assert.ok(f.t < 0.01, 'at the very start of the release');
  assert.equal(s.followed(0), true);
  assert.equal(s.followedCount(), 1);
});

test('nothing is required: without hands the clock runs to the end', () => {
  const s = new SqueezeSession();
  s.begin(0);
  assert.equal(s.frame(squeezeTotal(P) + 0.1).phase, 'done');
  assert.equal(s.followedCount(), 0);
});

test('"Enough" settles from where it is; "Once more" adds a round, up to the maximum', () => {
  const s = new SqueezeSession();
  s.begin(0);
  assert.equal(s.more(1), true);
  assert.equal(s.pattern.rounds, 4);
  while (s.more(1));
  assert.equal(s.pattern.rounds, MAX_ROUNDS);
  const t = P.settle + 3;
  const before = s.frame(t).tight;
  s.finish(t);
  const f = s.frame(t + 0.01);
  assert.equal(f.phase, 'close');
  assert.ok(Math.abs(f.tight - before) < 0.05, 'no jump');
  assert.equal(s.frame(t + P.close + 0.1).phase, 'done');
  assert.equal(s.more(t + 1), false, 'not while closing');
  assert.equal(new SqueezeSession().pattern.rounds, P.rounds, 'the default pattern is never changed');
});

test('a fist with hysteresis (tracking flickers when fingers are hidden)', () => {
  const f = new FistState();
  assert.equal(f.update(opennessFromCurl(0.17)), false, 'open hand');
  assert.equal(f.update(opennessFromCurl(0.1)), true, 'curled');
  assert.equal(f.update(0.42), true, 'half-open: still a fist');
  assert.equal(f.update(null), true, 'lost tracking: unchanged');
  assert.equal(f.update(0.6), false, 'open again');
});

test('voice twins: "squeeze" / "let go" during the ritual; the ritual is picked by name', () => {
  assert.deepEqual(parseRitualCommand('squeeze', 'squeeze'), { type: 'clench' });
  assert.deepEqual(parseRitualCommand('let go', 'squeeze'), { type: 'unclench' });
  assert.deepEqual(parseRitualCommand('release', 'squeeze'), { type: 'unclench' }, 'never the Release ritual from inside Squeeze');
  assert.deepEqual(parseRitualCommand("that's enough", 'squeeze'), { type: 'finish' });
  assert.deepEqual(parseRitualCommand('squeeze and let go', 'choose'), { type: 'pick', ritual: 'squeeze' });
  assert.deepEqual(parseRitualCommand('relax my body', 'choose'), { type: 'pick', ritual: 'squeeze' });
  assert.equal(parseRitualCommand('let go', 'unload'), null, 'outside Squeeze "let go" keeps its meaning');
  assert.equal(proposeRitual({ hour: 21, doneTonight: ['squeeze'], justDone: 'squeeze' }).line, PROPOSAL_LINES.afterSqueeze);
});

test('touch twin and captions: always one useful button; every spoken line is voiced', () => {
  assert.equal(squeezeButton(squeezeAt(P, P.settle + 1)), 'Let go');
  assert.equal(squeezeButton(squeezeAt(P, 1)), 'Once more');
  assert.equal(squeezeCaption(squeezeAt(P, P.settle + 1), P).text, 'Squeeze… hold.');
  assert.match(squeezeCaption({ ...squeezeAt(P, squeezeTotal(P)), completed: 3 }, P).sub, /3 times/u);
  const keys = new Set(lampLines().map(lineKey));
  for (const line of SQUEEZE_LINES) assert.ok(keys.has(lineKey(line)), line);
  for (let t = 0; t < squeezeTotal(P); t += 0.5) {
    const line = squeezeLine(squeezeAt(P, t), P);
    if (line != null) assert.ok((SQUEEZE_LINES as readonly string[]).includes(line), line);
  }
});
