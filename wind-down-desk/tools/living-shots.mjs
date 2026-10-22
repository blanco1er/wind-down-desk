// Living places — screenshots and checks in the real app (player mode), Chromium or WebKit (Playwright).
//   node tools/living-shots.mjs https://localhost:8097/ [chromium|webkit] [outDir] [scenario]
// scenario: all (default) | snow | cove | fire | sky | quick
// For each place: "Full" and "Table stays", seated view facing the tray, then turned toward the effect, plus zoomed
// crops of the details (flakes, foam, embers). To look behind (the fireplace) the WORLD is turned (desk yaw offset of
// the backdrop and of the living frame), the seated camera stays: same pixels as turning the head.
// Also checks: the effect exists only in its place (draw calls, sounds), "My room" = nothing drawn, nothing playing.
// WDD_PLAYWRIGHT_WEBKIT=<path to a playwright-core index.mjs> if the project's WebKit build is not installed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, webkit as webkitDefault } from 'playwright';

const webkit = process.env.WDD_PLAYWRIGHT_WEBKIT ? (await import(process.env.WDD_PLAYWRIGHT_WEBKIT)).webkit : webkitDefault;
const url = process.argv[2] ?? 'https://localhost:8097/';
const name = process.argv[3] ?? 'chromium';
const out = `${process.argv[4] ?? 'artifacts/living'}/${name}`;
const scenario = process.argv[5] ?? 'all';
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
  // Collapse the play-test panel so the scene is seen whole.
  await page.evaluate(() => {
    const p = document.querySelector('#wdd-playtest');
    if (p) p.style.display = 'none';
  });
}

