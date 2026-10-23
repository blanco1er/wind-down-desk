// CPU budget before / after (26 Oct): the app's CPU per frame (ECS update + render submit) at ×1 and ×6 in four
// states — your room (the lamp proposes), a place in Full with stones to sort (the beach, waves), Places in the
// globe, your sky in the lamp — each over 3 windows of 3 s: mean and the worst window's p95 (update p95 + render p95,
// conservative). Plus the GPU cost of the place's sphere with and without blending (backdrop alone, one Quest eye).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const ev = (fn, a) => f.evaluate(fn, a);
  await ev(() => window.__wdd.film.day(40));
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
  await wait(7000);
  await ev(() => window.__wdd.quality?.(0));
  const measure = async (state, rate) => {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await wait(600);
    const w = [];
    for (let i = 0; i < 3; i++) {
      await ev(() => window.__wdd.perfReset());
      await wait(3000);
      const p = await ev(() => window.__wdd.perf());
      w.push({ mean: p.updateMs.avg + p.renderMs.avg, p95: p.updateMs.p95 + p.renderMs.p95 });
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    return { state, rate, mean: +(w.reduce((a, b) => a + b.mean, 0) / w.length).toFixed(2), worstP95: +Math.max(...w.map((x) => x.p95)).toFixed(2) };
  };
  const rows = [];
  for (const r of [1, 6]) rows.push(await measure('room', r));
  await ev(() => window.__wdd.place('moon-beach'));
  await wait(4000);
  await ev(() => window.__wdd.immersion('full'));
  await ev(() => window.__wdd.say('I have to call the bank and finish the slides, and I keep thinking about my sister.'));
  await wait(5000);
  for (const r of [1, 6]) rows.push(await measure('beach Full, stones', r));
  await ev(() => window.__wdd.globe('open'));
  await wait(2500);
  rows.push(await measure('Places in the globe', 6));
  await ev(() => window.__wdd.globe('close'));
  await wait(1500);
  await ev(() => window.__wdd.sky(false));
  await wait(1500);
  rows.push(await measure('sky in the lamp', 6));
  // GPU: the sphere alone, blending on vs off (render state only).
  const gpu = await ev(() => {
    const b = window.__wdd.debug().visuals.backdrop;
    const m = b.mesh.material;
    const keep = m.blending;
    m.blending = 1; // NormalBlending
    const normal = window.__wdd.backdropBench(40);
    m.blending = 0; // NoBlending
    const none = window.__wdd.backdropBench(40);
    m.blending = keep;
    return { normalOffMs: normal.offMs, noBlendOffMs: none.offMs, opaqueNow: b.opaque ?? null };
  });
  return { rows, gpu };
}
