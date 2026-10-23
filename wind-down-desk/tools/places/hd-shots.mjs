// Before / after of the HD places IN THE APP, same framing: Full immersion, head seated, a 30° field of view
// (1280 × 720 → ≈ 24 px/°, the Quest 3's density), looking just above the horizon. Two passes on the same page:
//   WDD_PASS=6k  (HD forced off, run first)   WDD_PASS=hd  (HD on, waits until the 8k is on the GPU)
// Writes artifacts/places-hd/raw/<place>-<pass>.jpg; board: tools/places/hd-board.mjs.
import { mkdirSync, writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'artifacts/places-hd/raw';
// Where to look (degrees, from facing the desk): a detailed part of each photo.
const VIEW = { 'moon-lake': [0, 4], 'moon-beach': [0, -2], 'ember-fire': [25, 2], 'northern-lights': [0, 10], 'rooftop-city': [0, -4], 'fireside-cabin': [30, 0], 'rain-veranda': [0, 0], 'firefly-meadow': [0, 2] };
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  mkdirSync(OUT, { recursive: true });
  const pass = process.env.WDD_PASS ?? '6k';
  const places = (process.env.WDD_PLACES ?? 'moon-lake,moon-beach,ember-fire,northern-lights').split(',');
  await f.evaluate((on) => window.__wdd.hd(on ? null : false), pass === 'hd');
  const out = [];
  for (const id of places) {
    const [yawDeg, pitchDeg] = VIEW[id] ?? [0, 0];
    await f.evaluate(({ yawDeg, pitchDeg }) => {
      const d = window.IWER_DEVICE;
      d.position.set(-0.84, 1.26, 0.2);
      const yaw = Math.PI / 2 + (yawDeg * Math.PI) / 180, pitch = (pitchDeg * Math.PI) / 180;
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
      window.__wdd?.film?.fov?.(30);
    }, { yawDeg, pitchDeg });
    await f.evaluate((p) => void window.__wdd.place(p), id);
    await wait(3500);
    await f.evaluate(() => window.__wdd.immersion('full'));
    let s = await f.evaluate(() => window.__wdd.hd());
    if (pass === 'hd') {
      for (let i = 0; i < 70 && !s.hereHd; i++) {
        await wait(300);
        s = await f.evaluate(() => window.__wdd.hd());
      }
    }
    await wait(1500);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}/${id}-${pass}.png`, Buffer.from(r.data, 'base64'));
    out.push({ id, pass, hd: s.hereHd, format: s.format });
  }
  await f.evaluate(() => window.__wdd?.film?.fov?.(58));
  return out;
}
