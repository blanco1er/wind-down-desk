/**
 * What the lamp says aloud, pure and unit-tested.
 *
 * Every line is pre-rendered offline (tools/make-voice.mjs, Kokoro-82M, Apache-2.0,
 * run locally: no paid call, no network at runtime) into public/voice/<key>.mp3,
 * with a loudness envelope that makes the lamp glow with the words.
 * Only the main caption line is spoken; the smaller second line stays text.
 * Lines that are not in the catalogue (stone titles, the voice-help list) stay silent:
 * the lamp still pulses with the caption, as in v4.
 */
import { binLabel } from './voice-intents.ts';
import { PLACES, type PlaceId } from './places.ts';
import { BREATH_LINES } from './breathe.ts';
import { RELEASE_LINES } from './release.ts';
import { PROPOSAL_LINES } from './evening.ts';
import { CHECKOUT_LINES, TENSION_LINES } from './tension.ts';
import { SQUEEZE_LINES } from './squeeze.ts';
import { KEEP_LINES } from './keep.ts';
import { SLEEP_LINES } from './sleep.ts';
import { MIX_LINES } from './mix.ts';

/** Same word as ritual-system's ordinal (kept in sync by tests/lamp-voice.test.ts). */
export function ordinalWord(n: number): string {
  return ['', 'once', 'twice', 'three times', 'four times', 'five times'][n] ?? `${n} times`;
}

/** Normalized key of a spoken line: lower case, letters, digits and single spaces. */
export function lineKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

/** File name of a line (FNV-1a of its key, 8 hex digits). */
export function lineFile(text: string): string {
  let h = 0x811c9dc5;
  const key = lineKey(text);
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16).padStart(8, '0')}.mp3`;
}

/** Text given to the speech model (typography the model reads better). */
export function speakable(text: string): string {
  return text.replace(/…/gu, '.').replace(/[“”]/gu, '"').replace(/\s+/gu, ' ').trim();
}

export function lampLines(): string[] {
  const lines = new Set<string>([
    // Phase captions (logic/ritual.ts caption()) and phase lines.
    'Evening. Finding your table…',
    'What is on your mind? Just talk. Each thing becomes a stone.',
    'What is on your mind? Touch the little lamp and just talk.',
    'No microphone. Touch the little lamp for an example evening.',
    'Keep going. Say "that\'s it" when your head feels lighter.',
    'Pinch a stone and place it. Or say "dentist, tomorrow".',
    'Last one. Where does it belong?',
    'Pinch a stone and place it: Tomorrow, Later, or Let go.',
    'Here is a gentle start for tomorrow. Keep it?',
    'A gentle start for tomorrow. Keep it?',
    'Your desk is clear. Good night.',
    'Good morning. Here is what you kept for today.',
    'Good morning. Here is what you kept.',
    'Have a good day.',
    // Feedback.
    'Desk moved to your table.',
    'No table within reach: a floating desk.',
    'The desk is full. Sort a few first.',
    'This one came back. That is okay. Place it again.',
    'Let go.',
    'Nothing to undo.',
    'Back on the desk.',
    'Removed.',
    'Where would you like to be?',
    'Say where it goes: "Tomorrow", "Later" or "Let go".',
    'Following the suggestions. Say "undo" to change one.',
    'No suggestions to follow.',
    'Microphone off. Touch the lamp to talk again.',
    'Which one? Say a word from it, or look at it and say "this one".',
    'I could not tell which stone. Look at it and say "this one".',
    'I did not catch a worry in that. Try again?',
    'Listening.',
    'Microphone unavailable. Your hands still do everything.',
    'That place could not load. You are still in your room.',
    'Choose a place first: say "take me to the lake".',
    'Fully there.',
    'Your table stays with you.',
    'Voice on.',
    "From last week's Later: one thing back on the desk.",
  ]);
  // v6 rituals: the lamp's proposals, Breathe guidance, Release.
  for (const line of [...Object.values(PROPOSAL_LINES), ...BREATH_LINES, ...RELEASE_LINES, 'Four more breaths.']) lines.add(line);
  // 28 Oct (product pass): the bead, before and after.
  for (const line of [...Object.values(TENSION_LINES), ...Object.values(CHECKOUT_LINES), ...SQUEEZE_LINES, ...Object.values(KEEP_LINES), ...Object.values(SLEEP_LINES), ...Object.values(MIX_LINES)]) lines.add(line);
  for (const bin of ['tomorrow', 'later', 'let-go'] as const) {
    lines.add(`Back in ${binLabel(bin)}.`);
  }
  for (const bin of ['tomorrow', 'later'] as const) {
    lines.add(`${binLabel(bin)}.`);
    for (let n = 1; n <= 9; n++) lines.add(`${binLabel(bin)}. ${n} left.`);
  }
  for (let n = 2; n <= 5; n++) {
    lines.add(`Let go. You have released this ${ordinalWord(n)} now. It gets lighter.`);
    lines.add(`From last week's Later: ${n} things back on the desk.`);
  }
  for (const id of Object.keys(PLACES) as PlaceId[]) {
    const place = PLACES[id];
    lines.add(place.arrive);
    if (place.photo != null) lines.add(goingLine(place.name));
  }
  return [...lines];
}

/** "Going to the lake at dusk…" (the caption shown while a place loads). */
export function goingLine(name: string): string {
  return `Going to the ${name.toLowerCase().replace(/,.*$/u, '')}…`;
}

/** Manifest written by tools/make-voice.mjs: key → file, duration (s), loudness envelope (0..1 at ENVELOPE_HZ). */
export const ENVELOPE_HZ = 30;
export interface VoiceClip {
  file: string;
  seconds: number;
  envelope: number[];
}
export type VoiceManifest = Record<string, VoiceClip>;

/** Envelope value at time t (s), linear between samples, 0 outside. */
export function envelopeAt(clip: VoiceClip, t: number): number {
  if (t < 0 || t >= clip.seconds) return 0;
  const x = t * ENVELOPE_HZ;
  const i = Math.floor(x);
  const a = clip.envelope[i] ?? 0;
  const b = clip.envelope[i + 1] ?? 0;
  return a + (b - a) * (x - i);
}
