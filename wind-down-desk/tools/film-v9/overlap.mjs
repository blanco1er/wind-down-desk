// 29 Oct (v9 film): measures, in the rendered view, whether the lamp's globe covers the caption's pill, and whether
// the pill is cut by the frame. Installed in the page as window.__v9overlap(); every take samples it ≈ 4×/s and
// writes overlap.json next to its frames (a take with any covered frame is re-shot, never cut around silently).
export async function installOverlap(f) {
  await f.evaluate(() => {
    window.__v9overlap = () => {
      const v = window.__wdd.debug().visuals;
      const cam = v.camera;
      const cap = v.caption;
      const orb = v.orb;
      const glass = orb.getObjectByName('wdd-lamp-globe');
      const V = cap.position.constructor;
      cap.updateWorldMatrix(true, false);
      glass.updateWorldMatrix(true, false);
      const W = window.innerWidth;
      const H = window.innerHeight;
      const px = (p) => ({ x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H, z: p.z });
      const capOn = cap.visible && (v.captionUniforms?.uOpacity?.value ?? 1) > 0.15;
      const b = v.captionCanvas.box;
      const corners = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([fx, fy]) => px(new V((fx - 0.5) * 0.72, (0.5 - fy) * 0.18, 0).applyMatrix4(cap.matrixWorld).project(cam)));
      const pill = { x0: Math.min(...corners.map((c) => c.x)), x1: Math.max(...corners.map((c) => c.x)), y0: Math.min(...corners.map((c) => c.y)), y1: Math.max(...corners.map((c) => c.y)) };
      const c = new V();
      glass.getWorldPosition(c);
      const s = new V();
      glass.getWorldScale(s);
      const rWorld = (glass.geometry.boundingSphere?.radius ?? 0.025) * s.x;
      const centre = px(c.clone().project(cam));
      // Screen radius: project a point rWorld to the camera's right.
      const right = new V(1, 0, 0).applyQuaternion(cam.getWorldQuaternion(cam.quaternion.clone()));
      const edge = px(c.clone().addScaledVector(right, rWorld).project(cam));
      const r = Math.hypot(edge.x - centre.x, edge.y - centre.y);
      // Circle vs rectangle.
      const qx = Math.max(pill.x0, Math.min(centre.x, pill.x1));
      const qy = Math.max(pill.y0, Math.min(centre.y, pill.y1));
      const covered = capOn && glass.visible && centre.z < 1 && Math.hypot(qx - centre.x, qy - centre.y) < r * 0.98;
      const cut = capOn && (pill.x0 < 0 || pill.y0 < 0 || pill.x1 > W || pill.y1 > H);
      return { covered, cut, capOn, text: v.captionCanvas.last ?? null, pill: { x0: Math.round(pill.x0), x1: Math.round(pill.x1), y0: Math.round(pill.y0), y1: Math.round(pill.y1) }, globe: { x: Math.round(centre.x), y: Math.round(centre.y), r: Math.round(r) } };
    };
  });
}
