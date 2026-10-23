/**
 * Wind-Down Desk server (Node built-ins only): the agent + voice API and, in production, the app itself.
 *
 *   GET  /api/health          providers in use (names only, never a key)
 *   POST /api/extract         { text, existing? }                       → { tokens, agent }
 *   POST /api/plan            { tomorrow, later, letGoCount, lighter? } → { plan, agent }
 *   POST /api/summarize       { text }                                  → { title, agent }   (Release stone, ≤ 4 words)
 *   POST /api/transcribe      raw audio body (audio/*, ≤ WDD_MAX_AUDIO_BYTES) → { text, provider, simulated }
 *   POST /api/talk            { text, summary, turns, weights, closing } → { reply, weights, summary, crisis, agent }
 *   POST /api/speak           { text } → audio/L16 24 kHz mono, streamed (Gemini TTS; 503 when no voice)
 *   POST /api/visit           anonymous step beacon (server/visits.ts)  → 204
 *   GET  /api/visits/export   owner only (Bearer WDD_VISITS_TOKEN)      → { events, usage }
 *   GET  /*                   the Vite build (server/static.ts) when `staticDir` is given (production)
 *
 * Production (Render, one service): `node server/index.ts` with HOST=0.0.0.0, PORT from Render; HTTPS is Render's.
 * Cost guards (server/guards.ts): per-visitor and global daily quotas on speech-to-text and the agent, a daily ceiling
 * of model tokens, audio size cap, a per-minute burst limit, browser calls accepted only from the site's own origin.
 * Over a limit: 429, and the app carries on by itself (on-device agent). No user data is stored server-side.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { LIMITS, type PlanInput } from '../src/shared/agent/types.ts';
import { resolveProviders, type Env, type Providers } from './config.ts';
import { clientIp, DailyQuota, limitsFromEnv, originPolicy, type Bucket } from './guards.ts';
import { createStaticHandler } from './static.ts';
import { VisitLog } from './visits.ts';
import { boundTurns, TALK } from '../src/shared/agent/talk.ts';
import { cleanSummary } from '../src/shared/agent/safety.ts';
import { DEFAULT_TTS_STYLE, TTS_BYTES_PER_SECOND, TTS_SAMPLE_RATE } from './providers/tts.ts';

const MAX_JSON_BYTES = 32 * 1024;
const MAX_BEACON_BYTES = 2 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;

/** Headers on every response: no MIME sniffing, no referrer leak, mic and XR for this site only. */
export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'microphone=(self), xr-spatial-tracking=(self), camera=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      reject(new HttpError(413, 'Payload too large'));
      return;
    }
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        // Stop buffering but drain the socket so the 413 reaches the client.
        req.removeAllListeners('data');
        req.resume();
        reject(new HttpError(413, 'Payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage, limit = MAX_JSON_BYTES): Promise<Record<string, unknown>> {
  const body = await readBody(req, limit);
  try {
    const parsed = JSON.parse(body.toString('utf8')) as unknown;
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Expected a JSON object');
  }
}

function strings(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, max).map((s) => s.slice(0, 200)) : [];
}

export interface AppOptions {
  env?: Env;
  providers?: Providers;
  /** Serve this folder (the Vite build) for non-API GETs. Production only. */
  staticDir?: string;
  /** Clock for the daily quotas (tests). */
  now?: () => number;
}

