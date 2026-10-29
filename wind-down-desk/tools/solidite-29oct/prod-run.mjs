// 29 Oct — the hands-only checks against the LIVE site (or any URL), in the emulated preview built into production
// (?preview=1: IWER inside the build), headless Chromium on the GPU. A first evening (storage cleared, visits
// marked internal), "Talk with the lamp" touched as a judge would, the head turned to the desk, then:
//   parcours  parts 1 and 5 of parcours.mjs (arrival, words, stones in the three bowls, plan; Good night → Lights out)
//   part5     part 5 alone, with a sampler (wall clock vs the app's clock, frame rate, the night's replies)
//   busstop   tools/finition-29oct/bus-stop.mjs (the "one bus stop" path), timed from the page load
//   fov       fov-recent.mjs (the newest elements inside one 66° × 62° view, one screenshot each)
// Usage: node tools/solidite-29oct/prod-run.mjs <parcours|part5|busstop|fov> <url> [outDir]
//   RENDER=swiftshader to force software rendering (≈ 2 frames/s on a busy Mac: the app's clock then runs slow).
//   RESULT_FILE=… to choose where the JSON summary goes.
// Server cost: no voice call. /api/visit beacons and /api/health; "parcours" also makes one /api/plan request (the plan card).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [modeArg, base, outArg] = process.argv.slice(2);
if (!['parcours', 'part5', 'busstop', 'fov'].includes(modeArg) || !base) {
  console.error('Usage: node tools/solidite-29oct/prod-run.mjs <parcours|part5|busstop|fov> <url> [outDir]');
  process.exit(2);
}
process.env.MODE = modeArg;
const outDir = resolve(outArg ?? join(projectDir, 'artifacts/solidite-29oct/prod', modeArg));
if (modeArg === 'fov') process.env.FOV_OUT ??= outDir;
const require = createRequire(join(projectDir, 'package.json'));
const { chromium } = require('playwright');
const { default: parcours } = await import(pathToFileURL(join(projectDir, 'tools/solidite-29oct/parcours.mjs')).href);
mkdirSync(outDir, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const sec = () => ((Date.now() - t0) / 1000).toFixed(1);
const say = (...a) => console.log(`[${sec()}s]`, ...a);

// GPU (ANGLE Metal) by default: software rendering (SwiftShader) falls to ~2 frames/s on a busy Mac, and the app's
// clock (≤ 50 ms per frame) then runs ~10× slower than the script's wall-clock waits. RENDER=swiftshader to compare.
const gpuArgs = process.env.RENDER === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: [...gpuArgs, '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const api = [];
const pageErrors = [];
page.on('request', (r) => { const u = r.url(); if (u.includes('/api/')) api.push({ s: sec(), m: r.method(), path: u.split('/api/')[1].split('?')[0] }); });
page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e).slice(0, 240)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text().slice(0, 240)}`); });

let n = 0;
const shot = async (label) => {
  n += 1;
  const file = join(outDir, `${String(n).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60)}.png`);
  await page.screenshot({ path: file, timeout: 120000 }).then(() => say('capture', file.split('/').pop())).catch((e) => say('capture ratée', e.message.split('\n')[0]));
};

// Mémoire neuve (premier soir) et visites marquées internes.
await page.goto(`${base}/?internal=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
// fov: a regular's sky (six past evenings, 14 stars) so the night's stars are a real constellation to frame.
if (process.env.MODE === 'fov') {
  await page.evaluate(() => {
    const day = (k) => { const d = new Date(); d.setDate(d.getDate() - k); return d.toISOString().slice(0, 10); };
    const words = ['The landlord', 'Monday slides', 'The dentist', 'Money', 'An old argument', 'Too much email', 'The car', 'A deadline', 'Family dinner', 'The noise upstairs', 'Taxes', 'A missed call', 'The gym', 'Work'];
    const nights = [];
    const stars = [];
    for (let k = 6; k >= 1; k--) {
      const letGo = words.splice(0, k === 1 ? words.length : 2);
      nights.push({ date: day(k), tomorrow: [], later: [], letGo, plan: [], planKept: false, rituals: ['unload'] });
      letGo.forEach((text, i) => stars.push({ text, date: day(k), seed: (k * 97 + i * 13) % 1000 }));
    }
    localStorage.setItem('wind-down-desk.memory.v1', JSON.stringify({ version: 1, nights, stars, laterPool: [], morningSeen: null, done: [], celebrated: [3] }));
  });
}
const tNav = Date.now();
await page.goto(`${base}/?preview=1&internal=1`, { waitUntil: 'load', timeout: 180000 });
const cdp = await context.newCDPSession(page);
const onFrame = (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
cdp.on('Page.screencastFrame', onFrame);
const screencast = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 20, maxWidth: 320, maxHeight: 180, everyNthFrame: 3 }).catch(() => {});
await screencast();

