// Lot 2b: per-frame cost of the sky in the lamp (shown vs not) and of the keepsakes, CPU ×1 / ×6 (perf-system).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const rows = [];
  for (const rate of [1, 6]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    for (const sky of [false, true, false, true]) {
      if (sky) await f.evaluate(() => window.__wdd.sky(false));
      await wait(1500);
      await f.evaluate(() => window.__wdd.perfReset());
      await wait(2500);
      const p = await f.evaluate(() => window.__wdd.perf());
      rows.push({ rate, sky, cpuP95: +(p.updateMs.p95 + p.renderMs.p95).toFixed(2), draws: p.drawCalls.p50, tris: p.triangles.p50, frameP95: p.frameMs.p95 });
      await wait(sky ? 5000 : 0);
    }
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return rows;
}
