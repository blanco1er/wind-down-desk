// Living places — CPU time per frame in every place (Chromium, player mode, CPU throttled ×1 / ×4 / ×6 by CDP).
//   node tools/living-perf.mjs https://localhost:8097/ [out.json] [rates=1,4,6] [seconds per sample=5]
// For each place ("My room" then the nine night places, Full immersion): ECS update + render submit CPU (p50, p95)
// from window.__wdd.perf() (systems/perf-system.ts), draw calls, triangles, and the living layer's own draw calls.
// Quest 3 budget (FICHE Meta XR): 72 Hz = 13.9 ms; keep ≤ 7 ms CPU at p95 with ×4 / ×6. Note `uptime` (load) too.
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'https://localhost:8097/';
const out = process.argv[3] ?? 'artifacts/living-night/perf.json';
const rates = (process.argv[4] ?? '1,4,6').split(',').map(Number);
const seconds = Number(process.argv[5] ?? 5);
const PLACES = ['room', 'ember-fire', 'moon-lake', 'moon-beach', 'northern-lights', 'rain-veranda', 'firefly-meadow', 'desert-stars', 'fireside-cabin', 'rooftop-city'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await page.goto(url);
await page.waitForFunction(() => window.__wdd != null && window.IWER_DEVICE != null, null, { timeout: 60000 });
await wait(2500);
// WDD_RETURNING=1: a returning visitor (21 evenings of history), so the arrival is the lamp's proposal as in the
// earlier measurements; without it a fresh profile gets the first-evening onboarding (Unload, example stone, ghost hand).
if (process.env.WDD_RETURNING === '1') await page.evaluate(() => window.__wdd?.film?.history?.(21));
// WDD_ACCESS=1: every accessibility setting on (gaze-only selection, high contrast, larger text).
// WDD_ACCESS=visual: contrast + larger text only (with gaze selection on, the scripted head dwells on buttons and opens menus).
if (process.env.WDD_ACCESS === '1') await page.evaluate(() => window.__wdd.access({ gazeSelect: true, contrast: true, largeText: true }));
if (process.env.WDD_ACCESS === 'visual') await page.evaluate(() => window.__wdd.access({ contrast: true, largeText: true }));
await page.click((await page.isVisible('[data-style="talk"]')) ? '[data-style="talk"]' : '#begin');
await page.waitForFunction(() => ['table', 'floating'].includes(window.__wdd.state().placement) && window.__wddPlayer != null, null, { timeout: 30000 });
await wait(3000);
if (await page.isVisible('[data-act="help-ok"]')) await page.click('[data-act="help-ok"]');

const load = execSync('uptime').toString().trim();
const report = { url, load, rates, seconds, places: {} };
for (const id of PLACES) {
  await page.evaluate((p) => window.__wdd.place(p), id);
  await wait(5000);
  await page.evaluate(() => window.__wdd.immersion('full'));
  await wait(2500);
  const rows = [];
  for (const rate of rates) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await wait(700);
    await page.evaluate(() => window.__wdd.perfReset());
    await wait(seconds * 1000);
    const p = await page.evaluate(() => ({ ...window.__wdd.perf(), living: window.__wdd.living().drawCalls }));
    rows.push({
      rate,
      updateP50: p.updateMs.p50,
      updateP95: p.updateMs.p95,
      renderP50: p.renderMs.p50,
      renderP95: p.renderMs.p95,
      cpuP95: +(p.updateMs.p95 + p.renderMs.p95).toFixed(2),
      frameP50: p.frameMs.p50,
      drawCalls: p.drawCalls.p50,
      triangles: p.triangles.p50,
      living: p.living,
    });
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  report.places[id] = rows;
  console.log(id.padEnd(16), rows.map((r) => `×${r.rate}: cpu p95 ${r.cpuP95} ms, ${r.drawCalls} draws (${r.living} living)`).join(' | '));
}
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`load: ${load}`);
await browser.close();
