// Pause / resume (23 Oct): the Quest's system menu hides the session (visibilitychange → "visible-blurred" /
// "hidden"): the evening's clock stops, the mic stops listening, sounds pause; on return everything resumes once
// (never two microphones). Two sources (XR session and page) must BOTH be visible to resume.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const p = (src, vis) => f.evaluate(([s, v]) => window.__wdd.pause(s, v), [src, vis]);
  const r = {};
  r.start = await p('xr', true);
  await wait(500);
  r.before = await p('xr', true);
  r.paused = await p('xr', false);
  await wait(1500);
  r.stillPaused = await p('xr', false);
  r.pageHiddenToo = await p('page', false);
  r.xrBackOnly = await p('xr', true);
  r.bothBack = await p('page', true);
  await wait(800);
  r.after = await p('xr', true);
  r.audio = await f.evaluate(() => {
    let state = null;
    window.__wdd.debug().visuals.root.parent?.traverse?.((o) => { if (o.type === 'AudioListener') state = o.context.state; });
    return state;
  });
  r.clockFrozenWhilePaused = r.stillPaused.elapsed === r.paused.elapsed;
  r.clockRunsAfter = r.after.elapsed > r.bothBack.elapsed;
  return r;
}
