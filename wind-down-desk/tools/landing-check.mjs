// Landing page on devices WITHOUT a headset (22 Oct, owner's bug: a dead "Begin" on iPhone and on a laptop).
//   node tools/landing-check.mjs http://127.0.0.1:8799/ [outDir=artifacts/landing]
// 1. desktop Chromium 1440×900, no XR      → "Made for Meta Quest" card, QR, "Preview on this screen"; no Begin
// 2. iPhone 390×844 (WebKit, touch)         → the card, no preview, no QR; nothing overlaps; targets ≥ 44 px; fits
//    + the same in Chromium with a French locale (automatic translation must not touch the interface: translate=no)
// 3. desktop "Preview on this screen"       → IWER emulator loaded on demand, Quiet evening, desk placed, a night place
// 4. a browser that says XR is supported but refuses the session → a clear message with "Try again", never silence
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices, webkit as webkitDefault } from 'playwright';
// WDD_PLAYWRIGHT_WEBKIT=<path to a playwright-core index.mjs> if the project's WebKit build is not installed.
const webkit = process.env.WDD_PLAYWRIGHT_WEBKIT ? (await import(process.env.WDD_PLAYWRIGHT_WEBKIT)).webkit : webkitDefault;

const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const out = process.argv[3] ?? 'artifacts/landing';
mkdirSync(out, { recursive: true });
const report = {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browserType, options, init) {
  const browser = await browserType.launch({ headless: true, args: browserType === chromium ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, ...options });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon/u.test(m.text()) && errors.push(m.text()));
  if (init) await page.addInitScript(init);
  await page.goto(url);
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 30000 });
  await wait(2600);
  return { browser, page, errors };
}

/** Visible boxes of the landing's controls and texts; overlaps between siblings; targets under 44 px; overflow. */
const layout = (page) =>
  page.evaluate(() => {
    const vis = (el) => el != null && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    const sel = ['.quest-card', '.qc-eyebrow', '.qc-title', '.qc-lede', '.qc-step', '.qc-address', '.qc-primary', '.qc-secondary', '.qc-note', '.qc-qr', '.bar', '#begin', '.card', '.privacy', '.xr-alert'];
    const boxes = [];
    for (const s of sel) for (const el of document.querySelectorAll(s)) if (vis(el)) {
      const r = el.getBoundingClientRect();
      boxes.push({ s, x0: r.left, y0: r.top, x1: r.right, y1: r.bottom, h: r.height });
    }
    const inner = boxes.filter((b) => b.s.startsWith('.qc-') || b.s === '.privacy');
    const overlaps = [];
    for (let i = 0; i < inner.length; i++) for (let j = i + 1; j < inner.length; j++) {
      const a = inner[i], b = inner[j];
      if (a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5) overlaps.push(`${a.s} × ${b.s}`);
    }
    const small = boxes.filter((b) => ['.qc-address', '.qc-primary', '.qc-secondary', '#begin', '.card'].includes(b.s) && b.h < 44).map((b) => `${b.s} ${Math.round(b.h)}px`);
    const card = boxes.find((b) => b.s === '.quest-card');
    const fits = card == null || (card.x0 >= 0 && card.x1 <= innerWidth && card.y0 >= 0 && card.y1 <= innerHeight);
    return { boxes: boxes.map((b) => b.s), overlaps, small, fits, scrollX: document.documentElement.scrollWidth > innerWidth, translate: document.documentElement.getAttribute('translate') };
  });

