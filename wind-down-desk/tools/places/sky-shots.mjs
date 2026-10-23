// Lot 2b: progress inside the lamp. A returning evening after WDD_EVENINGS evenings (demo history: the milestones
// before the last one already celebrated): arrival → the lamp floats up and shows your sky (the last evening's
// point lights), a milestone completes the figure and leaves its keepsake on the table. Shots over ≈ 10 s, a close-up
// at 30° (≈ 24 px/°), and the keepsakes close. Writes artifacts/sky/<n>-*.jpg. Run on the landing page (reloaded).
import { mkdirSync, writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const n = Number(process.env.WDD_EVENINGS ?? 3);
  const dir = 'artifacts/sky';
  mkdirSync(dir, { recursive: true });
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
    writeFileSync(`${dir}/${n}-${name}.jpg`, Buffer.from(r.data, 'base64'));
  };
  await page.evaluate(() => document.querySelectorAll('.workspace-view-switcher').forEach((e) => (e.style.display = 'none'))).catch(() => {});
  await f.evaluate((k) => window.__wdd.film.history(k), n);
  const pose = (yawDeg, pitchDeg, fov) =>
    f.evaluate(({ yawDeg, pitchDeg, fov }) => {
      const d = window.IWER_DEVICE;
      d.primaryInputMode = 'hand';
      d.position.set(-0.84, 1.26, 0.2);
      const yaw = Math.PI / 2 - (yawDeg * Math.PI) / 180, pitch = (pitchDeg * Math.PI) / 180;
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
      window.__wdd?.film?.fov?.(fov);
    }, { yawDeg, pitchDeg, fov });
  await pose(0, -27, 58);
  const card = '[data-style="talk"]';
  if (await f.isVisible(card)) await f.click(card);
  else await f.click('#begin');
  for (let i = 0; i < 40; i++) {
    const s = await f.evaluate(() => window.__wdd?.state?.().placement ?? null);
    if (s === 'table' || s === 'floating') break;
    await wait(300);
  }
  const out = [];
  for (const [t, name] of [[3500, 'a-sky'], [2500, 'b-point'], [4500, 'c-milestone']]) {
    await wait(t);
    await shot(name);
    out.push({ name, ...(await f.evaluate(() => ({ k: window.__wdd.debug().visuals.keepsakes.shown, sky: window.__wdd.debug().visuals.skyShown }))) });
  }
  // Wide enough for the milestone line beside the globe (the 30° close-up cut it: framing, not the app).
  await pose(-6, -21, 40);
  await wait(400);
  await shot('d-closeup');
  // Look at the keepsakes (desk-local spot behind the tray's back-left corner), close.
  await f.evaluate(() => {
    const d = window.IWER_DEVICE;
    const at = window.__wdd.deskPoint(-0.466, 0.0, -0.095);
    const eye = window.__wdd.deskPoint(-0.2, 0.2, 0.2);
    d.position.set(eye.x, eye.y, eye.z);
    const dx = at.x - eye.x, dy = at.y - eye.y, dz = at.z - eye.z;
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    window.__wdd?.film?.fov?.(30);
  });
  await wait(500);
  await shot('e-keepsakes');
  await pose(0, -27, 58);
  await wait(3500);
  await shot('f-after');
  return out;
}
