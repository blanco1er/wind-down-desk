// 29 Oct (solidity): CPU per frame (update + render submit) P50 / P95, frame time P95, draw calls per eye and
// triangles in the key moments, the emulator's film set HIDDEN (not on a headset), CPU throttled ×4 and ×6
// (DevTools). Only meaningful on a quiet Mac: the runner (perf.sh) refuses to measure while `uptime` > 3.
//   STATES=arrival,unload,place,breathe  or  squeeze,keep,journal,night   (two runs: 108 s cap per script)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const windowMs = Number(process.env.WDD_WINDOW_MS ?? 4000);
  const rates = JSON.parse(process.env.WDD_RATES ?? '[4,6]');
  const states = (process.env.STATES ?? 'arrival,unload,place,breathe').split(',');
  cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 30, maxWidth: 320, maxHeight: 180, everyNthFrame: 4 });
  const ev = (body) => f.evaluate(new Function(`return (async () => { const d = window.__wdd; const w = (ms) => new Promise((r) => setTimeout(r, ms)); ${body} })()`));
  await ev(`d.film?.hide(true); window.IWER_DEVICE.primaryInputMode = 'hand';`);
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
    if (s === 'arrival') await ev(`d.askTension('in'); await w(2500);`);
    if (s === 'unload') await ev(`d.tension('skip'); d.ritual('unload'); await w(1500); d.micState('denied'); await w(400); const i = d.debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label === 'Work'); if (i >= 0) d.press('word:' + i); await w(1500); const t = d.state().tokens.find((x) => x.bin == null); if (t) d.say('Work, tomorrow'); await w(2500);`);
    if (s === 'place') await ev(`d.place('rain-veranda'); await w(6000);`);
    if (s === 'breathe') await ev(`d.ritual('breathe'); await w(6000);`);
    if (s === 'squeeze') await ev(`d.place('room'); d.ritual('squeeze'); await w(5000); const h = window.IWER_DEVICE.hands; const l = d.deskPoint(-0.12, 0.13, 0.2), r = d.deskPoint(0.12, 0.13, 0.2); h.left.position.set(l.x, l.y, l.z); h.right.position.set(r.x, r.y, r.z); h.left.poseId = 'point'; h.right.poseId = 'point'; await w(1500);`);
    if (s === 'keep') await ev(`const h = window.IWER_DEVICE.hands; h.left.poseId = 'default'; h.right.poseId = 'default'; d.ritual('keep'); await w(1500); d.keep('A good meal'); await w(400); d.keep('Rest'); await w(400); d.keep('A laugh'); await w(4000);`);
    if (s === 'journal') await ev(`d.journal('open'); await w(2500);`);
    if (s === 'night') await ev(`d.journal('close'); await w(800); d.night('good night'); await w(1500); if (d.tension().side === 'out') d.tension('skip'); await w(14000); d.night('stay'); await w(1500); d.sleepSkip(200); await w(1500);`);
    results.push(...(await measure(s)));
  }
  await ev(`d.film?.hide(false);`);
  await cdp.send('Page.stopScreencast');
  return results;
}
