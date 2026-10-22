/**
 * "What weighs on you?" → the few words engraved on the Release stone (≤ 4 words, ≤ 24 characters).
 * On-device, deterministic (the server's language model, when configured, is validated against the same limits).
 *   "I can't stop thinking about the meeting with Paul tomorrow, I'm dreading it." → "The meeting with Paul"
 */
import { capitalize } from '../../logic/text.ts';

export const WEIGHT_LIMITS = { words: 4, chars: 24 } as const;

const LEAD = new RegExp(
  [
    String.raw`^(?:(?:so|well|um+|uh+|honestly|i guess|i think|okay|ok|hmm+|and|but|just|really|yeah|oh)[\s,]+)+`,
  ].join(''),
  'iu',
);

const FRAMES: RegExp[] = [
  /^(?:what(?:'s| is)? (?:weighs|weighing|bothers|bothering|heavy)(?: on me)?(?: tonight| today)?(?: is)?)\s*/iu,
  /^(?:the thing (?:is|that weighs on me is)|it(?:'s| is)(?: just| really| mostly)?|its)\s+/iu,
  /^(?:i (?:just |really |still )?(?:can'?t|cannot) (?:stop|quit) (?:thinking|worrying) about|i (?:still |just )?keep (?:thinking about|replaying|going over|worrying about|coming back to))\s+/iu,
  /^(?:i(?:'m| am) (?:so |really |still |a bit |quite )?(?:worried|anxious|stressed|upset|angry|sad|nervous|scared|hurt|annoyed|ashamed|embarrassed|dreading)(?: about| by| over| that| of)?)\s+/iu,
  /^(?:i feel (?:so |really |a bit )?(?:bad|guilty|awful|terrible|stupid|weird|sad|hurt|stressed) (?:about|for|that))\s+/iu,
  /^(?:i(?:'m| am) (?:still )?(?:thinking|worrying) about|i (?:regret|dread|hate|miss)|there(?:'s| is| was))\s+/iu,
];

/** Trailing time words and tails that do not belong on the stone. */
const TAILS: RegExp[] = [
  /,.*$/u,
  /\s+(?:and|but|because|since|so|cause|cuz)\b.*$/iu,
  /\s+(?:i(?:'m| am)|it(?:'s| is)|that i|which|who)\b.*$/iu,
  /\s+(?:i|we|you|he|she|they)\s+(?:made|said|did|had|sent|wrote|got|gave|told)\b.*$/iu,
  /\s+(?:tomorrow|today|tonight|this (?:morning|afternoon|evening|week)|earlier|again|all day|right now|anymore|lately)\s*$/iu,
  /\s+(?:at work|at the office|on monday|on friday)\s*$/iu,
];

const FUNCTION_WORDS = new Set(['the', 'a', 'an', 'my', 'with', 'about', 'of', 'to', 'for', 'at', 'in', 'on', 'and', 'or', 'from', 'by', 'that', 'his', 'her', 'their', 'our', 'your']);
const PREPOSITIONS = /\s+(?:about|because|since|regarding|during|after|before|over|at|in|on|for|from|when|while)\s+[^]*$/iu;

/** First sentence of what was said, without the framing ("I can't stop thinking about …"). */
function core(text: string): string {
  let t = text.replace(/\s+/gu, ' ').trim();
  t = t.split(/(?<=[.!?;])\s+/u)[0] ?? t;
  t = t.replace(/[.!?;]+$/u, '').trim();
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(LEAD, '');
    for (const frame of FRAMES) t = t.replace(frame, '');
    t = t.trim();
    if (t === before) break;
  }
  for (let i = 0; i < 3; i++) {
    const before = t;
    for (const tail of TAILS) t = t.replace(tail, '').trim();
    if (t === before) break;
  }
  return t.replace(/^(?:about|that|of|over)\s+/iu, '').trim();
}

function fits(words: string[]): boolean {
  return words.length <= WEIGHT_LIMITS.words && words.join(' ').length <= WEIGHT_LIMITS.chars;
}

/** The engraving for the Release stone. Never empty: falls back to "This weight". */
export function weightTitle(text: string): string {
  const t = core(text);
  const bare = (x: string) => x.replace(/^(?:the|a|an)\s+/iu, '');
  const cut = t.replace(PREPOSITIONS, '').trim();
  // Shortest faithful version that fits: as said, without the article, without a trailing "about …".
  const candidates = [t, bare(t), cut, bare(cut)].map((c) => c.split(' ').filter(Boolean));
  let words = candidates.find((c) => c.length >= 1 && fits(c)) ?? candidates[1];
  while (!fits(words) && words.length > 1) {
    words = words.slice(0, -1);
  }
  while (words.length > 1 && FUNCTION_WORDS.has(words[words.length - 1].toLowerCase())) {
    words = words.slice(0, -1);
  }
  const title = words.join(' ').replace(/[,.;:!?]+$/u, '').trim();
  if (title.length < 3) return 'This weight';
  // Keep the person's own capitals (names), capitalise the first letter only.
  return capitalize(title);
}

/** Validates a model's answer against the same limits (server side). */
export function cleanWeightTitle(raw: unknown, fallbackText: string): string {
  if (typeof raw !== 'string') return weightTitle(fallbackText);
  const t = raw.replace(/["“”]/gu, '').replace(/[.!?]+$/u, '').replace(/\s+/gu, ' ').trim();
  const words = t.split(' ').filter(Boolean);
  if (words.length === 0 || !fits(words) || /[\n{}<>]/u.test(t)) return weightTitle(fallbackText);
  return capitalize(t);
}
