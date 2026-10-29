/**
 * 28 Oct — "Keep": three good things of the day (pure, unit-tested). The opposite of letting go: each good thing,
 * said or touched, becomes a small warm light that floats to its place in the room and stays there, evening after
 * evening. The sky keeps what you let go; the room keeps what you love.
 */
import { recurring } from './journal.ts';
import type { NightRecord } from './memory.ts';
import { normalize } from './text.ts';

/** How many good things one evening asks for (fewer is fine: "That's all"). */
export const KEEP_COUNT = 3;

/** Touch words (and Write…): the quiet evening's way in, and anyone's who does not want to speak. */
export const KEEP_CHOICES = ['Someone kind', 'A good meal', 'Rest', 'Something I made', 'Time outside', 'A laugh', 'Music', 'A small win'] as const;

export const KEEP_LINES = {
  start: 'Three good things from today. Say one, or touch one.',
  one: 'One. Keep it close.',
  two: 'Two. One more.',
  three: 'Three good things. They stay with you.',
  fewer: 'Enough for tonight. They stay with you.',
} as const;

/** The line after the n-th good thing (1-based). */
export function keepLine(n: number): string {
  if (n <= 1) return KEEP_LINES.one;
  if (n === 2) return KEEP_LINES.two;
  return KEEP_LINES.three;
}

/**
 * What is kept from a sentence: the good thing itself, at most six words ("I'm really grateful for the long call with
 * my sister today" → "The long call with my sister"). Null when nothing is left.
 */
