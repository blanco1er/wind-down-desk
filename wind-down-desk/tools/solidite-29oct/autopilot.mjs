// 29 Oct (solidity) — memory without instrumentation. MODE (one browser run each, so few injected contexts):
//   install  GC, read the heap, then install an in-page autopilot: at each XR entry it plays one evening by itself
//            (press() + emulated pinches, no listener counter, no CDP network) and counts it.
//   keep     keep the headless render loop running (screencast) ~100 s; returns the autopilot's progress.
//   read     GC, read the heap and the autopilot's log.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const mode = process.env.MODE ?? 'keep';
  const heap = async () => {
    await cdp.send('HeapProfiler.enable').catch(() => {});
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    await wait(800);
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    return f.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(2));
  };
  if (mode === 'install') {
    const before = await heap();
    await f.evaluate(() => {
      if (window.__autopilot) return;
      const ap = { done: 0, running: false, log: [], day: 300 };
      window.__autopilot = ap;
      const d = () => window.__wdd;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (fn()) return true; } catch {} await sleep(150); } return false; };
      const hand = (p, pinch) => { const h = window.IWER_DEVICE.hands.right; if (p) h.position.set(p.x, p.y, p.z); if (pinch != null) h.updatePinchValue(pinch); };
      const grab = async (id, bin) => {
        const s = d().stoneWorld(id); const e = d().binWorld(bin);
        if (!s || !e) return false;
        hand({ x: s.x, y: s.y + 0.05, z: s.z }, 0); await sleep(250);
        hand({ x: s.x, y: s.y + 0.01, z: s.z }, 0); await sleep(200);
        hand(null, 1); await sleep(300);
        for (let i = 1; i <= 16; i++) { const k = i / 16; hand({ x: s.x + (e.x - s.x) * k, y: s.y + 0.01 + (e.y + 0.03 - s.y) * k + Math.sin(Math.PI * k) * 0.08, z: s.z + (e.z - s.z) * k }); await sleep(45); }
        hand({ x: e.x, y: e.y + 0.03, z: e.z }, 0); await sleep(500);
        hand(d().deskPoint(0.34, -0.1, 0.44), 0); await sleep(200);
        return true;
      };
      const menu = async (id) => { if (!d().debug().visuals.ritualMenuOpen) { d().press('rituals'); await sleep(1000); } d().press(`ritual:${id}`); await sleep(1200); };
      const word = (re) => d().debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label && re.test(c.label));
      const evening = async () => {
        const t0 = Date.now();
        window.IWER_DEVICE.primaryInputMode = 'hand';
        await until(() => ['table', 'floating'].includes(d().state().placement), 12000);
        d().recenter(true);
        await sleep(3500);
        if (d().tension().side != null) { d().press('keep'); await sleep(900); }
        await menu('unload');
        let stones = 0;
        for (const bin of ['tomorrow', 'later']) {
          let id = d().state().tokens.find((t) => t.bin == null && !t.released)?.id;
          if (!id) { await until(() => word(/^(?!Write|That)/u) >= 0, 8000); const used = d().state().tokens.map((t) => t.text); const i = d().debug().visuals.wordChips.findIndex((c) => c.mesh.visible && c.label && !/Write|That/u.test(c.label) && !used.includes(c.label)); d().press(`word:${i}`); await until(() => d().state().tokens.some((t) => t.bin == null && !t.released), 6000); await sleep(900); id = d().state().tokens.find((t) => t.bin == null && !t.released)?.id; }
          if (id && (await grab(id, bin))) stones++;
          await sleep(900);
        }
        await until(() => word(/^That/u) >= 0, 10000); d().press(`word:${word(/^That/u)}`); await sleep(1500);
        if (await until(() => d().state().phase === 'plan' && d().debug().visuals.card.visible, 6000)) { await sleep(600); d().press('keep'); }
        await until(() => d().evening().mode === 'choose', 10000);
        await menu('breathe'); await sleep(8000); d().press('lighter'); await until(() => d().evening().mode === 'choose', 10000);
        await menu('keep'); await sleep(1200);
        for (let k = 0; k < 3; k++) { const i = word(/^(?!Write)/u); if (i >= 0) d().press(`word:${i}`); await sleep(1200); }
        await until(() => d().evening().mode === 'choose', 15000);
        await menu('sleep');
        if (await until(() => d().tension().side === 'out', 4000)) { await sleep(700); d().press('keep'); }
        await until(() => d().night().step === 2, 22000); await sleep(800);
        d().press('keep'); await sleep(1000);
        const m = word(/^10 min$/u); if (m >= 0) d().press(`word:${m}`); await sleep(800);
        d().sleepSkip(300); await sleep(1500);
        d().press('keep');
        const ended = await until(() => !d().perf().xr, 20000);
        ap.day++; d().film.day(ap.day);
        ap.done++;
        ap.log.push({ evening: ap.done, seconds: Math.round((Date.now() - t0) / 1000), stones, ended, active: d().state().tokens.filter((t) => !t.released).length });
      };
      setInterval(() => { try { if (!ap.running && d().perf().xr && ap.done < (ap.target ?? Number(window.__autopilotTarget ?? 4))) { ap.running = true; evening().catch((e) => ap.log.push({ error: String(e) })).finally(() => { ap.running = false; }); } } catch {} }, 1000);
    });
    return { heapBeforeMB: before };
  }
  if (mode === 'read') return { heapAfterMB: await heap(), autopilot: await f.evaluate(() => ({ done: window.__autopilot?.done, log: window.__autopilot?.log })) };
  cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 20, maxWidth: 320, maxHeight: 180, everyNthFrame: 3 });
  const end = Date.now() + Number(process.env.KEEP_MS ?? 100000);
  while (Date.now() < end) {
    await wait(2000);
    const st = await f.evaluate(() => ({ xr: window.__wdd.perf().xr, done: window.__autopilot.done, running: window.__autopilot.running }));
    if (!st.xr && !st.running) break; // the evening ended: the shell enters XR again
  }
  await cdp.send('Page.stopScreencast').catch(() => {});
  const st = await f.evaluate(() => ({ xr: window.__wdd.perf().xr, done: window.__autopilot.done, running: window.__autopilot.running }));
  return { ...st, heapMB: !st.xr && !st.running ? await heap() : null };
}
