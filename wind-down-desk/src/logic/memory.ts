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
  /** 23 Oct (agent memory): "Tomorrow" items the person said were done, and the evening they said it. */
  done?: Array<{ text: string; date: string }>;
  /** 26 Oct (lot 2b): milestones (3, 7, 21 evenings) already celebrated in the lamp — each one shown once. */
  celebrated?: number[];
}

/** What the lamp remembers when you come back (all on this device, never on a server). */
export interface Recall {
  /** "Last night you let go of 3 things." (null on a first evening or after a blank one). */
  sentence: string | null;
  /** Open "Tomorrow" items from earlier evenings, newest first, at most 3: they come back to be checked. */
  followUps: string[];
}

/** Base verbs that start most stone titles ("Call the dentist", "Reply to the landlord"). */
const ACTION_VERBS = new Set(
  'call reply email write send book pay buy fix finish prepare ask tell check clean cancel schedule order return pick sign submit read review plan meet talk text message visit renew update file print start go take get make do see find wash cook study practice apologize thank answer bring collect drop feed water mow repair sort tidy organize post move pack unpack wrap register apply contact phone ring follow confirm arrange move'.split(' '),
);

/** "Call the dentist" → "Did you call the dentist?"; anything else → "What about “…”?". */
export function followUpQuestion(text: string, first = true): string {
  const t = text.trim().replace(/[.!?]+$/u, '');
  const word = t.split(/\s+/u)[0]?.toLowerCase() ?? '';
  const q = ACTION_VERBS.has(word) ? `did you ${t.charAt(0).toLowerCase()}${t.slice(1)}?` : `what about “${t}”?`;
  return first ? `${q.charAt(0).toUpperCase()}${q.slice(1)}` : `And ${q}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
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
  return { version: 1, nights: [], stars: [], laterPool: [], morningSeen: null, done: [], celebrated: [] };
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
        done: Array.isArray(parsed.done) ? parsed.done.filter((d) => d != null && typeof d.text === 'string' && typeof d.date === 'string') : [],
        celebrated: Array.isArray(parsed.celebrated) ? parsed.celebrated.filter((m) => typeof m === 'number') : [],
      };
    } catch {
      return emptyData();
    }
  }

  private save(): void {
    this.version++;
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
  /** Bumped at every save: caches below know the data changed. */
  private version = 0;
  private doneCache = { at: -1e12, version: -1, value: [] as RitualKind[] };
  /** The cache below can be switched off for an A/B measure (perf-opts). */
  cacheOn = true;

  /**
   * Rituals done tonight. 26 Oct (CPU pass): read every frame (the evening's light, the touch words), it formatted
   * a date and searched the nights each time; now cached until the data changes, and at most 1 s (midnight).
   */
  doneTonight(): RitualKind[] {
    const t = Date.now();
    const c = this.doneCache;
    if (this.cacheOn && c.version === this.version && t - c.at < 1000) return c.value.slice();
    const night = this.data.nights.find((n) => n.date === eveningDate(this.now()));
    this.doneCache = { at: t, version: this.version, value: [...new Set(night?.rituals ?? [])] };
    return this.doneCache.value.slice();
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

  /** Evenings you came back for before tonight (tonight counts tomorrow): the constellation's progress. */
  evenings(): number {
    const tonight = eveningDate(this.now());
    return this.data.nights.filter((n) => n.date !== tonight).length;
  }

  /** Milestones already shown in the lamp (each one once). */
  celebrated(): number[] {
    return this.data.celebrated ?? [];
  }

  celebrate(milestone: number): void {
    const list = this.data.celebrated ?? [];
    if (!list.includes(milestone)) list.push(milestone);
    this.data.celebrated = list;
    this.save();
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

  /**
   * "Tomorrow" items from earlier evenings (≤ 14 days) that are still open: not said done, not sorted again on a
   * later evening (a later evening's record owns them then: Tomorrow again, Later, or let go). Newest first.
   */
  followUps(max = 3): string[] {
    const today = eveningDate(this.now());
    const todayIndex = dayIndex(today);
    const done = this.data.done ?? [];
    const out: string[] = [];
    const nights = this.data.nights.filter((n) => n.date !== today && todayIndex - dayIndex(n.date) <= 14);
    for (let i = nights.length - 1; i >= 0 && out.length < max; i--) {
      const night = nights[i];
      const later = nights.slice(i + 1);
      for (const text of night.tomorrow) {
        if (out.length >= max) break;
        if (out.some((t) => same(t, text))) continue;
        if (done.some((d) => same(d.text, text))) continue;
        if (later.some((n) => [...n.tomorrow, ...n.later, ...n.letGo, ...(n.sunk ?? [])].some((t) => same(t, text)))) continue;
        out.push(text);
      }
    }
    return out;
  }

  /** The person said a "Tomorrow" item is done (it dissolves into light on the desk). */
  markDone(text: string): void {
    // Saying something is done counts as an evening at the desk (the morning card can then cite it).
    const date = this.tonight().date;
    this.data.done = [...(this.data.done ?? []).filter((d) => !same(d.text, text)), { text: text.trim(), date }].slice(-400);
    this.save();
  }

  /** Items said done on a given evening (the morning card cites them). */
  doneOn(date: string): string[] {
    return (this.data.done ?? []).filter((d) => d.date === date).map((d) => d.text);
  }

  /**
   * The opening recall of a returning evening: one short, true sentence about the last evening, and the open
   * "Tomorrow" items to check ("Did you call the dentist?"). Nothing invented: only what was recorded here.
   */
  recall(): Recall {
    const today = eveningDate(this.now());
    const previous = this.data.nights.filter((n) => n.date !== today);
    const last = previous.at(-1);
    const followUps = this.followUps();
    if (last == null) return { sentence: null, followUps };
    const days = dayIndex(today) - dayIndex(last.date);
    const [y, m, d] = last.date.split('-').map(Number);
    const when = days <= 1 ? 'Last night' : days < 7 ? `On ${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}` : 'Last time';
    const letGo = last.letGo.length + (last.sunk?.length ?? 0);
    const count = (n: number) => (n === 1 ? 'one thing' : `${n} things`);
    let sentence: string | null = null;
    if (letGo > 0) sentence = `${when} you let go of ${count(letGo)}.`;
    else if (last.tomorrow.length > 0) sentence = `${when} you kept ${count(last.tomorrow.length)} for the next day.`;
    else if ((last.breaths ?? 0) > 0) sentence = `${when} you took ${last.breaths} slow breaths.`;
    return { sentence, followUps };
  }

  /** "Forget everything": every evening, star, plan and follow-up kept on this device is erased. */
  forget(): void {
    this.data = emptyData();
    try {
      (this.store as (KeyValueStore & { removeItem?: (key: string) => void }) | null)?.removeItem?.(STORAGE_KEY);
    } catch {
      // Nothing stored.
    }
    this.save();
  }

  /** Last kept plan to show this morning, once. `done`: what was said done last evening (the card cites it). */
  morningPlan(): { date: string; tomorrow: string[]; plan: PlanStep[]; done: string[] } | null {
    const now = this.now();
    if (!isMorning(now)) {
      return null;
    }
    const lastEvening = localDate(new Date(now.getTime() - 12 * 3600_000)); // 05:00–12:00 → last evening
    const night = this.data.nights.find((n) => n.date === lastEvening);
    const done = night == null ? [] : this.doneOn(night.date);
    if (night == null || (night.tomorrow.length === 0 && done.length === 0) || this.data.morningSeen === lastEvening) {
      return null;
    }
    return { date: night.date, tomorrow: night.tomorrow, plan: night.planKept ? night.plan : [], done };
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
    // Demo history: the milestones before the last one reached were celebrated on their evenings (the film shows
    // the last one arriving tonight).
    const reached = [3, 7, 21].filter((m) => evenings >= m);
    data.celebrated = reached.slice(0, -1);
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
    // 23 Oct (Best Reason to Come Back): progress is visible from the first seconds of a second evening.
    return `Evening ${nights + 1} at your desk.${sky}`;
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
