// 29 Oct: Settings (it replaced Sound) and « Mixed | Full » at the end of the bottom row — real pokes of the
// emulated right index, a still per step, the one-time hint, and the 4-button row's width from the seat (66°).
//   sh tools/solidite-29oct/run.sh tools/solidite-29oct/probe-settings.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeHands } from './hands.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const js = (fn, a) => f.evaluate(fn, a);
  const out = join(workspaceRoot, 'artifacts', 'solidite-29oct', 'settings');
  mkdirSync(out, { recursive: true });
  let last = null;
  cdp.on('Page.screencastFrame', (e) => { last = e.data; cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  const still = async (n) => { await wait(350); if (last) writeFileSync(join(out, `${n}.jpg`), Buffer.from(last, 'base64')); };
  const H = makeHands(f);
  const r = { steps: [] };
  const step = (name, ok, extra = {}) => r.steps.push({ name, ok, ...extra });
  await js(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; window.__wdd.micState?.('denied'); });
  await H.rest();
  if (await js(() => window.__wdd.tension().side != null)) { await H.poke('keep'); await wait(800); }
  if (await js(() => window.__wdd.debug().visuals.ritualMenuOpen)) { await H.poke('rituals'); await wait(900); }
  const st = () => js(() => ({ open: window.__wdd.debug().visuals.settingsShown, muted: window.__wdd.voice().muted, mix: window.__wdd.mix().open, access: window.__wdd.access() }));
  // Settings opens.
  await H.poke('settings');
  await wait(1200);
  let s = await st();
  step('Settings opens', s.open === true);
  await still('1-settings-ouvert');
  // Larger text on, then off.
  const t0 = s.access.largeText;
  await H.poke('setting:text');
  await wait(1200);
  s = await st();
  step('Larger text flips', s.access.largeText === !t0);
  await still('2-larger-text-on');
  await H.poke('setting:text');
  await wait(1200);
  s = await st();
  step('Larger text back', s.access.largeText === t0);
  // Lamp voice off and on.
  const m0 = s.muted;
  await H.poke('setting:voice');
  await wait(900);
  s = await st();
  step('Lamp voice flips', s.muted === !m0);
  await still('3-voix-coupee');
  await H.poke('setting:voice');
  await wait(900);
  step('Lamp voice back', (await st()).muted === m0);
  // Volume: the mix opens, a fingertip slides the voice rail, Done.
  await H.poke('setting:volume');
  await wait(1200);
  s = await st();
  step('Volume opens the mix (and closes Settings)', s.mix === true && s.open === false);
  const v0 = (await js(() => window.__wdd.mix())).voice;
  await H.slide(v0, Math.max(0.1, v0 - 0.25));
  const v1 = (await js(() => window.__wdd.mix())).voice;
  step('voice rail moved', Math.abs(v1 - v0) > 0.05, { v0, v1 });
  await still('4-volume');
  await H.poke('keep');
  await wait(900);
  await js((v) => window.__wdd.mix({ voice: v }), v0);
  // Recenter desk.
  await H.poke('settings');
  await wait(1100);
  const placements0 = await js(() => window.__wdd.state().placement);
  await H.poke('setting:recenter');
  await wait(2500);
  step('Recenter desk (Settings closed, desk placed again)', (await st()).open === false, { placement: [placements0, await js(() => window.__wdd.state().placement)] });
  await wait(2500);
  // Forget my evenings → the question → Keep.
  await H.poke('settings');
  await wait(1100);
  const store = () => js(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!/hint|lastPlace|mix|access/i.test(k)) o[k] = localStorage.getItem(k); } return JSON.stringify(o); });
  const evenings0 = await store();
  await H.poke('setting:forget');
  await wait(1200);
  await still('5-forget-question');
  step('Forget asks first', await js(() => window.__wdd.debug().visuals.repliesShown === true));
  await H.poke('lighter');
  await wait(1200);
  step('Keep: nothing forgotten', (await store()) === evenings0 && evenings0.length > 2);
  // Close.
  await H.poke('settings');
  await wait(1100);
  await H.poke('setting:close');
  await wait(1100);
  step('Close', (await st()).open === false);
  // « Mixed | Full »: a first place ever (hint once), the capsule, a touch flips the mode.
  await js(() => { try { localStorage.removeItem('wdd.immersionHint'); } catch {} });
  // From your room (the globe's next place is then Ember fire, whatever the last run left).
  await js(() => window.__wdd.place('room'));
  await wait(2500);
  await H.poke('places');
  await wait(1500);
  for (let i = 0; i < 3 && (await js(() => window.__wdd.debug().visuals.globePlace)) === 'room'; i++) {
    await H.poke('globe-next');
    await wait(500);
  }
  r.globe = await js(() => window.__wdd.debug().visuals.globePlace);
  await wait(4500);
  r.placeBeforeClose = await js(() => window.__wdd.debug().visuals.backdrop.place);
  await H.poke('orb');
  await wait(1500);
  const hint = await js(() => window.__wdd.caption());
  await still('6-premier-lieu-indice');
  step('first place: the one-time hint', await js(() => { try { return localStorage.getItem('wdd.immersionHint') === '1'; } catch { return false; } }), { caption: hint });
  const lvl0 = await js(() => window.__wdd.debug().visuals.backdrop.immersionLevel);
  const cap = await js(() => window.__wdd.buttonWorld('immersion'));
  step('capsule shown in a place', cap?.shown === true, { size: cap?.size });
  await H.poke('immersion');
  await wait(1500);
  const lvl1 = await js(() => window.__wdd.debug().visuals.backdrop.immersionLevel);
  step('capsule flips the mode', lvl1 !== lvl0, { from: lvl0, to: lvl1 });
  await still('7-capsule-apres');
  await H.poke('immersion');
  await wait(1200);
  // The 4-button row from the seat: its angular width with the tray, eyes 0.40 / 0.48 / 0.56 m above the table.
  r.fov = await js(() => {
    const d = window.__wdd;
    const v = d.debug().visuals;
    const L = v.layout;
    // The row's two ends (desk-local: x = ± half its width, in front of the rim), and the tray's back corners.
    const ends = ['rituals', 'immersion'].map((a) => d.buttonWorld(a));
    const pts = [];
    const half = 0.5 * (3 * 0.088 + 2 * 0.012 + (ends[1]?.shown ? 0.012 + 0.132 : 0));
    for (const x of [-half, half]) for (const y of [-0.012, 0.024]) pts.push(d.deskPoint(x, y, L.depth / 2 + 0.04));
    const rowOnly = pts.length;
    for (const x of [-L.width / 2, L.width / 2]) pts.push(d.deskPoint(x, 0, -L.depth / 2));
    const out = [];
    for (const eye of [0.4, 0.48, 0.56]) {
      const head = { x: window.IWER_DEVICE.position.x, y: d.state().frame.y + eye, z: window.IWER_DEVICE.position.z };
      const c = d.deskPoint(0, 0, 0);
      let fx = c.x - head.x, fz = c.z - head.z;
      const l = Math.hypot(fx, fz); fx /= l; fz /= l;
      const a = pts.map((q) => {
        const dx = q.x - head.x, dy = q.y - head.y, dz = q.z - head.z;
        return { h: (Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz) * 180) / Math.PI, v: (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI };
      });
      const w = Math.max(...a.map((q) => q.h)) - Math.min(...a.map((q) => q.h));
      const h = Math.max(...a.map((q) => q.v)) - Math.min(...a.map((q) => q.v));
      const row = a.slice(0, rowOnly);
      const rw = Math.max(...row.map((q) => q.h)) - Math.min(...row.map((q) => q.h));
      out.push({ eye, row: +rw.toFixed(1), withTrayBack: +w.toFixed(1), height: +h.toFixed(1), fits66x62: w <= 66 && h <= 62 });
    }
    return out;
  });
  // A still of the whole row, head towards the front rim, 62° vertical.
  await js(() => {
    const d = window.IWER_DEVICE;
    d.position.y = window.__wdd.state().frame.y + 0.48;
    const c = window.__wdd.deskPoint(0, 0, 0.05);
    const yaw = Math.atan2(-(c.x - d.position.x), -(c.z - d.position.z));
    const pitch = Math.atan2(c.y - d.position.y, Math.hypot(c.x - d.position.x, c.z - d.position.z));
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    d.fovy = (62 * Math.PI) / 180;
  });
  await page.setViewportSize?.({ width: 778, height: 720 }).catch(() => {});
  await wait(1500);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  writeFileSync(join(out, '8-rangee-66deg.jpg'), Buffer.from(shot.data, 'base64'));
  r.misses = H.stats.pokeMisses;
  r.ok = r.steps.every((x) => x.ok) && r.misses.length === 0;
  await cdp.send('Page.stopScreencast');
  return r;
}
