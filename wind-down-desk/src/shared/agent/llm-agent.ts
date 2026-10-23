/**
 * Agent backed by any chat model behind an OpenAI-compatible interface.
 * Every call is validated; on timeout, error or junk output it degrades to the
 * on-device agent, so the ritual never stalls on the network.
 */
import { extractJson, parseDrafts, parsePlan } from './parse.ts';
import { EXTRACT_SYSTEM, extractUser, PLAN_SYSTEM, planUser, SUMMARIZE_SYSTEM } from './prompts.ts';
import { cleanWeightTitle } from './weight.ts';
import { SimulatedAgent } from './simulated.ts';
import type { Agent, PlanInput, TomorrowPlan, WorryDraft } from './types.ts';

import { cleanSummary, crisisInModelText, crisisSignal, CRISIS_REPLY, TALK_SYSTEM } from './safety.ts';
import { parseTalkReply, partialReply, spokenSentences, talkUser, type TalkInput, type TalkReply } from './talk.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  json: boolean;
  maxTokens: number;
  /** Overrides the provider's reasoning effort for this call (Talk it through: "minimal" on Gemini). */
  reasoningEffort?: string;
}

export interface ChatProvider {
  readonly name: string;
  complete(messages: ChatMessage[], options: ChatOptions): Promise<string>;
  /** Streamed answer: `onText` receives the whole text so far, many times; resolves with the full text. */
  stream?(messages: ChatMessage[], options: ChatOptions, onText: (soFar: string) => void): Promise<string>;
}

export interface AgentStats {
  llmCalls: number;
  fallbacks: number;
  lastError: string | null;
}

export class LlmAgent implements Agent {
  readonly name: string;
  readonly stats: AgentStats = { llmCalls: 0, fallbacks: 0, lastError: null };
  private readonly provider: ChatProvider;
  private readonly fallback = new SimulatedAgent();

  private readonly talkEffort: string | undefined;

  /** `talkReasoningEffort`: reasoning for Talk it through turns (lower = the voice starts sooner). */
  constructor(provider: ChatProvider, options: { talkReasoningEffort?: string } = {}) {
    this.provider = provider;
    this.name = provider.name;
    this.talkEffort = options.talkReasoningEffort;
  }

  async extract(text: string, existing: string[] = []): Promise<WorryDraft[]> {
    // Never a stone, never a model call for a crisis sentence (the app shows help; safety.ts).
    if (crisisSignal(text)) return [];
    try {
      this.stats.llmCalls++;
      const raw = await this.provider.complete(
        [
          { role: 'system', content: EXTRACT_SYSTEM },
          { role: 'user', content: extractUser(text, existing) },
        ],
        { json: true, maxTokens: 500 },
      );
      const drafts = parseDrafts(raw, existing);
      if (drafts != null) {
        return drafts;
      }
      throw new Error('unparseable extraction');
    } catch (error) {
      this.noteFallback(error);
      return this.fallback.extract(text, existing);
    }
  }

  async plan(input: PlanInput): Promise<TomorrowPlan> {
    if (input.tomorrow.length === 0) {
      return this.fallback.plan(input);
    }
    try {
      this.stats.llmCalls++;
      const raw = await this.provider.complete(
        [
          { role: 'system', content: PLAN_SYSTEM },
          { role: 'user', content: planUser(input) },
        ],
        { json: true, maxTokens: 400 },
      );
      const plan = parsePlan(raw);
      if (plan != null) {
        return plan;
      }
      throw new Error('unparseable plan');
    } catch (error) {
      this.noteFallback(error);
      return this.fallback.plan(input);
    }
  }

  async summarize(text: string): Promise<string> {
    if (crisisSignal(text)) return 'A heavy night';
    try {
      this.stats.llmCalls++;
      const raw = await this.provider.complete(
        [
          { role: 'system', content: SUMMARIZE_SYSTEM },
          { role: 'user', content: `What weighs on them:\n"""${text.slice(0, 600)}"""` },
        ],
        { json: true, maxTokens: 60 },
      );
      // Gemini (and others) often fence the JSON in ```json … ```: the tolerant extractor, not JSON.parse (22 Oct).
      const parsed = (extractJson(raw) ?? {}) as { title?: unknown };
      return cleanWeightTitle(parsed.title, text);
    } catch (error) {
      this.noteFallback(error);
      return this.fallback.summarize(text);
    }
  }

  /** "Talk it through": crisis first (fixed answer, no call), then the model with a bounded history. */
  async talk(input: TalkInput): Promise<TalkReply> {
    if (crisisSignal(input.text)) return { reply: CRISIS_REPLY, weights: [], summary: cleanSummary(input.summary), crisis: true };
    try {
      this.stats.llmCalls++;
      const raw = await this.provider.complete(
        [
          { role: 'system', content: TALK_SYSTEM },
          { role: 'user', content: talkUser(input) },
        ],
        { json: true, maxTokens: 450, reasoningEffort: this.talkEffort },
      );
      const reply = parseTalkReply(raw, input);
      if (reply != null) return reply;
      throw new Error('unparseable talk reply');
    } catch (error) {
      this.noteFallback(error);
      return this.fallback.talk(input);
    }
  }

  /**
   * The same turn, streamed: each finished sentence of the reply goes to `onSentence` (and so to the voice) while
   * the model is still writing. Every sentence passes the second safety net first; one that touches a crisis stops
   * the flow, and the final answer (checked whole, reply and summary) decides.
   */
  async talkStream(input: TalkInput, onSentence: (sentence: string) => void): Promise<TalkReply> {
    if (crisisSignal(input.text) || this.provider.stream == null) {
      const r = await this.talk(input);
      if (!r.crisis) for (const s of spokenSentences(r.reply, true)) onSentence(s);
      return r;
    }
    let sent = 0;
    let stopped = false;
    try {
      this.stats.llmCalls++;
      const raw = await this.provider.stream(
        [
          { role: 'system', content: TALK_SYSTEM },
          { role: 'user', content: talkUser(input) },
        ],
        { json: true, maxTokens: 450, reasoningEffort: this.talkEffort },
        (soFar) => {
          if (stopped) return;
          const p = partialReply(soFar);
          if (p == null) return;
          const sentences = spokenSentences(p.text, p.closed);
          for (; sent < sentences.length; sent++) {
            if (crisisInModelText(sentences[sent])) {
              stopped = true;
              return;
            }
            onSentence(sentences[sent]);
          }
        },
      );
      const reply = parseTalkReply(raw, input);
      if (reply != null) return reply;
      throw new Error('unparseable talk reply');
    } catch (error) {
      this.noteFallback(error);
      const r = await this.fallback.talk(input);
      if (sent === 0 && !r.crisis) for (const s of spokenSentences(r.reply, true)) onSentence(s);
      return r;
    }
  }

  private noteFallback(error: unknown): void {
    this.stats.fallbacks++;
    this.stats.lastError = error instanceof Error ? error.message : String(error);
  }
}
