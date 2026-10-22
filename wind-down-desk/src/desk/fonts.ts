/**
 * The one typeface of the desk: Manrope (variable, weights 200–800, SIL Open
 * Font License, see public/fonts/Manrope-OFL.txt). Shipped with the app so the
 * engraved stones, the bowls and the glass panels look the same on Quest
 * (whose browser has no SF Pro) as in the emulator. 165 KB, loaded before the
 * first canvas is drawn (with a timeout: a missing font never blocks the lens).
 */
export const FONT_FAMILY = 'Manrope';

let ready: Promise<void> | null = null;

export function loadFonts(timeoutMs = 2500): Promise<void> {
  if (ready != null) {
    return ready;
  }
  ready = (async () => {
    try {
      const face = new FontFace(FONT_FAMILY, 'url(./fonts/Manrope-Variable.ttf)', { weight: '200 800', style: 'normal' });
      document.fonts.add(face);
      await Promise.race([face.load(), new Promise((resolve) => window.setTimeout(resolve, timeoutMs))]);
    } catch {
      // Falls back to the system sans (FONT stack in design-tokens.ts).
    }
  })();
  return ready;
}
