// Cold start (23 Oct): time to the first drawn landing (body.ready: the tray hero is on screen) on a throttled network
// with an empty cache, plus bytes downloaded by then and in the first 10 s.
//   node tools/onboarding/cold-start.mjs http://127.0.0.1:8799/ [downMbps=20] [latencyMs=40] [runs=3]
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const down = Number(process.argv[3] ?? 20);
const latency = Number(process.argv[4] ?? 40);
const runs = Number(process.argv[5] ?? 3);
const results = [];
for (let i = 0; i < runs; i++) {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: (down * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 });
  let bytes = 0;
  const big = [];
  cdp.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength));
  cdp.on('Network.responseReceived', (e) => big.push({ id: e.requestId, url: e.response.url }));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 60000, polling: 50 });
  const ready = (Date.now() - t0) / 1000;
  const bytesAtReady = bytes;
  const firstPaint = await page.evaluate(() => performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')?.startTime ?? null);
  await page.waitForTimeout(Math.max(0, 10000 - (Date.now() - t0)));
  results.push({ ready: +ready.toFixed(2), firstContentfulPaint: firstPaint == null ? null : +(firstPaint / 1000).toFixed(2), mbAtReady: +(bytesAtReady / 1e6).toFixed(2), mbAt10s: +(bytes / 1e6).toFixed(2) });
  await browser.close();
}
console.log(JSON.stringify({ url, down, latency, results }, null, 2));
