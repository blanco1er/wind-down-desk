// The evening darkens with you: one screenshot per stage (arrival, Unload, Release, Breathe, Good night) in a place,
// plus a zoom on the lamp's glow on the wood. Quiet evening, mouse and keys only (player mode).
//   node tools/player-night.mjs https://localhost:8093/ [chromium|webkit] [place] [outDir]
import { mkdirSync } from 'node:fs';
import { chromium, webkit as webkitDefault } from 'playwright';

const webkit = process.env.WDD_PLAYWRIGHT_WEBKIT ? (await import(process.env.WDD_PLAYWRIGHT_WEBKIT)).webkit : webkitDefault;
const url = process.argv[2] ?? 'https://localhost:8081/';
const name = process.argv[3] ?? 'chromium';
const place = process.argv[4] ?? 'moon-lake';
const out = `${process.argv[5] ?? 'artifacts/player-mode'}/${name}-nuit-${place}`;
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await (name === 'webkit' ? webkit : chromium).launch({ headless: true, args: name === 'chromium' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const pos = (key, idx) =>
  page.evaluate(([k, i]) => {
    const v = window.__wdd.debug().visuals;
    const h = i == null ? v[k] : typeof i === 'number' ? v[k][i]?.entity : v[k].find((c) => c.id === i)?.entity;
    if (h == null) return null;
    const o = h.object3D;
    o.updateWorldMatrix(true, false);
    return window.__wddPlayer.screenOf(o.getWorldPosition(o.position.clone()));
  }, [key, idx]);
const click = async (p) => {
  await page.mouse.move(p.x, p.y, { steps: 5 });
  await page.mouse.down();
  await wait(60);
  await page.mouse.up();
};
const evening = () => page.evaluate(() => window.__wdd.evening().evening);
let n = 0;
const shot = async (label) => {
  const e = await evening();
  await page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${label}.png` });
  console.log(`  [${name} ${place}] ${label}: soirée ${e.toFixed(2)}`);
};
const ritual = async (id) => {
  if (!(await page.evaluate(() => window.__wdd.debug().visuals.ritualMenuOpen))) {
    await click(await pos('ritualsEntity'));
    await wait(1300);
  }
  await click(await pos('ritualChips', id));
};
/** Lets the slow slide reach the stage (the test waits; a person lives the ritual meanwhile). */
const settle = (ms) => page.waitForFunction(() => Math.abs(window.__wdd.evening().evening - 0) >= 0, null).then(() => wait(ms));

await page.goto(url);
await page.evaluate(() => {
  localStorage.setItem('wdd.style', 'quiet');
  localStorage.removeItem('wind-down-desk.memory.v1');
});
await page.reload();
await page.waitForFunction(() => window.__wdd != null && window.IWER_DEVICE != null, null, { timeout: 40000 });
await wait(3000);
await page.click('#begin');
await page.waitForFunction(() => ['table', 'floating'].includes(window.__wdd.state().placement) && window.__wddPlayer != null, null, { timeout: 30000 });
await wait(3500);
if (await page.isVisible('[data-act="help-ok"]')) await page.click('[data-act="help-ok"]');
if (await page.isVisible('[data-act="min"]')) await page.click('[data-act="min"]');
await click(await pos('ornamentEntity'));
await wait(1300);
await click(await pos('placeChips', place));
await wait(6000);
await shot('1-arrivee');
await ritual('unload');
await wait(1500);
for (const i of [0, 2, 4]) {
  await click(await pos('wordChips', i));
  await wait(700);
}
await wait(1500);
for (const k of ['1', '2', '3']) {
  await page.keyboard.press(k);
  await page.waitForFunction(() => !window.__wddPlayer.busy && window.__wddPlayer.holding == null, null, { timeout: 8000 });
  await wait(900);
}
await settle(9000);
await shot('2-unload');
await page.waitForFunction(() => window.__wdd.debug().visuals.repliesShown || window.__wdd.state().plan != null, null, { timeout: 20000 }).catch(() => {});
if (await page.evaluate(() => window.__wdd.state().plan != null)) {
  await wait(2000);
  await click(await pos('keepEntity'));
  await wait(3000);
}
await ritual('release');
await page.waitForFunction(() => window.__wdd.debug().visuals.wordsShown, null, { timeout: 15000 });
await click(await pos('wordChips', 0));
await page.waitForFunction(() => window.__wdd.weightWorld() != null, null, { timeout: 15000 });
await wait(3500);
await click(await page.evaluate(() => window.__wddPlayer.target('weight')));
await wait(900);
await click(await page.evaluate(() => window.__wddPlayer.target('water')));
await settle(9000);
await shot('3-release');
await page.waitForFunction(() => window.__wdd.evening().mode !== 'release', null, { timeout: 20000 }).catch(() => {});
await wait(1500);
await ritual('breathe');
await page.waitForFunction(() => window.__wdd.evening().mode === 'breathe', null, { timeout: 10000 });
await settle(12000);
await shot('4-breathe');
const lamp = await page.evaluate(() => window.__wddPlayer.target('lamp'));
await page.mouse.move(lamp.x, lamp.y + 200);
await click(await pos('lighterEntity'));
await wait(5000);
const lamp2 = await page.evaluate(() => window.__wddPlayer.target('lamp'));
await page.screenshot({ path: `${out}/lueur-lampe.png`, clip: { x: lamp2.x - 260, y: lamp2.y - 120, width: 420, height: 260 } });
await page.waitForFunction(() => window.__wdd.evening().mode === 'choose', null, { timeout: 15000 }).catch(() => {});
await wait(1200);
await ritual('sleep');
await wait(2500);
await shot('5-bonne-nuit');
await wait(5000);
await shot('6-lampe-eteinte');
await browser.close();