export function goodThing(text: string): string | null {
  let t = text.trim().replace(/[.!?…]+$/u, '');
  t = t.replace(/^(and\s+|also\s+|um+\s+|uh+\s+|well\s+|so\s+)+/iu, '');
  t = t.replace(/^(i(?:'| a)?m|i am|i was|i feel|i felt)\s+(really\s+|so\s+|very\s+)?(grateful|thankful|happy|glad)\s+(for|about|that)\s+/iu, '');
  t = t.replace(/^(grateful|thankful|happy|glad)\s+(for|about|that)\s+/iu, '');
  t = t.replace(/^(a good thing( today)?( was| is)?|the good thing( today)?( was| is)?|today)\s*[:,]?\s*/iu, '');
  t = t.replace(/\s+(today|tonight|this evening|this morning)$/iu, '');
  const words = t.split(/\s+/u).filter(Boolean);
  if (words.length === 0) return null;
  const short = words.slice(0, 6).join(' ');
  return `${short.charAt(0).toUpperCase()}${short.slice(1)}`;
}

/** The touch words still to offer tonight (what was already kept is not offered again). */
export function keepChoices(used: ReadonlySet<string>): string[] {
  return KEEP_CHOICES.filter((c) => !used.has(c)).slice(0, 6);
}

/** Answers that end the ritual early ("that's all", "done"): handled as a command, never kept as a good thing. */
export function isKeepDone(text: string): boolean {
  return /^(thats all|thats it|done|im done|no more|nothing else|enough|thats enough|that is all)$/u.test(normalize(text));
}

/**
 * Where the n-th kept light floats (desk-local): a loose ring behind and beside the desk, between 18 and 50 cm above
 * the tray, never in front of it (the tray and your hands stay clear). Golden-angle spread so they never pile up.
 */
export function keptPlace(index: number, seed: number): { x: number; y: number; z: number } {
  const g = (index * 0.618034 + ((seed & 0xff) / 0xff) * 0.17) % 1;
  // Azimuth over the back half and the sides (desk +Z faces you): from the left side round to the right side.
  const a = Math.PI * (0.06 + 0.88 * g);
  const r = 0.5 + (((seed >>> 8) & 0xff) / 0xff) * 0.2;
  const h = 0.18 + (((seed >>> 16) & 0xff) / 0xff) * 0.32;
  return { x: Math.cos(a) * r, y: h, z: -Math.sin(a) * r * 0.8 - 0.05 };
}

/**
 * 29 Oct (owner: "the kept lights are almost invisible: one orange dot over an empty tray"): tonight's lights do not
 * fly off above the frame. Each one comes to rest just above the tray's back rim, a few centimetres high, in the band
 * the seated eye sees between the rim and the buttons above it — so it stays in view, and its warm light falls on the
 * rim, the back of the tray and the bowls (faux light in the rig). Never in the middle, where the reply buttons
 * stand; spread left / right in arrival order; a little jitter per good thing. From the 7th on, the ring above.
 */
export const KEPT_NEAR = [
  { x: -0.21, y: 0.046, z: -0.212 },
  { x: 0.21, y: 0.044, z: -0.212 },
  { x: 0.33, y: 0.048, z: -0.205 },
  { x: -0.33, y: 0.05, z: -0.205 },
  { x: -0.11, y: 0.04, z: -0.225 },
  { x: 0.11, y: 0.04, z: -0.225 },
] as const;

/** Where tonight's n-th good thing comes to rest (desk-local). */
export function keptPlaceNear(n: number, seed: number): { x: number; y: number; z: number } {
  if (n >= KEPT_NEAR.length) return keptPlace(n, seed);
  const s = KEPT_NEAR[n];
  const j = (shift: number) => (((seed >>> shift) & 0xff) / 0xff - 0.5) * 2;
  return { x: s.x + 0.012 * j(0), y: s.y + 0.008 * j(8), z: s.z + 0.012 * j(16) };
}

/** The journey of a kept light (seconds): resting in cupped hands (else a short pause at the lamp), then the flight. */
/** `travelWall`: the longer flight to a wall of the room. */
export const KEPT_FLIGHT = { restCupped: 1.5, restLamp: 0.3, travel: 3.6, travelWall: 4.4, wordIn: 0.5, wordHold: 2.8, wordOut: 1.0 } as const;

/**
 * A kept light's position at progress k (0..1) from `a` to `b` (same formula as the shader in particles.ts): it rises
 * first (the height leads, eased out) and arcs up by ≈ 10 cm, sways a little sideways, then settles softly onto its
 * place. `seed` 0..1.
 */
export function keptFlight(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, k: number, seed: number): { x: number; y: number; z: number } {
  const c = Math.min(1, Math.max(0, k));
  const exz = c * c * (3 - 2 * c);
  const ey = 1 - Math.pow(1 - c, 3);
  const lift = (0.1 + 0.03 * seed) * Math.sin(Math.PI * c) * (1 - 0.35 * c);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const sway = 0.035 * Math.sin(2 * Math.PI * c) * (seed - 0.5) * 2;
  return {
    x: a.x + dx * exz + (-dz / len) * sway,
    y: a.y + (b.y - a.y) * ey + lift,
    z: a.z + dz * exz + (dx / len) * sway,
  };
}

/** How visible the kept word is, `t` seconds after its light has landed (0 before, then in / hold / out). */
export function keptWordAlpha(t: number): number {
  const f = KEPT_FLIGHT;
  if (t < 0) return 0;
  if (t < f.wordIn) return t / f.wordIn;
  if (t < f.wordIn + f.wordHold) return 1;
  return Math.max(0, 1 - (t - f.wordIn - f.wordHold) / f.wordOut);
}

// ------------------------------------------------------------ 29 Oct: Your sky, the memory world

/** The crown of kept lights around the seat (Your sky): distance (m), yaw (° either side), height (° from the eye). */
export const KEPT_CROWN = { near: 0.55, far: 1.1, yaw: 70, low: -5, high: 25 } as const;

/**
 * Where kept light `i` of `n` (oldest first) floats in Your sky, world: a living crown around the seated head,
 * within ±70° of the desk's direction, −5°…+25° high (above the desk's glass, which stands lower), 0.55–1.1 m away.
 * A low-discrepancy spread (no two on top of each other); the newest nearest the middle and the closest.
 */
export function keptCrown(i: number, n: number, seed: number, head: { x: number; y: number; z: number }, forward: { x: number; z: number }): { x: number; y: number; z: number } {
  const c = KEPT_CROWN;
  const rank = n - 1 - i; // 0: the newest
  const j = (shift: number) => (((seed >>> shift) & 0xff) / 0xff - 0.5) * 2;
  const a = (0.5 + rank * 0.7548776662) % 1;
  const b = (0.5 + rank * 0.569840291) % 1;
  // Newest near the middle: the first few ranks stay within the inner half of the crown.
  const reach = Math.min(1, 0.35 + rank / Math.max(4, n));
  const yawDeg = (a * 2 - 1) * c.yaw * reach + 2 * j(0);
  const pitchDeg = c.low + (c.high - c.low) * b + 1.5 * j(8);
  const dist = c.near + (c.far - c.near) * Math.min(1, rank / Math.max(6, n - 1)) * (0.75 + 0.25 * ((j(16) + 1) / 2));
  const fl = Math.hypot(forward.x, forward.z) || 1;
  const fx = forward.x / fl;
  const fz = forward.z / fl;
  const yaw = (Math.max(-c.yaw, Math.min(c.yaw, yawDeg)) * Math.PI) / 180;
  const pitch = (Math.max(c.low, Math.min(c.high, pitchDeg)) * Math.PI) / 180;
  // The desk's direction turned by `yaw` about the vertical (left or right: the crown is symmetric).
  const dx = fx * Math.cos(yaw) - fz * Math.sin(yaw);
  const dz = fx * Math.sin(yaw) + fz * Math.cos(yaw);
  const d = Math.max(c.near, Math.min(c.far, dist));
  return { x: head.x + dx * Math.cos(pitch) * d, y: head.y + Math.sin(pitch) * d, z: head.z + dz * Math.cos(pitch) * d };
}

const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
function count(n: number): string {
  return n < NUMBERS.length ? NUMBERS[n] : String(n);
}
function cap(t: string): string {
  return t.length > 0 ? t[0].toUpperCase() + t.slice(1) : t;
}
function day(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * The lamp's words as you enter Your sky: one or two true sentences, made only of what was recorded — the good things
 * kept these two weeks (and the one that came back most, if it came back at least twice), and the stars of what was
 * let go. Nothing invented, nothing to fix; a plain line when there is nothing yet.
 */
export function keptSummary(nights: readonly NightRecord[], today: string): string {
  const t = day(today);
  const recent = nights.filter((n) => t - day(n.date) >= 0 && t - day(n.date) < 14);
  const kept = recent.flatMap((n) => n.kept ?? []);
  const stars = nights.reduce((sum, n) => sum + n.letGo.length + (n.sunk ?? []).length, 0);
  if (kept.length === 0 && stars === 0) return 'Your sky starts tonight. Keep a good thing, or let one go.';
  const starPart = stars > 0 ? `${count(stars)} ${stars === 1 ? 'star' : 'stars'} for what you let go` : '';
  if (kept.length === 0) return `${cap(starPart)}.`;
  const keptPart = `${cap(count(kept.length))} good ${kept.length === 1 ? 'thing' : 'things'} these two weeks`;
  const first = starPart.length > 0 ? `${keptPart}, and ${starPart}.` : `${keptPart}.`;
  const again = recurring(kept);
  return again != null ? `${first} ${cap(again.text)} came back ${again.count === 2 ? 'twice' : `${count(again.count)} times`}.` : first;
}
