// 29 Oct — every new moment ends without voice or controller (touch and pinch only, Quiet style), and the fallbacks
// of an unknown room (no table, no wall, no ceiling: debug `blindRoom`). Stills go to ../video/finition-29oct/apres.
//   SCENE=touch|blind  (after: localStorage wdd.style = quiet, a fresh stage)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const scene = process.env.SCENE ?? 'touch';
  const out = join(workspaceRoot, '..', 'video', 'finition-29oct', 'apres');
  mkdirSync(out, { recursive: true });
  let last = null;
  cdp.on('Page.screencastFrame', async (e) => { last = e.data; try { await cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }); } catch {} });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  const js = (fn, a) => f.evaluate(fn, a);
  const t0 = Date.now();
  const log = [];
  const mark = async (step, extra = {}) => log.push({ s: +((Date.now() - t0) / 1000).toFixed(1), step, mode: await js(() => window.__wdd.evening().mode), ...extra });
  const still = async (name) => { await wait(250); if (last) writeFileSync(join(out, `${name}.jpg`), Buffer.from(last, 'base64')); };
  const until = async (fn, ms, arg) => { const end = Date.now() + ms; while (Date.now() < end) { if (await js(fn, arg)) return true; await wait(150); } return false; };
  const replies = () => js(() => window.__wdd.debug().visuals.replyLabels ?? null);
  const touchWord = (label) => js((l) => { const i = window.__wdd.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label === l); if (i >= 0) window.__wdd.press(`word:${i}`); return i; }, label);
  await js(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; const d = window.__wdd; if (d.tension().side != null) d.press('keep'); });
  await wait(1500);
  if (scene === 'blind') {
    await js(() => { window.__wdd.blindRoom(true); window.__wdd.recenter(true); });
    await until(() => ['table', 'floating'].includes(window.__wdd.state().placement), 8000);
    await wait(2500);
    await mark('unknown room: desk placed', { placement: await js(() => window.__wdd.state().placement), walls: await js(() => window.__wdd.walls().walls.length) });
    await js(() => window.__wdd.tension().side != null && window.__wdd.press('keep'));
    await still('piece-inconnue-1-bureau-flottant');
  }
  // Keep, by touch: three good things, then it ends by itself.
  if (!(await js(() => window.__wdd.debug().visuals.ritualMenuOpen))) await js(() => window.__wdd.press('rituals'));
  await wait(700);
  await js(() => window.__wdd.press('ritual:keep'));
  await until(() => window.__wdd.evening().mode === 'keep', 4000);
  await wait(1200);
  const keepWords = await js(() => window.__wdd.debug().visuals.wordChips.filter((c) => c.mesh.visible).map((c) => c.label));
  await mark('keep: words to touch', { words: keepWords, replies: await replies(), wall: await js(() => window.__wdd.walls().picked?.id ?? null) });
  for (const w of keepWords.filter((l) => l != null && !/Write/u.test(l)).slice(0, 3)) {
    await touchWord(w);
    await wait(900);
  }
  if (scene === 'blind') { await wait(4200); await still('piece-inconnue-2-lumieres-au-bureau'); }
  const keptDone = await until(() => window.__wdd.evening().mode === 'choose', 15000);
  await mark('keep: ended by touch', { ended: keptDone, kept: (await js(() => window.__wdd.keep())).tonight });
  if (scene === 'touch') {
    // The journal: the menu's "Your sky" row, Earlier, Close.
    if (!(await js(() => window.__wdd.debug().visuals.ritualMenuOpen))) await js(() => window.__wdd.press('rituals'));
    await wait(700);
    await js(() => window.__wdd.press('ritual:sky'));
    await wait(1800);
    const j1 = await js(() => window.__wdd.journal());
    await js(() => window.__wdd.press('keep'));
    await wait(900);
    const j2 = await js(() => window.__wdd.journal());
    await js(() => window.__wdd.press('lighter'));
    await wait(900);
    await mark('journal: opened, Earlier, Close by touch', { open: j1.open, earlier: j2.index, closed: !(await js(() => window.__wdd.journal().open)) });
    // The volumes: the Sound button held (its hand path), "Done".
    await js(() => window.__wdd.mix('open'));
    await wait(1200);
    const mixReplies = await replies();
    await js(() => window.__wdd.press('keep'));
    await wait(800);
    await mark('volumes: opened by holding Sound, Done by touch', { replies: mixReplies, closed: !(await js(() => window.__wdd.mix().open)) });
  }
  // The night: the menu's Good night row; the bead skipped by touch; the closing line; Lights out.
  if (!(await js(() => window.__wdd.debug().visuals.ritualMenuOpen))) await js(() => window.__wdd.press('rituals'));
  await wait(700);
  await js(() => window.__wdd.press('ritual:sleep'));
  if (await until(() => window.__wdd.tension().side === 'out', 4000)) { await wait(600); await js(() => window.__wdd.press('keep')); }
  await until(() => window.__wdd.night().sleep != null, 20000);
  await mark('night: the closing line', { ceiling: (await js(() => window.__wdd.night())).ceiling, replies: await replies() });
  if (scene === 'blind') {
    await js(([p, y]) => { const rad = Math.PI / 180; const sy = Math.sin((y * rad) / 2), cy = Math.cos((y * rad) / 2), sx = Math.sin((p * rad) / 2), cx = Math.cos((p * rad) / 2); window.IWER_DEVICE.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx); }, [50, 90]);
    await wait(1500);
    await still('piece-inconnue-3-ciel-en-dome');
    await js(([p, y]) => { const rad = Math.PI / 180; const sy = Math.sin((y * rad) / 2), cy = Math.cos((y * rad) / 2), sx = Math.sin((p * rad) / 2), cx = Math.cos((p * rad) / 2); window.IWER_DEVICE.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx); }, [-30, 90]);
  }
  await wait(600);
  await mark('night: the fade, one button', { sleep: (await js(() => window.__wdd.night())).sleep?.seconds ?? null, replies: await replies() });
  await js(() => window.__wdd.press('keep'));
  const ended = await until(() => !window.__wdd.perf().xr, 15000);
  await mark(ended ? 'session ended by "Lights out"' : 'session still open');
  await js(() => window.__wdd.blindRoom(false));
  await cdp.send('Page.stopScreencast');
  return log;
}
