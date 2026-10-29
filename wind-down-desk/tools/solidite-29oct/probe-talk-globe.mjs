// 29 Oct: after Talk → "That's all" (stones of what weighs left on the desk), Places: does the globe close by itself?
import { makeHands } from './hands.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const js = (fn, a) => f.evaluate(fn, a);
  cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 20, maxWidth: 320, maxHeight: 180, everyNthFrame: 3 });
  const H = makeHands(f);
  await js(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; });
  await H.rest();
  const st = async (step) => ({ step, ...(await js(() => ({ mode: window.__wdd.evening().mode, phase: window.__wdd.state().phase, globe: window.__wdd.globe().open, gp: window.__wdd.globe().place, place: window.__wdd.debug().visuals.backdrop.place, presses: window.__wdd.presses().last.slice(-3), tokens: window.__wdd.state().tokens.filter((t) => t.bin == null && !t.released).length, caption: window.__wdd.caption().flash }))) });
  const log = [];
  if (await js(() => window.__wdd.tension().side != null)) { await H.poke('keep'); await wait(800); }
  await js(() => window.__wdd.ritual('talk'));
  await wait(9500);
  const i = await js(() => window.__wdd.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label && !/Write|breathe/u.test(c.label)));
  await H.poke(`word:${i}`);
  await wait(6000);
  await H.poke('keep');
  for (let k = 0; k < 6; k++) { await wait(2000); log.push(await st(`after That's all +${(k + 1) * 2}s`)); }
  if (await js(() => window.__wdd.debug().visuals.ritualMenuOpen)) await H.poke('rituals');
  await H.poke('places');
  await wait(1200);
  log.push(await st('places poked'));
  for (let k = 0; k < 4; k++) {
    const ok = await H.poke('globe-next', { fallback: false });
    await wait(500);
    log.push(await st(`globe-next ${ok}`));
  }
  await cdp.send('Page.stopScreencast');
  return { log, misses: H.stats.pokeMisses };
}
