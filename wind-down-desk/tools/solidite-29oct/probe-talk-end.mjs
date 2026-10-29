// 29 Oct: Talk → a bubble → "That's all" → its stones into Let go → "That's all" → what happens next, second by second.
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
  await js(() => {
    window.__talkLog = [];
    const origFetch = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url);
      if (!u.includes('/api/talk')) return origFetch(url, opts);
      const entry = { t: performance.now(), body: String(opts?.body ?? '').slice(0, 80), stream: String(opts?.body ?? '').includes('"stream":true') };
      window.__talkLog.push(entry);
      opts?.signal?.addEventListener('abort', () => { entry.aborted = performance.now(); entry.stack = new Error().stack?.split('\n').slice(1, 6).join(' | '); });
      return origFetch(url, opts).then((r) => { entry.status = r.status; return r; }, (e) => { entry.error = String(e); throw e; });
    };
    const origAbort = AbortController.prototype.abort;
    AbortController.prototype.abort = function (...a) { (window.__aborts ??= []).push(new Error().stack?.split('\n').slice(1, 5).join(' | ')); return origAbort.apply(this, a); };
  });
  const net = [];
  const reqs = new Map();
  await cdp.send('Network.enable').catch(() => {});
  cdp.on('Network.requestWillBeSent', (e) => { if (e.request.url.includes('/api/')) reqs.set(e.requestId, { url: e.request.url.split('/api/')[1], t: e.timestamp, body: (e.request.postData ?? '').slice(0, 50) }); });
  cdp.on('Network.loadingFailed', (e) => { const r = reqs.get(e.requestId); if (r) net.push({ ...r, failed: e.errorText, canceled: e.canceled, after: +(e.timestamp - r.t).toFixed(2) }); });
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) net.push({ ...r, finished: +(e.timestamp - r.t).toFixed(2) }); });
  const t0 = Date.now();
  const st = async (step) => ({ s: +((Date.now() - t0) / 1000).toFixed(1), step, ...(await js(() => { const d = window.__wdd; const v = d.debug().visuals; return { mode: d.evening().mode, phase: d.state().phase, prop: d.evening().proposal?.ritual ?? null, replies: v.replyLabels, words: v.wordChips.filter((c) => c.mesh.visible).map((c) => c.label).join('|'), card: v.card?.visible, presses: d.presses().last.slice(-2).join(','), talk: d.talk().active, caption: d.caption().flash }; })) });
  const log = [];
  if (await js(() => window.__wdd.tension().side != null)) { await H.poke('keep'); await wait(800); }
  await js(() => window.__wdd.ritual('talk'));
  await wait(9500);
  const i = await js(() => window.__wdd.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label && !/Write|breathe/u.test(c.label)));
  await H.poke(`word:${i}`);
  log.push(await st('bubble'));
  await wait(2500);
  await H.poke('keep');
  log.push(await st("That's all (talk)"));
  for (let k = 0; k < 14 && (await js(() => window.__wdd.evening().mode)) === 'talk'; k++) await wait(1000);
  log.push(await st('talk left'));
  await wait(1200);
  for (let k = 0; k < 6; k++) {
    const id = await js(() => window.__wdd.state().tokens.find((t) => t.bin == null && !t.released)?.id ?? null);
    if (id == null) break;
    await H.grab(id, 'let-go');
    await wait(900);
  }
  log.push(await st('stones let go'));
  for (let k = 0; k < 10; k++) { if (await js(() => window.__wdd.debug().visuals.wordChips.some((c) => c.mesh.visible && /^That/u.test(c.label ?? '')))) break; await wait(1000); }
  const j = await js(() => window.__wdd.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && /^That/u.test(c.label ?? '')));
  await H.poke(`word:${j}`);
  log.push(await st("That's all (unload)"));
  for (let k = 0; k < 14; k++) { await wait(1000); log.push(await st('…')); }
  await cdp.send('Page.stopScreencast');
  return { log: log.slice(0, 6), talk: await js(() => window.__talkLog), aborts: await js(() => window.__aborts ?? []), net };
}
