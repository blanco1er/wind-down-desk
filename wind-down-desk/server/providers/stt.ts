/**
 * Server-side speech-to-text behind one interface.
 * - SimulatedStt (default): no network, deterministic, clearly labelled.
 * - OpenAICompatibleStt: `/audio/transcriptions` (Whisper-style) when
 *   STT_BASE_URL + STT_API_KEY are set in the environment. Never configured
 *   by default, never called by tests.
 */
import { DEMO_BRAIN_DUMP } from '../../src/shared/agent/demo.ts';
import { assertAllowedBaseUrl } from './llm.ts';

export { DEMO_BRAIN_DUMP };

export interface Transcript {
  text: string;
  provider: string;
  simulated: boolean;
}

export interface SttProvider {
  readonly name: string;
  transcribe(audio: Uint8Array, mimeType: string, options?: { hint?: string; sessionId?: string }): Promise<Transcript>;
}

export class SimulatedStt implements SttProvider {
  readonly name = 'simulated';
  private readonly served = new Set<string>();

  async transcribe(audio: Uint8Array, _mimeType: string, options: { hint?: string; sessionId?: string } = {}): Promise<Transcript> {
    if (options.hint != null && options.hint.trim().length > 0) {
      return { text: options.hint.trim().slice(0, 2000), provider: this.name, simulated: true };
    }
    if (audio.byteLength < 1000) {
      return { text: '', provider: this.name, simulated: true };
    }
    // First real utterance of a session gets the scripted brain dump, then silence:
    // the simulated provider cannot know what was said and must not pretend to.
    const key = options.sessionId ?? 'default';
    if (this.served.has(key)) {
      return { text: '', provider: this.name, simulated: true };
    }
    this.served.add(key);
    return { text: DEMO_BRAIN_DUMP, provider: this.name, simulated: true };
  }
}

export interface OpenAICompatibleSttOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  language?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class OpenAICompatibleStt implements SttProvider {
  readonly name: string;
  private readonly options: OpenAICompatibleSttOptions;

  constructor(options: OpenAICompatibleSttOptions) {
    assertAllowedBaseUrl(options.baseUrl);
    this.options = options;
    this.name = `openai-compatible (${new URL(options.baseUrl).hostname})`;
  }

  async transcribe(audio: Uint8Array, mimeType: string): Promise<Transcript> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    try {
      const form = new FormData();
      const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : mimeType.includes('mp4') ? 'm4a' : 'webm';
      form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), `utterance.${ext}`);
      form.append('model', this.options.model);
      form.append('language', this.options.language ?? 'en');
      const response = await (this.options.fetchImpl ?? fetch)(`${this.options.baseUrl.replace(/\/+$/u, '')}/audio/transcriptions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.options.apiKey}` },
        body: form,
      });
      if (!response.ok) {
        throw new Error(`STT HTTP ${response.status}`);
      }
      const body = (await response.json()) as { text?: string };
      return { text: (body.text ?? '').trim(), provider: this.name, simulated: false };
    } finally {
      clearTimeout(timer);
    }
  }
}
