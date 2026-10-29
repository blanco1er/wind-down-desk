/**
 * Choosing where the desk lives (pure, unit-tested).
 *
 * Mixed reality first: the mat is laid on the closest real table within seated
 * reach, detected through WebXR plane detection (Quest scene model). Without a
 * usable table (VR, unscanned room, table out of reach) the desk floats at a
 * comfortable seated height in front of the user and says so.
 */
import type { DeskFrame, DeskLayout, Vec3 } from './desk-layout.ts';

export interface PlaneCandidate {
  id: string;
  orientation: string;
  /** Scene-model label when the runtime provides one ("table", "desk", "floor"...). */
  label: string;
  /** Plane origin in world space (local-floor: y = height above the floor). */
  center: Vec3;
  /** Plane yaw (rotation around +Y) of the plane's local X axis. */
  yaw: number;
  /** Half extents of the polygon bounds in the plane's local X / Z. */
  halfX: number;
  halfZ: number;
  /** Offset of the polygon bounds centre from the plane origin (plane local). */
  offsetX: number;
  offsetZ: number;
}

export interface HeadPose {
  position: Vec3;
  /** Horizontal forward direction (need not be normalized). */
  forward: { x: number; z: number };
}

export interface TableChoice {
  plane: PlaneCandidate;
  score: number;
  /** Horizontal distance from the head to the closest point of the table. */
  reach: number;
}

const TABLE_LABELS = new Set(['table', 'desk', 'coffee table', 'counter']);
/**
 * Surfaces you never write on (Quest scene labels + immersive-web semantic labels). 22 Oct 2026: chair seats,
 * sofas, screens, lamps and plants added — a cluttered room used to offer a chair seat at 46 cm as a "table".
 */
const REJECT_LABELS = new Set(['floor', 'ceiling', 'wall', 'bed', 'couch', 'sofa', 'chair', 'window', 'door', 'screen', 'lamp', 'plant', 'wall art', 'global mesh']);
/** Furniture that can serve (a sideboard) but is a worse pick than any real table. */
const POOR_LABELS = new Set(['storage', 'shelf']);

export const PLACEMENT = {
  minHeight: 0.38,
  maxHeight: 1.15,
  minHeadClearance: 0.22,
  maxReach: 0.9,
  minArea: 0.1,
  /**
   * 29 Oct (rooms never tested: the coffee table seen from the couch): the tray's centre as it would be laid
   * (≈ inset from the near edge, frameOnTable) must be within a seated arm's reach of the shoulder (≈ 20 cm under
   * the eyes). A low or far table that passes the horizontal test put the bowls 1 m from the shoulder: unusable by
   * hand. Such a table is left out; the desk floats at a comfortable height instead.
   */
  shoulderDrop: 0.2,
  deskInset: 0.27,
  maxArm: 0.8,
  /**
   * The hit-test surface has no true near edge, so the arm check cannot apply: a surface more than 60 cm under the
   * eyes (a coffee table from the couch; an ordinary desk is ≈ 40 cm under) is not a seated work surface.
   */
  maxHitDrop: 0.6,
} as const;

/** 29 Oct: distance from the shoulder to the tray's centre if the desk were laid on this table (metres). */
export function armToDesk(height: number, reach: number, head: HeadPose): number {
  return Math.hypot(reach + PLACEMENT.deskInset, head.position.y - PLACEMENT.shoulderDrop - height);
}

/** Closest point of a plane's bounds rectangle to (px, pz), world XZ. */
export function closestPointOnPlane(plane: PlaneCandidate, px: number, pz: number): { x: number; z: number } {
  const c = Math.cos(plane.yaw);
  const s = Math.sin(plane.yaw);
  const dx = px - plane.center.x;
  const dz = pz - plane.center.z;
  // world → plane local (inverse yaw)
  const lx = dx * c - dz * s - plane.offsetX;
  const lz = dx * s + dz * c - plane.offsetZ;
  const cx = Math.max(-plane.halfX, Math.min(plane.halfX, lx)) + plane.offsetX;
  const cz = Math.max(-plane.halfZ, Math.min(plane.halfZ, lz)) + plane.offsetZ;
  return { x: plane.center.x + cx * c + cz * s, z: plane.center.z - cx * s + cz * c };
}

export function boundsCenter(plane: PlaneCandidate): { x: number; z: number } {
  const c = Math.cos(plane.yaw);
  const s = Math.sin(plane.yaw);
  return {
    x: plane.center.x + plane.offsetX * c + plane.offsetZ * s,
    z: plane.center.z - plane.offsetX * s + plane.offsetZ * c,
  };
}

