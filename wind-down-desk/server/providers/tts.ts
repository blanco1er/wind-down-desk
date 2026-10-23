/**
 * Text-to-speech for the lamp's dynamic voice ("Talk it through", 24 Oct). One small interface, one provider (owner
 * decision 24 Oct: Gemini TTS only; the interface stays so another can be added later without touching the app).
 *
 * Gemini TTS, Interactions API (doc https://ai.google.dev/gemini-api/docs/speech-generation, updated 2026-10-12, read
 * 24 Oct; request shape identical to the owner's working test meta-vr/test-voix-gemini.sh):
 *   POST {base}/interactions, header x-goog-api-key (server side only, never sent to the browser)
 *   { model, input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata",
 *     style }] }] }], response_format: { type: "audio" }, generation_config: { speech_config: [{ voice }] },
 *     stream: true }
 *   events: event_type "step.delta" with delta.type "audio", delta.data = base64 of raw PCM16 LE, 24 kHz, mono.
 * The page does not show the wire framing of the stream [NOT VERIFIED]: the reader accepts SSE ("data: {...}"),
 * newline-delimited JSON and a JSON array, and a non-streamed answer (steps[].content[].data, a WAV whose header is
 * dropped). Errors never contain the key.
 */

export interface TtsProvider {
  readonly name: string;
  /** Raw PCM16 LE, 24 kHz, mono, chunk by chunk. Throws before the first chunk on any provider error. */
  stream(text: string, options: { style: string; signal?: AbortSignal }): AsyncGenerator<Uint8Array>;
}

export const TTS_SAMPLE_RATE = 24_000;
/** Bytes per second of PCM16 mono 24 kHz (for the daily seconds budget). */
export const TTS_BYTES_PER_SECOND = TTS_SAMPLE_RATE * 2;
export const DEFAULT_TTS_MODEL = 'gemini-3.8-flash-lite-tts';
export const DEFAULT_TTS_VOICE = 'Achernar';
export const DEFAULT_TTS_STYLE = 'soft, warm, almost whispered, slow and calm, like a quiet friend late at night';

export interface GeminiTtsOptions {
  apiKey: string;
  model?: string;
  voice?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Pulls every complete JSON object out of a growing text buffer (SSE, NDJSON or a JSON array); returns the rest. */
export function drainJsonObjects(buffer: string, out: unknown[]): string {
  let i = 0;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let consumed = 0;
  for (; i < buffer.length; i++) {
    const c = buffer[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      if (depth > 0) inString = true;
      continue;
    }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(buffer.slice(start, i + 1)));
        } catch {
          // A fragment that only looked like an object: skipped.
        }
        consumed = i + 1;
        start = -1;
      }
    }
  }
  // An object still open is kept whole for the next read; text between objects ("data: ", commas) is dropped.
  return depth > 0 && start >= 0 ? buffer.slice(start) : buffer.slice(consumed);
}

/** Audio bytes carried by one event (streamed delta) or by a whole non-streamed answer. */
export function audioOf(event: unknown): Uint8Array[] {
  const e = event as { event_type?: string; delta?: { type?: string; data?: string }; steps?: Array<{ content?: Array<{ type?: string; data?: string }> }> };
  if (e?.event_type === 'step.delta' && e.delta?.type === 'audio' && typeof e.delta.data === 'string') {
    return [Buffer.from(e.delta.data, 'base64')];
  }
  if (Array.isArray(e?.steps)) {
    const out: Uint8Array[] = [];
    for (const step of e.steps) {
      for (const c of step.content ?? []) {
        if (c.type === 'audio' && typeof c.data === 'string') out.push(stripWav(Buffer.from(c.data, 'base64')));
      }
    }
    return out;
  }
  return [];
}

/** A RIFF/WAVE file → its PCM data chunk (the non-streamed answer is a WAV). */
export function stripWav(bytes: Buffer): Buffer {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return bytes;
  let p = 12;
  while (p + 8 <= bytes.length) {
    const id = bytes.toString('ascii', p, p + 4);
    const size = bytes.readUInt32LE(p + 4);
    if (id === 'data') return bytes.subarray(p + 8, Math.min(bytes.length, p + 8 + size));
    p += 8 + size + (size % 2);
  }
  return bytes.subarray(44);
}

export class GeminiTts implements TtsProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voice: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: GeminiTtsOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_TTS_MODEL;
    this.voice = options.voice ?? DEFAULT_TTS_VOICE;
    this.baseUrl = (options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/u, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.name = `Gemini TTS (${this.model}, ${this.voice})`;
  }

  async *stream(text: string, options: { style: string; signal?: AbortSignal }): AsyncGenerator<Uint8Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    options.signal?.addEventListener('abort', () => controller.abort());
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/interactions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'x-goog-api-key': this.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: options.style }] }] }],
          response_format: { type: 'audio' },
          generation_config: { speech_config: [{ voice: this.voice }] },
          stream: true,
        }),
      });
      if (!res.ok || res.body == null) {
        // The status only: a provider error body can echo request details.
        throw new Error(`TTS provider answered ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let odd: Uint8Array | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events: unknown[] = [];
        buffer = drainJsonObjects(buffer, events);
        for (const ev of events) {
          for (let chunk of audioOf(ev)) {
            // Keep samples whole (16-bit) across chunks.
            if (odd != null) {
              const joined = new Uint8Array(odd.length + chunk.length);
              joined.set(odd);
              joined.set(chunk, odd.length);
              chunk = joined;
              odd = null;
            }
            if (chunk.length % 2 === 1) {
              odd = chunk.subarray(chunk.length - 1);
              chunk = chunk.subarray(0, chunk.length - 1);
            }
            if (chunk.length > 0) yield chunk;
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/** TTS from the environment: TTS_API_KEY, or the Gemini LLM key when the LLM is Gemini. None → captions only. */
export function ttsFromEnv(env: Record<string, string | undefined>, fetchImpl?: typeof fetch): TtsProvider | null {
  if (env.WDD_FORCE_SIMULATED === '1' || env.TTS_PROVIDER === 'none') return null;
  const geminiLlm = (env.LLM_BASE_URL ?? '').includes('generativelanguage.googleapis.com');
  const key = env.TTS_API_KEY || (geminiLlm ? env.LLM_API_KEY : undefined);
  if (!key) return null;
  return new GeminiTts({
    apiKey: key,
    model: env.TTS_MODEL || DEFAULT_TTS_MODEL,
    voice: env.TTS_VOICE || DEFAULT_TTS_VOICE,
    baseUrl: env.TTS_BASE_URL || undefined,
    fetchImpl,
    timeoutMs: Number(env.TTS_TIMEOUT_MS) > 0 ? Number(env.TTS_TIMEOUT_MS) : undefined,
  });
}
