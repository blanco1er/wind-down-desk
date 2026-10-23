// HD places (26 Oct): on a 20 Mbit/s network (CDP), what this GPU decides (8k or 6k), how long the calm-moment 8k
// preparation takes and the worst frame meanwhile; a place chosen before its 8k is ready (6k at once, 8k swapped in
// at the next calm moment); and a prepared 8k place (crossfade start, worst frame). Writes nothing; returns JSON.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const ev = (fn, a) => f.evaluate(fn, a);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 20e6 / 8, uploadThroughput: 5e6 / 8 });
  // WDD_HD=0: the same run with HD forced off (the 6k baseline, A/B).
  if (process.env.WDD_HD === '0') await ev(() => window.__wdd.hd(false));
  const out = { gpu: await ev(() => window.__wdd.hd()) };
  // 1. Calm moment: the lake (Talk it through's place) is prepared in 8k by itself.
  await ev(() => window.__wdd.perfReset());
  let t0 = Date.now();
  let s = null;
  for (let i = 0; i < 100; i++) {
    s = await ev(() => window.__wdd.hd());
    if (s.prepared.some((p) => p.id === 'moon-lake')) break;
    await wait(300);
  }
  let perf = await ev(() => window.__wdd.perf());
  out.calmPrepare = { place: 'moon-lake', seconds: (Date.now() - t0) / 1000, hd: s.prepared.find((p) => p.id === 'moon-lake')?.hd ?? null, frameMaxMs: perf.frameMs.max, frameP99: perf.frameMs.p99, uploadMs: s.uploadMs, log: (await ev(() => window.__wdd.prepared())).log?.slice(-2) };
  // 2. A place chosen before its 8k: 6k crossfade at once, then the 8k swapped in at the next calm moment.
  await ev(() => window.__wdd.perfReset());
  t0 = Date.now();
  await ev(() => void window.__wdd.place('moon-beach'));
  let start = null;
  for (let i = 0; i < 300; i++) {
    const p = await ev(() => window.__wdd.debug().visuals.backdrop.progress);
    if (p > 0 && p < 1) { start = Date.now() - t0; break; }
    await wait(20);
  }
  perf = await ev(() => window.__wdd.perf());
  out.chooseUnprepared = { place: 'moon-beach', crossfadeStartsAfterMs: start, frameMaxMs: perf.frameMs.max, hdAtStart: (await ev(() => window.__wdd.hd())).hereHd };
  await wait(2500);
  await ev(() => window.__wdd.perfReset());
  t0 = Date.now();
  for (let i = 0; i < 120; i++) {
    s = await ev(() => window.__wdd.hd());
    if (s.hereHd) break;
    await wait(300);
  }
  perf = await ev(() => window.__wdd.perf());
  out.upgradeInPlace = { place: 'moon-beach', secondsAfterArrival: (Date.now() - t0) / 1000 + 2.5, hd: s.hereHd, uploadMs: s.uploadMs, frameMaxMs: perf.frameMs.max, frameP99: perf.frameMs.p99 };
  // 3. Back to the prepared 8k lake: crossfade at once.
  await ev(() => window.__wdd.perfReset());
  t0 = Date.now();
  await ev(() => void window.__wdd.place('moon-lake'));
  start = null;
  for (let i = 0; i < 300; i++) {
    const p = await ev(() => window.__wdd.debug().visuals.backdrop.progress);
    if (p > 0 && p < 1) { start = Date.now() - t0; break; }
    await wait(20);
  }
  await wait(2200);
  perf = await ev(() => window.__wdd.perf());
  s = await ev(() => window.__wdd.hd());
  out.choosePrepared = { place: 'moon-lake', crossfadeStartsAfterMs: start, hd: s.hereHd, frameMaxMs: perf.frameMs.max, frameP99: perf.frameMs.p99 };
  out.memory = { gpuMiB: +(s.gpuBytes / 1048576).toFixed(1), format: s.format, prepared: s.prepared };
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  return out;
}
