// Landing (23 Oct): the Accessibility button and the Privacy link are reachable on a phone and a computer, the
// dialog's switches save the settings and restyle the page, the Privacy page reads well at 390 px.
//   node tools/onboarding/access-landing.mjs http://127.0.0.1:8799/ [outDir]
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? 'artifacts/onboarding/access-landing';
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = {};
const browser = await chromium.launch({ headless: true });
const overlap = (a, b) => a != null && b != null && !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);

for (const [name, opts] of [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['iphone', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }],
]) {
  const ctx = await browser.newContext({ ...opts, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}?internal=1`);
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 30000 });
  await wait(2000);
  const legal = await page.locator('.legal').boundingBox();
  const card = await page.locator('.quest-card, .bar').first().boundingBox();
  const btn = await page.locator('#access-open').boundingBox();
  const link = await page.locator('.legal a').boundingBox();
  await page.screenshot({ path: `${out}/${name}-landing.jpg`, type: 'jpeg', quality: 80 });
  await page.click('#access-open');
  await wait(300);
  const dialogOpen = await page.evaluate(() => document.getElementById('access').open);
  await page.click('input[data-access="contrast"]');
  await page.click('input[data-access="largeText"]');
  await wait(300);
  await page.screenshot({ path: `${out}/${name}-dialog-on.jpg`, type: 'jpeg', quality: 80 });
  await page.click('.access-done');
  await wait(400);
  await page.screenshot({ path: `${out}/${name}-landing-contrast-large.jpg`, type: 'jpeg', quality: 80 });
  const saved = await page.evaluate(() => ({ stored: localStorage.getItem('wdd.access'), body: document.body.className }));
  // Back to normal for the next run.
  await page.evaluate(() => localStorage.removeItem('wdd.access'));
  await page.close();
  const p = await ctx.newPage();
  const res = await p.goto(new URL('/privacy.html', url).toString());
  await p.screenshot({ path: `${out}/${name}-privacy.jpg`, type: 'jpeg', quality: 80, fullPage: true });
  const privacyWidth = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }));
  report[name] = {
    legal, btnHeight: btn?.height, linkHeight: link?.height, legalOverlapsCard: overlap(legal, card), dialogOpen, saved,
    privacyStatus: res?.status(), privacyNoHorizontalScroll: privacyWidth.scroll <= privacyWidth.inner, errors,
  };
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 2));
