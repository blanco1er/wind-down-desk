// 29 Oct: the open globe's controls (name row, ‹ ›, "Table stays | Full") — angular spread from the seated head,
// and one 66° × 62° still with the head turned to their centre (does the whole globe UI fit one view?).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeHands } from './hands.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const js = (fn, a) => f.evaluate(fn, a);
  const out = join(workspaceRoot, 'artifacts', 'solidite-29oct');
  mkdirSync(out, { recursive: true });
  const H = makeHands(f);
  await js(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; });
  await H.rest();
  if (await js(() => window.__wdd.tension().side != null)) { await H.poke('keep'); await wait(800); }
  await H.poke('places');
  await wait(1500);
  const ids = ['move-desk', 'globe-close', 'globe-prev', 'globe-next', 'immersion'];
  const r = await js((ids) => {
    const d = window.IWER_DEVICE;
    const p = d.position;
    const out = {};
    for (const id of ids) {
      const w = window.__wdd.buttonWorld(id);
      if (w == null || !w.shown) { out[id] = null; continue; }
      const dx = w.x - p.x, dy = w.y - p.y, dz = w.z - p.z;
      out[id] = { yaw: +(Math.atan2(dx, -dz) * 57.3).toFixed(1), pitch: +(Math.atan2(dy, Math.hypot(dx, dz)) * 57.3).toFixed(1) };
    }
    return out;
  }, ids);
  const v = Object.values(r).filter(Boolean);
  const yaws = v.map((a) => a.yaw), pitches = v.map((a) => a.pitch);
  r.spread = { yaw: +(Math.max(...yaws) - Math.min(...yaws)).toFixed(1), pitch: +(Math.max(...pitches) - Math.min(...pitches)).toFixed(1) };
  r.fits66x62 = r.spread.yaw + 10 <= 66 && r.spread.pitch + 8 <= 62;
  // Head turned to the centre of the controls, 62° vertical FOV, 66:62 viewport.
  const cyaw = (Math.max(...yaws) + Math.min(...yaws)) / 2, cpitch = (Math.max(...pitches) + Math.min(...pitches)) / 2;
  await js(({ cyaw, cpitch }) => {
    const d = window.IWER_DEVICE;
    const y = (-cyaw * Math.PI) / 180 / 2, x = (cpitch * Math.PI) / 180 / 2;
    // q = yaw(Y) * pitch(X)
    d.quaternion.set(Math.cos(y) * Math.sin(x), Math.sin(y) * Math.cos(x), -Math.sin(y) * Math.sin(x), Math.cos(y) * Math.cos(x));
    d.fovy = (62 * Math.PI) / 180;
  }, { cyaw, cpitch });
  await page.setViewportSize({ width: 792, height: 744 }).catch(() => {});
  await wait(1200);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  writeFileSync(join(out, 'globe-fov-66x62.jpg'), Buffer.from(shot.data, 'base64'));
  await H.poke('globe-close').catch(() => {});
  return r;
}
