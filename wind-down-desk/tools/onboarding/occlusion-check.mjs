// "No panel ever hides the tray, a bowl or a stone; the caption is never cut" (24 Oct, coordinator review).
// For seated eye heights 0.40 / 0.48 / 0.56 m above the table, in angle space from the head: the rectangle of every
// visible panel (caption, words, replies) against the bowls (rim sampled), the tray's inner floor and every stone.
// Caption window: the judge-camera recording (pitch −27°, vertical FoV 58° → −56°…+2°) and Quest (gaze ±45°).
// Run after the scenario has placed the desk; WDD_PHASE names the moment in the report.
import { writeFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  const phase = process.env.WDD_PHASE ?? 'now';
  const out = process.env.WDD_SHOTS ?? 'artifacts/onboarding/occlusion';
  const rows = [];
  for (const h of [0.4, 0.48, 0.56]) {
    await f.evaluate((hh) => {
      const d = window.IWER_DEVICE;
      const fr = window.__wdd.state().frame;
      d.position.y = fr.y + hh;
      const yaw = Math.PI / 2, pitch = (-27 * Math.PI) / 180;
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      d.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
    }, h);
    await wait(900);
    const r = await f.evaluate(() => {
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
      const rect = (pts) => {
        const a = pts.map(ang);
        return { h0: Math.min(...a.map((q) => q.h)), h1: Math.max(...a.map((q) => q.h)), v0: Math.min(...a.map((q) => q.v)), v1: Math.max(...a.map((q) => q.v)) };
      };
      const visible = (m) => { for (let o = m; o; o = o.parent) if (!o.visible) return false; return true; };
      const quad = (m) => {
        m.updateWorldMatrix(true, false);
        const g = m.geometry;
        if (g.boundingBox == null) g.computeBoundingBox();
        const b = g.boundingBox;
        const pts = [];
        for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) pts.push(m.localToWorld(m.position.clone().set(x, y, 0)));
        return rect(pts);
      };
      const panels = [];
      if (visible(v.caption) && v.captionUniforms.uOpacity.value > 0.05) panels.push(['caption', quad(v.caption)]);
      v.wordChips.forEach((c, i) => visible(c.mesh) && c.uniforms.uOpacity.value > 0.05 && panels.push([`word ${c.label ?? i}`, quad(c.mesh)]));
      if (visible(v.keepChip)) panels.push(['reply 1', quad(v.keepChip)]);
      if (visible(v.lighterChip)) panels.push(['reply 2', quad(v.lighterChip)]);
      const obstacles = [];
      for (const b of ['tomorrow', 'later', 'let-go']) {
        const c = window.__wdd.binWorld(b);
        const pts = [];
        const fr = window.__wdd.state().frame;
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          for (const y of [0.0, 0.058]) {
            const lx = Math.cos(a) * 0.1, lz = Math.sin(a) * 0.1;
            const cs = Math.cos(fr.yaw), sn = Math.sin(fr.yaw);
            pts.push({ x: c.x + lx * cs + lz * sn, y: fr.y + y, z: c.z - lx * sn + lz * cs });
          }
        }
        obstacles.push([`bowl ${b}`, rect(pts)]);
      }
      obstacles.push(['tray floor', rect([[-0.38, -0.19], [0.38, -0.19], [-0.38, 0.19], [0.38, 0.19]].map(([x, z]) => window.__wdd.deskPoint(x, 0.02, z)))]);
      for (const t of window.__wdd.state().tokens) {
        const p = window.__wdd.stoneWorld(t.id);
        if (p == null || t.bin != null) continue;
        obstacles.push([`stone ${t.text}`, rect([{ x: p.x - 0.05, y: p.y, z: p.z - 0.05 }, { x: p.x + 0.05, y: p.y + 0.02, z: p.z + 0.05 }, { x: p.x - 0.05, y: p.y, z: p.z + 0.05 }, { x: p.x + 0.05, y: p.y, z: p.z - 0.05 }])]);
      }
      const hits = [];
      for (const [pn, pr] of panels) for (const [on, or] of obstacles) {
        const dh = Math.min(pr.h1, or.h1) - Math.max(pr.h0, or.h0);
        const dv = Math.min(pr.v1, or.v1) - Math.max(pr.v0, or.v0);
        // The tray floor is a wide rectangle: only a panel reaching down into it counts.
        if (dh > 0.3 && dv > 0.3) hits.push(`${pn} over ${on} (${dv.toFixed(1)}°)`);
      }
      const cap = panels.find((p) => p[0] === 'caption')?.[1] ?? null;
      // The caption never overlaps the words it introduces.
      for (const [pn, pr] of panels) {
        if (cap == null || pn === 'caption') continue;
        const dh = Math.min(pr.h1, cap.h1) - Math.max(pr.h0, cap.h0);
        const dv = Math.min(pr.v1, cap.v1) - Math.max(pr.v0, cap.v0);
        if (dh > 0.3 && dv > 0.3) hits.push(`caption over ${pn} (${dv.toFixed(1)}°)`);
      }
      const gaze = ang(centre).v;
      return {
        panels: panels.length,
        hits,
        caption: cap == null ? null : { top: +cap.v1.toFixed(1), bottom: +cap.v0.toFixed(1), inJudgeCamera: cap.v1 <= 2 && cap.v0 >= -56, inQuest: cap.v1 <= gaze + 45 },
        bowlsTop: +Math.max(...obstacles.filter((o) => o[0].startsWith('bowl')).map((o) => o[1].v1)).toFixed(1),
      };
    });
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    writeFileSync(`${out}/${phase}-eye${Math.round(h * 100)}.jpg`, Buffer.from(shot.data, 'base64'));
    rows.push({ eye: h, ...r });
  }
  return { phase, rows };
}
