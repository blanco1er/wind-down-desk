/**
 * Voice alternative for every gesture (pure, unit-tested, works offline).
 *
 * Every hand action has a spoken equivalent:
 *   pinch + place  → "dentist, tomorrow" / "put the slides in later"
 *   drop in Let go → "let go of that comment" / "release the passport one"
 *   undo           → "undo" / "put it back"
 *   orb pinch      → "that's it" (end brain dump) / "stop listening"
 *   plan buttons   → "keep it" / "make it lighter"
 * Deictic words ("this one", "it") resolve to the token you are looking at,
 * then to the one you touched last.
 */
import { BIN_IDS, type BinId } from './desk-layout.ts';
import { contentWords, normalize, similarity } from './text.ts';

export type Intent =
  | { type: 'move'; tokenId: string; bin: BinId }
  | { type: 'move-all-suggested' }
  | { type: 'undo' }
  | { type: 'add'; text: string }
  | { type: 'discard'; tokenId: string }
  | { type: 'confirm' }
  | { type: 'lighter' }
  | { type: 'done' }
  | { type: 'start' }
  | { type: 'help' }
  | { type: 'mute' }
  | { type: 'goodnight' }
  | { type: 'recenter' }
  | { type: 'ambiguous'; bin: BinId | null; candidates: string[] }
  | { type: 'none'; text: string };

export interface TokenRef {
  id: string;
  text: string;
}

export interface IntentContext {
  /** Tokens currently on the desk, in visual order (left → right). */
  tokens: TokenRef[];
  /** Token under the head-gaze cone, if any. */
  gazedId?: string | null;
  /** Token most recently touched or created. */
  lastId?: string | null;
}

const BIN_PATTERNS: Array<{ bin: BinId; pattern: RegExp }> = [
  { bin: 'let-go', pattern: /\b(let (it |that |this |them )?go( of)?|let go|release|forget( about)?( it)?|drop it|bin it|trash|not (mine|my problem)|doesnt matter|let it be|dissolve)\b/u },
  { bin: 'tomorrow', pattern: /\b(tomorrow|first thing|in the morning|morning|tmrw|to morrow)\b/u },
  { bin: 'later', pattern: /\b(later|someday|some day|next week|next month|eventually|not now|park it|another day|after|this weekend|weekend)\b/u },
];

const ORDINALS: Record<string, number> = {
  first: 0, '1st': 0, one: 0,
  second: 1, '2nd': 1, two: 1,
  third: 2, '3rd': 2, three: 2,
  fourth: 3, '4th': 3, four: 3,
  fifth: 4, '5th': 4, five: 4,
  sixth: 5, '6th': 5, six: 5,
  seventh: 6, '7th': 6, seven: 6,
  eighth: 7, '8th': 7, eight: 7,
};

const DEICTIC = /\b(this|that|it|this one|that one|the one)\b/u;

const BIN_WORDS = new Set(
  ['tomorrow', 'morning', 'later', 'someday', 'next', 'week', 'month', 'eventually', 'let', 'go', 'release', 'forget', 'drop', 'bin', 'trash', 'park', 'first', 'thing', 'weekend', 'day', 'another', 'dissolve', 'not', 'now', 'matter', 'doesnt', 'mine', 'problem', 'last'].map((w) => w),
);

export function detectBin(text: string): BinId | null {
  const n = normalize(text);
  for (const { bin, pattern } of BIN_PATTERNS) {
    if (pattern.test(n)) {
      return bin;
    }
  }
  return null;
}

/** Resolves which token an utterance refers to. Returns ids ranked by confidence. */
export function resolveTokens(text: string, ctx: IntentContext): string[] {
  const n = normalize(text);
  const words = n.split(' ');
  if (/\b(last one|the last)\b/u.test(n) && ctx.tokens.length > 0) {
    return [ctx.tokens[ctx.tokens.length - 1].id];
  }
  for (const word of words) {
    const index = ORDINALS[word];
    if (index != null && /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|1st|2nd|3rd|4th|5th|6th|7th|8th|number)\b/u.test(n)) {
      return ctx.tokens[index] != null ? [ctx.tokens[index].id] : [];
    }
  }
  const query = contentWords(n).filter((w) => !BIN_WORDS.has(w)).join(' ');
  if (query.length > 0) {
    const scored = ctx.tokens
      .map((t) => ({ id: t.id, score: similarity(query, t.text) }))
      .filter((s) => s.score >= 0.34)
      .sort((a, b) => b.score - a.score);
    if (scored.length > 0) {
      if (scored.length > 1 && scored[0].score - scored[1].score < 0.08) {
        return scored.map((s) => s.id);
      }
      return [scored[0].id];
    }
  }
  if (DEICTIC.test(n) || query.length === 0) {
    const fallback = ctx.gazedId ?? ctx.lastId ?? null;
    if (fallback != null && ctx.tokens.some((t) => t.id === fallback)) {
      return [fallback];
    }
  }
  return [];
}

/**
 * "Move my desk" (and friends), in every mode of the evening (22 Oct: it used to work only during Unload).
 * `n` is a normalized utterance (text.ts normalize).
 */
