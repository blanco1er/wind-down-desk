// Glasses fit with stones waiting on the front of the tray (Unload, three stones), plus a glasses-view capture.
import { writeFileSync } from 'node:fs';
import { fit } from './fit-check.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  await f.evaluate(() => window.__wdd.press('rituals'));
  await wait(600);
  await f.evaluate(() => window.__wdd.press('ritual:unload'));
  await wait(1500);
  await f.evaluate(() => window.__wdd.say('I need to call the dentist, reply to my landlord, and book the car service.'));
  await wait(4000);
  const rows = await fit(f);
  const row = rows.find((r) => r.eye === 0.48);
  await f.evaluate((g) => {
    const d = window.IWER_DEVICE;
    d.position.y = window.__wdd.state().frame.y + 0.48;
    const c = window.__wdd.deskPoint(0, 0, 0);
    const base = Math.atan2(-(c.x - d.position.x), -(c.z - d.position.z));
    const yaw = base - (g.yaw * Math.PI) / 180, pitch = (g.pitch * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
  }, row.gaze);
  await wait(900);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 86 });
  writeFileSync('artifacts/glasses/04-glasses-stones.jpg', Buffer.from(shot.data, 'base64'));
  return { stones: await f.evaluate(() => window.__wdd.state().tokens.length), rows: rows.map((r) => ({ eye: r.eye, w: r.width, h: r.height, fits: r.fits, outside: r.outside })) };
}
