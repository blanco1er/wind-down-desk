// 29 Oct: close-up of the keepsakes on the table (contact shadows), 21 evenings so all three stand there.
//   sh tools/stage.sh 54 30 && TAG=apres npx @iwsdk/cli browser run tools/film-v9/keepsakes-close.mjs --timeout 60000
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const out = join(workspaceRoot, '..', 'video', 'film', 'out', 'controles');
  mkdirSync(out, { recursive: true });
  await page.evaluate(() => { const s = document.createElement('style'); s.textContent = '.workspace-view-switcher{display:none!important}'; document.head.appendChild(s); });
  let last = null;
  cdp.on('Page.screencastFrame', (e) => { last = e.data; cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await f.evaluate(() => { window.__wdd.film.history(21); window.__wdd.arrive(); });
  await wait(9000);
  const res = [];
  for (const [name, fov, dx, dy, dz] of [['large', 22, 0.12, 0.25, 0.25], ['rase', 16, 0.0, 0.06, 0.32]]) {
    await f.evaluate(([fv, x, y, z]) => {
      const d = window.__wdd;
      const t = d.deskPoint(-0.48, -0.012, -0.1);
      const e = d.deskPoint(-0.48 + x, y, -0.1 + z);
      const D = window.IWER_DEVICE;
      D.position.set(e.x, e.y, e.z);
      const dxw = t.x - e.x, dyw = t.y - e.y, dzw = t.z - e.z;
      const yaw = Math.atan2(-dxw, -dzw), pitch = Math.atan2(dyw, Math.hypot(dxw, dzw));
      const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
      D.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
      d.film.fov(fv);
    }, [fov, dx, dy, dz]);
    await wait(1500);
    if (last) writeFileSync(join(out, `souvenirs-${name}-${process.env.TAG ?? 'apres'}.jpg`), Buffer.from(last, 'base64'));
    res.push(name);
  }
  await cdp.send('Page.stopScreencast');
  return res;
}
