// Records the v6 evening (≈ 70 s) in the emulator: Unload → Release → Breathe, the lamp proposing each next ritual.
//   sh tools/stage.sh 54 30 && npx @iwsdk/cli browser run tools/capture-rituals-v6.mjs --timeout 108000
// Real input paths only: every sentence goes through the app's speech handler (window.__wdd.say, the same path as a
// transcribed microphone clip); stones are picked, carried and released by the emulated right hand (IWER) through the
// IWSDK grab system. Film-only extras: 21 evenings of seeded history, the arrival replayed from darkness.
// Output: artifacts/$WDD_FRAMES (frames + index.json + audio.json + stills.json); then
//   sh tools/stills-from-frames.sh artifacts/frames-v6 && sh tools/frames-to-video.sh /tmp/v6.mp4 artifacts/frames-v6
//   node tools/mix-audio.mjs artifacts/frames-v6 /tmp/v6.mp4 <out.mp4>
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.workspace-view-switcher{display:none!important}';
    document.head.appendChild(style);
  });
  const dirName = process.env.WDD_FRAMES ?? 'frames-v6';
  const suffix = process.env.WDD_SUFFIX ?? '-v6';
  const dir = join(workspaceRoot, 'artifacts', dirName);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const t0 = Date.now();
  cdp.on('Page.screencastFrame', async (event) => {
    const name = `f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(event.data, 'base64'));
    frames.push({ name, t: (Date.now() - t0) / 1000 });
    try {
      await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    } catch {}
  });
  const stills = [];
  const marks = [];
  const still = async (name) => {
    await wait(120);
    stills.push({ name: `${name}${suffix}`, frame: frames.at(-1)?.name });
  };
  const mark = (label) => marks.push({ label, t: (Date.now() - t0) / 1000 });

  // Head: seated, facing the desk; slow breathing sway; pitch / yaw targets eased.
  const head = { pitch: -27, target: -27, yaw: 90, yawTarget: 90 };
  const applyHead = (t) =>
    f.evaluate(([p, y, sway]) => {
      const rad = Math.PI / 180;
      const pitch = (p + sway.p) * rad;
      const yaw = (y + sway.y) * rad;
      const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
      window.IWER_DEVICE.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
    }, [head.pitch, head.yaw, { p: Math.sin(t * 0.7) * 0.35, y: Math.sin(t * 0.43) * 0.5 }]);
  const headTimer = setInterval(() => {
    head.pitch += (head.target - head.pitch) * 0.045;
    head.yaw += (head.yawTarget - head.yaw) * 0.035;
    applyHead((Date.now() - t0) / 1000).catch(() => {});
  }, 33);

  const say = (text) => f.evaluate((t) => window.__wdd.say(t), text);
  const deskPoint = (x, y, z) => f.evaluate(([a, b, c]) => window.__wdd.deskPoint(a, b, c), [x, y, z]);
  const setHand = (side, p, pinch) =>
    f.evaluate(([s, pos, v]) => {
      const hand = window.IWER_DEVICE.hands[s];
      hand.position.set(pos.x, pos.y, pos.z);
      if (v != null) hand.updatePinchValue(v);
    }, [side, p, pinch]);
  const restR = await deskPoint(0.52, 0.0, 0.56);
  const restL = await deskPoint(-0.52, 0.0, 0.56);
  const glide = async (side, from, to, ms, lift = 0) => {
    const steps = Math.max(6, Math.round(ms / 33));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      await setHand(side, { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e + Math.sin(Math.PI * k) * lift, z: from.z + (to.z - from.z) * e }, null);
      await wait(33);
    }
  };
  // Pinch a stone (Unload) and drop it in a bowl.
  const grabStone = async (id, bin) => {
    const stone = await f.evaluate((i) => window.__wdd.stoneWorld(i), id);
    const end = await f.evaluate((b) => window.__wdd.binWorld(b), bin);
    if (stone == null || end == null) return;
    const above = { x: stone.x, y: stone.y + 0.06, z: stone.z };
    await glide('right', restR, above, 600, 0.05);
    await glide('right', above, { x: stone.x, y: stone.y + 0.01, z: stone.z }, 300);
    await setHand('right', { x: stone.x, y: stone.y + 0.01, z: stone.z }, 1);
    await wait(260);
    await glide('right', { x: stone.x, y: stone.y + 0.01, z: stone.z }, { x: end.x, y: end.y + 0.03, z: end.z }, 1000, 0.1);
    await wait(150);
    await setHand('right', { x: end.x, y: end.y + 0.03, z: end.z }, 0);
    await wait(300);
    await glide('right', { x: end.x, y: end.y + 0.03, z: end.z }, restR, 650, 0.09);
  };

  await setHand('right', restR, 0);
  await setHand('left', restL, 0);
  // Weeks of evenings (film only), then the arrival replayed from darkness.
  await f.evaluate(() => window.__wdd.film.history(21));
  await f.evaluate(() => window.__wdd.arrive());
  await wait(150);
  const startAt = (Date.now() - t0) / 1000;
  const pageT0 = await f.evaluate(() => performance.now());
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  mark('start');
  await wait(3300);
  await still('80-lamp-proposes');

  // ------------------------------------------------------------ Unload (the agent hears a full head)
  mark('unload');
  await say("I still haven't replied to the landlord about the heating. And I need to book the dentist. The slides for Monday aren't done.");
  head.target = -30;
  await wait(2700);
  await still('81-unload-stones');
  await say("That's it.");
  await wait(700);
  await grabStone('t1', 'tomorrow');
  await say('Dentist, tomorrow.');
  await wait(1100);
  await say('Slides, later.');
  head.target = -20;
  await wait(2500);
  await still('82-plan');
  await say('Keep it.');
  head.target = -26;
  await wait(3000);
  await still('83-proposes-release');

  // ------------------------------------------------------------ Release
  mark('release');
  await say('Yes.');
  head.target = -28;
  await wait(2700);
  await still('84-release-ask');
  await say('The meeting with Paul tomorrow. I keep replaying it.');
  await wait(2300);
  await still('85-release-stone');
  {
    const s = await f.evaluate(() => window.__wdd.weightWorld());
    const w = await f.evaluate(() => window.__wdd.waterWorld(0.085));
    if (s != null && w != null) {
      const above = { x: s.x, y: s.y + 0.06, z: s.z };
      await glide('right', restR, above, 650, 0.05);
      await glide('right', above, { x: s.x, y: s.y + 0.012, z: s.z }, 300);
      await setHand('right', { x: s.x, y: s.y + 0.012, z: s.z }, 1);
      await wait(320);
      const over = { x: w.x + 0.03, y: w.y, z: w.z + 0.035 };
      await glide('right', { x: s.x, y: s.y + 0.012, z: s.z }, over, 1300, 0.07);
      await wait(900);
      await still('86-release-hold');
      await wait(500);
      await setHand('right', over, 0);
      await wait(200);
      // The hand leaves low and to the right (never across the caption).
      void glide('right', over, restR, 1100, 0.0);
      await wait(600);
      await still('87-release-sinks');
      await wait(1100);
      await still('88-release-words-of-light');
      await wait(2600);
      await still('89-release-gone');
    }
  }
  // The lamp proposes a minute of breathing (≈ 3.6 s after "Gone"), then "yes".
  await wait(3600);
  await still('90-proposes-breathe');

  // ------------------------------------------------------------ Breathe
  mark('breathe');
  await say('Yes.');
  head.target = -28;
  const sideL = await deskPoint(-0.22, 0.04, 0.06);
  const sideR = await deskPoint(0.22, 0.04, 0.06);
  void glide('left', restL, sideL, 1400, 0.03);
  await glide('right', restR, sideR, 1400, 0.03);
  await wait(3000);
  await still('91-breathe-moon-forms');
  await wait(3600); // first inhale starts at 6.5 s
  await still('92-breathe-in');
  await wait(4200);
  await still('93-breathe-out');
  await wait(4600);
  await wait(1800); // second inhale, nearly full
  await say("That's enough.");
  void glide('left', sideL, restL, 1500, 0.02);
  void glide('right', sideR, restR, 1500, 0.02);
  await wait(3200);
  await still('94-breathe-well-done');
  await wait(5600);
  await still('95-proposes-sleep');
  await say('Good night.');
  head.target = -23;
  await wait(2500);
  await still('96-good-night');
  await wait(300);
  await cdp.send('Page.stopScreencast');
  clearInterval(headTimer);
  await wait(300);
  writeFileSync(join(dir, 'index.json'), JSON.stringify(frames));
  const state = await f.evaluate(() => window.__wdd.evening());
  const audio = await f.evaluate(() => window.__wdd.voice());
  const toVideo = (t) => Math.round(((t - pageT0) / 1000 + startAt) * 1000) / 1000;
  const events = [...audio.log, ...audio.cues].filter((e) => e.t >= pageT0 - 50).map((e) => ({ at: toVideo(e.t), src: e.src, volume: e.volume }));
  writeFileSync(join(dir, 'audio.json'), JSON.stringify({ startAt, events }));
  writeFileSync(join(dir, 'stills.json'), JSON.stringify(stills));
  writeFileSync(join(dir, 'marks.json'), JSON.stringify(marks));
  return { frames: frames.length, seconds: frames.at(-1)?.t ?? 0, mode: state.mode, done: state.done, audioEvents: events.length, voiced: audio.log.length, marks };
}
