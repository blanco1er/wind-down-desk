/**
 * Anonymous visit log for the hosted demo (owner rule: did the judges try it, from where, how far did they go?).
 * Recipe: Boite-a-outils/14-suivi-visites-demo, made lighter for a VR wind-down app:
 *
 * - NEVER kept: words, voice, worries, IP addresses, cookies. Evening content is private by nature.
 * - Kept per event: time, a visitor id = salted one-way hash of (IP + browser) cut to 16 hex, device family
 *   (Quest / desktop / mobile…), browser family, the event name from a fixed list and a few short whitelisted values
 *   (place id, ritual kind, how the desk was placed, referrer SITE only, ?ref / utm_source).
 * - Sent by the page itself (navigator.sendBeacon to /api/visit, same origin): no third-party script, no cookie.
 * - Stored in memory (last 20 000 events) and, when WDD_DATA_DIR is set (a Render disk), appended to
 *   <dir>/visits/YYYY-MM-DD.jsonl. Render Starter without a disk forgets them at a restart: the owner's report
 *   script saves what it reads (tools/visits-report.mjs --save).
 * - Read only by the owner: GET /api/visits/export with "Authorization: Bearer <WDD_VISITS_TOKEN>" (≥ 32 chars; without
 *   it the route does not exist → 404; 20 wrong tries per hour per address → 429).
 * - Own devices and scripts: header x-wdd-internal: 1, or the page opened once with ?internal=1 → flagged "internal".
 * - Off entirely with WDD_VISITS=off.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import type { Env } from './config.ts';

/** Events the page may send, and the values each may carry. */
export const EVENTS: Record<string, readonly string[]> = {
  page: ['ref', 'src', 'lang'],
  /** 22 Oct: what the landing offered (no-webxr, no-session, preview-asked, preview, xr-failed). */
  landing: ['kind'],
  'xr-enter': ['mode'],
  'xr-exit': ['secs'],
  placed: ['source', 'mode'],
  'anchor-restored': ['bearing'],
  'moved-desk': ['source', 'via'],
  'ritual-start': ['kind', 'via'],
  'ritual-done': ['kind'],
  sorted: ['count'],
  place: ['id', 'via'],
  immersion: ['level'],
  mic: ['state'],
  style: ['style'],
  goodnight: ['secs'],
  'client-error': ['where'],
  leave: ['secs', 'step'],
};

export interface VisitEvent {
  t: string;
  e: string;
  v: string;
  dev: string;
  br: string;
  internal?: true;
  d?: Record<string, string | number>;
}

export function uaFamily(ua: string): { dev: string; br: string; bot: boolean } {
  const u = ua;
  const bot = u.length === 0 || /bot\b|bot\/|crawl|spider|preview|curl\/|wget|python|node-fetch|undici|axios|headless|lighthouse|uptime|monitor|render\//iu.test(u);
  const quest = /OculusBrowser|Quest|Meta Horizon/iu.test(u);
  const dev = quest ? 'quest' : /iPad|Tablet/u.test(u) || (/Android/u.test(u) && !/Mobile/u.test(u)) ? 'tablet' : /Mobi|iPhone|Android/u.test(u) ? 'mobile' : 'desktop';
  const br = quest ? 'Meta Quest Browser' : /Edg\//u.test(u) ? 'Edge' : /Firefox\//u.test(u) ? 'Firefox' : /Chrome\/|CriOS/u.test(u) ? 'Chrome' : /Safari\//u.test(u) ? 'Safari' : 'Other';
  return { dev, br, bot };
}

/** Only short, plain values survive: a site name, an id, a number. */
export function cleanValue(v: unknown): string | number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, 40);
  return /^[\w .:/-]*$/u.test(s) && s.length > 0 ? s : null;
}

/** The referrer's site only (https://www.youtube.com/watch?v=… → www.youtube.com). */
export function refSite(ref: unknown): string | null {
  if (typeof ref !== 'string' || ref.length === 0) return null;
  try {
    return new URL(ref).hostname.slice(0, 40);
  } catch {
    return null;
  }
}

