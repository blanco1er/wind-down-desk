/**
 * Memory across evenings: the "reason to come back" (pure, unit-tested).
 *
 * - a streak of evenings (an evening runs 17:00 → 05:00; 01:00 counts for the night before),
 * - every worry you let go becomes a star in your own night sky above the desk,
 * - recurring worries are noticed gently ("third time you let this go"),
 * - tomorrow's kept plan comes back in the morning,
 * - "Later" items wait in a pool and resurface after a week.
 *
 * Storage is injected (localStorage in the browser, a Map in tests). Nothing
 * leaves the device.
 */
import type { PlanStep } from '../shared/agent/types.ts';
import type { RitualKind } from './evening.ts';
import { hash32, similarity } from './text.ts';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface NightRecord {
  /** Evening date, YYYY-MM-DD (local). */
  date: string;
  tomorrow: string[];
  later: string[];
  letGo: string[];
  plan: PlanStep[];
  planKept: boolean;
  /** Rituals completed that evening, in order (v6; absent in older records). */
  rituals?: RitualKind[];
  /** Slow breaths completed in Breathe (v6). */
  breaths?: number;
  /** What sank in the black bowl (Release, v6). Each one is also a star. */
  sunk?: string[];
}

export interface Star {
  text: string;
  date: string;
  /** Deterministic placement seed. */
  seed: number;
}

export interface MemoryData {
  version: 1;
  nights: NightRecord[];
  stars: Star[];
  laterPool: Array<{ text: string; since: string }>;
  morningSeen: string | null;
}

export const STORAGE_KEY = 'wind-down-desk.memory.v1';
const MAX_NIGHTS = 120;
const MAX_STARS = 400;
const EVENING_SHIFT_HOURS = 5;

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local evening date: before 05:00 belongs to the previous evening. */
export function eveningDate(now: Date): string {
  return localDate(new Date(now.getTime() - EVENING_SHIFT_HOURS * 3600_000));
}

function dayIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function isMorning(now: Date): boolean {
  const h = now.getHours();
  return h >= 5 && h < 12;
}

function emptyData(): MemoryData {
  return { version: 1, nights: [], stars: [], laterPool: [], morningSeen: null };
}

export class RitualMemory {
  private data: MemoryData;
  private readonly store: KeyValueStore | null;
  private readonly now: () => Date;

  constructor(store: KeyValueStore | null, now: () => Date = () => new Date()) {
    this.store = store;
    this.now = now;
    this.data = this.load();
  }

  private load(): MemoryData {
    try {
      const raw = this.store?.getItem(STORAGE_KEY);
      if (raw == null) {
        return emptyData();
      }
      const parsed = JSON.parse(raw) as Partial<MemoryData>;
      if (parsed.version !== 1 || !Array.isArray(parsed.nights)) {
        return emptyData();
      }
      return {
        version: 1,
        nights: parsed.nights,
        stars: Array.isArray(parsed.stars) ? parsed.stars : [],
        laterPool: Array.isArray(parsed.laterPool) ? parsed.laterPool : [],
        morningSeen: typeof parsed.morningSeen === 'string' ? parsed.morningSeen : null,
      };
    } catch {
      return emptyData();
    }
  }

  private save(): void {
    try {
      this.store?.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Private mode or quota: the ritual still works for this evening.
    }
  }

  snapshot(): MemoryData {
    return JSON.parse(JSON.stringify(this.data)) as MemoryData;
  }

  /** Saves (or updates) tonight. Called after each change so nothing is lost on exit. */
  recordNight(summary: { tomorrow: string[]; later: string[]; letGo: string[] }, plan: PlanStep[] = [], planKept = false): NightRecord {
    const date = eveningDate(this.now());
    let night = this.data.nights.find((n) => n.date === date);
    if (night == null) {
      night = { date, tomorrow: [], later: [], letGo: [], plan: [], planKept: false };
      this.data.nights.push(night);
    }
    const newlyReleased = summary.letGo.filter((t) => !night!.letGo.includes(t));
    for (const text of newlyReleased) {
      this.data.stars.push({ text, date, seed: hash32(`${date}|${text}|${this.data.stars.length}`) });
    }
    for (const text of summary.later) {
      if (!this.data.laterPool.some((l) => l.text === text)) {
        this.data.laterPool.push({ text, since: date });
      }
    }
    night.tomorrow = [...summary.tomorrow];
    night.later = [...summary.later];
    night.letGo = [...new Set([...night.letGo, ...summary.letGo])];
    if (plan.length > 0 || planKept) {
      night.plan = plan;
      night.planKept = planKept;
    }
    this.data.nights.sort((a, b) => (a.date < b.date ? -1 : 1));
    this.data.nights = this.data.nights.slice(-MAX_NIGHTS);
    this.data.stars = this.data.stars.slice(-MAX_STARS);
    this.save();
    return night;
  }

