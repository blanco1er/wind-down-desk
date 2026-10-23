/**
 * "Talk it through" on the server (24 Oct): Gemini TTS streamed through /api/speak against a FAKE local Gemini
 * server (no network, no key, no paid call), the daily voice budget, /api/talk with the crisis guard.
 */
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp } from '../server/app.ts';
import { audioOf, drainJsonObjects, GeminiTts, stripWav, ttsFromEnv } from '../server/providers/tts.ts';
import { SimulatedAgent } from '../src/shared/agent/simulated.ts';
import { SimulatedStt } from '../server/providers/stt.ts';
import { CRISIS_REPLY } from '../src/shared/agent/safety.ts';

const listen = (server: Server) =>
  new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));
const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => resolve(s));
  });

// 0.5 s of a ramp, PCM16 LE: 12 000 samples = 24 000 bytes, sent as 3 deltas split mid-object across writes.
const PCM = Buffer.alloc(24_000);
for (let i = 0; i < 12_000; i++) PCM.writeInt16LE((i % 2000) - 1000, i * 2);
const KEY = 'fake-key-0123456789abcdef';
let lastRequest: { headers: IncomingMessage['headers']; body: Record<string, unknown> } | null = null;
let mode: 'sse' | 'wav' | 'error' = 'sse';
const fake = createServer(async (req, res) => {
  lastRequest = { headers: req.headers, body: JSON.parse(await readBody(req)) };
  if (mode === 'error') {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `bad request for key ${KEY}` } }));
    return;
  }
  if (mode === 'wav') {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + PCM.length, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(PCM.length, 40);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: Buffer.concat([header, PCM]).toString('base64') }] }] }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const events = [0, 1, 2].map((k) => `event: step.delta\ndata: ${JSON.stringify({ event_type: 'step.delta', delta: { type: 'audio', data: PCM.subarray(k * 8000, (k + 1) * 8000).toString('base64') } })}\n\n`);
  const all = `data: ${JSON.stringify({ event_type: 'interaction.start' })}\n\n${events.join('')}data: ${JSON.stringify({ event_type: 'interaction.complete' })}\n\n`;
  // Split in odd places (inside base64 strings and between "data:" and "{").
  for (let i = 0; i < all.length; i += 997) {
    res.write(all.slice(i, i + 997));
    await new Promise((r) => setTimeout(r, 5));
  }
  res.end();
});
let fakeBase = '';
let appBase = '';
let appNoVoiceBase = '';
let app: ReturnType<typeof createApp>;
let appNoVoice: ReturnType<typeof createApp>;
before(async () => {
  fakeBase = await listen(fake);
  const tts = new GeminiTts({ apiKey: KEY, baseUrl: fakeBase, model: 'gemini-3.8-flash-lite-tts', voice: 'Achernar' });
  app = createApp({ env: { WDD_DAILY_TTS_SECONDS_PER_IP: '2' }, providers: { agent: new SimulatedAgent(), stt: new SimulatedStt(), tts, simulated: { agent: true, stt: true } } });
  appBase = await listen(app.server);
  appNoVoice = createApp({ env: { WDD_FORCE_SIMULATED: '1' } });
  appNoVoiceBase = await listen(appNoVoice.server);
});
after(async () => {
  await close(fake);
  await close(app.server);
  await close(appNoVoice.server);
});

test('the stream reader finds whole events in SSE split anywhere, and keeps an open object for the next read', () => {
  const out: unknown[] = [];
  const rest = drainJsonObjects('data: {"event_type":"step.delta","delta":{"type":"audio","data":"AAEC"}}\n\ndata: {"event_type":"st', out);
  assert.equal(out.length, 1);
  assert.equal(rest, '{"event_type":"st');
  assert.deepEqual([...audioOf(out[0])[0]], [0, 1, 2]);
  const arr: unknown[] = [];
  drainJsonObjects('[{"a":"}{"},', arr);
  assert.deepEqual(arr, [{ a: '}{' }], 'braces inside strings are not objects');
});

