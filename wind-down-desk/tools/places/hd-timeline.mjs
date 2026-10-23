// Where does the HD preparation cost frames? Long frames (> 22 ms, perf-system) next to the preparation's own steps
// (download + transcode done, GPU upload, install), while the calm moment prepares the lake in 8k on 20 Mbit/s.
//   WDD_HD=0: the 6k baseline.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  if (process.env.WDD_HD === '0') await f.evaluate(() => window.__wdd.hd(false));
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 20e6 / 8, uploadThroughput: 5e6 / 8 });
  await f.evaluate(() => window.__wdd.perfReset());
  const t0 = await f.evaluate(() => Math.round(performance.now()));
  for (let i = 0; i < 150; i++) {
    const s = await f.evaluate(() => window.__wdd.hd());
    if (s.prepared.some((p) => p.id === 'moon-lake')) break;
    await wait(300);
  }
  await wait(1500);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const r = await f.evaluate(() => ({ timeline: window.__wdd.hd().timeline, perf: window.__wdd.perf() }));
  return { t0, timeline: r.timeline, longFrames: r.perf.longFrames, frameMax: r.perf.frameMs.max, p99: r.perf.frameMs.p99, samples: r.perf.samples };
}
