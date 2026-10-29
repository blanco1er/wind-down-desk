// 29 Oct (owner: "the buttons don't work"): the public computer preview clicked with a real mouse, button by
// button. Each glass button is located on screen by scanning the desk's own pick (pickButton), clicked at its
// centre with page.mouse, and its effect is checked. Fresh browser profile: nothing shared with anyone's evenings.
//   node tools/solidite-29oct/clics-apercu.mjs [url]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'https://wind-down-desk.onrender.com/?preview=1';
const out = 'artifacts/clics-29oct';
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1400, H = 800;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const js = (fn, a) => page.evaluate(fn, a);
const log = [];
const note = (step, ok, extra = {}) => { log.push({ step, ok, ...extra }); console.log(ok ? 'OK ' : 'KO ', step, JSON.stringify(extra)); };
await page.goto(url);
await page.waitForFunction(() => window.__wdd != null && typeof window.__wdd.pickButton === 'function', null, { timeout: 60000 });
// Landing → Begin (HTML button)
// A first visit asks how to spend the evening: Quiet evening (touch only), then Begin.
const quiet = page.locator('button', { hasText: 'Quiet evening' }).first();
if (await quiet.isVisible().catch(() => false)) await quiet.click();
await wait(800);
for (let i = 0; i < 20; i++) {
  const begin = page.locator('button', { hasText: /^Begin$/ });
  const placed = await js(() => { try { const p = window.__wdd.state().placement; return p === 'table' || p === 'floating'; } catch { return false; } });
  if (placed) break;
  if (await begin.first().isVisible().catch(() => false)) await begin.first().click({ timeout: 1500 }).catch(() => {});
  await wait(500);
}
await page.waitForFunction(() => { try { const p = window.__wdd.state().placement; return p === 'table' || p === 'floating'; } catch { return false; } }, null, { timeout: 60000 });
await wait(6000);
/** Screen centre (CSS px) of a button, found by scanning the desk's own pick on a 10 px grid. */
const locate = (action) => js(({ action, W, H }) => {
  const xs = [], ys = [];
  for (let y = 0; y < H; y += 10) for (let x = 0; x < W; x += 10) {
    if (window.__wdd.pickButton((x / W) * 2 - 1, 1 - (y / H) * 2) === action) { xs.push(x); ys.push(y); }
  }
  if (xs.length === 0) return null;
  return { x: Math.round(xs.reduce((a, b) => a + b) / xs.length), y: Math.round(ys.reduce((a, b) => a + b) / ys.length), n: xs.length };
}, { action, W, H });
const click = async (action, check, settle = 1500) => {
  const at = await locate(action);
  if (at == null) { note(action, false, { why: 'not on screen' }); return false; }
  const before = await js(check);
  await page.mouse.move(at.x - 30, at.y - 20);
  await wait(60);
  await page.mouse.move(at.x, at.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.up();
  await wait(settle);
  const after = await js(check);
  const ok = JSON.stringify(before) !== JSON.stringify(after);
  note(action, ok, { at, before, after });
  await page.screenshot({ path: `${out}/${String(log.length).padStart(2, '0')}-${action.replace(/[:]/g, '-')}.jpg`, quality: 70, type: 'jpeg' });
  return ok;
};
const v = () => window.__wdd.debug().visuals;
// Close whatever question waits, then the bottom row and the globe of Places.
const ev = () => ({ mode: window.__wdd.evening().mode, rituals: window.__wdd.debug().visuals.ritualsOpen, places: window.__wdd.debug().visuals.placesOpen });
if (await js(() => window.__wdd.debug().visuals.ritualsOpen)) await click('rituals', ev);
await click('rituals', ev);
await click('rituals', ev);
await click('places', ev, 2000);
const globe = () => ({ globe: window.__wdd.debug().visuals.globePlace, place: window.__wdd.debug().visuals.backdrop.place });
await click('globe-next', globe, 400);
await wait(3500);
note('le lieu suit le globe', await js(() => window.__wdd.debug().visuals.backdrop.place === window.__wdd.debug().visuals.globePlace), await js(globe));
await click('globe-prev', globe, 400);
await wait(3500);
await click('orb', ev, 1500);
await click('places', ev, 2000);
await click('globe-close', ev, 1500);
// 29 Oct: Settings (it replaced Sound) and its rows, then the « Mixed | Full » capsule of the bottom row.
const st = () => ({ open: window.__wdd.debug().visuals.settingsShown, muted: window.__wdd.voice().muted, mix: window.__wdd.mix().open, access: JSON.stringify(window.__wdd.access?.() ?? null) });
await click('settings', st, 1500);
await click('setting:voice', st, 1200);
await click('setting:voice', st, 1200);
await click('setting:text', st, 1500);
await click('setting:text', st, 1500);
await click('setting:volume', st, 1500);
await page.keyboard.press('Escape').catch(() => {});
await js(() => window.__wdd.mix('close'));
await click('settings', st, 1500);
await click('setting:close', st, 1500);
const imm = () => window.__wdd.debug().visuals.backdrop.immersionLevel;
await click('immersion', imm, 1500);
await click('immersion', imm, 1500);
await click('rituals', ev);
await click('ritual:breathe', ev, 2500);
writeFileSync(`${out}/clics.json`, JSON.stringify(log, null, 1));
console.log('BILAN', log.filter((l) => l.ok).length, '/', log.length);
await browser.close();
