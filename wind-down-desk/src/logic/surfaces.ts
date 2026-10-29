/**
 * Finding the real table in any room (pure, unit-tested).
 *
 * Three sources, best first (what Meta Quest Browser actually offers, checked 22 Oct 2026):
 *   1. plane detection   ('plane-detection'): the Space Setup's labelled planes ("table", "desk"…);
 *   2. mesh detection    ('mesh-detection'): bounded scene volumes (a "table" box: its top face);
 *   3. hit test          ('hit-test'): a few rays from the head, forward and down. Since Horizon Browser 40.4
 *      (Oct 2025) Quest 3 / 3S answer them from the live depth sensor, so a room WITHOUT Space Setup still
 *      gives a horizontal surface. Only an unlabelled point cloud: it is used when 1 and 2 find nothing.
 * The same seated-reach rules (placement.ts) judge every source; nothing usable → the floating desk.
 */
import { chooseTable, PLACEMENT, type HeadPose, type PlaneCandidate, type TableChoice } from './placement.ts';
import type { Vec3 } from './desk-layout.ts';

export type SurfaceSource = 'plane' | 'mesh' | 'hit';

export interface MeshBox {
  id: string;
  label: string;
  isBounded3D: boolean;
  /** Mesh pose in world space (local-floor). */
  position: Vec3;
  quaternion: { x: number; y: number; z: number; w: number };
  /** Axis-aligned bounds of the mesh vertices, mesh-local. */
  min: Vec3;
  max: Vec3;
}

/** One hit-test result: where the ray met the room and how much the surface faces up (normal · +Y). */
export interface SurfaceHit {
  x: number;
  y: number;
  z: number;
  up: number;
}

export const HITS = {
  /** A table top faces up: normal within ≈ 23° of vertical. */
  minUp: 0.92,
  /** Hits within this height band are one surface. */
  band: 0.025,
  /** Closer than this to the eyes (horizontally) is your own lap, knees or chair: never a table. */
  minReach: 0.22,
  /** Fewer agreeing hits than this is noise (a cup, an arm of a chair). */
  minCount: 4,
  /** Unknown table size: the footprint is at least this (half extents, m). */
  minHalfX: 0.18,
  minHalfZ: 0.14,
} as const;

/** Bounded volumes worth sitting at; everything else is furniture you do not write on. */
const MESH_TABLE_LABELS = new Set(['table', 'desk', 'coffee table']);

/**
 * The top face of a bounded "table" volume, as a plane candidate. Works whatever axis the runtime chose as
 * "up" in mesh space: the local axis closest to world +Y is the height, the two others the footprint.
 * Tilted boxes (> ≈ 18°) are refused.
 */
export function meshTop(mesh: MeshBox): PlaneCandidate | null {
  if (!mesh.isBounded3D || !MESH_TABLE_LABELS.has(mesh.label.toLowerCase())) return null;
  const { x, y, z, w } = mesh.quaternion;
  // Rotation matrix columns = local axes in world.
  const axes = [
    { x: 1 - 2 * (y * y + z * z), y: 2 * (x * y + z * w), z: 2 * (x * z - y * w) },
    { x: 2 * (x * y - z * w), y: 1 - 2 * (x * x + z * z), z: 2 * (y * z + x * w) },
    { x: 2 * (x * z + y * w), y: 2 * (y * z - x * w), z: 1 - 2 * (x * x + y * y) },
  ];
  const half = [(mesh.max.x - mesh.min.x) / 2, (mesh.max.y - mesh.min.y) / 2, (mesh.max.z - mesh.min.z) / 2];
  const mid = [(mesh.max.x + mesh.min.x) / 2, (mesh.max.y + mesh.min.y) / 2, (mesh.max.z + mesh.min.z) / 2];
  let up = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(axes[i].y) > Math.abs(axes[up].y)) up = i;
  if (Math.abs(axes[up].y) < 0.95) return null;
  const centre = {
    x: mesh.position.x + axes[0].x * mid[0] + axes[1].x * mid[1] + axes[2].x * mid[2],
    y: mesh.position.y + axes[0].y * mid[0] + axes[1].y * mid[1] + axes[2].y * mid[2],
    z: mesh.position.z + axes[0].z * mid[0] + axes[1].z * mid[1] + axes[2].z * mid[2],
  };
  const top = centre.y + Math.abs(axes[0].y) * half[0] + Math.abs(axes[1].y) * half[1] + Math.abs(axes[2].y) * half[2];
  const [a, b] = [0, 1, 2].filter((i) => i !== up);
  const yaw = Math.atan2(-axes[a].z, axes[a].x);
  return {
    id: `mesh:${mesh.id}`,
    orientation: 'horizontal',
    label: mesh.label.toLowerCase(),
    center: { x: centre.x, y: top, z: centre.z },
    yaw,
    halfX: half[a],
    halfZ: half[b],
    offsetX: 0,
    offsetZ: 0,
  };
}

