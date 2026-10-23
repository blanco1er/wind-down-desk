// Airplane-seat test + field-of-view check (23 Oct). From the seated head looking at the tray centre, for every
// panel and touch target: horizontal / vertical angle of its corners (must fit the Quest 3S view, ≈ 96° × 90°, and
// ideally the comfortable ±30° / ±25°), and distance from the shoulder (touch targets ≤ 60 cm).
// Opens the Places grid and the ritual menu to measure them too.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default async function run({ frame, page, cdp }) {
  const f = frame ?? page;
  cdp.on('Page.screencastFrame', (e) => void cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}));
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 40, maxWidth: 320, maxHeight: 180 });
  const measure = () =>
    f.evaluate(() => {
      const v = window.__wdd.debug().visuals;
      const head = window.IWER_DEVICE.position;
      const centre = window.__wdd.deskPoint(0, 0, 0);
      const fwd = { x: centre.x - head.x, z: centre.z - head.z };
      const fl = Math.hypot(fwd.x, fwd.z);
      fwd.x /= fl;
      fwd.z /= fl;
      // Look-down pitch toward the tray centre (the natural seated gaze).
      const pitch0 = Math.atan2(centre.y - head.y, Math.hypot(centre.x - head.x, centre.z - head.z));
      const shoulder = { x: head.x - fwd.x * 0.05, y: head.y - 0.25, z: head.z - fwd.z * 0.05 };
      const items = [
        ['caption', v.caption, false],
        ['reply Yes', v.keepChip, true],
        ['reply Not now', v.lighterChip, true],
        ['Rituals', v.ritualsOrnament, true],
        ['Places', v.ornament, true],
        ['Sound', v.voiceButton, true],
        ['lamp', v.orb, true],
        ...v.ritualChips.map((c) => [`ritual ${c.id}`, c.mesh, true]),
        ...v.placeChips.map((c) => [`place ${c.id}`, c.mesh, true]),
        ['Move desk here', v.moveChip, true],
        ['Table stays | Full', v.immersionToggle, true],
        ...v.wordChips.slice(0, 4).map((c, i) => [`word ${i}`, c.mesh, true]),
      ];
      const out = [];
      const corner = (m, x, y) => {
        m.updateWorldMatrix(true, false);
        const g = m.geometry;
        if (g.boundingBox == null) g.computeBoundingBox();
        const b = g.boundingBox;
        const p = m.localToWorld(b.min.clone().set(x ? b.max.x : b.min.x, y ? b.max.y : b.min.y, (b.min.z + b.max.z) / 2));
        return p;
      };
      for (const [name, m, touch] of items) {
        if (m == null || !m.visible) continue;
        let hMin = 1e9, hMax = -1e9, vMin = 1e9, vMax = -1e9, reach = 0;
        for (const x of [0, 1]) for (const y of [0, 1]) {
          const p = corner(m, x, y);
          const dx = p.x - head.x, dy = p.y - head.y, dz = p.z - head.z;
          const along = dx * fwd.x + dz * fwd.z;
          const side = dx * -fwd.z + dz * fwd.x;
          const h = (Math.atan2(side, along) * 180) / Math.PI;
          const vv = ((Math.atan2(dy, Math.hypot(dx, dz)) - pitch0) * 180) / Math.PI;
          hMin = Math.min(hMin, h); hMax = Math.max(hMax, h); vMin = Math.min(vMin, vv); vMax = Math.max(vMax, vv);
        }
        const c = m.getWorldPosition(m.position.clone());
        reach = Math.hypot(c.x - shoulder.x, c.y - shoulder.y, c.z - shoulder.z);
        out.push({ name, touch, h: [+hMin.toFixed(1), +hMax.toFixed(1)], v: [+vMin.toFixed(1), +vMax.toFixed(1)], reachCm: Math.round(reach * 100) });
      }
      return out;
    });
  const all = [];
  all.push(...(await measure()));
  await f.evaluate(() => window.__wdd.press('places'));
  await wait(1500);
  all.push(...(await measure()).filter((r) => r.name.startsWith('place') || r.name.startsWith('Move') || r.name.startsWith('Table')));
  await f.evaluate(() => window.__wdd.debug().visuals.openPlaces(false));
  await f.evaluate(() => window.__wdd.press('rituals'));
  await wait(1500);
  all.push(...(await measure()).filter((r) => r.name.startsWith('ritual')));
  await f.evaluate(() => window.__wdd.press('rituals'));
  await cdp.send('Page.stopScreencast');
  const seen = new Set();
  return all.filter((r) => (seen.has(r.name) ? false : seen.add(r.name)));
}
