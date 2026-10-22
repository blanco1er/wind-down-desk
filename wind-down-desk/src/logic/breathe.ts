/**
 * "Breathe": a guided breathing ritual as a pure, time-driven state machine (unit-tested).
 *
 *   settle ──▶ (in ──▶ out) × cycles ──▶ close ──▶ done
 *        any time: finish() ──▶ close (the light deflates gently from where it is)
 *
 * Pace: 4 s in, 6 s out = 6 breaths a minute (the slow "resonance" pace used by
 * paced-breathing apps). Six cycles by default; "longer" adds four (max 12).
 * Nothing moves the person: only the lamp's light grows and fades.
 *
 * Optional hand-follow: the person may open their hands as they breathe in and
 * close them as they breathe out (hand tracking). It is never required; a cycle
 * followed by the hands simply lights its pearl a little brighter.
 */

export interface BreathPattern {
  inhale: number;
  exhale: number;
  cycles: number;
  /** Seconds for the lamp to become the moon and the first words. */
  settle: number;
  /** Seconds for the moon to return to the lamp at the end. */
  close: number;
}

export const DEFAULT_BREATH: BreathPattern = { inhale: 4, exhale: 6, cycles: 6, settle: 6.5, close: 5 };
export const MAX_CYCLES = 12;

export type BreathPhase = 'settle' | 'in' | 'out' | 'close' | 'done';

export interface BreathFrame {
  phase: BreathPhase;
  /** 0-based cycle index (during in / out), else the number of cycles completed. */
  cycle: number;
  /** Seconds into the current phase, and its length. */
  t: number;
  length: number;
  /** Fullness of the breath: 0 = all out, 1 = all in (eased, drives the moon). */
  level: number;
  /** How much the moon is there: 0 = still the little lamp, 1 = the full moon. */
  presence: number;
  /** Cycles fully completed so far. */
  completed: number;
}

function sine(k: number): number {
  const c = Math.min(1, Math.max(0, k));
  return 0.5 - 0.5 * Math.cos(Math.PI * c);
}

/** Frame of an uninterrupted session at time `t` (seconds since start). */
export function breathAt(p: BreathPattern, t: number): BreathFrame {
  if (t < p.settle) {
    return { phase: 'settle', cycle: 0, t: Math.max(0, t), length: p.settle, level: 0, presence: sine(t / Math.min(3, p.settle)), completed: 0 };
  }
  const period = p.inhale + p.exhale;
  const into = t - p.settle;
  const cycle = Math.floor(into / period);
  if (cycle < p.cycles) {
    const c = into - cycle * period;
    if (c < p.inhale) {
      return { phase: 'in', cycle, t: c, length: p.inhale, level: sine(c / p.inhale), presence: 1, completed: cycle };
    }
    const o = c - p.inhale;
    return { phase: 'out', cycle, t: o, length: p.exhale, level: 1 - sine(o / p.exhale), presence: 1, completed: cycle };
  }
  const after = into - p.cycles * period;
  if (after < p.close) {
    return { phase: 'close', cycle: p.cycles, t: after, length: p.close, level: 0, presence: 1 - sine(after / p.close), completed: p.cycles };
  }
  return { phase: 'done', cycle: p.cycles, t: after - p.close, length: 0, level: 0, presence: 0, completed: p.cycles };
}

/** A running session: start time, early finish ("that's enough"), "longer", and hand-follow. */
export class BreatheSession {
  readonly pattern: BreathPattern;
  private start = 0;
  private closing: { at: number; level: number; completed: number } | null = null;
  /** Hand-follow: openness at the start of the phase and the latest sample. */
  private follow: { key: string; first: number; last: number; min: number; max: number } | null = null;
  private readonly inFollowed = new Set<number>();
  private readonly outFollowed = new Set<number>();

  constructor(pattern: Partial<BreathPattern> = {}) {
    this.pattern = { ...DEFAULT_BREATH, ...pattern };
  }

  begin(t: number): void {
    this.start = t;
    this.closing = null;
    this.follow = null;
    this.inFollowed.clear();
    this.outFollowed.clear();
  }

  /** Ends gently from wherever the breath is: the light deflates over a slow exhale, then the moon goes home. */
  finish(t: number): void {
    if (this.closing != null) return;
    const f = this.frame(t);
    if (f.phase === 'close' || f.phase === 'done') return;
    this.closing = { at: t, level: f.level, completed: f.completed };
  }

  get finishing(): boolean {
    return this.closing != null;
  }

  /** Adds four cycles (up to 12). Returns false once closing or at the maximum. */
  longer(): boolean {
    if (this.closing != null || this.pattern.cycles >= MAX_CYCLES) return false;
    this.pattern.cycles = Math.min(MAX_CYCLES, this.pattern.cycles + 4);
    return true;
  }

