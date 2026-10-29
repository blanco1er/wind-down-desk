/**
 * 28 Oct — "Squeeze and let go": progressive muscle relaxation for the hands, as a pure time-driven state machine
 * (unit-tested, modelled on breathe.ts).
 *
 *   settle ──▶ (squeeze ──▶ release) × rounds ──▶ shoulders up ──▶ shoulders down ──▶ jaw ──▶ close ──▶ done
 *        any time: finish() ──▶ close
 *
 * The lamp's light gathers into your fists while you squeeze, and escapes as warm dust when you open them.
 * Hands first, never required: it runs on its own clock. Opening your fists (or saying "let go", or touching
 * "Let go") after at least 2 s of squeezing starts the release now; a closed fist (or "squeeze", or the touch)
 * marks the round as followed. Fist tracking can drop out when the fingers are hidden: hysteresis, and the clock
 * goes on whatever the hands do.
 */

export interface SqueezePattern {
  settle: number;
  squeeze: number;
  release: number;
  rounds: number;
  shouldersUp: number;
  shouldersDown: number;
  jaw: number;
  close: number;
}

export const DEFAULT_SQUEEZE: SqueezePattern = { settle: 5, squeeze: 5, release: 7, rounds: 3, shouldersUp: 4, shouldersDown: 6, jaw: 8, close: 4 };
export const MAX_ROUNDS = 5;
/** Seconds of squeezing before opening the hands starts the release early. */
export const MIN_SQUEEZE = 2;

export type SqueezePhase = 'settle' | 'squeeze' | 'release' | 'shoulders-up' | 'shoulders-down' | 'jaw' | 'close' | 'done';

export interface SqueezeFrame {
  phase: SqueezePhase;
  /** Round index (squeeze / release), else rounds completed. */
  round: number;
  t: number;
  length: number;
  /** 0..1: how gathered the light is (grows while squeezing, escapes quickly on release). */
  tight: number;
  /** 0..1: how present the ritual is (fades in at settle, out at close). */
  presence: number;
  /** Releases completed so far. */
  completed: number;
}

function sine(k: number): number {
  const c = Math.min(1, Math.max(0, k));
  return 0.5 - 0.5 * Math.cos(Math.PI * c);
}

export function squeezeTotal(p: SqueezePattern): number {
  return p.settle + p.rounds * (p.squeeze + p.release) + p.shouldersUp + p.shouldersDown + p.jaw + p.close;
}

/** Frame of an undisturbed session at time `t` (seconds since start). */
export function squeezeAt(p: SqueezePattern, t: number): SqueezeFrame {
  if (t < p.settle) return { phase: 'settle', round: 0, t: Math.max(0, t), length: p.settle, tight: 0, presence: sine(t / Math.min(2.5, p.settle)), completed: 0 };
  let x = t - p.settle;
  const period = p.squeeze + p.release;
  const round = Math.floor(x / period);
  if (round < p.rounds) {
    const c = x - round * period;
    if (c < p.squeeze) return { phase: 'squeeze', round, t: c, length: p.squeeze, tight: sine(c / (p.squeeze * 0.8)), presence: 1, completed: round };
    const r = c - p.squeeze;
    return { phase: 'release', round, t: r, length: p.release, tight: 1 - sine(r / 1.2), presence: 1, completed: round + 1 };
  }
  x -= p.rounds * period;
  const done = p.rounds;
  if (x < p.shouldersUp) return { phase: 'shoulders-up', round: done, t: x, length: p.shouldersUp, tight: 0.55 * sine(x / p.shouldersUp), presence: 1, completed: done };
  x -= p.shouldersUp;
  if (x < p.shouldersDown) return { phase: 'shoulders-down', round: done, t: x, length: p.shouldersDown, tight: 0.55 * (1 - sine(x / 1.4)), presence: 1, completed: done };
  x -= p.shouldersDown;
  if (x < p.jaw) return { phase: 'jaw', round: done, t: x, length: p.jaw, tight: 0, presence: 1, completed: done };
  x -= p.jaw;
  if (x < p.close) return { phase: 'close', round: done, t: x, length: p.close, tight: 0, presence: 1 - sine(x / p.close), completed: done };
  return { phase: 'done', round: done, t: x - p.close, length: 0, tight: 0, presence: 0, completed: done };
}

/** A fist with hysteresis (openness 0 = closed … 1 = open; tracking can flicker when the fingers are hidden). */
export class FistState {
  closed = false;
  update(openness: number | null): boolean {
    if (openness == null) return this.closed;
    if (!this.closed && openness < 0.3) this.closed = true;
    else if (this.closed && openness > 0.5) this.closed = false;
    return this.closed;
  }
}

/** A running session: its clock (shifted when the hands or the voice open early), finish, one more round. */
export class SqueezeSession {
  readonly pattern: SqueezePattern;
  private start = 0;
  private closing: { at: number; tight: number; completed: number } | null = null;
  private readonly squeezed = new Set<number>();
  private readonly released = new Set<number>();

  constructor(pattern: Partial<SqueezePattern> = {}) {
    this.pattern = { ...DEFAULT_SQUEEZE, ...pattern };
  }

  begin(t: number): void {
    this.start = t;
    this.closing = null;
    this.squeezed.clear();
    this.released.clear();
  }

