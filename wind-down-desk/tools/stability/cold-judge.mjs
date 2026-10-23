// Cold judge, production build (26 Oct): a judge's browser opening the site for the first time — Quest Browser's
// user agent, no cache, three networks (fast, 8 Mbit/s, 3G). Landing usable ("Begin" ready), bytes downloaded, page
// errors. Then, on a computer with the emulated preview: microphone refused, then allowed, inside the evening.
//   PORT=8795 WDD_SERVE_DIST=1 node server/index.ts &   node tools/stability/cold-judge.mjs http://127.0.0.1:8795
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://127.0.0.1:8795';
const QUEST_UA = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/41.0.0.x.x.x Chrome/134.0.0.0 VR Safari/537.36';
const NETS = { fast: null, '8mbit': { latency: 40, down: 8e6 / 8, up: 2e6 / 8 }, '3g': { latency: 300, down: 1.6e6 / 8, up: 0.75e6 / 8 } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const out = { landing: [], mic: null };
for (const [name, net] of Object.entries(NETS)) {
  const ctx = await browser.newContext({ userAgent: QUEST_UA, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (net != null) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.latency, downloadThroughput: net.down, uploadThroughput: net.up });
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 100)));
  const t0 = Date.now();
  await page.goto(`${base}/`, { waitUntil: 'commit' });
  let readyS = null;
  for (let i = 0; i < 1200 && readyS == null; i++) {
    if (await page.evaluate(() => document.body?.classList.contains('ready')).catch(() => false)) readyS = (Date.now() - t0) / 1000;
    else await wait(100);
  }
  const message = await page.evaluate(() => (document.querySelector('#landing') ?? document.body).innerText.replace(/\s+/g, ' ').slice(0, 220)).catch(() => '');
  await wait(1500);
  out.landing.push({ net: name, landingReadyS: readyS, bytesToReady: bytes, errors, message });
  await ctx.close();
}
// Microphone refused, then allowed (emulated preview on a computer, production build).
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.clearPermissions();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 100)));
  await page.goto(`${base}/?preview=1`);
  await page.waitForFunction(() => window.__wdd != null && window.IWER_DEVICE != null, null, { timeout: 60000 }).catch(() => null);
  const hasApi = await page.evaluate(() => window.__wdd != null);
  let flow = { hasApi };
  if (hasApi) {
    await wait(1500);
    if (await page.isVisible('[data-style="talk"]')) await page.click('[data-style="talk"]');
    else if (await page.isVisible('#begin')) await page.click('#begin');
    await page.waitForFunction(() => ['table', 'floating'].includes(window.__wdd?.state?.().placement), null, { timeout: 30000 }).catch(() => null);
    await wait(2000);
    // Refused: the browser says no.
    await page.evaluate(() => window.__wdd.micState('denied'));
    await page.evaluate(() => window.__wdd.press('orb'));
    await wait(800);
    flow.refused = await page.evaluate(() => ({ mic: window.__wdd.micState?.length != null ? null : null, flash: window.__wdd.caption?.().flash ?? null, menu: window.__wdd.debug?.().visuals.ritualMenuOpen ?? null }));
    // Allowed: the person changes their mind and touches the lamp again.
    await ctx.grantPermissions(['microphone']);
    await page.evaluate(() => window.__wdd.micState('off'));
    await page.evaluate(() => window.__wdd.press('rituals'));
    await wait(400);
    await page.evaluate(() => window.__wdd.press('orb'));
    await wait(2500);
    flow.allowed = await page.evaluate(() => ({ mic: window.__wdd.voice?.() ? null : null, state: window.__wdd.onboarding?.().mic ?? null, flash: window.__wdd.caption?.().flash ?? null }));
  }
  out.mic = { ...flow, errors };
  await ctx.close();
}
await browser.close();
writeFileSync(process.argv[3] ?? 'artifacts/stability/cold-judge.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
