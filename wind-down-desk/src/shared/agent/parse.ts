/**
 * Defensive parsing of LLM output (pure, unit-tested).
 * Models wrap JSON in prose or code fences, invent fields, overflow limits:
 * everything is validated, clamped and de-duplicated before it can reach the
 * desk. Anything unusable returns null so the caller falls back to the
 * on-device agent.
 */
import { capitalize, shorten, similarity } from '../../logic/text.ts';
import { isBinId } from '../../logic/voice-intents.ts';
import { LIMITS, type PlanStep, type TomorrowPlan, type WorryDraft } from './types.ts';

/** Extracts the first balanced JSON object or array from arbitrary text. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text);
  const body = fenced != null ? fenced[1] : text;
  const start = body.search(/[[{]/u);
  if (start < 0) {
    return null;
  }
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

const BIN_ALIASES: Record<string, string> = {
  letgo: 'let-go',
  'let go': 'let-go',
  let_go: 'let-go',
  release: 'let-go',
  today: 'tomorrow',
  someday: 'later',
};

export function parseDrafts(raw: string, existing: string[] = []): WorryDraft[] | null {
  const json = extractJson(raw);
  const list = Array.isArray(json)
    ? json
    : json != null && typeof json === 'object' && Array.isArray((json as { tokens?: unknown }).tokens)
      ? (json as { tokens: unknown[] }).tokens
      : null;
  if (list == null) {
    return null;
  }
  const drafts: WorryDraft[] = [];
  for (const item of list) {
    if (item == null || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const title = capitalize(shorten(str(record.title ?? record.label ?? record.text), LIMITS.titleChars));
    if (title.length < 2) {
      continue;
    }
    const rawBin = str(record.suggestion ?? record.bin).toLowerCase();
    const bin = BIN_ALIASES[rawBin] ?? rawBin;
    const known = [...existing, ...drafts.map((d) => d.title)];
    if (known.some((k) => similarity(k, title) >= 0.75)) {
      continue;
    }
    drafts.push({
      title,
      detail: shorten(str(record.detail) || title, 200),
      suggestion: isBinId(bin) ? bin : 'later',
      why: shorten(str(record.why), LIMITS.whyChars),
    });
    if (drafts.length >= LIMITS.maxTokensPerUtterance) {
      break;
    }
  }
  return drafts;
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/u;

export function parsePlan(raw: string): TomorrowPlan | null {
  const json = extractJson(raw);
  if (json == null || typeof json !== 'object' || Array.isArray(json)) {
    return null;
  }
  const record = json as Record<string, unknown>;
  if (!Array.isArray(record.steps)) {
    return null;
  }
  const steps: PlanStep[] = [];
  for (const item of record.steps) {
    if (item == null || typeof item !== 'object') {
      continue;
    }
    const s = item as Record<string, unknown>;
    const title = shorten(str(s.title), LIMITS.titleChars);
    const step = shorten(str(s.step ?? s.action), LIMITS.stepChars);
    if (title.length === 0 || step.length === 0) {
      continue;
    }
    const whenRaw = str(s.when);
    const when = HHMM.test(whenRaw) ? whenRaw.padStart(5, '0') : '09:30';
    const minutesRaw = typeof s.minutes === 'number' ? s.minutes : Number.parseInt(str(s.minutes), 10);
    const minutes = Number.isFinite(minutesRaw) ? Math.min(90, Math.max(2, Math.round(minutesRaw))) : 15;
    steps.push({ title, step, when, minutes });
    if (steps.length >= LIMITS.maxSteps) {
      break;
    }
  }
  if (steps.length === 0) {
    return null;
  }
  return { steps, note: shorten(str(record.note) || 'Small steps.', LIMITS.noteChars) };
}
