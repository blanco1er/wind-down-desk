// 29 Oct (solidity) — emulated hands that really touch and pinch, for `iwsdk browser run` scripts.
//   poke(action): the right index fingertip (IWER "point" pose) comes 7 cm in front of the button (towards the head)
//     and pushes through it; success = the app logged a real Pressed on that action (window.__wdd.presses()).
//     The hand → fingertip offset is measured in the page (closed loop), never assumed. `holdMs` keeps the finger in
//     (the Sound button held opens the volumes). A miss is counted, then (fallback) the same action is pressed by
//     call so the run can go on — the report lists every miss.
//   tipTo(p): closed loop, the measured fingertip lands on a world point (rails: the bead, the volumes).
//   grab(id, bin): pinch a stone (the real OneHandGrabbable + useHandPinchForGrab path) and drop it in a bowl.
//   pinchAt(p) / moveTo(p) / release(): pinch something at a world point (the Release stone), carry, open.
//   fists(on): both hands closed (IWER "point" pose: fingers curled) or open, near the tray (Squeeze).
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeHands(f) {
  const js = (fn, a) => f.evaluate(fn, a);
  const stats = { pokes: 0, pokeMisses: [], grabs: 0, grabMisses: [], slides: 0 };

  const setHand = (p, pinch, pose, side = 'right') =>
    js(([q, pv, ps, sd]) => {
      const h = window.IWER_DEVICE.hands[sd];
      if (ps != null) h.poseId = ps;
      if (q != null) h.position.set(q.x, q.y, q.z);
      if (pv != null) h.updatePinchValue(pv);
    }, [p, pinch, pose, side]);
  const handPos = (side = 'right') => js((sd) => { const p = window.IWER_DEVICE.hands[sd].position; return { x: p.x, y: p.y, z: p.z }; }, side);

  /** Resting places: below and beside the desk, out of every button's way. */
  const rest = async () => {
    const r = await js(() => window.__wdd.deskPoint(0.34, -0.1, 0.44));
    const l = await js(() => window.__wdd.deskPoint(-0.34, -0.1, 0.44));
    if (r != null) await setHand(r, 0, 'default', 'right');
    if (l != null) await setHand(l, 0, 'default', 'left');
    await wait(120);
  };

  /** Closed loop: the measured right index fingertip lands on `target` (world). */
  const tipTo = async (target, iterations = 3) => {
    for (let k = 0; k < iterations; k++) {
      const tip = await js(() => window.__wdd.tipWorld('right'));
      const pos = await handPos();
      await setHand({ x: pos.x + target.x - tip.x, y: pos.y + target.y - tip.y, z: pos.z + target.z - tip.z }, null, null);
      await wait(70);
    }
  };

  /** Was `action` really pressed since `before` (a presses() snapshot)? */
  const pressed = async (before, action) => {
    const now = await js(() => window.__wdd.presses());
    const fresh = now.count - before.count;
    return fresh > 0 && now.last.slice(-fresh).includes(action);
  };

  const poke = async (action, { fallback = true, holdMs = 0 } = {}) => {
    const b = await js((a) => window.__wdd.buttonWorld(a), action);
    if (b == null || !b.shown || !b.poke) {
      stats.pokeMisses.push({ action, why: b == null ? 'absent' : !b.shown ? 'hidden' : 'not pokeable', mode: await js(() => window.__wdd.evening().mode) });
      if (fallback) await js((a) => window.__wdd.press(a), action);
      return false;
    }
    const head = await js(() => { const p = window.IWER_DEVICE.position; return { x: p.x, y: p.y, z: p.z }; });
    const d = { x: head.x - b.x, y: head.y - b.y, z: head.z - b.z };
    const n = Math.hypot(d.x, d.y, d.z) || 1;
    d.x /= n; d.y /= n; d.z /= n;
    const at = (cm) => ({ x: b.x + d.x * cm * 0.01, y: b.y + d.y * cm * 0.01, z: b.z + d.z * cm * 0.01 });
    // Start outside the target: its box's extent along the approach (the open globe is a 17 cm sphere), + 5 cm.
    const ext = b.size == null ? 0.02 : (Math.abs(d.x) * b.size.x + Math.abs(d.y) * b.size.y + Math.abs(d.z) * b.size.z) / 2;
    const startCm = Math.max(7, Math.ceil((ext + 0.05) * 100));
    const before = await js(() => window.__wdd.presses());
    await setHand(null, 0, 'point');
    await wait(60);
    await tipTo(at(startCm), 3);
    let hit = false;
    // Push in 1 cm steps to 1.5 cm behind the centre (buttons are a few mm thick), keeping the measured offset.
    const tip0 = await js(() => window.__wdd.tipWorld('right'));
    const pos0 = await handPos();
    const off = { x: tip0.x - pos0.x, y: tip0.y - pos0.y, z: tip0.z - pos0.z };
    for (let k = startCm - 1; k >= -1.5 && !hit; k -= 1) {
      const t = at(k);
      await setHand({ x: t.x - off.x, y: t.y - off.y, z: t.z - off.z }, null, null);
      await wait(70);
      hit = await pressed(before, action);
    }
    if (!hit) {
      await wait(200);
      hit = await pressed(before, action);
    }
    if (holdMs > 0) await wait(holdMs);
    const back = at(startCm + 1);
    await setHand({ x: back.x - off.x, y: back.y - off.y, z: back.z - off.z }, null, null);
    await wait(120);
    await rest();
    if (hit) stats.pokes++;
    else {
      stats.pokeMisses.push({ action, why: 'no Pressed', mode: await js(() => window.__wdd.evening().mode) });
      if (fallback) await js((a) => window.__wdd.press(a), action);
    }
    return hit;
  };

  /** A fingertip on a rail (the bead, or the volumes: back = the sound rail), slid from u0 to u1, then lifted. */
  const slide = async (u0, u1, back = false) => {
    await setHand(null, 0, 'point');
    const p0 = await js(([u, b]) => window.__wdd.railWorld(u, b), [u0, back]);
    if (p0 == null) return false;
    await tipTo({ ...p0, y: p0.y + 0.04 }, 3);
    await tipTo({ ...p0, y: p0.y + 0.004 }, 3);
    for (let i = 1; i <= 10; i++) {
      const u = u0 + ((u1 - u0) * i) / 10;
      const p = await js(([x, b]) => window.__wdd.railWorld(x, b), [u, back]);
      await tipTo({ ...p, y: p.y + 0.004 }, 2);
    }
    const p1 = await js(([u, b]) => window.__wdd.railWorld(u, b), [u1, back]);
    await tipTo({ ...p1, y: p1.y + 0.06 }, 2);
    await rest();
    stats.slides++;
    return true;
  };

  const grab = async (id, bin) => {
    const stone = await js((i) => window.__wdd.stoneWorld(i), id);
    const end = await js((x) => window.__wdd.binWorld(x), bin);
    if (stone == null || end == null) {
      stats.grabMisses.push({ id, bin, why: 'no stone / bowl' });
      return false;
    }
    await setHand({ x: stone.x, y: stone.y + 0.05, z: stone.z }, 0, 'default');
    await wait(220);
    await setHand({ x: stone.x, y: stone.y + 0.01, z: stone.z }, 0, null);
    await wait(180);
    await setHand(null, 1, null);
    await wait(300);
    for (let i = 1; i <= 16; i++) {
      const k = i / 16;
      await setHand({ x: stone.x + (end.x - stone.x) * k, y: stone.y + 0.01 + (end.y + 0.03 - stone.y) * k + Math.sin(Math.PI * k) * 0.08, z: stone.z + (end.z - stone.z) * k }, null, null);
      await wait(45);
    }
    await setHand({ x: end.x, y: end.y + 0.03, z: end.z }, 0, null);
    await wait(500);
    await rest();
    const t = await js((i) => window.__wdd.state().tokens.find((x) => x.id === i), id);
    const ok = t != null && (t.bin != null || t.released);
    if (ok) stats.grabs++;
    else stats.grabMisses.push({ id, bin, why: 'not in a bowl after the drop' });
    return ok;
  };

  const pinchAt = async (p) => {
    await setHand({ x: p.x, y: p.y + 0.05, z: p.z }, 0, 'default');
    await wait(200);
    await setHand({ x: p.x, y: p.y + 0.008, z: p.z }, 0, null);
    await wait(180);
    await setHand(null, 1, null);
    await wait(300);
  };
  const moveTo = async (p, steps = 12) => {
    const a = await handPos();
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      await setHand({ x: a.x + (p.x - a.x) * k, y: a.y + (p.y - a.y) * k, z: a.z + (p.z - a.z) * k }, null, null);
      await wait(45);
    }
  };
  const release = async () => {
    await setHand(null, 0, null);
    await wait(300);
  };
  const fists = async (on) => {
    if (on === 'near') {
      await setHand(await js(() => window.__wdd.deskPoint(0.12, 0.13, 0.2)), 0, 'default', 'right');
      await setHand(await js(() => window.__wdd.deskPoint(-0.12, 0.13, 0.2)), 0, 'default', 'left');
      return;
    }
    await setHand(null, null, on ? 'point' : 'default', 'right');
    await setHand(null, null, on ? 'point' : 'default', 'left');
  };

  return { poke, slide, tipTo, grab, pinchAt, moveTo, release, rest, fists, setHand, stats };
}
