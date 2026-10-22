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
} as const;

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
export function chooseTable(candidates: readonly PlaneCandidate[], head: HeadPose): TableChoice | null {
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
    if (reach > PLACEMENT.maxReach) {
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
