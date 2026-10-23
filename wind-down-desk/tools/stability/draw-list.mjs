// Which meshes are drawn right now (visible chain, material opacity if any): to find where draw calls go.
//   WDD_GLOBE=1 opens Places in the globe first.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  if (process.env.WDD_GLOBE === '1') {
    await f.evaluate(() => window.__wdd.globe('open'));
    await wait(2500);
  }
  return f.evaluate(() => {
    const v = window.__wdd.debug().visuals;
    let scene = v.root;
    while (scene.parent) scene = scene.parent;
    const out = [];
    scene.traverseVisible((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine) return;
      const m = o.material;
      const op = m?.uniforms?.uOpacity?.value;
      out.push(`${o.name || o.geometry?.type || 'mesh'}${op != null ? ` op=${(+op).toFixed(2)}` : ''} ro=${o.renderOrder}`);
    });
    return { count: out.length, items: out };
  });
}
