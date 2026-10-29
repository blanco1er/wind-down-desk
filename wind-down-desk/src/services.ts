/**
 * App-wide services shared by the 2D landing page and the XR systems.
 */
import { AgentClient } from './agent-client.ts';
import { ACCESS_KEY, parseAccess, type AccessPrefs } from './logic/access.ts';
import { RitualMemory, type KeyValueStore } from './logic/memory.ts';
import { readStyle, writeStyle, type EveningStyle } from './logic/style.ts';
import { applyMix, MIX_KEY, mixLevels, parseMix, type MixPrefs } from './logic/mix.ts';
import { VoiceInput } from './voice/mic.ts';

let probed: { store: KeyValueStore | null } | null = null;
/**
 * The page's storage if it works (private mode: null). Probed ONCE (26 Oct, CPU pass: `style.quiet` is read every
 * frame, and the probe wrote to localStorage each time — a synchronous write per frame on the headset).
 */
function safeStorage(): KeyValueStore | null {
  if (probed != null) return probed.store;
  try {
    const probe = '__wdd_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    probed = { store: window.localStorage };
  } catch {
    probed = { store: null };
  }
  return probed.store;
}

/**
 * Play-test clock (26 Oct, stability pass): film.day(n) puts the memory's clock at 21:30, n days from today, so
 * several evenings chain in one emulator session whatever the real hour. Off (the real time) for everyone else;
 * only the memory's date uses it.
 */
export const testClock = { on: false, base: 0, setAt: 0 };
function memoryNow(): Date {
  return testClock.on ? new Date(testClock.base + (Date.now() - testClock.setAt)) : new Date();
}

export const services = {
  agent: new AgentClient(),
  voice: new VoiceInput(),
  memory: new RitualMemory(safeStorage(), memoryNow),
  /** Talk with the lamp, or a quiet evening (touch only, no microphone). Null until chosen once. */
  style: {
    get(): EveningStyle | null {
      return readStyle(safeStorage());
    },
    set(style: EveningStyle): void {
      writeStyle(safeStorage(), style);
      for (const listener of styleListeners) listener(style);
    },
    get quiet(): boolean {
      return readStyle(safeStorage()) === 'quiet';
    },
    onChange(listener: (style: EveningStyle) => void): void {
      styleListeners.push(listener);
    },
  },
  /** 23 Oct — accessibility settings (logic/access.ts), shared by the landing's button and the voice in XR. */
  access: {
    get(): AccessPrefs {
      return parseAccess(safeStorage()?.getItem(ACCESS_KEY) ?? null);
    },
    set(change: Partial<AccessPrefs>): AccessPrefs {
      const next = { ...services.access.get(), ...change };
      try {
        safeStorage()?.setItem(ACCESS_KEY, JSON.stringify(next));
      } catch {
        // Private window: the setting lasts for this visit only.
      }
      for (const listener of accessListeners) listener(next);
      return next;
    },
    onChange(listener: (prefs: AccessPrefs) => void): void {
      accessListeners.push(listener);
    },
  },
  /**
   * 28 Oct — the voice and the sound, apart (logic/mix.ts): saved in this browser, read live by every sound source
   * through `mixLevels`.
   */
  mix: {
    get(): MixPrefs {
      return parseMix(safeStorage()?.getItem(MIX_KEY) ?? null);
    },
    set(change: Partial<MixPrefs>): MixPrefs {
      const next = applyMix(services.mix.get(), change);
      try {
        safeStorage()?.setItem(MIX_KEY, JSON.stringify(next));
      } catch {
        // Private window: the mix lasts for this visit only.
      }
      Object.assign(mixLevels, next);
      for (const listener of mixListeners) listener(next);
      return next;
    },
    onChange(listener: (prefs: MixPrefs) => void): void {
      mixListeners.push(listener);
    },
  },
};
const mixListeners: Array<(prefs: MixPrefs) => void> = [];
try {
  Object.assign(mixLevels, services.mix.get());
} catch {
  // No storage: the default mix.
}
const styleListeners: Array<(style: EveningStyle) => void> = [];
const accessListeners: Array<(prefs: AccessPrefs) => void> = [];
