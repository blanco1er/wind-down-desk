/**
 * Text helpers shared by the voice parser, the agent and the memory.
 * Pure functions, no DOM, safe for `node --test` and the browser.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'and', 'or', 'in', 'on', 'at', 'for', 'with', 'about', 'my', 'me', 'i',
  'it', 'its', 'is', 'be', 'that', 'this', 'one', 'put', 'move', 'into', 'onto', 'please', 'just', 'so',
  'um', 'uh', 'like', 'okay', 'ok', 'some', 'thing', 'things', 'stuff', 'need', 'have', 'got', 'gotta',
  'should', 'must', 'still', 'really', 'again', 'also', 'then', 'there', 'their', 'from', 'up', 'out',
]);

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[’']/gu, '')
    .replace(/[^a-z0-9\s-]/gu, ' ')
    .replace(/-/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Very light stemming: enough to match "replies" with "reply", "booking" with "book". */
export function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) {
    return word.slice(0, -3);
  }
  if (word.length > 4 && word.endsWith('ies')) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.length > 4 && word.endsWith('ed')) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

/** Meaningful, stemmed words of a phrase. */
export function contentWords(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

/**
 * Similarity between two short phrases in [0, 1] (Dice coefficient on stemmed
 * content words, with prefix matches counted as half a hit for ASR slips).
 */
export function similarity(a: string, b: string): number {
  const wa = contentWords(a);
  const wb = contentWords(b);
  if (wa.length === 0 || wb.length === 0) {
    return 0;
  }
  let hits = 0;
  const used = new Set<number>();
  for (const word of wa) {
    let best = 0;
    let bestIndex = -1;
    wb.forEach((other, index) => {
      if (used.has(index)) {
        return;
      }
      const score =
        word === other ? 1 : word.length >= 4 && other.length >= 4 && (word.startsWith(other) || other.startsWith(word)) ? 0.5 : 0;
      if (score > best) {
        best = score;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) {
      used.add(bestIndex);
      hits += best;
    }
  }
  return (2 * hits) / (wa.length + wb.length);
}

/** Capitalizes the first letter only (keeps acronyms and names). */
export function capitalize(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

/** Shortens a phrase at a word boundary, adding an ellipsis when cut. */
export function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/gu, ' ').trim();
  if (clean.length <= max) {
    return clean;
  }
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/u, '')}…`;
}

/** Greedy word wrap into at most `maxLines` lines of `maxChars` characters. */
export function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/gu, ' ').trim().split(' ').filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';
  let i = 0;
  for (; i < words.length; i++) {
    const candidate = current.length === 0 ? words[i] : `${current} ${words[i]}`;
    if (candidate.length <= maxChars || current.length === 0) {
      current = candidate;
      continue;
    }
    if (lines.length === maxLines - 1) {
      break;
    }
    lines.push(current);
    current = words[i];
  }
  if (i < words.length) {
    current = shorten(`${current} ${words.slice(i).join(' ')}`, maxChars);
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines.map((line) => (line.length > maxChars ? shorten(line, maxChars) : line));
}

/** Stable 32-bit hash (FNV-1a), used for deterministic star placement. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
