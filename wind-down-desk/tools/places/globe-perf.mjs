// The lamp shows the places: per-frame cost with the globe open (a place in the glass) vs closed, CPU ×1 / ×6,
// ECS update + render submit p95 and draw calls (perf-system), alternated to cancel drift. Plus the old grid
// (PLACES_IN_GLOBE false) is not measured here: its 11 chips were 11 draws per eye.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const rows = [];
  for (const rate of [1, 6]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    for (const open of [false, true, false, true]) {
      await f.evaluate((o) => window.__wdd.globe(o ? 'open' : 'close'), open);
      await wait(1800);
      await f.evaluate(() => window.__wdd.perfReset());
      await wait(2500);
      const p = await f.evaluate(() => window.__wdd.perf());
      rows.push({ rate, globe: open ? 'open' : 'closed', cpuP95: +(p.updateMs.p95 + p.renderMs.p95).toFixed(2), draws: p.drawCalls.p50, tris: p.triangles.p50 });
    }
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await f.evaluate(() => window.__wdd.globe('close'));
  return rows;
}
