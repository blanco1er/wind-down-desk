// 29 Oct — Your sky, the memory world, with the hands only: Keep three good things tonight (an earlier evening is
// seeded by seed-memory.mjs: two more good things and two stars), open Your sky from the ritual menu, look at the
// newest light (its word must be the one shown), Close, check the wall holds 12 lights at most; then Good night and
// the night at 12 s (kept lights quiet, the glass row gone).
//   sh tools/solidite-29oct/run.sh tools/solidite-29oct/seed-memory.mjs --no-stage && sh tools/solidite-29oct/run.sh tools/solidite-29oct/probe-memory-world.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeHands } from './hands.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const js = (fn, a) => f.evaluate(fn, a);
  const out = join(workspaceRoot, 'artifacts', 'solidite-29oct', 'souvenirs');
  mkdirSync(out, { recursive: true });
  const shot = async (n) => {
    const s = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    writeFileSync(join(out, `${n}.jpg`), Buffer.from(s.data, 'base64'));
  };
  const until = async (fn, ms, a) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await js(fn, a)) return true;
      await wait(150);
    }
    return false;
  };
  const H = makeHands(f);
  const r = { checks: {} };
  await js(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; });
  await H.rest();
  if ((await js(() => window.__wdd.tension().side)) != null) await js(() => window.__wdd.tension('skip'));
  await wait(600);
  // The places globe by a pointer ray (the computer preview's mouse): the lamp takes a ray only while it is open.
  r.globe = { rayAtRest: (await js(() => window.__wdd.pointer(true))).orbRay };
  await H.poke('places');
  await wait(1300);
  await H.poke('globe-next');
  await wait(1000);
  r.globe.rayOpen = (await js(() => window.__wdd.pointer())).orbRay;
  r.globe.before = (await js(() => window.__wdd.pointer())).place;
  const q0 = await js(() => { const q = window.IWER_DEVICE.quaternion; return { x: q.x, y: q.y, z: q.z, w: q.w }; });
  const orb = await js(() => window.__wdd.buttonWorld('orb'));
  await js((t) => {
    const d = window.IWER_DEVICE;
    const p = d.position;
    const dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z;
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cx = Math.cos(pitch / 2), sx = Math.sin(pitch / 2);
    d.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
  }, orb);
  await wait(900);
  const vp = page.viewportSize() ?? { width: 800, height: 800 };
  const box = await page.evaluate(() => { const c = [...document.querySelectorAll('iframe, canvas')].find((e) => e.clientWidth > 200); if (c == null) return null; const b = c.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const cx = box != null ? box.x + box.w / 2 : vp.width / 2;
  const cy = box != null ? box.y + box.h / 2 : vp.height / 2;
  await page.mouse.move(cx, cy);
  await wait(200);
  await page.mouse.down();
  await wait(120);
  await page.mouse.up();
  r.globe.chosen = await until(() => window.__wdd.pointer().place !== 'room' && !window.__wdd.pointer().places, 6000);
  await wait(3000);
  r.globe.after = (await js(() => window.__wdd.pointer())).place;
  r.checks.globeRayClick = r.globe.rayAtRest === false && r.globe.rayOpen === true && r.globe.chosen && r.globe.after !== r.globe.before;
  r.globe.rayClosed = (await js(() => window.__wdd.pointer(false))).orbRay;
  await js((q) => window.IWER_DEVICE.quaternion.set(q.x, q.y, q.z, q.w), q0);
  await wait(800);
  // Keep, by touch: the menu, the row, then three good things (as a touch word would add them).
  const openMenu = async () => {
    if (!(await js(() => window.__wdd.debug().visuals.ritualMenuOpen))) {
      await H.poke('rituals');
      await until(() => window.__wdd.debug().visuals.ritualMenuOpen, 2500);
    }
  };
  await openMenu();
  r.keepPoke = await H.poke('ritual:keep');
  await until(() => window.__wdd.evening().mode === 'keep', 3000);
  for (const t of ['A good meal', 'Someone kind', 'Rest']) {
    await wait(1500);
    await js((x) => window.__wdd.keep(x), t);
  }
  r.keepDone = await until(() => window.__wdd.evening().mode !== 'keep', 12000);
  await wait(2500);
  r.wallBefore = await js(() => window.__wdd.memoryWorld().lights);
  // Your sky, by touch.
  await openMenu();
  r.skyPoke = await H.poke('ritual:sky');
  r.open = await until(() => window.__wdd.memoryWorld().open, 3000);
  await wait(6500);
  const mw = await js(() => window.__wdd.memoryWorld());
  r.summary = mw.summary;
  r.kept = mw.kept.map((k) => k.text);
  r.dim = mw.dim;
  await shot('1-entree');
  const head0 = await js(() => { const q = window.IWER_DEVICE.quaternion; return { x: q.x, y: q.y, z: q.z, w: q.w }; });
  // The eyes rise from the desk to the crown: the same heading, level, 10° up.
  await js(() => {
    const d = window.IWER_DEVICE;
    const q = d.quaternion;
    const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const yaw = Math.atan2(-fx, -fz), pitch = (10 * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cx = Math.cos(pitch / 2), sx = Math.sin(pitch / 2);
    d.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
  });
  await wait(1500);
  await shot('1b-couronne');
  // Look at the newest light (the head turns to it), as the eyes would.
  const i = mw.kept.length - 1;
  const target = mw.kept[i];
  await js((t) => {
    const d = window.IWER_DEVICE;
    const p = d.position;
    const dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z;
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cx = Math.cos(pitch / 2), sx = Math.sin(pitch / 2);
    d.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
  }, target);
  await wait(1800);
  const seen = await js(() => window.__wdd.memoryWorld());
  r.looked = { index: i, text: target.text, word: seen.word, shown: seen.shown, gazed: seen.gazed };
  r.checks.wordMatchesLight = seen.word === target.text && seen.shown === `kept:${i}`;
  await shot('2-lumiere-regardee');
  await js((q) => window.IWER_DEVICE.quaternion.set(q.x, q.y, q.z, q.w), head0);
  await wait(800);
  // Close (the second reply), by touch.
  r.closePoke = await H.poke('lighter');
  r.closed = await until(() => !window.__wdd.memoryWorld().open, 3000);
  r.modeAfterClose = await js(() => window.__wdd.evening().mode);
  await wait(4500);
  const after = await js(() => window.__wdd.memoryWorld());
  r.wallAfter = after.lights;
  r.dimAfter = after.dim;
  r.checks.wallAtMost12 = after.lights <= 12 && after.lights > 0;
  await shot('3-sortie-mur');
  // The night: Good night by touch, the bead skipped if asked, then 12 s.
  await openMenu();
  r.nightPoke = await H.poke('ritual:sleep');
  await wait(1200);
  if ((await js(() => window.__wdd.tension().side)) != null) {
    await js(() => window.__wdd.tension('skip'));
  }
  r.night = await until(() => window.__wdd.evening().mode === 'night', 5000);
  const t0 = Date.now();
  const nightState = () => js(() => {
    const d = window.__wdd;
    const vis = d.debug().visuals;
    const n = d.night();
    return { mode: d.evening().mode, hush: +vis.lights.skyUniforms.uKeptHush.value.toFixed(2), rituals: vis.ritualsOrnament.visible, places: vis.ornament.visible, sound: vis.voiceButton.visible, replies: vis.replyLabels ?? null, words: vis.wordChips.filter((c) => c.mesh.visible).length, caption: vis.captionCanvas.last, sleep: n.sleep, starDim: +n.starDim.toFixed(2) };
  });
  await wait(12000 - (Date.now() - t0));
  const v12 = await nightState();
  r.night12 = v12;
  r.checks.night12 = v12.hush > 0.9 && !v12.rituals && !v12.places && !v12.sound && JSON.stringify(v12.replies) === '["Lights out"]' && v12.words === 0 && v12.sleep != null;
  await shot('4-nuit-12s');
  await wait(25000 - (Date.now() - t0));
  const v25 = await nightState();
  r.night25 = v25;
  r.checks.night25Dark = v25.sleep != null && v25.sleep.light < 0.2;
  await shot('5-nuit-25s');
  r.checks.sessionEnded = await until(() => !window.__wdd.perf().xr, 15000);
  r.endedAfter = +((Date.now() - t0) / 1000).toFixed(1);
  r.misses = H.stats.pokeMisses;
  return r;
}
