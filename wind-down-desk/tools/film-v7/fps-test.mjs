// Measures the CDP screencast rate at the current viewport (4K test).
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  let n = 0, bytes = 0;
  cdp.on('Page.screencastFrame', async (e) => { n++; bytes += e.data.length * 0.75; try { await cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }); } catch {} });
  const q = Number(process.env.Q ?? 90);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: q, maxWidth: 3840, maxHeight: 2160, everyNthFrame: 1 });
  const raf = await f.evaluate(() => new Promise((r) => { let k = 0; const t0 = performance.now(); const tick = () => { k++; if (performance.now() - t0 < 5000) requestAnimationFrame(tick); else r(k / 5); }; requestAnimationFrame(tick); }));
  await cdp.send('Page.stopScreencast');
  return { fps: n / 5, rafFps: raf, mbPerFrame: bytes / Math.max(1, n) / 1e6 };
}
