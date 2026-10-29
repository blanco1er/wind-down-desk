/**
 * 28 Oct — the voice and the sound, apart (pure, unit-tested). The most common complaint about guided relaxation
 * apps is a voice too loud for its ambience: the lamp's voice is now a little softer by default, and the person sets
 * the voice and the rest of the sound (ambience, places, cues) separately — by voice ("voice softer", "sound louder"),
 * on two rails in the headset (hold the Sound button), or on the 2D page before entering. "Sound off" still silences
 * everything (master volume): this mix sits under it.
 */
import { normalize } from './text.ts';

export interface MixPrefs {
  /** The lamp's voice (pre-rendered lines and the live voice), 0..1. */
  voice: number;
  /** Everything else: ambience, living places, rain, cues, 0..1. */
  sound: number;
}

export const MIX_KEY = 'wdd.mix';
/** Softer voice by default (≈ −3 dB against the earlier mix), full ambience. */
export const DEFAULT_MIX: MixPrefs = { voice: 0.7, sound: 1 };
export const MIX_STEP = 0.2;

function clamp(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
}

export function parseMix(raw: string | null): MixPrefs {
  if (raw == null) return { ...DEFAULT_MIX };
  try {
    const p = JSON.parse(raw) as Partial<MixPrefs>;
    return { voice: typeof p.voice === 'number' && Number.isFinite(p.voice) ? clamp(p.voice) : DEFAULT_MIX.voice, sound: typeof p.sound === 'number' && Number.isFinite(p.sound) ? clamp(p.sound) : DEFAULT_MIX.sound };
  } catch {
    return { ...DEFAULT_MIX };
  }
}

export function applyMix(prefs: MixPrefs, change: Partial<MixPrefs>): MixPrefs {
  return { voice: clamp(change.voice ?? prefs.voice), sound: clamp(change.sound ?? prefs.sound) };
}

export type MixCommand = { type: 'open' } | { type: 'step'; channel: keyof MixPrefs; delta: number };

/**
 * "voice softer", "softer voice", "quieter voice", "the music louder", "sound settings", "volume". Whole sentences only
 * ("my voice is softer today" is not a command).
 */
export function parseMixCommand(text: string): MixCommand | null {
  const n = normalize(text).replace(/\b(please|a bit|a little|the|lamp)\b/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (/^(volume|mix|sound settings|volume settings|sound mix|adjust (sound|volume)|voice and sound)$/u.test(n)) return { type: 'open' };
  const soft = '(softer|quieter|lower|down|less loud)';
  const loud = '(louder|higher|up|more)';
  const voice = '(voice|your voice|lamps voice|talking)';
  const sound = '(sound|sounds|ambience|ambient|background|music|nature|rain)';
  const m = (re: string) => new RegExp(`^${re}$`, 'u').test(n);
  if (m(`${voice} ${soft}`) || m(`${soft} ${voice}`) || m(`(speak|talk) ${soft}`) || m('(speak|talk) more (softly|quietly)')) return { type: 'step', channel: 'voice', delta: -MIX_STEP };
  if (m(`${voice} ${loud}`) || m(`${loud} ${voice}`) || m(`(speak|talk) ${loud}`)) return { type: 'step', channel: 'voice', delta: MIX_STEP };
  if (m(`${sound} ${soft}`) || m(`${soft} ${sound}`)) return { type: 'step', channel: 'sound', delta: -MIX_STEP };
  if (m(`${sound} ${loud}`) || m(`${loud} ${sound}`)) return { type: 'step', channel: 'sound', delta: MIX_STEP };
  return null;
}

export const MIX_LINES = {
  open: 'Slide the voice, or the sound.',
  sample: 'Like this?',
} as const;

/** Live levels read by every sound source (set from the saved preferences at start, changed by the mix). */
export const mixLevels: MixPrefs = { ...DEFAULT_MIX };
