/**
 * 29 Oct (coordinator review, video/objets-tripo-28oct/avant-apres-keepsakes-close.jpg: "the saucer seems to float"):
 * the keepsakes must sit ON the table. Measured in public/models/keepsakes.glb: each model's lowest point is at its
 * local y = 0 (placed at the table's height), the saucer's foot ring (radius ≤ 4 cm) touches, and its rim rises to
 * 5.8 mm at 5.3 cm, as a real saucer does. Without a shadow under that rim the gap read as floating: each keepsake
 * now has a soft contact shadow on the table, a little wider than its footprint (keepsakes.ts, kind SHADOW).
 * Pure numbers (tests/keepsake-ground.test.ts reads the model itself).
 */
import type { Keepsake } from './milestones.ts';

/** Contact shadow radius on the table (metres) and its darkness under the object's centre (0..1). */
export const KEEPSAKE_SHADOW: Record<Keepsake, { radius: number; dark: number }> = {
  pebble: { radius: 0.03, dark: 0.6 },
  cup: { radius: 0.068, dark: 0.7 },
  plant: { radius: 0.04, dark: 0.65 },
};
/** The shadow lies this far above the table (no z-fighting with a real or emulated table, invisible as a gap). */
export const SHADOW_LIFT = 0.0006;
/** A keepsake "touches" when its lowest point is within this of the table. */
export const TOUCH_TOLERANCE = 0.0005;

/** Lowest y, and the lowest y per ring of the footprint (radius from the vertical axis, 5 mm rings). */
export function groundProfile(positions: ArrayLike<number>): { minY: number; footprint: number; rings: Array<{ r: number; y: number }> } {
  let minY = Infinity;
  let footprint = 0;
  const rings = new Map<number, number>();
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const r = Math.hypot(x, z);
    minY = Math.min(minY, y);
    footprint = Math.max(footprint, r);
    const k = Math.floor(r / 0.005) * 0.005;
    rings.set(k, Math.min(rings.get(k) ?? Infinity, y));
  }
  return { minY, footprint, rings: [...rings.entries()].sort((a, b) => a[0] - b[0]).map(([r, y]) => ({ r: +r.toFixed(3), y })) };
}
