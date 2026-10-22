// GPU memory of the app's own textures (film set excluded): sums every texture bound to a material uniform in the
// scene, RGBA8 = 4 B/px (× 4/3 with mipmaps), compressed = the bytes of all mip levels. Also: draw calls, triangles.
export default async function run({ frame, page }) {
  const f = frame ?? page;
  return await f.evaluate(async () => {
    const d = window.__wdd.debug();
    const root = d.visuals.root;
    let scene = root;
    while (scene.parent) scene = scene.parent;
    const seen = new Set();
    const rows = [];
    let total = 0;
    scene.traverse((o) => {
      const m = o.material;
      if (!m || !m.uniforms) return;
      if (o.name && /film/i.test(o.name)) return;
      for (const [k, u] of Object.entries(m.uniforms)) {
        const t = u && u.value;
        if (!t || !t.isTexture || seen.has(t)) continue;
        seen.add(t);
        const img = t.image;
        let bytes = 0;
        if (t.isCompressedTexture) bytes = (t.mipmaps || []).reduce((n, l) => n + l.data.byteLength, 0);
        else if (img && img.width) bytes = img.width * img.height * 4 * (t.generateMipmaps ? 4 / 3 : 1);
        total += bytes;
        rows.push([k, img?.width ?? (t.mipmaps?.[0]?.width ?? 0), img?.height ?? (t.mipmaps?.[0]?.height ?? 0), Math.round(bytes / 1024)]);
      }
    });
    rows.sort((a, b) => b[3] - a[3]);
    return { totalMB: Math.round((total / 1048576) * 100) / 100, oakKB: Math.round(d.visuals.oakBytes / 1024), top: rows };
  });
}
