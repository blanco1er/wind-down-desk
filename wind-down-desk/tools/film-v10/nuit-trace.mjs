const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const js = (fn, a) => f.evaluate(fn, a);
  const out = [];
  if (await js(() => window.__wdd.tension().side != null)) { await js(() => window.__wdd.press('keep')); await wait(900); }
  await js(() => window.__wdd.press('ritual:sleep'));
  const t0 = Date.now();
  while (Date.now() - t0 < 34000) {
    const s = await js(() => { try { const d = window.__wdd; const n = d.night(); return { m: d.evening().mode, since: n.since, step: n.step, cap: d.debug().visuals.captionCanvas.last?.slice?.(0, 40) ?? null, rep: d.debug().visuals.replyLabels, side: d.tension().side, xr: d.perf().xr }; } catch (e) { return { err: String(e).slice(0, 80) }; } }).catch((e) => ({ jsErr: String(e).slice(0, 60) }));
    out.push(((Date.now() - t0) / 1000).toFixed(1) + ' ' + JSON.stringify(s));
    await wait(1000);
  }
  return out;
}
