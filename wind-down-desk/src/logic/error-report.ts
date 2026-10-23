/**
 * Anonymous error reports (26 Oct): what breaks at the judges', counted in the visit log — the error's type and a
 * short, cleaned message, never anything the person said or wrote.
 *
 * Cleaning: anything quoted is replaced by "…" (a message may quote a value), long digit runs and URLs' query strings
 * are dropped, only plain characters are kept, 80 characters at most. Each distinct (type, message) is sent once per
 * page, 8 at most (tests/error-report.test.ts).
 */

export function cleanErrorMessage(message: unknown): string {
  let m = typeof message === 'string' ? message : message instanceof Error ? message.message : String(message ?? '');
  m = m
    .replace(/"[^"]*"|“[^”]*”|«[^»]*»|`[^`]*`|‘[^’]*’/gu, '…')
    .replace(/(^|[\s(=:,\[])'[^']*'/gu, '$1…')
    .replace(/https?:\/\/[^\s?#]+[?#][^\s]*/gu, (u) => u.replace(/[?#].*$/u, ''))
    .replace(/\d{4,}/gu, '#')
    .replace(/[^\w .,:;()\-/…#<>=]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return m.length > 80 ? `${m.slice(0, 79)}…` : m;
}

export function errorType(error: unknown): string {
  if (error instanceof Error) return (error.name || 'Error').slice(0, 32);
  if (typeof error === 'string') return 'string';
  return typeof error;
}

/** Which reports to send (distinct, at most `max` per page). */
export class ErrorReports {
  private readonly sent = new Set<string>();
  private readonly max: number;
  constructor(max = 8) {
    this.max = max;
  }

  accept(where: string, type: string, msg: string): boolean {
    const key = `${where}|${type}|${msg}`;
    if (this.sent.has(key) || this.sent.size >= this.max) return false;
    this.sent.add(key);
    return true;
  }
}
