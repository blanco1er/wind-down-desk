// Axe 5: GPU cost of the ground projection — the backdrop alone, one Quest 3 eye, on vs off (src/desk/backdrop-bench.ts),
// for a few places, plus the frame budget numbers (draw calls) to show nothing else changed.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const out = [];
  for (const id of (process.env.WDD_PLACES ?? 'moon-beach,ember-fire,fireside-cabin').split(',')) {
    await f.evaluate((p) => void window.__wdd.place(p), id);
    await wait(4500);
    await f.evaluate(() => window.__wdd.immersion('full'));
    await wait(1200);
    const b = await f.evaluate(() => window.__wdd.backdropBench(60));
    await f.evaluate(() => window.__wdd.perfReset());
    await wait(2000);
    const p = await f.evaluate(() => window.__wdd.perf());
    out.push({ place: id, ...b, costMs: +(b.onMs - b.offMs).toFixed(3), costPct: +((100 * (b.onMs - b.offMs)) / b.offMs).toFixed(1), drawCallsP50: p.drawCalls?.p50 });
  }
  return out;
}
