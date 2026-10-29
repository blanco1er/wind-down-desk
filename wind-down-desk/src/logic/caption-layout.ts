/**
 * 29 Oct (coordinator review, video/solidite-29oct/high-1-bureau.jpg): when the lamp shows your sky on arrival, the
 * globe floated up in front of the caption pane and covered the milestone's sentence ("Seven evenings. A cup of
 * something warm…", cut on the right). The caption must never be covered by the globe: while the sky is shown, the
 * globe stands to the RIGHT of the caption's pill, as far as the pill's real width requires (seen from the seat), and
 * if even the furthest spot is not enough (a very long sentence), the caption slides left by the rest.
 * Pure geometry, desk-local metres (x to the right, z toward the seated user).
 */

/** The seated eye the desk UI is laid out for (eyes ≈ 0.39 m above the tray, 0.58 m behind its centre). */
export const SEATED_EYE = { x: 0, y: 0.39, z: 0.58 } as const;
/** The furthest the sky globe goes to the right: the journal's spot, measured in the 16:9 seated frame (28 Oct). */
export const SKY_GLOBE_MAX_X = 0.33;
/** Air between the globe's glass (and its glow) and the caption's pill, at the globe's depth. */
export const SKY_GLOBE_MARGIN = 0.025;
/** The caption never slides further left than when the ritual menu pushes it (CAPTION_ASIDE in desk-visuals). */
export const SKY_CAPTION_MAX_SHIFT = -0.22;

export interface GlobeSpot {
  x: number;
  z: number;
  radius: number;
}

/** Where a desk-local x on a plane at depth `fromZ` lines up, seen from the seated eye, on a plane at depth `toZ`. */
function sameAzimuth(x: number, fromZ: number, toZ: number): number {
  const k = (SEATED_EYE.z - toZ) / (SEATED_EYE.z - fromZ);
  return SEATED_EYE.x + (x - SEATED_EYE.x) * k;
}

/**
 * The sky globe's x and the caption's extra left shift (≤ 0), so that the globe's left edge stays clear of the
 * pill's right edge. `pillRight`: desk-local x of the pill's right edge on the caption plane (depth `captionZ`);
 * `globe`: the default spot (GLOBE_SHOW) — the globe never moves left of it.
 */
export function skyGlobeLayout(pillRight: number, captionZ: number, globe: GlobeSpot): { x: number; captionShift: number } {
  const edge = sameAzimuth(pillRight, captionZ, globe.z);
  const wanted = edge + SKY_GLOBE_MARGIN + globe.radius;
  const x = Math.min(SKY_GLOBE_MAX_X, Math.max(globe.x, wanted));
  if (wanted <= x) return { x, captionShift: 0 };
  // Not enough room on the right: the caption slides left by what is missing (at the caption's depth).
  const allowedEdge = sameAzimuth(x - globe.radius - SKY_GLOBE_MARGIN, globe.z, captionZ);
  return { x, captionShift: Math.max(SKY_CAPTION_MAX_SHIFT, allowedEdge - pillRight) };
}

/** Does the globe at x cover the pill (seen from the seat)? True when its left edge reaches the pill's right edge. */
export function globeCoversPill(globeX: number, pillRight: number, captionZ: number, globe: GlobeSpot): boolean {
  return sameAzimuth(globeX - globe.radius, globe.z, captionZ) < pillRight;
}
