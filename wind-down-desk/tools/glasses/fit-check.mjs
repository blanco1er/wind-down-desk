// "Built for Quest 3/3S, ready for Meta VR Glasses" (24 Oct). Meta VR Glasses: ≈ 70 × 66° field of view (Meta blog,
// Connect 2026); IWER's measured mask: 37° left/right, 25° up, 43° down. Target: everything essential (caption,
// bubbles / words, replies, lamp, bowls, stones, and the open menu) inside ONE window of ±33° × ±31° from a seated
// head, with the head turned to the best framing (the centre of the union). Reports each item's angular box, the
// union, the best gaze pitch, and what falls outside. Eyes at 0.40 / 0.48 / 0.56 m above the table.
export default async function run({ frame, page }) {
  return fit(frame ?? page);
}

export async function fit(f) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const H = 33, V = 31;
  const out = [];
  for (const h of [0.4, 0.48, 0.56]) {
    await f.evaluate((hh) => {
      const d = window.IWER_DEVICE;
      d.position.y = window.__wdd.state().frame.y + hh;
    }, h);
    await wait(700);
    const r = await f.evaluate(([H, V]) => {
      const v = window.__wdd.debug().visuals;
      const head = window.IWER_DEVICE.position;
      const centre = window.__wdd.deskPoint(0, 0, 0);
      const fwd = { x: centre.x - head.x, z: centre.z - head.z };
      const fl = Math.hypot(fwd.x, fwd.z);
      fwd.x /= fl; fwd.z /= fl;
      const ang = (p) => {
        const dx = p.x - head.x, dy = p.y - head.y, dz = p.z - head.z;
        const along = dx * fwd.x + dz * fwd.z, side = dx * -fwd.z + dz * fwd.x;
        return { h: (Math.atan2(side, along) * 180) / Math.PI, v: (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI };
      };
      const box = (pts) => {
        const a = pts.map(ang);
        return [Math.min(...a.map((q) => q.h)), Math.max(...a.map((q) => q.h)), Math.min(...a.map((q) => q.v)), Math.max(...a.map((q) => q.v))];
      };
      const visible = (m) => { for (let o = m; o; o = o.parent) if (!o.visible) return false; return true; };
      const quad = (m) => {
        m.updateWorldMatrix(true, false);
        const g = m.geometry;
        if (g.boundingBox == null) g.computeBoundingBox();
        const b = g.boundingBox;
        const pts = [];
        for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) pts.push(m.localToWorld(m.position.clone().set(x, y, (b.min.z + b.max.z) / 2)));
        return box(pts);
      };
      const items = [];
      const on = (m, u) => visible(m) && (u == null || u.uOpacity.value > 0.05);
      // The caption: the pill actually drawn (the canvas is wider than the pill).
      const pill = (m, bx) => {
        m.updateWorldMatrix(true, false);
        const g = m.geometry;
        if (g.boundingBox == null) g.computeBoundingBox();
        const b = g.boundingBox;
        const X = (t) => b.min.x + (b.max.x - b.min.x) * t;
        const Y = (t) => b.max.y - (b.max.y - b.min.y) * t;
        const pts = [];
        for (const x of [X(bx.x0), X(bx.x1)]) for (const y of [Y(bx.y0), Y(bx.y1)]) pts.push(m.localToWorld(m.position.clone().set(x, y, 0)));
        return box(pts);
      };
      if (on(v.caption, v.captionUniforms)) items.push(['caption', pill(v.caption, v.captionCanvas.box)]);
      v.wordChips.forEach((c) => on(c.mesh, c.uniforms) && c.label != null && items.push([`word ${c.label}`, quad(c.mesh)]));
      if (visible(v.keepChip)) items.push(['reply 1', quad(v.keepChip)]);
      if (visible(v.lighterChip)) items.push(['reply 2', quad(v.lighterChip)]);
      v.ritualChips.forEach((c) => on(c.mesh, c.uniforms) && items.push([`ritual ${c.id}`, quad(c.mesh)]));
      v.placeChips.forEach((c) => on(c.mesh, c.uniforms) && items.push([`place ${c.id}`, quad(c.mesh)]));
      if (v.card.visible) items.push(['card', quad(v.card)]);
      // 26 Oct: the lamp showing the places (the grown globe, ‹ › ×, its title, Move desk).
      (v.globeButtons ?? []).forEach((b) => on(b.mesh, b.uniforms) && items.push([b.action, quad(b.mesh)]));
      if (v.globeLabel != null && on(v.globeLabel, v.globeLabelUniforms)) items.push(['globe title', quad(v.globeLabel)]);
      if (visible(v.moveChip)) items.push(['move desk', quad(v.moveChip)]);
      if (v.orbScale > 1.3) {
        const c = v.orb.getWorldPosition(v.orb.position.clone());
        const r = 0.025 * v.orbScale;
        items.push(['grown globe', box([{ x: c.x - r, y: c.y - r, z: c.z }, { x: c.x + r, y: c.y + r, z: c.z }, { x: c.x, y: c.y, z: c.z - r }, { x: c.x, y: c.y, z: c.z + r }])]);
      }
      items.push(['lamp', box([window.__wdd.deskPoint(0.352 - 0.04, 0.0, 0.035), window.__wdd.deskPoint(0.352 + 0.04, 0.09, 0.035)])]);
      const fr = window.__wdd.state().frame;
      for (const b of ['tomorrow', 'later', 'let-go']) {
        const c = window.__wdd.binWorld(b);
        const pts = [];
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          for (const y of [0, 0.058]) pts.push({ x: c.x + Math.cos(a) * 0.1, y: fr.y + y, z: c.z + Math.sin(a) * 0.1 });
        }
        items.push([`bowl ${b}`, box(pts)]);
      }
      for (const t of window.__wdd.state().tokens) {
        const p = window.__wdd.stoneWorld(t.id);
        if (p != null && t.bin == null) items.push([`stone ${t.text}`, box([{ x: p.x - 0.05, y: p.y, z: p.z - 0.05 }, { x: p.x + 0.05, y: p.y + 0.02, z: p.z + 0.05 }])]);
      }
      const u = [Math.min(...items.map((i) => i[1][0])), Math.max(...items.map((i) => i[1][1])), Math.min(...items.map((i) => i[1][2])), Math.max(...items.map((i) => i[1][3]))];
      const ch = (u[0] + u[1]) / 2, cv = (u[2] + u[3]) / 2;
      const outside = items.filter(([, b]) => b[0] < ch - H || b[1] > ch + H || b[2] < cv - V || b[3] > cv + V).map(([n, b]) => `${n} [${b.map((x) => x.toFixed(0)).join(',')}]`);
      return { union: u.map((x) => +x.toFixed(1)), width: +(u[1] - u[0]).toFixed(1), height: +(u[3] - u[2]).toFixed(1), gaze: { yaw: +ch.toFixed(1), pitch: +cv.toFixed(1) }, fits: u[1] - u[0] <= 2 * H && u[3] - u[2] <= 2 * V, outside, items: items.length };
    }, [H, V]);
    out.push({ eye: h, ...r });
  }
  return out;
}
