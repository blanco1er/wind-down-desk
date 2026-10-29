/**
 * 28 Oct — "Good night", alive (pure, unit-tested).
 *
 * 1. Your sky on your ceiling: the stars of the things you let go leave the lamp's sky and settle on the real
 *    ceiling (scene understanding: a ceiling plane, else a ceiling volume, else a virtual dome above you), inside a
 *    50° cone above your seat, never behind you.
 * 2. "Stay till I sleep": instead of closing 8.5 s later, the lamp offers to stay. Light and sound sink very slowly
 *    over 10, 20 or 30 minutes; the sky breathes slower and slower (6 → 5 breaths a minute), then the session ends
 *    by itself. An open hand lowered slowly (a dimmer) or "dimmer" makes it darker sooner; "lights out" ends now.
 */
import type { MeshBox } from './surfaces.ts';
import type { PlaneCandidate } from './placement.ts';

export const SLEEP_MINUTES = [10, 20, 30] as const;
export const DEFAULT_SLEEP_MINUTES = 20;
/** Unanswered, the lamp stays (the gentle default: nothing goes dark suddenly) for the shortest time. */
export const UNANSWERED_STAY_S = 30;
/** Half-angle of the cone above the seat where the ceiling stars may land (comfort: no craning back). */
export const CEILING_CONE_DEG = 50;

export const SLEEP_LINES = {
  ceiling: 'Your sky, on your ceiling.',
  dome: 'Your sky, above you.',
  ask: 'Shall I stay until you fall asleep?',
  stay: 'I will stay. Everything will fade slowly.',
  leave: 'Sleep well.',
} as const;

export interface SleepLevels {
  /** 0..1 progress of the fade. */
  k: number;
  /** Light left (stars, the room's own dimming toward dark): 1 → 0. */
  light: number;
  /** Sound left (ambience, living places): 1 → 0, a little ahead of the light. */
  sound: number;
  /** The sky's slow breath. */
  breathsPerMinute: number;
  done: boolean;
}

function smooth(k: number): number {
  const c = Math.min(1, Math.max(0, k));
  return c * c * (3 - 2 * c);
}

/** Levels `seconds` into a fade of `minutes` (plus `boost` seconds taken by the dimmer gesture). */
export function sleepLevels(seconds: number, minutes: number, boost = 0): SleepLevels {
  const total = Math.max(60, minutes * 60);
  const k = Math.min(1, Math.max(0, (seconds + boost) / total));
  return {
    k,
    light: 1 - smooth(k),
    sound: Math.pow(1 - k, 1.6),
    breathsPerMinute: 6 - k,
    done: k >= 1,
  };
}

/** How much one dimmer stroke brings the end forward (seconds). */
export function dimStrokeSeconds(minutes: number): number {
  return Math.max(60, minutes * 60) * 0.15;
}

/**
 * The dimmer: an open hand lowered slowly by ≥ 10 cm within 1.5 s. One stroke per gesture (the hand must rise
 * again, or rest, before the next one counts).
 */
export class DimGesture {
  private top: { y: number; t: number } | null = null;
  private armed = true;
  private low = Infinity;

  /** Returns true on the frame a stroke completes. `open`: 0..1 hand openness; null: hand not tracked. */
  sample(t: number, y: number | null, open: number | null): boolean {
    if (y == null || open == null || open < 0.6) {
      this.top = null;
      this.armed = true;
      this.low = Infinity;
      return false;
    }
    if (!this.armed) {
      // After a stroke the hand must rise again (4 cm above its lowest point) before the next one counts.
      this.low = Math.min(this.low, y);
      if (y > this.low + 0.04) {
        this.armed = true;
        this.top = { y, t };
      }
      return false;
    }
    // The stroke starts at the highest recent point; a hand resting there keeps it fresh.
    if (this.top == null || y >= this.top.y - 0.004 || t - this.top.t > 1.5) {
      this.top = { y: this.top != null && y < this.top.y && t - this.top.t <= 1.5 ? this.top.y : y, t };
      return false;
    }
    if (this.top.y - y >= 0.1) {
      this.armed = false;
      this.low = y;
      this.top = null;
      return true;
    }
    return false;
  }
}

export type SleepCommand = { type: 'stay'; minutes?: number } | { type: 'leave' } | { type: 'dimmer' } | { type: 'minutes'; minutes: number };

