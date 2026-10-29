// Hands look (28 Oct): stages one framed moment for a before/after capture of the hands, in an active XR session.
// SCENE = setup | rest | pinch | breathe | full ; VIEW (optional JSON, see tools/film-v7/view.mjs).
//   SCENE=rest npx @iwsdk/cli browser run tools/hands-28oct/scene.mjs
export default async function run({ frame, page }) {
  const f = frame ?? page;
  const scene = process.env.SCENE ?? 'rest';
  return await f.evaluate(async ([scene, custom]) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const d = window.__wdd;
    const dev = window.IWER_DEVICE;
    dev.primaryInputMode = 'hand';
    const hands = dev.hands;
    const setHand = (side, p, pinch, euler) => {
      const h = hands[side];
      h.position.set(p.x, p.y, p.z);
      if (euler) {
        const [x, y, z] = euler.map((a) => (a * Math.PI) / 180);
        // YXZ Euler → quaternion
        const c1 = Math.cos(y / 2), s1 = Math.sin(y / 2), c2 = Math.cos(x / 2), s2 = Math.sin(x / 2), c3 = Math.cos(z / 2), s3 = Math.sin(z / 2);
        h.quaternion.set(s2 * c1 * c3 + c2 * s1 * s3, c2 * s1 * c3 - s2 * c1 * s3, c2 * c1 * s3 - s2 * s1 * c3, c2 * c1 * c3 + s2 * s1 * s3);
      }
      h.updatePinchValue(pinch);
    };
    const look = (aim, back = 0, fov = 54, up = 0) => {
      d.film.fov(fov);
      // The seat staged by tools/stage.sh.
      const seat = { x: -0.84, y: 1.2, z: 0.2 };
      const dx = aim.x - seat.x, dy = aim.y - seat.y, dz = aim.z - seat.z;
      const len = Math.hypot(dx, dy, dz);
      const pos = { x: seat.x - (dx / len) * back, y: seat.y - (dy / len) * back + up, z: seat.z - (dz / len) * back };
      dev.position.set(pos.x, pos.y, pos.z);
      const ex = aim.x - pos.x, ey = aim.y - pos.y, ez = aim.z - pos.z;
      const yaw = Math.atan2(-ex, -ez);
      const pitch = Math.atan2(ey, Math.hypot(ex, ez));
      const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
      dev.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
    };
    if (scene === 'setup') {
      await d.say('I still have not replied to the landlord about the heating. And I need to book the dentist.');
      await wait(1500);
      await d.say('The slides for Monday are not done. I keep replaying that awkward comment I made at lunch.');
      await wait(4000);
      return d.state().tokens;
    }
    const tokens = d.state().tokens ?? [];
    const first = tokens[0]?.id;
    const stone = first ? d.stoneWorld(first) : d.deskPoint(-0.2, 0.02, 0.1);
    const yawDesk = (() => {
      const a = d.deskPoint(0, 0, 0), b = d.deskPoint(0, 0, -1);
      return (Math.atan2(-(b.x - a.x), -(b.z - a.z)) * 180) / Math.PI;
    })();
    // Desk frame: +x to the right, +z toward you, +y up (metres).
    const o = d.deskPoint(0, 0, 0), ex = d.deskPoint(1, 0, 0), ez = d.deskPoint(0, 0, 1);
    const off = (p, dx, dy, dz) => ({ x: p.x + (ex.x - o.x) * dx + (ez.x - o.x) * dz, y: p.y + dy, z: p.z + (ex.z - o.z) * dx + (ez.z - o.z) * dz });
    if (scene === 'rest') {
      // Right hand flat on the tray, fingertips just before the first stone; left hand resting on the near edge.
      setHand('right', off(stone, 0.03, 0.03, 0.15), 0, [-30, yawDesk, 0]);
      setHand('left', off(stone, -0.2, 0.035, 0.2), 0, [-30, yawDesk, 0]);
      await wait(600);
      look(off(stone, -0.05, 0.0, 0.08), -0.12, 44);
    } else if (scene === 'pinch') {
      setHand('right', off(stone, 0.02, 0.03, 0.12), 0.0, [-30, yawDesk, 0]);
      await wait(400);
      setHand('right', off(stone, 0.02, 0.045, 0.11), 1, [-30, yawDesk, 0]);
      setHand('left', off(stone, -0.22, 0.035, 0.22), 0, [-30, yawDesk, 0]);
      await wait(900);
      look(off(stone, -0.03, 0.02, 0.06), -0.12, 44);
    } else if (scene === 'breathe') {
      const c = d.deskPoint(0, 0.0, 0.2);
      setHand('right', off(c, 0.16, 0.1, 0.02), 0, [35, yawDesk - 10, -25]);
      setHand('left', off(c, -0.16, 0.1, 0.02), 0, [35, yawDesk + 10, 25]);
      await wait(400);
      look(d.deskPoint(0, 0.08, 0.0), 0, 56);
    } else if (scene === 'full') {
      const c = d.deskPoint(0, 0.0, 0.2);
      setHand('right', off(c, 0.13, 0.07, 0.0), 0, [-10, yawDesk - 8, -10]);
      setHand('left', off(c, -0.15, 0.09, 0.02), 0, [20, yawDesk, 15]);
      await wait(400);
      look(d.deskPoint(0, 0.06, 0.02), 0, 56);
    }
    if (scene.startsWith('ghost')) {
      // The onboarding guide hand, posed on the first stone (pinch 0 / 0.6 / 1), your own hands parked below.
      const pinch = Number(scene.slice(5) || 0);
      setHand('right', off(stone, 0.2, -0.4, 0.3), 0);
      setHand('left', off(stone, -0.2, -0.4, 0.3), 0);
      const dbg = d.debug();
      const g = dbg.ghost;
      if (!g.ready) g.build(dbg.hands.source);
      const o2 = d.deskPoint(0, 0, 0), f2 = d.deskPoint(0, 0, -1);
      const yaw = Math.atan2(-(f2.x - o2.x), -(f2.z - o2.z));
      // The app hides the ghost every frame when no onboarding target exists: keep it for this still.
      // The app poses (or hides) the ghost every frame during onboarding: freeze it on our pose for this still.
      const at = g.root.position.clone().set(stone.x, stone.y + 0.02 + 0.03 * pinch, stone.z);
      const pose = g.__pose ?? (g.__pose = g.pose);
      g.hide = () => {};
      g.pose = function () { return pose.call(this, at, yaw, pinch, 1); };
      g.pose(at, yaw, pinch, 1);
      look(off(stone, 0, 0.02, 0.0), -0.2, 40);
    }
    if (custom) {
      const c = JSON.parse(custom);
      for (const side of ['left', 'right']) if (c[side]) setHand(side, d.deskPoint(...c[side].p), c[side].pinch ?? 0, c[side].e ? [c[side].e[0], yawDesk + c[side].e[1], c[side].e[2]] : undefined);
      if (c.look) look(d.deskPoint(...c.look.aim), c.look.back ?? 0, c.look.fov ?? 54);
    }
    await wait(700);
    return { scene, mode: d.state().mode, tokens: tokens.length };
  }, [scene, process.env.HANDS ?? '']);
}
