// A FAKE OpenAI-compatible chat model for local latency tests of "Talk it through" (no network, no key).
// Timing modelled on the owner's live measures (25 Oct): a whole answer in 2.5 s; streamed, the first words after
// FIRST_MS (default 1000 ms, minimal reasoning) then ~60 characters per second.
//   node tools/talk/fake-llm.mjs [port=8796]
import { createServer } from 'node:http';
const port = Number(process.argv[2] ?? 8796);
const FIRST_MS = Number(process.env.FIRST_MS ?? 1000);
const WHOLE_MS = Number(process.env.WHOLE_MS ?? 2500);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const answer = JSON.stringify({
  reply: 'That sounds like a lot to carry tonight. What part of it is still with you right now?',
  weights: ['The long day'],
  summary: 'Talked about a long, heavy day.',
});
createServer(async (req, res) => {
  let b = '';
  for await (const c of req) b += c;
  const j = JSON.parse(b || '{}');
  console.log(JSON.stringify({ t: new Date().toISOString(), stream: j.stream === true, effort: j.reasoning_effort ?? null }));
  if (j.stream !== true) {
    await wait(WHOLE_MS);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: answer } }], usage: { total_tokens: 1200 } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  await wait(FIRST_MS);
  for (let i = 0; i < answer.length; i += 6) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer.slice(i, i + 6) } }] })}\n\n`);
    await wait(100);
  }
  res.end('data: [DONE]\n\n');
}).listen(port, '127.0.0.1', () => console.log(`fake chat model on http://127.0.0.1:${port}/v1`));
