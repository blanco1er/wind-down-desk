// Meta VR Glasses fit, state by state (25 Oct): the ritual menu, the Places menu, Unload with words (quiet), Unload
// with bubbles (voice), Talk it through with bubbles, the plan card. For each: the width and height of everything
// essential at 3 seated eye heights (must be ≤ 66° × 62°, one view) — tools/glasses/fit-check.mjs.
import { fit } from './fit-check.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const press = (a) => f.evaluate((x) => window.__wdd.press(x), a);
  const report = {};
  const take = async (name) => {
    const rows = await fit(f);
    report[name] = rows.map((r) => ({ eye: r.eye, w: r.width, h: r.height, fits: r.fits, outside: r.outside }));
  };
  await f.evaluate(() => window.__wdd.micState('listening'));
  await wait(1500);
  await take('choose + ritual menu');
  await press('places');
  await wait(1500);
  await take('places menu');
  await press('places');
  await wait(800);
  await f.evaluate(() => window.__wdd.style('quiet'));
  await press('ritual:unload');
  await wait(2500);
  await take('unload, words (quiet)');
  await f.evaluate(() => window.__wdd.style('talk'));
  await f.evaluate(() => window.__wdd.micState('listening'));
  await wait(7000);
  await take('unload, bubbles (voice)');
  await press('rituals');
  await wait(800);
  await press('ritual:talk');
  await wait(14000);
  await take('talk, bubbles');
  return report;
}