// 1. Desktop without a headset
{
  const { browser, page, errors } = await open(chromium, { viewport: { width: 1440, height: 900 } });
  const r = await layout(page);
  r.begin = await page.isVisible('#begin');
  r.preview = await page.isVisible('.qc-primary');
  r.qr = await page.isVisible('.qc-qr svg');
  r.address = await page.textContent('.qc-address-text');
  r.errors = errors;
  await page.screenshot({ path: `${out}/01-desktop-no-xr.png` });
  report.desktop = r;
  await browser.close();
}
// 2. iPhone 390×844 (WebKit), then Chromium in French
for (const [name, type, extra] of [['iphone-webkit', webkit, {}], ['iphone-chromium-fr', chromium, { locale: 'fr-FR' }]]) {
  const d = devices['iPhone 13'];
  const { browser, page, errors } = await open(type, { ...d, viewport: { width: 390, height: 844 }, ...extra });
  const r = await layout(page);
  r.preview = await page.isVisible('.qc-primary');
  r.qr = await page.isVisible('.qc-qr svg');
  r.errors = errors;
  await page.screenshot({ path: `${out}/02-${name}-390x844.png` });
  report[name] = r;
  await browser.close();
}
// 3. Emulated preview on a computer
{
  const { browser, page, errors } = await open(chromium, { viewport: { width: 1440, height: 900 } });
  await page.click('.qc-primary');
  await page.waitForURL(/preview=1/u, { timeout: 15000 });
  await page.waitForFunction(() => document.body.classList.contains('ready') && window.IWER_DEVICE != null, null, { timeout: 30000 });
  await wait(2500);
  const r = { badge: await page.textContent('.preview-badge span').catch(() => null), card: await page.isVisible('.quest-card') };
  await page.screenshot({ path: `${out}/03-preview-landing.png` });
  if (await page.isVisible('[data-style="quiet"]')) await page.click('[data-style="quiet"]');
  else await page.click('#begin');
  await page.waitForFunction(() => ['table', 'floating'].includes(window.__wdd?.state().placement), null, { timeout: 30000 }).catch(() => {});
  await wait(7000);
  r.placement = await page.evaluate(() => window.__wdd?.state().placement ?? null);
  // A real mouse click on the glass "Yes" (the lamp's proposal) must start the proposed ritual.
  r.modeBefore = await page.evaluate(() => window.__wdd.evening().mode);
  const yes = await page.evaluate(() => {
    const m = window.__wdd.debug().visuals.keepChip;
    m.updateWorldMatrix(true, false);
    const p = m.getWorldPosition(m.position.clone());
    return window.__wddPlayer?.screenOf(p) ?? null;
  });
  if (yes != null) {
    await page.mouse.move(yes.x, yes.y);
    await wait(300);
    await page.mouse.down();
    await wait(120);
    await page.mouse.up();
    await wait(2500);
  }
  r.yesAt = yes;
  r.modeAfter = await page.evaluate(() => window.__wdd.evening().mode);
  r.place = await page.evaluate(() => window.__wdd?.living().place ?? null).catch(() => null);
  r.errors = errors;
  await page.screenshot({ path: `${out}/04-preview-evening.png` });
  report.preview = r;
  await browser.close();
}
// 4. A session that is refused
{
  const stub = () => {
    const xr = {
      isSessionSupported: async () => true,
      requestSession: async () => {
        throw new DOMException('The specified session configuration is not supported.', 'NotSupportedError');
      },
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(navigator, 'xr', { value: xr, configurable: true });
  };
  const { browser, page, errors } = await open(chromium, { viewport: { width: 1440, height: 900 } }, stub);
  if (await page.isVisible('[data-style="quiet"]')) await page.click('[data-style="quiet"]');
  else await page.click('#begin');
  await page.waitForSelector('.xr-alert:not([hidden])', { timeout: 10000 }).catch(() => {});
  const r = {
    alert: await page.isVisible('.xr-alert'),
    title: await page.textContent('.xr-alert-title').catch(() => null),
    retry: await page.isVisible('.xr-alert-primary'),
    preview: await page.isVisible('.xr-alert-secondary'),
    errors: errors.filter((e) => !/Failed to start XR session/u.test(e)),
  };
  await page.screenshot({ path: `${out}/05-session-refused.png` });
  report.refused = r;
  await browser.close();
}
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
