// 29 Oct — the 25 Oct "one 66° × 62° view" check (tools/glasses/fit-check.mjs) extended to the newest elements:
// the ritual menu, the volumes (mix rails), Keep (the kept lights on the wall, or the room fallback), the journal
// (its page and buttons), and the night (the sky on the ceiling with its stars). For each element: its angular box
// from a seated head (eyes 0.40 / 0.48 / 0.56 m above the table), the union with the essentials fit-check already
// measures (caption, chips, card, lamp, bowls, stones), whether that union fits ±33° × ±31°, and a screenshot of
// exactly that window (the emulator's vertical FOV set to 62°, a 66:62 viewport), head turned to its centre.
// The night sky is overhead by design: it is checked on its own (does the whole sky fit one view when you look up).
//   Local:  npx @iwsdk/cli browser run tools/solidite-29oct/fov-recent.mjs --timeout 108000   (after sh tools/stage.sh 54 30)
//   Output: FOV_OUT (default artifacts/solidite-29oct/fov-recent) — fov-recent.json + one .png per element.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fit } from '../glasses/fit-check.mjs';
import { makeHands } from './hands.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const H = 33;
const V = 31;

export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const out = process.env.FOV_OUT ?? 'artifacts/solidite-29oct/fov-recent';
  mkdirSync(out, { recursive: true });
  const js = (fn, a) => f.evaluate(fn, a);
  const press = (a) => js((x) => window.__wdd.press(x), a);
  const until = async (fn, ms, arg) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(fn, arg)) return true;
      await wait(200);
    }
    return false;
  };
  cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 20, maxWidth: 320, maxHeight: 180, everyNthFrame: 3 }).catch(() => {});

  /** World points of one element, by name (read from the scene, never assumed). */
  const elementPoints = (name) =>
    js((n0) => {
      const n = { 'keep-wall': 'keep', 'night-sky': 'night' }[n0] ?? n0;
      const d = window.__wdd;
      const v = d.debug().visuals;
      const pts = [];
      const visible = (m) => { for (let o = m; o; o = o.parent) if (!o.visible) return false; return true; };
      const boxOf = (o) => {
        o.updateWorldMatrix(true, true);
        let min = null, max = null;
        o.traverse((m) => {
          if (!m.isMesh || !visible(m) || m.geometry == null) return;
          if (m.geometry.boundingBox == null) m.geometry.computeBoundingBox();
          const b = m.geometry.boundingBox;
          for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
            const p = m.localToWorld(m.position.clone().set(x, y, z));
            pts.push({ x: p.x, y: p.y, z: p.z });
          }
        });
        return [min, max];
      };
      if (n === 'volumes') {
        for (const u of [0, 1]) for (const back of [false, true]) { const p = d.railWorld(u, back); if (p) pts.push(p); }
        // The Sound button (action "voice"); "Done" is a reply chip, already in fit-check's essentials.
        for (const a of ['settings', 'immersion']) { const b = d.buttonWorld?.(a); if (b && b.shown) pts.push(b); }
      } else if (n === 'keep') {
        const L = v.lights;
        for (let i = 96; i < 96 + 36; i++) {
          if (L.life.getX(i) !== -2) continue;
          const moving = L.travel.getX(i) > 0;
          pts.push({ x: moving ? L.target.getX(i) : L.start.getX(i), y: moving ? L.target.getY(i) : L.start.getY(i), z: moving ? L.target.getZ(i) : L.start.getZ(i) });
        }
      } else if (n === 'night') {
        const u = v.ceilingSky.uniforms;
        const c = u.uCenter.value, r = u.uRadius.value;
        for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; pts.push({ x: c.x + Math.cos(a) * r, y: c.y, z: c.z + Math.sin(a) * r }); }
      } else if (n === 'journal' && v.card.visible) {
        boxOf(v.card);
      }
      return pts;
    }, name);

  /** Angular box of points from the head (same frame as fit-check: forward = towards the desk centre). */
  const angBox = (pts) =>
    js((p) => {
      const head = window.IWER_DEVICE.position;
      const c = window.__wdd.deskPoint(0, 0, 0);
      let fx = c.x - head.x, fz = c.z - head.z;
      const l = Math.hypot(fx, fz); fx /= l; fz /= l;
      const a = p.map((q) => {
        const dx = q.x - head.x, dy = q.y - head.y, dz = q.z - head.z;
        const along = dx * fx + dz * fz, side = dx * -fz + dz * fx;
        return { h: (Math.atan2(side, along) * 180) / Math.PI, v: (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI };
      });
      if (a.length === 0) return null;
      return [Math.min(...a.map((q) => q.h)), Math.max(...a.map((q) => q.h)), Math.min(...a.map((q) => q.v)), Math.max(...a.map((q) => q.v))];
    }, pts);

  const report = {};
  const check = async (name, alone = false) => {
    const rows = [];
    let shotGaze = null;
    for (const eye of [0.4, 0.48, 0.56]) {
      const base = (await fit(f)).find((r) => r.eye === eye);
      await js((h) => { window.IWER_DEVICE.position.y = window.__wdd.state().frame.y + h; }, eye);
      await wait(300);
      const el = await angBox(await elementPoints(name));
      const u = alone || base == null ? el : el == null ? base.union : [Math.min(base.union[0], el[0]), Math.max(base.union[1], el[1]), Math.min(base.union[2], el[2]), Math.max(base.union[3], el[3])];
      const w = u == null ? null : +(u[1] - u[0]).toFixed(1);
      const hgt = u == null ? null : +(u[3] - u[2]).toFixed(1);
      const row = { eye, element: el?.map((x) => +x.toFixed(1)) ?? null, union: u?.map((x) => +x.toFixed(1)) ?? null, width: w, height: hgt, fits: u != null && w <= 2 * H && hgt <= 2 * V, essentialsOutside: alone ? [] : (base?.outside ?? []) };
      rows.push(row);
      if (eye === 0.48 && u != null) shotGaze = { yaw: (u[0] + u[1]) / 2, pitch: (u[2] + u[3]) / 2 };
    }
    // The screenshot: eyes 0.48 m above the table, head turned to the union's centre, exactly a 66° × 62° window.
    let file = null;
    if (shotGaze != null) {
      await js((g) => {
        const d = window.IWER_DEVICE;
        d.position.y = window.__wdd.state().frame.y + 0.48;
        const c = window.__wdd.deskPoint(0, 0, 0);
        const base = Math.atan2(-(c.x - d.position.x), -(c.z - d.position.z));
        const yaw = base - (g.yaw * Math.PI) / 180;
        const pitch = (g.pitch * Math.PI) / 180;
        const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
        (d.quaternion.__set ?? d.quaternion.set.bind(d.quaternion))(cy * sp, sy * cp, -sy * sp, cy * cp);
        window.__fovKeep ??= d.fovy;
        (d.__fov ?? ((v) => { d.fovy = v; }))((62 * Math.PI) / 180);
      }, shotGaze);
      const vp = page.viewportSize?.();
      await page.setViewportSize?.({ width: 778, height: 720 });
      await wait(1400);
      file = join(out, `${name.replace(/[^a-z0-9]+/gi, '-')}.png`);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      if (vp) await page.setViewportSize?.(vp);
      await js(() => { const d = window.IWER_DEVICE; if (window.__fovKeep != null) (d.__fov ?? ((v) => { d.fovy = v; }))(window.__fovKeep); });
    }
    report[name] = { rows, fitsAll: rows.every((r) => r.fits), shot: file, alone };
    return report[name];
  };

  await js(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; window.__wdd.micState('denied'); });
  // The emulated preview built into production (?preview=1) mounts the "player" (a seated mouse camera) that rewrites
  // the head pose and the FOV every frame and limits looking up to 31°. On a Quest there is no player: while this
  // check runs, its writes are ignored and only this tool moves the head (__set / __fov). No-op without the player.
  await js(() => {
    const d = window.IWER_DEVICE;
    if (d.__poseLock !== undefined) return;
    d.__poseLock = window.__wddPlayer != null;
    const q = d.quaternion, p = d.position;
    const qset = q.set.bind(q), pset = p.set.bind(p);
    q.__set = qset;
    p.__set = pset;
    q.set = (...a) => (d.__poseLock ? q : qset(...a));
    p.set = (...a) => (d.__poseLock ? p : pset(...a));
    let proto = Object.getPrototypeOf(d), desc = null;
    while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, 'fovy'))) proto = Object.getPrototypeOf(proto);
    d.__fov = (v) => desc.set.call(d, v);
    if (desc && d.__poseLock) Object.defineProperty(d, 'fovy', { configurable: true, get() { return desc.get.call(d); }, set(v) { if (!d.__poseLock) desc.set.call(d, v); } });
  });
  await until(() => ['table', 'floating'].includes(window.__wdd.state().placement), 15000);
  const placement = await js(() => window.__wdd.state().placement);
  const walls = await js(() => { try { const w = window.__wdd.walls(); return { count: w.walls?.length ?? 0, picked: w.picked != null }; } catch { return null; } });
  // Skip the arrival bead and the first proposal: the desk at rest ("choose"). On a first evening Unload opens with
  // the example stone: it is pinched into Let go (a real pinch) so the night has a star to raise, then "That's all".
  if (await until(() => window.__wdd.tension().side === 'in', 8000)) await press('keep');
  await wait(1500);
  if (await js(() => window.__wdd.evening().proposal != null)) await press('lighter');
  await wait(1000);
  if ((await js(() => window.__wdd.evening().mode)) === 'unload') {
    const H = makeHands(f);
    await H.rest();
    const id = await js(() => window.__wdd.state().tokens.find((t) => t.bin == null && !t.released)?.id ?? null);
    if (id != null) await H.grab(id, 'let-go');
    await until(() => window.__wdd.debug().visuals.wordChips.some((c) => c.mesh.visible && /^That/u.test(c.label ?? '')), 8000);
    const i = await js(() => window.__wdd.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && /^That/u.test(c.label ?? '')));
    if (i >= 0) await press(`word:${i}`);
    await wait(1500);
    if (await js(() => window.__wdd.debug().visuals.card.visible)) await press('keep');
  }
  await until(() => window.__wdd.evening().mode === 'choose', 10000);
  await wait(800);

  // 1. The ritual menu.
  if (!(await js(() => window.__wdd.debug().visuals.ritualMenuOpen))) await press('rituals');
  await until(() => window.__wdd.debug().visuals.ritualMenuOpen, 3000);
  await wait(900);
  await check('ritual-menu');
  await press('rituals');
  await wait(900);
  // 2. The volumes.
  await js(() => window.__wdd.mix('open'));
  await wait(1200);
  await check('volumes');
  await js(() => window.__wdd.mix('close'));
  await wait(900);
  // 3. Keep: three good things, their lights travel to the wall (or the room fallback) and stay.
  await js(() => window.__wdd.ritual('keep'));
  await until(() => window.__wdd.evening().mode === 'keep', 6000);
  for (const t of ['My sister called', 'Warm tea', 'The walk home']) {
    await js((x) => window.__wdd.keep(x), t);
    await wait(2200);
  }
  // The lights leave for the wall when Keep ends (the third good thing, or "Done"); measured once they have landed.
  if (!(await until(() => window.__wdd.evening().mode === 'choose', 12000))) await press('keep');
  await until(() => window.__wdd.evening().mode === 'choose', 8000);
  await wait(6000);
  const keepLights = await js(() => { const L = window.__wdd.debug().visuals.lights; let n = 0; for (let i = 96; i < 132; i++) if (L.life.getX(i) === -2) n++; return { slots: n, ...window.__wdd.keep() }; });
  await check('keep-wall');
  // 4. The journal.
  await js(() => window.__wdd.journal('open'));
  await wait(1800);
  const journal = await js(() => window.__wdd.journal());
  await check('journal');
  await js(() => window.__wdd.journal('close'));
  await wait(1200);
  // 5. The night: Good night, the bead skipped, the sky on the ceiling with its stars (checked on its own).
  if (!(await js(() => window.__wdd.debug().visuals.ritualMenuOpen))) await press('rituals');
  await wait(900);
  await press('ritual:sleep');
  if (await until(() => window.__wdd.tension().side === 'out', 12000)) {
    await wait(700);
    await press('keep');
  }
  if (!(await until(() => window.__wdd.evening().mode === 'night', 8000)) && (await js(() => window.__wdd.tension().side)) === 'out') await press('keep');
  await until(() => window.__wdd.evening().mode === 'night', 8000);
  await until(() => (window.__wdd.night().step ?? 0) >= 1, 15000);
  // The stars land on the ceiling (or a dome above you) before the lamp asks to stay: measured then.
  await until(() => window.__wdd.night().step === 2, 20000);
  await wait(1500);
  const night = await js(() => window.__wdd.night());
  // Overhead, a yaw/pitch box is meaningless (the disc's rim goes all around the zenith): the stars are checked as a
  // cone instead — the largest angle between a star and their mean direction, from the eyes (fits: ≤ 31°, half of
  // the 62° height) — and the whole disc's angular size seen from below is reported for what it is (a backdrop).
  const sky = await js(() => {
    const d = window.__wdd;
    const h = window.IWER_DEVICE.position;
    const dirs = [];
    for (let i = 0; i < 96; i++) {
      const p = d.starWorld(i);
      if (p == null) continue;
      const v = { x: p.x - h.x, y: p.y - h.y, z: p.z - h.z };
      const l = Math.hypot(v.x, v.y, v.z);
      dirs.push({ x: v.x / l, y: v.y / l, z: v.z / l });
    }
    const u = d.debug().visuals.ceilingSky.uniforms;
    const c = u.uCenter.value;
    const discHalfDeg = (Math.atan2(u.uRadius.value, Math.max(0.01, c.y - h.y)) * 180) / Math.PI;
    if (dirs.length === 0) return { stars: 0, discHalfDeg: +discHalfDeg.toFixed(1) };
    const m = dirs.reduce((a, q) => ({ x: a.x + q.x, y: a.y + q.y, z: a.z + q.z }), { x: 0, y: 0, z: 0 });
    const ml = Math.hypot(m.x, m.y, m.z);
    const mean = { x: m.x / ml, y: m.y / ml, z: m.z / ml };
    const cone = Math.max(...dirs.map((q) => (Math.acos(Math.min(1, q.x * mean.x + q.y * mean.y + q.z * mean.z)) * 180) / Math.PI));
    // The exact window: each star in the view frame of a head turned to the mean direction (right, up), then the
    // box re-centred (the head turns to its centre, as for the desk).
    let rx = mean.z, rz = -mean.x;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const right = { x: -rx, y: 0, z: -rz };
    const up = { x: right.y * mean.z - right.z * mean.y, y: right.z * mean.x - right.x * mean.z, z: right.x * mean.y - right.y * mean.x };
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const hs = dirs.map((q) => (Math.atan2(dot(q, right), dot(q, mean)) * 180) / Math.PI);
    const vs = dirs.map((q) => (Math.atan2(dot(q, up), dot(q, mean)) * 180) / Math.PI);
    const width = Math.max(...hs) - Math.min(...hs);
    const height = Math.max(...vs) - Math.min(...vs);
    const fitsBox = width <= 66 && height <= 62;
    return { stars: dirs.length, coneHalfDeg: +cone.toFixed(1), boxDeg: [+width.toFixed(1), +height.toFixed(1)], elevationDeg: +((Math.asin(mean.y) * 180) / Math.PI).toFixed(1), fits: fitsBox, discHalfDeg: +discHalfDeg.toFixed(1), mean };
  });
  // Screenshot: the head turned up to the stars' mean direction, a 66° × 62° window.
  if (sky.mean != null) {
    await js((m) => {
      const d = window.IWER_DEVICE;
      const yaw = Math.atan2(-m.x, -m.z);
      const pitch = Math.asin(m.y);
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      (d.quaternion.__set ?? d.quaternion.set.bind(d.quaternion))(cy * sp, sy * cp, -sy * sp, cy * cp);
      window.__fovKeep ??= d.fovy;
      (d.__fov ?? ((v) => { d.fovy = v; }))((62 * Math.PI) / 180);
    }, sky.mean);
    const vp = page.viewportSize?.();
    await page.setViewportSize?.({ width: 778, height: 720 });
    await wait(1400);
    const file = join(out, 'night-sky.png');
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    if (vp) await page.setViewportSize?.(vp);
    await js(() => { const d = window.IWER_DEVICE; if (window.__fovKeep != null) (d.__fov ?? ((v) => { d.fovy = v; }))(window.__fovKeep); });
    sky.shot = file;
  }
  delete sky.mean;
  report['night-sky'] = { sky, fitsAll: sky.fits === true, alone: true };

  const result = { at: new Date().toISOString(), playerLocked: await js(() => window.IWER_DEVICE.__poseLock === true), window: '66 x 62 deg (±33° × ±31°)', placement, walls, keepLights, journal, night: { step: night.step, ceiling: night.ceiling, lines: night.lines }, report };
  await js(() => { window.IWER_DEVICE.__poseLock = false; });
  writeFileSync(join(out, 'fov-recent.json'), JSON.stringify(result, null, 2));
  await cdp.send('Page.stopScreencast').catch(() => {});
  return result;
}
