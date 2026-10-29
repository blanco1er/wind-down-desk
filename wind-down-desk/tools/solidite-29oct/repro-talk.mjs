// 29 Oct — repro of the hands-only bug: a talk evening (default style), nobody speaks. After the first stone, are
// there still words to touch? Samples the touch targets for 14 s after the stone lands. Run after tools/stage.sh.
import { makeHands } from './hands.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const js = (fn, a) => f.evaluate(fn, a);
  cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 30, maxWidth: 320, maxHeight: 180, everyNthFrame: 4 });
  const H = makeHands(f);
  await js(() => { window.IWER_DEVICE.primaryInputMode = 'hand'; });
  if (process.env.MIC) await js((m) => window.__wdd.micState(m), process.env.MIC);
  await H.rest();
  const snap = () => js(() => { const d = window.__wdd; const v = d.debug().visuals; return { phase: d.state().phase, mode: d.evening().mode, mic: d.state().mic, words: v.wordChips.filter((c) => c.mesh.visible).map((c) => c.label), replies: v.replyLabels ?? null, tokens: d.state().tokens.map((t) => `${t.id}:${t.bin ?? (t.released ? 'rel' : '-')}`), bead: d.tension().side, proposal: d.evening().proposal?.ritual ?? null }; });
  const log = [{ t: 'start', ...(await snap()) }];
  if ((await snap()).bead != null) { await H.poke('keep'); await wait(800); }
  // the first stone (the example one on a first evening, or a touched word)
  let s = await snap();
  if (!s.tokens.some((t) => t.endsWith(':-'))) {
    const i = await js(() => window.__wdd.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label && !/Write|That/u.test(c.label)));
    if (i >= 0) { await H.poke(`word:${i}`); await wait(1200); }
  }
  s = await snap();
  log.push({ t: 'before grab', ...s });
  const id = (await js(() => window.__wdd.state().tokens.find((x) => x.bin == null && !x.released)?.id ?? null));
  if (id) await H.grab(id, 'tomorrow');
  for (let k = 0; k < 7; k++) { await wait(2000); log.push({ t: `+${(k + 1) * 2}s`, ...(await snap()) }); }
  await cdp.send('Page.stopScreencast');
  return { log, hands: H.stats };
}
