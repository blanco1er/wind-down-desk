// Living places (26 Oct): photo patches (hearth, sea, ambient, fire glow) of places visited earlier — are they still
// drawn, and do they change any pixel? The evening frozen; the same frame with and without them.
import { mkdirSync, writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const dir = 'artifacts/stones';
  mkdirSync(dir, { recursive: true });
  const info = await f.evaluate(() => {
    const L = window.__wdd.debug().visuals.living;
    const own = new Set(L.current?.meshes ?? []);
    const strays = L.root.children.filter((o) => o.isMesh && o.visible && !own.has(o) && o !== L.current?.star);
    window.__strays = strays;
    return { place: L.current?.id ?? null, built: [...L.built.keys()], strays: strays.length };
  });
  await f.evaluate(() => window.__wdd.pause('page', false));
  await wait(400);
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${dir}/${name}.png`, Buffer.from(r.data, 'base64'));
  };
  await shot('strays-shown');
  await wait(400);
  await shot('strays-shown-2');
  await f.evaluate(() => window.__strays.forEach((o) => { o.visible = false; }));
  await wait(400);
  await f.evaluate(() => window.__wdd.perfReset());
  await wait(800);
  info.perEyeHidden = (await f.evaluate(() => window.__wdd.perf())).drawCalls.p50 / 2;
  await shot('strays-hidden');
  await f.evaluate(() => window.__strays.forEach((o) => { o.visible = true; }));
  await wait(300);
  await f.evaluate(() => window.__wdd.perfReset());
  await wait(800);
  info.perEyeShown = (await f.evaluate(() => window.__wdd.perf())).drawCalls.p50 / 2;
  await f.evaluate(() => window.__wdd.pause('page', true));
  return info;
}
