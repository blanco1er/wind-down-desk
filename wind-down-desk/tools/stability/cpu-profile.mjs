// CPU at ×6 (Quest-like budget check, 26 Oct): p95 of the app's CPU per frame (ECS update + render submit) in a few
// states, and a sampling profile of the busiest functions (CDP Profiler, self time) in the heaviest one.
//   WDD_STATE=unload-place (default) | choose | sky
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const ev = (fn, a) => f.evaluate(fn, a);
  await ev(() => window.__wdd.film.day(12));
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
  await wait(12000);
  await ev(() => window.__wdd.quality(0));
  const measure = async (label) => {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await wait(800);
    await ev(() => window.__wdd.perfReset());
    await wait(4000);
    const p = await ev(() => window.__wdd.perf());
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    return { label, updateP95: p.updateMs.p95, renderP95: p.renderMs.p95, cpuP95: +(p.updateMs.p95 + p.renderMs.p95).toFixed(2), draws: p.drawCalls.p50 / 2 };
  };
  const rows = [await measure('choose (room)')];
  await ev(() => window.__wdd.place('moon-beach'));
  await wait(4000);
  await ev(() => window.__wdd.immersion('full'));
  await ev(() => window.__wdd.say("I have to call the bank, finish the slides, and I keep thinking about the argument with my sister."));
  await wait(5000);
  rows.push(await measure('unload, stones, beach (waves)'));
  // Profile the heavy state at ×6.
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await cdp.send('Profiler.start');
  await wait(5000);
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const total = profile.samples.length;
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  for (const id of profile.samples) {
    const n = byId.get(id);
    const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + 1);
  }
  // Who calls the suspects (WDD_WHO=getParameter,setItem): the 4 frames above each sample.
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const who = {};
  for (const name of (process.env.WDD_WHO ?? 'getParameter,setItem,linearRampToValueAtTime').split(',')) {
    const chains = new Map();
    for (const id of profile.samples) {
      const n = byId.get(id);
      if (n.callFrame.functionName !== name) continue;
      const chain = [];
      let p = parent.get(id);
      for (let k = 0; k < 5 && p != null; k++) {
        const pn = byId.get(p);
        chain.push(`${pn.callFrame.functionName || '(anon)'}@${pn.callFrame.url.split('/').pop().split('?')[0]}:${pn.callFrame.lineNumber + 1}`);
        p = parent.get(p);
      }
      const key = chain.join(' < ');
      chains.set(key, (chains.get(key) ?? 0) + 1);
    }
    who[name] = [...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }
  // Inclusive share of the main update / render functions (a sample counts for every function on its stack).
  const incl = new Map();
  for (const id of profile.samples) {
    const seen = new Set();
    let p = id;
    while (p != null) {
      const n = byId.get(p);
      const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop().split('?')[0]}`;
      if (!seen.has(key)) {
        seen.add(key);
        incl.set(key, (incl.get(key) ?? 0) + 1);
      }
      p = parent.get(p);
    }
  }
  const inclusive = [...incl.entries()].filter(([k]) => /^update |^render|^WebGLRenderer.render|updateMatrixWorld chunk/u.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${((100 * v) / total).toFixed(1)}% ${k}`);
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 28).map(([k, v]) => `${((100 * v) / total).toFixed(1)}% ${k}`);
  return { rows, inclusive };
}
