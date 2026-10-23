/**
 * Production server (22 Oct): static build, cost guards, visit log, and Gemini / Groq compatibility against FAKE
 * local servers that answer like the real ones (no network, no key, no paid call).
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { createApp } from '../server/app.ts';
import { clientIp, DailyQuota, limitsFromEnv, originPolicy } from '../server/guards.ts';
import { portableBody, portableSchema } from '../server/providers/llm.ts';
import { cacheControl, resolveInside } from '../server/static.ts';
import { refSite, uaFamily } from '../server/visits.ts';

const listen = (server: Server) =>
  new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));
const QUEST_UA = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/40.4.0 SamsungBrowser/4.0 Chrome/138.0 VR Safari/537.36';

// ------------------------------------------------------------------ a fake build folder
const dist = mkdtempSync(join(tmpdir(), 'wdd-dist-'));
mkdirSync(join(dist, 'assets'));
mkdirSync(join(dist, 'textures'));
mkdirSync(join(dist, 'audio'));
mkdirSync(join(dist, 'basis'));
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Wind-Down Desk</title>');
writeFileSync(join(dist, 'assets', 'index-AbCd1234.js'), `console.log(${JSON.stringify('x'.repeat(4000))});`);
writeFileSync(join(dist, 'textures', 'oak.ktx2'), Buffer.alloc(64, 1));
writeFileSync(join(dist, 'audio', 'rain.ogg'), Buffer.alloc(64, 2));
writeFileSync(join(dist, 'basis', 'basis_transcoder.wasm'), Buffer.alloc(2048, 3));
writeFileSync(join(dist, '.env'), 'NOT_SERVED=1');

const siteEnv = { WDD_FORCE_SIMULATED: '1', RENDER: 'true', RENDER_EXTERNAL_URL: 'https://wind-down-desk.onrender.com', WDD_ALLOW_LAN_ORIGINS: '0', WDD_DAILY_AGENT_PER_IP: '3', WDD_MAX_AUDIO_BYTES: '4000', WDD_VISITS_TOKEN: 't'.repeat(40) };
const app = createApp({ env: siteEnv, staticDir: dist });
let base = '';
before(async () => {
  base = await listen(app.server);
});
after(() => close(app.server));

test('static: exact MIME types for KTX2, Ogg, wasm; long cache on hashed assets; index.html always revalidated', async () => {
  const types = await Promise.all(['/textures/oak.ktx2', '/audio/rain.ogg', '/basis/basis_transcoder.wasm', '/'].map((p) => fetch(base + p)));
  assert.deepEqual(types.map((r) => r.headers.get('content-type')), ['image/ktx2', 'audio/ogg', 'application/wasm', 'text/html; charset=utf-8']);
  assert.equal(types[3].headers.get('cache-control'), 'no-cache');
  assert.equal(types[0].headers.get('cache-control'), 'public, max-age=3600');
  const js = await fetch(`${base}/assets/index-AbCd1234.js`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(js.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.ok((await js.text()).startsWith('console.log'), 'fetch decodes the gzip body');
  assert.equal(cacheControl('/index.html'), 'no-cache');
  assert.equal(cacheControl('/assets/world-initializer-B4GtvgJ5.js'), 'public, max-age=31536000, immutable');
  assert.equal(types[3].headers.get('x-content-type-options'), 'nosniff');
});

test('static: gzip really sent, ETag revalidation answers 304', async () => {
  const raw = await new Promise<{ enc: string | undefined; body: Buffer; etag: string }>((resolve) => {
    import('node:http').then(({ get }) =>
      get(`${base}/assets/index-AbCd1234.js`, { headers: { 'accept-encoding': 'gzip' } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ enc: res.headers['content-encoding'], body: Buffer.concat(chunks), etag: String(res.headers.etag) }));
      }),
    );
  });
  assert.equal(raw.enc, 'gzip');
  assert.ok(gunzipSync(raw.body).toString().startsWith('console.log'));
  assert.ok(raw.body.length < 300, `compressed ${raw.body.length} B`);
  const again = await fetch(`${base}/assets/index-AbCd1234.js`, { headers: { 'if-none-match': raw.etag } });
  assert.equal(again.status, 304);
});

test('static: no way out of dist/, no dotfiles, no source maps; unknown API is JSON 404', async () => {
  assert.equal(resolveInside(dist, '/../package.json'), null);
  assert.equal(resolveInside(dist, '/%2e%2e/%2e%2e/etc/passwd'), null);
  assert.equal(resolveInside(dist, '/.env'), null);
  assert.equal(resolveInside(dist, '/assets/index.js.map'), null);
  for (const p of ['/.env', '/%2e%2e/package.json', '/assets/../../package.json', '/nope.js']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
  const api = await fetch(`${base}/api/nothing`);
  assert.equal(api.status, 404);
  assert.equal(api.headers.get('content-type'), 'application/json; charset=utf-8');
});

test('origin: the site itself is allowed, another site may not spend the quota (403), no LAN in production', async () => {
  const ok = await fetch(`${base}/api/summarize`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://wind-down-desk.onrender.com', 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify({ text: 'the meeting tomorrow' }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://wind-down-desk.onrender.com');
  const evil = await fetch(`${base}/api/summarize`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify({ text: 'x' }) });
  assert.equal(evil.status, 403);
  const policy = originPolicy({ WDD_ALLOW_LAN_ORIGINS: '0' });
  assert.equal(policy('http://localhost:8081'), null);
  assert.equal(originPolicy({})('http://localhost:8081'), 'http://localhost:8081', 'dev keeps localhost');
});

test('quota: per visitor per day on the agent → 429 (the app then uses its on-device agent)', async () => {
  const call = (ip: string) => fetch(`${base}/api/extract`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ text: 'I need to call the dentist.' }) });
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await call('198.51.100.7')).status);
  assert.deepEqual(codes, [200, 200, 200, 429]);
  assert.equal((await call('198.51.100.8')).status, 200, 'another visitor still has their quota');
});

test('audio: a clip over the size cap is refused before any provider call (413)', async () => {
  const res = await fetch(`${base}/api/transcribe`, { method: 'POST', headers: { 'content-type': 'audio/webm', 'x-forwarded-for': '198.51.100.20' }, body: new Uint8Array(5000) });
  assert.equal(res.status, 413);
  const small = await fetch(`${base}/api/transcribe`, { method: 'POST', headers: { 'content-type': 'audio/webm', 'x-forwarded-for': '198.51.100.20', 'x-wdd-hint': encodeURIComponent('hello') }, body: new Uint8Array(1200) });
  assert.equal(small.status, 200);
  assert.equal(((await small.json()) as { text: string }).text, 'hello');
});

test('DailyQuota: per visitor, global, token ceiling, reset at 00:00 UTC', () => {
  let now = Date.UTC(2026, 10, 20, 23, 59);
  const limits = { ...limitsFromEnv({}), perIp: { stt: 2, agent: 2, visit: 9, talk: 9 }, total: { stt: 3, agent: 9, visit: 9, talk: 9 }, llmTokens: 1000 };
  const q = new DailyQuota(limits, () => now);
  assert.deepEqual([q.take('stt', 'a'), q.take('stt', 'a'), q.take('stt', 'a')], [true, true, false], 'per visitor');
  assert.deepEqual([q.take('stt', 'b'), q.take('stt', 'c')], [true, false], 'global');
  q.addTokens(1200);
  assert.equal(q.take('agent', 'd'), false, 'token ceiling');
  now += 2 * 60_000;
  assert.equal(q.take('stt', 'a'), true, 'a new day');
  assert.equal(q.take('agent', 'd'), true);
});

test('client IP: X-Forwarded-For only behind Render (else anyone picks their quota)', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.1' } } as unknown as IncomingMessage;
  assert.equal(clientIp(req, { RENDER: 'true' }), '203.0.113.5');
  assert.equal(clientIp(req, {}), '10.0.0.1');
});

// ------------------------------------------------------------------ anonymous visits
test('visits: whitelisted steps only, never words; Quest detected; referrer site only; robots ignored', async () => {
  const beacon = (body: unknown, ua = QUEST_UA) =>
    fetch(`${base}/api/visit`, { method: 'POST', headers: { 'content-type': 'text/plain', 'user-agent': ua, origin: 'https://wind-down-desk.onrender.com', 'x-forwarded-for': '192.0.2.44' }, body: JSON.stringify(body) });
  assert.equal((await beacon({ e: 'page', d: { ref: 'https://www.youtube.com/watch?v=abc', src: 'devpost', text: 'my worries' } })).status, 204);
  await beacon({ e: 'ritual-start', d: { kind: 'breathe', via: 'hand', words: 'I am anxious about Paul' } });
  await beacon({ e: 'say', d: { text: 'secret' } });
  await beacon({ e: 'page' }, 'curl/8.4');
  const events = app.visits.since(null);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0].d, { ref: 'www.youtube.com', src: 'devpost' });
  assert.deepEqual(events[1].d, { kind: 'breathe', via: 'hand' });
  assert.equal(events[0].dev, 'quest');
  assert.match(events[0].v, /^v_[0-9a-f]{16}$/u);
  assert.ok(!JSON.stringify(events).includes('192.0.2.44'), 'no IP stored');
  assert.ok(!JSON.stringify(events).includes('worr') && !JSON.stringify(events).includes('Paul'), 'no words stored');
  assert.equal(uaFamily(QUEST_UA).br, 'Meta Quest Browser');
  assert.equal(refSite('not a url'), null);
});

test('visits export: owner token only (404 without it configured, 401 wrong, 200 right, locked after 20 tries)', async () => {
  const get = (auth?: string, ip = '192.0.2.50') => fetch(`${base}/api/visits/export`, { headers: { ...(auth ? { authorization: auth } : {}), 'x-forwarded-for': ip } });
  assert.equal((await get()).status, 401);
  assert.equal((await get('Bearer wrong')).status, 401);
  const ok = await get(`Bearer ${'t'.repeat(40)}`);
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { events: unknown[]; usage: { total: { agent: number } } };
  assert.ok(Array.isArray(body.events));
  assert.ok(body.usage.total.agent >= 4);
  for (let i = 0; i < 20; i++) await get('Bearer nope', '192.0.2.77');
  assert.equal((await get(`Bearer ${'t'.repeat(40)}`, '192.0.2.77')).status, 429);
  const bare = createApp({ env: { WDD_FORCE_SIMULATED: '1' } });
  const url = await listen(bare.server);
  assert.equal((await fetch(`${url}/api/visits/export`, { headers: { authorization: `Bearer ${'t'.repeat(40)}` } })).status, 404);
  await close(bare.server);
});

// ------------------------------------------------------------------ Gemini + Groq, faked locally
test('Gemini compatibility: portable schema and body (no strict / additionalProperties / pattern, no null content)', () => {
  const schema = { type: 'object', strict: true, additionalProperties: false, properties: { title: { type: 'string', pattern: '^.+$' }, list: { type: 'array', items: { type: 'object', additionalProperties: false } } } };
  assert.deepEqual(portableSchema(schema), { type: 'object', properties: { title: { type: 'string' }, list: { type: 'array', items: { type: 'object' } } } });
  const body = portableBody({ messages: [{ role: 'assistant', content: null }, { role: 'user', content: 'hi' }], response_format: { type: 'json_schema', json_schema: { name: 'x', strict: true, schema } } });
  assert.deepEqual((body.messages as Array<{ content: string }>).map((m) => m.content), ['', 'hi']);
  assert.ok(!JSON.stringify(body).includes('additionalProperties') && !JSON.stringify(body).includes('"strict"') && !JSON.stringify(body).includes('pattern'));
});

test('agent through a fake Gemini (fenced JSON, usage, thought signature) and speech through a fake Groq', async () => {
  const seen: Array<Record<string, unknown>> = [];
  let mode: 'ok' | 'error' | 'null' = 'ok';
  const gemini = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
    seen.push({ path: req.url, auth: req.headers.authorization, ...body });
    if (mode === 'error') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ error: { code: 400, message: 'Invalid JSON payload received. Unknown name "strict"', status: 'INVALID_ARGUMENT' } }]));
      return;
    }
    const isSummary = JSON.stringify(body.messages).includes('What weighs on them');
    const content = mode === 'null' ? null : isSummary ? '```json\n{"title": "The meeting with Paul"}\n```' : '```json\n{"tokens":[{"title":"Reply to the landlord","detail":"About the heating","suggestion":"tomorrow","why":"It has a deadline"}]}\n```';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'x', object: 'chat.completion', model: 'gemini-3.8-flash', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content, extra_content: { google: { thought_signature: 'c2ln' } } } }], usage: { prompt_tokens: 410, completion_tokens: 38, total_tokens: 701 } }));
  });
  const groq = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('latin1');
    const okForm = req.url === '/openai/v1/audio/transcriptions' && raw.includes('name="model"') && raw.includes('whisper-large-v3-turbo') && raw.includes('filename="utterance.webm"');
    res.writeHead(okForm ? 200 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify(okForm ? { text: ' I keep replaying that meeting. ', x_groq: { id: 'req_x' } } : { error: { message: 'bad form' } }));
  });
  const g = await listen(gemini);
  const q = await listen(groq);
  const live = createApp({
    env: {
      LLM_BASE_URL: `${g}/v1beta/openai`,
      LLM_API_KEY: 'test-only-not-a-key',
      LLM_MODEL: 'gemini-3.8-flash',
      LLM_REASONING_EFFORT: 'low',
      STT_BASE_URL: `${q}/openai/v1`,
      STT_API_KEY: 'test-only-not-a-key',
      STT_MODEL: 'whisper-large-v3-turbo',
    },
  });
  const url = await listen(live.server);
  try {
    assert.equal(live.providers.simulated.agent, false);
    const ex = (await (await fetch(`${url}/api/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: "I haven't replied to the landlord about the heating." }) })).json()) as { tokens: Array<{ title: string; suggestion: string }> };
    assert.deepEqual(ex.tokens.map((t) => [t.title, t.suggestion]), [['Reply to the landlord', 'tomorrow']]);
    const sum = (await (await fetch(`${url}/api/summarize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'The meeting with Paul tomorrow' }) })).json()) as { title: string };
    assert.equal(sum.title, 'The meeting with Paul', 'fenced JSON from Gemini is read');
    const sent = seen[0];
    assert.equal(sent.path, '/v1beta/openai/chat/completions');
    assert.equal(sent.auth, 'Bearer test-only-not-a-key');
    assert.equal(sent.model, 'gemini-3.8-flash');
    assert.equal(sent.reasoning_effort, 'low');
    assert.deepEqual(sent.response_format, { type: 'json_object' });
    assert.ok(Number(sent.max_tokens) >= 1024, 'room for Gemini 3 thinking');
    assert.ok((sent.messages as Array<{ content: unknown }>).every((m) => typeof m.content === 'string'));
    assert.equal(live.quota.view().tokens, 1402, 'usage counted toward the daily token ceiling');
    // Errors and empty answers: the evening goes on with the on-device agent.
    mode = 'error';
    const fb = (await (await fetch(`${url}/api/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'I need to book the dentist.' }) })).json()) as { tokens: unknown[] };
    assert.ok(fb.tokens.length >= 1);
    mode = 'null';
    const fb2 = (await (await fetch(`${url}/api/summarize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'The slides for Monday' }) })).json()) as { title: string };
    assert.ok(fb2.title.length > 0);
    // Groq speech-to-text.
    const tr = (await (await fetch(`${url}/api/transcribe`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: new Uint8Array(3000) })).json()) as { text: string; simulated: boolean };
    assert.deepEqual(tr, { text: 'I keep replaying that meeting.', provider: `openai-compatible (127.0.0.1)`, simulated: false });
  } finally {
    await close(live.server);
    await close(gemini);
    await close(groq);
  }
});
