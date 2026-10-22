// v8 — Cost of one representative voice session, estimated WITHOUT any paid call.
// Runs the app's real prompts (src/shared/agent/prompts.ts) through a local tokenizer (gpt-tokenizer, o200k_base:
// an estimate for other vendors' tokenizers, ±15 %), counts the audio seconds sent to STT and the characters a
// dynamic TTS would read, then prices them with the rates read on the official pages on 18 Oct 2026 (TECH.md §17).
//   TOKENIZER_DIR=<folder with node_modules/gpt-tokenizer> node tools/v8/session-cost.mjs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { EXTRACT_SYSTEM, extractUser, PLAN_SYSTEM, planUser, SUMMARIZE_SYSTEM } from '../../src/shared/agent/prompts.ts';

const require = createRequire(join(process.env.TOKENIZER_DIR ?? '.', 'package.json'));
const { encode } = await import(require.resolve('gpt-tokenizer/encoding/o200k_base'));
const tok = (s) => encode(s).length;
// Chat-format overhead per message (role tags, separators): ≈ 4 tokens, + 3 for the reply priming.
const chat = (msgs) => msgs.reduce((n, m) => n + 4 + tok(m.content), 3);

// The session: Unload (5 thoughts in two utterances) → plan → Release → Breathe → good night.
const u1 = "I still haven't replied to the landlord about the heating. And I need to book the dentist, it's been a year.";
const u2 = "The slides for Monday aren't done. I keep replaying that awkward comment I made in the meeting. Oh, and my passport expires in March.";
const heavy = 'The meeting with Paul tomorrow. I keep replaying it.';
const out1 = '{"tokens":[{"title":"Reply to the landlord","detail":"haven\'t replied about the heating","suggestion":"tomorrow","why":"A short reply is a small step"},{"title":"Book the dentist","detail":"it\'s been a year","suggestion":"tomorrow","why":"Booking takes five minutes"}]}';
const out2 = '{"tokens":[{"title":"Slides for Monday","detail":"the slides aren\'t done","suggestion":"tomorrow","why":"Start with an outline"},{"title":"Awkward comment","detail":"keep replaying it","suggestion":"let-go","why":"The past cannot be acted on"},{"title":"Passport expires in March","detail":"passport expires in March","suggestion":"later","why":"Matters, not this week"}]}';
const outPlan = '{"steps":[{"title":"Reply to the landlord","step":"Draft three lines, send before lunch","when":"09:30","minutes":10},{"title":"Slides for Monday","step":"Outline three headings","when":"10:00","minutes":25},{"title":"Book the dentist","step":"Book the first free slot online","when":"10:45","minutes":5}],"note":"Small steps. And what you let go tonight stays let go."}';
const outSum = '{"title":"The meeting with Paul"}';
const calls = [
  { what: 'extract #1', input: chat([{ content: EXTRACT_SYSTEM }, { content: extractUser(u1, []) }]), output: tok(out1), cachedPrefix: tok(EXTRACT_SYSTEM) },
  { what: 'extract #2', input: chat([{ content: EXTRACT_SYSTEM }, { content: extractUser(u2, ['Reply to the landlord', 'Book the dentist']) }]), output: tok(out2), cachedPrefix: tok(EXTRACT_SYSTEM) },
  {
    what: 'plan',
    input: chat([{ content: PLAN_SYSTEM }, { content: planUser({ tomorrow: [{ title: 'Reply to the landlord', detail: "haven't replied about the heating" }, { title: 'Slides for Monday' }, { title: 'Book the dentist' }], later: [{ title: 'Passport expires in March' }], startAt: '09:30', lighter: false }) }]),
    output: tok(outPlan),
    cachedPrefix: tok(PLAN_SYSTEM),
  },
  { what: 'summarize (Release)', input: chat([{ content: SUMMARIZE_SYSTEM }, { content: `What weighs on them:\n"""${heavy}"""` }]), output: tok(outSum), cachedPrefix: tok(SUMMARIZE_SYSTEM) },
];
const tokensIn = calls.reduce((n, c) => n + c.input, 0);
const tokensOut = calls.reduce((n, c) => n + c.output, 0);
const cacheable = calls.reduce((n, c) => n + c.cachedPrefix, 0);

// Speech sent to STT: one clip per utterance (VAD), 2.6 words/s calm speech + 0.5 s of padding per clip.
const utterances = [u1, u2, "That's it.", 'Dentist, tomorrow.', 'Slides, tomorrow.', 'Keep it.', 'Yes.', heavy, 'Let it go.', 'Yes.', "That's enough.", 'Good night.'];
const secs = utterances.map((u) => u.split(/\s+/u).length / 2.6 + 0.5);
const audioSeconds = secs.reduce((a, b) => a + b, 0);
const billedMin10s = secs.reduce((a, s) => a + Math.max(10, s), 0); // Groq bills ≥ 10 s per request

// Dynamic TTS (today silent; the fixed catalogue is pre-rendered once with Kokoro): stone titles, plan, the Release stone.
const dynamicLines = ['Reply to the landlord', 'Book the dentist', 'Slides for Monday', 'Awkward comment', 'Passport expires in March',
  'Tomorrow. Three small starts, 40 minutes in all.', '09:30, Reply to the landlord: draft three lines, send before lunch.',
  '10:00, Slides for Monday: outline three headings.', '10:45, Book the dentist: book the first free slot online.',
  'Small steps. And what you let go tonight stays let go.', 'The meeting with Paul'];
const ttsChars = dynamicLines.reduce((n, l) => n + l.length, 0);

const $ = (x) => Math.round(x * 1e5) / 1e5;
const llm = {
  'deepseek-flash, peak (miss)': (tokensIn * 0.3 + tokensOut * 1.2) / 1e6,
  'deepseek-flash, off-peak, system prompts cached': ((tokensIn - cacheable) * 0.15 + cacheable * 0.003 + tokensOut * 0.6) / 1e6,
  'gpt-5-nano': (tokensIn * 0.05 + tokensOut * 0.4) / 1e6,
  'gpt-4o-mini': (tokensIn * 0.15 + tokensOut * 0.6) / 1e6,
};
const stt = {
  'Groq whisper-large-v3-turbo ($0.04/h, ≥10 s per request)': (billedMin10s / 3600) * 0.04,
  'OpenAI gpt-4o-mini-transcribe ($0.003/min)': (audioSeconds / 60) * 0.003,
  'OpenAI whisper-1 ($0.006/min)': (audioSeconds / 60) * 0.006,
  'Deepgram Nova-3 PAYG ($0.0043/min)': (audioSeconds / 60) * 0.0043,
};
const tts = {
  'Kokoro-82M on the device / pre-rendered (Apache-2.0)': 0,
  'OpenAI tts-1 ($15 / 1M chars)': (ttsChars * 15) / 1e6,
  'Deepgram Aura-2 ($0.030 / 1k chars)': (ttsChars * 0.03) / 1e3,
  'ElevenLabs Flash/Turbo ($0.04 / 1k chars)': (ttsChars * 0.04) / 1e3,
};
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, $(v)]));
console.log(JSON.stringify({
  tokenizer: 'o200k_base (estimate)',
  calls: calls.map((c) => ({ what: c.what, input: c.input, output: c.output })),
  tokensIn, tokensOut, cacheablePrefixTokens: cacheable,
  stt: { utterances: utterances.length, audioSeconds: +audioSeconds.toFixed(1), billedSecondsGroq: +billedMin10s.toFixed(1) },
  ttsDynamicChars: ttsChars,
  usdPerSession: { llm: round(llm), stt: round(stt), tts: round(tts) },
}, null, 2));
