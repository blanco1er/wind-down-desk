// Which objects are actually drawn in one frame (each object's onBeforeRender, called once per draw and per eye):
// layers and frustum culling included, unlike draw-list. Path = parent names, to find where each draw comes from.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  await f.evaluate(() => {
    let scene = window.__wdd.debug().visuals.root;
    while (scene.parent) scene = scene.parent;
    const hits = new Map();
    const undo = [];
    scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
      const prev = o.onBeforeRender;
      const path = [];
      for (let p = o; p != null && path.length < 4; p = p.parent) path.push(p.name || p.type);
      const key = `${path.join(' < ')} [${o.geometry?.type} v${o.geometry?.attributes?.position?.count ?? 0}] ro=${o.renderOrder} #${o.id} parent#${o.parent?.id}`;
      o.onBeforeRender = function (...a) {
        if (window.__drawWhoOn) hits.set(key, (hits.get(key) ?? 0) + 1);
        return prev.apply(this, a);
      };
      undo.push(() => { o.onBeforeRender = prev; });
    });
    window.__drawWho = { hits, undo };
  });
  await wait(300);
  await f.evaluate(() => { window.__drawWhoOn = true; });
  await new Promise((r) => setTimeout(r, 1000));
  return f.evaluate(() => {
    window.__drawWhoOn = false;
    const { hits, undo } = window.__drawWho;
    undo.forEach((u) => u());
    const max = Math.max(...hits.values());
    const items = [...hits.entries()].map(([k, n]) => `${(n / max).toFixed(2)}× ${k}`).sort();
    return { perEye: +[...hits.values()].reduce((a, n) => a + n / max, 0).toFixed(1), items };
  });
}
