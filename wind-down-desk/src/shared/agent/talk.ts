/**
 * "Talk it through" (24 Oct): a free voice conversation with the lamp in a calm place. Never called therapy.
 * Pure helpers shared by the server (LLM) and the browser (on-device fallback), unit-tested:
 *   - the cost of a turn never grows with the length of the talk: the model sees a rolling summary (≤ 600 chars)
 *     plus the last TALK.turns exchanges only;
 *   - replies are spoken: 1–3 short sentences, ≤ 260 characters, cut at a sentence end;
 *   - what weighs on them becomes stones (≤ 2 new titles a turn, 2–4 words, ≤ 5 in all), set down in the water at
 *     the end;
 *   - a talk lasts up to 45 minutes: the lamp announces a gentle end 5 minutes before, never a hard cut.
 */
import { cleanSummary, crisisInModelText, crisisSignal, CRISIS_REPLY } from './safety.ts';
import { extractJson } from './parse.ts';

export const TALK = {
  /** Last exchanges sent verbatim (older ones live in the rolling summary). */
  turns: 6,
  /** Spoken and shown whole: the caption holds three lines (~160 characters). */
  replyChars: 160,
  summaryChars: 600,
  maxWeights: 5,
  /** Minutes: the whole talk, and when the lamp announces the end. */
  maxMinutes: 45,
  windDownAt: 40,
  /** Longest sentence accepted from the person (chars). */
  inputChars: 1200,
} as const;

export interface TalkTurn {
  who: 'you' | 'lamp';
  text: string;
}

export interface TalkInput {
  text: string;
  summary: string;
  turns: TalkTurn[];
  /** Titles already on the desk tonight (no duplicates). */
  weights: string[];
  closing?: boolean;
}

export interface TalkReply {
  reply: string;
  /** New titles of what weighs (on top of `weights`). */
  weights: string[];
  summary: string;
  /** The sentence spoke of suicide or self-harm: fixed answer, help resources shown, no model call. */
  crisis: boolean;
  /** Set when this answer did NOT come from the configured model (e.g. "on-device fallback (LLM HTTP 400: …)"). */
  source?: string;
}

/** The bounded history: only the last `TALK.turns` exchanges are kept verbatim. */
export function boundTurns(turns: readonly TalkTurn[]): TalkTurn[] {
  return turns.slice(-TALK.turns).map((t) => ({ who: t.who, text: t.text.slice(0, 400) }));
}

