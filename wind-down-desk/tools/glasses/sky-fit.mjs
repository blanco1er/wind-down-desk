// Lot 2b check: while the lamp shows your sky and a milestone line is on the caption, does everything essential
// (caption, grown globe, bowls, lamp) fit one 66° × 62° view at 3 eye heights? Run on the landing page (reloaded).
import { fit } from './fit-check.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  await f.evaluate(() => window.__wdd.film.history(3));
  await f.evaluate(() => {
    const d = window.IWER_DEVICE;
    d.primaryInputMode = 'hand';
    d.position.set(-0.84, 1.26, 0.2);
    const yaw = Math.PI / 2, pitch = (-27 * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
  });
  if (await f.isVisible('[data-style="talk"]')) await f.click('[data-style="talk"]');
  else await f.click('#begin');
  for (let i = 0; i < 40; i++) {
    if (['table', 'floating'].includes(await f.evaluate(() => window.__wdd?.state?.().placement ?? null))) break;
    await wait(300);
  }
  // The milestone line arrives ≈ 3.2 s after the sky starts.
  for (let i = 0; i < 60; i++) {
    const k = await f.evaluate(() => window.__wdd.debug().visuals.keepsakes.shown[0]);
    if (k > 0.05) break;
    await wait(200);
  }
  await wait(600);
  const rows = await fit(f);
  return rows.map((r) => ({ eye: r.eye, w: r.width, h: r.height, fits: r.fits, outside: r.outside, items: r.items }));
}
