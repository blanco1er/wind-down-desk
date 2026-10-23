/**
 * Cost guards for the public demo (skill agent-argent-gardefous, rule 10: global ceiling + per-person daily quotas).
 *
 * Everything that can cost money (speech-to-text, the language model) passes two daily counters — per visitor (IP)
 * and global — plus a daily ceiling of model tokens. Over a limit the endpoint answers 429 and the app carries on
 * by itself (on-device agent, "didn't catch that" for speech): the evening never breaks, the bill never grows.
 * Counters live in memory and restart at 00:00 UTC (Render Starter has no persistent disk: a restart also resets
 * them, which can at most double one day's ceiling).
 */
import type { IncomingMessage } from 'node:http';
import type { Env } from './config.ts';

export type Bucket = 'stt' | 'agent' | 'visit' | 'talk';

export interface Limits {
  perIp: Record<Bucket, number>;
  total: Record<Bucket, number>;
  /** Model tokens (prompt + completion, as reported by the provider) per day, all visitors. */
  llmTokens: number;
  /** Largest accepted audio clip (bytes). The app records 32 kb/s Opus: 600 KB ≈ 2.5 min. */
  maxAudioBytes: number;
  /** 24 Oct — seconds of the lamp's dynamic voice (TTS) per visitor and for everyone, per day. */
  ttsSecondsPerIp: number;
  ttsSecondsTotal: number;
}

const int = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

/** Defaults sized for a jury demo: ≈ 10 evenings a day per visitor, a few hundred visitors a day at most. */
export function limitsFromEnv(env: Env): Limits {
  return {
    perIp: {
      stt: int(env.WDD_DAILY_STT_PER_IP, 150),
      agent: int(env.WDD_DAILY_AGENT_PER_IP, 300),
      visit: int(env.WDD_DAILY_VISIT_PER_IP, 400),
      // "Talk it through": one turn per sentence; a 45-minute talk is ~60–90 turns.
      talk: int(env.WDD_DAILY_TALK_PER_IP, 240),
    },
    total: {
      stt: int(env.WDD_DAILY_STT_TOTAL, 4000),
      agent: int(env.WDD_DAILY_AGENT_TOTAL, 8000),
      visit: int(env.WDD_DAILY_VISIT_TOTAL, 50000),
      talk: int(env.WDD_DAILY_TALK_TOTAL, 6000),
    },
    llmTokens: int(env.WDD_DAILY_LLM_TOKENS, 1_000_000),
    maxAudioBytes: int(env.WDD_MAX_AUDIO_BYTES, 600_000),
    // 60 minutes of the lamp's voice per visitor per day; 6 hours for everyone (≈ 3.24 $/day at Flash-Lite TTS
    // prices of 22 Oct 2026: 0.0015 $ per 10 s of audio).
    ttsSecondsPerIp: int(env.WDD_DAILY_TTS_SECONDS_PER_IP, 3600),
    ttsSecondsTotal: int(env.WDD_DAILY_TTS_SECONDS_TOTAL, 21_600),
  };
}

const dayOf = (ms: number) => Math.floor(ms / 86_400_000);

export class DailyQuota {
  private day = -1;
  private readonly perIp = new Map<string, number>();
  private readonly total: Record<Bucket, number> = { stt: 0, agent: 0, visit: 0, talk: 0 };
  private readonly ttsPerIp = new Map<string, number>();
  private ttsTotal = 0;
  private tokens = 0;
  readonly limits: Limits;
  private readonly now: () => number;
  // (No parameter properties: Node runs this file by stripping types only.)
  constructor(limits: Limits, now: () => number = Date.now) {
    this.limits = limits;
    this.now = now;
  }

  private roll(): void {
    const d = dayOf(this.now());
    if (d !== this.day) {
      this.day = d;
      this.perIp.clear();
      this.total.stt = 0;
      this.total.agent = 0;
      this.total.visit = 0;
      this.total.talk = 0;
      this.tokens = 0;
      this.ttsPerIp.clear();
      this.ttsTotal = 0;
    }
  }

