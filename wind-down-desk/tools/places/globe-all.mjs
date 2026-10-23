// The lamp shows the places: every place in the globe, seen from the seat with a 30° field (≈ 24 px/°, the
// headset's density), so the title and the place can be judged at arm's length. Writes artifacts/globe/all/<i>.png.
import { mkdirSync, writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const dir = 'artifacts/globe/all';
  mkdirSync(dir, { recursive: true });
  await f.evaluate(() => {
    const d = window.IWER_DEVICE;
    d.position.set(-0.84, 1.26, 0.2);
    const yaw = Math.PI / 2 - (12 * Math.PI) / 180, pitch = (-21 * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    window.__wdd?.film?.fov?.(30);
  });
  await f.evaluate(() => window.__wdd.globe('open'));
  await wait(1500);
  const out = [];
  for (let i = 0; i < 10; i++) {
    await wait(1600);
    const s = await f.evaluate(() => window.__wdd.globe());
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${dir}/${String(i).padStart(2, '0')}-${s.place}.png`, Buffer.from(r.data, 'base64'));
    out.push({ place: s.place, window: s.window, gain: s.gain });
    await f.evaluate(() => window.__wdd.press('globe-next'));
  }
  await f.evaluate(() => window.__wdd.globe('close'));
  await f.evaluate(() => window.__wdd?.film?.fov?.(58));
  return out;
}
