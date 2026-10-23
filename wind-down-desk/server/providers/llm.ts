/**
 * OpenAI-compatible chat completions over fetch (no SDK, no dependency).
 * Works with DeepSeek, Gemini (generativelanguage.googleapis.com/v1beta/openai) or any compatible endpoint.
 *
 * Gemini compatibility (lessons from Tourbook, qloo/tourbook/src/agent/llm.js, and the Gemini OpenAI page read on
 * 22 Oct 2026): non-OpenAI hosts answer 400 to `strict`, `additionalProperties` and `pattern` in JSON schemas and
 * to `content: null` messages -> portableBody() removes / replaces them. Gemini 3 models always think (reasoning
 * cannot be turned off; `reasoning_effort` minimal | low | medium | high) and the page does not say whether
 * `max_tokens` counts the thinking: on Gemini hosts max_tokens is never below 1024 so a short answer is not cut
 * to nothing. Any error, empty or null content -> the caller (LlmAgent) uses the on-device agent instead.
 */
import type { ChatMessage, ChatOptions, ChatProvider } from '../../src/shared/agent/llm-agent.ts';

export interface OpenAICompatibleOptions {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** LLM_REASONING_EFFORT (sent only when set). */
  reasoningEffort?: string;
  /** Called with prompt + completion tokens after each answer (daily token ceiling). */
  onUsage?: (tokens: number) => void;
}

const DROP_IN_SCHEMA = new Set(['strict', 'additionalProperties', 'pattern']);

/** A JSON schema without the keywords Gemini's OpenAI layer rejects (recursively). */
export function portableSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(portableSchema);
  if (value == null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!DROP_IN_SCHEMA.has(k)) out[k] = portableSchema(v);
  }
  return out;
}

/** Request body any OpenAI-compatible host accepts: schemas cleaned, null contents become ''. */
export function portableBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  if (Array.isArray(body.messages)) {
    out.messages = (body.messages as Array<Record<string, unknown>>).map((m) => (m != null && m.content == null ? { ...m, content: '' } : m));
  }
  if (body.response_format != null) out.response_format = portableSchema(body.response_format);
  if (Array.isArray(body.tools)) out.tools = portableSchema(body.tools);
  return out;
}

export function isGeminiHost(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'generativelanguage.googleapis.com';
  } catch {
    return false;
  }
}

/** Hosts this project must never call (owner decision: no Nebius credits). */
export const BLOCKED_HOSTS = [/nebius/iu];

