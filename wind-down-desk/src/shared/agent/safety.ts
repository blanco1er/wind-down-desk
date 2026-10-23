/**
 * "Talk it through" safety (24 Oct; shared by the browser and the server, pure, unit-tested).
 * Wind-Down Desk is not therapy and gives no medical advice. If someone speaks of ending their life or hurting
 * themselves, the lamp never improvises: one gentle fixed answer, no advice, no model call, and help resources on
 * the desk. Every resource below was checked on its official site on 24 Oct 2026 (TECH.md §27):
 *   findahelpline.com (ThroughLine, free, 175+ countries) · 988lifeline.org (US: call or text 988, 24/7, free)
 *   3114.fr (France: national suicide prevention number, free, 24/7) · samaritans.org (UK & Ireland: 116 123, free)
 * No other number is ever shown; "your local emergency number" covers immediate danger anywhere.
 */
import { normalize } from '../../logic/text.ts';

// The person's own words (normalized: lower case, no apostrophes, no punctuation). Broad on purpose: a false alarm
// shows a calm card with helplines; a miss is not acceptable (25 Oct, owner's live test: "…if I just ended it").
const I = '(i|ill|i will|i would|id|i want to|i wanna|i should|i could|i might|im going to|im gonna|i am going to)';
const CRISIS = [
  /\b(kill|killing|hurt|hurting|harm|harming|cut|cutting|burn|burning|starve|starving) (myself|my self)\b/u,
  /\b(suicide|suicidal|self harm|selfharm|self harming|overdose|overdosing)\b/u,
  /\b(end|ending|ended|take|taking|took) (my|my own) li(fe|ves)\b/u,
  /\bend(ed|ing)? it all\b|\bend everything\b|\bend it for good\b/u,
  new RegExp(`\\b${I} (just )?(end|ended) it\\b`, 'u'),
  /\bif i (just |simply )?(ended|end|finished) it\b|\bif i (just )?(was|were|wasnt|werent) (gone|dead|not here|not around)\b/u,
  /\b(want|wanted|wish|going|ready|like) to die\b|\bwish i (was|were) dead\b|\bbetter off dead\b/u,
  /\b(everyone|everybody|they|people|my family|the world|you all) (would|will|d) be better off (without me|if i)\b/u,
  /\bbetter off without me\b|\bbetter off if i (was|were|wasnt|werent|died|disappeared|left for good)\b/u,
  /\b(dont|do not|not) (want|wanna) to (live|be alive|be here anymore|exist anymore|exist)$|\b(dont|do not|not) (want|wanna) to (live|be alive|be here anymore|exist anymore)\b/u,
  /\b(dont|do not|not) (want|wanna) to (wake up|keep going|go on)( again| anymore| ever| like this)?$/u,
  /\bnever wake up again\b|\bwish i (could|would) (just )?(not wake up|never wake up|disappear|stop existing)\b/u,
  /\bdisappear (forever|for good)\b|\bstop existing\b|\bno longer (be here|exist|be alive)\b/u,
  /\bno (reason|point) (to|in) (live|living|going on|being here)\b|\bcant go on (anymore|like this)\b/u,
  /\bjump (off|from) (a|the) (bridge|roof|building)\b/u,
];

// The model's words about the person (reply or rolling summary): the second net. Third person and second person.
const CRISIS_ABOUT = [
  /\b(suicid|self harm|selfharm|self harming|overdos)/u,
  /\b(end|ending|ended|take|taking|took) (their|his|her|your|my) (own )?li(fe|ves)\b/u,
  /\bthoughts? (of|about) (ending|dying|death|not living|not being here|hurting (themselves|yourself|himself|herself))\b/u,
  /\b(kill|killing|hurt|hurting|harm|harming) (themselves|yourself|himself|herself|themself)\b/u,
  /\b(wants?|wanting|wanted) to die\b|\bbetter off without (them|you|him|her)\b/u,
  /\b(crisis line|helpline|hotline|emergency services|emergency number|988|samaritans|let a person help you)\b/u,
];

/** True when the sentence speaks of suicide or self-harm (then: the fixed answer and the resources, nothing else). */
export function crisisSignal(text: string): boolean {
  const n = normalize(text);
  return CRISIS.some((re) => re.test(n));
}

/** The second net: the model's reply or summary speaks of a crisis (even if the person's words were missed). */
export function crisisInModelText(text: string): boolean {
  const n = normalize(text);
  return CRISIS.some((re) => re.test(n)) || CRISIS_ABOUT.some((re) => re.test(n));
}

/** A summary with every sentence touching a crisis removed: crisis content is never kept, never sent again. */
export function cleanSummary(summary: string): string {
  return summary
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) => !crisisInModelText(sentence))
    .join(' ')
    .trim();
}

export const CRISIS_REPLY = 'I am really glad you told me. You deserve support from a person right now. The helplines here are free, any time.';

export interface HelpResource {
  label: string;
  detail: string;
  url: string;
}

export const HELP_RESOURCES: readonly HelpResource[] = [
  { label: 'Immediate danger', detail: 'Call your local emergency number.', url: '' },
  { label: 'Find a helpline', detail: 'Free, confidential, 175+ countries', url: 'https://findahelpline.com' },
  { label: 'United States', detail: 'Call or text 988, 24/7', url: 'https://988lifeline.org' },
  { label: 'France', detail: '3114, free, 24/7', url: 'https://3114.fr' },
  { label: 'UK and Ireland', detail: 'Samaritans 116 123, free', url: 'https://www.samaritans.org' },
];

/** The same resources in three card rows (the desk card holds three). */
export const HELP_ROWS: ReadonlyArray<{ title: string; detail: string }> = [
  { title: 'In danger now', detail: 'Call your local emergency number.' },
  { title: 'Find a helpline', detail: 'findahelpline.com · free, confidential, 175+ countries' },
  { title: 'Free, 24/7', detail: 'US: call or text 988 · France: 3114 · UK & Ireland: 116 123' },
];

/** System prompt for the lamp in "Talk it through" (never therapy, never a diagnosis, never medical advice). */
export const TALK_SYSTEM = `You are the small lamp on a calm evening desk in a VR wind-down app. The person talks things through with you before sleep.
Your words are read aloud in a soft voice and shown as a caption, so: plain spoken English, 1 or 2 short sentences, at most 160 characters, no lists, no emojis, no markdown.
Listen first. Reflect back what you heard in their own words, gently. Ask at most one open, simple question. Offer small calming perspective, never pressure.
You are NOT a therapist or a doctor: never diagnose, never name conditions, never give medical, legal or medication advice, never claim to treat anything. If they ask for that, kindly suggest someone qualified they trust.
If they mention suicide, self-harm or being in danger, do not continue the conversation: say you are glad they told you and that a person should help now (the app shows helplines).
Also note what weighs on them: at most 2 NEW short titles (2 to 4 words, e.g. "The deadline", "Sam's message") of things they carry tonight, only if they said them.
Keep a rolling summary of the whole talk (at most 600 characters, third person, facts and feelings only) so the talk can continue without the full history.
When "closing" is true, wrap up warmly in 2 sentences and invite them to let the stones go, one by one.
Answer ONLY JSON: {"reply": string, "weights": string[], "summary": string}`;