await page.waitForFunction(() => window.IWER_DEVICE != null, null, { timeout: 180000 });
// Premier soir : deux cartes de style au lieu de « Begin ». Comme un juge : « Talk with the lamp ».
await page.waitForFunction(() => {
  const c = document.querySelector('#choose');
  const b = document.querySelector('#begin');
  return (c && !c.hidden) || (b && !b.hidden);
}, null, { timeout: 180000 });
await wait(2500);
const card = page.locator('#choose button[data-style="talk"]');
if (await card.isVisible()) {
  await shot('accueil premier soir apercu emule');
  await card.click();
  say('carte « Talk with the lamp » cliquée');
} else {
  await shot('accueil apercu emule');
  await page.locator('#begin').click();
  say('Begin cliqué');
}
await page.waitForFunction(() => window.__wdd?.perf?.().xr === true, null, { timeout: 180000 });
const xrAt = Date.now() - tNav;
say('session XR active');
// Mains, puis la tête tournée vers le centre du bureau (là où il s'est posé), sans la déplacer.
await page.waitForFunction(() => ['table', 'floating'].includes(window.__wdd?.state?.().placement), null, { timeout: 60000 }).catch(() => {});
await page.evaluate(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; });
const lookAtDesk = () => page.evaluate(() => {
  const d = window.IWER_DEVICE;
  const c = window.__wdd.deskPoint(0, 0.05, 0.05);
  if (c == null) return null;
  const dx = c.x - d.position.x, dy = c.y - d.position.y, dz = c.z - d.position.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
  return { yawDeg: +(yaw * 180 / Math.PI).toFixed(1), pitchDeg: +(pitch * 180 / Math.PI).toFixed(1), head: { y: +d.position.y.toFixed(2) }, desk: { y: +c.y.toFixed(2) } };
});
await wait(2500);
say('regard vers le bureau', JSON.stringify(await lookAtDesk()));
await wait(1500);
await shot('entree en XR bureau pose');

