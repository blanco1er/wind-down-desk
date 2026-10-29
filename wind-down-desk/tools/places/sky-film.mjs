// Short film (≈ 16 s), lot 2b: the evening you come back for the 7th time. The desk arrives, the lamp floats up and
// shows your sky (the last evening's point lights, the figure completes, its lines draw), a cup of tea arrives on
// your table; then the lamp goes home and proposes the evening. Run on the landing page (reloaded).
//   OUT=artifacts/sky/film node_modules/.bin/iwsdk browser run tools/places/sky-film.mjs --timeout 100000
//   sh tools/frames-to-video.sh artifacts/sky/progress-in-the-lamp.mp4 artifacts/sky/film
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const n = Number(process.env.WDD_EVENINGS ?? 7);
  const dir = process.env.OUT ?? 'artifacts/sky/film';
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = '.workspace-view-switcher{display:none!important}';
    document.head.appendChild(s);
  });
  await f.evaluate((k) => window.__wdd.film.history(k), n);
  await f.evaluate(() => {
    const d = window.IWER_DEVICE;
    d.primaryInputMode = 'hand';
    d.position.set(-0.84, 1.26, 0.2);
    const yaw = Math.PI / 2 + (4 * Math.PI) / 180, pitch = (-25 * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    window.__wdd?.film?.fov?.(46);
  });
  const frames = [];
  const t0 = Date.now();
  cdp.on('Page.screencastFrame', async (e) => {
    const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(e.data, 'base64'));
    frames.push({ name, t: (Date.now() - t0) / 1000 });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }); } catch {}
  });
  const card = '[data-style="talk"]';
  if (await f.isVisible(card)) await f.click(card);
  else await f.click('#begin');
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });
  await wait(17000);
  await cdp.send('Page.stopScreencast');
  writeFileSync(join(dir, 'index.json'), JSON.stringify(frames));
  await f.evaluate(() => window.__wdd?.film?.fov?.(58));
  return { frames: frames.length, seconds: frames.length ? frames[frames.length - 1].t : 0, sky: await f.evaluate(() => window.__wdd.sky.length) };
}
