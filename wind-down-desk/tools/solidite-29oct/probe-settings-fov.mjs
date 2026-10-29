// 29 Oct: the open Settings panel from the seat — its angular box with the caption and the bottom row, and a
// 66° × 62° still with the head turned to that box's centre (eyes 0.48 m above the table).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeHands } from './hands.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const js = (fn, a) => f.evaluate(fn, a);
  const out = join(workspaceRoot, 'artifacts', 'solidite-29oct', 'settings');
  mkdirSync(out, { recursive: true });
  const H = makeHands(f);
  await js(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; });
  await H.rest();
  if (!(await js(() => window.__wdd.debug().visuals.settingsShown))) await H.poke('settings');
  await wait(1500);
  const box = await js(() => {
    const d = window.__wdd;
    const v = d.debug().visuals;
    const pts = [];
    for (const c of v.settingChips) {
      c.mesh.updateWorldMatrix(true, false);
      for (const x of [-0.095, 0.095]) for (const y of [-0.028, 0.028]) pts.push(c.mesh.localToWorld(c.mesh.position.clone().set(x, y, 0)));
    }
    for (const a of ['settings']) { const b = d.buttonWorld(a); if (b?.shown) pts.push(b); }
    const head = { x: window.IWER_DEVICE.position.x, y: d.state().frame.y + 0.48, z: window.IWER_DEVICE.position.z };
    const c = d.deskPoint(0, 0, 0);
    let fx = c.x - head.x, fz = c.z - head.z;
    const l = Math.hypot(fx, fz); fx /= l; fz /= l;
    const a = pts.map((q) => {
      const dx = q.x - head.x, dy = q.y - head.y, dz = q.z - head.z;
      return { h: (Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz) * 180) / Math.PI, v: (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI };
    });
    const r = [Math.min(...a.map((q) => q.h)), Math.max(...a.map((q) => q.h)), Math.min(...a.map((q) => q.v)), Math.max(...a.map((q) => q.v))];
    return { box: r.map((x) => +x.toFixed(1)), width: +(r[1] - r[0]).toFixed(1), height: +(r[3] - r[2]).toFixed(1) };
  });
  await js((g) => {
    const d = window.IWER_DEVICE;
    d.position.y = window.__wdd.state().frame.y + 0.48;
    const c = window.__wdd.deskPoint(0, 0, 0);
    const base = Math.atan2(-(c.x - d.position.x), -(c.z - d.position.z));
    const yaw = base - (((g[0] + g[1]) / 2) * Math.PI) / 180;
    const pitch = (((g[2] + g[3]) / 2) * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    d.fovy = (62 * Math.PI) / 180;
  }, box.box);
  await page.setViewportSize?.({ width: 778, height: 720 }).catch(() => {});
  await wait(1500);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  writeFileSync(join(out, '9-panneau-66deg.jpg'), Buffer.from(shot.data, 'base64'));
  return { ...box, fits66x62: box.width <= 66 && box.height <= 62, misses: H.stats.pokeMisses };
}
