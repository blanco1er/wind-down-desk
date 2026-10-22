// Living places — one pass per night place in the real app (player mode), Chromium or WebKit (Playwright).
//   node tools/living-places.mjs https://localhost:8097/ [chromium|webkit] [outDir] [ids,comma,separated|all] [--veil] [--fire-extra]
// For each place: "Full" and "Table stays", seated view facing the tray, then the HEAD turned toward the effect
// (the player's own look: desk and panels stay in the world, like a real head turn), a zoomed crop of the detail,
// and with --veil a shot under Breathe's veil (the real ritual, started by touch). Then back to "My room".
// Checks (report.json, exit code 1 on failure): each life appears in its place only (draw calls > 0, its sounds),
// nothing drawn and nothing playing back in your room, no page or shader error.
// WDD_PLAYWRIGHT_WEBKIT=<path to a playwright-core index.mjs> if the project's WebKit build is not installed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit as webkitDefault } from 'playwright';

const webkit = process.env.WDD_PLAYWRIGHT_WEBKIT ? (await import(process.env.WDD_PLAYWRIGHT_WEBKIT)).webkit : webkitDefault;
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const url = args[0] ?? 'https://localhost:8097/';
const name = args[1] ?? 'chromium';
const out = `${args[2] ?? 'artifacts/living'}/${name}`;

/**
 * Where to look for each place's life: head yaw (photo degrees, + = right) and pitch (degrees relative to the
 * default seated framing, + = up), and whether its life has sounds of its own (logic/living.ts).
 */
const PLACES = {
  'ember-fire': { look: [-35, 8], sounds: true, zoom: 'fire' },
  'moon-lake': { look: [-10, 8], sounds: false },
  'moon-beach': { look: [-45, 0], sounds: true },
  'northern-lights': { look: [30, 31], sounds: true },
  'rain-veranda': { look: [0, 10], sounds: false },
  'firefly-meadow': { look: [0, 4], sounds: false },
  'desert-stars': { look: [0, 30], sounds: false, star: true },
  'fireside-cabin': { look: [0, 8], turn: 86, sounds: true },
  'rooftop-city': { look: [0, 22], turn: -155, sounds: false },
};
const ids = !args[3] || args[3] === 'all' ? Object.keys(PLACES) : args[3].split(',');
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await (name === 'webkit' ? webkit : chromium).launch({
  headless: true,
  args: name === 'chromium' ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] : [],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
const shaderErrors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  const t = m.text();
  if (/shader|program not valid|ERROR: 0:/iu.test(t)) shaderErrors.push(t.slice(0, 600));
});

async function start() {
  await page.goto(url);
  await page.waitForFunction(() => window.__wdd != null && window.IWER_DEVICE != null, null, { timeout: 60000 });
  await wait(2500);
  await page.click((await page.isVisible('[data-style="talk"]')) ? '[data-style="talk"]' : '#begin');
  await page.waitForFunction(() => ['table', 'floating'].includes(window.__wdd.state().placement) && window.__wddPlayer != null, null, { timeout: 30000 });
  await wait(3500);
  if (await page.isVisible('[data-act="help-ok"]')) await page.click('[data-act="help-ok"]');
  await page.evaluate(() => {
    const p = document.querySelector('#wdd-playtest');
    if (p) p.style.display = 'none';
  });
}

const living = () => page.evaluate(() => window.__wdd.living());
async function go(id, settle = 5000) {
  await page.evaluate((p) => window.__wdd.place(p), id);
  await page.waitForFunction((p) => window.__wdd.debug().visuals.backdrop.place === p, id, { timeout: 20000 });
  await wait(settle);
}
async function immersion(level) {
  await page.evaluate((l) => window.__wdd.immersion(l), level);
  await wait(2600);
}
/**
 * For an effect behind you (beyond the head's ±48° look range): the WORLD is turned so photo yaw `deg` is ahead
 * (backdrop + living frame; the desk stays). Back to 0 afterwards.
 */
async function turnWorld(deg) {
  await page.evaluate((d) => {
    const v = window.__wdd.debug().visuals;
    const f = window.__wdd.state().frame;
    const off = (d * Math.PI) / 180;
    v.backdrop.setDeskYaw(f.yaw + off);
    v.living.anchor(f.x + Math.sin(f.yaw) * 0.45, f.z + Math.cos(f.yaw) * 0.45, f.yaw + off);
  }, deg);
  await wait(500);
}
/** Seated head: reset ('r'), then turn by yaw (photo degrees, + right) and pitch (+ up) with a mouse drag. */
async function look(yaw = 0, pitch = 0) {
  await page.keyboard.press('r');
  await wait(700);
  if (yaw === 0 && pitch === 0) return;
  // player.ts look(): + yaw = turn left, + pitch = up (radians), same limits as the mouse (WebKit has no movementX).
  await page.evaluate(([y, p]) => window.__wddPlayer.look((-y * Math.PI) / 180, (p * Math.PI) / 180), [yaw, pitch]);
  await wait(1000);
}
async function shot(label, clip = null) {
  const path = `${out}/${label}.png`;
  await page.screenshot(clip == null ? { path } : { path, clip });
  return path;
}
const crop = (cx, cy, w = 480, h = 300) => ({ x: Math.max(0, Math.min(1440 - w, cx - w / 2)), y: Math.max(0, Math.min(900 - h, cy - h / 2)), width: w, height: h });
const fireScreen = () =>
  page.evaluate(() => {
    const f = window.__wdd.debug().visuals.living.current?.fire;
    if (f == null) return null;
    const p = f.group.getWorldPosition(f.group.position.clone());
    p.y += 0.15;
    return window.__wddPlayer.screenOf(p);
  });

