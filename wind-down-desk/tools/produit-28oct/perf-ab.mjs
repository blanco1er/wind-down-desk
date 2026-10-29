// 28 Oct: interleaved A/B of this pass's per-frame additions (the bead's rail with fingertips read every frame, the
// mix rails) in the same state, CPU ×6, ON/OFF alternated N times so the Mac's load hits both alike.
//   npx @iwsdk/cli browser run tools/produit-28oct/perf-ab.mjs --timeout 108000
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const rounds = Number(process.env.ROUNDS ?? 4);
  const windowMs = Number(process.env.WDD_WINDOW_MS ?? 4000);
  cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 30, maxWidth: 320, maxHeight: 180, everyNthFrame: 4 });
  const ev = (body) => f.evaluate(new Function(`return (async () => { const d = window.__wdd; const w = (ms) => new Promise((r) => setTimeout(r, ms)); ${body} })()`));
  await ev(`d.askTension('in'); d.mix('open'); await w(2500);`);
  // A fingertip resting on the rail (the heaviest case: joints read and the bead driven every frame).
  await ev(`const u = d.railWorld(0.5); const h = window.IWER_DEVICE.hands.right; h.poseId = 'point'; for (let k = 0; k < 6; k++) { const t = d.tips().right; if (t) h.position.set(h.position.x + u.x - t.x, h.position.y + u.y + 0.004 - t.y, h.position.z + u.z - t.z); await w(120); }`);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const out = { on: [], off: [] };
  for (let i = 0; i < rounds; i++) {
    for (const off of i % 2 === 0 ? [false, true] : [true, false]) {
      await ev(`d.abProduct(${off});`);
      await wait(500);
      await ev('d.perfReset();');
      await wait(windowMs);
      const p = await ev('return d.perf();');
      out[off ? 'off' : 'on'].push({ p50: p.cpuMs.p50, p95: p.cpuMs.p95, n: p.samples });
    }
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await ev(`d.abProduct(false); d.tension('skip'); d.mix('close'); window.IWER_DEVICE.hands.right.poseId = 'default';`);
  await cdp.send('Page.stopScreencast');
  const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return { rounds, on: { p50: med(out.on.map((x) => x.p50)), p95: med(out.on.map((x) => x.p95)) }, off: { p50: med(out.off.map((x) => x.p50)), p95: med(out.off.map((x) => x.p95)) }, raw: out };
}