/** At most `max` characters, cut at the last sentence end (never mid-word when avoidable). */
export function spokenCut(text: string, max = TALK.replyChars): string {
  const t = text.replace(/\s+/gu, ' ').replace(/[*_#`]/gu, '').trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
  if (end > max * 0.4) return head.slice(0, end + 1);
  return `${head.slice(0, head.lastIndexOf(' ')).trim()}…`;
}

function cleanWeight(w: unknown): string | null {
  if (typeof w !== 'string') return null;
  const words = w.replace(/[".]/gu, '').trim().split(/\s+/u).filter(Boolean).slice(0, 4);
  if (words.length === 0) return null;
  const t = words.join(' ');
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 28);
}

/** New weights only (case-insensitive), within the total budget. */
export function mergeWeights(existing: readonly string[], fresh: readonly unknown[]): string[] {
  const seen = new Set(existing.map((w) => w.toLowerCase()));
  const out: string[] = [];
  for (const w of fresh) {
    const c = cleanWeight(w);
    if (c == null || seen.has(c.toLowerCase())) continue;
    if (existing.length + out.length >= TALK.maxWeights || out.length >= 2) break;
    seen.add(c.toLowerCase());
    out.push(c);
  }
  return out;
}

/** The model's JSON → a safe reply (or null when unusable: the caller falls back to the on-device listener). */
export function parseTalkReply(raw: string, input: TalkInput): TalkReply | null {
  const j = extractJson(raw) as { reply?: unknown; weights?: unknown; summary?: unknown } | null;
  if (j == null || typeof j.reply !== 'string' || j.reply.trim().length === 0) return null;
  const reply = spokenCut(j.reply);
  const summary = typeof j.summary === 'string' ? j.summary.slice(0, TALK.summaryChars) : input.summary;
  // The second net (25 Oct): the person's words were missed but the model's reply or summary speaks of a crisis →
  // the fixed answer, the help card, no stone, and the crisis never stays in the summary.
  if (crisisInModelText(reply) || crisisInModelText(summary)) return { reply: CRISIS_REPLY, weights: [], summary: cleanSummary(input.summary), crisis: true };
  return {
    reply,
    weights: mergeWeights(input.weights, Array.isArray(j.weights) ? j.weights : []),
    summary: cleanSummary(summary),
    crisis: false,
  };
}

/** The user message sent to the model (summary + last turns + the new sentence): bounded size. */
export function talkUser(input: TalkInput): string {
  const turns = boundTurns(input.turns)
    .map((t) => `${t.who === 'you' ? 'Person' : 'Lamp'}: ${t.text}`)
    .join('\n');
  return [
    `Summary so far: ${cleanSummary(input.summary).slice(0, TALK.summaryChars) || '(the talk just started)'}`,
    `Stones already on the desk: ${input.weights.join(', ') || 'none'}`,
    turns.length > 0 ? `Last exchanges:\n${turns}` : '',
    `Person now: """${input.text.slice(0, TALK.inputChars)}"""`,
    `closing: ${input.closing === true}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const REFLECT = [
  (k: string) => `That sounds heavy. ${k} has been with you today.`,
  (k: string) => `I hear you. ${k} is taking a lot of room tonight.`,
  (k: string) => `Thank you for saying it. ${k} matters to you, I can tell.`,
];
/** When no clean name for the worry was found: gentle lines that need none (never a broken fragment). */
const REFLECT_PLAIN = ['That sounds heavy. Thank you for saying it out loud.', 'I hear you. It has been a lot today.', 'Thank you for telling me. That matters.'];

const NOT_A_START = new Set('i im ive id ill you youre we they he she it its was were is am are had have has feel felt keep kept need want think thought just so really very and but or because'.split(' '));
const NOT_AN_END = new Set('a an the to of about with for and but or so very really rough bad good hard long tough my your his her their our its is was were am are be been i me'.split(' '));

/**
 * A worry's title fit to be said back ("The deadline", "Sister has not called"), or null: never a fragment such as
 * one starting with a pronoun or ending on an article or an adjective (25 Oct, live: a fragment was said back).
 */
export function cleanKey(title: string | undefined): string | null {
  if (title == null) return null;
  const words = title.replace(/[^\p{L}\p{N}' -]/gu, '').trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0 || words.length > 5) return null;
  const first = words[0].toLowerCase().replace(/'/gu, '');
  const last = words[words.length - 1].toLowerCase().replace(/'/gu, '');
  if (NOT_A_START.has(first) || NOT_AN_END.has(last)) return null;
  const t = words.join(' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const ASK = ['What part of it weighs the most?', 'How does it feel, now that it is said?', 'What would make tonight a little lighter?', 'Is there one small thing you could leave until tomorrow?'];

/**
 * The on-device listener (no server, no key): reflects what it heard, asks one gentle question, and notes what
 * weighs with the same extraction as Unload. Calm and simple, never clever.
 */
export function deviceTalk(input: TalkInput, extractTitles: (text: string) => string[], turnIndex: number): TalkReply {
  if (crisisSignal(input.text)) return { reply: CRISIS_REPLY, weights: [], summary: cleanSummary(input.summary), crisis: true };
  if (input.closing === true) {
    return {
      reply: 'Thank you for talking it through with me. Let us let these stones go, one by one.',
      weights: [],
      summary: input.summary,
      crisis: false,
    };
  }
  // Only clean names become stones or are said back; otherwise a gentle line that needs no name.
  const titles = extractTitles(input.text)
    .map(cleanKey)
    .filter((t): t is string => t != null);
  const weights = mergeWeights(input.weights, titles);
  const key = weights[0] ?? titles[0] ?? null;
  const first = key != null ? REFLECT[turnIndex % REFLECT.length](key) : REFLECT_PLAIN[turnIndex % REFLECT_PLAIN.length];
  const reply = `${first} ${ASK[turnIndex % ASK.length]}`;
  // The summary keeps short neutral notes, never the raw sentence.
  const note = key != null ? `Spoke about ${key.charAt(0).toLowerCase()}${key.slice(1)}.` : '';
  const summary = cleanSummary(`${input.summary} ${note}`.trim()).slice(-TALK.summaryChars);
  return { reply: spokenCut(reply), weights, summary, crisis: false };
}

/** Minutes → what the lamp does now: talk, announce the end (once), or close gently. */
export function talkClock(minutes: number, announced: boolean): 'talk' | 'announce' | 'close' {
  if (minutes >= TALK.maxMinutes) return 'close';
  if (minutes >= TALK.windDownAt && !announced) return 'announce';
  return 'talk';
}

export const WIND_DOWN_LINE = 'We have about five more minutes together tonight. Take your time.';
export const TALK_OPENING = 'I am here. Tell me whatever is on your mind. I will listen.';

/**
 * Lower latency (25 Oct, owner's live measure: 3.8 s from your last word to the lamp's voice). The model streams its
 * JSON; as soon as the "reply" string holds a whole sentence, that sentence goes to the voice while the rest is still
 * being written. `partialReply` reads the reply string from JSON still being written (escapes decoded).
 */
export function partialReply(raw: string): { text: string; closed: boolean } | null {
  const m = /"reply"\s*:\s*"/u.exec(raw);
  if (m == null) return null;
  let i = m.index + m[0].length;
  let out = '';
  for (; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') return { text: out, closed: true };
    if (c === '\\') {
      if (i + 1 >= raw.length) break;
      const n = raw[++i];
      if (n === 'u') {
        if (i + 4 >= raw.length) break;
        out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16));
        i += 4;
      } else out += n === 'n' ? ' ' : n === 't' ? ' ' : n;
      continue;
    }
    out += c;
  }
  return { text: out, closed: false };
}

/**
 * The finished sentences of a reply so far (the last fragment is held back until it ends, unless `final`), never
 * past the spoken length limit. Markdown is removed as in `spokenCut`.
 */
export function spokenSentences(text: string, final: boolean): string[] {
  const t = text.replace(/\s+/gu, ' ').replace(/[*_#`]/gu, '').trimStart();
  const out: string[] = [];
  let used = 0;
  const re = /[^.!?…]+(?:[.!?…]+|$)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) != null) {
    const s = m[0].trim();
    if (s.length === 0) continue;
    const ended = /[.!?…]$/u.test(s) && (final || m.index + m[0].length < t.length);
    if (!ended && !final) break;
    if (used + s.length > TALK.replyChars) break;
    out.push(s);
    used += s.length + 1;
  }
  return out;
}
