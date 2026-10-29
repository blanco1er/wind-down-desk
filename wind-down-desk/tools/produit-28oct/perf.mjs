// 28 Oct (product pass): CPU per frame (update + render submit, P95) and draw calls per eye in the heaviest new
// moments, CPU throttled ×1 and ×6 (DevTools). Note `uptime` with each run: other agents load this Mac.
//   sh tools/stage.sh 54 30 && npx @iwsdk/cli browser run tools/produit-28oct/perf.mjs --timeout 108000
// STATES (env, comma list): menu, rail, squeeze, keep, night, mix.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const windowMs = Number(process.env.WDD_WINDOW_MS ?? 4500);
  const rates = JSON.parse(process.env.WDD_RATES ?? '[1,6]');
  const states = (process.env.STATES ?? 'menu,rail,squeeze,keep,night,mix').split(',');
  // The render loop runs while a screencast is active (small frames: little cost).
  cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 30, maxWidth: 320, maxHeight: 180, everyNthFrame: 4 });
  const ev = (body) => f.evaluate(new Function(`return (async () => { const d = window.__wdd; const w = (ms) => new Promise((r) => setTimeout(r, ms)); ${body} })()`));
  const measure = async (label) => {
    const out = [];
    for (const rate of rates) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await wait(700);
      await ev('d.perfReset();');
      await wait(windowMs);
      const p = await ev('return d.perf();');
      out.push({ state: label, cpu: rate, cpuP50: p.cpuMs.p50, cpuP95: p.cpuMs.p95, frameP95: p.frameMs.p95, drawsPerEyeP50: p.drawCalls.p50 / 2, drawsPerEyeMax: p.drawCalls.max / 2, trianglesMax: p.triangles.max, samples: p.samples, xr: p.xr });
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    return out;
  };
  const results = [];
  for (const s of states) {
    if (s === 'menu') await ev(`d.press('rituals'); await w(1800);`);
    if (s === 'rail') await ev(`d.press('rituals'); await w(300); d.askTension('in'); await w(2500);`);
    if (s === 'squeeze') await ev(`d.tension('skip'); d.ritual('squeeze'); await w(6500); const h = window.IWER_DEVICE.hands; h.left.poseId = 'point'; h.right.poseId = 'point'; await w(800);`);
    if (s === 'keep') await ev(`d.ritual('keep'); await w(1500); d.keep('A good meal'); d.keep('Rest'); d.keep('A laugh'); await w(1500);`);
    if (s === 'night') await ev(`const h = window.IWER_DEVICE.hands; h.left.poseId = 'default'; h.right.poseId = 'default'; d.say('good night'); await w(1500); d.tension('skip'); await w(4000);`);
    if (s === 'mix') await ev(`d.mix('open'); d.press('rituals'); await w(2000);`);
    results.push(...(await measure(s)));
  }
  await cdp.send('Page.stopScreencast');
  return results;
}
