// CPU / overdraw pass, A/B on the same page at the same moment (26 Oct): this pass's savings off / on, alternated
// 4 times in each state at CPU ×6 (3 s windows): the app's CPU per frame (mean, p95, perf-system `cpuMs`). And the
// place's sphere with / without blending on the GPU (backdrop alone, one Quest eye, 40 draws, alternated 4 times).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const ev = (fn, a) => f.evaluate(fn, a);
  const state = process.env.WDD_STATE ?? 'beach';
  await ev(() => window.__wdd.film.day(50));
  await ev(() => {
    const d = window.IWER_DEVICE;
    d.position.set(-0.84, 1.26, 0.2);
    const yaw = Math.PI / 2, pitch = (-27 * Math.PI) / 180;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
  });
  if (await f.isVisible('[data-style="talk"]')) await f.click('[data-style="talk"]');
  else await f.click('#begin');
  for (let i = 0; i < 40; i++) {
    if (['table', 'floating'].includes(await ev(() => window.__wdd?.state?.().placement ?? null))) break;
    await wait(300);
  }
  await wait(6000);
  await ev(() => window.__wdd.quality?.(0));
  if (state !== 'room') {
    await ev(() => window.__wdd.place('moon-beach'));
    await wait(3500);
    await ev(() => window.__wdd.immersion('full'));
    await ev(() => window.__wdd.say('I have to call the bank, finish the slides, book the dentist, and I keep thinking about my sister.'));
    await wait(4000);
  }
  if (state === 'globe') {
    await ev(() => window.__wdd.globe('open'));
    await wait(2000);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await wait(800);
  const runs = { off: [], on: [] };
  for (let i = 0; i < 8; i++) {
    const on = i % 2 === 1;
    await ev((v) => window.__wdd.perfOpts(v), on);
    await wait(500);
    await ev(() => window.__wdd.perfReset());
    await wait(3000);
    const p = await ev(() => window.__wdd.perf());
    runs[on ? 'on' : 'off'].push({ mean: p.cpuMs.avg, p95: p.cpuMs.p95 });
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await ev(() => window.__wdd.perfOpts(true));
  const avg = (a, k) => +(a.reduce((x, y) => x + y[k], 0) / a.length).toFixed(2);
  const gpu = await ev(() => {
    const m = window.__wdd.debug().visuals.backdrop.mesh.material;
    const keep = m.blending;
    const r = { normal: [], none: [] };
    for (let i = 0; i < 4; i++) {
      m.blending = 1;
      r.normal.push(window.__wdd.backdropBench(30).offMs);
      m.blending = 0;
      r.none.push(window.__wdd.backdropBench(30).offMs);
    }
    m.blending = keep;
    const med = (a) => a.slice().sort((x, y) => x - y)[2];
    return { blendingMs: med(r.normal), noBlendingMs: med(r.none), opaqueNow: window.__wdd.debug().visuals.backdrop.opaque };
  });
  return { state, cpuX6: { off: { mean: avg(runs.off, 'mean'), p95: avg(runs.off, 'p95') }, on: { mean: avg(runs.on, 'mean'), p95: avg(runs.on, 'p95') } }, gpu };
}
