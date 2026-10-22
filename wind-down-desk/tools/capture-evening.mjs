// Records a scripted evening in the emulator (npx iwsdk browser run tools/capture-evening.mjs).
// Real input paths only: utterances go through the same handler as transcribed speech
// (window.__wdd.say), stones are moved by the emulated right hand (IWER) through the
// IWSDK grab system. Frames come from the CDP screencast and are written to
// artifacts/$WDD_FRAMES (default frames-v3); tools/frames-to-video.sh turns them into an mp4.
// Stills of key moments are saved as artifacts/<name>$WDD_SUFFIX.png (default -v3).
// The head (emulated headset) breathes slightly and looks up at the plan card, as a person would.
// Prerequisite: sh tools/stage.sh (seated at the table, film camera).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  // Hide the IWSDK workspace switcher (dev chrome around the app) from the recording.
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.workspace-view-switcher{display:none!important}';
    document.head.appendChild(style);
  });
  const dirName = process.env.WDD_FRAMES ?? 'frames-v3';
  const suffix = process.env.WDD_SUFFIX ?? '-v3';
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
  const still = async (name) => {
    try {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(workspaceRoot, 'artifacts', `${name}${suffix}.png`), Buffer.from(shot.data, 'base64'));
    } catch {}
  };

  // Head: seated, facing the table (yaw 90°), pitch animated; a slow breathing sway.
  const head = { pitch: -30, target: -30, yaw: 90 };
  let headTimer = null;
  const applyHead = (t) =>
    f.evaluate(([p, y, sway]) => {
      const rad = Math.PI / 180;
      const pitch = (p + sway.p) * rad;
      const yaw = (y + sway.y) * rad;
      const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
      window.IWER_DEVICE.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
    }, [head.pitch, head.yaw, { p: Math.sin(t * 0.7) * 0.35, y: Math.sin(t * 0.43) * 0.5 }]);
  headTimer = setInterval(() => {
    head.pitch += (head.target - head.pitch) * 0.06;
    applyHead((Date.now() - t0) / 1000).catch(() => {});
  }, 33);

  const say = (text) => f.evaluate((t) => window.__wdd.say(t), text);
  const deskPoint = (x, y, z) => f.evaluate(([a, b, c]) => window.__wdd.deskPoint(a, b, c), [x, y, z]);
  const setHand = (p, pinch) =>
    f.evaluate(([pos, v]) => {
      const hand = window.IWER_DEVICE.hands.right;
      hand.position.set(pos.x, pos.y, pos.z);
      if (v != null) hand.updatePinchValue(v);
    }, [p, pinch]);
  // The resting hand stays low and to the right, out of the way of the text.
  const rest = await deskPoint(0.52, 0.0, 0.56);
  const glide = async (from, to, ms, lift = 0) => {
    const steps = Math.max(6, Math.round(ms / 33));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      await setHand({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e + Math.sin(Math.PI * k) * lift, z: from.z + (to.z - from.z) * e }, null);
      await wait(33);
    }
  };
  const grab = async (id, target, onCarry) => {
    const stone = await f.evaluate((i) => window.__wdd.stoneWorld(i), id);
    const end = typeof target === 'string' ? await f.evaluate((b) => window.__wdd.binWorld(b), target) : await deskPoint(...target);
    if (stone == null || end == null) return;
    const above = { x: stone.x, y: stone.y + 0.06, z: stone.z };
    await glide(rest, above, 700);
    await glide(above, { x: stone.x, y: stone.y + 0.01, z: stone.z }, 300);
    await setHand({ x: stone.x, y: stone.y + 0.01, z: stone.z }, 1);
    await wait(260);
    await glide({ x: stone.x, y: stone.y + 0.01, z: stone.z }, { x: end.x, y: end.y + 0.03, z: end.z }, 1100, 0.1);
    if (onCarry) await onCarry();
    await wait(160);
    await setHand({ x: end.x, y: end.y + 0.03, z: end.z }, 0);
    await wait(300);
    await glide({ x: end.x, y: end.y + 0.03, z: end.z }, rest, 700);
  };

  await setHand(rest, 0);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await wait(2200);
  await still('20-evening-empty');
  await say("I still haven't replied to the landlord about the heating. And I need to book the dentist, it's been a year.");
  await wait(3200);
  await say("The slides for Monday aren't done. I keep replaying that awkward comment I made in the meeting. Oh, and my passport expires in March.");
  await wait(3600);
  await still('21-stones-engraved');
  await say("That's it.");
  await wait(1200);
  await grab('t1', 'tomorrow', () => still('22-carry-to-tomorrow'));
  await wait(700);
  await grab('t4', 'let-go');
  await wait(900);
  await still('23-let-go-dust');
  await wait(2300);
  await say('Dentist, tomorrow.');
  await wait(1700);
  await say('Slides for Monday, tomorrow too.');
  await wait(1700);
  await grab('t5', 'later');
  await wait(1200);
  // Look up at the plan card.
  head.target = -17;
  await wait(2600);
  await still('24-plan-card');
  await wait(1200);
  await say('Keep it.');
  await wait(900);
  head.target = -30;
  await wait(3000);
  await still('25-good-night');
  await wait(2000);
  await cdp.send('Page.stopScreencast');
  clearInterval(headTimer);
  await wait(300);
  writeFileSync(join(dir, 'index.json'), JSON.stringify(frames));
  const state = await f.evaluate(() => window.__wdd.state());
  return { frames: frames.length, seconds: frames.at(-1)?.t ?? 0, phase: state.phase, milestones: state.milestones, tokens: state.tokens };
}
