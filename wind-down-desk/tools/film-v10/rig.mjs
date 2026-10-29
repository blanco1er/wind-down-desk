// 29 Oct (v9 film) — the head and the two emulated hands, animated INSIDE the page at 60 Hz (a CDP round trip takes
// ≈ 100 ms: driving them from Node made them jerky). Node only sends targets.
//
// Hand choreography (owner, 29 Oct: "why do the hands all do the same thing at the same time"):
// - one hand acts: the right hand goes to its target on a soft arc, accelerating then slowing (0.4–0.7 s), a short
//   pause, the touch, then it withdraws; the left hand stays relaxed, lower, by the tray's edge; it never copies;
// - pinching a stone is one hand; Squeeze is the only two-hand gesture, and even then 100–200 ms apart, asymmetric;
// - always a little life: a 2–4 mm micro-sway, its own phase per hand; wrists naturally turned (palm down and in,
//   ≈ 30°), never flat; the forearm comes from the body.
// The fingertip and the pinch point are MEASURED in the page (closed loop), never assumed; pokes are real Pressed
// events (the app's PokeInteractable), a miss is logged and pressed by call so the take can go on.
import { installFist } from './fist-pose.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** World euler (degrees, IWER yaw convention: the seated user faces yaw 90°) of each gesture, per hand. */
export const WRIST = {
  right: { rest: [76, -14, 30], point: [80, -24, 22], pinch: [84, -38, 16], fist: [80, 2, 62], open: [80, 0, 58] },
  left: { rest: [106, -16, -32], point: [100, -24, -22], pinch: [96, -38, -16], fist: [100, 2, -62], open: [100, 0, -56] },
};

