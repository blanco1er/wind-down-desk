// 29 Oct: Places → a place → Full (switch in the open globe) → close → open again → next… until "room" → choose.
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
  const st = async (step, ok) => ({ step, ok, ...(await js(() => ({ mode: window.__wdd.evening().mode, globe: window.__wdd.globe().open, gp: window.__wdd.globe().place, place: window.__wdd.debug().visuals.backdrop.place, imm: window.__wdd.debug().visuals.backdrop.immersionLevel, menu: window.__wdd.debug().visuals.ritualMenuOpen, presses: window.__wdd.presses().last.slice(-2) }))) });
  const log = [];
  const P = async (a) => { const ok = await H.poke(a, { fallback: false }); await wait(700); log.push(await st(a, ok)); return ok; };
  if (await js(() => window.__wdd.tension().side != null)) { await P('keep'); }
  if (await js(() => window.__wdd.debug().visuals.ritualMenuOpen)) await P('rituals');
  await P('places');
  await P('globe-next');
  await P('orb');
  await wait(3000);
  await P('places');
  await P('immersion');
  await P('globe-close');
  await wait(1200);
  if (await js(() => window.__wdd.debug().visuals.ritualMenuOpen)) await P('rituals');
  await P('places');
  for (let k = 0; k < 12 && (await js(() => window.__wdd.globe().place)) !== 'room'; k++) {
    if (!(await js(() => window.__wdd.globe().open))) { log.push(await st('GLOBE CLOSED', false)); break; }
    await P('globe-next');
  }
  await P('orb');
  await wait(3000);
  log.push(await st('end', true));
  await cdp.send('Page.stopScreencast');
  return { log };
}
