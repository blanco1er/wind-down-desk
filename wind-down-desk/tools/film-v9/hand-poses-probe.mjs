// 29 Oct: what the IWER hands look like for a few wrist orientations (world yaw / pitch / roll, degrees, YXZ).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installFist } from './fist-pose.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const out = join(workspaceRoot, 'artifacts', 'v9-hands-probe');
  mkdirSync(out, { recursive: true });
  await page.evaluate(() => { const s = document.createElement('style'); s.textContent = '.workspace-view-switcher{display:none!important}'; document.head.appendChild(s); });
  let last = null;
  cdp.on('Page.screencastFrame', (e) => { last = e.data; cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  await f.evaluate(() => {
    window.__qe = (yaw, pitch, roll) => {
      const r = Math.PI / 180, y = yaw * r / 2, p = pitch * r / 2, z = roll * r / 2;
      const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p), cz = Math.cos(z), sz = Math.sin(z);
      // YXZ: q = qy * qx * qz
      return { x: cy * sp * cz + sy * cp * sz, y: sy * cp * cz - cy * sp * sz, z: cy * cp * sz - sy * sp * cz, w: cy * cp * cz + sy * sp * sz };
    };
    window.__setHand = (side, p, e, pose) => {
      const h = window.IWER_DEVICE.hands[side];
      h.position.set(p.x, p.y, p.z);
      const q = window.__qe(e[0], e[1], e[2]);
      h.quaternion.set(q.x, q.y, q.z, q.w);
      if (pose) h.poseId = pose;
    };
  });
  await installFist(f);
  const variants = JSON.parse(process.env.VARIANTS);
  for (const v of variants) {
    await f.evaluate((v) => {
      const d = window.__wdd;
      window.__setHand('right', d.deskPoint(...v.r), v.re, v.rpose ?? 'default');
      window.__setHand('left', d.deskPoint(...v.l), v.le, v.lpose ?? 'default');
    }, v);
    await wait(900);
    if (last) writeFileSync(join(out, `${v.name}.jpg`), Buffer.from(last, 'base64'));
  }
  await cdp.send('Page.stopScreencast');
  return variants.map((v) => v.name);
}