export function createApp(options: AppOptions = {}): { server: Server; providers: Providers; quota: DailyQuota; visits: VisitLog } {
  const env = options.env ?? {};
  const quota = new DailyQuota(limitsFromEnv(env), options.now);
  const providers = options.providers ?? resolveProviders(env, { onUsage: (n) => quota.addTokens(n) });
  const visits = new VisitLog(env);
  const allowedOrigin = originPolicy(env);
  const serveStatic = options.staticDir != null ? createStaticHandler({ root: options.staticDir, headers: SECURITY_HEADERS }) : null;
  const hits = new Map<string, { count: number; since: number }>();

  const send = (res: ServerResponse, status: number, body: unknown, origin: string | null) => {
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      ...(status >= 400 ? { connection: 'close' } : {}),
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(origin != null ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}),
    });
    res.end(JSON.stringify(body));
  };

  const guard = (bucket: Bucket, ip: string) => {
    if (!quota.take(bucket, ip)) {
      throw new HttpError(429, bucket === 'stt' ? 'Daily voice limit reached for this demo' : 'Daily limit reached for this demo');
    }
  };

  const server = createServer(async (req, res) => {
    const originHeader = req.headers.origin;
    const origin = allowedOrigin(originHeader);
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');

      if (!isApi) {
        if (serveStatic != null && (await serveStatic(req, res, url.pathname))) return;
        res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        res.end('Not found');
        return;
      }

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          ...SECURITY_HEADERS,
          ...(origin != null ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}),
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type, x-wdd-session, x-wdd-hint',
          'access-control-max-age': '600',
        });
        res.end();
        return;
      }
      // A browser on another site may not spend this demo's quota: cross-origin POSTs are refused outright.
      if (req.method === 'POST' && originHeader != null && origin == null) {
        throw new HttpError(403, 'Origin not allowed');
      }
      const ip = clientIp(req, env);
      const now = Date.now();
      const bucket = hits.get(ip);
      if (bucket == null || now - bucket.since > RATE_WINDOW_MS) {
        hits.set(ip, { count: 1, since: now });
        if (hits.size > 50_000) hits.clear();
      } else if (++bucket.count > RATE_MAX) {
        throw new HttpError(429, 'Too many requests');
      }

      if (req.method === 'GET' && url.pathname === '/api/health') {
        send(res, 200, { ok: true, agent: providers.agent.name, stt: providers.stt.name, tts: providers.tts?.name ?? null, simulated: providers.simulated }, origin);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/visit') {
        guard('visit', ip);
        let body: Record<string, unknown> | null = null;
        try {
          body = await readJson(req, MAX_BEACON_BYTES);
        } catch {
          body = null;
        }
        if (body != null) visits.record(body, req, ip);
        res.writeHead(204, { ...SECURITY_HEADERS, 'cache-control': 'no-store', ...(origin != null ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}) });
        res.end();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/visits/export') {
        const verdict = visits.authorize(req.headers.authorization, ip);
        if (verdict === 'absent') throw new HttpError(404, 'Not found');
        if (verdict === 'locked') throw new HttpError(429, 'Too many tries');
        if (verdict === 'denied') throw new HttpError(401, 'Unauthorized');
        send(res, 200, { events: visits.since(url.searchParams.get('since')), usage: quota.view(), providers: { agent: providers.agent.name, stt: providers.stt.name } }, null);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/extract') {
        const body = await readJson(req);
        const text = typeof body.text === 'string' ? body.text.slice(0, LIMITS.maxInputChars) : '';
        if (text.trim().length === 0) {
          throw new HttpError(400, 'Missing text');
        }
        guard('agent', ip);
        const tokens = await providers.agent.extract(text, strings(body.existing, 16));
        send(res, 200, { tokens, agent: providers.agent.name }, origin);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/summarize') {
        const body = await readJson(req);
        const text = typeof body.text === 'string' ? body.text.slice(0, 600) : '';
        if (text.trim().length === 0) {
          throw new HttpError(400, 'Missing text');
        }
        guard('agent', ip);
        send(res, 200, { title: await providers.agent.summarize(text), agent: providers.agent.name }, origin);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/plan') {
        const body = await readJson(req);
        const tomorrowRaw = Array.isArray(body.tomorrow) ? body.tomorrow.slice(0, 8) : [];
        const input: PlanInput = {
          tomorrow: tomorrowRaw
            .map((t) =>
              typeof t === 'string'
                ? { title: t.slice(0, 80) }
                : t != null && typeof t === 'object' && typeof (t as { title?: unknown }).title === 'string'
                  ? {
                      title: (t as { title: string }).title.slice(0, 80),
                      detail: typeof (t as { detail?: unknown }).detail === 'string' ? (t as { detail: string }).detail.slice(0, 200) : undefined,
                    }
                  : null,
            )
            .filter((t): t is { title: string; detail?: string } => t != null),
          later: strings(body.later, 16),
          letGoCount: typeof body.letGoCount === 'number' ? Math.max(0, Math.min(99, body.letGoCount)) : 0,
          lighter: body.lighter === true,
          startAt: typeof body.startAt === 'string' && /^\d{2}:\d{2}$/u.test(body.startAt) ? body.startAt : undefined,
        };
        guard('agent', ip);
        const plan = await providers.agent.plan(input);
        send(res, 200, { plan, agent: providers.agent.name }, origin);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/talk') {
        // "Talk it through" (24 Oct): one turn; the history is bounded by the client and again here (talk.ts).
        const body = await readJson(req);
        const text = typeof body.text === 'string' ? body.text.slice(0, TALK.inputChars) : '';
        if (text.trim().length === 0) throw new HttpError(400, 'Missing text');
        const turns = Array.isArray(body.turns)
          ? body.turns
              .filter((t): t is { who: string; text: string } => t != null && typeof t === 'object' && typeof (t as { text?: unknown }).text === 'string')
              .map((t) => ({ who: t.who === 'lamp' ? ('lamp' as const) : ('you' as const), text: t.text }))
          : [];
        guard('talk', ip);
        const input = {
          text,
          summary: typeof body.summary === 'string' ? cleanSummary(body.summary.slice(0, TALK.summaryChars)) : '',
          turns: boundTurns(turns),
          weights: strings(body.weights, TALK.maxWeights),
          closing: body.closing === true,
        };
        if (body.stream === true) {
          // Lower latency (25 Oct): server-sent events, one per finished sentence, then the checked whole answer.
          res.writeHead(200, {
            ...SECURITY_HEADERS,
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            ...(origin != null ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}),
          });
          const agent = providers.agent;
          const onSentence = (sentence: string) => res.write(`data: ${JSON.stringify({ type: 'sentence', text: sentence })}\n\n`);
          const reply = agent.talkStream != null ? await agent.talkStream(input, onSentence) : await agent.talk(input);
          res.end(`data: ${JSON.stringify({ type: 'done', ...reply, summary: cleanSummary(reply.summary), agent: agent.name })}\n\n`);
          return;
        }
        const reply = await providers.agent.talk(input);
        send(res, 200, { ...reply, summary: cleanSummary(reply.summary), agent: providers.agent.name }, origin);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/speak') {
        // The lamp's dynamic voice: raw PCM16 24 kHz mono, streamed as it is made (first sound in ~1 s instead of
        // waiting for the whole sentence). No voice configured → 503 and the app shows the caption alone.
        const body = await readJson(req);
        const text = typeof body.text === 'string' ? body.text.replace(/\s+/gu, ' ').trim().slice(0, 400) : '';
        if (text.length === 0) throw new HttpError(400, 'Missing text');
        const tts = providers.tts ?? null;
        if (tts == null) throw new HttpError(503, 'No voice configured');
        const estimate = Math.max(2, text.length / 12);
        if (!quota.takeSeconds(ip, estimate)) throw new HttpError(429, 'Daily voice limit reached for this demo');
        const abort = new AbortController();
        req.on('close', () => abort.abort());
        let bytes = 0;
        try {
          for await (const chunk of tts.stream(text, { style: env.TTS_STYLE || DEFAULT_TTS_STYLE, signal: abort.signal })) {
            if (!res.headersSent) {
              res.writeHead(200, {
                ...SECURITY_HEADERS,
                'content-type': `audio/L16;rate=${TTS_SAMPLE_RATE};channels=1`,
                'cache-control': 'no-store',
                ...(origin != null ? { 'access-control-allow-origin': origin, vary: 'origin' } : {}),
              });
            }
            bytes += chunk.length;
            res.write(chunk);
          }
        } catch (error) {
          quota.settleSeconds(ip, estimate, bytes / TTS_BYTES_PER_SECOND);
          if (!res.headersSent) throw new HttpError(502, 'Voice unavailable');
          res.end();
          return;
        }
        quota.settleSeconds(ip, estimate, bytes / TTS_BYTES_PER_SECOND);
        if (!res.headersSent) throw new HttpError(502, 'Voice unavailable');
        res.end();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/transcribe') {
        const type = String(req.headers['content-type'] ?? '');
        if (!/^audio\//u.test(type)) {
          throw new HttpError(415, 'Expected audio/*');
        }
        const audio = await readBody(req, quota.limits.maxAudioBytes);
        guard('stt', ip);
        const hintHeader = req.headers['x-wdd-hint'];
        const transcript = await providers.stt.transcribe(new Uint8Array(audio), type, {
          hint: providers.simulated.stt && typeof hintHeader === 'string' ? decodeURIComponent(hintHeader) : undefined,
          sessionId: typeof req.headers['x-wdd-session'] === 'string' ? req.headers['x-wdd-session'] : undefined,
        });
        send(res, 200, transcript, origin);
        return;
      }
      throw new HttpError(404, 'Not found');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : 'Internal error';
      if (status === 500) {
        // The message only: a provider error can echo request details; bodies and headers are never logged.
        console.error('[wdd-server]', error instanceof Error ? error.message : 'error');
      }
      if (!res.headersSent) {
        send(res, status, { ok: false, error: message }, origin);
      }
    }
  });
  return { server, providers, quota, visits };
}