const MODE = process.env.MODE ?? 'parcours';
if (MODE === 'part5') {
  // Part 5 alone on a fresh evening, with a sampler: wall clock vs app clock, frame rate, night step, replies.
  const press = (a) => page.evaluate((x) => window.__wdd.press(x), a);
  const until = async (fn, ms) => { const e = Date.now() + ms; while (Date.now() < e) { if (await page.evaluate(fn).catch(() => false)) return true; await wait(200); } return false; };
  if (await until(() => window.__wdd.tension().side === 'in', 20000)) await press('keep');
  await wait(2000);
  if (await page.evaluate(() => window.__wdd.evening().proposal != null)) await press('lighter');
  await until(() => window.__wdd.evening().mode === 'choose', 30000);
  await wait(1000);
  const samples = [];
  let sampling = true;
  const t5 = Date.now();
  const sampler = (async () => {
    while (sampling) {
      const x = await page.evaluate(() => {
        const d = window.__wdd;
        const n = d.night();
        const k = d.buttonWorld('keep');
        const f = d.perf().frameMs;
        return { mode: d.evening().mode, step: n.step, appSince: n.since, sleep: n.sleep ? +n.sleep.seconds : null, replies: d.debug().visuals.replyLabels ?? null, keepShown: k?.shown ?? null, keepPoke: k?.poke ?? null, frameMsP50: f?.p50 ?? null, xr: d.perf().xr };
      }).catch((e) => ({ err: String(e).slice(0, 80) }));
      samples.push({ wall: +((Date.now() - t5) / 1000).toFixed(1), ...x });
      await wait(500);
    }
  })();
  await cdp.send('Page.stopScreencast').catch(() => {});
  process.env.PART = '5';
  process.env.MIC = 'denied';
  const r = await parcours({ page, frame: null, cdp }).catch((e) => ({ error: String(e?.message ?? e) }));
  await screencast();
  await wait(1500);
  await shot('fin partie 5');
  sampling = false;
  await sampler;
  const summary = { base, mode: MODE, at: new Date().toISOString(), loadAvg: process.env.LOAD_AT_START ?? null, result: r, samples, apiByPath: api.reduce((m, x) => ((m[x.path] = (m[x.path] ?? 0) + 1), m), {}), pageErrors };
  writeFileSync(process.env.RESULT_FILE ?? join(outDir, 'part5-prod.json'), JSON.stringify(summary, null, 2));
  say('partie 5 :', JSON.stringify(r.error ?? (r.log ?? []).map((x) => `${x.s} ${x.step}`)));
  say('pokes :', JSON.stringify(r.hands));
  await browser.close();
  process.exit(0);
}
if (MODE !== 'parcours' && MODE !== 'part5') {
  const tool = MODE === 'busstop' ? 'tools/finition-29oct/bus-stop.mjs' : 'tools/solidite-29oct/fov-recent.mjs';
  const { default: runTool } = await import(pathToFileURL(join(projectDir, tool)).href);
  say(`${MODE}…`);
  await cdp.send('Page.stopScreencast').catch(() => {});
  const r = await runTool({ page, frame: null, cdp }).catch((e) => ({ error: String(e?.message ?? e) }));
  await screencast();
  await wait(1200);
  await shot(`fin ${MODE}`);
  const summary = { base, mode: MODE, at: new Date().toISOString(), stageSeconds: +(xrAt / 1000).toFixed(1), loadAvg: process.env.LOAD_AT_START ?? null, result: r, api, apiByPath: api.reduce((m, x) => ((m[x.path] = (m[x.path] ?? 0) + 1), m), {}), pageErrors };
  writeFileSync(process.env.RESULT_FILE ?? join(outDir, `${MODE}-prod.json`), JSON.stringify(summary, null, 2));
  say('résultat :', JSON.stringify(r).slice(0, 1500));
  say('mise en scène (chargement prod → XR active) :', summary.stageSeconds, 's ; appels /api/ :', JSON.stringify(summary.apiByPath), '; erreurs page :', pageErrors.length);
  await browser.close();
  process.exit(0);
}

// Captures à chaque changement d'étape (mode, phase, pierres triées, nuit, XR).
let lastKey = '';
let lastShot = 0;
let watching = true;
const watcher = (async () => {
  while (watching) {
    const k = await page.evaluate(() => {
      const d = window.__wdd;
      if (d == null) return null;
      const st = d.state();
      const ev = d.evening();
      const toks = st.tokens.filter((t) => !t.released);
      const sorted = toks.filter((t) => t.bin != null).length;
      return { key: [ev.mode, st.phase, toks.length, sorted, d.night?.().step ?? '', d.perf().xr].join('|'), label: `${ev.mode}-${st.phase}-pierres${toks.length}-triees${sorted}` };
    }).catch(() => null);
    if (k && k.key !== lastKey && Date.now() - lastShot > 1200) {
      lastKey = k.key;
      lastShot = Date.now();
      await wait(700);
      await shot(k.label);
    }
    await wait(500);
  }
})();

process.env.MIC = 'denied';
const results = [];
for (const part of [1, 5]) {
  process.env.PART = String(part);
  say(`partie ${part}…`);
  await cdp.send('Page.stopScreencast').catch(() => {});
  const r = await parcours({ page, frame: null, cdp }).catch((e) => ({ part, error: String(e?.message ?? e) }));
  results.push(r);
  say(`partie ${part} :`, JSON.stringify(r.error ?? (r.log ?? []).map((x) => x.step)));
  await screencast(); // parcours.mjs l'arrête à la fin de chaque partie
  await wait(1500);
  await shot(`fin partie ${part}`);
}
watching = false;
await watcher;
const summary = { base, at: new Date().toISOString(), seconds: +sec(), results, api, apiCount: api.length, apiByPath: api.reduce((m, x) => ((m[x.path] = (m[x.path] ?? 0) + 1), m), {}), pageErrors };
writeFileSync(join(outDir, 'parcours-prod.json'), JSON.stringify(summary, null, 2));
say('appels /api/ :', JSON.stringify(summary.apiByPath));
say('erreurs page :', pageErrors.length);
await browser.close();
