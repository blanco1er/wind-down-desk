// The lamp shows the places: how long from "Places" to the place visible in the glass (first open of the evening,
// previews not decoded yet), and the worst frame meanwhile (the 2k JPG decode is off the main thread; the upload
// with mipmaps is not).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  await f.evaluate(() => window.__wdd.perfReset());
  const t0 = Date.now();
  await f.evaluate(() => window.__wdd.globe('open'));
  let shownAt = null;
  const trace = [];
  for (let i = 0; i < 60 && shownAt == null; i++) {
    const s = await f.evaluate(() => window.__wdd.globe());
    trace.push([Date.now() - t0, s.previews, s.window, s.scale]);
    if (s.window > 0.9) shownAt = Date.now() - t0;
    await wait(50);
  }
  const p1 = await f.evaluate(() => window.__wdd.perf());
  await f.evaluate(() => window.__wdd.perfReset());
  // Browsing: three steps, the worst frame while the next previews decode.
  for (let i = 0; i < 3; i++) {
    await f.evaluate(() => window.__wdd.globe('next'));
    await wait(1200);
  }
  const p2 = await f.evaluate(() => window.__wdd.perf());
  await f.evaluate(() => window.__wdd.globe('close'));
  return { placeVisibleAfterMs: shownAt, openWorstFrameMs: p1.frameMs.max, openP99: p1.frameMs.p99, browseWorstFrameMs: p2.frameMs.max, browseP99: p2.frameMs.p99, drawCallsBrowse: p2.drawCalls, trace: trace.filter((x, i) => i === 0 || x[1] !== trace[i - 1][1] || (x[2] > 0.5) !== (trace[i - 1][2] > 0.5)) };
}
