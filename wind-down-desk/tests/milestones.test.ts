import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIGURES, figureFor, GLOBE_STARS, isSkyCommand, keepsakesFor, milestoneLine, milestoneToCelebrate, MILESTONES, plantGrowth, skyLine, starInGlobe } from '../src/logic/milestones.ts';
import { RitualMemory } from '../src/logic/memory.ts';

test('constellation: one point per evening, a figure that completes at 3, then 7, then 21 evenings', () => {
  assert.deepEqual([FIGURES[3].length, FIGURES[7].length, FIGURES[21].length], [3, 7, 21]);
  for (const m of MILESTONES) for (const [x, y] of FIGURES[m]) assert.ok(Math.hypot(x, y) <= 0.8, `inside the glass (${x}, ${y})`);
  assert.deepEqual([figureFor(0).tier, figureFor(0).lit], [3, 0]);
  assert.deepEqual([figureFor(2).tier, figureFor(2).lit, figureFor(2).complete], [3, 2, false]);
  assert.deepEqual([figureFor(3).tier, figureFor(3).complete], [3, true]);
  assert.deepEqual([figureFor(4).tier, figureFor(4).lit], [7, 4]);
  assert.deepEqual([figureFor(21).tier, figureFor(21).complete], [21, true]);
  assert.deepEqual([figureFor(40).tier, figureFor(40).lit], [21, 21], 'after 21 the spiral stays complete');
});

test('keepsakes: a pebble at 3 evenings, a cup of tea at 7, a plant at 21 (never lost), each milestone celebrated once', () => {
  assert.deepEqual(keepsakesFor(2), []);
  assert.deepEqual(keepsakesFor(3), ['pebble']);
  assert.deepEqual(keepsakesFor(8), ['pebble', 'cup']);
  assert.deepEqual(keepsakesFor(30), ['pebble', 'cup', 'plant']);
  assert.equal(milestoneToCelebrate(2, []), null);
  assert.equal(milestoneToCelebrate(3, []), 3);
  assert.equal(milestoneToCelebrate(3, [3]), null);
  assert.equal(milestoneToCelebrate(9, [3]), 7, 'a missed one is still celebrated, the smallest first');
  assert.equal(plantGrowth(21), 0);
  assert.equal(plantGrowth(49), 1);
  for (const m of MILESTONES) assert.ok(milestoneLine(m).line.length <= 64, 'one caption line');
  // 28 Oct (owner): no candle on the table any more (the lamp is the only light there).
  for (const m of MILESTONES) assert.ok(!/candle/i.test(`${milestoneLine(m).line} ${milestoneLine(m).sub}`), 'no candle');
  assert.deepEqual(milestoneLine(7), { line: 'Seven evenings. A cup of something warm stays with you.', sub: 'It steams again each time you come back.' });
});

test('your stars inside the glass lamp: one fixed, addressable place per star, inside the glass, apart', () => {
  const pts = Array.from({ length: GLOBE_STARS }, (_, k) => starInGlobe(k));
  for (const p of pts) {
    const r = Math.hypot(...p);
    assert.ok(r > 0.25 && r < 0.78, `inside the glass, clear of the heart (${r.toFixed(2)})`);
  }
  assert.deepEqual(starInGlobe(7), starInGlobe(7), 'deterministic');
  // The first stars are well apart (the first evenings' sky reads as separate stars).
  let min = Infinity;
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) min = Math.min(min, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]));
  assert.ok(min > 0.12, `first twelve apart (${min.toFixed(3)})`);
});

test('the lamp says the sky plainly, and "show me my sky" brings it back', () => {
  assert.equal(skyLine(1, 2), 'Evening 2. Two more evenings to complete it. Two stars for what you let go.');
  assert.equal(skyLine(3, 0), 'Three evenings. Your constellation is complete.');
  assert.equal(skyLine(6, 1), 'Evening 7. One more evening to complete it. One star for what you let go.');
  assert.ok(isSkyCommand('show me my sky'));
  assert.ok(isSkyCommand('my stars'));
  assert.ok(!isSkyCommand('the stars were beautiful last night'));
});

test('memory: evenings before tonight count, celebrated milestones persist, forget erases them', () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  const now = () => new Date(2026, 9, 26, 21, 0);
  const memory = new RitualMemory(store, now);
  memory.seedHistory(3);
  assert.equal(memory.evenings(), 3);
  memory.recordNight({ tomorrow: [], later: [], letGo: ['x'] });
  assert.equal(memory.evenings(), 3, 'tonight counts from tomorrow');
  memory.celebrate(3);
  assert.deepEqual(new RitualMemory(store, now).celebrated(), [3]);
  memory.forget();
  assert.deepEqual(new RitualMemory(store, now).celebrated(), []);
});
