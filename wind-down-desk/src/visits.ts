/**
 * Anonymous steps of a visit (owner rule: know whether the judges tried the demo and how far they went).
 * Production build only, same origin only (/api/visit, navigator.sendBeacon): no cookie, no third party.
 * Never sent: words, voice, worries, anything typed. Only an event name from a fixed list and short values
 * (how the desk was placed, which place, which ritual). The server (server/visits.ts) drops anything else.
 * Your own devices: open the page once with ?internal=1 (kept in this browser) → flagged internal in the report.
 */
const API = ((import.meta.env.VITE_WDD_API as string | undefined) ?? '/api').replace(/\/+$/u, '');
const ON = import.meta.env.PROD && !API.startsWith('http');
const once = new Set<string>();
const startedAt = Date.now();
let lastStep = 'page';
let internal = false;

try {
  const params = new URLSearchParams(location.search);
  if (params.get('internal') === '1') localStorage.setItem('wdd.internal', '1');
  internal = localStorage.getItem('wdd.internal') === '1';
} catch {
  // Storage blocked: counted as a normal visit.
}

/** Sends one step. `key` limits it to once per page load (e.g. "ritual-start:breathe"). */
export function track(e: string, d: Record<string, string | number> = {}, key?: string): void {
  if (!ON) return;
  const k = key ?? null;
  if (k != null) {
    if (once.has(k)) return;
    once.add(k);
  }
  if (e !== 'leave') lastStep = e;
  try {
    const body = JSON.stringify({ e, d, internal });
    const blob = new Blob([body], { type: 'text/plain' });
    if (navigator.sendBeacon?.(`${API}/visit`, blob) !== true) {
      void fetch(`${API}/visit`, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {});
    }
  } catch {
    // Never in the way of the evening.
  }
}

/** Seconds since the page opened. */
export function secs(): number {
  return Math.round((Date.now() - startedAt) / 1000);
}

/** The landing view: referrer SITE and ?ref / utm_source only (the server keeps the host name of the referrer). */
export function trackPage(): void {
  let src = '';
  try {
    const params = new URLSearchParams(location.search);
    src = params.get('ref') ?? params.get('utm_source') ?? '';
  } catch {
    src = '';
  }
  track('page', { ref: document.referrer, src, lang: navigator.language?.slice(0, 5) ?? '' }, 'page');
  addEventListener('pagehide', () => track('leave', { secs: secs(), step: lastStep }, 'leave'), { once: true });
}
