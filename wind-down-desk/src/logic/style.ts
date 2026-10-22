/**
 * How the evening is played (owner, 18 Oct: "not everyone wants to talk to the assistant every time"):
 * - 'talk': the lamp listens and speaks; every step is still reachable by touch.
 * - 'quiet': no microphone is ever requested, the lamp does not speak, every question is a touch.
 * Chosen once on the landing page, remembered, changeable there (and in the desktop play-test panel).
 * Pure apart from the storage passed in (unit-tested).
 */
export type EveningStyle = 'talk' | 'quiet';

export const STYLE_KEY = 'wdd.style';

export interface StyleStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readStyle(store: StyleStore | null): EveningStyle | null {
  try {
    const v = store?.getItem(STYLE_KEY);
    return v === 'talk' || v === 'quiet' ? v : null;
  } catch {
    return null;
  }
}

export function writeStyle(store: StyleStore | null, style: EveningStyle): void {
  try {
    store?.setItem(STYLE_KEY, style);
  } catch {
    // Private mode: the choice lasts for this visit.
  }
}

/** The topics a quiet Unload offers as touchable words (each becomes an engraved stone). */
export const QUIET_TOPICS: readonly string[] = ['Work', 'Messages', 'Money', 'Health', 'Family', 'Home', 'Plans', 'Someone', 'A worry'];
export const WRITE_LABEL = 'Write…';
export const DONE_LABEL = "That's all";

/** The touch grid for Unload: topics (used ones stay, dimmed), then Write…, then That's all once a stone exists. */
export function unloadChoices(used: ReadonlySet<string>, stones: number): Array<{ label: string; dim: boolean; accent: boolean }> {
  const list = QUIET_TOPICS.map((label) => ({ label, dim: used.has(label), accent: false }));
  list.push({ label: WRITE_LABEL, dim: false, accent: false });
  if (stones > 0) list.push({ label: DONE_LABEL, dim: false, accent: true });
  return list;
}

/** The touch grid for Release: tonight's stones (Let go first, no duplicates, at most 9), then Write…. */
export function releaseChoices(letGo: readonly string[], others: readonly string[]): Array<{ label: string; dim: boolean; accent: boolean }> {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const t of [...[...letGo].reverse(), ...others]) {
    const k = t.trim();
    if (k.length === 0 || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    titles.push(k);
    if (titles.length === 9) break;
  }
  return [...titles.map((label) => ({ label, dim: false, accent: false })), { label: WRITE_LABEL, dim: false, accent: false }];
}