export async function makeRig(f, opts = {}) {
  const js = (fn, a) => f.evaluate(fn, a);
  await installFist(f);
  await js((o) => {
    const old = window.__rig9;
    if (old) clearInterval(old.timer);
    const D = window.IWER_DEVICE;
    D.primaryInputMode = 'hand';
    const qe = (yaw, pitch, roll) => {
      const r = Math.PI / 180, y = (yaw * r) / 2, p = (pitch * r) / 2, z = (roll * r) / 2;
      const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p), cz = Math.cos(z), sz = Math.sin(z);
      return [cy * sp * cz + sy * cp * sz, sy * cp * cz - cy * sp * sz, cy * cp * sz - sy * sp * cz, cy * cp * cz + sy * sp * sz];
    };
    const p0 = D.position;
    const hand = (side, ph) => {
      const h = D.hands[side];
      return { p: { x: h.position.x, y: h.position.y, z: h.position.z }, path: null, e: o.wrist[side].rest.slice(), eFrom: null, eTo: null, eStart: 0, eMs: 1, amp: 0.003, ph, out: { x: 0, y: 0, z: 0 } };
    };
    const rig = {
      head: { pitch: -27, target: -27, yaw: 90, yawTarget: 90, ease: 0.045, sway: 1, pos: { x: p0.x, y: p0.y, z: p0.z }, posTarget: { x: p0.x, y: p0.y, z: p0.z } },
      hands: { right: hand('right', 0.7), left: hand('left', 2.9) },
      t0: performance.now(),
      qe,
    };
    const ease = (q) => (q < 0.5 ? 4 * q * q * q : 1 - (-2 * q + 2) ** 3 / 2);
    rig.timer = setInterval(() => {
      const now = performance.now();
      const t = (now - rig.t0) / 1000;
      const k = 2; // ease constants tuned for 30 Hz
      const hd = rig.head;
      const a = 1 - Math.pow(1 - hd.ease, 1 / k);
      hd.pitch += (hd.target - hd.pitch) * a;
      hd.yaw += (hd.yawTarget - hd.yaw) * (1 - Math.pow(1 - hd.ease * 0.8, 1 / k));
      const ap = 1 - Math.pow(1 - 0.04, 1 / k);
      for (const c of ['x', 'y', 'z']) hd.pos[c] += (hd.posTarget[c] - hd.pos[c]) * ap;
      const rad = Math.PI / 180;
      const pitch = (hd.pitch + Math.sin(t * 0.7) * 0.35 * hd.sway) * rad;
      const yaw = (hd.yaw + Math.sin(t * 0.43) * 0.5 * hd.sway) * rad;
      const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
      D.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
      D.position.set(hd.pos.x, hd.pos.y, hd.pos.z);
      for (const side of ['right', 'left']) {
        const H = rig.hands[side];
        if (H.path) {
          const P = H.path;
          const q = Math.min(1, (now - P.start) / P.ms);
          const e = ease(q);
          // Along the polyline by length.
          let target = e * P.len;
          let i = 0;
          while (i < P.seg.length - 1 && target > P.seg[i]) target -= P.seg[i++];
          const A = P.pts[i], B = P.pts[i + 1];
          const u = P.seg[i] > 0 ? Math.min(1, target / P.seg[i]) : 1;
          H.p = { x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u + Math.sin(Math.PI * e) * P.lift, z: A.z + (B.z - A.z) * u };
          if (q >= 1) {
            const L = P.pts[P.pts.length - 1];
            H.p = { ...L };
            H.path = null;
          }
        }
        if (H.eTo) {
          const q = Math.min(1, (now - H.eStart) / H.eMs);
          const e = ease(q);
          H.e = H.eFrom.map((v, j) => v + (H.eTo[j] - v) * e);
          if (q >= 1) H.eTo = null;
        }
        // Life: a 2–4 mm sway on two slow frequencies, its own phase per hand (smaller while touching).
        const s = H.amp;
        const w = {
          x: s * (Math.sin(t * 2.1 + H.ph) * 0.7 + Math.sin(t * 3.7 + H.ph * 1.7) * 0.3),
          y: s * (Math.sin(t * 1.6 + H.ph * 0.6) * 0.8 + Math.sin(t * 4.3 + H.ph) * 0.2),
          z: s * (Math.sin(t * 1.3 + H.ph * 2.3) * 0.7 + Math.sin(t * 2.9 + H.ph * 0.4) * 0.3),
        };
        H.out = { x: H.p.x + w.x, y: H.p.y + w.y, z: H.p.z + w.z };
        const h = D.hands[side];
        h.position.set(H.out.x, H.out.y, H.out.z);
        const life = s / 0.003;
        const [qx, qy, qz, qw] = qe(H.e[0] + Math.sin(t * 0.9 + H.ph) * 1.2 * life, H.e[1] + Math.sin(t * 1.4 + H.ph * 2) * 1.0 * life, H.e[2] + Math.sin(t * 1.1 + H.ph * 3) * 1.5 * life);
        h.quaternion.set(qx, qy, qz, qw);
      }
    }, 16);
    window.__rig9 = rig;
  }, { wrist: WRIST });

  const head = { pitch: -27, yaw: 90, ease: 0.045 };
  const base = await js(() => ({ ...window.__rig9.head.pos }));
  const setHead = (patch) => js((p) => Object.assign(window.__rig9.head, p), patch);
  /** Aims the head at a world point (snap: at once). */
  const aim = async (p, snap = false, from = null) => {
    const h = from ?? (await js(() => ({ ...window.__rig9.head.posTarget })));
    const dx = p.x - h.x, dy = p.y - h.y, dz = p.z - h.z;
    let yaw = (Math.atan2(-dx, -dz) * 180) / Math.PI;
    const cur = await js(() => window.__rig9.head.yaw);
    while (yaw - cur > 180) yaw -= 360;
    while (yaw - cur < -180) yaw += 360;
    const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
    head.yaw = yaw;
    head.pitch = pitch;
    await setHead(snap ? { yawTarget: yaw, target: pitch, yaw, pitch } : { yawTarget: yaw, target: pitch });
  };
  const look = (pitch, yaw = null, ease = null) => setHead({ target: pitch, ...(yaw != null ? { yawTarget: yaw } : {}), ...(ease != null ? { ease } : {}) });
  /** Moves the head position toward a point by `metres` (lean in), or back to the seat (metres = 0). */
  const lean = (towards, metres, snap = false) => {
    const dx = towards.x - base.x, dy = towards.y - base.y, dz = towards.z - base.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const pt = { x: base.x + (dx / d) * metres, y: base.y + (dy / d) * metres, z: base.z + (dz / d) * metres };
    return setHead(snap ? { posTarget: pt, pos: { ...pt } } : { posTarget: pt });
  };

  // ------------------------------------------------------------------ hands
  const deskPoint = (x, y, z) => js(([a, b, c]) => window.__wdd.deskPoint(a, b, c), [x, y, z]);
  const rest = {
    right: opts.restRight ?? (await deskPoint(0.33, 0.02, 0.43)),
    left: opts.restLeft ?? (await deskPoint(-0.4, -0.005, 0.47)),
  };
  const handNow = (side) => js((s) => ({ ...window.__rig9.hands[s].p }), side);
  /** Glides a hand along `via` points to `to` in `ms` (eased in and out, `lift` metres of arc). Resolves at arrival. */
  const move = async (side, to, ms, lift = 0, via = []) => {
    await js(([s, pts, m, l]) => {
      const H = window.__rig9.hands[s];
      const all = [{ ...H.p }, ...pts];
      const seg = [];
      let len = 0;
      for (let i = 0; i < all.length - 1; i++) {
        const d = Math.hypot(all[i + 1].x - all[i].x, all[i + 1].y - all[i].y, all[i + 1].z - all[i].z);
        seg.push(d);
        len += d;
      }
      H.path = { pts: all, seg, len, ms: m, lift: l, start: performance.now() };
    }, [side, [...via, to], ms, lift]);
    await wait(ms + 20);
  };
  /** Turns a wrist to a named gesture (or an euler) over `ms`. */
  const turn = (side, e, ms = 350) =>
    js(([s, eu, m]) => {
      const H = window.__rig9.hands[s];
      H.eFrom = H.e.slice();
      H.eTo = eu;
      H.eStart = performance.now();
      H.eMs = m;
    }, [side, typeof e === 'string' ? WRIST[side][e] : e, ms]);
  const pose = (side, id) => js(([s, p]) => { window.IWER_DEVICE.hands[s].poseId = p; }, [side, id]);
  const amp = (side, a) => js(([s, v]) => { window.__rig9.hands[s].amp = v; }, [side, a]);
  /** Pinch value ramped over ~120 ms (a real pinch is not a switch). */
  const pinch = async (side, v) => {
    const from = await js((s) => window.IWER_DEVICE.hands[s].pinchValue, side);
    for (let i = 1; i <= 4; i++) {
      await js(([s, x]) => window.IWER_DEVICE.hands[s].updatePinchValue(Math.max(0, Math.min(1, x))), [side, from + ((v - from) * i) / 4]);
      await wait(30);
    }
  };
  /** World offset from the hand's position to its index fingertip (or its pinch point), as rendered now. */
  const tipOffset = (side = 'right') =>
    js((s) => {
      const t = window.__wdd.tipWorld(s);
      const p = window.IWER_DEVICE.hands[s].position;
      return { x: t.x - p.x, y: t.y - p.y, z: t.z - p.z };
    }, side);
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
  const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });

  const misses = [];
  const log = [];
  /** Both hands to their resting places (the right withdraws on a short arc; the left settles on its own time). */
  const restBoth = async (ms = 700) => {
    await pose('right', 'default');
    await turn('right', 'rest', ms);
    await amp('right', 0.003);
    await move('right', rest.right, ms, 0.02);
  };
  const leftSettle = async (ms = 900) => {
    await pose('left', 'default');
    await turn('left', 'rest', ms);
    await move('left', rest.left, ms, 0.01);
  };

  const pointOffset = { v: null };
  /**
   * A real fingertip touch: the right hand turns to point, arcs to 7 cm in front of the button (seen from the head),
   * pauses, pushes through in ≈ 0.35 s until the app logs Pressed, holds, withdraws and rests.
   */
  const poke = async (action, { hold = 120, approach = 560, back = true } = {}) => {
    const b = await js((a) => window.__wdd.buttonWorld(a), action);
    if (b == null || !b.shown || !b.poke) {
      misses.push({ action, why: b == null ? 'absent' : !b.shown ? 'hidden' : 'not pokeable' });
      await js((a) => window.__wdd.press(a), action);
      return false;
    }
    const headP = await js(() => ({ ...window.__rig9.head.pos }));
    const d0 = sub(headP, b);
    const n = Math.hypot(d0.x, d0.y, d0.z) || 1;
    const d = scale(d0, 1 / n);
    const ext = b.size == null ? 0.02 : (Math.abs(d.x) * b.size.x + Math.abs(d.y) * b.size.y + Math.abs(d.z) * b.size.z) / 2;
    const startCm = Math.max(6, Math.ceil((ext + 0.045) * 100));
    const at = (cm) => add(b, scale(d, cm * 0.01));
    const before = await js(() => window.__wdd.presses());
    await pose('right', 'point');
    await turn('right', 'point', approach * 0.8);
    if (pointOffset.v == null) {
      await wait(approach * 0.8 + 40);
      pointOffset.v = await tipOffset('right');
    }
    let off = pointOffset.v;
    await move('right', sub(at(startCm), off), approach, 0.035);
    // Closed loop: the fingertip as rendered now, corrected in one short glide.
    off = await tipOffset('right');
    pointOffset.v = off;
    await amp('right', 0.0012);
    await move('right', sub(at(startCm), off), 110);
    await wait(90);
    // Push through (to 1.5 cm behind the centre), watching for Pressed.
    const pushTo = sub(at(-1.5), off);
    const pushMs = 360 + startCm * 12;
    const pushing = move('right', pushTo, pushMs);
    let hit = false;
    const t0 = Date.now();
    while (Date.now() - t0 < pushMs + 250 && !hit) {
      await wait(45);
      const now = await js(() => window.__wdd.presses());
      const fresh = now.count - before.count;
      hit = fresh > 0 && now.last.slice(-fresh).includes(action);
    }
    if (hit) await js(() => { const H = window.__rig9.hands.right; H.path = null; });
    else await pushing;
    await wait(hold);
    await move('right', sub(at(startCm + 2), off), 260);
    await amp('right', 0.003);
    if (!hit) {
      misses.push({ action, why: 'no Pressed' });
      await js((a) => window.__wdd.press(a), action);
    }
    log.push({ poke: action, hit });
    if (back) await restBoth(620);
    return hit;
  };

  /** A fingertip slides the bead (or a mix rail) from u0 to u1, then lifts and rests. */
  const slide = async (u0, u1, { ms = 1500, rail = false } = {}) => {
    await pose('right', 'point');
    await turn('right', 'point', 400);
    await wait(420);
    const off = await tipOffset('right');
    const pt = async (u, up) => {
      const p = await js(([x, r]) => window.__wdd.railWorld(x, r), [u, rail]);
      return sub({ ...p, y: p.y + up }, off);
    };
    await move('right', await pt(u0, 0.04), 560, 0.03);
    await amp('right', 0.001);
    await move('right', await pt(u0, 0.004), 260);
    await wait(120);
    const via = [];
    for (let i = 1; i < 8; i++) via.push(await pt(u0 + ((u1 - u0) * i) / 8, 0.004));
    await move('right', await pt(u1, 0.004), ms, 0, via);
    await wait(160);
    await move('right', await pt(u1, 0.06), 300);
    await amp('right', 0.003);
    await restBoth(650);
  };

  const pinchOffset = { v: null };
  /** Measures where the pinch point is relative to the hand (index tip at pinch 1), away from anything grabbable. */
  const measurePinch = async () => {
    await pose('right', 'default');
    await turn('right', 'pinch', 300);
    await wait(340);
    await js(() => window.IWER_DEVICE.hands.right.updatePinchValue(1));
    await wait(160);
    pinchOffset.v = await tipOffset('right');
    await js(() => window.IWER_DEVICE.hands.right.updatePinchValue(0));
    await wait(120);
    await turn('right', 'rest', 300);
    return pinchOffset.v;
  };
  /** One hand: comes over the stone, lowers, pinches, carries it on an arc, opens over the bowl, withdraws. */
  const grab = async (stoneWorld, endWorld, { hold = 0, onHold = null, carryMs = 1050, back = true } = {}) => {
    if (pinchOffset.v == null) await measurePinch();
    const off = pinchOffset.v;
    await pose('right', 'default');
    await turn('right', 'pinch', 500);
    await move('right', sub({ ...stoneWorld, y: stoneWorld.y + 0.055 }, off), 600, 0.035);
    await amp('right', 0.0012);
    await move('right', sub({ ...stoneWorld, y: stoneWorld.y + 0.006 }, off), 300);
    await pinch('right', 1);
    await wait(240);
    await amp('right', 0.002);
    await move('right', sub(endWorld, off), carryMs, 0.09);
    if (onHold) await onHold();
    if (hold) await wait(hold);
    await wait(120);
    await pinch('right', 0);
    await wait(260);
    await move('right', sub({ ...endWorld, y: endWorld.y + 0.05 }, off), 280);
    await amp('right', 0.003);
    if (back) await restBoth(650);
  };

  /** Squeeze: both hands come up, 150 ms apart and not symmetric; fists close 120 ms apart; open 170 ms apart. */
  const fistsNear = async () => {
    // Raised 14–16 cm above the tray, in front of the body, thumbs up (as if squeezing two balls), not mirrored.
    const r = await deskPoint(0.12, 0.16, 0.25);
    const l = await deskPoint(-0.1, 0.145, 0.28);
    await turn('right', 'open', 600);
    const pr = move('right', r, 700, 0.03);
    await wait(150);
    await turn('left', 'open', 650);
    await move('left', l, 760, 0.02);
    await pr;
  };
  const fists = async (on) => {
    await pose('right', on ? 'fist' : 'default');
    await turn('right', on ? 'fist' : 'open', 220);
    await wait(on ? 120 : 170);
    await pose('left', on ? 'fist' : 'default');
    await turn('left', on ? 'fist' : 'open', 240);
  };

  /** Hands out of reach (below the table, relaxed), e.g. before an arrival; they come in later. */
  const away = async () => {
    const r = await deskPoint(0.36, -0.3, 0.5);
    const l = await deskPoint(-0.42, -0.3, 0.52);
    await js(([a, b]) => { const R = window.__rig9; R.hands.right.p = a; R.hands.left.p = b; R.hands.right.path = null; R.hands.left.path = null; }, [r, l]);
    await pose('right', 'default');
    await pose('left', 'default');
  };
  /** Hands come in from below to their resting places, the left later and slower. */
  const handsIn = async () => {
    const pr = move('right', rest.right, 900, 0.02);
    await wait(260);
    await move('left', rest.left, 1100, 0.01);
    await pr;
  };

  return { js, aim, look, lean, setHead, deskPoint, move, turn, pose, amp, pinch, poke, slide, grab, measurePinch, fistsNear, fists, away, handsIn, restBoth, leftSettle, rest, handNow, base, misses, log, sub, add, scale, wait };
}
