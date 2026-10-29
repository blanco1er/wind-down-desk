// 29 Oct (solidity) — one memory sample of the long session (tools/solidite-29oct/long.sh), after an evening:
// garbage collected first (CDP), then the JS heap, three.js objects on the GPU, draw calls, the net count of event
// listeners added since the start (EventTarget patched by INSTALL=1 at the start), stones and timers.
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  if (process.env.INSTALL === '1') {
    return f.evaluate(() => {
      if (window.__listenCount) return 'already';
      const counts = new Map();
      const refs = new Map();
      const key = (t, type) => `${t?.constructor?.name ?? '?'}:${type}`;
      const seen = new WeakMap();
      const add = EventTarget.prototype.addEventListener;
      const remove = EventTarget.prototype.removeEventListener;
      EventTarget.prototype.addEventListener = function (type, fn, opts) {
        if (fn != null) {
          let set = seen.get(this);
          if (set == null) seen.set(this, (set = new Set()));
          const k = `${type}|${typeof opts === 'object' ? !!opts?.capture : !!opts}`;
          let fns = set[k];
          if (fns == null) fns = set[k] = new WeakSet();
          if (!fns.has(fn)) {
            fns.add(fn);
            counts.set(key(this, type), (counts.get(key(this, type)) ?? 0) + 1);
            const list = refs.get(key(this, type)) ?? [];
            list.push(new WeakRef(this));
            refs.set(key(this, type), list);
          }
        }
        return add.call(this, type, fn, opts);
      };
      EventTarget.prototype.removeEventListener = function (type, fn, opts) {
        const set = seen.get(this);
        const k = `${type}|${typeof opts === 'object' ? !!opts?.capture : !!opts}`;
        if (fn != null && set?.[k]?.has(fn)) {
          set[k].delete(fn);
          counts.set(key(this, type), (counts.get(key(this, type)) ?? 0) - 1);
        }
        return remove.call(this, type, fn, opts);
      };
      let timers = 0;
      const si = window.setInterval;
      const ci = window.clearInterval;
      const live = new Set();
      window.setInterval = function (...a) { const id = si.apply(window, a); live.add(id); return id; };
      window.clearInterval = function (id) { live.delete(id); return ci.call(window, id); };
      window.__listenCount = { counts, refs, live, get timers() { return timers; } };
      return 'installed';
    });
  }
  await cdp.send('HeapProfiler.enable').catch(() => {});
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  return f.evaluate(() => {
    const p = window.__wdd.perf();
    const mem = performance.memory;
    const lc = window.__listenCount;
    const listeners = lc == null ? null : Object.fromEntries([...lc.counts.entries()].filter(([, n]) => n !== 0).sort((a, b) => b[1] - a[1]).slice(0, 12));
    const total = lc == null ? null : [...lc.counts.values()].reduce((a, n) => a + n, 0);
    // Listeners whose target is still alive after the garbage collection (an ended XR session is not).
    const aliveTargets = lc == null ? null : Object.fromEntries([...lc.refs.entries()].map(([k, l]) => [k, new Set(l.map((r) => r.deref()).filter(Boolean)).size]).filter(([k]) => (lc.counts.get(k) ?? 0) !== 0));
    return {
      t: Math.round(performance.now() / 1000),
      heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : null,
      textures: p.textures,
      geometries: p.geometries,
      programs: p.programs,
      placeMiB: +(window.__wdd.placeMemory().bytes / 1048576).toFixed(1),
      stones: window.__wdd.state().tokens.length,
      stonesDrawn: window.__wdd.stoneBatch().stones,
      listenersNet: total,
      listeners,
      aliveTargets,
      intervals: lc?.live.size ?? null,
      streak: window.__wdd.state().streak,
      quality: window.__wdd.quality().level,
    };
  });
}
