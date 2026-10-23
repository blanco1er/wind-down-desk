/**
 * The first minute, shown not told (pure, unit-tested). Jury criterion "immediate usability, clear onboarding":
 * a judge who has read nothing must sort a first stone in under 60 s, by voice or in silence.
 *
 *   first evening        → the lamp goes straight into Unload ("Evening. What is on your mind?"), no question first
 *   nothing said / touched for 8 s, no stone yet → one example stone lands on the tray (it is clearly an example)
 *   stones on the tray, none sorted yet, hands idle 2 s → a ghost hand shows the pinch: over the stone, pinch,
 *        carry along an arc, open over the bowl that stone belongs to (that bowl breathes with light)
 *   the first stone placed → the ghost never comes back this session (later evenings: only after 15 s idle)
 */

export const ONBOARDING = {
  /** Seconds of silence (no speech, no touch) before the example stone appears. */
  exampleAfter: 8,
  /** Seconds of idle hands before the ghost hand shows the gesture. */
  ghostAfter: 2,
  /** On later evenings the ghost waits much longer (people already know). */
  ghostAfterReturning: 15,
  /** Length of one demonstration loop (s). */
  cycle: 3.6,
} as const;

export interface OnboardingInput {
  firstEvening: boolean;
  mode: string;
  phase: string;
  stonesOnDesk: number;
  sortedThisSession: number;
  holding: boolean;
  /** Seconds since the person last spoke, touched something, or a stone landed. */
  idle: number;
  exampleShown: boolean;
}

export interface OnboardingStep {
  spawnExample: boolean;
  ghost: boolean;
}

export function onboardingStep(i: OnboardingInput): OnboardingStep {
  const unloading = i.mode === 'unload' && (i.phase === 'dump' || i.phase === 'sort');
  const spawnExample = unloading && i.phase === 'dump' && i.stonesOnDesk === 0 && !i.exampleShown && i.idle >= ONBOARDING.exampleAfter;
  const wait = i.firstEvening ? ONBOARDING.ghostAfter : ONBOARDING.ghostAfterReturning;
  const ghost = unloading && i.stonesOnDesk > 0 && i.sortedThisSession === 0 && !i.holding && i.idle >= wait;
  return { spawnExample, ghost };
}

export interface StoneLike {
  id: string;
  bin: string | null;
  suggestion: string | null;
  released: boolean;
}

/** The stone the ghost demonstrates on (the first unsorted one) and the bowl it goes to (its suggestion). */
export function ghostTarget(stones: readonly StoneLike[]): { stone: string; bin: 'tomorrow' | 'later' | 'let-go' } | null {
  const s = stones.find((t) => t.bin == null && !t.released);
  if (s == null) return null;
  const bin = s.suggestion === 'later' || s.suggestion === 'let-go' ? s.suggestion : 'tomorrow';
  return { stone: s.id, bin };
}

export interface GhostFrame {
  /** 0 at the stone, 1 at the bowl (along the arc). */
  travel: number;
  /** Height above the path (m): approach from above, lift while carrying. */
  lift: number;
  /** 0 open hand, 1 pinched. */
  pinch: number;
  /** Overall opacity 0..1. */
  alpha: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * One loop: fade in above the stone (0–0.5 s), come down (0.5–0.9), pinch (0.9–1.2), carry on an arc (1.2–2.3),
 * open over the bowl (2.3–2.6), fade out (2.6–3.1), rest (3.1–3.6).
 */
export function ghostFrame(t: number, out?: GhostFrame): GhostFrame {
  const k = ((t % ONBOARDING.cycle) + ONBOARDING.cycle) % ONBOARDING.cycle;
  const travel = smooth(1.2, 2.3, k);
  const approach = 1 - smooth(0.3, 0.9, k);
  const carry = Math.sin(Math.PI * travel) * 0.07;
  const pinch = smooth(0.9, 1.15, k) * (1 - smooth(2.3, 2.55, k));
  const alpha = smooth(0, 0.5, k) * (1 - smooth(2.6, 3.1, k));
  const f = out ?? { travel: 0, lift: 0, pinch: 0, alpha: 0 };
  f.travel = travel;
  f.lift = 0.012 + approach * 0.09 + carry;
  f.pinch = pinch;
  f.alpha = alpha;
  return f;
}

/** Example stone for a silent first minute: plainly an example, the most common evening worry. */
export const EXAMPLE_STONE = {
  title: 'Reply to the landlord',
  detail: 'An example: reply to the landlord about the heating.',
  suggestion: 'tomorrow' as const,
};

/** A spoken example under the caption while the lamp listens (voice evenings only). */
export const SPOKEN_EXAMPLE = 'Try: "I need to call the dentist."';
