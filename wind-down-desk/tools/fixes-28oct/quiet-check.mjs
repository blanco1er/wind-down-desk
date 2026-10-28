// 28 Oct fix check (Quiet evening): touch a word → a stone; the words fold away while it waits; the right hand
// (IWER, real pinch through IWSDK grabbing) places it in Later; the words come back; "That's all" ends the Unload.
// At each step: caption, words shown, phase, plus a runtime screenshot artifacts/fixes-28oct/<TAG>-calme-<n>.png.
// Run after `sh tools/stage.sh 54 30`:   TAG=apres npx @iwsdk/cli browser run tools/fixes-28oct/quiet-check.mjs --timeout 100000
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const tag = process.env.TAG ?? 'apres';
  const js = (fn, arg) => f.evaluate(fn, arg);
  const steps = [];
  const shot = async (n, label) => {
    await wait(150);
    const info = await js(() => {
      const v = window.__wdd.debug().visuals;
      return {
        caption: v.pendingCaption?.text ?? v.captionCanvas?.last ?? null,
        flash: window.__wdd.caption().flash,
        phase: window.__wdd.state().phase,
        mode: window.__wdd.evening().mode,
        wordsShown: v.wordsShown,
        words: v.wordChips.filter((c) => c.mesh.visible && c.label != null).map((c) => c.label),
        tokens: window.__wdd.state().tokens.map((t) => `${t.text}:${t.bin ?? '-'}`),
      };
    });
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = join(workspaceRoot, 'artifacts', 'fixes-28oct', `${tag}-calme-${n}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    steps.push({ n, label, ...info });
  };
  // As the v8 film take: a returning person (seeded history), a quiet evening, the lamp's proposal answered "Yes".
  await js(() => {
    window.__wdd.film.history(21);
    window.__wdd.style('quiet');
    window.__wdd.arrive();
  });
  for (let k = 0; k < 60 && !(await js(() => window.__wdd.debug().visuals.repliesShown === true)); k++) await wait(150);
  await wait(800);
  await js(() => window.__wdd.press('keep'));
  for (let k = 0; k < 60 && !(await js(() => window.__wdd.debug().visuals.wordsShown === true)); k++) await wait(150);
  await wait(1500);
  await shot(1, 'words to touch');
  const idx = await js(() => window.__wdd.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label === 'Work'));
  await js((i) => window.__wdd.press(`word:${i}`), idx);
  await wait(2500);
  // A feedback line (e.g. a keepsake arriving) may hold the caption a few seconds: wait for the phase caption.
  for (let k = 0; k < 50 && (await js(() => window.__wdd.caption().flash)) != null; k++) await wait(200);
  await wait(900);
  await shot(2, 'a stone waits, words folded');
  // The right hand pinches the stone and carries it to Later.
  const stoneId = await js(() => window.__wdd.state().tokens.find((t) => t.bin == null && !t.released)?.id ?? null);
  const s = await js((i) => window.__wdd.stoneWorld(i), stoneId);
  const end = await js(() => window.__wdd.binWorld('later'));
  const rest = await js(() => window.__wdd.deskPoint(0.52, 0.0, 0.56));
  const setHand = (p, pinch) =>
    js(([pos, v]) => {
      const hand = window.IWER_DEVICE.hands.right;
      hand.position.set(pos.x, pos.y, pos.z);
      if (v != null) hand.updatePinchValue(v);
    }, [p, pinch]);
  await js(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; });
  const path = async (a, b, n, ms) => {
    for (let k = 1; k <= n; k++) {
      const q = k / n;
      await setHand({ x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q, z: a.z + (b.z - a.z) * q });
      await wait(ms / n);
    }
  };
  const over = { x: s.x, y: s.y + 0.01, z: s.z };
  await path(rest, { x: s.x, y: s.y + 0.06, z: s.z }, 10, 700);
  await path({ x: s.x, y: s.y + 0.06, z: s.z }, over, 4, 300);
  await setHand(over, 1);
  await wait(400);
  await shot(3, 'stone pinched');
  const drop = { x: end.x, y: end.y + 0.03, z: end.z };
  await path(over, drop, 14, 1100);
  await wait(200);
  await setHand(drop, 0);
  await wait(400);
  await path(drop, rest, 8, 600);
  await wait(2600);
  await shot(4, 'stone placed, words back');
  // The caption rises above the words (by design): look up a little to see it with them.
  const look = (pitchDeg) =>
    js((p) => {
      const yaw = Math.PI / 2, pitch = (p * Math.PI) / 180;
      const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
      window.IWER_DEVICE.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
    }, pitchDeg);
  await look(-14);
  await wait(600);
  await shot('4b', 'words back, looking up at the caption');
  await look(-30);
  // Idle 9 s (> the 8 s of the first-evening example stone): the words must still be there, no example stone.
  await wait(9000);
  await shot('4c', 'idle 9 s after the sort: still the words');
  const done = await js(() => window.__wdd.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label === "That's all"));
  if (done >= 0) await js((i) => window.__wdd.press(`word:${i}`), done);
  await wait(2500);
  await shot(5, "That's all");
  await js(() => window.__wdd.style('talk'));
  return steps;
}
