// v8 film: one place switch (your room → the tea garden), "Full", then a slow look at the rain (near / mid / far
// drops, splashes, pond ripples, the eave drips) and back to the desk. CDP screencast + the app's own audio log.
//   sh tools/stage.sh 64 22 && OUT=dir npx @iwsdk/cli browser run tools/v8/rain-film.mjs --timeout 108000
// Output: <OUT>/f*.jpg + index.json (frame times, s) + audio.json (every sound the app played, same clock).
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const dir = process.env.OUT;
  if (existsSync(dir)) renameSync(dir, `${dir}-old-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = '.workspace-view-switcher{display:none!important}';
    document.head.appendChild(s);
  });
  const ev = (body, arg) => f.evaluate(new Function('arg', `return (async () => { const d = window.__wdd; ${body} })()`), arg);
  // Set the evening (before recording): five stones sorted into the bowls, a calm desk.
  await ev(`d.film.history(21); d.arrive(); await new Promise((r) => setTimeout(r, 2200)); await d.say('Unload.'); await new Promise((r) => setTimeout(r, 1400));
    await d.say("I still haven't replied to the landlord about the heating. And I need to book the dentist, it's been a year.");
    await new Promise((r) => setTimeout(r, 1200));
    await d.say("The slides for Monday aren't done. I keep replaying that awkward comment I made in the meeting. Oh, and my passport expires in March.");
    await new Promise((r) => setTimeout(r, 2200)); await d.say("That's it."); await new Promise((r) => setTimeout(r, 1500));`);
  // Head animated inside the page (smooth), Node only sends targets.
  await ev(`
    const dev = window.IWER_DEVICE;
    const a = d.deskPoint(0, 0, 0), b = d.deskPoint(0, 0, 1);
    const fwd = Math.atan2(-(a.x - b.x), -(a.z - b.z));
    const rig = { yaw: 0, pitch: -22, ty: 0, tp: -22, k: 0.03, fwd };
    if (window.__rig) clearInterval(window.__rig.timer);
    rig.timer = setInterval(() => {
      rig.yaw += (rig.ty - rig.yaw) * rig.k;
      rig.pitch += (rig.tp - rig.pitch) * rig.k;
      const t = performance.now() / 1000;
      const yaw = rig.fwd - (rig.yaw * Math.PI) / 180 + 0.004 * Math.sin(t * 0.7);
      const pitch = ((rig.pitch + 0.25 * Math.sin(t * 0.45)) * Math.PI) / 180;
      const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
      dev.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
    }, 16);
    window.__rig = rig;`);
  const look = (yaw, pitch, k = 0.03) => ev('Object.assign(window.__rig, { ty: arg[0], tp: arg[1], k: arg[2] });', [yaw, pitch, k]);
  const frames = [];
  const t0 = Date.now();
  const perf0 = await f.evaluate(() => performance.now());
  const node0 = Date.now();
  cdp.on('Page.screencastFrame', async (e) => {
    const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(e.data, 'base64'));
    frames.push({ name, t: (Date.now() - t0) / 1000 });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });
  const marks = {};
  await wait(2500);
  marks.say = (Date.now() - t0) / 1000;
  await ev(`await d.say('Go to the garden.');`);
  await wait(6000);
  await ev(`await d.say('Full immersion.');`);
  marks.full = (Date.now() - t0) / 1000;
  await look(0, -6, 0.02);
  await wait(4500);
  await look(38, -10, 0.018);
  await wait(7000);
  await look(-30, 2, 0.016);
  await wait(7000);
  await look(0, 28, 0.02);
  await wait(4500);
  await look(0, -22, 0.022);
  await wait(5000);
  await cdp.send('Page.stopScreencast');
  // The app's audio log (performance.now ms) → seconds on the frames' clock.
  const log = await ev('return d.voice();');
  const toT = (ms) => (node0 + (ms - perf0)) / 1000 - t0 / 1000;
  const events = [...log.log, ...log.cues].map((e) => ({ at: toT(e.t), src: e.src, volume: e.volume }));
  writeFileSync(join(dir, 'index.json'), JSON.stringify(frames));
  writeFileSync(join(dir, 'audio.json'), JSON.stringify({ events, marks }));
  return { frames: frames.length, seconds: frames.at(-1)?.t, events: events.length, marks };
}
