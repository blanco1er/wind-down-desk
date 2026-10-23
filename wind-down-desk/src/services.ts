/**
 * App-wide services shared by the 2D landing page and the XR systems.
 */
import { AgentClient } from './agent-client.ts';
import { ACCESS_KEY, parseAccess, type AccessPrefs } from './logic/access.ts';
import { RitualMemory, type KeyValueStore } from './logic/memory.ts';
import { readStyle, writeStyle, type EveningStyle } from './logic/style.ts';
import { VoiceInput } from './voice/mic.ts';

function safeStorage(): KeyValueStore | null {
  try {
    const probe = '__wdd_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export const services = {
  agent: new AgentClient(),
  voice: new VoiceInput(),
  memory: new RitualMemory(safeStorage()),
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
};
const styleListeners: Array<(style: EveningStyle) => void> = [];
const accessListeners: Array<(prefs: AccessPrefs) => void> = [];