  private tonight(): NightRecord {
    const date = eveningDate(this.now());
    let night = this.data.nights.find((n) => n.date === date);
    if (night == null) {
      night = { date, tomorrow: [], later: [], letGo: [], plan: [], planKept: false };
      this.data.nights.push(night);
      this.data.nights.sort((a, b) => (a.date < b.date ? -1 : 1));
      this.data.nights = this.data.nights.slice(-MAX_NIGHTS);
    }
    return night;
  }

  /**
   * A ritual was completed tonight (v6). Breathe stores its breaths; Release stores what sank
   * and adds a star to the sky (letting go is letting go, whichever bowl it went into).
   */
  recordRitual(kind: RitualKind, extra: { breaths?: number; sunk?: string } = {}): NightRecord {
    const night = this.tonight();
    night.rituals = [...(night.rituals ?? []), kind];
    if (extra.breaths != null && extra.breaths > 0) {
      night.breaths = (night.breaths ?? 0) + extra.breaths;
    }
    if (extra.sunk != null && extra.sunk.trim().length > 0) {
      night.sunk = [...(night.sunk ?? []), extra.sunk.trim()];
      this.data.stars.push({ text: extra.sunk.trim(), date: night.date, seed: hash32(`${night.date}|sunk|${extra.sunk}|${this.data.stars.length}`) });
      this.data.stars = this.data.stars.slice(-MAX_STARS);
    }
    this.save();
    return night;
  }

  /** Rituals already completed tonight (unique, in first-done order). */
  doneTonight(): RitualKind[] {
    const night = this.data.nights.find((n) => n.date === eveningDate(this.now()));
    return [...new Set(night?.rituals ?? [])];
  }

  /** Evenings on which a ritual was completed (the menu shows it quietly). */
  ritualEvenings(kind: RitualKind): number {
    return this.data.nights.filter((n) => (n.rituals ?? []).includes(kind)).length;
  }

  /** Slow breaths taken in all (Breathe). */
  totalBreaths(): number {
    return this.data.nights.reduce((sum, n) => sum + (n.breaths ?? 0), 0);
  }

  /** Consecutive evenings ending tonight (or last night if tonight not done yet). */
  streak(): number {
    const today = dayIndex(eveningDate(this.now()));
    const days = new Set(this.data.nights.map((n) => dayIndex(n.date)));
    let cursor = days.has(today) ? today : today - 1;
    let count = 0;
    while (days.has(cursor)) {
      count++;
      cursor--;
    }
    return count;
  }

  totalLetGo(): number {
    return this.data.stars.length;
  }

  stars(): Star[] {
    return this.data.stars;
  }

  /** How many previous evenings already let go of something similar. */
  timesLetGoBefore(text: string): number {
    const today = eveningDate(this.now());
    return this.data.nights.filter((n) => n.date !== today && [...n.letGo, ...(n.sunk ?? [])].some((t) => similarity(t, text) >= 0.6)).length;
  }

  /** A worry that was let go on an earlier evening and is back tonight. */
  cameBack(text: string): { text: string; date: string } | null {
    const today = eveningDate(this.now());
    for (let i = this.data.nights.length - 1; i >= 0; i--) {
      const night = this.data.nights[i];
      if (night.date === today) {
        continue;
      }
      const match = [...night.letGo, ...(night.sunk ?? [])].find((t) => similarity(t, text) >= 0.6);
      if (match != null) {
        return { text: match, date: night.date };
      }
    }
    return null;
  }

