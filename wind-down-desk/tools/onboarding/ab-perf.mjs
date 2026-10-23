// A/B of this lot's per-frame additions (gaze focus, onboarding, hand look) at EQUAL load: same page, alternating
// off / on, CPU ×1 / ×4 / ×6, ECS update and render submit p95 (systems/perf-system.ts). Returning visitor.
//   node tools/onboarding/ab-perf.mjs https://localhost:8081/?player=1 [out.json]
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'https://localhost:8081/?player=1';
const out = process.argv[3] ?? 'artifacts/onboarding/ab-perf.json';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await page.goto(url);
await page.waitForFunction(() => window.__wdd != null && window.IWER_DEVICE != null, null, { timeout: 60000 });
await wait(2500);
await page.evaluate(() => window.__wdd?.film?.history?.(21));
await page.click((await page.isVisible('[data-style="talk"]')) ? '[data-style="talk"]' : '#begin');
await page.waitForFunction(() => ['table', 'floating'].includes(window.__wdd.state().placement), null, { timeout: 30000 });
await wait(3000);
const rows = [];
for (const place of ['room', 'fireside-cabin']) {
  await page.evaluate((p) => window.__wdd.place(p), place);
  await wait(4000);
  if (place !== 'room') await page.evaluate(() => window.__wdd.immersion('full'));
  await wait(1500);
  for (const rate of [1, 4, 6]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    for (const off of [true, false, true, false]) {
      await page.evaluate((o) => window.__wdd.ab(o), off);
      await wait(500);
      await page.evaluate(() => window.__wdd.perfReset());
      await wait(3500);
      const p = await page.evaluate(() => window.__wdd.perf());
      rows.push({ place, rate, additions: off ? 'off' : 'on', update: p.updateMs.p95, render: p.renderMs.p95, draws: p.drawCalls.p50 });
    }
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
}
await page.evaluate(() => window.__wdd.ab(false));
const summary = {};
for (const r of rows) {
  const k = `${r.place} ×${r.rate} ${r.additions}`;
  (summary[k] ??= []).push(+(r.update + r.render).toFixed(2));
}
writeFileSync(out, JSON.stringify({ rows, summary }, null, 2));
for (const [k, v] of Object.entries(summary)) console.log(k.padEnd(28), v.join(' / '), 'ms (update+render p95)');
await browser.close();
