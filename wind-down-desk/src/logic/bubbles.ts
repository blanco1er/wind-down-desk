/**
 * Suggested replies (24 Oct, axe 4; inspired by Mindtopia's bubbles, our way): when someone hesitates, at most three
 * short sentences they could say, touchable (or chosen by gaze), so nobody is ever stuck in front of a question.
 * Pure and unit-tested. A touched bubble goes through exactly the same path as a spoken sentence.
 *
 *   Unload, talk evening, nothing said for 5 s and no stone waiting → three common evening worries, rotating;
 *     once stones are sorted → two more worries and "That's all for tonight."
 *   (Quiet evenings keep their word grid: bubbles are for voice evenings.)
 */
export const HESITATE_AFTER = 5;

export const WORRY_BUBBLES = [
  'Too many emails are waiting.',
  'I need to call someone back.',
  'Tomorrow’s meeting worries me.',
  'Money has been on my mind.',
  'I keep putting something off.',
  'I said something I regret.',
  'My health has been on my mind.',
  'I have too much to do this week.',
  'Someone is waiting for my answer.',
] as const;

export const DONE_BUBBLE = 'That’s all for tonight.';

/** "Talk it through": when the person falls silent (8 s, the lamp quiet), three ways to go on. */
export const TALK_BUBBLES = ['Today was a lot.', 'Something is on my mind.', 'Can we talk about tomorrow?', 'I feel tired, that is all.', 'Let’s breathe together.'] as const;
export const TALK_HESITATE_AFTER = 8;

export interface BubbleContext {
  /** Talk evening (voice) or quiet (touch words instead). */
  quiet: boolean;
  mode: string;
  phase: string;
  /** Stones on the desk tonight, and how many still wait to be sorted. */
  stones: number;
  toSort: number;
  /** Seconds since the person last spoke or touched anything. */
  idle: number;
  /** Bubbles already used tonight (never offered twice). */
  used: ReadonlySet<string>;
  /** Rotates the suggestions from one evening to the next. */
  seed: number;
}

export function bubbleLines(c: BubbleContext): string[] | null {
  if (c.mode === 'talk') {
    if (c.idle < TALK_HESITATE_AFTER) return null;
    const fresh: string[] = [];
    for (let k = 0; k < TALK_BUBBLES.length && fresh.length < 3; k++) {
      const line = TALK_BUBBLES[(c.seed + k) % TALK_BUBBLES.length];
      if (!c.used.has(line)) fresh.push(line);
    }
    return fresh.length > 0 ? fresh : null;
  }
  if (c.quiet || c.mode !== 'unload' || c.phase !== 'dump' || c.toSort > 0 || c.idle < HESITATE_AFTER) return null;
  const fresh: string[] = [];
  for (let k = 0; k < WORRY_BUBBLES.length && fresh.length < 3; k++) {
    const line = WORRY_BUBBLES[(c.seed + k) % WORRY_BUBBLES.length];
    if (!c.used.has(line)) fresh.push(line);
  }
  if (c.stones === 0) return fresh.length > 0 ? fresh : null;
  return [...fresh.slice(0, 2), DONE_BUBBLE];
}
