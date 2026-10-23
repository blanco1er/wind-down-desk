/**
 * Lower latency (25 Oct): /api/talk streamed against a FAKE OpenAI-compatible model that writes its JSON slowly
 * (no network, no key). The first sentence must reach the client long before the whole answer; the second safety
 * net must stop a sentence that touches a crisis from ever being voiced.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp } from '../server/app.ts';
import { OpenAICompatibleChat } from '../server/providers/llm.ts';
import { SimulatedStt } from '../server/providers/stt.ts';
import { LlmAgent } from '../src/shared/agent/llm-agent.ts';

const listen = (server: Server) =>
  new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let answer = '';
let lastBody: Record<string, unknown> = {};
const model = createServer(async (req, res) => {
  let b = '';
  for await (const c of req) b += c;
  lastBody = JSON.parse(b);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (let i = 0; i < answer.length; i += 12) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer.slice(i, i + 12) } }] })}\n\n`);
    await wait(40);
  }
  res.end('data: [DONE]\n\n');
});
let base = '';
let app: ReturnType<typeof createApp>;
before(async () => {
  const modelBase = await listen(model);
  const agent = new LlmAgent(new OpenAICompatibleChat({ name: 'fake', baseUrl: modelBase, apiKey: 'k', model: 'gemini-test' }), { talkReasoningEffort: 'minimal' });
  app = createApp({ providers: { agent, stt: new SimulatedStt(), tts: null, simulated: { agent: false, stt: true } } });
  base = await listen(app.server);
});
after(async () => {
  await close(model);
  await close(app.server);
});

async function streamTalk(text: string): Promise<{ events: Array<{ type: string; text?: string; crisis?: boolean; summary?: string; at: number }> }> {
  const t0 = Date.now();
  const res = await fetch(`${base}/api/talk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, summary: '', turns: [], weights: [], stream: true }) });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: Array<{ type: string; text?: string; crisis?: boolean; summary?: string; at: number }> = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const line = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      if (line.startsWith('data:')) events.push({ ...JSON.parse(line.slice(5)), at: Date.now() - t0 });
    }
  }
  return { events };
}

test('the first sentence arrives while the model is still writing; "minimal" reasoning is asked for the talk', async () => {
  answer = '{"reply":"That sounds like a long day. What part of it is still with you now?","weights":["The long day"],"summary":"A long day at work."}';
  const { events } = await streamTalk('Today was so long at work.');
  const first = events.find((e) => e.type === 'sentence');
  const done = events.find((e) => e.type === 'done');
  assert.equal(first?.text, 'That sounds like a long day.');
  assert.ok(first != null && done != null && done.at - first.at > 200, `first at ${first?.at} ms, done at ${done?.at} ms`);
  assert.equal(events.filter((e) => e.type === 'sentence').length, 2);
  assert.equal(lastBody.stream, true);
  assert.equal(lastBody.reasoning_effort, 'minimal');
});

test('a sentence touching a crisis is never voiced; the whole answer is a crisis with a clean summary', async () => {
  answer = '{"reply":"I hear how heavy this is. Please let a person help you right now.","weights":[],"summary":"Tired. Expressed thoughts of ending their life."}';
  const { events } = await streamTalk('it is all too much tonight');
  assert.deepEqual(events.filter((e) => e.type === 'sentence').map((e) => e.text), ['I hear how heavy this is.']);
  const done = events.find((e) => e.type === 'done');
  assert.equal(done?.crisis, true);
  assert.equal(done?.summary, '');
});
