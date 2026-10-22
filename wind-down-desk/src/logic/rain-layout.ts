/**
 * v8 — Rain layout (pure, unit-tested): where drops may fall around the seat. You sit sheltered under the
 * veranda roof (an ellipse around the seat) with the house behind you: nothing is ever placed there.
 * Seat frame: x to the right, z toward you, metres on the floor; yaw 0 = ahead, positive = right.
 */
import type { RainSpec } from './places.ts';

/** Deterministic PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roof edge distance at a yaw (radians, 0 = ahead): an ellipse, front `roofFront`, sides `roofSide`. */
export function roofEdge(spec: RainSpec, yaw: number): number {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  if (c <= 0) return spec.roofSide;
  return 1 / Math.sqrt((s / spec.roofSide) ** 2 + (c / spec.roofFront) ** 2);
}

/** True when a floor point (seat frame: x right, z toward you, metres) is sheltered (under the roof or behind). */
export function sheltered(spec: RainSpec, x: number, z: number): boolean {
  const yaw = Math.atan2(x, -z);
  const deg = (yaw * 180) / Math.PI;
  if (deg < spec.open[0] || deg > spec.open[1]) return true;
  return Math.hypot(x, z) < roofEdge(spec, yaw);
}

const LAYERS = [
  { min: 0, max: 4.0 },
  { min: 4.0, max: 10.0 },
  { min: 10.0, max: 24.0 },
] as const;

/** Instance seeds of the drops: (yaw, distance, phase, layer). Layer 3 = eave drips. Pure, tested. */
export function dropSeeds(spec: RainSpec, seed = 7): Float32Array {
  const rnd = prng(seed);
  const drips = 40;
  const total = spec.drops[0] + spec.drops[1] + spec.drops[2] + drips;
  const out = new Float32Array(total * 4);
  let o = 0;
  const open0 = (spec.open[0] * Math.PI) / 180;
  const open1 = (spec.open[1] * Math.PI) / 180;
  LAYERS.forEach((layer, li) => {
    for (let i = 0; i < spec.drops[li]; i++) {
      let yaw = 0;
      let r = 0;
      for (let k = 0; k < 20; k++) {
        yaw = open0 + (open1 - open0) * rnd();
        const lo = Math.max(layer.min, roofEdge(spec, yaw) + 0.08);
        // Area-uniform in the annulus.
        r = Math.sqrt(lo * lo + (layer.max * layer.max - lo * lo) * rnd());
        if (r > lo) break;
      }
      out.set([yaw, r, rnd(), li], o);
      o += 4;
    }
  });
  for (let i = 0; i < drips; i++) {
    const yaw = open0 + 0.1 + (open1 - open0 - 0.2) * ((i + rnd() * 0.6) / drips);
    out.set([yaw, roofEdge(spec, yaw) + 0.03, rnd(), 3 + rnd() * 0.9], o);
    o += 4;
  }
  return out;
}
