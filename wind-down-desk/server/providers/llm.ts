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

  private body(messages: ChatMessage[], options: ChatOptions, stream: boolean): string {
    const effort = options.reasoningEffort ?? this.reasoningEffort;
    return JSON.stringify(
      portableBody({
        model: this.model,
        messages,
        temperature: 0.3,
        max_tokens: this.gemini ? Math.max(1024, options.maxTokens) : options.maxTokens,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
        ...(effort ? { reasoning_effort: effort } : {}),
        ...(stream ? { stream: true } : {}),
      }),
    );
  }

  /** Server-sent events of an OpenAI-compatible stream ("data: {choices:[{delta:{content}}]}", "data: [DONE]"). */
  async stream(messages: ChatMessage[], options: ChatOptions, onText: (soFar: string) => void): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: this.body(messages, options, true),
      });
      if (!response.ok || response.body == null) throw new Error(`LLM HTTP ${response.status}`);
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
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: this.body(messages, options, false),
      });
      if (!response.ok) {
        throw new Error(`LLM HTTP ${response.status}`);
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