/** Picks the best table for a seated ritual, or null. */
export function chooseTable(candidates: readonly PlaneCandidate[], head: HeadPose, opts: { armCheck?: boolean } = {}): TableChoice | null {
  // The arm check needs the real near edge (planes, volumes). A hit-test surface only knows the nearest point the
  // probe happened to touch, often well inside the table: it is not checked (29 Oct).
  const armCheck = opts.armCheck ?? true;
  let best: TableChoice | null = null;
  const fLen = Math.hypot(head.forward.x, head.forward.z) || 1;
  const fx = head.forward.x / fLen;
  const fz = head.forward.z / fLen;
  for (const plane of candidates) {
    const label = plane.label.toLowerCase();
    if (plane.orientation !== 'horizontal' || REJECT_LABELS.has(label)) {
      continue;
    }
    const height = plane.center.y;
    if (height < PLACEMENT.minHeight || height > PLACEMENT.maxHeight) {
      continue;
    }
    if (head.position.y - height < PLACEMENT.minHeadClearance) {
      continue;
    }
    const area = 4 * plane.halfX * plane.halfZ;
    if (area < PLACEMENT.minArea) {
      continue;
    }
    const nearest = closestPointOnPlane(plane, head.position.x, head.position.z);
    const reach = Math.hypot(nearest.x - head.position.x, nearest.z - head.position.z);
    if (reach > PLACEMENT.maxReach || (armCheck && armToDesk(height, reach, head) > PLACEMENT.maxArm)) {
      continue;
    }
    const center = boundsCenter(plane);
    const toX = center.x - head.position.x;
    const toZ = center.z - head.position.z;
    const toLen = Math.hypot(toX, toZ) || 1;
    const facing = (toX * fx + toZ * fz) / toLen; // 1 = straight ahead
    const score =
      (TABLE_LABELS.has(label) ? 2 : POOR_LABELS.has(label) ? -1 : 0) + (1 - reach / PLACEMENT.maxReach) * 2 + facing + Math.min(area, 1) * 0.5;
    if (best == null || score > best.score) {
      best = { plane, score, reach };
    }
  }
  return best;
}

/**
 * Desk frame on a chosen table: the mat's front edge sits a few centimetres
 * inside the table edge nearest to the user, facing them, clamped inside the
 * table bounds when the table is large enough.
 */
export function frameOnTable(choice: TableChoice, head: HeadPose, layout: DeskLayout): DeskFrame {
  const { plane } = choice;
  const nearest = closestPointOnPlane(plane, head.position.x, head.position.z);
  const center = boundsCenter(plane);
  // Direction from the user into the table.
  let dx = center.x - nearest.x;
  let dz = center.z - nearest.z;
  let len = Math.hypot(dx, dz);
  if (len < 1e-3) {
    dx = nearest.x - head.position.x;
    dz = nearest.z - head.position.z;
    len = Math.hypot(dx, dz) || 1;
  }
  dx /= len;
  dz /= len;
  const inset = layout.depth / 2 + 0.04;
  let x = nearest.x + dx * inset;
  let z = nearest.z + dz * inset;
  // Keep the mat centre within the table when it is deep enough.
  const clamped = closestPointOnPlane(plane, x, z);
  if (Math.hypot(clamped.x - x, clamped.z - z) > 0.001) {
    x = clamped.x;
    z = clamped.z;
  }
  const yaw = Math.atan2(head.position.x - x, head.position.z - z);
  return { x, y: plane.center.y + 0.002, z, yaw };
}

/** Floating desk in front of a seated (or standing) user. */
export function fallbackFrame(head: HeadPose, layout: DeskLayout): DeskFrame {
  const fLen = Math.hypot(head.forward.x, head.forward.z) || 1;
  const fx = head.forward.x / fLen;
  const fz = head.forward.z / fLen;
  const y = Math.min(1.05, Math.max(0.55, head.position.y - 0.5));
  const x = head.position.x + fx * layout.reach;
  const z = head.position.z + fz * layout.reach;
  return { x, y, z, yaw: Math.atan2(head.position.x - x, head.position.z - z) };
}

/**
 * 29 Oct (rooms never tested: a low seat at a high table): the table is refused (too close under the eyes) and the
 * desk floats at a seated height — 24 cm UNDER the real table top in front of you: hands would hit the real table
 * before reaching a bowl. A floating desk never sinks into a detected surface: if its tray overlaps one whose top is
 * above the floating height (by less than 40 cm: not a shelf overhead), it rests on that top instead.
 * `rest` = how high the frame sits above a top when resting on it (tray board + 2 mm, as on a table).
 */
export function clearOfSurfaces(frame: DeskFrame, surfaces: readonly PlaneCandidate[], layout: DeskLayout, rest: number): DeskFrame {
  const c = Math.cos(frame.yaw);
  const s = Math.sin(frame.yaw);
  const hw = layout.width / 2;
  const hd = layout.depth / 2;
  const footprint = [
    [0, 0],
    [-hw, -hd],
    [hw, -hd],
    [-hw, hd],
    [hw, hd],
  ].map(([lx, lz]) => ({ x: frame.x + lx * c + lz * s, z: frame.z - lx * s + lz * c }));
  let y = frame.y;
  for (const plane of surfaces) {
    const label = plane.label.toLowerCase();
    if (plane.orientation !== 'horizontal' || label === 'floor' || label === 'ceiling') continue;
    const top = plane.center.y + rest;
    if (top <= y || top - frame.y > 0.4) continue;
    const over = footprint.some((p) => {
      const q = closestPointOnPlane(plane, p.x, p.z);
      return Math.hypot(q.x - p.x, q.z - p.z) < 0.005;
    });
    if (over) y = top;
  }
  return y === frame.y ? frame : { ...frame, y };
}
