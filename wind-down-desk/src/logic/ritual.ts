/**
 * The evening ritual as a small state machine (pure, unit-tested).
 *
 *   arrive ──placed──▶ dump ──done / enough tokens──▶ sort ──all sorted──▶ plan
 *     ▲                                                    │                 │
 *     └──────────── morning (Tomorrow tokens come back) ◀──┴── night ◀──kept─┘
 *
 * The welcome is designed to reach the first real action (a token on the
 * desk) in under 15 s and the first sort in under 60 s, without a tutorial
 * screen: each caption is the instruction for the next gesture.
 */

export type Phase = 'arrive' | 'dump' | 'sort' | 'plan' | 'night' | 'morning';

export type RitualEvent =
  | { type: 'placed' }
  | { type: 'tokens-added'; count: number }
  /** `unsorted`: stones still waiting (a quiet evening may already have sorted them all: then the plan comes). */
  /**
   * `stones` (29 Oct): the stones really on the desk tonight, when the caller knows them. Some arrive without a
   * 'tokens-added' (a follow-up from last night, Talk's weights): the count decides, so "That's all" is never ignored.
   */
  | { type: 'dump-done'; unsorted?: number; stones?: number }
  /** `keepDump` (quiet evening): sorting does not end the dump; the words come back, "That's all" ends it. */
  | { type: 'sorted'; remaining: number; keepDump?: boolean }
  | { type: 'plan-ready' }
  | { type: 'plan-kept' }
  | { type: 'skip-plan' }
  | { type: 'morning' };

export interface RitualState {
  phase: Phase;
  tokensOnDesk: number;
  sortedCount: number;
  /** Seconds since the session started, at each milestone (for onboarding metrics). */
  milestones: Partial<Record<'placed' | 'firstToken' | 'firstSort' | 'planShown' | 'night', number>>;
}

export function initialRitual(): RitualState {
  return { phase: 'arrive', tokensOnDesk: 0, sortedCount: 0, milestones: {} };
}

/** Pure transition. `t` is seconds since the session started. */
export function step(state: RitualState, event: RitualEvent, t: number): RitualState {
  const next: RitualState = { ...state, milestones: { ...state.milestones } };
  switch (event.type) {
    case 'morning':
      next.phase = 'morning';
      break;
    case 'placed':
      next.milestones.placed ??= t;
      if (state.phase === 'arrive') {
        next.phase = 'dump';
      }
      break;
    case 'tokens-added':
      next.tokensOnDesk += event.count;
      if (event.count > 0) {
        next.milestones.firstToken ??= t;
      }
      break;
    case 'dump-done':
      if (state.phase === 'dump' && (event.stones ?? next.tokensOnDesk) > 0) {
        if (event.unsorted === 0) {
          next.phase = 'plan';
          next.milestones.planShown ??= t;
        } else {
          next.phase = 'sort';
        }
      }
      break;
    case 'sorted':
      next.sortedCount += 1;
      next.milestones.firstSort ??= t;
      if (state.phase === 'dump' && event.keepDump === true) {
        break;
      }
      if (state.phase === 'dump') {
        // Sorting while still talking is allowed: the first sort ends the dump.
        next.phase = 'sort';
      }
      if (event.remaining === 0 && (next.phase === 'sort' || next.phase === 'dump')) {
        next.phase = 'plan';
        next.milestones.planShown ??= t;
      }
      break;
    case 'plan-ready':
      break;
    case 'plan-kept':
    case 'skip-plan':
      if (state.phase === 'plan') {
        next.phase = 'night';
        next.milestones.night ??= t;
      }
      break;
  }
  return next;
}

/**
 * 29 Oct (hands only, end to end): does picking up or sorting a stone end the brain dump? Only once the person has
 * actually spoken in it ("I'm done talking"). Someone who never speaks — a quiet evening, no microphone, or a talk
 * evening where they simply stay silent and touch — keeps the dump open: the words come back after each stone, and
 * "That's all" ends it.
 */
export function dumpEndsOnSort(c: { quiet: boolean; spoke: boolean }): boolean {
  return !c.quiet && c.spoke;
}

/** One-line instruction shown above the desk; doubles as the onboarding. */
export function caption(state: RitualState, extra: { listening: boolean; micAvailable: boolean; unsorted: number; quiet?: boolean }): string {
  switch (state.phase) {
    case 'arrive':
      return 'Evening. Finding your table…';
    case 'dump':
      // Quiet evening: touch only, never an invitation to talk. A stone waiting to be sorted folds the words away
      // (28 Oct: the caption said "Touch more words" over no words): the caption asks for the stone, then the words
      // come back with it.
      if (extra.quiet === true && !extra.listening) {
        if (state.tokensOnDesk === 0) return 'What is on your mind? Touch a word, or write it.';
        if (extra.unsorted > 0) {
          return extra.unsorted === 1 ? 'Now place the stone: Tomorrow, Later, or Let go.' : 'Now place the stones: Tomorrow, Later, or Let go.';
        }
        return 'Touch more words, or "That\'s all" when you are done.';
      }
      if (state.tokensOnDesk === 0) {
        if (extra.listening) {
          return 'What is on your mind? Just talk. Each thing becomes a stone.';
        }
        return extra.micAvailable
          ? 'What is on your mind? Touch the little lamp and just talk.'
          : 'No microphone. Touch the little lamp for an example evening.';
      }
      return extra.listening
        ? 'Keep going. Say "that\'s it" when your head feels lighter.'
        : 'Pinch a stone and place it. Or say "dentist, tomorrow".';
    case 'sort':
      return extra.unsorted === 1
        ? 'Last one. Where does it belong?'
        : 'Pinch a stone and place it: Tomorrow, Later, or Let go.';
    case 'plan':
      return 'Here is a gentle start for tomorrow. Keep it?';
    case 'night':
      return 'Your desk is clear. Good night.';
    case 'morning':
      return 'Good morning. Here is what you kept for today.';
  }
}
