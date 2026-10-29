// 29 Oct: the hands' look, grey (shipped) or Meta blue (?hands=meta / localStorage wdd.hands), in four poses:
// at rest, the index pointing at a button, the fingertip on it, a pinch. One hand acts, the other rests lower.
// SCENE=room (the emulator's stand-in room, Mixed) | night (Moonlit lake, Full). LABEL names the files.
//   sh tools/stage.sh 54 30 && LABEL=grey SCENE=room npx @iwsdk/cli browser run tools/mains-29oct/probe-style.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRig } from '../film-v9/rig.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const js = (fn, a) => f.evaluate(fn, a);
  const label = process.env.LABEL ?? 'x';
  const scene = process.env.SCENE ?? 'room';
  const out = join(workspaceRoot, '..', 'video', 'mains-29oct', 'brut');
  mkdirSync(out, { recursive: true });
  await page.evaluate(() => { const s = document.createElement('style'); s.textContent = '.workspace-view-switcher{display:none!important}'; document.head.appendChild(s); });
  let last = null;
  cdp.on('Page.screencastFrame', (e) => { last = e.data; cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  const still = async (n) => { await wait(350); if (last) writeFileSync(join(out, `${label}-${scene}-${n}.jpg`), Buffer.from(last, 'base64')); };
  const style = await js(() => localStorage.getItem('wdd.hands'));
  if (scene === 'night') {
    await js(async () => { await window.__wdd.place('moon-lake'); });
    await wait(2500);
    await js(() => window.__wdd.immersion('full'));
    await wait(2500);
  }
  const R = await makeRig(f);
  // Nothing open over the desk, and the head a little lower, so the bottom row and the hands are in frame.
  await js(() => { const v = window.__wdd.debug().visuals; if (v.placesOpen) window.__wdd.press('globe-close'); if (v.ritualsOpen) window.__wdd.press('rituals'); });
  await R.look(-40);
  await wait(900);
  await R.restBoth(500);
  await R.leftSettle(600);
  await wait(800);
  await still('1-repos');
  // The right index comes to a button (Rituals, on the bottom row): 7 cm in front, then on it.
  const b = await js(() => window.__wdd.buttonWorld('rituals'));
  const head = await js(() => ({ ...window.__rig9.head.pos }));
  const d0 = R.sub(head, b);
  const n = Math.hypot(d0.x, d0.y, d0.z) || 1;
  const d = R.scale(d0, 1 / n);
  await R.pose('right', 'point');
  await R.turn('right', 'point', 400);
  await wait(450);
  const off = await js(() => { const t = window.__wdd.tipWorld('right'); const p = window.IWER_DEVICE.hands.right.position; return { x: t.x - p.x, y: t.y - p.y, z: t.z - p.z }; });
  await R.move('right', R.sub(R.add(b, R.scale(d, 0.07)), off), 650, 0.03);
  await wait(500);
  await still('2-pointe');
  await R.move('right', R.sub(R.add(b, R.scale(d, 0.004)), off), 260);
  await wait(60);
  await still('3-toucher');
  await R.move('right', R.sub(R.add(b, R.scale(d, 0.09)), off), 300);
  await wait(700);
  await js(() => { const v = window.__wdd.debug().visuals; if (v.ritualsOpen) window.__wdd.press('rituals'); if (v.placesOpen) window.__wdd.press('globe-close'); });
  await wait(700);
  // A pinch over the tray, one hand.
  await R.pose('right', 'default');
  await R.turn('right', 'pinch', 450);
  const p = await R.deskPoint(0.06, 0.09, 0.2);
  await R.move('right', p, 600, 0.03);
  await R.pinch('right', 1);
  await wait(400);
  await still('4-pincement');
  await R.pinch('right', 0);
  await cdp.send('Page.stopScreencast');
  return { label, scene, style, hands: await js(() => window.__wdd.debug().hands?.snapshot?.() ?? null).catch(() => null) };
}
