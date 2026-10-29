/**
 * 29 Oct — "walls host content" (Meta Start judging, Experience Design): the good things you keep (Keep) come to rest
 * on a real wall of your room, found by scene understanding, and come back to the same spots on the evenings after
 * (pure, unit-tested in tests/walls.test.ts).
 *
 * - wallsFrom: vertical planes (any label but door / window / screen / wall art), else bounded volumes labelled
 *   "wall", as rectangles in world space (centre, inward normal, horizontal right axis, half width / height).
 * - pickKeepWall: the wall you see from your seat — in front of you (within 55° of the way the seat faces, past the
 *   desk), facing you, 0.7 to 4.5 m away, wide enough; the most frontal and nearest wins.
 * - keptOnWall: light n's spot on that wall: inside a band just above the captions and buttons seen from the
 *   seat (≈ −1° … +11° of elevation: a glance up from the desk, never behind a panel), ±30° around the line of sight to the wall), spread by a low-discrepancy sequence so lights never pile
 *   up, 2 cm off the surface. The same wall and the same index give the same spot: lights stay where they were.
 * When no wall qualifies (an open room, no scene data), the caller keeps them in view at the desk (logic/keep.ts).
 */
import type { PlaneCandidate } from './placement.ts';
import type { MeshBox } from './surfaces.ts';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Wall {
  id: string;
  /** Centre of the wall rectangle (world). */
  center: V3;
  /** Unit horizontal normal pointing into the room (toward the seat once picked). */
  normal: V3;
  /** Unit horizontal axis along the wall. */
  right: V3;
  halfWidth: number;
  /** World heights of the rectangle's bottom and top edges. */
  bottom: number;
  top: number;
}

/** A plane with its full orientation (world axes of its local X, Y = normal, Z). */
export type OrientedPlane = PlaneCandidate & { axisX?: V3; axisY?: V3; axisZ?: V3 };

const NOT_WALLS = new Set(['door', 'window', 'window frame', 'screen', 'wall art', 'picture', 'table', 'desk', 'floor', 'ceiling', 'bed', 'couch', 'shelf', 'storage']);

function horizontal(v: V3): V3 | null {
  const l = Math.hypot(v.x, v.z);
  return l < 1e-4 ? null : { x: v.x / l, y: 0, z: v.z / l };
}

/** Walls of the room: vertical planes, else volumes labelled "wall" (their largest vertical face). */
export function wallsFrom(planes: readonly OrientedPlane[], meshes: readonly MeshBox[]): Wall[] {
  const out: Wall[] = [];
  for (const p of planes) {
    const label = p.label.toLowerCase();
    if (NOT_WALLS.has(label)) continue;
    if (p.orientation !== 'vertical' && label !== 'wall') continue;
    if (p.axisX == null || p.axisY == null || p.axisZ == null) continue;
    const n = horizontal(p.axisY);
    if (n == null || Math.abs(p.axisY.y) > 0.3) continue;
    // The polygon's bounds in the plane's local X / Z, mapped to world: one of them is (nearly) vertical.
    const cx = p.center.x + p.axisX.x * p.offsetX + p.axisZ.x * p.offsetZ;
    const cy = p.center.y + p.axisX.y * p.offsetX + p.axisZ.y * p.offsetZ;
    const cz = p.center.z + p.axisX.z * p.offsetX + p.axisZ.z * p.offsetZ;
    const xVertical = Math.abs(p.axisX.y) > Math.abs(p.axisZ.y);
    const halfW = xVertical ? p.halfZ : p.halfX;
    const halfH = xVertical ? p.halfX : p.halfZ;
    const right = horizontal(xVertical ? p.axisZ : p.axisX) ?? { x: -n.z, y: 0, z: n.x };
    out.push({ id: `plane:${p.id}`, center: { x: cx, y: cy, z: cz }, normal: n, right, halfWidth: halfW, bottom: cy - halfH, top: cy + halfH });
  }
  if (out.length > 0) return out;
  for (const m of meshes) {
    if (m.label.toLowerCase() !== 'wall') continue;
    // Yaw of the volume; its thinnest horizontal side is the wall's thickness.
    const q = m.quaternion;
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    const sx = m.max.x - m.min.x;
    const sz = m.max.z - m.min.z;
    const thinX = sx < sz;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const local = { x: (m.max.x + m.min.x) / 2, z: (m.max.z + m.min.z) / 2 };
    const center = { x: m.position.x + local.x * c + local.z * s, y: m.position.y + (m.max.y + m.min.y) / 2, z: m.position.z - local.x * s + local.z * c };
    const nLocal = thinX ? { x: c, z: -s } : { x: s, z: c };
    out.push({
      id: `mesh:${m.id}`,
      center,
      normal: { x: nLocal.x, y: 0, z: nLocal.z },
      right: { x: -nLocal.z, y: 0, z: nLocal.x },
      halfWidth: (thinX ? sz : sx) / 2,
      bottom: m.position.y + m.min.y,
      top: m.position.y + m.max.y,
    });
  }
  return out;
}

