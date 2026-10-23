// The lamp as a presence (axe 4): close-ups of its states — idle, listening (you speak), speaking, thinking, looked
// at — from a seated eye ~35 cm away, plus one wide frame. Writes artifacts/lamp/<state>.jpg (and a 2 s strip).
import { mkdirSync, writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.WDD_OUT ?? 'artifacts/lamp';
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  mkdirSync(OUT, { recursive: true });
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
    writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(r.data, 'base64'));
  };
  // Close: the head 32 cm in front of the lamp and a little above, looking at it.
  const close = await f.evaluate(() => {
    const lamp = window.__wdd.deskPoint(0.352, 0.03, 0.035);
    const eye = window.__wdd.deskPoint(0.27, 0.2, 0.3);
    const d = window.IWER_DEVICE;
    d.position.set(eye.x, eye.y, eye.z);
    const dx = lamp.x - eye.x, dy = lamp.y - eye.y, dz = lamp.z - eye.z;
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    window.__wdd?.film?.fov?.(30);
    return { lamp, eye };
  });
  const states = ['idle', 'listen', 'speak', 'think', 'look'];
  for (const s of states) {
    await f.evaluate((st) => window.__wdd.lamp(st), s);
    await wait(1600);
    await shot(`close-${s}`);
  }
  await f.evaluate(() => window.__wdd.lamp('speak'));
  for (let i = 0; i < 6; i++) {
    await wait(330);
    await shot(`speak-strip-${i}`);
  }
  await f.evaluate(() => window.__wdd.lamp(null));
  await f.evaluate(() => window.__wdd?.film?.fov?.(58));
  return close;
}
