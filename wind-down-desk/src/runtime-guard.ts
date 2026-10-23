/**
 * Safety nets at run time (26 Oct: the app ships without ever running on a headset, it must hold at the judges').
 *
 * - Safe mode decided at page load (`?safe=1`, remembered, or after two bad starts — logic/safe-mode.ts).
 * - Adaptive quality: the frame governor (logic/quality.ts) fed by perf-system every frame; listeners apply the knobs.
 * - Anonymous error reports: JS errors, rejected promises, a lost GPU context, a failed XR session — type and a
 *   short cleaned message only (logic/error-report.ts), into the visit log.
 * - A lost WebGL context: counted as a bad start, a clear message, then a clean reload (three.js cannot bring back
 *   every texture and render target by itself).
 * - Low memory (navigator.deviceMemory ≤ 4 GB): never the 8k places.
 */
import { decideSafeMode, markBadStart, markSessionStart, markSettled, type BootStore, type SafeDecision } from './logic/safe-mode.ts';
import { floorForMemory, FrameGovernor, knobsFor, type QualityKnobs, type QualityLevel } from './logic/quality.ts';
import { cleanErrorMessage, ErrorReports, errorType } from './logic/error-report.ts';
import { track } from './visits.ts';

function store(): BootStore | null {
  try {
    const s = window.localStorage;
    s.setItem('__wdd_probe__', '1');
    s.removeItem('__wdd_probe__');
    return s;
  } catch {
    return null;
  }
}

const reports = new ErrorReports(8);

/** Sends one anonymous error report (type + cleaned message), at most 8 distinct per page. */
export function reportError(where: string, error: unknown): void {
  const type = errorType(error);
  const msg = cleanErrorMessage(error instanceof Error ? error.message : (error as { message?: unknown })?.message ?? error);
  if (reports.accept(where, type, msg)) track('client-error', { where, type, msg });
}

type QualityListener = (level: QualityLevel, knobs: QualityKnobs, why: string) => void;

export const guard = {
  safe: { safe: false, why: 'none', badStarts: 0 } as SafeDecision,
  /** Never better than this (low memory: 2 = no 8k). */
  floor: 0 as QualityLevel,
  level: 0 as QualityLevel,
  governor: null as FrameGovernor | null,
  /** A level forced from the play-test API (null: the governor decides). */
  forced: null as QualityLevel | null,
  listeners: [] as QualityListener[],

  knobs(): QualityKnobs {
    return knobsFor(this.level, this.safe.safe);
  },

  onQuality(fn: QualityListener): void {
    this.listeners.push(fn);
    fn(this.level, this.knobs(), 'initial');
  },

  setLevel(level: QualityLevel, why: string): void {
    const l = Math.max(level, this.floor) as QualityLevel;
    if (l === this.level && why !== 'forced') return;
    this.level = l;
    for (const fn of this.listeners) fn(l, this.knobs(), why);
    if (why === 'governor') track('quality', { level: l }, `quality:${l}`);
  },

  /** The XR session started (its display rate when the browser gives it). */
  sessionStarted(displayHz: number | null): void {
    // The IWER emulator reports 90 Hz while the desktop browser draws at 60: there the rate is measured instead
    // (a real Quest Browser's XRSession.frameRate is the display's).
    const emulated = (window as unknown as { IWER_DEVICE?: unknown }).IWER_DEVICE != null;
    this.governor = new FrameGovernor({ displayHz: emulated ? null : displayHz });
    markSessionStart(store());
    window.setTimeout(() => markSettled(store()), 20_000);
  },

  /** Every frame (perf-system): interval since the last frame, the app's CPU ms, time in s. */
  sample(intervalMs: number, cpuMs: number, t: number): void {
    if (this.governor == null || this.forced != null) return;
    const r = this.governor.sample(intervalMs, cpuMs, t);
    if (r != null) this.setLevel(r, 'governor');
  },
};

/** At page load, before the world: safe mode, memory floor, error listeners. */
export function installGuard(): void {
  guard.safe = decideSafeMode(location.search, store(), Date.now());
  if (guard.safe.safe) track('safe-mode', { why: guard.safe.why }, 'safe-mode');
  guard.floor = floorForMemory((navigator as Navigator & { deviceMemory?: number }).deviceMemory);
  guard.level = guard.floor;
  // A page that leaves normally (reload, link, closing the tab) was not a crash: only a page that dies without
  // this event (a renderer or GPU crash) counts as a bad start.
  addEventListener('pagehide', () => markSettled(store()));
  addEventListener('error', (e) => reportError('window', e.error ?? e.message));
  addEventListener('unhandledrejection', (e) => reportError('promise', e.reason));
}

/** Once the renderer exists: a lost GPU context is reported, counted, explained, and the page reloads cleanly. */
export function watchContext(canvas: HTMLCanvasElement, onLost: () => void): void {
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    const bad = markBadStart(store(), Date.now());
    track('gl-lost', { bad }, 'gl-lost');
    onLost();
    // three.js restores its state but not every texture or render target: a clean reload is the honest way back.
    window.setTimeout(() => location.reload(), 2500);
  });
}