/**
 * The wall you see from the seat (`head`, `forward` = the way the seat faces, toward the desk), or null. Its normal
 * is turned to face the seat.
 */
export function pickKeepWall(walls: readonly Wall[], head: V3, forward: { x: number; z: number }): Wall | null {
  const fl = Math.hypot(forward.x, forward.z) || 1;
  const f = { x: forward.x / fl, z: forward.z / fl };
  let best: { wall: Wall; score: number } | null = null;
  for (const w of walls) {
    if (w.halfWidth < 0.35 || w.top - w.bottom < 0.5) continue;
    // Facing the seat.
    let n = w.normal;
    const toHead = { x: head.x - w.center.x, z: head.z - w.center.z };
    if (n.x * toHead.x + n.z * toHead.z < 0) n = { x: -n.x, y: 0, z: -n.z };
    const dist = n.x * toHead.x + n.z * toHead.z;
    if (dist < 0.7 || dist > 4.5) continue;
    // The point of the wall straight ahead of the seat (where the line of sight meets the wall's plane).
    const along = -(n.x * f.x + n.z * f.z);
    if (along < Math.cos((55 * Math.PI) / 180)) continue;
    const t = dist / along;
    const hit = { x: head.x + f.x * t, z: head.z + f.z * t };
    const right = { x: -n.z, z: n.x };
    const u = (hit.x - w.center.x) * right.x + (hit.z - w.center.z) * right.z;
    if (Math.abs(u) > w.halfWidth + 0.3) continue;
    const score = along * 2 - dist * 0.25 - Math.max(0, Math.abs(u) - w.halfWidth * 0.6);
    if (best == null || score > best.score) best = { wall: { ...w, normal: n, right: { x: right.x, y: 0, z: right.z } }, score };
  }
  return best?.wall ?? null;
}

/** Light n's spot on the wall (world), 2 cm off its surface, inside the comfortable band seen from the seat. */
export function keptOnWall(n: number, seed: number, wall: Wall, head: V3, forward: { x: number; z: number }): V3 {
  const nn = wall.normal;
  const toHead = { x: head.x - wall.center.x, z: head.z - wall.center.z };
  const dist = Math.max(0.5, nn.x * toHead.x + nn.z * toHead.z);
  const fl = Math.hypot(forward.x, forward.z) || 1;
  const f = { x: forward.x / fl, z: forward.z / fl };
  const along = Math.max(0.3, -(nn.x * f.x + nn.z * f.z));
  // Where the line of sight meets the wall: the band is centred there.
  const t = dist / along;
  const sight = { x: head.x + f.x * t, z: head.z + f.z * t };
  const u0 = (sight.x - wall.center.x) * wall.right.x + (sight.z - wall.center.z) * wall.right.z;
  // Low-discrepancy spread (R2 sequence) + a little jitter: no two lights on top of each other, evening after evening.
  const a = (0.5 + n * 0.7548776662) % 1;
  const b = (0.5 + n * 0.5698402910) % 1;
  const j = (shift: number) => (((seed >>> shift) & 0xff) / 0xff - 0.5) * 0.04;
  const halfAng = Math.tan((30 * Math.PI) / 180) * dist;
  let u = u0 + (a * 2 - 1) * halfAng + j(0) * dist;
  const lo = head.y + Math.tan((-1 * Math.PI) / 180) * dist;
  const hi = head.y + Math.tan((11 * Math.PI) / 180) * dist;
  let y = lo + (hi - lo) * b + j(8) * dist;
  // Inside the wall (10 cm margin) and above the furniture line (40 cm off the floor at least).
  u = Math.min(wall.halfWidth - 0.1, Math.max(-wall.halfWidth + 0.1, u));
  y = Math.min(wall.top - 0.12, Math.max(Math.max(wall.bottom + 0.4, 0.4), y));
  return {
    x: wall.center.x + wall.right.x * u + nn.x * 0.02,
    y,
    z: wall.center.z + wall.right.z * u + nn.z * 0.02,
  };
}
