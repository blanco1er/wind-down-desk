/**
 * Agent contracts shared by the Node server and the in-browser fallback.
 * The agent never acts on its own: it proposes tokens, bin suggestions and a
 * plan; the user confirms each with a pinch or a word.
 */
import type { BinId } from '../../logic/desk-layout.ts';
import type { TalkInput, TalkReply } from './talk.ts';

export interface WorryDraft {
  /** Short label printed on the stone (≤ 28 chars). */
  title: string;
  /** What the user actually said, kept for the plan. */
  detail: string;
  /** Suggested bin, shown as a faint coloured rim. Never applied automatically. */
  suggestion: BinId;
  /** One short reason, for the curious (≤ 70 chars). */
  why: string;
}

export interface PlanStep {
  /** The Tomorrow token this step belongs to. */
  title: string;
  /** A first, tiny, concrete action (≤ 60 chars). */
  step: string;
  /** Suggested moment, e.g. "09:30". */
  when: string;
  minutes: number;
}

export interface TomorrowPlan {
  steps: PlanStep[];
  /** One warm, non-cheesy closing line (≤ 90 chars). */
  note: string;
}

export interface PlanInput {
  tomorrow: Array<{ title: string; detail?: string }>;
  later: string[];
  letGoCount: number;
  /** Ask for a lighter version (fewer, smaller steps). */
  lighter?: boolean;
  /** Preferred start of the day, "HH:MM". */
  startAt?: string;
}

export interface Agent {
  readonly name: string;
  /** Turns a spoken brain dump into tokens. `existing` avoids duplicates. */
  extract(text: string, existing?: string[]): Promise<WorryDraft[]>;
  plan(input: PlanInput): Promise<TomorrowPlan>;
  /** Release: what weighs on them → the few words engraved on the dark stone (≤ 4 words). */
  summarize(text: string): Promise<string>;
  /** "Talk it through": one turn of a free conversation (bounded history, safety first; talk.ts). */
  talk(input: TalkInput): Promise<TalkReply>;
  /** The same turn, each finished sentence of the reply given as soon as it is written (lower voice latency). */
  talkStream?(input: TalkInput, onSentence: (sentence: string) => void): Promise<TalkReply>;
}

export const LIMITS = {
  maxTokensPerUtterance: 6,
  titleChars: 28,
  whyChars: 70,
  stepChars: 60,
  noteChars: 90,
  maxSteps: 3,
  maxInputChars: 2000,
} as const;
