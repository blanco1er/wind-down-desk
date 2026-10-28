// 28 Oct fix check (Breathe): with the moon at its fullest (inhaled radius), are "Longer" / "Enough" visible and
// reachable from the seat? Head height = stage.sh's seated height + DY metres (env, default 0). Desk-local maths:
//   - occluded: share of each button (5 × 3 sample points) hidden behind the moon sphere, from the eye;
//   - hidesMoon / hidesTray: share of each button standing in front of the moon / of the tray top;
//   - sizeCm (≥ 4.4), angles from the gaze to the tray centre (within ±37°), reach from the shoulder (≤ 60 cm,
//     same shoulder as tools/onboarding/reach-fov.mjs: 25 cm under the eyes, 5 cm back).
// Starts Breathe if it is not running (START=1 forces a fresh start). Run after `sh tools/stage.sh 54 30`.
//   DY=-0.1 npx @iwsdk/cli browser run tools/fixes-28oct/breathe-check.mjs
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const dy = Number(process.env.DY ?? 0);
  const start = process.env.START === '1';
  const mode = await f.evaluate(() => window.__wdd.evening().mode);
  if (start || mode !== 'breathe') {
    await f.evaluate(() => window.__wdd.ritual('breathe'));
    await wait(8000);
  }
  await f.evaluate((d) => {
    const dev = window.IWER_DEVICE;
    window.__fixBaseY ??= dev.position.y;
    dev.position.y = window.__fixBaseY + d;
  }, dy);
  await wait(1200);
  return await f.evaluate(() => {
    const v = window.__wdd.debug().visuals;
    const head = window.IWER_DEVICE.position;
    const root = v.root;
    root.updateMatrixWorld(true);
    const V = v.orb.position.constructor;
    const toLocal = (p) => root.worldToLocal(new V(p.x, p.y, p.z));
    const eye = toLocal(head);
    const scale = new V();
    root.getWorldScale(scale);
    // Moon at its fullest (ritual-system updateBreathe: inhaled radius 11.8 cm, resting on its cup rim).
    const R = 0.118;
    const foot = 2.4;
    const rim = 0.025 * 0.72 * foot;
    const top = (0.016 - 0.0006) * foot;
    const C = new V(0, top + 0.95 * Math.sqrt(R * R - rim * rim), -0.02);
    const layout = window.__wdd.state().layout ?? { width: 0.84, depth: 0.44 };
    const W = layout.width ?? 0.84;
    const D = layout.depth ?? 0.44;
    // Ray eye + t·(p − eye) against the sphere: smallest t > 0.001, or Infinity.
    const hitSphere = (p) => {
      const d = p.clone().sub(eye);
      const o = eye.clone().sub(C);
      const a = d.dot(d), b = 2 * o.dot(d), c = o.dot(o) - R * R;
      const disc = b * b - 4 * a * c;
      if (disc < 0) return Infinity;
      const t0 = (-b - Math.sqrt(disc)) / (2 * a);
      return t0 > 0.001 ? t0 : Infinity;
    };
    const hitsTray = (p) => {
      const d = p.clone().sub(eye);
      if (d.y >= 0) return false;
      const t = (0.012 - eye.y) / d.y;
      if (t <= 1) return false;
      const q = eye.clone().addScaledVector(d, t);
      return Math.abs(q.x) <= W / 2 && Math.abs(q.z) <= D / 2;
    };
    // Gaze to the tray centre (world), shoulder (world), as in reach-fov.mjs.
    const centre = window.__wdd.deskPoint(0, 0, 0);
    const fwd = { x: centre.x - head.x, z: centre.z - head.z };
    const fl = Math.hypot(fwd.x, fwd.z);
    fwd.x /= fl; fwd.z /= fl;
    const pitch0 = Math.atan2(centre.y - head.y, Math.hypot(centre.x - head.x, centre.z - head.z));
    const shoulder = { x: head.x - fwd.x * 0.05, y: head.y - 0.25, z: head.z - fwd.z * 0.05 };
    const out = { eyeAboveTrayCm: Math.round(eye.y * 1000) / 10, moonScale: Math.round(v.orbScale * 100) / 100, rootScale: Math.round(scale.x * 1000) / 1000, chips: [] };
    for (const [name, m, label] of [['keep', v.keepChip, 0], ['lighter', v.lighterChip, 1]]) {
      if (!m.visible) { out.chips.push({ name, visible: false }); continue; }
      m.updateWorldMatrix(true, false);
      if (m.geometry.boundingBox == null) m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox;
      let n = 0, occl = 0, frontMoon = 0, frontTray = 0;
      let hMin = 1e9, hMax = -1e9, vMin = 1e9, vMax = -1e9;
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 2; j++) {
        const pw = m.localToWorld(new V(b.min.x + ((b.max.x - b.min.x) * i) / 4, b.min.y + ((b.max.y - b.min.y) * j) / 2, 0));
        const p = toLocal(pw);
        n++;
        const t = hitSphere(p);
        if (t < 1) occl++;
        else if (t < Infinity) frontMoon++;
        if (hitsTray(p)) frontTray++;
        if ((i === 0 || i === 4) && (j === 0 || j === 2)) {
          const dx = pw.x - head.x, dyy = pw.y - head.y, dz = pw.z - head.z;
          const along = dx * fwd.x + dz * fwd.z;
          const side = dx * -fwd.z + dz * fwd.x;
          const h = (Math.atan2(side, along) * 180) / Math.PI;
          const vv = ((Math.atan2(dyy, Math.hypot(dx, dz)) - pitch0) * 180) / Math.PI;
          hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); vMin = Math.min(vMin, vv); vMax = Math.max(vMax, vv);
        }
      }
      const s = new V();
      m.getWorldScale(s);
      const c = m.getWorldPosition(new V());
      const reach = Math.hypot(c.x - shoulder.x, c.y - shoulder.y, c.z - shoulder.z);
      const op = m.material?.uniforms?.uOpacity?.value ?? 1;
      out.chips.push({
        name,
        visible: true,
        opacity: Math.round(op * 100) / 100,
        sizeCm: [Math.round((b.max.x - b.min.x) * s.x * 1000) / 10, Math.round((b.max.y - b.min.y) * s.y * 1000) / 10],
        occluded: occl / n,
        hidesMoon: frontMoon / n,
        hidesTray: frontTray / n,
        h: [+hMin.toFixed(1), +hMax.toFixed(1)],
        v: [+vMin.toFixed(1), +vMax.toFixed(1)],
        reachCm: Math.round(reach * 100),
        local: [+toLocal(c).x.toFixed(3), +toLocal(c).y.toFixed(3), +toLocal(c).z.toFixed(3)],
      });
    }
    return out;
  });
}