export class VisitLog {
  readonly events: VisitEvent[] = [];
  private readonly salt: string;
  private readonly dir: string | null;
  private readonly token: string | null;
  private readonly on: boolean;
  private readonly failures = new Map<string, { n: number; since: number }>();

  constructor(env: Env) {
    this.on = env.WDD_VISITS !== 'off';
    this.salt = env.WDD_VISITS_SALT && env.WDD_VISITS_SALT.length >= 16 ? env.WDD_VISITS_SALT : randomBytes(32).toString('hex');
    this.dir = env.WDD_DATA_DIR ? join(env.WDD_DATA_DIR, 'visits') : null;
    this.token = env.WDD_VISITS_TOKEN && env.WDD_VISITS_TOKEN.length >= 32 ? env.WDD_VISITS_TOKEN : null;
  }

  get enabled(): boolean {
    return this.on;
  }

  get exportEnabled(): boolean {
    return this.token != null;
  }

  visitorId(ip: string, ua: string): string {
    return `v_${createHmac('sha256', this.salt).update(`visitor|${ip}|${ua}`).digest('hex').slice(0, 16)}`;
  }

  /** Records one beacon; returns false when it is ignored (unknown event, robot, logging off). */
  record(body: unknown, req: IncomingMessage, ip: string, now = new Date()): boolean {
    if (!this.on || body == null || typeof body !== 'object') return false;
    const b = body as Record<string, unknown>;
    const name = typeof b.e === 'string' ? b.e : '';
    const allowed = EVENTS[name];
    if (allowed == null) return false;
    const ua = String(req.headers['user-agent'] ?? '');
    const fam = uaFamily(ua);
    if (fam.bot) return false;
    const data: Record<string, string | number> = {};
    const raw = b.d != null && typeof b.d === 'object' ? (b.d as Record<string, unknown>) : {};
    for (const key of allowed) {
      const value = key === 'ref' ? refSite(raw[key]) : cleanValue(raw[key]);
      if (value != null) data[key] = value;
    }
    const event: VisitEvent = { t: now.toISOString(), e: name, v: this.visitorId(ip, ua), dev: fam.dev, br: fam.br };
    if (b.internal === true || req.headers['x-wdd-internal'] === '1') event.internal = true;
    if (Object.keys(data).length > 0) event.d = data;
    this.events.push(event);
    if (this.events.length > 20_000) this.events.splice(0, this.events.length - 20_000);
    if (this.dir != null) {
      const dir = this.dir;
      void mkdir(dir, { recursive: true })
        .then(() => appendFile(join(dir, `${event.t.slice(0, 10)}.jsonl`), `${JSON.stringify(event)}\n`, { mode: 0o600 }))
        .catch(() => {});
    }
    return true;
  }

  /** Owner export: 'ok' with events, 'absent' (no token configured → 404), 'denied' (401), 'locked' (429). */
  authorize(header: string | undefined, ip: string, nowMs = Date.now()): 'ok' | 'absent' | 'denied' | 'locked' {
    if (this.token == null) return 'absent';
    const f = this.failures.get(ip);
    if (f != null && nowMs - f.since < 3_600_000 && f.n >= 20) return 'locked';
    const given = /^Bearer (.+)$/u.exec(header ?? '')?.[1] ?? '';
    const a = Buffer.from(given);
    const bTok = Buffer.from(this.token);
    if (a.length === bTok.length && timingSafeEqual(a, bTok)) return 'ok';
    if (f == null || nowMs - f.since >= 3_600_000) this.failures.set(ip, { n: 1, since: nowMs });
    else f.n++;
    return 'denied';
  }

  since(iso: string | null): VisitEvent[] {
    return iso == null ? this.events.slice() : this.events.filter((e) => e.t >= iso);
  }
}