/**
 * A surface from scattered hit-test points: the densest height band of up-facing hits in seated reach.
 * The footprint is what the hits covered (at least HITS.min*), turned to face the person.
 */
export function surfaceFromHits(hits: readonly SurfaceHit[], head: HeadPose): PlaneCandidate | null {
  const ok = hits.filter(
    (h) =>
      h.up >= HITS.minUp &&
      h.y >= PLACEMENT.minHeight &&
      h.y <= PLACEMENT.maxHeight &&
      head.position.y - h.y >= PLACEMENT.minHeadClearance &&
      head.position.y - h.y <= PLACEMENT.maxHitDrop &&
      Math.hypot(h.x - head.position.x, h.z - head.position.z) >= HITS.minReach &&
      Math.hypot(h.x - head.position.x, h.z - head.position.z) <= PLACEMENT.maxReach + 0.3,
  );
  if (ok.length < HITS.minCount) return null;
  ok.sort((p, q) => p.y - q.y);
  let bestStart = 0;
  let bestCount = 0;
  for (let i = 0, j = 0; i < ok.length; i++) {
    while (ok[i].y - ok[j].y > HITS.band) j++;
    const count = i - j + 1;
    if (count > bestCount) {
      bestCount = count;
      bestStart = j;
    }
  }
  if (bestCount < HITS.minCount) return null;
  const band = ok.slice(bestStart, bestStart + bestCount);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const h of band) {
    cx += h.x;
    cy += h.y;
    cz += h.z;
  }
  cx /= band.length;
  cy /= band.length;
  cz /= band.length;
  // Local frame facing the person: local Z runs from the centroid toward the head.
  let dx = head.position.x - cx;
  let dz = head.position.z - cz;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  const yaw = Math.atan2(dx, dz); // rotates local +Z onto (dx, dz)
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const h of band) {
    const lx = (h.x - cx) * c - (h.z - cz) * s;
    const lz = (h.x - cx) * s + (h.z - cz) * c;
    minX = Math.min(minX, lx);
    maxX = Math.max(maxX, lx);
    minZ = Math.min(minZ, lz);
    maxZ = Math.max(maxZ, lz);
  }
  return {
    id: 'hit',
    orientation: 'horizontal',
    label: 'surface',
    center: { x: cx, y: cy, z: cz },
    yaw,
    halfX: Math.max(HITS.minHalfX, (maxX - minX) / 2),
    halfZ: Math.max(HITS.minHalfZ, (maxZ - minZ) / 2),
    offsetX: (maxX + minX) / 2,
    offsetZ: (maxZ + minZ) / 2,
  };
}

export interface SurfaceChoice extends TableChoice {
  source: SurfaceSource;
}

/**
 * The real table for tonight: planes first (a plane IS the measured top surface; a volume's box is coarser — in
 * the emulated room the same table reads 0.612 m as a plane and 0.608 m as a volume), table volumes when no plane
 * qualifies, the hit-test surface last (no label, no true bounds). null → the floating desk.
 */
export function chooseSurface(
  input: { planes: readonly PlaneCandidate[]; meshes?: readonly MeshBox[]; hits?: readonly SurfaceHit[] },
  head: HeadPose,
): SurfaceChoice | null {
  const plane = input.planes.length > 0 ? chooseTable(input.planes, head) : null;
  if (plane != null) return { ...plane, source: 'plane' };
  const fromMeshes: PlaneCandidate[] = [];
  for (const m of input.meshes ?? []) {
    const top = meshTop(m);
    if (top != null) fromMeshes.push(top);
  }
  const volume = fromMeshes.length > 0 ? chooseTable(fromMeshes, head) : null;
  if (volume != null) return { ...volume, source: 'mesh' };
  const hit = input.hits != null && input.hits.length > 0 ? surfaceFromHits(input.hits, head) : null;
  if (hit == null) return null;
  const choice = chooseTable([hit], head, { armCheck: false });
  return choice == null ? null : { ...choice, source: 'hit' };
}
