/**
 * The evening around the rituals (pure, unit-tested): which ritual the lamp proposes, and the
 * spoken commands that pick, accept, decline or end one.
 *
 *   arrive ──placed──▶ choose ──pick / accept──▶ unload | breathe | release ──done──▶ choose (next proposal)
 *                        │                                                              │
 *                        └────────── "good night" / "Good night" row ──────────▶ night ◀┘
 *
 * The agent proposes, the person decides: nothing starts without a "yes", a touch on a menu row,
 * or a plain brain dump (which is already the start of Unload).
 * Proposal lines come from a fixed catalogue so every one of them is pre-voiced (lamp-lines.ts).
 */
import { normalize } from './text.ts';

export type RitualKind = 'unload' | 'breathe' | 'release';
export const RITUAL_KINDS: readonly RitualKind[] = ['unload', 'breathe', 'release'];
export type EveningMode = 'arrive' | 'choose' | RitualKind | 'night' | 'morning';

export type Feeling = 'tense' | 'heavy' | 'many' | 'neutral';

export interface Proposal {
  ritual: RitualKind | 'sleep';
  /** Main caption, spoken by the lamp. */
  line: string;
  sub: string;
  reason: 'start' | 'late' | 'tense' | 'heavy' | 'many' | 'chain' | 'all-done';
  /** Words to carry into the ritual (the heavy thing, the brain dump). */
  carry?: string;
}

export interface ProposalInput {
  /** Local hour 0–23. */
  hour: number;
  /** What the person just said (choose mode), if anything. */
  heard?: string;
  /** Rituals already completed tonight, in order. */
  doneTonight: RitualKind[];
  /** The ritual that just ended, if any (chaining). */
  justDone?: RitualKind | null;
  /** 23 Oct: nobody has ever sorted a stone here (a judge's cold start): the core gesture comes first. */
  firstEvening?: boolean;
}

const TENSE = /\b(tense|tension|stress|stressed|stressful|anxious|anxiety|overwhelm\w*|panic\w*|racing|on edge|nervous|wired|cant (sleep|relax|breathe|calm down)|tight|knot|exhausted|frazzled|shaky|restless|burn(t|ed) out|heart (is )?pounding)\b/u;
const HEAVY = /\b(keep (thinking|replaying|going over|coming back)|cant stop (thinking|replaying|worrying)|cant let (it )?go|weigh(s|ing)?|heavy|bother(s|ing)?|hurt(s|ing)?|upset|angry|ashamed|guilt|guilty|regret\w*|replay\w*|haunt\w*|stuck on|dread\w*|still thinking)\b/u;
const MANY = /\b(so much|too much|lots|a lot|everything|to do|to-do|list|deadlines|a million|so many|all the things|emails)\b/u;

/** Rough count of separate things in what was said (commas, "and", sentences). */
export function itemCount(text: string): number {
  const parts = text
    .split(/[.;!?]+|,\s*|\s+(?:and also|and then|also|plus|oh and)\s+/iu)
    .map((p) => p.trim())
    .filter((p) => p.split(/\s+/u).length >= 2);
  return Math.max(parts.length, text.trim().length > 0 ? 1 : 0);
}

export function classifyFeeling(text: string): Feeling {
  const n = normalize(text);
  if (n.length === 0) return 'neutral';
  const items = itemCount(text);
  const heavy = HEAVY.test(n);
  const tense = TENSE.test(n);
  const many = MANY.test(n) || items >= 3;
  if (heavy && items <= 2 && !MANY.test(n)) return 'heavy';
  if (tense) return 'tense';
  if (many || items >= 2) return 'many';
  if (heavy) return 'heavy';
  return 'neutral';
}

export const PROPOSAL_LINES = {
  start: 'Evening. Shall we empty your head first?',
  late: 'It is late. A minute of breathing, then sleep?',
  tense: 'You sound tense. Shall we breathe first?',
  heavy: 'That sounds heavy. Shall we let it sink?',
  many: "Lots on your mind. Let's put it all on the desk.",
  afterUnload: 'Your desk is clear. Anything still heavy?',
  afterRelease: 'Shall we breathe for a minute now?',
  afterBreathe: 'Ready for sleep?',
  again: 'Another ritual, or good night?',
  decline: 'Okay. Pick a ritual by the lamp, or just talk.',
} as const;

const MENU_HINT = 'Say "yes", tell me how you feel, or pick a ritual by the lamp.';

function nextNotDone(order: RitualKind[], done: RitualKind[]): RitualKind | null {
  return order.find((r) => !done.includes(r)) ?? null;
}

