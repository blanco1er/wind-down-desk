// Debug: does the page freeze when a stone is grabbed (4K)? Logs long tasks and rAF gaps.
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const shots = process.env.SC === '1';
  if (shots) {
    cdp.on('Page.screencastFrame', async (e) => { try { await cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }); } catch {} });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 3840, maxHeight: 2160 });
  }
  await f.evaluate(() => {
    window.__lt = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ entryTypes: ['longtask'] });
    window.__gaps = []; let last = performance.now();
    const tick = () => { const n = performance.now(); if (n - last > 100) window.__gaps.push([Math.round(last), Math.round(n - last)]); last = n; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  const log = [];
  const L = (m) => log.push(`${((Date.now() - t0) / 1000).toFixed(1)} ${m}`);
  const id = process.env.ID ?? 't4';
  const s = await f.evaluate((i) => window.__wdd.stoneWorld(i), id); L('stone ' + JSON.stringify(s));
  const hand = (p, v) => f.evaluate(([p, v]) => { const h = window.IWER_DEVICE.hands.right; h.position.set(p.x, p.y, p.z); if (v != null) h.updatePinchValue(v); }, [p, v]);
  await hand({ x: s.x, y: s.y + 0.06, z: s.z }, 0); L('above');
  await new Promise((r) => setTimeout(r, 500));
  await hand({ x: s.x, y: s.y + 0.01, z: s.z }, null); L('down');
  await new Promise((r) => setTimeout(r, 300));
  await hand({ x: s.x, y: s.y + 0.01, z: s.z }, 1); L('pinch');
  await new Promise((r) => setTimeout(r, 2000)); L('after');
  const r = await f.evaluate(() => ({ lt: window.__lt, gaps: window.__gaps, grabbed: window.__wdd.state().tokens }));
  if (shots) await cdp.send('Page.stopScreencast');
  return { log, ...r };
}
