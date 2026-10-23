/**
 * Safe mode and the crash memory (26 Oct, "safety nets without a headset").
 *
 * - `?safe=1`: safe mode now and for the next visits; `?safe=0`: back to normal (and the crash memory erased).
 * - Automatic: a session that started and never reached 20 s of calm running (the page died: a crash, a lost GPU
 *   context, a reload in panic) counts as one bad start; after two bad starts within a week, safe mode is remembered.
 * - Safe mode keeps every function of the evening: places at 6k, no aura, no light dust, no living layers.
 * Pure logic on a key-value store (tests/safe-mode.test.ts).
 */

export const BOOT_KEY = 'wdd.boot';
export const SAFE_KEY = 'wdd.safe';
const WEEK_MS = 7 * 24 * 3600 * 1000;

export interface BootStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

interface BootRecord {
  /** A session started and has not yet run 20 s calmly. */
  pending: boolean;
  /** Times (ms) of the bad starts counted. */
  bad: number[];
}

function read(store: BootStore | null): BootRecord {
  try {
    const raw = store?.getItem(BOOT_KEY);
    const r = raw == null ? null : (JSON.parse(raw) as Partial<BootRecord>);
    return { pending: r?.pending === true, bad: Array.isArray(r?.bad) ? r.bad.filter((x) => typeof x === 'number') : [] };
  } catch {
    return { pending: false, bad: [] };
  }
}

function write(store: BootStore | null, r: BootRecord): void {
  try {
    store?.setItem(BOOT_KEY, JSON.stringify(r));
  } catch {
    // Private mode: no memory of crashes, never in the way.
  }
}

export interface SafeDecision {
  safe: boolean;
  why: 'param' | 'remembered' | 'crashes' | 'none';
  badStarts: number;
}

/** At page load: reads `?safe=`, counts a bad start if the last session never settled, decides. */
export function decideSafeMode(search: string, store: BootStore | null, now: number): SafeDecision {
  const param = new URLSearchParams(search).get('safe');
  const r = read(store);
  if (param === '0') {
    try {
      store?.removeItem?.(SAFE_KEY);
    } catch {
      // ignore
    }
    write(store, { pending: false, bad: [] });
    return { safe: false, why: 'none', badStarts: 0 };
  }
  if (r.pending) {
    r.bad.push(now);
    r.pending = false;
  }
  r.bad = r.bad.filter((t) => now - t < WEEK_MS);
  write(store, r);
  let remembered = false;
  try {
    remembered = store?.getItem(SAFE_KEY) === '1';
  } catch {
    remembered = false;
  }
  if (param === '1') {
    try {
      store?.setItem(SAFE_KEY, '1');
    } catch {
      // ignore
    }
    return { safe: true, why: 'param', badStarts: r.bad.length };
  }
  if (remembered) return { safe: true, why: 'remembered', badStarts: r.bad.length };
  if (r.bad.length >= 2) {
    try {
      store?.setItem(SAFE_KEY, '1');
    } catch {
      // ignore
    }
    return { safe: true, why: 'crashes', badStarts: r.bad.length };
  }
  return { safe: false, why: 'none', badStarts: r.bad.length };
}

/** The XR session started: until it has run 20 s calmly, a page death counts as a bad start. */
export function markSessionStart(store: BootStore | null): void {
  const r = read(store);
  r.pending = true;
  write(store, r);
}

/** 20 s of calm running: this start was good. */
export function markSettled(store: BootStore | null): void {
  const r = read(store);
  r.pending = false;
  write(store, r);
}

/** A lost GPU context counts as a bad start at once (the page may not survive it). */
export function markBadStart(store: BootStore | null, now: number): number {
  const r = read(store);
  r.bad.push(now);
  r.pending = false;
  write(store, r);
  return r.bad.length;
}
