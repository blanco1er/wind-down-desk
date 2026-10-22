import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp } from '../server/app.ts';
import { resolveProviders } from '../server/config.ts';
import { OpenAICompatibleChat } from '../server/providers/llm.ts';
import { DEMO_BRAIN_DUMP } from '../server/providers/stt.ts';

// Tests never use real providers, even if keys exist in the environment.
const { server, providers } = createApp({ env: { WDD_FORCE_SIMULATED: '1', DEEPSEEK_API_KEY: 'should-be-ignored' } });
let base = '';

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

const post = (path: string, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  fetch(base + path, { method: 'POST', headers, body: body instanceof Uint8Array ? new Blob([new Uint8Array(body)]) : JSON.stringify(body) });

test('health reports simulated providers', async () => {
  const res = await fetch(`${base}/api/health`);
  const body = (await res.json()) as { simulated: { agent: boolean; stt: boolean } };
  assert.equal(res.status, 200);
  assert.deepEqual(body.simulated, { agent: true, stt: true });
  assert.equal(providers.simulated.agent, true);
});

test('extract → tokens, plan → steps', async () => {
  const ex = (await (await post('/api/extract', { text: DEMO_BRAIN_DUMP })).json()) as { tokens: Array<{ title: string }> };
  assert.equal(ex.tokens.length, 5);
  const plan = (await (await post('/api/plan', { tomorrow: [{ title: ex.tokens[0].title }], later: [], letGoCount: 1 })).json()) as {
    plan: { steps: unknown[] };
  };
  assert.equal(plan.plan.steps.length, 1);
});

test('summarize → the Release engraving (≤ 4 words)', async () => {
  const res = (await (await post('/api/summarize', { text: "I can't stop thinking about the meeting with Paul tomorrow." })).json()) as { title: string };
  assert.equal(res.title, 'The meeting with Paul');
  assert.equal((await post('/api/summarize', { text: ' ' })).status, 400);
});

test('transcribe: simulated STT honours a hint, then the scripted dump once', async () => {
  const audio = new Uint8Array(4000);
  const hinted = (await (await post('/api/transcribe', audio, { 'content-type': 'audio/webm', 'x-wdd-hint': encodeURIComponent('dentist, tomorrow') })).json()) as {
    text: string;
  };
  assert.equal(hinted.text, 'dentist, tomorrow');
  const first = (await (await post('/api/transcribe', audio, { 'content-type': 'audio/webm', 'x-wdd-session': 's1' })).json()) as { text: string };
  assert.equal(first.text, DEMO_BRAIN_DUMP);
  const second = (await (await post('/api/transcribe', audio, { 'content-type': 'audio/webm', 'x-wdd-session': 's1' })).json()) as { text: string };
  assert.equal(second.text, '');
});

test('bad requests are rejected cleanly', async () => {
  assert.equal((await post('/api/extract', { text: '' })).status, 400);
  assert.equal((await post('/api/extract', '{', { 'content-type': 'application/json' })).status, 400);
  assert.equal((await post('/api/transcribe', new Uint8Array(10), { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post('/api/extract', { text: 'x'.repeat(40_000) })).status, 413);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});

test('provider policy: DeepSeek from env, Nebius refused, no key → simulated', () => {
  assert.equal(resolveProviders({}).simulated.agent, true);
  assert.match(resolveProviders({ DEEPSEEK_API_KEY: 'k' }).agent.name, /DeepSeek/u);
  assert.throws(() => resolveProviders({ LLM_BASE_URL: 'https://api.studio.nebius.ai/v1', LLM_API_KEY: 'k' }), /blocked/u);
  assert.throws(() => new OpenAICompatibleChat({ name: 'x', baseUrl: 'http://example.com', apiKey: 'k', model: 'm' }), /HTTPS/u);
});