const report = { name, url, places: {}, errors, shaderErrors, failures: [] };
const fail = (msg) => {
  report.failures.push(msg);
  console.log(`  [${name}] FAIL ${msg}`);
};
async function step(label) {
  const s = await living();
  const snd = await page.evaluate(() => window.__wdd.sound());
  const v = await page.evaluate(() => window.__wddPlayer.view());
  const r = { label, place: s.place, fade: s.fade, draws: s.drawCalls, sounds: s.sounds, master: snd.master, rms: +snd.rms.toFixed(5), frameMs: v.frameMs };
  console.log(`  [${name}] ${label}: place=${s.place} fade=${s.fade} draws=${s.drawCalls} sounds=${s.sounds} rms=${snd.rms.toFixed(4)} frame=${v.frameMs} ms`);
  return r;
}

await start();
const first = await step('room-start');
if (first.draws !== 0 || first.sounds !== 0) fail('living effects in your room at start');
await shot('00-room');

for (const id of ids) {
  const cfg = PLACES[id];
  const rec = { steps: [] };
  report.places[id] = rec;
  await go(id);
  await immersion('full');
  await look(0, 0);
  const s1 = await step(`${id}-full`);
  rec.steps.push(s1);
  if (s1.place !== id || s1.draws < 1) fail(`${id}: no living layer in Full`);
  if (cfg.sounds && s1.sounds < 1) fail(`${id}: its sounds do not play`);
  await shot(`${id}-1-full-assis`);
  if (cfg.turn) await turnWorld(cfg.turn);
  await look(...cfg.look);
  if (cfg.star) {
    await page.evaluate(() => window.__wdd.debug().visuals.living.shootStar());
    await wait(450);
  }
  await shot(`${id}-2-full-effet`);
  let c = { x: 720, y: 450 };
  if (cfg.zoom === 'fire') c = (await fireScreen()) ?? c;
  // The detail itself: desk and panels hidden for this crop only (never in the product).
  await page.evaluate(() => { window.__wdd.debug().visuals.root.visible = false; });
  await wait(150);
  if (cfg.zoom === 'fire') c = (await fireScreen()) ?? c;
  await shot(`${id}-3-full-zoom`, crop(c.x, c.y, 640, 400));
  await page.evaluate(() => { window.__wdd.debug().visuals.root.visible = true; });
  if (cfg.turn) await turnWorld(0);
  if (id === 'ember-fire' && flags.has('--fire-extra')) {
    await page.evaluate(() => window.__wdd.debug().visuals.living.crackleNow());
    await wait(260);
    await shot(`${id}-4-crepitement`, crop(c.x, c.y - 60, 560, 380));
    await page.evaluate(() => window.__wdd.debug().visuals.living.onStoneReleased());
    await wait(550);
    await shot(`${id}-5-gerbe`, crop(c.x, c.y - 90, 560, 420));
  }
  if (flags.has('--seam')) {
    // The panorama's seam (behind you), desk hidden: no cut tree, no step in the horizon.
    await page.evaluate(() => { window.__wdd.debug().visuals.root.visible = false; });
    await turnWorld(180);
    await look(0, 14);
    await shot(`${id}-s-couture`);
    await turnWorld(0);
    await page.evaluate(() => { window.__wdd.debug().visuals.root.visible = true; });
  }
  await immersion('table');
  await look(0, 0);
  rec.steps.push(await step(`${id}-table`));
  await shot(`${id}-6-table-assis`);
  if (cfg.turn) await turnWorld(cfg.turn);
  await look(...cfg.look);
  await shot(`${id}-7-table-effet`);
  if (cfg.turn) await turnWorld(0);
  if (flags.has('--veil')) {
    await immersion('full');
    await page.evaluate(() => window.__wdd.press('ritual:breathe'));
    await wait(9000);
    await look(...cfg.look);
    const dim = (await living()).roomDim;
    rec.veil = dim;
    await shot(`${id}-8-voile-breathe`);
    await page.evaluate(() => window.__wdd.say('enough'));
    await wait(3000);
  }
  if (id === 'ember-fire' && flags.has('--fire-extra')) {
    await immersion('full');
    await page.evaluate(() => window.__wdd.debug().visuals.living.setGoodNight(true));
    await wait(16000);
    await look(...cfg.look);
    rec.steps.push(await step(`${id}-good-night`));
    await shot(`${id}-9-bonne-nuit`, crop(c.x, c.y, 560, 380));
    await page.evaluate(() => window.__wdd.debug().visuals.living.setGoodNight(false));
  }
  await look(0, 0);
}

// Back to your room: nothing drawn, nothing playing.
await go('room', 3500);
const back = await step('room-again');
await shot('90-room-again');
report.roomClean = back.draws === 0 && back.sounds === 0 && back.place === null;
if (!report.roomClean) fail('effects or sounds remain in your room');
if (errors.length) fail(`page errors: ${errors.join(' | ')}`);
if (shaderErrors.length) fail(`shader errors: ${shaderErrors.length}`);
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(`  [${name}] room clean: ${report.roomClean}; failures: ${report.failures.length}`);
if (shaderErrors.length) console.log(shaderErrors.slice(0, 3).join('\n---\n'));
await browser.close();
process.exit(report.failures.length ? 1 : 0);
