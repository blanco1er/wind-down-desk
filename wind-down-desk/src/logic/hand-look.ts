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

/** Which finger a hand joint belongs to: 0 thumb, 1 index, 2 middle, 3 ring + little, -1 wrist / palm. */
export function fingerOfJoint(name: string): number {
  if (name.startsWith('thumb')) return 0;
  if (name.endsWith('metacarpal') || name === 'wrist') return -1;
  if (name.startsWith('index')) return 1;
  if (name.startsWith('middle')) return 2;
  if (name.startsWith('ring') || name.startsWith('pinky')) return 3;
  return -1;
}
