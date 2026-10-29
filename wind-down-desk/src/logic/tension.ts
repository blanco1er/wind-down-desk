/**
 * 28 Oct — "How heavy tonight?" (pure, unit-tested). One glass bead on a short brass rail, slid with a fingertip from
 * "light" (0) to "heavy" (10): once when the evening starts, once before Good night. Never a form: one gesture, and
 * the lamp lets it go if you do something else. The voice ("about a seven", "pretty heavy") and touch words
 * ("Light", "Some", "Heavy") do the same.
 *
 *   rail (desk-local): x0 ─────────●───────── x1      bead u ∈ [0, 1] → value round(u × 10)
 *
 * The bead follows a fingertip that touches the rail (or pinches near it); once the finger leaves and the bead has
 * been still for a moment, the value is kept.
 */
import { normalize } from './text.ts';

export const TENSION_MAX = 10;

/** Where the rail lies on the tray (desk-local metres): in front, centred, within a seated reach. */
export const RAIL = {
  x0: -0.125,
  x1: 0.125,
  z: 0.152,
  y: 0.024,
  /** A fingertip within this distance of the rail line (horizontally) and this height band moves the bead. */
  touchZ: 0.04,
  touchBelow: 0.02,
  touchAbove: 0.055,
  /** Margin past each end that still counts (the bead stops at the end). */
  endMargin: 0.03,
  /** Bead radius (the touch band is ≥ 4.4 cm wide all along the rail). */
  bead: 0.0135,
} as const;

export type TensionSide = 'in' | 'out';

export function tensionValue(u: number): number {
  return Math.round(Math.min(1, Math.max(0, u)) * TENSION_MAX);
}

export function tensionU(value: number): number {
  return Math.min(1, Math.max(0, value / TENSION_MAX));
}

/** A desk-local fingertip → rail position (0..1) if it touches the rail, else null. */
export function railTouch(p: { x: number; y: number; z: number }): number | null {
  if (Math.abs(p.z - RAIL.z) > RAIL.touchZ) return null;
  const dy = p.y - RAIL.y;
  if (dy < -RAIL.touchBelow || dy > RAIL.touchAbove) return null;
  if (p.x < RAIL.x0 - RAIL.endMargin || p.x > RAIL.x1 + RAIL.endMargin) return null;
  return Math.min(1, Math.max(0, (p.x - RAIL.x0) / (RAIL.x1 - RAIL.x0)));
}

/** A word for a value (captions, the journal). */
export function tensionWord(value: number): string {
  if (value <= 2) return 'light';
  if (value <= 4) return 'a little heavy';
  if (value <= 6) return 'some weight';
  if (value <= 8) return 'heavy';
  return 'very heavy';
}

const NUMBERS: Record<string, number> = { zero: 0, nothing: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/**
 * A spoken answer while the bead waits: "seven", "about a 7", "six out of ten", "pretty heavy", "light". `skip` for
 * "skip" / "not now" / "pass". Null for anything else (a brain dump goes on as usual).
 */
export function parseTension(text: string): number | 'skip' | null {
  const n = normalize(text)
    .replace(/\b(um+|uh+|hmm+|i think|i guess|i would say|id say|probably|maybe|about|around|like|its|it is|a|an|tonight|honestly|really|out of (ten|10)|on ten|over ten|\/10)\b/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (n.length === 0) return null;
  if (/^(skip|pass|not now|no thanks|later|dont know|i dont know|no idea|skip it)$/u.test(n)) return 'skip';
  const digit = /^(\d{1,2})$/u.exec(n);
  if (digit != null) {
    const v = Number(digit[1]);
    return v <= TENSION_MAX ? v : null;
  }
  if (NUMBERS[n] != null) return NUMBERS[n];
  if (/^(very|super|so|really really) heavy$|^crushing$|^awful$|^terrible$/u.test(n)) return 9;
  if (/^(pretty|quite|fairly|rather) heavy$|^heavy$|^bad$|^rough$|^tense$/u.test(n)) return 8;
  if (/^(a (little|bit)|bit|little|somewhat|kind of|kinda) heavy$|^not great$/u.test(n)) return 6;
  if (/^(medium|middle|in the middle|so so|okay|ok|fine|alright|all right|average|some|some weight)$/u.test(n)) return 5;
  if (/^(pretty|quite|fairly) light$|^light$|^calm$|^good$/u.test(n)) return 2;
  if (/^(very|super|so) light$|^weightless$|^great$|^peaceful$/u.test(n)) return 1;
  return null;
}

/** Touch words under the caption while the bead waits (the same values as the voice). */
export const TENSION_WORDS: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'Light', value: 2 },
  { label: 'Some', value: 5 },
  { label: 'Heavy', value: 8 },
];

