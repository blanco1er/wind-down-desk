// The lamp shows the places (26 Oct): does everything (grown globe, ‹ › ×, title, Move desk, bowls, lamp foot) fit
// one 66° × 62° view of the Meta VR Glasses at 3 seated eye heights? Same measure as states-check.mjs.
import { fit } from './fit-check.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  await f.evaluate(() => window.__wdd.globe('open'));
  await wait(2500);
  const rows = await fit(f);
  await f.evaluate(() => window.__wdd.globe('close'));
  return rows.map((r) => ({ eye: r.eye, w: r.width, h: r.height, fits: r.fits, outside: r.outside, items: r.items }));
}
