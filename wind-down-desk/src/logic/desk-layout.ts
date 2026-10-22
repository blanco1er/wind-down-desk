/**
 * Desk geometry in desk-local coordinates (pure, unit-tested).
 *
 * Desk frame: origin at the centre of the mat, on the table surface.
 * +Y up, +Z towards the seated user, -Z away from them. Meters.
 * The desk is placed in the world by a `DeskFrame` (position + yaw), so the
 * same layout works on a detected real table or on a virtual fallback desk.
 */

export type BinId = 'tomorrow' | 'later' | 'let-go';
export const BIN_IDS: readonly BinId[] = ['tomorrow', 'later', 'let-go'];

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Bin {
  id: BinId;
  label: string;
  x: number;
  z: number;
  /** Visual radius of the halo. */
  radius: number;
  /** Generous capture radius used on release (snapping). */
  snapRadius: number;
  /** Linear RGB-ish display colour (sRGB hex). */
  color: number;
}

export interface DeskLayout {
  width: number;
  depth: number;
  bins: Bin[];
  tokenRadius: number;
  tokenHeight: number;
  /** Distance under which a held token "feels" the closest bin (hover glow). */
  magnetRadius: number;
  /** A release counts as "on the desk" between these heights (desk-local Y). */
  dropAbove: number;
  dropBelow: number;
  tokenRowZ: number;
  tokenSpacing: number;
  /** Voice lamp (the agent): right of the Let go bowl, fully in view and in reach. */
  orb: { x: number; z: number; radius: number };
  /** Seated distance from the user's eyes (projected) to the mat centre. */
  reach: number;
}

export interface DeskFrame {
  x: number;
  y: number;
  z: number;
  /** Rotation around +Y (radians, Three.js convention). Desk +Z faces the user. */
  yaw: number;
}

export function createDeskLayout(): DeskLayout {
  const binZ = -0.088;
  return {
    width: 0.84,
    depth: 0.44,
    bins: [
      { id: 'tomorrow', label: 'Tomorrow', x: -0.25, z: binZ, radius: 0.1, snapRadius: 0.135, color: 0xffc36b },
      { id: 'later', label: 'Later', x: 0, z: binZ, radius: 0.1, snapRadius: 0.135, color: 0x8fb8ff },
      { id: 'let-go', label: 'Let go', x: 0.25, z: binZ, radius: 0.1, snapRadius: 0.135, color: 0xc9a8ff },
    ],
    tokenRadius: 0.05,
    tokenHeight: 0.018,
    magnetRadius: 0.17,
    dropAbove: 0.24,
    dropBelow: 0.09,
    tokenRowZ: 0.128,
    tokenSpacing: 0.118,
    // Where the lamp always stands (v5 position; v6 ornaments moved to a row in front of the tray).
    orb: { x: 0.352, z: 0.035, radius: 0.03 },
    reach: 0.42,
  };
}

/** Desk-local → world. */
export function deskToWorld(frame: DeskFrame, local: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const c = Math.cos(frame.yaw);
  const s = Math.sin(frame.yaw);
  const x = local.x * c + local.z * s;
  const z = -local.x * s + local.z * c;
  out.x = frame.x + x;
  out.y = frame.y + local.y;
  out.z = frame.z + z;
  return out;
}

/** World → desk-local. */
export function worldToDesk(frame: DeskFrame, world: Vec3, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const c = Math.cos(frame.yaw);
  const s = Math.sin(frame.yaw);
  const dx = world.x - frame.x;
  const dz = world.z - frame.z;
  out.x = dx * c - dz * s;
  out.y = world.y - frame.y;
  out.z = dx * s + dz * c;
  return out;
}

/**
 * Index of the closest bin within `radius` (desk plane distance), or -1.
 * Allocation-free: safe to call every frame while a token is held.
 */
export function nearestBinIndex(local: Vec3, layout: DeskLayout, radius: number): number {
  let best = -1;
  let bestDistance = radius;
  for (let i = 0; i < layout.bins.length; i++) {
    const bin = layout.bins[i];
    const distance = Math.hypot(local.x - bin.x, local.z - bin.z);
    if (distance <= bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/** Bin a released token snaps into, or null when it misses (it then glides home). */
export function classifyDrop(local: Vec3, layout: DeskLayout): BinId | null {
  if (local.y > layout.dropAbove || local.y < -layout.dropBelow) {
    return null;
  }
  let best: Bin | null = null;
  let bestDistance = Infinity;
  for (const bin of layout.bins) {
    const distance = Math.hypot(local.x - bin.x, local.z - bin.z);
    if (distance <= bin.snapRadius && distance < bestDistance) {
      best = bin;
      bestDistance = distance;
    }
  }
  return best?.id ?? null;
}

export function binById(layout: DeskLayout, id: BinId): Bin {
  const bin = layout.bins.find((b) => b.id === id);
  if (bin == null) {
    throw new Error(`Unknown bin ${id}`);
  }
  return bin;
}

const ROW_SCATTER: ReadonlyArray<readonly [number, number]> = [
  [0.003, -0.004],
  [-0.002, 0.012],
  [0.002, -0.009],
  [-0.003, 0.008],
  [0.001, -0.006],
];

/** Resting place of the n-th unsorted token: one row, or two staggered rows above 5. */
export function homePosition(index: number, count: number, layout: DeskLayout): Vec3 {
  const y = layout.tokenHeight / 2;
  if (count <= 5) {
    const offset = (index - (count - 1) / 2) * layout.tokenSpacing;
    // A loose, hand-placed row rather than a grid (≤ 1.4 cm; spacing stays ≥ 2 radii).
    return { x: offset + ROW_SCATTER[index % 5][0], y, z: layout.tokenRowZ + ROW_SCATTER[index % 5][1] };
  }
  const front = Math.ceil(count / 2);
  const row = index < front ? 0 : 1;
  const inRow = row === 0 ? index : index - front;
  const rowCount = row === 0 ? front : count - front;
  // Two staggered rows (v7 larger stones): the back row sits half a step aside so neighbours never touch.
  const stagger = row === 1 && (front - (count - front)) % 2 === 0 ? layout.tokenSpacing / 2 : 0;
  const offset = (inRow - (rowCount - 1) / 2) * layout.tokenSpacing + stagger;
  return { x: offset, y, z: row === 0 ? layout.tokenRowZ - 0.045 : layout.tokenRowZ + 0.045 };
}

/** Stones shrink a little once sorted, so a halo holds a tidy pile. */
export const BIN_STONE_SCALE = 0.78;

/**
 * A loose pile inside the halo: each new stone rests on the previous ones
 * (golden-angle offsets, stacked by the stone thickness) so the pile reads as
 * physical and the top label stays readable.
 */
export function slotPosition(bin: Bin, slot: number, layout: DeskLayout): Vec3 {
  const h = layout.tokenHeight * BIN_STONE_SCALE;
  if (slot === 0) {
    return { x: bin.x, y: h / 2, z: bin.z };
  }
  const angle = slot * 2.399963;
  const r = Math.min(bin.radius * 0.5, 0.012 + 0.008 * Math.sqrt(slot));
  return {
    x: bin.x + Math.cos(angle) * r,
    y: h / 2 + Math.min(slot, 6) * h * 0.82,
    z: bin.z + Math.sin(angle) * r,
  };
}

/** True when a desk-local point sits on the mat footprint (with a small margin). */
export function onMat(local: Vec3, layout: DeskLayout, margin = 0.03): boolean {
  return Math.abs(local.x) <= layout.width / 2 + margin && Math.abs(local.z) <= layout.depth / 2 + margin;
}