const MINUTE_WORDS: Record<string, number> = { ten: 10, '10': 10, twenty: 20, '20': 20, thirty: 30, '30': 30, 'half an hour': 30, fifteen: 15, '15': 15 };

/** What the voice can say in the night (normalized text). */
export function parseSleepCommand(n: string): SleepCommand | null {
  const minutes = /^(?:stay (?:for )?)?(ten|twenty|thirty|fifteen|10|20|30|15|half an hour)(?: minutes?| mins?)?$/u.exec(n);
  if (minutes != null) return { type: 'minutes', minutes: MINUTE_WORDS[minutes[1]] };
  if (/^(stay|stay with me|yes stay|please stay|stay please|stay until i sleep|stay till i sleep|keep me company)$/u.test(n)) return { type: 'stay' };
  if (/^(lights out|turn it off|turn off|switch off|goodbye|bye|end|end it|im asleep|leave|you can go|no thanks|not tonight)$/u.test(n)) return { type: 'leave' };
  if (/^(dimmer|darker|dim( the lights| it)?|lower( the lights)?|less light|quieter)$/u.test(n)) return { type: 'dimmer' };
  return null;
}

export interface Ceiling {
  /** World height of the ceiling (or of the virtual dome's top). */
  y: number;
  source: 'plane' | 'mesh' | 'dome';
}

/**
 * The room's ceiling, from scene understanding: a plane labelled "ceiling" (or a horizontal plane well above the
 * head), else a volume labelled "ceiling"; else a virtual dome 1.1 m above the head. Ceilings lower than 0.45 m
 * above the head (a shelf seen as a plane) or higher than 4 m are ignored.
 */
export function findCeiling(planes: readonly PlaneCandidate[], meshes: readonly MeshBox[], headY: number): Ceiling {
  const ok = (y: number) => y > headY + 0.45 && y < 4.2;
  let best: number | null = null;
  for (const p of planes) {
    const label = p.label.toLowerCase();
    if (label === 'ceiling' && ok(p.center.y)) best = best == null ? p.center.y : Math.min(best, p.center.y);
  }
  if (best != null) return { y: best, source: 'plane' };
  for (const p of planes) {
    if (p.orientation === 'horizontal' && p.label === '' && ok(p.center.y) && p.center.y > headY + 0.8) best = best == null ? p.center.y : Math.min(best, p.center.y);
  }
  if (best != null) return { y: best, source: 'plane' };
  for (const m of meshes) {
    if (m.label.toLowerCase() !== 'ceiling') continue;
    const y = m.position.y + m.min.y;
    if (ok(y)) best = best == null ? y : Math.min(best, y);
  }
  if (best != null) return { y: best, source: 'mesh' };
  return { y: headY + 1.1, source: 'dome' };
}

/**
 * Where star `seed` lands (world): on the ceiling plane inside the cone above the seat, centred a little in front of
 * the head (where you look when you lie back), spread evenly by the seed. On a dome, the same directions at 1.1 m.
 * `forward`: the horizontal direction the seat faces (unit x, z).
 */
export function ceilingPoint(seed: number, head: { x: number; y: number; z: number }, forward: { x: number; z: number }, ceiling: Ceiling): { x: number; y: number; z: number } {
  const u = ((seed & 0xffff) / 0xffff) * Math.PI * 2;
  const v = Math.sqrt(((seed >>> 16) & 0xffff) / 0xffff);
  const lift = Math.max(0.45, ceiling.y - head.y);
  // Centre 0.35 × the height in front of the head; the disc stays inside the cone (centre offset + radius ≤ tan 50°).
  const ahead = 0.35;
  const cx = head.x + forward.x * lift * ahead;
  const cz = head.z + forward.z * lift * ahead;
  const r = v * lift * (Math.tan((CEILING_CONE_DEG * Math.PI) / 180) - ahead) * 0.95;
  const x = cx + Math.cos(u) * r;
  const z = cz + Math.sin(u) * r;
  if (ceiling.source !== 'dome') return { x, y: ceiling.y - 0.01, z };
  // Dome: the same direction, at 1.1 m from the head.
  const dx = x - head.x;
  const dz = z - head.z;
  const len = Math.hypot(dx, lift, dz);
  return { x: head.x + (dx / len) * 1.1, y: head.y + (lift / len) * 1.1, z: head.z + (dz / len) * 1.1 };
}