export function isDeskMove(n: string): boolean {
  // A command is short: "move my desk to the window this weekend" is a worry for the brain dump, not a command.
  if (n.split(/\s+/u).length > 5) return false;
  return /^(recenter|re center|move (the|my) desk( here)?|find (my|the) table|bring (the|my) desk (here|closer))\b/u.test(n);
}

/**
 * Parses one utterance. `phase` changes the default reading: during the brain
 * dump, free speech is content (`none`), during sorting it is a command.
 */
export function parseIntent(utterance: string, ctx: IntentContext, phase: 'dump' | 'sort' | 'plan' | 'other' = 'sort'): Intent {
  const n = normalize(utterance);
  if (n.length === 0) {
    return { type: 'none', text: '' };
  }
  if (/^(help|what can i say|how does (this|it) work|commands)\b/u.test(n)) {
    return { type: 'help' };
  }
  if (/^(undo|put it back|go back|oops|wait no|no wait|take that back)\b/u.test(n)) {
    return { type: 'undo' };
  }
  if (/\b(good ?night|goodnight|im going to (bed|sleep)|exit|close the desk)\b/u.test(n)) {
    return { type: 'goodnight' };
  }
  if (isDeskMove(n)) {
    return { type: 'recenter' };
  }
  if (/^(stop listening|mute|mic off|be quiet)\b/u.test(n)) {
    return { type: 'mute' };
  }
  if (/^(start|begin|im ready|ready|lets (start|begin|go))\b/u.test(n) && phase === 'other') {
    return { type: 'start' };
  }
  if (/^(thats (it|all|everything)|that is (it|all|everything)|im done|i am done|done|nothing else|thats about it|finished|thats enough)\b/u.test(n) && phase === 'dump') {
    return { type: 'done' };
  }
  if (phase === 'plan') {
    if (/\b(keep|looks good|sounds good|perfect|yes|yeah|ok(ay)?|great|deal|save it|confirm)\b/u.test(n)) {
      return { type: 'confirm' };
    }
    if (/\b(lighter|simpler|less|too much|smaller|easier|another|redo|again|no)\b/u.test(n)) {
      return { type: 'lighter' };
    }
  }
  if (phase === 'dump') {
    const add = /^(add|also|and also|one more|another one)\b[:,]?\s*(.*)$/u.exec(n);
    if (add != null && add[2].length > 2) {
      return { type: 'add', text: utterance.replace(/^\s*(add|also|and also|one more|another one)\s*[:,]?\s*/iu, '') };
    }
    return { type: 'none', text: utterance };
  }
  if (/\b(sort (them|it|everything) (for me|as suggested)|use (your )?suggestions|do what you suggest|accept (all|the suggestions))\b/u.test(n)) {
    return { type: 'move-all-suggested' };
  }
  const add = /^(add|also add|one more)\b[:,]?\s*(.*)$/u.exec(n);
  if (add != null && add[2].length > 2) {
    return { type: 'add', text: utterance.replace(/^\s*(add|also add|one more)\s*[:,]?\s*/iu, '') };
  }
  if (/^(remove|delete|thats not a worry|scratch)\b/u.test(n)) {
    const ids = resolveTokens(n.replace(/^(remove|delete|scratch)\s*/u, ''), ctx);
    if (ids.length === 1) {
      return { type: 'discard', tokenId: ids[0] };
    }
    return { type: 'ambiguous', bin: null, candidates: ids };
  }
  const bin = detectBin(n);
  if (bin != null) {
    const ids = resolveTokens(n, ctx);
    if (ids.length === 1) {
      return { type: 'move', tokenId: ids[0], bin };
    }
    return { type: 'ambiguous', bin, candidates: ids };
  }
  if (phase === 'plan' || phase === 'other') {
    return { type: 'none', text: utterance };
  }
  return { type: 'none', text: utterance };
}

export const VOICE_HELP = [
  '"Dentist, tomorrow"',
  '"Let go of that comment"',
  '"This one, later"',
  '"Undo"',
  '"That\'s it" ends the brain dump',
];

/** Display label of a bin for captions. */
export function binLabel(bin: BinId): string {
  return bin === 'let-go' ? 'Let go' : bin === 'tomorrow' ? 'Tomorrow' : 'Later';
}

export function isBinId(value: unknown): value is BinId {
  return typeof value === 'string' && (BIN_IDS as readonly string[]).includes(value);
}

/**
 * "voice off" / "be quiet" → false, "voice on" / "talk to me" → true (whole sentence only,
 * so a brain dump that mentions a voice never mutes the lamp). `normalized`: logic/text.ts normalize.
 */
export function parseVoiceToggle(normalized: string): boolean | null {
  const n = normalized.trim();
  // "Sound" is the one switch (owner, 18 Oct): voice, cues, ambience and rain together.
  if (/^(voice off|sound off|mute (the )?(voice|lamp|sound|sounds)|turn (the )?(voice|sound) off|be quiet( please)?|quiet please|stop talking|no voice|no sound|silence)$/u.test(n)) {
    return false;
  }
  if (/^(voice on|sound on|unmute|unmute( the)? (voice|lamp|sound|sounds)|turn (the )?(voice|sound) on|talk to me|you can talk|speak to me)$/u.test(n)) {
    return true;
  }
  return null;
}
