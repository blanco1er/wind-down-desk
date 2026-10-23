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

/** Angle (degrees) between the head ray and a point. */
export function gazeAngle(head: Vec3, dir: Vec3, p: Vec3): number {
  const vx = p.x - head.x;
  const vy = p.y - head.y;
  const vz = p.z - head.z;
  const d = Math.hypot(vx, vy, vz) * Math.hypot(dir.x, dir.y, dir.z);
  if (d < 1e-8) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, (vx * dir.x + vy * dir.y + vz * dir.z) / d))) * 180) / Math.PI;
}

/**
 * 23 Oct: a stable head-gaze focus the jury can SEE (a soft halo on the stone you look at). A new target needs
 * ~250 ms of dwell; the current one is kept while it stays within the wider "keep" cone, and for 0.3 s after the
 * head leaves it: no flicker between neighbouring stones, no halo that blinks while the head drifts.
 */
export class GazeFocus {
  focused: string | null = null;
  private candidate: string | null = null;
  private heldFor = 0;
  private lostFor = 0;
  readonly dwell: number;
  readonly release: number;
  constructor(dwell = 0.25, release = 0.3) {
    this.dwell = dwell;
    this.release = release;
  }

  /** `pick`: the target in the narrow cone now; `keep`: the current focus is still inside the wide cone. */
  update(pick: string | null, keep: boolean, dt: number): string | null {
    const seen = pick ?? (keep ? this.focused : null);
    if (seen != null && seen === this.focused) {
      this.lostFor = 0;
      this.candidate = null;
      this.heldFor = 0;
      return this.focused;
    }
    if (seen !== this.candidate) {
      this.candidate = seen;
      this.heldFor = 0;
    }
    this.heldFor += dt;
    if (this.focused != null && !keep) this.lostFor += dt;
    if (seen != null && this.heldFor >= this.dwell) {
      this.focused = seen;
      this.candidate = null;
      this.heldFor = 0;
      this.lostFor = 0;
    } else if (this.focused != null && !keep && this.lostFor >= this.release) {
      this.focused = null;
      this.lostFor = 0;
    }
    return this.focused;
  }
}

/**
 * Owner's rules for gaze reactions (23 Oct): only useful objects react (lamp, stones, bowls); ~250 ms dwell; soft
 * rise and fall (≥ 300 ms, never a flash); hysteresis; one object at a time; halved during calm moments.
 * Gaze = eye gaze where the runtime provides it, head gaze on Quest 3 / 3S (they have no eye tracking).
 */
export const GAZE = {
  dwell: 0.25,
  release: 0.3,
  /** Cone to take a new target / to keep the current one (degrees). */
  take: 7,
  keep: 10,
  /** Exponential rate of reactions (1/s): 27 % after 100 ms, 63 % after 310 ms, 95 % after 0.94 s. */
  rate: 3.2,
  /** Reactions during Breathe, Release and the night are half as strong. */
  calm: 0.5,
} as const;

/** Soft approach of a reaction level toward its target (frame-rate independent, no overshoot). */
export function easeToward(current: number, target: number, dt: number, rate: number = GAZE.rate): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}
