/**
 * 28 Oct — the journal in the lamp (pure, unit-tested): what you let go, evening by evening, and one true sentence
 * about your week. Everything comes from what this device recorded (logic/memory.ts); nothing is invented or sent.
 *
 *   "This week you let go of 9 things. “Work” came back 3 times."
 *   Friday 24 Oct · 7 → 3 · 6 slow breaths
 *     That email tone          Let go
 *     The long call with Mum   Kept
 */
import type { NightRecord } from './memory.ts';
import type { RitualKind } from './evening.ts';
import { similarity } from './text.ts';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** "2026-10-24" → "Friday 24 Oct". */
export function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[day]} ${d} ${MONTHS[m - 1]}`;
}

/** "2026-10-24" → "24 Oct" (a star's caption). */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

const RITUAL_NAMES: Record<RitualKind, string> = { unload: 'Unload', breathe: 'Breathe', release: 'Release', talk: 'Talk', squeeze: 'Squeeze', keep: 'Keep' };

export interface JournalEntry {
  date: string;
  label: string;
  letGo: string[];
  kept: string[];
  tomorrow: string[];
  breaths: number;
  rituals: string[];
  tensionIn: number | null;
  tensionOut: number | null;
}

/** Evenings worth a page (something happened), newest first. */
export function journalEntries(nights: readonly NightRecord[]): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (let i = nights.length - 1; i >= 0; i--) {
    const n = nights[i];
    const letGo = [...n.letGo, ...(n.sunk ?? [])];
    const rituals = [...new Set(n.rituals ?? [])].map((r) => RITUAL_NAMES[r] ?? r);
    const empty = letGo.length === 0 && (n.kept ?? []).length === 0 && n.tomorrow.length === 0 && (n.breaths ?? 0) === 0 && rituals.length === 0 && n.tensionIn == null && n.tensionOut == null;
    if (empty) continue;
    out.push({ date: n.date, label: dateLabel(n.date), letGo, kept: [...(n.kept ?? [])], tomorrow: [...n.tomorrow], breaths: n.breaths ?? 0, rituals, tensionIn: n.tensionIn ?? null, tensionOut: n.tensionOut ?? null });
  }
  return out;
}

/** The small line under an evening's title: "7 → 3 · 6 slow breaths · Unload, Breathe". */
export function entrySubtitle(e: JournalEntry): string {
  const parts: string[] = [];
  if (e.tensionIn != null && e.tensionOut != null) parts.push(`${e.tensionIn} → ${e.tensionOut}`);
  else if (e.tensionIn != null) parts.push(`came in at ${e.tensionIn}`);
  if (e.breaths > 0) parts.push(`${e.breaths} slow ${e.breaths === 1 ? 'breath' : 'breaths'}`);
  if (e.rituals.length > 0) parts.push(e.rituals.join(', '));
  return parts.join(' · ');
}

/** The rows of an evening's page (at most `max`): what was let go first, then kept, then saved for the next day. */
export function entryRows(e: JournalEntry, max = 5): Array<{ title: string; detail: string }> {
  const rows = [...e.letGo.map((t) => ({ title: t, detail: 'Let go' })), ...e.kept.map((t) => ({ title: t, detail: 'Kept' })), ...e.tomorrow.map((t) => ({ title: t, detail: 'For the next day' }))];
  if (rows.length > max) return [...rows.slice(0, max - 1), { title: `And ${rows.length - max + 1} more`, detail: '' }];
  return rows;
}

/** The most repeated thing let go this week (similar wordings count together), if it came back at least twice. */
export function recurring(texts: readonly string[]): { text: string; count: number } | null {
  let best: { text: string; count: number } | null = null;
  for (let i = 0; i < texts.length; i++) {
    let count = 0;
    for (let j = 0; j < texts.length; j++) if (i === j || similarity(texts[i], texts[j]) >= 0.6) count++;
    if (count >= 2 && (best == null || count > best.count)) best = { text: texts[i], count };
  }
  return best;
}

/**
 * One true sentence about the last 7 evenings (tonight included). Counts only what was recorded; the change of the
 * bead only when at least two evenings have both ends.
 */
export function weekSummary(nights: readonly NightRecord[], today: string): string {
  const t = dayIndex(today);
  const week = nights.filter((n) => t - dayIndex(n.date) >= 0 && t - dayIndex(n.date) < 7);
  const letGo = week.flatMap((n) => [...n.letGo, ...(n.sunk ?? [])]);
  const kept = week.flatMap((n) => n.kept ?? []);
  if (letGo.length === 0 && kept.length === 0) {
    return nights.length > 0 ? 'A quiet week so far. Your sky keeps everything from before.' : 'Your sky starts tonight.';
  }
  const parts: string[] = [];
  if (letGo.length > 0) parts.push(`This week you let go of ${letGo.length === 1 ? 'one thing' : `${letGo.length} things`}.`);
  else parts.push(`This week you kept ${kept.length === 1 ? 'one good thing' : `${kept.length} good things`}.`);
  const again = recurring(letGo);
  if (again != null) parts.push(`“${again.text}” came back ${again.count === 2 ? 'twice' : `${again.count} times`}.`);
  const both = week.filter((n) => n.tensionIn != null && n.tensionOut != null);
  if (both.length >= 2) {
    const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
    parts.push(`You came in at ${avg(both.map((n) => n.tensionIn!))} on average and left at ${avg(both.map((n) => n.tensionOut!))}.`);
  } else if (letGo.length > 0 && kept.length > 0) {
    parts.push(`And kept ${kept.length === 1 ? 'one good thing' : `${kept.length} good things`}.`);
  }
  return parts.join(' ');
}

/** Journal navigation by voice ("earlier", "next", "this week", "close"). Null: not a journal command. */
export function parseJournalCommand(n: string): 'earlier' | 'later' | 'newest' | 'close' | null {
  if (/^(earlier|before|previous|back|go back|the day before|older|the evening before)$/u.test(n)) return 'earlier';
  if (/^(later|next|after|newer|the next one|forward)$/u.test(n)) return 'later';
  if (/^(this week|tonight|today|the newest|latest|most recent)$/u.test(n)) return 'newest';
  if (/^(close|close it|done|thats enough|enough|thank you|thanks|close the journal|back to my desk)$/u.test(n)) return 'close';
  return null;
}

/** "Show me my sky", "my journal", "what did I let go": the journal opens. */
export function isJournalCommand(n: string): boolean {
  return /^((show me |open )?(my |the )?(journal|diary|notebook|week)|what did i let go( of)?( this week)?|(show me )?my week|read my sky)$/u.test(n);
}
