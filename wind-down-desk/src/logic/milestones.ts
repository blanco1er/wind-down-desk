/**
 * Progress shown INSIDE the lamp (26 Oct, owner's go-ahead, lot 2b): your own constellation and the evenings that
 * complete it, plus one small durable object on your real table at 3, 7 and 21 evenings.
 *
 * - The constellation: one point per evening you came back, on a figure that completes at 3, then 7, then 21
 *   evenings (a triangle, a dipper, a spiral). Around it, a fine dust of stars: one per thing you let go of.
 * - Keepsakes: a polished pebble at 3 evenings, a stoneware cup of tea at 7 (28 Oct, owner: a candle doubled the lamp's
 *   light; the cup steams only when you come back), a little plant at 21 (it keeps growing a little each evening after). Elegant, discreet, always in the same place on your table (the desk's anchor).
 * - Pure logic (no rendering): tests/milestones.test.ts.
 */

export const MILESTONES = [3, 7, 21] as const;
export type Milestone = (typeof MILESTONES)[number];
export type Keepsake = 'pebble' | 'cup' | 'plant';
export const KEEPSAKE: Record<Milestone, Keepsake> = { 3: 'pebble', 7: 'cup', 21: 'plant' };

/** Figure points on the globe's disk (x right, y up, inside a 0.78 radius), in the order they light. */
function spiral(): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let k = 0; k < 21; k++) {
    const a = 0.9 + k * 0.58;
    const r = 0.1 + 0.032 * k;
    pts.push([+(r * Math.cos(a)).toFixed(3), +(r * Math.sin(a)).toFixed(3)]);
  }
  return pts;
}
export const FIGURES: Record<Milestone, ReadonlyArray<readonly [number, number]>> = {
  3: [
    [-0.36, -0.22],
    [0.04, 0.36],
    [0.4, -0.16],
  ],
  7: [
    [-0.62, 0.26],
    [-0.36, 0.34],
    [-0.1, 0.24],
    [0.12, 0.06],
    [0.16, -0.3],
    [0.52, -0.34],
    [0.56, 0.0],
  ],
  21: spiral(),
};

/** The figure you are completing after `evenings` evenings, and how many of its points are lit. */
export function figureFor(evenings: number): { tier: Milestone; points: ReadonlyArray<readonly [number, number]>; lit: number; complete: boolean } {
  const n = Math.max(0, Math.floor(evenings));
  const tier = (MILESTONES.find((m) => n <= m) ?? 21) as Milestone;
  const points = FIGURES[tier];
  const lit = Math.min(n, points.length);
  return { tier, points, lit, complete: lit >= points.length };
}

/**
 * 28 Oct (owner: a clear glass lamp, alive inside): the first GLOBE_STARS things you let go of float INSIDE the globe,
 * one star each, at a fixed place in the globe's own frame (unit ball: 1 = the glass), turning slowly with it at
 * STAR_SPIN rad/s around its vertical axis (angle = STAR_SPIN × the app clock, materials.ts timeUniform). Addressable:
 * star k is always at starInGlobe(k) (a low-discrepancy spread: the first stars are far apart, none near the heart or
 * the glass). The rest of your sky (beyond GLOBE_STARS) stays the dust shown on the glass while your sky is shown.
 */
/** 28 Oct (review): few, distinct stars read as real stars — 24 inside the glass, the rest as dust on it. */
export const GLOBE_STARS = 24;
export const STAR_SPIN = 0.05;
export function starInGlobe(k: number): [number, number, number] {
  const u = (k * 0.6180339887 + 0.11) % 1;
  const v = (k * 0.7548776662 + 0.37) % 1;
  const w = (k * 0.5698402910 + 0.53) % 1;
  const y = 1 - 2 * v;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const a = 2 * Math.PI * u;
  // Radius 0.34 … 0.74: clear of the heart (≈ 0.2) and of the glass, a little flattened so none hides in the foot.
  const r = 0.34 + 0.4 * Math.cbrt(w);
  return [+(r * ring * Math.cos(a)).toFixed(4), +(r * y * 0.85).toFixed(4), +(r * ring * Math.sin(a)).toFixed(4)];
}

/** Keepsakes earned after `evenings` evenings (each milestone reached once, never lost). */
export function keepsakesFor(evenings: number): Keepsake[] {
  return MILESTONES.filter((m) => evenings >= m).map((m) => KEEPSAKE[m]);
}

/** The smallest milestone reached and not yet celebrated (shown once, on the evening it is reached), or null. */
export function milestoneToCelebrate(evenings: number, celebrated: readonly number[]): Milestone | null {
  return (MILESTONES.find((m) => evenings >= m && !celebrated.includes(m)) ?? null) as Milestone | null;
}

/** How tall the plant has grown (0 at 21 evenings, 1 at 49): slow, a leaf every few evenings. */
export function plantGrowth(evenings: number): number {
  return Math.max(0, Math.min(1, (evenings - 21) / 28));
}

const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
function count(n: number): string {
  return n < WORDS.length ? WORDS[n] : String(n);
}

/** The lamp's line when it shows the sky at the start of an evening you came back for (short, plain, warm). */
export function skyLine(evenings: number, stars: number): string {
  const f = figureFor(evenings);
  const left = f.points.length - f.lit;
  const sky = stars === 0 ? '' : ` ${stars === 1 ? 'One star' : `${count(stars)[0].toUpperCase()}${count(stars).slice(1)} stars`} for what you let go.`;
  if (left === 0) return `${count(evenings)[0].toUpperCase()}${count(evenings).slice(1)} evenings. Your constellation is complete.${sky}`;
  return `Evening ${evenings + 1}. ${left === 1 ? 'One more evening' : `${count(left)[0].toUpperCase()}${count(left).slice(1)} more evenings`} to complete it.${sky}`;
}

/** The line for a milestone and the keepsake it leaves on your table. */
export function milestoneLine(m: Milestone): { line: string; sub: string } {
  if (m === 3) return { line: 'Three evenings. A polished stone stays on your table.', sub: 'It will be here every evening.' };
  if (m === 7) return { line: 'Seven evenings. A cup of something warm stays with you.', sub: 'It steams again each time you come back.' };
  return { line: 'Twenty-one evenings. A little plant now grows on your table.', sub: 'A new leaf every few evenings.' };
}

/** "show me my sky", "my stars", "my constellation": the lamp shows it again. */
export function isSkyCommand(normalized: string): boolean {
  return /^(show (me )?my (sky|stars|constellation)|my (sky|stars|constellation)|where are my stars)$/u.test(normalized.trim());
}
