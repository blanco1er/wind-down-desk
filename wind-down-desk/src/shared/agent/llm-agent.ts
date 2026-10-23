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

import { cleanSummary, crisisSignal, CRISIS_REPLY, TALK_SYSTEM } from './safety.ts';
import { parseTalkReply, talkUser, type TalkInput, type TalkReply } from './talk.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatProvider {
  readonly name: string;
  complete(messages: ChatMessage[], options: { json: boolean; maxTokens: number }): Promise<string>;
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

  constructor(provider: ChatProvider) {
    this.provider = provider;
    this.name = provider.name;
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
        { json: true, maxTokens: 450 },
      );
      const reply = parseTalkReply(raw, input);
      if (reply != null) return reply;
      throw new Error('unparseable talk reply');
    } catch (error) {
      this.noteFallback(error);
      return this.fallback.talk(input);
    }
  }

  private noteFallback(error: unknown): void {
    this.stats.fallbacks++;
    this.stats.lastError = error instanceof Error ? error.message : String(error);
  }
}
