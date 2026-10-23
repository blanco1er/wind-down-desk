/**
 * Adaptive quality (26 Oct, "safety nets without a headset": the app ships without ever being measured on a Quest).
 *
 * The frame governor watches the real frame interval (XR frames) and the app's own CPU time per frame, from the first
 * seconds and all evening long. Missed frames → it steps the quality down one level, quietly; a long calm margin →
 * one level back up. A level that failed right after going up is not tried again this evening (no see-saw).
 *
 * Levels (what changes, never what the evening can do):
 *   0  everything
 *   1  the lamp's aura and the drifting light dust at half
 *   2  + places at 6k instead of 8k (half the texture memory and bandwidth)
 *   3  + the living layers simplified (snow, fireflies and shooting stars off; water, fire and mist kept), aura at a quarter
 * Safe mode (?safe=1 or after two crashes) is level 3 with no aura, no dust and no living layers at all.
 *
 * Fixed foveation is already at its maximum from the start (renderer.xr.setFoveation(1)); the framebuffer scale cannot
 * change during a WebXR session in three.js, so it is not one of the steps.
 */

export type QualityLevel = 0 | 1 | 2 | 3;
export const MAX_LEVEL: QualityLevel = 3;

export interface QualityKnobs {
  /** Share of the lamp's aura motes drawn (0..1). */
  aura: number;
  /** Share of the light dust / sparks emitted (0..1). */
  dust: number;
  /** 8k places allowed. */
  hd: boolean;
  /** Living layers of the places. */
  living: 'full' | 'simple' | 'off';
}

export function knobsFor(level: QualityLevel, safe = false): QualityKnobs {
  if (safe) return { aura: 0, dust: 0, hd: false, living: 'off' };
  if (level === 0) return { aura: 1, dust: 1, hd: true, living: 'full' };
  if (level === 1) return { aura: 0.5, dust: 0.5, hd: true, living: 'full' };
  if (level === 2) return { aura: 0.5, dust: 0.5, hd: false, living: 'full' };
  return { aura: 0.25, dust: 0.35, hd: false, living: 'simple' };
}

/**
 * The best level allowed by the device's memory (navigator.deviceMemory, GB, rounded down by the browser; unknown →
 * no limit). 4 GB or less: never the 8k places (level 2). Quest 3 and 3S have 8 GB.
 */
export function floorForMemory(gb: number | undefined | null): QualityLevel {
  return typeof gb === 'number' && gb > 0 && gb <= 4 ? 2 : 0;
}

export interface GovernorOptions {
  /** The display's frame rate when the session says it (XRSession.frameRate), else null (estimated from the frames). */
  displayHz?: number | null;
  /** Seconds ignored at the start (loading, shader compiles at the session start). */
  warmup?: number;
}

/**
 * Feed it every frame (interval since the previous frame, CPU ms of the app's frame, time in s); it answers with a new
 * level when one is decided, else null. Pure: tests drive it with fake timings (tests/quality.test.ts).
 */
export class FrameGovernor {
  level: QualityLevel = 0;
  private readonly displayHz: number | null;
  private readonly warmup: number;
  private readonly intervals: number[] = [];
  private readonly cpu: number[] = [];
  private evalAt = 0;
  private badEvals = 0;
  private calmSince = -1;
  private changedAt = -1e9;
  private lastUpAt = -1e9;
  /** Levels that failed right after being restored: not tried again this evening. */
  private readonly locked = new Set<number>();
  private started = -1;
  /** Last measures (for the debug report). */
  readonly last = { slowShare: 0, cpuP90: 0, nominalMs: 0 };

  constructor(options: GovernorOptions = {}) {
    this.displayHz = options.displayHz ?? null;
    this.warmup = options.warmup ?? 4;
  }

  /** The display interval: the session's rate, else the fastest regular frames seen (10th percentile). */
  private nominal(): number {
    if (this.displayHz != null && this.displayHz > 20) return 1000 / this.displayHz;
    const sorted = this.intervals.slice().sort((a, b) => a - b);
    return Math.max(6, sorted[Math.floor(sorted.length * 0.1)] ?? 1000 / 72);
  }

  sample(intervalMs: number, cpuMs: number, t: number): QualityLevel | null {
    if (this.started < 0) this.started = t;
    if (t - this.started < this.warmup || !(intervalMs > 0) || intervalMs > 1000) return null;
    this.intervals.push(intervalMs);
    this.cpu.push(cpuMs);
    if (this.intervals.length > 120) {
      this.intervals.shift();
      this.cpu.shift();
    }
    if (t < this.evalAt || this.intervals.length < 60) return null;
    this.evalAt = t + 1;
    const nominal = this.nominal();
    const slowShare = this.intervals.filter((x) => x > nominal * 1.3).length / this.intervals.length;
    const cpuSorted = this.cpu.slice().sort((a, b) => a - b);
    const cpuP90 = cpuSorted[Math.floor(cpuSorted.length * 0.9)] ?? 0;
    Object.assign(this.last, { slowShare: +slowShare.toFixed(3), cpuP90: +cpuP90.toFixed(2), nominalMs: +nominal.toFixed(2) });
    // Too slow: ≥ 8 % missed frames, or the app's own CPU over 85 % of a frame, two evaluations in a row.
    const bad = slowShare >= 0.08 || cpuP90 > nominal * 0.85;
    // Calm: under 2.5 % missed frames (a busy desktop or a jittery browser never reaches 1 %: the 45-min emulator
    // session stayed stuck at level 3 after a load spike with the first threshold).
    const calm = slowShare < 0.025 && cpuP90 < nominal * 0.55;
    this.badEvals = bad ? this.badEvals + 1 : 0;
    if (!calm) this.calmSince = -1;
    else if (this.calmSince < 0) this.calmSince = t;
    if (bad && this.badEvals >= 2 && this.level < MAX_LEVEL && t - this.changedAt > 3) {
      // Failing right after a step up: that level is locked for the evening.
      if (t - this.lastUpAt < 12) this.locked.add(this.level);
      return this.set((this.level + 1) as QualityLevel, t);
    }
    if (calm && this.calmSince >= 0 && t - this.calmSince > 20 && this.level > 0 && t - this.changedAt > 20) {
      const up = (this.level - 1) as QualityLevel;
      if (this.locked.has(up)) return null;
      this.lastUpAt = t;
      return this.set(up, t);
    }
    return null;
  }

  private set(level: QualityLevel, t: number): QualityLevel {
    this.level = level;
    this.changedAt = t;
    this.badEvals = 0;
    this.calmSince = -1;
    this.intervals.length = 0;
    this.cpu.length = 0;
    return level;
  }
}
