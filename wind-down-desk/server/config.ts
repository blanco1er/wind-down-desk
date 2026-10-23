/**
 * Provider selection from the environment. No secrets live in files.
 *
 * LLM (first match wins):
 *   DEEPSEEK_API_KEY                 → DeepSeek (https://api.deepseek.com, model deepseek-chat or DEEPSEEK_MODEL)
 *   LLM_BASE_URL + LLM_API_KEY       → any OpenAI-compatible endpoint (LLM_MODEL, LLM_REASONING_EFFORT, LLM_TIMEOUT_MS),
 *                                      e.g. Gemini: https://generativelanguage.googleapis.com/v1beta/openai
 *   otherwise                        → on-device simulated agent (no network)
 * STT:
 *   STT_BASE_URL + STT_API_KEY       → OpenAI-compatible /audio/transcriptions (STT_MODEL, default whisper-1),
 *                                      e.g. Groq: https://api.groq.com/openai/v1 + whisper-large-v3-turbo
 *   otherwise                        → simulated
 * WDD_FORCE_SIMULATED=1 forces both to simulated (tests, offline demos).
 * Nebius hosts are refused (project policy).
 */
import { LlmAgent } from '../src/shared/agent/llm-agent.ts';
import { SimulatedAgent } from '../src/shared/agent/simulated.ts';
import type { Agent } from '../src/shared/agent/types.ts';
import { OpenAICompatibleChat } from './providers/llm.ts';
import { OpenAICompatibleStt, SimulatedStt, type SttProvider } from './providers/stt.ts';
import { ttsFromEnv, type TtsProvider } from './providers/tts.ts';

export type Env = Record<string, string | undefined>;

export interface Providers {
  agent: Agent;
  stt: SttProvider;
  /** The lamp's dynamic voice ("Talk it through"); null → captions only (and the fixed recorded lines). */
  tts?: TtsProvider | null;
  simulated: { agent: boolean; stt: boolean };
}

export function resolveProviders(env: Env, hooks: { onUsage?: (tokens: number) => void } = {}): Providers {
  const forceSimulated = env.WDD_FORCE_SIMULATED === '1';
  let agent: Agent = new SimulatedAgent();
  let simulatedAgent = true;
  if (!forceSimulated && env.DEEPSEEK_API_KEY) {
    agent = new LlmAgent(
      new OpenAICompatibleChat({
        name: `DeepSeek (${env.DEEPSEEK_MODEL ?? 'deepseek-chat'})`,
        baseUrl: env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
        apiKey: env.DEEPSEEK_API_KEY,
        model: env.DEEPSEEK_MODEL ?? 'deepseek-chat',
        onUsage: hooks.onUsage,
      }),
    );
    simulatedAgent = false;
  } else if (!forceSimulated && env.LLM_BASE_URL && env.LLM_API_KEY) {
    // Talk it through: its own reasoning effort only when set (LLM_TALK_REASONING_EFFORT); otherwise the same as the
    // rest (LLM_REASONING_EFFORT, "low" on Render). 25 Oct: "minimal" by default sent every turn to the fallback live;
    // it stays off until proven, and a refused value is now dropped automatically (llm.ts).
    const talkEffort = env.LLM_TALK_REASONING_EFFORT || undefined;
    agent = new LlmAgent(
      new OpenAICompatibleChat({
        name: `OpenAI-compatible (${env.LLM_MODEL ?? 'default'})`,
        baseUrl: env.LLM_BASE_URL,
        apiKey: env.LLM_API_KEY,
        model: env.LLM_MODEL ?? 'gpt-4o-mini',
        reasoningEffort: env.LLM_REASONING_EFFORT || undefined,
        timeoutMs: Number(env.LLM_TIMEOUT_MS) > 0 ? Number(env.LLM_TIMEOUT_MS) : undefined,
        onUsage: hooks.onUsage,
      }),
      { talkReasoningEffort: talkEffort },
    );
    simulatedAgent = false;
  }
  let stt: SttProvider = new SimulatedStt();
  let simulatedStt = true;
  if (!forceSimulated && env.STT_BASE_URL && env.STT_API_KEY) {
    stt = new OpenAICompatibleStt({
      baseUrl: env.STT_BASE_URL,
      apiKey: env.STT_API_KEY,
      model: env.STT_MODEL ?? 'whisper-1',
      language: env.STT_LANGUAGE ?? 'en',
    });
    simulatedStt = false;
  }
  return { agent, stt, tts: ttsFromEnv(env), simulated: { agent: simulatedAgent, stt: simulatedStt } };
}
