/**
 * Hands, the Meta way (28 Oct, owner: "Meta's mixed reality hands are transparent hands; you see and handle things
 * with your real hands"). Pure numbers and rules, no renderer: tested in tests/hand-look.test.ts.
 *
 * Sources (checked 28 Oct 2026):
 * - Meta Horizon design guidelines, "Hand representation" (developers.meta.com/horizon/design/hand-representation):
 *   custom hands = a fresnel blending two dark grey tones with a constant slight transparency; a translucent light grey
 *   outline; fill and outline fade out at the wrist; the outline of the fingers that pinch, grab or touch becomes
 *   brighter. In passthrough: your real hands, with the virtual hand blended in more strongly near virtual objects.
 * - Meta Interaction SDK v62, `OculusHand.mat` / `OculusHand.shader`: ColorTop #323436, ColorBottom #1F2021, opacity
 *   0.79, fresnel power 1.75, outline #898989 (opacity 1, 1.4 mm), white finger glow.
 * - IWSDK 1.0.1 (`@iwsdk/xr-input` AnimatedHand): an inset depth-only "stencil" hand (1.2 mm) so the real hand shows
 *   through passthrough in front of virtual objects, and an outline shell fading 3–8 cm from the wrist.
 */

/** Display (sRGB) colours, 0..1. */
export const META_HAND = {
  /** Fill facing you (Interaction SDK `_ColorTop`). */
  fillFace: [0x32 / 255, 0x34 / 255, 0x36 / 255] as const,
  /** Fill at grazing angles (Interaction SDK `_ColorBottom`). */
  fillEdge: [0x1f / 255, 0x20 / 255, 0x21 / 255] as const,
  fresnelPower: 1.75,
  /** Outline, hand open (Interaction SDK `_OutlineColor`). */
  outline: [0x89 / 255, 0x89 / 255, 0x89 / 255] as const,
  /** Outline of a pinching / grabbing finger (the SDK's white glow). */
  outlineLit: [1, 1, 1] as const,
  /** Fill opacity in full VR (Interaction SDK material). */
  vrOpacity: 0.79,
  /** Inset of the fill under the outline shell (IWSDK stencil; the SDK's outline is 1.4 mm). */
  insetMetres: 0.0013,
  /** Fill and outline fade out toward the wrist (metres from the wrist joint, bind pose). */
  wristFade: [0.025, 0.085] as const,
} as const;

/**
 * Where the hands are drawn:
 * - `passthrough`: a real headset seeing your room. Real hands through the cameras; the fill also writes depth
 *   BEFORE the desk (it "punches" virtual content, as IWSDK's stencil does) so the real hand stays in front of
 *   the tray; only a faint tint, stronger near a stone or while pinching, and the outline.
 * - `simulated`: the emulator's stand-in for passthrough (film set): same look, but no camera image of a real hand
 *   exists behind it, so it is drawn after the desk (a punch would show the stand-in table through the tray).
 * - `vr`: a place in Full immersion (and the emulator without a stand-in room): Meta's VR hands, fill at 0.79.
 */
export type HandStage = 'passthrough' | 'simulated' | 'vr';

export function handStage(full: boolean, emulated: boolean): HandStage {
  if (full) return 'vr';
  return emulated ? 'simulated' : 'passthrough';
}

/** Fill opacity rules per stage: [resting, near a target or pinching]. */
export const FILL_OPACITY: Record<HandStage, readonly [number, number]> = {
  // Meta's blended approach: almost only the outline over your real hand, the tint grows as you reach a stone.
  passthrough: [0.1, 0.42],
  // Same rule; a little more fill at rest, because no real hand is behind it to carry the shape.
  simulated: [0.3, 0.55],
  vr: [META_HAND.vrOpacity, META_HAND.vrOpacity],
};

export function fillOpacity(stage: HandStage, near: number, pinch: number): number {
  const [rest, close] = FILL_OPACITY[stage];
  const k = Math.min(1, Math.max(0, Math.max(near, pinch)));
  return k >= 1 ? close : rest + (close - rest) * k;
}

/** Pinch strength 0..1 from the thumb-tip ↔ index-tip distance (metres): 0 open (≥ 7 cm), 1 touching (≤ 1.5 cm). */
export function pinchStrength(tipDistance: number): number {
  return Math.min(1, Math.max(0, (0.07 - tipDistance) / 0.055));
}

/** Curl 0..1 of a long finger from its tip ↔ wrist distance (≈ 0.17 m open, ≈ 0.10 m fist). */
export function curlStrength(tipToWrist: number): number {
  return Math.min(1, Math.max(0, (0.155 - tipToWrist) / 0.05));
}

/** How near a fingertip is to a target (0..1): 1 within 4 cm, 0 beyond 15 cm. */
export function nearness(distance: number): number {
  return Math.min(1, Math.max(0, (0.15 - distance) / 0.11));
}

/**
 * 29 Oct — the owner, on a real Quest 3: "transparent hands with luminous blue lines". Meta's design guideline
 * (developers.meta.com/horizon/resources/hand-representation, "Gating feedback"): the OUTLINE turns blue when the hand
 * is in a pose or area that starts an action, and the pinching fingers turn light blue as the pinch begins; a finger's
 * outline brightens as it curls or nears a target ("Progress feedback"). The fill stays Meta's dark grey.
 * `grey` is the look shipped until 29 Oct (pinching fingers turn white); `meta-blue` adds the blues — the default since
 * the owner validated it on the comparison sheet (29 Oct). `?hands=meta` (or `?hands=grey`) picks one for a page, else
 * `localStorage['wdd.hands']` (the sheet's switch).
 * The exact blues are not published (no hex in Meta's pages): Meta's system accent blue family, chosen to read as
 * "luminous" over passthrough at night; to retune from a headset capture if one becomes available.
 */
export type HandStyle = 'grey' | 'meta-blue';
export const DEFAULT_HAND_STYLE: HandStyle = 'meta-blue';
export const META_BLUE = {
  /** Outline where an action starts (a fingertip near a stone or a button). */
  gate: [0x4a / 255, 0xa3 / 255, 1] as const,
  /** Outline of the pinching fingers (light blue). */
  pinch: [0xa8 / 255, 0xd8 / 255, 1] as const,
} as const;

export function handStyle(search = typeof location !== 'undefined' ? location.search : '', stored: string | null = storedHandStyle()): HandStyle {
  const v = new URLSearchParams(search).get('hands') ?? stored;
  return v === 'meta' ? 'meta-blue' : v === 'grey' ? 'grey' : DEFAULT_HAND_STYLE;
}

/** The comparison sheet's switch (`wdd.hands` = meta | grey in this browser), read once at load. */
function storedHandStyle(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem('wdd.hands');
  } catch {
    return null;
  }
}

/** How blue the outline is (0..1) from how near the fingertip is to a target: none in `grey`. */
export function gateBlue(style: HandStyle, near: number): number {
  if (style !== 'meta-blue') return 0;
  const t = Math.min(1, Math.max(0, (near - 0.35) / 0.5));
  return t * t * (3 - 2 * t);
}

/** Which finger a hand joint belongs to: 0 thumb, 1 index, 2 middle, 3 ring + little, -1 wrist / palm. */
export function fingerOfJoint(name: string): number {
  if (name.startsWith('thumb')) return 0;
  if (name.endsWith('metacarpal') || name === 'wrist') return -1;
  if (name.startsWith('index')) return 1;
  if (name.startsWith('middle')) return 2;
  if (name.startsWith('ring') || name.startsWith('pinky')) return 3;
  return -1;
}
