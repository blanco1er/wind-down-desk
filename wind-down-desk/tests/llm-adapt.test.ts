/**
 * Live regression of 25 Oct: a parameter refused by the provider (HTTP 400) sent every Talk it through turn to the
 * on-device fallback, silently, and the "agent" field still named the model. A FAKE OpenAI-compatible server
 * refuses "minimal", then response_format in a stream, then everything (no network, no key).
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp } from '../server/app.ts';
import { OpenAICompatibleChat } from '../server/providers/llm.ts';
import { SimulatedStt } from '../server/providers/stt.ts';
import { LlmAgent } from '../src/shared/agent/llm-agent.ts';
import { cleanKey, deviceTalk } from '../src/shared/agent/talk.ts';

const listen = (server: Server) =>
  new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

const ANSWER = '{"reply":"That sounds like a long day. What is still with you?","weights":["The long day"],"summary":"A long day."}';
let refuseAll = false;
const seen: Array<{ effort: string | null; stream: boolean; json: boolean }> = [];
const fake = createServer(async (req, res) => {
  let b = '';
  for await (const c of req) b += c;
  const j = JSON.parse(b);
  seen.push({ effort: j.reasoning_effort ?? null, stream: j.stream === true, json: j.response_format != null });
  const refuse = (m: string) => {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify([{ error: { code: 400, message: m, status: 'INVALID_ARGUMENT' } }]));
  };
  if (refuseAll) return refuse('Invalid argument for this model.');
  if (j.reasoning_effort === 'minimal') return refuse("Unsupported value: 'minimal' is not supported with this model.");
  if (j.stream === true && j.response_format != null) return refuse('response_format is not supported with stream.');
  if (j.stream === true) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (let i = 0; i < ANSWER.length; i += 20) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ANSWER.slice(i, i + 20) } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: ANSWER } }], usage: { total_tokens: 900 } }));
});
let fakeBase = '';
before(async () => {
  fakeBase = await listen(fake);
});
after(async () => close(fake));

const input = { text: 'Today was so long at work.', summary: '', turns: [], weights: [] };

test('"minimal" refused → one retry with the default effort, and it is remembered for the next turns', async () => {
  seen.length = 0;
  const chat = new OpenAICompatibleChat({ name: 'fake', baseUrl: fakeBase, apiKey: 'k', model: 'gemini-test', reasoningEffort: 'low' });
  const agent = new LlmAgent(chat, { talkReasoningEffort: 'minimal' });
  const a = await agent.talk(input);
  assert.equal(a.source, undefined, 'the model answered');
  assert.equal(a.reply, 'That sounds like a long day. What is still with you?');
  const b = await agent.talk(input);
  assert.equal(b.source, undefined);
  assert.deepEqual(seen.map((s) => s.effort), ['minimal', 'low', 'low'], 'refused once, then never sent again');
  assert.match(chat.lastProviderError ?? '', /HTTP 400: Unsupported value/u);
});

test('a stream with response_format refused → the stream again without it; sentences still arrive early', async () => {
  seen.length = 0;
  const agent = new LlmAgent(new OpenAICompatibleChat({ name: 'fake', baseUrl: fakeBase, apiKey: 'k', model: 'gemini-test', reasoningEffort: 'low' }));
  const sentences: string[] = [];
  const r = await agent.talkStream(input, (s) => sentences.push(s));
  assert.equal(r.source, undefined);
  assert.deepEqual(sentences, ['That sounds like a long day.', 'What is still with you?']);
  assert.deepEqual(seen.map((s) => `${s.stream}/${s.json}`), ['true/true', 'true/false']);
});

test('everything refused → the on-device fallback, and the server says so (never the model name)', async () => {
  refuseAll = true;
  try {
    const agent = new LlmAgent(new OpenAICompatibleChat({ name: 'OpenAI-compatible (gemini-test)', baseUrl: fakeBase, apiKey: 'secret-key-123', model: 'gemini-test' }));
    const app = createApp({ providers: { agent, stt: new SimulatedStt(), tts: null, simulated: { agent: false, stt: true } } });
    const base = await listen(app.server);
    const r = (await (await fetch(`${base}/api/talk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })).json()) as { agent: string };
    await close(app.server);
    assert.match(r.agent, /^on-device fallback \(LLM HTTP 400: Invalid argument/u);
    assert.ok(!r.agent.includes('secret-key-123'));
  } finally {
    refuseAll = false;
  }
});

test('the on-device listener never says a broken fragment back, and keeps no raw sentence in its summary', () => {
  assert.equal(cleanKey('I had a rough'), null);
  assert.equal(cleanKey('Deadline at work'), 'Deadline at work');
  assert.equal(cleanKey('The meeting'), 'The meeting');
  const r = deviceTalk({ text: 'I had a rough day with my boss', summary: '', turns: [], weights: [] }, () => ['I had a rough'], 0);
  assert.ok(!/I had a rough/u.test(r.reply), r.reply);
  assert.deepEqual(r.weights, []);
  assert.ok(!r.summary.includes('boss'), r.summary);
});
