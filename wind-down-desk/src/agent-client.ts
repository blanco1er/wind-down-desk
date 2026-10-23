/**
 * Browser side of the agent: talks to the local Node server when it is there
 * (/api, proxied by Vite in dev, or VITE_WDD_API), otherwise runs the same
 * on-device agent. The ritual never waits more than a few seconds.
 */
import { SimulatedAgent } from './shared/agent/simulated.ts';
import type { PlanInput, TomorrowPlan, WorryDraft } from './shared/agent/types.ts';
import { boundTurns, spokenSentences, type TalkInput, type TalkReply } from './shared/agent/talk.ts';

export interface AgentStatus {
  mode: 'server' | 'device';
  agent: string;
  stt: string;
  simulated: boolean;
}

const API = ((import.meta.env.VITE_WDD_API as string | undefined) ?? '/api').replace(/\/+$/u, '');

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export class AgentClient {
  status: AgentStatus = { mode: 'device', agent: 'on-device (simulated)', stt: 'none', simulated: true };
  private readonly local = new SimulatedAgent();
  private readonly session = Math.random().toString(36).slice(2, 10);

  async init(): Promise<AgentStatus> {
    try {
      const health = await withTimeout(1500, async (signal) => {
        const res = await fetch(`${API}/health`, { signal });
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        return (await res.json()) as { agent: string; stt: string; simulated: { agent: boolean; stt: boolean } };
      });
      this.status = { mode: 'server', agent: health.agent, stt: health.stt, simulated: health.simulated.agent };
    } catch {
      this.status = { mode: 'device', agent: this.local.name, stt: 'none', simulated: true };
    }
    return this.status;
  }

  async extract(text: string, existing: string[]): Promise<WorryDraft[]> {
    if (this.status.mode === 'server') {
      try {
        return await withTimeout(9000, async (signal) => {
          const res = await fetch(`${API}/extract`, {
            method: 'POST',
            signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, existing }),
          });
          if (!res.ok) {
            throw new Error(String(res.status));
          }
          return ((await res.json()) as { tokens: WorryDraft[] }).tokens;
        });
      } catch {
        // fall through to on-device
      }
    }
    return this.local.extract(text, existing);
  }

  async plan(input: PlanInput): Promise<TomorrowPlan> {
    if (this.status.mode === 'server') {
      try {
        return await withTimeout(9000, async (signal) => {
          const res = await fetch(`${API}/plan`, {
            method: 'POST',
            signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
          });
          if (!res.ok) {
            throw new Error(String(res.status));
          }
          return ((await res.json()) as { plan: TomorrowPlan }).plan;
        });
      } catch {
        // fall through
      }
    }
    return this.local.plan(input);
  }

  /** Release: the engraving for the dark stone (server model when there is one, validated; else on device). */
  async summarize(text: string): Promise<string> {
    if (this.status.mode === 'server') {
      try {
        return await withTimeout(6000, async (signal) => {
          const res = await fetch(`${API}/summarize`, {
            method: 'POST',
            signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
          });
          if (!res.ok) {
            throw new Error(String(res.status));
          }
          return ((await res.json()) as { title: string }).title;
        });
      } catch {
        // fall through to on-device
      }
    }
    return this.local.summarize(text);
  }

  /** "Talk it through": one turn (server model when reachable, else the on-device listener; safety first in both). */
  async talk(input: TalkInput): Promise<TalkReply> {
    if (this.status.mode === 'server') {
      try {
        return await withTimeout(12_000, async (signal) => {
          const res = await fetch(`${API}/talk`, {
            method: 'POST',
            signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...input, turns: boundTurns(input.turns) }),
          });
          if (!res.ok) {
            throw new Error(String(res.status));
          }
          return (await res.json()) as TalkReply;
        });
      } catch {
        // fall through to on-device
      }
    }
    return this.local.talk(input);
  }

  /**
   * The same turn, streamed (25 Oct, lower voice latency): each finished sentence arrives as soon as the model has
   * written it; resolves with the checked whole answer. Falls back to the on-device listener.
   */
  async talkStream(input: TalkInput, onSentence: (sentence: string) => void): Promise<TalkReply> {
    if (this.status.mode === 'server') {
      let sentences = 0;
      try {
        return await withTimeout(15_000, async (signal) => {
          const res = await fetch(`${API}/talk`, {
            method: 'POST',
            signal,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...input, turns: boundTurns(input.turns), stream: true }),
          });
          if (!res.ok || res.body == null) throw new Error(String(res.status));
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let cut: number;
            while ((cut = buffer.indexOf('\n\n')) >= 0) {
              const line = buffer.slice(0, cut).trim();
              buffer = buffer.slice(cut + 2);
              if (!line.startsWith('data:')) continue;
              const event = JSON.parse(line.slice(5)) as { type: string; text?: string } & TalkReply;
              if (event.type === 'sentence' && typeof event.text === 'string') {
                sentences++;
                onSentence(event.text);
              } else if (event.type === 'done') return event;
            }
          }
          throw new Error('stream ended without an answer');
        });
      } catch {
        // Fall through to the on-device listener (only speak its words if nothing was said yet).
        const r = await this.local.talk(input);
        if (sentences === 0 && !r.crisis) for (const s of spokenSentences(r.reply, true)) onSentence(s);
        return r;
      }
    }
    return this.local.talkStream(input, onSentence);
  }

  /** 26 Oct (safety nets): how the last transcription went (no server at all, a failure, or fine). */
  lastTranscribe: 'ok' | 'failed' | 'no-server' = 'ok';

  /** Server-side transcription. Returns null when no server is reachable. */
  async transcribe(audio: Blob): Promise<string | null> {
    if (this.status.mode !== 'server') {
      this.lastTranscribe = 'no-server';
      return null;
    }
    try {
      const text = await withTimeout(12_000, async (signal) => {
        const res = await fetch(`${API}/transcribe`, {
          method: 'POST',
          signal,
          headers: { 'content-type': audio.type || 'audio/webm', 'x-wdd-session': this.session },
          body: audio,
        });
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        return ((await res.json()) as { text: string }).text;
      });
      this.lastTranscribe = 'ok';
      return text;
    } catch {
      this.lastTranscribe = 'failed';
      return null;
    }
  }
}
