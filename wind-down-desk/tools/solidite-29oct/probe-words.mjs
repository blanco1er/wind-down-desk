// 29 Oct: the word grid drawn by the batch (one draw) vs each chip itself — two stills, same frame, and the draws.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp, workspaceRoot }) {
  const f = frame ?? page;
  const js = (fn, a) => f.evaluate(fn, a);
  const out = join(workspaceRoot, 'artifacts', 'solidite-29oct');
  mkdirSync(out, { recursive: true });
  let last = null;
  cdp.on('Page.screencastFrame', (e) => { last = e.data; cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
  const keepAwake = setInterval(() => f.evaluate(() => window.__wdd.press('noop')).catch(() => {}), 1000);
  const still = async (n) => { await wait(500); if (last) writeFileSync(join(out, `${n}.png`), Buffer.from(last, 'base64')); };
  await js(() => window.__wdd.film.history(14));
  if (await js(() => window.__wdd.tension().side != null)) { await js(() => window.__wdd.press('keep')); await wait(800); }
  if (await js(() => window.__wdd.debug().visuals.ritualMenuOpen)) { await js(() => window.__wdd.press('rituals')); await wait(800); }
  const ritual = process.env.RITUAL ?? 'unload';
  await js((k) => window.__wdd.ritual(k), ritual);
  await wait(2500);
  if (ritual === 'unload') { await js(() => window.__wdd.micState('denied')); await wait(1500); }
  const r = { words: await js(() => window.__wdd.debug().visuals.wordChips.filter((c) => c.mesh.visible).map((c) => c.label)) };
  await js(() => window.__wdd.debug().visuals.wordChips.forEach((c) => c.hover.target = 0));
  await js(() => window.__wdd.wordBatch(true)); await wait(600);
  await js(() => window.__wdd.perfReset()); await wait(1000);
  r.on = { batch: await js(() => window.__wdd.wordBatch()), draws: (await js(() => window.__wdd.perf())).drawCalls.max / 2 };
  await still('mots-lot');
  await js(() => window.__wdd.wordBatch(false)); await wait(600);
  await js(() => window.__wdd.perfReset()); await wait(1000);
  r.off = { batch: await js(() => window.__wdd.wordBatch()), draws: (await js(() => window.__wdd.perf())).drawCalls.max / 2 };
  await still('mots-sans-lot');
  await js(() => window.__wdd.wordBatch(true));
  clearInterval(keepAwake);
  await cdp.send('Page.stopScreencast');
  return r;
}
