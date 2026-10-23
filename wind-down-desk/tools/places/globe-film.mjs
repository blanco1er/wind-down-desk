// Short film (≈ 25 s): the lamp shows the places. Seated, "Places." → the globe floats up and grows, a place inside;
// the head sways (the place moves inside the glass like a window); "next" ×2 by voice, ‹ › by hand (press); "this
// one" → the place opens around you. CDP screencast. Then: sh tools/frames-to-video.sh <out.mp4> <OUT>
//   OUT=artifacts/globe/film node_modules/.bin/iwsdk browser run tools/places/globe-film.mjs --timeout 100000
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const dir = process.env.OUT ?? 'artifacts/globe/film';
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = '.workspace-view-switcher{display:none!important}';
    document.head.appendChild(s);
  });
  const ev = (body, arg) => f.evaluate(new Function('arg', `return (async () => { const d = window.__wdd; ${body} })()`), arg);
  await ev(`d.film?.fov?.(50);`);
  // Head rig animated in the page: seated position, slow targets.
  await ev(`
    const dev = window.IWER_DEVICE;
    const rig = { yaw: 0, pitch: -24, x: 0, ty: 0, tp: -24, tx: 0, k: 0.03 };
    if (window.__rig) clearInterval(window.__rig.timer);
    rig.timer = setInterval(() => {
      rig.yaw += (rig.ty - rig.yaw) * rig.k;
      rig.pitch += (rig.tp - rig.pitch) * rig.k;
      rig.x += (rig.tx - rig.x) * rig.k;
      const yaw = Math.PI / 2 - (rig.yaw * Math.PI) / 180;
      const pitch = (rig.pitch * Math.PI) / 180;
      dev.position.set(-0.84, 1.26, 0.2 + rig.x);
      const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
      dev.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
    }, 16);
    window.__rig = rig;`);
  const look = (yaw, pitch, x = 0, k = 0.03) => ev('Object.assign(window.__rig, { ty: arg[0], tp: arg[1], tx: arg[2], k: arg[3] });', [yaw, pitch, x, k]);
  const frames = [];
  const t0 = Date.now();
  cdp.on('Page.screencastFrame', async (e) => {
    const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(e.data, 'base64'));
    frames.push({ name, t: (Date.now() - t0) / 1000 });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });
  await wait(1500);
  await ev(`await d.say('Places.');`);
  await look(8, -20);
  await wait(3500);
  // The window: the head moves sideways, the place turns inside the glass.
  await look(4, -20, 0.14, 0.02);
  await wait(2200);
  await look(12, -20, -0.1, 0.02);
  await wait(2200);
  await look(8, -20, 0, 0.03);
  await ev(`await d.say('Next.');`);
  await wait(2600);
  await ev(`d.press('globe-next');`);
  await wait(2600);
  await ev(`d.press('globe-prev');`);
  await wait(2400);
  await ev(`await d.say('This one.');`);
  await look(0, -8, 0, 0.02);
  await wait(5000);
  await cdp.send('Page.stopScreencast');
  writeFileSync(join(dir, 'index.json'), JSON.stringify(frames));
  await ev(`clearInterval(window.__rig.timer); d.film?.fov?.(58);`);
  return { frames: frames.length, seconds: frames.length ? frames[frames.length - 1].t : 0, globe: await f.evaluate(() => window.__wdd.globe()) };
}
