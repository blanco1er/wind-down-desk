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
  /^(?:(?:so(?!\s+(?:much|many)\b)|and|also|oh|um+|uh+|well|like|okay|ok|right|plus|then|but|anyway|and then|and also|oh and)[\s,]+)+/iu;
const INTENT_PREFIX =
  /^(?:i\s+(?:still\s+)?(?:really\s+)?(?:need|have|got|gotta|should|must|ought)\s+to\s+|i(?:'m| am)\s+(?:worried|anxious|stressed|nervous)\s+(?:about|that)\s+|i\s+keep\s+(?:thinking about|replaying|worrying about)\s+|i(?:'m| am)\s+(?:thinking|worrying)\s+about\s+|there(?:'s| is)\s+(?:also\s+)?|don't\s+forget\s+(?:to\s+)?|remember\s+to\s+|i\s+(?:still\s+)?(?:haven't|have\s+not|havent|didn't|did\s+not)\s+(?:yet\s+)?|i\s+forgot\s+to\s+|i\s+want\s+to\s+|i(?:'d| would)\s+like\s+to\s+|what\s+about\s+|my\s+)/iu;

const MODAL_PREFIX = /^(?:i\s+)?(?:should|need to|have to|must|gotta|ought to)\s+(?:really\s+|probably\s+|finally\s+)?/iu;

const TOMORROW_HINTS = /\b(tomorrow|morning|first thing|deadline|due|urgent|asap|repl(y|ied)|respond\w*|answer\w*|email|call|pay|bill|send|submit|book|appointment|dentist|doctor|before|by \d|monday|meeting|slides|deck|report|landlord|heating|repair|fix|noise|broken|leak\w*|pick up|buy|groceries|rent)\b/u;
const LATER_HINTS = /\b(someday|eventually|next (week|month|year)|at some point|maybe|plan|renew|passport|research|think about|learn|organi[sz]e|clean|declutter|holiday|trip|weekend)\b/u;
const LETGO_HINTS = /\b(awkward|embarrass\w*|what if|they think|replay\w*|said|comment|regret|can'?t control|cannot control|not in my control|cringe|rude|yell\w*|shout\w*|ignored|not good enough|afraid|scared|judg\w*|stupid|should have|shouldn'?t have|worried that|ex\b|compar\w*)\b/u;

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

// 10 Nov: two tasks said in one breath are two stones ("finish the report and book the flights").
const ACTION_VERBS =
  'book|buy|call|pay|send|pick up|finish|email|write|clean|get|make|schedule|cancel|renew|fix|order|reply|text|find|check|ask|tell|prepare|pack|return|submit|sign|print|file|plan';

/** Splits a brain dump into candidate worries. */
export function splitDump(text: string): string[] {
  const clean = text.replace(/\s+/gu, ' ').trim().slice(0, LIMITS.maxInputChars);
  const parts = clean
    .split(new RegExp(String.raw`(?<=[.!?;])\s+|\s*;\s*|,?\s+(?:and also|and then|also|plus|oh and|and i|and my|and the|and that|but also)\s+|,\s+(?:and\s+)?(?=i\s|my\s|the\s|there)|,?\s+and\s+(?=(?:${ACTION_VERBS})\b)|,\s+(?=(?:${ACTION_VERBS})\b)`, 'iu'))
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts;
}

/** Makes a phrase fit on a stone without losing its point. */
export function compactTitle(phrase: string, target = 24): string {
  // 10 Nov: spoken lead-ins say nothing on a stone ("I keep forgetting to call the dentist" → "Call the dentist";
  // it used to be cut to "Keep forgetting to call…", losing the one word that mattered).
  let t = phrase
    .replace(/^(and|so(?!\s+(?:much|many)\b)|oh|well|also|then|but)[,\s]+/iu, '')
    .replace(/^(?:(?:i|we)\s+)?(?:(?:still|really|also|just)\s+)?(?:have to|need to|must|should|ought to|have got to|gotta|want to)\s+/iu, '')
    .replace(/^(?:(?:i|we)\s+)?(?:keep|kept)\s+forgetting\s+(?:to\s+|about\s+)?/iu, '')
    // 10 Nov (seen on a stone): "I keep thinking about the presentation" read "Keep thinking".
    .replace(/^(?:(?:i|we)\s+)?(?:keep|kept|can'?t stop|cannot stop)\s+(?:thinking|worrying|stressing|obsessing)\s+(?:about|over)\s+/iu, '')
    .replace(/^(?:(?:i|we)\s+)?(?:forgot|haven'?t managed|still haven'?t)\s+to\s+/iu, '')
    .replace(/^(?:i'?m|i am|we'?re|we are|am)\s+(?:so\s+|really\s+|a bit\s+)?(?:worried|stressed|anxious|nervous|thinking)\s+about\s+/iu, '')
    .replace(/^(?:(?:i|we)\s+)?(?:have|got|have got|'ve got)\s+an?\s+/iu, '')
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
    // 10 Nov: "Reply to Sarah and now it feels too late" keeps the thing to do, not the commentary.
    const and = t.search(/\s+(?:and|but)\s+/iu);
    if (and > 0 && t.slice(0, and).split(' ').length >= 2) {
      t = t.slice(0, and);
    }
    t = t.replace(/\s+i\s+(?:have\s+not|haven'?t|still\s+haven'?t)\s+\w+$/iu, '');
  }
  if (t.length > target) {
    t = t.replace(/\s+(about|because|since|regarding|so that|which|who|before|after)\b.*$/iu, '');
  }
  if (t.length > target) {
    t = t.replace(/\s+(in|at|from|during) the\s+\w+.*$/iu, '');
  }
  if (t.length > LIMITS.titleChars) {
    t = t.replace(/\s+for\s+(?:my\s+)?\w+$/iu, '');
  }
  if (t.length > LIMITS.titleChars) {
    t = t.replace(/\s+the\s+/giu, ' ');
  }
  if (t.length > LIMITS.titleChars) {
    t = t.replace(/\s+(tomorrow|today|tonight|soon|again|this (week|month|year)|next (week|month|year))$/iu, '');
  }
  return shorten(t.trim(), LIMITS.titleChars);
}

/** Turns one fragment into a short stone title. */
export function titleFor(fragment: string): string {
  let t = fragment
    .trim()
    .replace(/[.!?]+$/u, '')
    // 10 Nov (fifteen everyday sentences read on stones): the worry itself, not the way it was said.
    .replace(/^i\s+(?:don'?t|do not)\s+know\s+(?:if|whether|how)\s+(?:i|we)\s+(?:can|will|could|should|am going to)\s+(?:afford to\s+)?/iu, '')
    .replace(/^i(?:'m| am)\s+(?:so\s+|really\s+)?(?:afraid|scared|terrified)\s+(?:that\s+)?(i|we)\s+(?:will|might|could|am going to|are going to|may)\s+/iu, 'What if $1 ')
    .replace(/^i\s+feel\s+(?:like|that)\s+(?:i(?:'m| am)|i)\s+/iu, '')
    .replace(/^i\s+(?:had|got into)\s+an?\s+(?=fight|argument|row|bad|terrible|awful|rough|hard|long)/iu, '')
    .replace(/^i(?:'m| am)\s+(?:so\s+|really\s+|just\s+)?(?=tired|exhausted|overwhelmed|behind|late|lonely|sad|lost)/iu, '')
    .replace(/^there(?:'s| is)\s+so\s+much\s+/iu, 'So much ')
    .replace(/^i\s+(?:can'?t|cannot|couldn'?t)\s+\w+\s+because\s+of\s+/iu, '')
    .replace(/^i\s+(?:think|guess|believe|suspect)\s+(?:that\s+)?/iu, '')
    .replace(/^i\s+said\s+(?=something|the wrong)/iu, '')
    .replace(/^i\s+(?=(?:spent|lost|broke|missed|wasted|skipped|snapped|yelled|shouted|lied|ate|drank)\b)/iu, '')
    .replace(/^i\s+feel\s+/iu, 'Feeling ');
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
    .replace(/^(?:called|phoned|rung)\b/iu, 'Call')
    .replace(/^(emailed|texted|visited|answered)\b/iu, (m) => m.slice(0, -2))
    .replace(/^seen\b/iu, 'See')
    .replace(/^(?:talked|spoken)\s+to\b/iu, 'Talk to')
    .replace(/^written\s+(to|back)\b/iu, 'Write $1')
    .replace(/^started\b/iu, 'Start')
    .replace(/\s+(?:in|for)\s+(?:weeks|months|ages|days|years|a while|so long|a long time)$/iu, '')
    .trim();
  return capitalize(compactTitle(t));
}

// 10 Nov: the tail of the sentence before ("…and I feel bad about it", "…and I have not started") is not a second worry.
const TAIL_CLAUSE = /\b(?:about|with|of|for|over)\s+(?:it|that|this|them)$|^(?:i\s+)?(?:have\s+not|haven'?t|did\s+not|didn'?t)\s+(?:even\s+)?(?:started|begun|done\s+(?:it|that|anything))(?:\s+yet)?$|^(?:i\s+)?(?:just\s+)?feel\s+(?:so\s+|really\s+)?(?:overwhelmed|bad|awful|terrible|stressed|anxious|guilty|stuck|lost)$/iu;

const NOT_WORRIES = /^(that'?s it|that'?s all|that is (?:it|all)|nothing else|i don'?t know|hmm+|okay|ok|so|yeah|anyway)\.?$/iu;

const EMPTY_TITLE = /^(that|this|it|them|those|these|everything|something|anything|stuff|things?|all of it|all that|so much|it all|that one|this one|again)$/iu;

export function extractDrafts(text: string, existing: string[] = []): WorryDraft[] {
  const drafts: WorryDraft[] = [];
  for (const fragment of splitDump(text)) {
    if (NOT_WORRIES.test(fragment.trim()) || (drafts.length > 0 && TAIL_CLAUSE.test(fragment.trim().replace(/[.!?]+$/u, ''))) || normalize(fragment).split(' ').length < 2) {
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
