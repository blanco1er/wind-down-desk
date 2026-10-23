/**
 * On-device, deterministic agent. Default provider when no LLM key is set,
 * offline fallback in the browser, and the reference for tests.
 * It is deliberately modest: clean splitting, short titles, honest heuristics.
 */
import { deviceTalk, spokenSentences, type TalkInput, type TalkReply } from './talk.ts';
import type { BinId } from '../../logic/desk-layout.ts';
import { capitalize, normalize, shorten, similarity } from '../../logic/text.ts';
import { LIMITS, type Agent, type PlanInput, type PlanStep, type TomorrowPlan, type WorryDraft } from './types.ts';
import { weightTitle } from './weight.ts';

const FILLER_PREFIX =
  /^(?:(?:so|and|also|oh|um+|uh+|well|like|okay|ok|right|plus|then|but|anyway|and then|and also|oh and)[\s,]+)+/iu;
const INTENT_PREFIX =
  /^(?:i\s+(?:still\s+)?(?:really\s+)?(?:need|have|got|gotta|should|must|ought)\s+to\s+|i(?:'m| am)\s+(?:worried|anxious|stressed|nervous)\s+(?:about|that)\s+|i\s+keep\s+(?:thinking about|replaying|worrying about)\s+|i(?:'m| am)\s+(?:thinking|worrying)\s+about\s+|there(?:'s| is)\s+(?:also\s+)?|don't\s+forget\s+(?:to\s+)?|remember\s+to\s+|i\s+(?:still\s+)?(?:haven't|have\s+not|havent|didn't|did\s+not)\s+(?:yet\s+)?|i\s+forgot\s+to\s+|i\s+want\s+to\s+|i(?:'d| would)\s+like\s+to\s+|what\s+about\s+|my\s+)/iu;

const MODAL_PREFIX = /^(?:i\s+)?(?:should|need to|have to|must|gotta|ought to)\s+(?:really\s+|probably\s+|finally\s+)?/iu;

const TOMORROW_HINTS = /\b(tomorrow|morning|first thing|deadline|due|urgent|asap|repl(y|ied)|respond\w*|answer\w*|email|call|pay|bill|send|submit|book|appointment|dentist|doctor|before|by \d|monday|meeting|slides|deck|report|landlord|heating|repair|fix)\b/u;
const LATER_HINTS = /\b(someday|eventually|next (week|month|year)|at some point|maybe|plan|renew|passport|research|think about|learn|organi[sz]e|clean|declutter|holiday|trip|weekend)\b/u;
const LETGO_HINTS = /\b(awkward|embarrass\w*|what if|they think|replay\w*|said|comment|regret|can'?t control|cannot control|not in my control|weird|cringe|judg\w*|stupid|should have|shouldn'?t have|worried that|ex\b|compar\w*)\b/u;

function suggest(text: string): { bin: BinId; why: string } {
  const n = normalize(text);
  if (LETGO_HINTS.test(n)) {
    return { bin: 'let-go', why: 'Sounds like something you cannot act on tonight.' };
  }
  if (TOMORROW_HINTS.test(n)) {
    return { bin: 'tomorrow', why: 'Has a small next step and a near deadline.' };
  }
  if (LATER_HINTS.test(n)) {
    return { bin: 'later', why: 'Matters, but not this week.' };
  }
  return { bin: 'later', why: 'No deadline mentioned.' };
}

/** Splits a brain dump into candidate worries. */
export function splitDump(text: string): string[] {
  const clean = text.replace(/\s+/gu, ' ').trim().slice(0, LIMITS.maxInputChars);
  const parts = clean
    .split(/(?<=[.!?;])\s+|\s*;\s*|,?\s+(?:and also|and then|also|plus|oh and|and i|and my|and the|and that|but also)\s+|,\s+(?:and\s+)?(?=i\s|my\s|the\s|there)/iu)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts;
}

/** Makes a phrase fit on a stone without losing its point. */
export function compactTitle(phrase: string, target = 24): string {
  let t = phrase
    .replace(/^(the|that|this|my|our|a|an)\s+/iu, '')
    .replace(/\s+(aren'?t|isn'?t|is not|are not) (done|finished|ready|sorted)( yet)?$/iu, '')
    .replace(/\s+(is|are) due\s+/iu, ' due ')
    .replace(/\s+(i|we|you|he|she|they)\s+(made|said|did|had|sent|wrote|got)\b.*$/iu, '')
    .trim();
  const comma = t.indexOf(',');
  if (comma > 0 && t.slice(0, comma).split(' ').length >= 2) {
    t = t.slice(0, comma);
  }
  if (t.length > target) {
    t = t.replace(/\s+(about|because|since|regarding|so that|which|who|before|after)\b.*$/iu, '');
  }
  if (t.length > target) {
    t = t.replace(/\s+(in|at|from|during) the\s+\w+.*$/iu, '');
  }
  if (t.length > target) {
    t = t.replace(/\s+the\s+/giu, ' ');
  }
  return shorten(t.trim(), LIMITS.titleChars);
}

/** Turns one fragment into a short stone title. */
export function titleFor(fragment: string): string {
  let t = fragment.trim().replace(/[.!?]+$/u, '');
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(FILLER_PREFIX, '').replace(INTENT_PREFIX, '').replace(MODAL_PREFIX, '').trim();
    if (t === before) {
      break;
    }
  }
  t = t
    .replace(/^(to|about|the fact that)\s+/iu, '')
    .replace(/\s+(i guess|you know|or something|and stuff|and everything)$/iu, '')
    .replace(/\b(replied|responded)\s+to\b/iu, 'Reply to')
    .replace(/\b(booked)\b/iu, 'Book')
    .trim();
  return capitalize(compactTitle(t));
}

const NOT_WORRIES = /^(that'?s it|that'?s all|that is (?:it|all)|nothing else|i don'?t know|hmm+|okay|ok|so|yeah|anyway)\.?$/iu;

const EMPTY_TITLE = /^(that|this|it|them|those|these|everything|something|anything|stuff|things?|all of it|all that|so much|it all|that one|this one|again)$/iu;

export function extractDrafts(text: string, existing: string[] = []): WorryDraft[] {
  const drafts: WorryDraft[] = [];
  for (const fragment of splitDump(text)) {
    if (NOT_WORRIES.test(fragment.trim()) || normalize(fragment).split(' ').length < 2) {
      continue;
    }
    const title = titleFor(fragment);
    // v8 (bug found filming): "I keep replaying that." became a stone reading "That". A fragment that is only a
    // pronoun or a filler word is not a worry: skip it (the words stay in the transcript line).
    if (title.replace(/…$/u, '').length < 3 || EMPTY_TITLE.test(title.replace(/…$/u, '').trim())) {
      continue;
    }
    const known = [...existing, ...drafts.map((d) => d.title)];
    if (known.some((k) => similarity(k, title) >= 0.75)) {
      continue;
    }
    const { bin, why } = suggest(fragment);
    drafts.push({ title, detail: shorten(fragment, 200), suggestion: bin, why });
    if (drafts.length >= LIMITS.maxTokensPerUtterance) {
      break;
    }
  }
  return drafts;
}

interface StepTemplate {
  match: RegExp;
  step: (title: string) => string;
  minutes: number;
}

const STEP_TEMPLATES: StepTemplate[] = [
  { match: /\b(reply|respond|answer|email|write back|message|text)\b/u, step: () => 'Draft three lines, send before lunch', minutes: 10 },
  { match: /\b(call|phone|ring)\b/u, step: () => 'One call, five minutes, script the first sentence', minutes: 5 },
  { match: /\b(dentist|doctor|appointment|book|reserve|schedule)\b/u, step: () => 'Book the first free slot online', minutes: 5 },
  { match: /\b(pay|bill|invoice|tax|rent)\b/u, step: () => 'Pay it in one go, then archive the email', minutes: 5 },
  { match: /\b(slides|deck|presentation|report|essay|proposal|write|draft)\b/u, step: () => 'Outline three headings, 25 minutes of focus', minutes: 25 },
  { match: /\b(landlord|heating|repair|fix|broken)\b/u, step: () => 'Send a two-line message with one photo', minutes: 10 },
  { match: /\b(buy|order|groceries|shop)\b/u, step: () => 'Add it to the list, order in one sitting', minutes: 10 },
  { match: /\b(passport|form|paperwork|admin|renew)\b/u, step: () => 'Find the form and fill in the first page', minutes: 15 },
];

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const rounded = Math.ceil(total / 15) * 15;
  const hh = Math.floor(rounded / 60) % 24;
  const mm = rounded % 60;
  return `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}`;
}

const URGENCY = /\b(today|tomorrow|morning|deadline|due|urgent|asap|before|monday|reply|pay|bill)\b/u;

export function planFor(input: PlanInput): TomorrowPlan {
  const max = input.lighter ? 2 : LIMITS.maxSteps;
  const ranked = [...input.tomorrow]
    .map((t, index) => ({ t, index, urgent: URGENCY.test(normalize(`${t.title} ${t.detail ?? ''}`)) ? 0 : 1 }))
    .sort((a, b) => a.urgent - b.urgent || a.index - b.index)
    .slice(0, max);
  let clock = input.startAt ?? '09:30';
  const steps: PlanStep[] = ranked.map(({ t }) => {
    const text = normalize(`${t.title} ${t.detail ?? ''}`);
    const template = STEP_TEMPLATES.find((s) => s.match.test(text));
    const minutes = input.lighter ? Math.min(template?.minutes ?? 10, 10) : template?.minutes ?? 15;
    const step = template != null ? template.step(t.title) : 'Give it the first ten minutes, nothing more';
    const when = clock;
    clock = addMinutes(clock, minutes + 15);
    return { title: shorten(t.title, LIMITS.titleChars), step: shorten(step, LIMITS.stepChars), when, minutes };
  });
  const rest = input.tomorrow.length - steps.length;
  const note =
    steps.length === 0
      ? 'Nothing for tomorrow. That is allowed.'
      : rest > 0
        ? `Start small. The other ${rest} can wait until these are done.`
        : input.letGoCount > 0
          ? 'Small steps. And what you let go tonight stays let go.'
          : 'Small steps. The rest of the day is yours.';
  return { steps, note: shorten(note, LIMITS.noteChars) };
}

export class SimulatedAgent implements Agent {
  readonly name = 'on-device (simulated)';

  async extract(text: string, existing: string[] = []): Promise<WorryDraft[]> {
    return extractDrafts(text, existing);
  }

  async plan(input: PlanInput): Promise<TomorrowPlan> {
    return planFor(input);
  }

  async summarize(text: string): Promise<string> {
    return weightTitle(text);
  }

  private talkTurns = 0;

  async talk(input: TalkInput): Promise<TalkReply> {
    return deviceTalk(input, (text) => extractDrafts(text, input.weights).map((d) => d.title), this.talkTurns++);
  }

  async talkStream(input: TalkInput, onSentence: (sentence: string) => void): Promise<TalkReply> {
    const r = await this.talk(input);
    if (!r.crisis) for (const s of spokenSentences(r.reply, true)) onSentence(s);
    return r;
  }
}
