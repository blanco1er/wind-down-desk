/**
 * Head-gaze targeting for "this one" in voice commands (pure, unit-tested).
 * Quest 3 has no eye tracking, so the head ray is the honest signal.
 */
import type { Vec3 } from './desk-layout.ts';

export interface GazeTarget extends Vec3 {
  id: string;
}

/**
 * Returns the id of the target closest to the head ray within `maxAngleDeg`,
 * or null. `dir` need not be normalized.
 */
export function gazePick(head: Vec3, dir: Vec3, targets: readonly GazeTarget[], maxAngleDeg = 9): string | null {
  const dLen = Math.hypot(dir.x, dir.y, dir.z);
  if (dLen === 0) {
    return null;
  }
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180);
  let best: string | null = null;
  let bestCos = cosMax;
  for (const t of targets) {
    const vx = t.x - head.x;
    const vy = t.y - head.y;
    const vz = t.z - head.z;
    const vLen = Math.hypot(vx, vy, vz);
    if (vLen < 1e-4) {
      continue;
    }
    const cos = (vx * dir.x + vy * dir.y + vz * dir.z) / (vLen * dLen);
    if (cos >= bestCos) {
      bestCos = cos;
      best = t.id;
    }
  }
  return best;
}