const living = () => page.evaluate(() => window.__wdd.living());
async function go(id, settle = 4500) {
  await page.evaluate((p) => window.__wdd.place(p), id);
  await page.waitForFunction((p) => window.__wdd.debug().visuals.backdrop.place === p, id, { timeout: 15000 });
  await wait(settle);
}
async function immersion(level) {
  await page.evaluate((l) => window.__wdd.immersion(l), level);
  await wait(2600);
}
/** Turns the world so the photo yaw `deg` is ahead (the seated camera stays put). */
async function face(deg) {
  await page.evaluate((d) => {
    const v = window.__wdd.debug().visuals;
    const f = window.__wdd.state().frame;
    const off = (d * Math.PI) / 180;
    v.backdrop.setDeskYaw(f.yaw + off);
    v.living.anchor(f.x + Math.sin(f.yaw) * 0.45, f.z + Math.cos(f.yaw) * 0.45, f.yaw + off);
  }, deg);
  await wait(400);
}
/** Pitch of the seated view (drag), degrees relative to the default framing. */
async function tilt(deg) {
  await page.keyboard.press('r');
  await wait(600);
  if (deg === 0) return;
  const px = (deg * Math.PI) / 180 / 0.0032;
  // Drag up = look up (player.ts: pitch −= movementY · 0.0032), from the right edge (empty sky, no stone).
  await page.mouse.move(1380, 450);
  await page.mouse.down();
  const steps = 30;
  for (let i = 1; i <= steps; i++) await page.mouse.move(1380, 450 - (px * i) / steps);
  await page.mouse.up();
  await wait(900);
}
/** Hides the desk and its glass UI (a clean look at the place for checks; never in the product). */
async function desk(visible) {
  await page.evaluate((v) => {
    window.__wdd.debug().visuals.root.visible = v;
  }, visible);
}
/** A short frame sequence (for motion checks), turned into an mp4 with ffmpeg by the caller. */
async function sequence(label, frames, everyMs, clip = null) {
  mkdirSync(`${out}/${label}`, { recursive: true });
  for (let i = 0; i < frames; i++) {
    const t0 = Date.now();
    await page.screenshot({ path: `${out}/${label}/${String(i).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 85, ...(clip ? { clip } : {}) });
    await wait(Math.max(0, everyMs - (Date.now() - t0)));
  }
}
/** Screen position of the campfire (CSS px), for zoomed crops. */
const fireScreen = () =>
  page.evaluate(() => {
    const f = window.__wdd.debug().visuals.living.current?.fire;
    if (f == null) return null;
    const p = f.group.getWorldPosition(f.group.position.clone());
    p.y += 0.15;
    return window.__wddPlayer.screenOf(p);
  });
async function shot(label, clip = null) {
  const path = `${out}/${label}.png`;
  await page.screenshot(clip == null ? { path } : { path, clip });
  return path;
}
const zoom = (cx, cy, w = 360, h = 240) => ({ x: Math.max(0, cx - w / 2), y: Math.max(0, cy - h / 2), width: w, height: h });

const report = { name, url, steps: [], errors, shaderErrors };
const step = async (label, extra = {}) => {
  const s = await living();
  const snd = await page.evaluate(() => window.__wdd.sound());
  report.steps.push({ label, ...s, master: snd.master, rms: +snd.rms.toFixed(5), ...extra });
  console.log(`  [${name}] ${label}: place=${s.place} fade=${s.fade} draws=${s.drawCalls} sounds=${s.sounds} rms=${snd.rms.toFixed(4)}`);
  return s;
};

await start();
await step('0-room');
await shot('00-room');

if (scenario === 'all' || scenario === 'snow' || scenario === 'quick') {
  await go('fireside-cabin');
  await immersion('full');
  await tilt(0);
  await step('snow-full');
  await shot('10-snow-full-assis');
  await tilt(18);
  await shot('11-snow-full-fenetres');
  await shot('12-snow-zoom-flocons', zoom(720, 330, 480, 320));
  await face(-62);
  await shot('13-snow-full-fenetre-gauche');
  await face(-109);
  await tilt(22);
  await shot('14-snow-full-cheminee');
  await shot('15-snow-zoom-cheminee', zoom(720, 420, 480, 320));
  await face(0);
  await immersion('table');
  await tilt(0);
  await shot('16-snow-table-assis');
  await tilt(18);
  await shot('17-snow-table-fenetres');
  await step('snow-table');
}

if (scenario === 'all' || scenario === 'cove' || scenario === 'quick') {
  await go('moon-beach');
  await immersion('full');
  await tilt(0);
  await step('cove-full');
  for (let i = 0; i < 4; i++) {
    await shot(`20-cove-full-assis-${i}`);
    await wait(2200);
  }
  await tilt(14);
  await shot('21-cove-full-mer');
  await shot('22-cove-zoom-reflets', zoom(640, 300, 520, 260));
  await tilt(0);
  for (let i = 0; i < 3; i++) {
    await shot(`23-cove-full-rivage-${i}`);
    await shot(`24-cove-zoom-ecume-${i}`, zoom(720, 640, 560, 300));
    await wait(1800);
  }
  // Clean look at the beach (desk hidden), and a sequence of two full waves.
  await desk(false);
  await tilt(-4);
  await shot('27-cove-plage-sans-bureau');
  await sequence('28-cove-vagues', 40, 500);
  await desk(true);
  await immersion('table');
  await tilt(0);
  await shot('25-cove-table-assis');
  await tilt(14);
  await shot('26-cove-table-mer');
  await step('cove-table');
}

if (scenario === 'all' || scenario === 'fire' || scenario === 'quick') {
  await go('ember-fire');
  await immersion('full');
  await tilt(0);
  await step('fire-full');
  await shot('30-fire-full-assis');
  await face(-32);
  await tilt(14);
  await shot('31-fire-full-face');
  const fp = (await fireScreen()) ?? { x: 720, y: 450 };
  console.log(`  [${name}] fire on screen at ${Math.round(fp.x)}, ${Math.round(fp.y)}`);
  await shot('32-fire-zoom-braises', zoom(fp.x, fp.y, 420, 240));
  await page.evaluate(() => window.__wdd.debug().visuals.living.crackleNow());
  await wait(250);
  await shot('33-fire-crepitement');
  await page.evaluate(() => window.__wdd.debug().visuals.living.onStoneReleased());
  await wait(500);
  await shot('34-fire-gerbe');
  await desk(false);
  await shot('37-fire-sans-bureau');
  const fq = (await fireScreen()) ?? { x: 720, y: 450 };
  await shot('39-fire-zoom-sans-bureau', zoom(fq.x, fq.y, 420, 240));
  await sequence('38-fire-sequence', 24, 250, zoom(fq.x, fq.y, 640, 360));
  await desk(true);
  await face(0);
  await immersion('table');
  await tilt(0);
  await shot('35-fire-table-assis');
  await face(-32);
  await tilt(14);
  await shot('36-fire-table-face');
  await step('fire-table');
  await face(0);
}

if (scenario === 'all' || scenario === 'sky') {
  await go('desert-stars');
  await immersion('full');
  await tilt(30);
  await page.evaluate(() => window.__wdd.debug().visuals.living.shootStar());
  await wait(500);
  await shot('40-hilltop-etoile-filante');
  await step('hilltop');
}

// Back to your room: nothing drawn, nothing playing.
await go('room', 3000);
const back = await step('9-room-again');
await shot('90-room-again');
report.roomClean = back.drawCalls === 0 && back.sounds === 0 && back.place === null;
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(`  [${name}] room clean: ${report.roomClean}; errors: ${errors.length ? errors.join(' | ') : 'none'}; shader errors: ${shaderErrors.length}`);
if (shaderErrors.length) console.log(shaderErrors.slice(0, 3).join('\n---\n'));
await browser.close();
