// The cost of preparing places in a calm moment (25 Oct): the worst frame while the app prepares the last place and
// the lake by itself (throttled network), and how long each preparation took.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 20e6 / 8, uploadThroughput: 5e6 / 8 });
  await f.evaluate(() => window.__wdd.perfReset());
  let s = null;
  for (let i = 0; i < 80; i++) {
    s = await f.evaluate(() => window.__wdd.prepared());
    if (s.ready.length >= 2 && s.pending === 0) break;
    await wait(500);
  }
  const perf = await f.evaluate(() => window.__wdd.perf());
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  return { prepared: s, frameMaxMs: perf.frameMs.max, frameP99: perf.frameMs.p99, renderMaxMs: perf.renderMs.max, gpuMiB: await f.evaluate(() => +(window.__wdd.placeMemory().bytes / 1048576).toFixed(1)) };
}