export function assertAllowedBaseUrl(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid LLM base URL: ${baseUrl}`);
  }
  if (BLOCKED_HOSTS.some((re) => re.test(url.hostname))) {
    throw new Error(`LLM host ${url.hostname} is blocked by project policy.`);
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('LLM base URL must use HTTPS (except localhost).');
  }
}

export class OpenAICompatibleChat implements ChatProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly reasoningEffort: string | undefined;
  private readonly onUsage: ((tokens: number) => void) | undefined;
  private readonly gemini: boolean;

  constructor(options: OpenAICompatibleOptions) {
    assertAllowedBaseUrl(options.baseUrl);
    this.name = options.name;
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.reasoningEffort = options.reasoningEffort;
    this.onUsage = options.onUsage;
    // Gemini by host, or by model name (a proxy in front of Gemini, the local fake in tests).
    this.gemini = isGeminiHost(options.baseUrl) || /^gemini/iu.test(options.model);
  }

  /** Parameters the provider refused once (HTTP 400): never sent again by this process (25 Oct). */
  private readonly rejectedEfforts = new Set<string>();
  private streamJsonRejected = false;
  private streamRejected = false;
  /** Last provider refusal, for the server log and the health view (status + provider message, never a key). */
  lastProviderError: string | null = null;

  private body(messages: ChatMessage[], options: ChatOptions, stream: boolean, effort: string | undefined, json: boolean): string {
    return JSON.stringify(
      portableBody({
        model: this.model,
        messages,
        temperature: 0.3,
        max_tokens: this.gemini ? Math.max(1024, options.maxTokens) : options.maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        ...(effort ? { reasoning_effort: effort } : {}),
        ...(stream ? { stream: true } : {}),
      }),
    );
  }

  /**
   * POST with adaptation (25 Oct, live regression: a parameter refused with HTTP 400 silently sent every turn to the
   * on-device fallback). On a 400 it retries once per step — the call's own reasoning effort → the provider's
   * default effort → no reasoning effort → (streamed) no response_format — and remembers what was refused, so the
   * rest of the process sends the combination that works. Each refusal is logged: status + provider message only.
   */
  private async post(messages: ChatMessage[], options: ChatOptions, stream: boolean, signal: AbortSignal): Promise<Response> {
    let effort = options.reasoningEffort ?? this.reasoningEffort;
    if (effort != null && this.rejectedEfforts.has(effort)) effort = this.reasoningEffort != null && !this.rejectedEfforts.has(this.reasoningEffort) ? this.reasoningEffort : undefined;
    let json = options.json && !(stream && this.streamJsonRejected);
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: this.body(messages, options, stream, effort, json),
      });
      if (response.status !== 400 || attempt >= 3) return response;
      const why = await providerMessage(response);
      this.lastProviderError = `HTTP 400: ${why}`;
      // Drop first what the message names (reasoning / response_format), else the reasoning effort, else the format.
      const aboutFormat = /response_format|json|schema|mime/iu.test(why);
      const aboutEffort = /reasoning|effort|minimal|thinking/iu.test(why);
      if (stream && json && aboutFormat && !aboutEffort) {
        this.streamJsonRejected = true;
        json = false;
        console.error(`[wdd-llm] ${this.name}: HTTP 400 (${why}) → retry the stream without response_format`);
      } else if (effort != null) {
        this.rejectedEfforts.add(effort);
        const next = this.reasoningEffort != null && !this.rejectedEfforts.has(this.reasoningEffort) ? this.reasoningEffort : undefined;
        console.error(`[wdd-llm] ${this.name}: HTTP 400 (${why}) → retry with reasoning_effort ${next ?? 'none'}`);
        effort = next;
      } else if (stream && json) {
        this.streamJsonRejected = true;
        json = false;
        console.error(`[wdd-llm] ${this.name}: HTTP 400 (${why}) → retry the stream without response_format`);
      } else {
        console.error(`[wdd-llm] ${this.name}: HTTP 400 (${why})`);
        return new Response(JSON.stringify({ error: { message: why } }), { status: 400 });
      }
    }
  }

  /** Server-sent events of an OpenAI-compatible stream ("data: {choices:[{delta:{content}}]}", "data: [DONE]"). */
  async stream(messages: ChatMessage[], options: ChatOptions, onText: (soFar: string) => void): Promise<string> {
    if (this.streamRejected) {
      const whole = await this.complete(messages, options);
      onText(whole);
      return whole;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.post(messages, options, true, controller.signal);
      if (response.status === 400) {
        // Streaming itself refused: the whole answer at once from now on.
        this.streamRejected = true;
        console.error(`[wdd-llm] ${this.name}: streaming refused → whole answers from now on`);
        clearTimeout(timer);
        const whole = await this.complete(messages, options);
        onText(whole);
        return whole;
      }
      if (!response.ok || response.body == null) throw new Error(`LLM HTTP ${response.status}: ${await providerMessage(response)}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      let used = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const j = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string | null } }>; usage?: { total_tokens?: number } };
            const piece = j.choices?.[0]?.delta?.content;
            if (typeof piece === 'string' && piece.length > 0) {
              text += piece;
              onText(text);
            }
            if (j.usage?.total_tokens != null) used = j.usage.total_tokens;
          } catch {
            // A keep-alive or a partial line: ignored.
          }
        }
      }
      this.onUsage?.(used > 0 ? used : 1500);
      if (text.length === 0) throw new Error('LLM returned no content');
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  async complete(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.post(messages, options, false, controller.signal);
      if (!response.ok) {
        throw new Error(`LLM HTTP ${response.status}: ${await providerMessage(response)}`);
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const used = body.usage?.total_tokens ?? (body.usage?.prompt_tokens ?? 0) + (body.usage?.completion_tokens ?? 0);
      // No usage reported: count the request at a high guess, so the daily token cap is never reached late.
      this.onUsage?.(used > 0 ? used : 1500);
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        throw new Error('LLM returned no content');
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * The provider's error message, safe to log: at most 160 characters, no key-like token, no long quoted text (a
 * provider could echo part of a request).
 */
export async function providerMessage(response: Response): Promise<string> {
  let raw = '';
  try {
    raw = await response.text();
  } catch {
    return 'no message';
  }
  let msg = raw;
  try {
    // OpenAI shape { error: { message } }; Gemini's OpenAI layer answers [ { error: { message } } ].
    const j = JSON.parse(raw) as unknown;
    const first = Array.isArray(j) ? (j[0] as { error?: { message?: unknown } } | undefined) : (j as { error?: { message?: unknown } });
    const m = first?.error?.message;
    if (typeof m === 'string') msg = m;
  } catch {
    // Not JSON: the raw text.
  }
  return msg
    .replace(/AIza[0-9A-Za-z_-]{10,}|sk-[A-Za-z0-9]{10,}|gsk_[A-Za-z0-9]{10,}|Bearer\s+\S+/gu, '[key]')
    .replace(/"[^"]{30,}"/gu, '"…"')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 160) || 'no message';
}
