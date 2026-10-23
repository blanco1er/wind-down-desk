// The lamp shows the places (26 Oct): Places opens inside the grown globe. Seated head, Quest-like field (58°), shots
// of the globe showing a few places, from the seat and with the head moved (the place moves inside, like a window),
// plus a 30° close-up (≈ 24 px/°, the headset's density) to judge the title and the place at arm's length.
//   writes artifacts/globe/<name>.jpg
import { mkdirSync, writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.WDD_OUT ?? 'artifacts/globe';
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  mkdirSync(OUT, { recursive: true });
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
    writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(r.data, 'base64'));
  };
  const seat = (dx = 0, fov = 58, pitchDeg = -27, yawDeg = 0) =>
    f.evaluate(({ dx, fov, pitchDeg, yawDeg }) => {
      const d = window.IWER_DEVICE;
      d.position.set(-0.84, 1.26, 0.2 + dx);
      const yaw = Math.PI / 2 + (yawDeg * Math.PI) / 180, pitch = (pitchDeg * Math.PI) / 180;
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
      window.__wdd?.film?.fov?.(fov);
    }, { dx, fov, pitchDeg, yawDeg });
  await seat();
  const out = [];
  out.push(await f.evaluate(() => window.__wdd.globe('open')));
  await wait(2600);
  await shot('01-open-room');
  for (let i = 0; i < 2; i++) {
    out.push(await f.evaluate(() => window.__wdd.globe('next')));
    await wait(1600);
    await shot(`0${2 + i}-next-${i}`);
  }
  await seat(0.18);
  await wait(900);
  await shot('04-head-moved');
  await seat(0, 30, -20, -14);
  await wait(900);
  await shot('05-closeup-30deg');
  await seat();
  out.push(await f.evaluate(() => window.__wdd.globe('choose')));
  await wait(3000);
  await shot('06-arrived');
  out.push(await f.evaluate(() => window.__wdd.globe()));
  return out;
}
