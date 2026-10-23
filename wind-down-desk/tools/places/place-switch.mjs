// Place changes without a visible pause (25 Oct, "fluide"): for each place, the delay between the touch and the
// start of the crossfade, and the worst frame during the change, on a throttled network (Wi-Fi-like, CDP).
//   WDD_PREPARE=1: wait first for the calm-moment preparation to finish (what the app now does by itself).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (20e6 / 8), uploadThroughput: (5e6 / 8) });
  const places = (process.env.WDD_PLACES ?? 'moon-lake,ember-fire,northern-lights').split(',');
  const out = [];
  if (process.env.WDD_PREPARE === '1') {
    for (let i = 0; i < 120; i++) {
      const s = await f.evaluate(() => window.__wdd.prepared?.() ?? null);
      if (s != null && s.pending === 0 && s.ready.length > 0) break;
      await wait(500);
    }
    out.push({ prepared: await f.evaluate(() => window.__wdd.prepared?.() ?? null) });
  }
  for (const id of places) {
    await f.evaluate(() => window.__wdd.perfReset());
    const t0 = Date.now();
    await f.evaluate((p) => void window.__wdd.press(`place:${p}`), id);
    let startMs = null;
    for (let i = 0; i < 400; i++) {
      const p = await f.evaluate(() => window.__wdd.debug().visuals.backdrop.progress);
      if (p > 0 && p < 1) {
        startMs = Date.now() - t0;
        break;
      }
      await wait(20);
    }
    await wait(2600);
    const perf = await f.evaluate(() => window.__wdd.perf());
    out.push({ place: id, crossfadeStartsAfterMs: startMs, frameMaxMs: perf.frameMs?.max ?? null, frameP99: perf.frameMs?.p99 ?? null, renderMaxMs: perf.renderMs?.max ?? null });
    await wait(500);
  }
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  return out;
}