/** The bead and the fingers: follows a touching finger, keeps the value once the finger has left and it is still. */
export class TensionDial {
  /** 0..1 where the bead is (eased toward `target`). */
  u: number;
  target: number;
  touching = false;
  private touched = false;
  private releasedAt = -1;
  private lastMoveAt = 0;
  committed: number | null = null;

  constructor(start = 0.5) {
    this.u = start;
    this.target = start;
  }

  /** A finger on the rail at `u` (null: no finger). Returns true on the frame the finger first touches. */
  finger(u: number | null, t: number): boolean {
    if (this.committed != null) return false;
    if (u == null) {
      if (this.touching) {
        this.touching = false;
        this.releasedAt = t;
      }
      return false;
    }
    const first = !this.touching;
    this.touching = true;
    this.touched = true;
    if (Math.abs(u - this.target) > 0.004) this.lastMoveAt = t;
    this.target = u;
    return first;
  }

  /** Voice or a touch word: the bead glides there, kept at once. */
  set(value: number): number {
    this.target = tensionU(value);
    this.committed = tensionValue(this.target);
    this.touching = false;
    return this.committed;
  }

  /** Eases the bead; returns the value the frame it is kept (once), else null. */
  tick(t: number, dt: number): number | null {
    const rate = this.touching ? 22 : 8;
    this.u += (this.target - this.u) * (1 - Math.exp(-rate * dt));
    if (this.committed != null || !this.touched || this.touching) return null;
    if (t - this.releasedAt >= 0.9 && t - this.lastMoveAt >= 0.9) {
      this.committed = tensionValue(this.target);
      return this.committed;
    }
    return null;
  }

  get value(): number {
    return tensionValue(this.target);
  }
}

/**
 * What the lamp says when the bead is kept before Good night (spoken; fixed catalogue). The numbers stay in the
 * small line ("7 → 3"): the voice never reads a score.
 */
export const CHECKOUT_LINES = {
  lighter: 'Lighter than when you came in.',
  same: 'About the same as when you came in. That is okay.',
  heavier: 'A little heavier tonight. That is okay too.',
  only: 'Thank you. Sleep well.',
} as const;

export const TENSION_LINES = {
  askIn: 'How heavy is tonight? Slide the bead.',
  askOut: 'Before you sleep: how heavy now?',
  keptIn: 'Thank you. I will remember it.',
} as const;

export function checkoutLine(tensionIn: number | null | undefined, tensionOut: number): string {
  if (tensionIn == null) return CHECKOUT_LINES.only;
  if (tensionOut <= tensionIn - 2) return CHECKOUT_LINES.lighter;
  if (tensionOut >= tensionIn + 2) return CHECKOUT_LINES.heavier;
  return CHECKOUT_LINES.same;
}

/** "7 → 3" (or "3" alone). */
export function tensionArrow(tensionIn: number | null | undefined, tensionOut: number | null | undefined): string {
  if (tensionIn != null && tensionOut != null) return `${tensionIn} → ${tensionOut}`;
  if (tensionOut != null) return `${tensionOut}`;
  if (tensionIn != null) return `${tensionIn} →`;
  return '';
}

/** The evening's summary line before the lamp goes out: "Tonight: 3 let go · 6 breaths · 7 → 3". */
export function nightSummary(n: { letGo: number; breaths: number; kept: number; tensionIn?: number | null; tensionOut?: number | null }): string {
  const parts: string[] = [];
  if (n.letGo > 0) parts.push(`${n.letGo} let go`);
  if (n.breaths > 0) parts.push(`${n.breaths} ${n.breaths === 1 ? 'breath' : 'breaths'}`);
  if (n.kept > 0) parts.push(`${n.kept} good ${n.kept === 1 ? 'thing' : 'things'} kept`);
  const arrow = tensionArrow(n.tensionIn, n.tensionOut);
  if (arrow.length > 0 && n.tensionIn != null && n.tensionOut != null) parts.push(arrow);
  return parts.length === 0 ? 'A quiet evening.' : `Tonight: ${parts.join(' · ')}`;
}
