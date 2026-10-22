// Clicks every place of the Places menu with the real mouse (player mode), during a Breathe ritual, and saves a
// screenshot of each panorama. Checks that the place really changed and that the ritual kept going.
//   node tools/player-places.mjs https://localhost:8093/ [chromium|webkit] [outDir]
// WDD_PLAYWRIGHT_WEBKIT=<path to a playwright-core index.mjs> if the project's WebKit build is not installed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit as webkitDefault } from 'playwright';

const webkit = process.env.WDD_PLAYWRIGHT_WEBKIT ? (await import(process.env.WDD_PLAYWRIGHT_WEBKIT)).webkit : webkitDefault;
const url = process.argv[2] ?? 'https://localhost:8081/';
const name = process.argv[3] ?? 'chromium';
const out = `${process.argv[4] ?? 'artifacts/player-mode'}/${name}-lieux`;
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await (name === 'webkit' ? webkit : chromium).launch({ headless: true, args: name === 'chromium' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const glass = (key, id) =>
  page.evaluate(([k, i]) => {
    const v = window.__wdd.debug().visuals;
    const ent = i == null ? v[k] : v[k].find((c) => c.id === i)?.entity;
    if (ent == null) return null;
    const o = ent.object3D;
    o.updateWorldMatrix(true, false);
    return window.__wddPlayer.screenOf(o.getWorldPosition(o.position.clone()));
  }, [key, id]);
const click = async (p) => {
  await page.mouse.move(p.x, p.y, { steps: 5 });
  await page.mouse.down();
  await wait(60);
  await page.mouse.up();
};

await page.goto(url);
await page.waitForFunction(() => window.__wdd != null && window.IWER_DEVICE != null, null, { timeout: 40000 });
await wait(2500);
await page.click((await page.isVisible('[data-style="talk"]')) ? '[data-style="talk"]' : '#begin');
await page.waitForFunction(() => ['table', 'floating'].includes(window.__wdd.state().placement) && window.__wddPlayer != null, null, { timeout: 30000 });
await wait(4000);
if (await page.isVisible('[data-act="help-ok"]')) await page.click('[data-act="help-ok"]');
// A ritual running during the switches: Breathe from the next-step reply (the lamp's menu otherwise).
await page.click('#wdd-next .replies button >> text=Breathe.').catch(async () => {
  await page.click('#wdd-say');
  await page.keyboard.type('Breathe.');
  await page.keyboard.press('Enter');
});
await page.waitForFunction(() => window.__wdd.evening().mode === 'breathe', null, { timeout: 10000 });
await wait(2500);

const ids = await page.evaluate(() => window.__wdd.debug().visuals.placeChips.map((c) => c.id));
const report = [];
for (const id of [...ids.slice(1), 'room']) {
  await click(await glass('ornamentEntity'));
  await wait(1300);
  const chip = await glass('placeChips', id);
  await click(chip);
  await page.waitForFunction((p) => window.__wdd.debug().visuals.backdrop.place === p, id, { timeout: 10000 }).catch(() => {});
  await wait(3500);
  const r = await page.evaluate(() => ({ place: window.__wdd.debug().visuals.backdrop.place, mode: window.__wdd.evening().mode }));
  report.push({ id, ...r, ok: r.place === id && r.mode === 'breathe' });
  await page.screenshot({ path: `${out}/${String(report.length).padStart(2, '0')}-${id}.png` });
  console.log(`  [${name}] ${id}: place=${r.place} ritual=${r.mode}`);
  // Breathe lasts a minute: ask for more so it never ends mid-tour.
  if (report.length % 3 === 0) {
    await page.click('#wdd-say');
    await page.keyboard.type('Longer.');
    await page.keyboard.press('Enter');
  }
}
writeFileSync(`${out}/report.json`, JSON.stringify({ report, errors }, null, 2));
console.log(`  [${name}] ${report.filter((r) => r.ok).length}/${report.length} ok, errors: ${errors.length ? errors.join(' | ') : 'none'}`);
await browser.close();
