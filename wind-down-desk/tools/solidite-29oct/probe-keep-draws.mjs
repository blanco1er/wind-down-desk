// 29 Oct: what draws in Keep after three good things (the perf probe saw 24–26 per eye), film set hidden.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  cdp.on('Page.screencastFrame', (e) => cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 20, maxWidth: 320, maxHeight: 180, everyNthFrame: 3 });
  await f.evaluate(async () => { const d = window.__wdd; const w = (ms) => new Promise((r) => setTimeout(r, ms)); d.film.hide(true); d.tension('skip'); d.ritual('keep'); await w(1500); d.keep('A good meal'); await w(400); d.keep('Rest'); await w(400); d.keep('A laugh'); await w(2500); });
  const sample = async () => f.evaluate(async () => {
    let sc = window.__wdd.debug().visuals.root; while (sc.parent) sc = sc.parent;
    const hits = new Map(); const undo = []; let on = false;
    sc.traverse((o) => { if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return; const prev = o.onBeforeRender; const path = []; for (let q = o; q && path.length < 3; q = q.parent) path.push(q.name || q.type); const key = `${path.join(' < ')} ro=${o.renderOrder} #${o.id}`; o.onBeforeRender = function (...a) { if (on) hits.set(key, (hits.get(key) ?? 0) + 1); return prev.apply(this, a); }; undo.push(() => { o.onBeforeRender = prev; }); });
    await new Promise((r) => setTimeout(r, 200)); on = true; await new Promise((r) => setTimeout(r, 500)); on = false; undo.forEach((u) => u());
    const max = Math.max(...hits.values());
    return { mode: window.__wdd.evening().mode, perEye: +[...hits.values()].reduce((a, n) => a + n / max, 0).toFixed(1), items: [...hits.entries()].map(([k, n]) => `${(n / max).toFixed(2)} ${k}`).sort() };
  });
  const a = await sample();
  await wait(2500);
  const b = await sample();
  await f.evaluate(() => window.__wdd.film.hide(false));
  await cdp.send('Page.stopScreencast');
  return { a, b };
}