  frame(t: number): BreathFrame {
    const local = t - this.start;
    if (this.closing == null) {
      return breathAt(this.pattern, local);
    }
    const p = this.pattern;
    const since = t - this.closing.at;
    // A last slow exhale from the current fullness (3 s), then the moon returns home.
    const exhale = 3 * this.closing.level;
    if (since < exhale) {
      return { phase: 'close', cycle: this.closing.completed, t: since, length: exhale + p.close, level: this.closing.level * (1 - sine(since / exhale)), presence: 1, completed: this.closing.completed };
    }
    const after = since - exhale;
    if (after < p.close) {
      return { phase: 'close', cycle: this.closing.completed, t: since, length: exhale + p.close, level: 0, presence: 1 - sine(after / p.close), completed: this.closing.completed };
    }
    return { phase: 'done', cycle: this.closing.completed, t: after - p.close, length: 0, level: 0, presence: 0, completed: this.closing.completed };
  }

  /**
   * Hand openness sample (0 = closed, 1 = open; null when hands are not tracked).
   * A phase counts as followed when the hands moved the right way by at least a quarter.
   */
  sample(t: number, openness: number | null): void {
    const f = this.frame(t);
    if (f.phase !== 'in' && f.phase !== 'out') {
      this.follow = null;
      return;
    }
    const key = `${f.phase}${f.cycle}`;
    if (this.follow == null || this.follow.key !== key) {
      this.follow = openness == null ? null : { key, first: openness, last: openness, min: openness, max: openness };
      return;
    }
    if (openness == null) return;
    const fl = this.follow;
    fl.last = openness;
    fl.min = Math.min(fl.min, openness);
    fl.max = Math.max(fl.max, openness);
    if (f.phase === 'in' && fl.last - fl.min >= 0.25) this.inFollowed.add(f.cycle);
    if (f.phase === 'out' && fl.max - fl.last >= 0.25) this.outFollowed.add(f.cycle);
  }

  /** True when the hands opened on the inhale and closed on the exhale of this cycle. */
  followed(cycle: number): boolean {
    return this.inFollowed.has(cycle) && this.outFollowed.has(cycle);
  }

  followedCount(): number {
    let n = 0;
    for (const c of this.inFollowed) if (this.outFollowed.has(c)) n++;
    return n;
  }

  get done(): boolean {
    return this.frame(this.start + 1e9).phase === 'done';
  }
}

/** Glass panel text for a frame (the main line matches the Astra concept: "Breathe in… 4", "…and out. 6"). */
export function breathCaption(f: BreathFrame, p: BreathPattern, finishing = false): { text: string; sub: string } {
  switch (f.phase) {
    case 'settle':
      return { text: "Let's breathe together.", sub: 'Rest your hands open. In as the light grows, out as it fades.' };
    case 'in':
      return {
        text: `Breathe in… ${p.inhale}`,
        sub: f.cycle === 0 ? 'Slowly, through your nose.' : f.cycle === p.cycles - 1 ? 'Last one.' : `Breath ${f.cycle + 1} of ${p.cycles}`,
      };
    case 'out':
      return { text: `…and out. ${p.exhale}`, sub: f.cycle === 0 ? 'Let your shoulders drop.' : `Breath ${f.cycle + 1} of ${p.cycles}` };
    case 'close':
    case 'done': {
      const n = f.completed;
      const pearls = n === 0 ? 'Gently. That was enough.' : `${n} slow ${n === 1 ? 'breath' : 'breaths'}. A pearl for each one.`;
      return { text: 'Well done.', sub: finishing && n === 0 ? 'Gently. That was enough.' : pearls };
    }
  }
}

/**
 * What the lamp says when a phase starts (null: silence, the tones carry the rhythm).
 * Voice on the first two cycles and the last one only: guidance, then quiet.
 */
export function breathLine(f: BreathFrame, p: BreathPattern): string | null {
  if (f.phase === 'settle') return "Let's breathe together. In as the light grows, out as it fades.";
  if (f.phase === 'close') return 'Well done.';
  const last = f.cycle === p.cycles - 1;
  if (f.phase === 'in') {
    if (last && p.cycles > 2) return 'Last one. Breathe in.';
    return f.cycle < 2 ? 'Breathe in.' : null;
  }
  if (f.phase === 'out') {
    if (f.cycle === 0) return 'And out, slowly.';
    return f.cycle === 1 || last ? 'And out.' : null;
  }
  return null;
}

/** Every line breathLine can return (voice catalogue). */
export const BREATH_LINES = ["Let's breathe together. In as the light grows, out as it fades.", 'Breathe in.', 'And out, slowly.', 'And out.', 'Last one. Breathe in.', 'Well done.'];

/** Hand openness from fingertip-to-wrist distances (metres): ≈ 0.17 open, ≈ 0.10 curled. */
export function opennessFromCurl(meanTipToWrist: number): number {
  return Math.min(1, Math.max(0, (meanTipToWrist - 0.105) / 0.06));
}
