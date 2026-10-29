// Interleaved A/B in the same page (28 Oct): CPU (update + render submit) with a named object shown vs hidden,
// alternating windows at CPU ×RATE. WDD_AB='wdd-lamp-globe' (comma list), WDD_RATE=6, WDD_WINDOWS=8, WDD_WINDOW_MS=3000.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const names = (process.env.WDD_AB ?? 'wdd-lamp-globe').split(',');
  const rate = Number(process.env.WDD_RATE ?? 6);
  const n = Number(process.env.WDD_WINDOWS ?? 8);
  const ms = Number(process.env.WDD_WINDOW_MS ?? 3000);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const out = { shown: [], hidden: [] };
  for (let i = 0; i < n; i++) {
    const on = i % 2 === 0;
    await f.evaluate(([names, on]) => names.forEach((x) => window.__wdd.perfShow(x, on)), [names, on]);
    await wait(600);
    await f.evaluate(() => window.__wdd.perfReset());
    await wait(ms);
    const p = await f.evaluate(() => window.__wdd.perf());
    (on ? out.shown : out.hidden).push({ cpuP50: p.cpuMs.p50, cpuP95: p.cpuMs.p95, upd: p.updateMs.p50, rnd: p.renderMs.p50 });
  }
  await f.evaluate((names) => names.forEach((x) => window.__wdd.perfShow(x, true)), names);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const avg = (a, k) => +(a.reduce((s, x) => s + x[k], 0) / a.length).toFixed(2);
  return { names, rate, shown: { p50: avg(out.shown, 'cpuP50'), p95: avg(out.shown, 'cpuP95'), upd: avg(out.shown, 'upd'), rnd: avg(out.shown, 'rnd') }, hidden: { p50: avg(out.hidden, 'cpuP50'), p95: avg(out.hidden, 'cpuP95'), upd: avg(out.hidden, 'upd'), rnd: avg(out.hidden, 'rnd') }, raw: out };
}