test('Gemini TTS: the request is the documented one (model, voice, style, stream) and the PCM arrives whole', async () => {
  mode = 'sse';
  const tts = new GeminiTts({ apiKey: KEY, baseUrl: fakeBase });
  const chunks: Uint8Array[] = [];
  for await (const c of tts.stream('You do not have to solve it tonight.', { style: 'soft' })) chunks.push(c);
  assert.ok(Buffer.concat(chunks).equals(PCM));
  assert.equal(lastRequest?.headers['x-goog-api-key'], KEY);
  const b = lastRequest?.body as { model: string; stream: boolean; generation_config: { speech_config: Array<{ voice: string }> }; input: Array<{ content: Array<{ annotations: Array<{ type: string; style: string }> }> }> };
  assert.equal(b.model, 'gemini-3.8-flash-lite-tts', 'owner choice by default');
  assert.equal(b.generation_config.speech_config[0].voice, 'Achernar');
  assert.equal(b.stream, true);
  assert.deepEqual(b.input[0].content[0].annotations[0], { type: 'speech_metadata', style: 'soft' });
});

test('a non-streamed WAV answer still plays; a provider error never leaks the key', async () => {
  mode = 'wav';
  const tts = new GeminiTts({ apiKey: KEY, baseUrl: fakeBase });
  const chunks: Uint8Array[] = [];
  for await (const c of tts.stream('Hello.', { style: 'soft' })) chunks.push(c);
  assert.ok(Buffer.concat(chunks).equals(PCM));
  assert.ok(stripWav(PCM).equals(PCM), 'raw PCM is left as is');
  mode = 'error';
  await assert.rejects(
    async () => {
      for await (const _ of tts.stream('Hello.', { style: 'soft' })) void _;
    },
    (e: Error) => !e.message.includes(KEY) && /400/u.test(e.message),
  );
});

test('/api/speak streams audio/L16 24 kHz, counts the seconds played, then refuses past the daily voice budget', async () => {
  mode = 'sse';
  const r = await fetch(`${appBase}/api/speak`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Take a slow breath.' }) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/L16;rate=24000;channels=1');
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(PCM));
  assert.equal(app.quota.view().ttsSeconds, 1, '0.5 s played, rounded');
  // 2 s per visitor: the next sentence (estimated ≥ 2 s) is refused.
  const r2 = await fetch(`${appBase}/api/speak`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'A second, longer sentence to say aloud.' }) });
  assert.equal(r2.status, 429);
});

test('no voice configured → 503, the app shows the caption alone; the key is read only on the server', async () => {
  const r = await fetch(`${appNoVoiceBase}/api/speak`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Hello.' }) });
  assert.equal(r.status, 503);
  assert.equal(ttsFromEnv({ LLM_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai', LLM_API_KEY: KEY })?.name, 'Gemini TTS (gemini-3.8-flash-lite-tts, Achernar)');
  assert.equal(ttsFromEnv({ LLM_BASE_URL: 'https://api.deepseek.com', LLM_API_KEY: KEY }), null, 'never send a non-Gemini key to Google');
  assert.equal(ttsFromEnv({ TTS_API_KEY: KEY, WDD_FORCE_SIMULATED: '1' }), null);
});

test('/api/talk: a turn answers with a reply, new weights and a summary; a crisis gets the fixed answer only', async () => {
  const post = (body: unknown) => fetch(`${appBase}/api/talk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<{ reply: string; weights: string[]; summary: string; crisis: boolean }>);
  const a = await post({ text: 'I need to call my landlord about the heating and I keep putting it off', summary: '', turns: [], weights: [] });
  assert.equal(a.crisis, false);
  assert.ok(a.reply.length > 0 && a.reply.length <= 260);
  assert.ok(a.weights.length >= 1 && a.weights.length <= 2);
  const many = Array.from({ length: 40 }, (_, i) => ({ who: i % 2 ? 'lamp' : 'you', text: `turn ${i} ${'x'.repeat(500)}` }));
  const b = await post({ text: 'Sometimes I think about suicide.', summary: 's', turns: many, weights: a.weights });
  assert.equal(b.crisis, true);
  assert.equal(b.reply, CRISIS_REPLY);
});
