// Axe 5, cheap depth: the panorama's ground projected on the real ground. For each place, the seated head at rest,
// then moved 20 cm to the side, ground projection ON and OFF (same frames). Writes artifacts/parallax/raw/<place>-*.jpg (boards: tools/places/parallax-grid.mjs).
//   WDD_PLACES=moon-beach,ember-fire  WDD_SHIFT=0.2
import { mkdirSync, writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.WDD_OUT ?? 'artifacts/parallax/raw';
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  mkdirSync(OUT, { recursive: true });
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(r.data, 'base64'));
  };
  const shift = Number(process.env.WDD_SHIFT ?? 0.2);
  const pitchDeg = Number(process.env.WDD_PITCH ?? -30);
  const yawOff = Number(process.env.WDD_YAW ?? 0);
  const pose = (dx) =>
    f.evaluate(
      ({ dx, pitchDeg, yawOff }) => {
        const d = window.IWER_DEVICE;
        const yaw = Math.PI / 2 + (yawOff * Math.PI) / 180, pitch = (pitchDeg * Math.PI) / 180;
        // Sideways = perpendicular to the view direction (yaw π/2 looks along −X: sideways is ±Z).
        d.position.set(-0.84, 1.26, 0.2 + dx);
        const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
        d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
      },
      { dx, pitchDeg, yawOff },
    );
  const places = (process.env.WDD_PLACES ?? 'moon-beach,moon-lake,ember-fire').split(',');
  const out = [];
  for (const id of places) {
    await pose(0);
    await f.evaluate((p) => void window.__wdd.place(p), id);
    await wait(4500);
    await f.evaluate(() => window.__wdd.immersion('full'));
    await wait(1500);
    for (const on of [true, false]) {
      await f.evaluate((v) => window.__wdd.groundParallax(v), on);
      for (const [tag, dx] of [['mid', 0], ['side', shift]]) {
        await pose(dx);
        await wait(700);
        await shot(`${id}-${on ? 'on' : 'off'}-${tag}`);
      }
    }
    await f.evaluate(() => window.__wdd.groundParallax(true));
    out.push({ place: id, living: await f.evaluate(() => { const l = window.__wdd.living(); return { place: l.place, drawCalls: l.drawCalls }; }) });
  }
  await pose(0);
  return out;
}