  frame(t: number): SqueezeFrame {
    if (this.closing == null) return squeezeAt(this.pattern, t - this.start);
    const since = t - this.closing.at;
    const p = this.pattern;
    if (since < p.close) return { phase: 'close', round: this.closing.completed, t: since, length: p.close, tight: this.closing.tight * (1 - sine(since / 1.2)), presence: 1 - sine(since / p.close), completed: this.closing.completed };
    return { phase: 'done', round: this.closing.completed, t: since - p.close, length: 0, tight: 0, presence: 0, completed: this.closing.completed };
  }

  get finishing(): boolean {
    return this.closing != null;
  }

  /** "Enough": the light settles from where it is, then the lamp goes home. */
  finish(t: number): void {
    if (this.closing != null) return;
    const f = this.frame(t);
    if (f.phase === 'close' || f.phase === 'done') return;
    this.closing = { at: t, tight: f.tight, completed: f.completed };
  }

  /** "Once more": one more round of fists (up to MAX_ROUNDS), only before the shoulders. */
  more(t: number): boolean {
    const f = this.frame(t);
    if (this.closing != null || this.pattern.rounds >= MAX_ROUNDS || (f.phase !== 'settle' && f.phase !== 'squeeze' && f.phase !== 'release')) return false;
    this.pattern.rounds++;
    return true;
  }

  /**
   * The fists closed (hands, the voice "squeeze", or the touch): the round counts as squeezed.
   * Returns true when this changed something.
   */
  clench(t: number): boolean {
    const f = this.frame(t);
    if (f.phase !== 'squeeze' || this.squeezed.has(f.round)) return false;
    this.squeezed.add(f.round);
    return true;
  }

  /**
   * The fists opened (hands, "let go", or the touch). During a squeeze held ≥ MIN_SQUEEZE s, the release starts now
   * (the clock jumps to it). Returns true when the release was brought forward.
   */
  unclench(t: number): boolean {
    const f = this.frame(t);
    if (f.phase === 'release') {
      this.released.add(f.round);
      return false;
    }
    if (f.phase !== 'squeeze' || f.t < MIN_SQUEEZE) return false;
    this.start -= f.length - f.t;
    this.released.add(f.round);
    return true;
  }

  /** True when the hands (or the voice / touch) squeezed then let go in this round. */
  followed(round: number): boolean {
    return this.squeezed.has(round) && this.released.has(round);
  }

  followedCount(): number {
    let n = 0;
    for (const r of this.squeezed) if (this.released.has(r)) n++;
    return n;
  }
}

/** Glass caption for a frame. */
export function squeezeCaption(f: SqueezeFrame, p: SqueezePattern, quiet = false): { text: string; sub: string } {
  const last = f.round === p.rounds - 1;
  switch (f.phase) {
    case 'settle':
      return { text: 'Make two fists.', sub: quiet ? 'Squeeze as the light gathers, open them to let it go. Or touch the button below.' : 'Squeeze as the light gathers, open them to let it go.' };
    case 'squeeze':
      return { text: 'Squeeze… hold.', sub: last && p.rounds > 1 ? 'Last time: hands, arms, shoulders.' : f.round === 0 ? 'Tight, never painful.' : `Round ${f.round + 1} of ${p.rounds}` };
    case 'release':
      return { text: '…and let go.', sub: f.round === 0 ? 'Feel the warmth leave your hands.' : 'Let it escape.' };
    case 'shoulders-up':
      return { text: 'Shoulders up to your ears.', sub: 'Hold them there.' };
    case 'shoulders-down':
      return { text: 'And drop them.', sub: 'Let them fall.' };
    case 'jaw':
      return { text: 'Unclench your jaw.', sub: 'Let your tongue rest. Breathe out slowly.' };
    case 'close':
    case 'done': {
      const n = f.completed;
      return { text: 'Well done.', sub: n === 0 ? 'Gently. That was enough.' : `${n === 1 ? 'Once' : `${n} times`} the light left your hands.` };
    }
  }
}

/** What the lamp says when a phase starts (null: the sounds carry it). */
export function squeezeLine(f: SqueezeFrame, p: SqueezePattern): string | null {
  const last = f.round === p.rounds - 1 && p.rounds > 1;
  switch (f.phase) {
    case 'settle':
      return 'Let the body go. Make two fists, slowly.';
    case 'squeeze':
      if (f.round === 0) return 'Squeeze. Hold it.';
      return last ? 'Last time. Squeeze everything.' : 'Once more. Squeeze.';
    case 'release':
      if (f.round === 0) return 'And let go.';
      return last ? 'And let it all go.' : null;
    case 'shoulders-up':
      return 'Shoulders up to your ears.';
    case 'shoulders-down':
      return 'And drop them.';
    case 'jaw':
      return 'Unclench your jaw. Let your tongue rest.';
    case 'close':
      return 'Well done.';
    default:
      return null;
  }
}

/** Every line squeezeLine can return (voice catalogue). */
export const SQUEEZE_LINES = [
  'Let the body go. Make two fists, slowly.',
  'Squeeze. Hold it.',
  'Once more. Squeeze.',
  'Last time. Squeeze everything.',
  'And let go.',
  'And let it all go.',
  'Shoulders up to your ears.',
  'And drop them.',
  'Unclench your jaw. Let your tongue rest.',
  'Well done.',
] as const;

/** The touch button's label for a frame: what touching it does now (the touch twin of the fists). */
export function squeezeButton(f: SqueezeFrame): string | null {
  if (f.phase === 'squeeze') return 'Let go';
  if (f.phase === 'settle' || f.phase === 'release') return 'Once more';
  return null;
}
