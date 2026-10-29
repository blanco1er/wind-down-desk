/**
 * 29 Oct — your sky on your ceiling, as a real sky (pure, unit-tested in tests/night-sky.test.ts).
 *
 * - constellations: the stars of the same evening are joined by thin lines (a short path through them, nearest
 *   neighbour first, never a long line across the sky), the newest evenings first, at most `max` lines;
 * - the sky disc: where the night sky is laid on the ceiling (the same comfort cone as the stars, a little wider so its
 *   soft edge falls outside them);
 * - star sizes: an angular size per star (a few bright ones, many small), so the sky reads the same on a low or a
 *   high ceiling.
 */
import { CEILING_CONE_DEG, type Ceiling } from './sleep.ts';

export interface SkyStar {
  x: number;
  y: number;
  z: number;
  /** The evening it was let go (YYYY-MM-DD). */
  date: string;
}

/** Lines between stars of the same evening, as index pairs into `stars`; newest evenings first. */
export function constellationSegments(stars: readonly SkyStar[], max = 48, maxLen = 1.1): Array<[number, number]> {
  const byDate = new Map<string, number[]>();
  stars.forEach((s, i) => {
    const list = byDate.get(s.date) ?? [];
    list.push(i);
    byDate.set(s.date, list);
  });
  const dates = [...byDate.keys()].sort().reverse();
  const out: Array<[number, number]> = [];
  const dist = (a: number, b: number) => Math.hypot(stars[a].x - stars[b].x, stars[a].y - stars[b].y, stars[a].z - stars[b].z);
  for (const date of dates) {
    const group = (byDate.get(date) ?? []).slice(0, 7);
    if (group.length < 2) continue;
    // Start from the star furthest from the group's centre, then always the nearest one not yet joined.
    const cx = group.reduce((s, i) => s + stars[i].x, 0) / group.length;
    const cz = group.reduce((s, i) => s + stars[i].z, 0) / group.length;
    let current = group.reduce((best, i) => (Math.hypot(stars[i].x - cx, stars[i].z - cz) > Math.hypot(stars[best].x - cx, stars[best].z - cz) ? i : best), group[0]);
    const left = new Set(group.filter((i) => i !== current));
    while (left.size > 0 && out.length < max) {
      let next = -1;
      for (const i of left) if (next < 0 || dist(current, i) < dist(current, next)) next = i;
      left.delete(next);
      if (dist(current, next) <= maxLen) out.push([current, next]);
      current = next;
    }
    if (out.length >= max) break;
  }
  return out;
}

/** The night-sky disc on the ceiling: centred like the stars' cone, 15 % wider (its edge fades out beyond them). */
export function skyDisc(head: { x: number; y: number; z: number }, forward: { x: number; z: number }, ceiling: Ceiling): { center: { x: number; y: number; z: number }; radius: number; dome: number } {
  const lift = Math.max(0.45, ceiling.y - head.y);
  const ahead = 0.35;
  const radius = lift * Math.tan((CEILING_CONE_DEG * Math.PI) / 180) * 1.15;
  return {
    center: { x: head.x + forward.x * lift * ahead, y: ceiling.source === 'dome' ? head.y + lift : ceiling.y, z: head.z + forward.z * lift * ahead },
    radius,
    dome: ceiling.source === 'dome' ? 1.1 : 0,
  };
}

/**
 * The angular width (radians) of a star's quad on the ceiling, from its size in the lamp's sky (`homeSize`, metres:
 * 0.0128 … 0.025, from memory.ts starPosition × 0.8): squared, so many small stars (≈ 0.9°) and a few bright ones
 * (≈ 2.2°): the visible core is about a third of it (≈ 0.3° … 0.7°, a star you see from across a video frame). Same formula as the shader (particles.ts).
 */
export function skyStarAngle(homeSize: number): number {
  const k = Math.min(1, Math.max(0, (homeSize - 0.0128) / 0.0123));
  return 0.016 + 0.022 * Math.pow(k, 2.2);
}

/**
 * Where a star lands on the ceiling, gathered with the other stars of its evening (a constellation): the evenings are
 * spread over the sky on a golden-angle spiral (the newest nearest the centre of your view, never on top of each
 * other), each star sits around its evening's centre within ≈ 4° … 9° (from its seed), always inside the comfort
 * cone above the seat. `evening`: this star's evening, 0 = the newest; `evenings`: how many there are. On the dome:
 * the same direction at 1.1 m.
 */
export function eveningSkyPoint(seed: number, evening: number, evenings: number, head: { x: number; y: number; z: number }, forward: { x: number; z: number }, ceiling: Ceiling): { x: number; y: number; z: number } {
  const lift = Math.max(0.45, ceiling.y - head.y);
  const ahead = 0.35;
  const cx = head.x + forward.x * lift * ahead;
  const cz = head.z + forward.z * lift * ahead;
  const R = lift * (Math.tan((CEILING_CONE_DEG * Math.PI) / 180) - ahead) * 0.95;
  const n = Math.max(1, evenings);
  const er = Math.sqrt((evening + 0.5) / n) * R * 0.78;
  const ea = evening * 2.39996 + 0.7;
  // The seat's own frame: "ahead" along forward, "side" across it.
  const sx = -forward.z;
  const sz = forward.x;
  const ex = cx + (Math.cos(ea) * sx + Math.sin(ea) * forward.x) * er;
  const ez = cz + (Math.cos(ea) * sz + Math.sin(ea) * forward.z) * er;
  const u = ((seed & 0xffff) / 0xffff) * Math.PI * 2;
  const v = ((seed >>> 16) & 0xffff) / 0xffff;
  const r = lift * (0.07 + 0.09 * v);
  let x = ex + Math.cos(u) * r;
  let z = ez + Math.sin(u) * r;
  // Never outside the cone.
  const d = Math.hypot(x - cx, z - cz);
  if (d > R) {
    x = cx + ((x - cx) * R) / d;
    z = cz + ((z - cz) * R) / d;
  }
  if (ceiling.source !== 'dome') return { x, y: ceiling.y - 0.01, z };
  const dx = x - head.x;
  const dz = z - head.z;
  const len = Math.hypot(dx, lift, dz);
  return { x: head.x + (dx / len) * 1.1, y: head.y + (lift / len) * 1.1, z: head.z + (dz / len) * 1.1 };
}
