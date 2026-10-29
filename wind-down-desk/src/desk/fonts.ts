/**
 * The one typeface of the desk: General Sans (variable, weights 200–700, ITF Free Font License, see
 * public/fonts/GeneralSans-LICENSE.txt). 29 Oct: chosen by the owner over Manrope ("the same type as every app"):
 * fuller shapes that stay sharp on a panel 60 cm away, and a face of its own. Shipped with the app so the engraved
 * stones, the bowls and the glass panels look the same on Quest (whose browser has no SF Pro) as in the emulator.
 * 38 KB, loaded before the first canvas is drawn (with a timeout: a missing font never blocks the lens).
 */
export const FONT_FAMILY = 'General Sans';

let ready: Promise<void> | null = null;

export function loadFonts(timeoutMs = 2500): Promise<void> {
  if (ready != null) {
    return ready;
  }
  ready = (async () => {
    try {
      const face = new FontFace(FONT_FAMILY, 'url(./fonts/GeneralSans-Variable.woff2)', { weight: '200 700', style: 'normal' });
      document.fonts.add(face);
      await Promise.race([face.load(), new Promise((resolve) => window.setTimeout(resolve, timeoutMs))]);
    } catch {
      // Falls back to the system sans (FONT stack in design-tokens.ts).
    }
  })();
  return ready;
}