  /** "Later" items waiting for 7+ days: offered back on the desk, never forced. */
  dueLater(maxCount = 2): string[] {
    const today = dayIndex(eveningDate(this.now()));
    return this.data.laterPool.filter((l) => today - dayIndex(l.since) >= 7).slice(0, maxCount).map((l) => l.text);
  }

  /** Removes items from the Later pool once they have been re-sorted. */
  resolveLater(texts: string[]): void {
    this.data.laterPool = this.data.laterPool.filter((l) => !texts.includes(l.text));
    this.save();
  }

  /** Last kept plan to show this morning, once. */
  morningPlan(): { date: string; tomorrow: string[]; plan: PlanStep[] } | null {
    const now = this.now();
    if (!isMorning(now)) {
      return null;
    }
    const lastEvening = localDate(new Date(now.getTime() - 12 * 3600_000)); // 05:00–12:00 → last evening
    const night = this.data.nights.find((n) => n.date === lastEvening);
    if (night == null || night.tomorrow.length === 0 || this.data.morningSeen === lastEvening) {
      return null;
    }
    return { date: night.date, tomorrow: night.tomorrow, plan: night.planKept ? night.plan : [] };
  }

  markMorningSeen(): void {
    this.data.morningSeen = localDate(new Date(this.now().getTime() - 12 * 3600_000));
    this.save();
  }

  /**
   * Demo / film only: replaces the memory with `evenings` past evenings in a
   * row (not tonight), each with one to three worries let go, so a recording
   * can show what weeks of use look like (the sky that grows, the streak).
   * Never called by the app itself.
   */
  seedHistory(evenings: number, sample: readonly string[] = DEMO_LET_GO): void {
    const data = emptyData();
    const today = dayIndex(eveningDate(this.now()));
    for (let k = evenings; k >= 1; k--) {
      const d = new Date(Date.UTC(1970, 0, 1) + (today - k) * 86_400_000);
      const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      const count = 1 + ((k * 7) % 3);
      const letGo = Array.from({ length: count }, (_, i) => sample[(k * 3 + i) % sample.length]);
      // Most evenings start with Unload; some add a minute of breathing or a stone in the water.
      const rituals: RitualKind[] = ['unload'];
      if (k % 2 === 0) rituals.push('breathe');
      if (k % 5 === 0) rituals.push('release');
      data.nights.push({ date, tomorrow: [], later: [], letGo, plan: [], planKept: true, rituals, breaths: rituals.includes('breathe') ? 6 : 0 });
      letGo.forEach((text, i) => data.stars.push({ text, date, seed: hash32(`${date}|${text}|${data.stars.length + i}`) }));
    }
    data.morningSeen = null;
    this.data = data;
    this.save();
  }

  /** Short welcome line for the arrival caption. */
  welcomeLine(): string {
    const nights = this.data.nights.length;
    if (nights === 0) {
      return 'First evening at your desk.';
    }
    const streak = this.streak();
    const stars = this.totalLetGo();
    const sky = stars === 0 ? '' : ` ${stars} ${stars === 1 ? 'star' : 'stars'} in your sky.`;
    if (streak >= 2) {
      return `Evening ${streak} in a row.${sky}`;
    }
    return `Welcome back.${sky}`;
  }
}

/** Worries used to seed a demo history (film only). */
export const DEMO_LET_GO = [
  'That email tone',
  'What they think of me',
  'The traffic this morning',
  'Being late to the call',
  'The slow reply',
  'Forgetting the umbrella',
  'The awkward silence',
  'Too much screen time',
  'The rejected idea',
  'Spilled coffee',
] as const;

/** Deterministic star position on a dome above and behind the desk (desk-local). */
export function starPosition(seed: number): { x: number; y: number; z: number; size: number } {
  const a = ((seed & 0xffff) / 0xffff) * Math.PI * 0.9 + Math.PI * 0.05; // azimuth across the back half
  const b = (((seed >>> 16) & 0xff) / 0xff) * 0.9 + 0.1; // elevation
  const r = 0.75 + (((seed >>> 24) & 0xff) / 0xff) * 0.35;
  return {
    x: Math.cos(a) * r * 0.95,
    y: 0.28 + b * 0.55,
    z: -Math.sin(a) * r * 0.75 - 0.15,
    size: 0.016 + ((seed >>> 8) & 0x7) * 0.0022,
  };
}
