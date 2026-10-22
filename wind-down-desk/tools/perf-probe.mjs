// Performance probe for the running emulator session (npx iwsdk browser run tools/perf-probe.mjs).
// Samples window.__wdd.perf() for WINDOW_MS at several CPU throttling rates (Chrome DevTools Protocol).
// Prerequisite: an active XR session with stones on the desk (see README "Measure").
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const rates = JSON.parse(process.env.WDD_RATES ?? '[1,4,6]');
  const windowMs = Number(process.env.WDD_WINDOW_MS ?? 6000);
  const gpu = await f.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  const results = [];
  for (const rate of rates) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await wait(800);
    await f.evaluate(() => window.__wdd.perfReset());
    // Trigger a "let go" burst mid-window when stones exist, to include the heaviest moment.
    await wait(windowMs / 2);
    await f.evaluate(() => {
      const t = window.__wdd.state().tokens.find((x) => x.bin == null && !x.released);
      if (t) window.__wdd.say(`let go of ${t.text}`);
    });
    await wait(windowMs / 2);
    results.push({ cpuThrottle: rate, ...(await f.evaluate(() => window.__wdd.perf())) });
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return { gpu, userAgent: await f.evaluate(() => navigator.userAgent), results };
}
