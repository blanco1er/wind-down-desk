/**
 * What the landing page may offer on this device (pure, unit-tested).
 *
 * - A headset browser (Quest): immersive-ar (passthrough) when supported, else immersive-vr. → "Begin".
 * - No immersive session at all (iPhone, a laptop without a headset, navigator.xr missing): never a button that
 *   fails. → the "Made for Meta Quest" card; on a computer with a mouse, also "Preview on this screen" (the IWER
 *   emulator, loaded only then: ?preview=1).
 * A session that is "supported" but still fails (permission refused, a PC runtime without a headset plugged in)
 * is handled at launch time (src/overlay.ts): a clear message and an action, never a silent return.
 */
export interface XrProbe {
  /** navigator.xr exists. */
  api: boolean;
  /** isSessionSupported answers (null: not asked / no answer in time). */
  ar: boolean | null;
  vr: boolean | null;
}

export type XrMode = 'immersive-ar' | 'immersive-vr' | 'none';

export interface LandingPlan {
  mode: XrMode;
  /** "Preview on this screen" may be offered (a computer with a fine pointer, no headset). */
  offerPreview: boolean;
  /** The emulator is wanted now (?preview=1 on a computer: asked from the card, or after a session that failed). */
  startPreview: boolean;
}

export function sessionModeFor(probe: XrProbe): XrMode {
  if (!probe.api) return 'none';
  if (probe.ar === true) return 'immersive-ar';
  if (probe.vr === true) return 'immersive-vr';
  return 'none';
}

export function planLanding(probe: XrProbe, device: { finePointer: boolean; width: number; previewParam: boolean }): LandingPlan {
  const mode = sessionModeFor(probe);
  const computer = isComputer(device.finePointer, device.width);
  const offerPreview = mode === 'none' && computer;
  return { mode, offerPreview, startPreview: computer && device.previewParam };
}

/** A mouse and a wide screen: the emulated preview is usable (never offered on a phone or a tablet). */
export function isComputer(finePointer: boolean, width: number): boolean {
  return finePointer && width >= 900;
}

/** Readable address for the card: host only, no scheme, no trailing slash ("wind-down-desk.onrender.com"). */
export function shortAddress(href: string, override?: string): string {
  const raw = override != null && override.trim().length > 0 ? override.trim() : href;
  try {
    const url = new URL(/^[a-z]+:\/\//iu.test(raw) ? raw : `https://${raw}`);
    return `${url.host}${url.pathname === '/' ? '' : url.pathname.replace(/\/+$/u, '')}`;
  } catch {
    return raw.replace(/^[a-z]+:\/\//iu, '').replace(/\/+$/u, '');
  }
}
