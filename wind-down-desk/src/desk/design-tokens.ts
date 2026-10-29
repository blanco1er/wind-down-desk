/**
 * Design tokens for every surface in XR.
 *
 * Art direction (v3, 18 Oct 2026): "a walnut tray on your table at night"
 * (matches the reference images in meta-vr/concept/).
 * One colour language: warm neutrals (oiled walnut, pale speckled stoneware, grey
 * river stone) and ONE accent, the warm light of the lamp, used sparingly
 * (the bowl you are about to drop into, the primary button, tomorrow's times).
 *
 * 2D surfaces follow Apple's visionOS HIG (developer.apple.com/design/human-interface-guidelines):
 * - Typography: default text 17 pt, minimum 12 pt; visionOS uses bolder body
 *   and title weights; avoid light weights; white text on glass; no text
 *   shadows; prefer 2D (flat) text; keep text facing people.
 * - Materials: glass (translucent, neutral, adapts to the surroundings), with
 *   vibrancy levels label / secondaryLabel / tertiaryLabel.
 * - Eyes and spatial layout: rounded interactive shapes, centres at least
 *   60 pt apart with 16 pt of space, subtle hover feedback (highlight + scale).
 *
 * visionOS defines a point as an angle. Apple does not publish the ratio;
 * the widely used figure is 1360 pt per metre at 1 m [third-party, not an
 * official Apple number]. Quest 3 has fewer pixels per degree than Vision Pro
 * (~25 vs ~34), so every size below is multiplied by QUEST_SCALE.
 *
 * One file on purpose: when the shared design system lands, map it here.
 */

/** General Sans is shipped with the app (src/desk/fonts.ts); the rest is a fallback only. */
export const FONT = '"General Sans", "SF Pro Display", -apple-system, "Inter", Roboto, "Segoe UI", "Helvetica Neue", system-ui, sans-serif';
export const FONT_ROUNDED = FONT;

/** Points per metre at 1 m (third-party figure, see above). */
export const PT_PER_METRE = 1360;
/** Quest 3 vs Vision Pro angular resolution compensation. */
export const QUEST_SCALE = 1.35;

/** Font size in metres for a visionOS point size seen from `distance` metres on Quest. */
export function fontMetres(points: number, distance: number): number {
  return (points / PT_PER_METRE) * distance * QUEST_SCALE;
}

export const DS = {
  font: FONT,
  /** Frosted visionOS-style glass: light, neutral-warm, translucent; a bright top edge. */
  glass: {
    fillTop: 'rgba(158, 152, 145, 0.58)',
    fillBottom: 'rgba(118, 112, 106, 0.62)',
    edgeTop: 'rgba(255, 252, 246, 0.55)',
    edgeBottom: 'rgba(255, 252, 246, 0.14)',
    separator: 'rgba(255, 252, 246, 0.22)',
  },
  /** Vibrancy levels (label / secondaryLabel / tertiaryLabel). */
  text: {
    primary: 'rgba(255, 255, 255, 0.97)',
    secondary: 'rgba(240, 236, 230, 0.70)',
    tertiary: 'rgba(240, 236, 230, 0.46)',
  },
  /** The single accent: lamp light. Bins differ by place and label, not hue. */
  accent: {
    lamp: '#f4c27e',
    tomorrow: '#f4c27e',
    later: '#f4c27e',
    letGo: '#f4c27e',
  },
  /** Materials (display sRGB). */
  material: {
    glaze: [0.105, 0.098, 0.092] as const,
    /** Grey river granite (display sRGB): a family of close greys, some warmer, some cooler. */
    stones: [
      [0.55, 0.555, 0.565],
      [0.5, 0.51, 0.53],
      [0.59, 0.585, 0.58],
      [0.47, 0.475, 0.485],
      [0.54, 0.535, 0.53],
      [0.61, 0.61, 0.615],
    ] as const,
    /**
     * v7 (owner's reference): five real stone kinds, cycled. albedo = display sRGB; speck = granite salt and
     * pepper (0..1); vein = a white quartz vein (slate); ink = colour filled into the engraving (dark on light
     * stones, light on dark ones), so the words read in the evening light whatever the groove shading.
     */
    stoneKinds: [
      { name: 'limestone', albedo: [0.8, 0.765, 0.69], speck: 0.25, vein: 0, ink: [0.2, 0.15, 0.11] },
      { name: 'granite', albedo: [0.56, 0.555, 0.55], speck: 1, vein: 0, ink: [0.13, 0.12, 0.115] },
      { name: 'sandstone', albedo: [0.79, 0.68, 0.53], speck: 0.35, vein: 0, ink: [0.22, 0.15, 0.09] },
      { name: 'basalt', albedo: [0.25, 0.25, 0.255], speck: 0.45, vein: 0, ink: [0.86, 0.84, 0.8] },
      { name: 'slate', albedo: [0.37, 0.42, 0.39], speck: 0.3, vein: 1, ink: [0.88, 0.87, 0.82] },
    ] as const,
  },
  /**
   * Type scale in canvas pixels for ~2100 px/m panels seen from ~0.7 m:
   * title ≈ 30 mm, headline ≈ 21 mm, body ≈ 18 mm, footnote ≈ 14 mm.
   * fontMetres(17 pt, 0.7 m) = 11.8 mm, so even footnotes stay above the
   * visionOS default size after the Quest compensation.
   */
  type: {
    title: { size: 64, weight: 650 },
    headline: { size: 44, weight: 600 },
    body: { size: 38, weight: 500 },
    callout: { size: 34, weight: 500 },
    footnote: { size: 30, weight: 500 },
  },
  /** Minimum interactive target, metres (60 pt at 0.6 m on Quest ≈ 3.6 cm; we use 4.4 cm). */
  minTarget: 0.044,
  motion: {
    /** Critically-damped-ish spring used for panels and hover. */
    stiffness: 260,
    damping: 26,
  },
} as const;

/** Small spring integrator (semi-implicit Euler), allocation-free. */
export class Spring {
  value: number;
  target: number;
  velocity = 0;

  constructor(value = 0) {
    this.value = value;
    this.target = value;
  }

  /** Adds an impulse (units per second), e.g. the little dip when a stone lands. */
  kick(velocity: number): void {
    this.velocity += velocity;
  }

  step(dt: number, stiffness: number = DS.motion.stiffness, damping: number = DS.motion.damping): number {
    const force = (this.target - this.value) * stiffness - this.velocity * damping;
    this.velocity += force * dt;
    this.value += this.velocity * dt;
    if (Math.abs(this.target - this.value) < 1e-4 && Math.abs(this.velocity) < 1e-3) {
      this.value = this.target;
      this.velocity = 0;
    }
    return this.value;
  }
}