  /** Counts one request; false (and nothing counted) when the visitor's or the global daily limit is reached. */
  take(bucket: Bucket, ip: string): boolean {
    this.roll();
    if ((bucket === 'agent' || bucket === 'talk') && this.limits.llmTokens > 0 && this.tokens >= this.limits.llmTokens) return false;
    const key = `${bucket}|${ip}`;
    const mine = this.perIp.get(key) ?? 0;
    if (mine >= this.limits.perIp[bucket] || this.total[bucket] >= this.limits.total[bucket]) return false;
    this.perIp.set(key, mine + 1);
    this.total[bucket]++;
    return true;
  }

  /**
   * Reserves `seconds` of the lamp's voice (estimated from the text before speaking); false (nothing reserved) when
   * the visitor's or the global daily voice budget would be exceeded. `settleSeconds` corrects with what was played.
   */
  takeSeconds(ip: string, seconds: number): boolean {
    this.roll();
    const mine = this.ttsPerIp.get(ip) ?? 0;
    if (mine + seconds > this.limits.ttsSecondsPerIp || this.ttsTotal + seconds > this.limits.ttsSecondsTotal) return false;
    this.ttsPerIp.set(ip, mine + seconds);
    this.ttsTotal += seconds;
    return true;
  }

  settleSeconds(ip: string, reserved: number, actual: number): void {
    this.roll();
    const delta = actual - reserved;
    this.ttsPerIp.set(ip, Math.max(0, (this.ttsPerIp.get(ip) ?? 0) + delta));
    this.ttsTotal = Math.max(0, this.ttsTotal + delta);
  }

  /** Model usage reported by the provider (prompt + completion tokens). */
  addTokens(n: number): void {
    this.roll();
    if (Number.isFinite(n) && n > 0) this.tokens += n;
  }

  view(): { day: string; total: Record<Bucket, number>; tokens: number; ttsSeconds: number; visitors: number; limits: Limits } {
    this.roll();
    const ips = new Set([...this.perIp.keys()].map((k) => k.slice(k.indexOf('|') + 1)));
    return { day: new Date(this.day * 86_400_000).toISOString().slice(0, 10), total: { ...this.total }, tokens: this.tokens, ttsSeconds: Math.round(this.ttsTotal), visitors: ips.size, limits: this.limits };
  }
}

/**
 * The visitor's IP. Behind Render's proxy the socket address is the proxy: the first X-Forwarded-For entry is the
 * client (trusted only when running on Render or WDD_TRUST_PROXY=1, otherwise anyone could pick their own quota).
 * Used only as a counter key in memory, never stored or logged.
 */
export function clientIp(req: IncomingMessage, env: Env): string {
  const trust = env.RENDER === 'true' || env.WDD_TRUST_PROXY === '1';
  if (trust) {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    if (first != null && first.length > 0) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Origins allowed to call /api from a browser: the site itself (RENDER_EXTERNAL_URL, set by Render, or
 * WDD_PUBLIC_ORIGIN) and local development (localhost, 127.0.0.1, *.local, private LAN for a headset on Wi-Fi).
 */
export function originPolicy(env: Env): (origin: string | undefined) => string | null {
  const site = new Set<string>();
  for (const v of [env.RENDER_EXTERNAL_URL, env.WDD_PUBLIC_ORIGIN]) {
    if (v == null || v.length === 0) continue;
    try {
      site.add(new URL(v).origin);
    } catch {
      // Ignored: not a URL.
    }
  }
  const allowLan = env.WDD_ALLOW_LAN_ORIGINS !== '0';
  return (origin) => {
    if (origin == null) return null;
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return null;
    }
    if (site.has(url.origin)) return url.origin;
    if (!allowLan) return null;
    const h = url.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local') || /^192\.168\.|^10\./u.test(h) ? url.origin : null;
  };
}
