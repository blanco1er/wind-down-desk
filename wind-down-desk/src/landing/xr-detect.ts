/**
 * Asks the browser which immersive sessions it can open (≤ 1.2 s, never throws). Runs in parallel with the font
 * load, so a Quest starts exactly as before.
 */
import type { XrProbe } from '../logic/xr-support.ts';

export async function probeXr(timeoutMs = 1200): Promise<XrProbe> {
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (xr == null || typeof xr.isSessionSupported !== 'function') return { api: false, ar: null, vr: null };
  const ask = (mode: XRSessionMode) =>
    Promise.race([
      xr.isSessionSupported(mode).then(
        (v) => v === true,
        () => false,
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  const [ar, vr] = await Promise.all([ask('immersive-ar'), ask('immersive-vr')]);
  return { api: true, ar, vr };
}
