// 29 Oct (finishing pass): draw calls per eye, triangles and CPU per frame (update + render submit) in the moments
// this pass changed, the emulator's film set HIDDEN (it is not on a headset), CPU throttled ×1 and ×6 (DevTools).
//   sh tools/stage.sh 54 30 && WDD_RATES='[1,6]' npx @iwsdk/cli browser run tools/finition-29oct/perf.mjs --timeout 108000
// Note `uptime` with each run: other agents load this Mac.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const windowMs = Number(process.env.WDD_WINDOW_MS ?? 4000);
  const rates = JSON.parse(process.env.WDD_RATES ?? '[1]');
  const states = (process.env.STATES ?? 'idle,menu,keep,squeeze,journal,night').split(',');
  cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 30, maxWidth: 320, maxHeight: 180, everyNthFrame: 4 });
  const ev = (body) => f.evaluate(new Function(`return (async () => { const d = window.__wdd; const w = (ms) => new Promise((r) => setTimeout(r, ms)); ${body} })()`));
  await ev(`d.film?.hide(true); d.tension('skip'); window.IWER_DEVICE.primaryInputMode = 'hand';`);
  const measure = async (label) => {
    const out = [];
    for (const rate of rates) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await wait(700);
      await ev('d.perfReset();');
      await wait(windowMs);
      const p = await ev('return d.perf();');
      out.push({ state: label, cpu: rate, cpuP50: p.cpuMs.p50, cpuP95: p.cpuMs.p95, drawsPerEyeP50: p.drawCalls.p50 / 2, drawsPerEyeMax: p.drawCalls.max / 2, trianglesMax: p.triangles.max, samples: p.samples });
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    return out;
  };
  const results = [];
  for (const s of states) {
    if (s === 'menu') await ev(`if (!d.debug().visuals.ritualMenuOpen) d.press('rituals'); await w(1800);`);
    if (s === 'keep') await ev(`d.ritual('keep'); await w(1500); d.keep('A good meal'); await w(400); d.keep('Rest'); await w(400); d.keep('A laugh'); await w(4200);`);
    if (s === 'squeeze') await ev(`await w(5000); d.ritual('squeeze'); const h = window.IWER_DEVICE.hands; const l = d.deskPoint(-0.12, 0.13, 0.2), r = d.deskPoint(0.12, 0.13, 0.2); h.left.position.set(l.x, l.y, l.z); h.right.position.set(r.x, r.y, r.z); await w(5600); h.left.poseId = 'point'; h.right.poseId = 'point'; await w(800);`);
    if (s === 'journal') await ev(`const h = window.IWER_DEVICE.hands; h.left.poseId = 'default'; h.right.poseId = 'default'; d.press('rituals'); await w(4000); d.journal('open'); await w(2500);`);
    if (s === 'night') await ev(`d.journal('close'); await w(800); d.say('good night'); await w(1500); if (d.tension().side === 'out') d.tension('skip'); await w(9000);`);
    results.push(...(await measure(s)));
  }
  await cdp.send('Page.stopScreencast');
  return results;
}
