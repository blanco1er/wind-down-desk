// A FAKE Gemini TTS server for local end-to-end tests of "Talk it through" (no network, no key, no paid call).
// Answers POST /v1beta/interactions like the documented stream: SSE events "step.delta" carrying base64 PCM16 24 kHz
// mono, after ~0.6 s of "latency"; the sound is a soft voice-like hum (pitch glide + syllable envelope) whose length
// follows the text (~12 characters per second). Logs each request's model, voice, style and text length.
//   node tools/talk/fake-gemini-tts.mjs [port=8795]
// then: TTS_API_KEY=fake-local TTS_BASE_URL=http://127.0.0.1:8795/v1beta npm run server
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8795);
const RATE = 24_000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function hum(seconds) {
  const n = Math.round(seconds * RATE);
  const pcm = Buffer.alloc(n * 2);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = 170 + 25 * Math.sin(t * 1.3) + 12 * Math.sin(t * 5.1);
    phase += (2 * Math.PI * f) / RATE;
    const syll = Math.max(0, Math.sin(t * Math.PI * 4.2)) ** 0.6;
    const fade = Math.min(1, t * 6, (seconds - t) * 6);
    const v = (Math.sin(phase) * 0.6 + Math.sin(phase * 2) * 0.25 + Math.sin(phase * 3) * 0.1) * syll * fade * 0.22;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2);
  }
  return pcm;
}

createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  let j = {};
  try {
    j = JSON.parse(body);
  } catch {}
  const text = j.input?.[0]?.content?.[0]?.text ?? '';
  console.log(JSON.stringify({ t: new Date().toISOString(), model: j.model, voice: j.generation_config?.speech_config?.[0]?.voice, style: j.input?.[0]?.content?.[0]?.annotations?.[0]?.style, chars: text.length, stream: j.stream, key: req.headers['x-goog-api-key'] ? 'present' : 'missing' }));
  const pcm = hum(Math.max(1, Math.min(12, text.length / 12)));
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  // First byte after FIRST_MS (default 1320 ms: the owner's live measure of 25 Oct).
  await wait(Number(process.env.FIRST_MS ?? 1320));
  const step = RATE * 2 * 0.25;
  for (let i = 0; i < pcm.length; i += step) {
    res.write(`event: step.delta\ndata: ${JSON.stringify({ event_type: 'step.delta', delta: { type: 'audio', data: pcm.subarray(i, i + step).toString('base64') } })}\n\n`);
    await wait(30);
  }
  res.end(`data: ${JSON.stringify({ event_type: 'interaction.complete' })}\n\n`);
}).listen(port, '127.0.0.1', () => console.log(`fake Gemini TTS on http://127.0.0.1:${port}/v1beta`));
