/**
 * Accessibility settings (23 Oct, Best Accessibility Forward Experience): pure, unit-tested.
 *   gazeSelect  — choose by looking only (1.2 s dwell), no hands, no voice needed
 *   contrast    — high-contrast glass: white text on near-black, opaque panels
 *   largeText   — captions and replies 30 % / 15 % larger
 * Reachable by voice ("look to select", "high contrast", "bigger text", and their "off") AND by a button on the
 * landing page. Kept in this browser only (localStorage 'wdd.access').
 */
export interface AccessPrefs {
  gazeSelect: boolean;
  contrast: boolean;
  largeText: boolean;
}

export const ACCESS_KEY = 'wdd.access';
export const DEFAULT_ACCESS: AccessPrefs = { gazeSelect: false, contrast: false, largeText: false };
/** Dwell time to select by gaze alone (s). */
export const DWELL_SELECT = 1.2;

export function parseAccess(raw: string | null | undefined): AccessPrefs {
  try {
    const o = JSON.parse(raw ?? 'null') as Partial<AccessPrefs> | null;
    return { gazeSelect: o?.gazeSelect === true, contrast: o?.contrast === true, largeText: o?.largeText === true };
  } catch {
    return { ...DEFAULT_ACCESS };
  }
}

/** Spoken settings (normalized text, see text.ts). Short phrases only: a worry never toggles a setting. */
export function parseAccessCommand(n: string): Partial<AccessPrefs> | null {
  if (n.split(/\s+/u).length > 6) return null;
  if (/^(look to select|select by looking|gaze (only|select|selection)( on)?|eyes only|choose by looking|hands free( mode)?)$/u.test(n)) return { gazeSelect: true };
  if (/^(gaze (select(ion)? )?off|stop (look|gaze) (to )?select(ing|ion)?|hands again|use my hands)$/u.test(n)) return { gazeSelect: false };
  if (/^(high contrast( on)?|more contrast|contrast on)$/u.test(n)) return { contrast: true };
  if (/^(contrast off|normal contrast|less contrast)$/u.test(n)) return { contrast: false };
  if (/^(bigger text|larger text|large text( on)?|bigger letters|i cant read( that| this| it)?)$/u.test(n)) return { largeText: true };
  if (/^(normal text|smaller text|large text off)$/u.test(n)) return { largeText: false };
  return null;
}

/** What the lamp shows after a spoken setting. */
export function accessLine(change: Partial<AccessPrefs>): string {
  if (change.gazeSelect === true) return 'Look at something for a moment to choose it.';
  if (change.gazeSelect === false) return 'Hands again. Gaze selection is off.';
  if (change.contrast === true) return 'High contrast.';
  if (change.contrast === false) return 'Normal contrast.';
  if (change.largeText === true) return 'Bigger text.';
  return 'Normal text.';
}