/** The lamp's proposal. Deterministic: same evening, same words, same proposal. */
export function proposeRitual(input: ProposalInput): Proposal {
  const late = input.hour >= 23 || input.hour < 5;
  const heard = input.heard?.trim() ?? '';
  if (heard.length > 0) {
    const feeling = classifyFeeling(heard);
    if (feeling === 'heavy') return { ritual: 'release', line: PROPOSAL_LINES.heavy, sub: 'Say "yes", or pick a ritual by the lamp.', reason: 'heavy', carry: heard };
    if (feeling === 'tense') return { ritual: 'breathe', line: PROPOSAL_LINES.tense, sub: 'Say "yes", or pick a ritual by the lamp.', reason: 'tense', carry: heard };
    if (feeling === 'many') return { ritual: 'unload', line: PROPOSAL_LINES.many, sub: '', reason: 'many', carry: heard };
  }
  const done = input.doneTonight;
  if (input.justDone === 'unload' && !done.includes('release')) {
    return { ritual: 'release', line: PROPOSAL_LINES.afterUnload, sub: 'Say "yes" to let it sink, or pick a ritual by the lamp.', reason: 'chain' };
  }
  if (input.justDone === 'release' && !done.includes('breathe')) {
    return { ritual: 'breathe', line: PROPOSAL_LINES.afterRelease, sub: 'Say "yes", or "good night".', reason: 'chain' };
  }
  if (input.justDone === 'breathe' || (input.justDone != null && nextNotDone(['breathe'], done) == null)) {
    return { ritual: 'sleep', line: PROPOSAL_LINES.afterBreathe, sub: 'Say "good night", or pick a ritual by the lamp.', reason: 'all-done' };
  }
  if (input.justDone != null) {
    const next = nextNotDone(['release', 'breathe', 'unload'], done);
    return next == null
      ? { ritual: 'sleep', line: PROPOSAL_LINES.afterBreathe, sub: 'Say "good night", or pick a ritual by the lamp.', reason: 'all-done' }
      : { ritual: next, line: PROPOSAL_LINES.again, sub: MENU_HINT, reason: 'chain' };
  }
  if (input.firstEvening === true && done.length === 0) {
    return { ritual: 'unload', line: PROPOSAL_LINES.start, sub: MENU_HINT, reason: 'start' };
  }
  if (late && !done.includes('breathe')) {
    return { ritual: 'breathe', line: PROPOSAL_LINES.late, sub: MENU_HINT, reason: 'late' };
  }
  if (!done.includes('unload')) {
    return { ritual: 'unload', line: PROPOSAL_LINES.start, sub: MENU_HINT, reason: 'start' };
  }
  const next = nextNotDone(['release', 'breathe'], done);
  return next == null
    ? { ritual: 'sleep', line: PROPOSAL_LINES.afterBreathe, sub: 'Say "good night", or pick a ritual by the lamp.', reason: 'all-done' }
    : { ritual: next, line: PROPOSAL_LINES.again, sub: MENU_HINT, reason: 'chain' };
}

export type RitualCommand =
  | { type: 'pick'; ritual: RitualKind }
  | { type: 'accept' }
  | { type: 'decline' }
  | { type: 'menu' }
  | { type: 'finish' }
  | { type: 'longer' }
  | { type: 'sink' }
  | { type: 'goodnight' };

/**
 * Whole-sentence commands only (a brain dump that mentions breathing never switches ritual).
 * `where`: 'choose' (a proposal may be pending), 'breathe', 'release', or 'unload'.
 */
export function parseRitualCommand(text: string, where: 'choose' | 'breathe' | 'release' | 'unload' | 'other'): RitualCommand | null {
  let n = normalize(text).replace(/\b(please|lamp)\b/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (n !== 'not now') n = n.replace(/\s+(now|then)$/u, '').replace(/^(okay|ok|so|well|then) (?=\w)/u, '').trim();
  if (n.length === 0) return null;
  if (/^(good ?night|goodnight|im going to (bed|sleep)|time (for|to) (bed|sleep)|sleep)$/u.test(n)) return { type: 'goodnight' };
  if (/^((show (me )?)?(the )?rituals?|menu|what can we do|options|other rituals?)$/u.test(n)) return { type: 'menu' };
  if (/^((lets |can we |i want to |i need to |id like to )?(breathe|breathing|do (some |the )?breathing|breathe (with me|together)|a breathing (minute|exercise))( together)?)$/u.test(n)) {
    return where === 'breathe' ? null : { type: 'pick', ritual: 'breathe' };
  }
  if (/^((lets |can we |i want to |id like to )?(release|do (a |the )?release|let something (go|sink)|sink a stone|the (water|black) bowl))$/u.test(n)) {
    return where === 'release' ? null : { type: 'pick', ritual: 'release' };
  }
  if (/^((lets |can we |i want to |id like to )?(unload|empty my head|brain dump|do (a |the )?brain dump|sort my thoughts|the stones))$/u.test(n)) {
    return where === 'unload' ? null : { type: 'pick', ritual: 'unload' };
  }
  if (where === 'release' && /^(let (it|that|this) (go|sink)|let go|let it|drop it|release it|sink it|go|its gone|i let (it )?go|gone)$/u.test(n)) {
    return { type: 'sink' };
  }
  if ((where === 'breathe' || where === 'release') && /^(stop|skip|thats enough|enough|im done|finish|end( it)?|thats it|done|i want to stop|not now)$/u.test(n)) {
    return { type: 'finish' };
  }
  if (where === 'breathe' && /^(longer|more|keep going|a few more|again|a bit longer|more breaths)$/u.test(n)) {
    return { type: 'longer' };
  }
  if (where === 'choose') {
    if (/^(yes|yeah|yep|yup|sure|ok(ay)?|alright|all right|please|lets do (it|that)|lets|sounds good|good idea|why not|go ahead|yes please|ok lets do it|lets go|i would like that|that would be nice)( lets do it)?$/u.test(n)) return { type: 'accept' };
    if (/^(no|nope|not now|no thanks|no thank you|something else|maybe later|not really|not tonight|nah)$/u.test(n)) return { type: 'decline' };
  }
  return null;
}

/** Labels of the glass ritual menu (rows by the lamp). */
export const RITUAL_MENU: ReadonlyArray<{ id: RitualKind | 'sleep'; name: string; sub: string }> = [
  { id: 'unload', name: 'Unload', sub: 'Empty your head, sort by hand' },
  { id: 'breathe', name: 'Breathe', sub: 'One slow minute, 4 in, 6 out' },
  { id: 'release', name: 'Release', sub: 'Let one heavy thing sink' },
  { id: 'sleep', name: 'Good night', sub: 'End the evening' },
];
