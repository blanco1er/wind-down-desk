// 29 Oct (solidity) — cold start on the PRODUCTION build, as a judge's first visit: no cache, Quest Browser's user
// agent, the emulated preview (?preview=1, IWER inside the build). Measured from the touch on "Begin" (or "Talk with
// the lamp"): XR session up, desk placed, the lamp lit (its wake), the desk revealed, the interface on screen.
// Target: the lamp visible in < 5 s. Networks: fast, 8 Mbit/s (Wi-Fi on a busy evening), then a warm second visit.
//   PORT=8795 WDD_SERVE_DIST=1 node server/index.ts &   node tools/solidite-29oct/cold-start.mjs http://127.0.0.1:8795
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://127.0.0.1:8795';
const QUEST_UA = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/41.0.0.x.x.x Chrome/134.0.0.0 VR Safari/537.36';
const RUNS = [
  { name: 'fast, cold', net: null, cache: false },
  { name: '8 Mbit/s, cold', net: { latency: 40, down: 8e6 / 8, up: 2e6 / 8 }, cache: false },
  { name: '8 Mbit/s, second visit (cache)', net: { latency: 40, down: 8e6 / 8, up: 2e6 / 8 }, cache: true },
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const results = [];
let warmCtx = null;
for (const run of RUNS) {
  const ctx = run.cache && warmCtx != null ? warmCtx : await browser.newContext({ userAgent: QUEST_UA, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: !run.cache });
  if (run.net != null) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: run.net.latency, downloadThroughput: run.net.down, uploadThroughput: run.net.up });
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 140)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 140)}`); });
  // The headless render loop needs a screencast to advance frames.
  cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  const tOpen = Date.now();
  await page.goto(`${base}/?preview=1`, { waitUntil: 'commit' });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 20, maxWidth: 320, maxHeight: 200, everyNthFrame: 2 });
  let landingS = null;
  for (let i = 0; i < 1200 && landingS == null; i++) {
    if (await page.evaluate(() => document.body?.classList.contains('ready') && window.__wdd != null).catch(() => false)) landingS = (Date.now() - tOpen) / 1000;
    else await wait(50);
  }
  const bytesAtLanding = bytes;
  // The judge touches Begin as soon as the landing is ready (the app may still be loading: the worst case).
  const sel = (await page.isVisible('[data-style="talk"]').catch(() => false)) ? '[data-style="talk"]' : '#begin';
  const t0 = Date.now();
  await page.click(sel);
  const marks = {};
  for (let i = 0; i < 900; i++) {
    const st = await page
      .evaluate(() => {
        const d = window.__wdd;
        const v = d?.debug?.().visuals;
        const placed = d?.state != null && ['table', 'floating'].includes(d.state().placement);
        return { app: d?.state != null, xr: d?.perf?.().xr === true, placed, lampLit: placed && (v?.wake ?? 0) > 0.3, deskRevealed: placed && (v?.reveal ?? 0) > 0.9, interface: placed && (v?.reveal ?? 0) > 0.9 && v?.uiShown === true };
      })
      .catch(() => null);
    const t = (Date.now() - t0) / 1000;
    if (st != null) for (const k of Object.keys(st)) if (st[k] && marks[k] == null) marks[k] = +t.toFixed(2);
    if (marks.interface != null) break;
    await wait(50);
  }
  await cdp.send('Page.stopScreencast').catch(() => {});
  results.push({ run: run.name, landingReadyS: landingS == null ? null : +landingS.toFixed(2), mbToLanding: +(bytesAtLanding / 1048576).toFixed(2), afterBegin: marks, mbTotal: +(bytes / 1048576).toFixed(2), errors });
  await page.close();
  if (!run.cache) warmCtx = ctx;
}
await browser.close();
mkdirSync('artifacts/solidite-29oct', { recursive: true });
writeFileSync('artifacts/solidite-29oct/cold-start.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 1));
