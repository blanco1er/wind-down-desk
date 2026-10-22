/**
 * The evening darkens with you (owner, 18 Oct: "people will not want to fall asleep in front of a daylight view").
 * A single depth 0..1, pure and unit-tested: blue hour on arrival, deeper with each ritual, night at Good night.
 * It only ever goes darker during an evening (the morning sheet is the one way back to light), and it moves slowly
 * (never a jump): ≈ 40 s to cross the whole range.
 */
import type { EveningMode } from './evening.ts';

export const EVENING_STAGE: Record<EveningMode, number> = {
  arrive: 0.12,
  choose: 0.15,
  unload: 0.32,
  release: 0.52,
  breathe: 0.66,
  night: 0.95,
  morning: 0,
};

/** Where the evening should be now: the stage, plus a little for each ritual already done tonight. */
export function eveningTarget(mode: EveningMode, ritualsDone: number, previous: number): number {
  const stage = EVENING_STAGE[mode];
  if (mode === 'morning') return 0;
  const choose = mode === 'choose' ? Math.min(0.75, stage + 0.17 * ritualsDone) : stage;
  return Math.max(previous, choose);
}

/** One step of the slow slide toward the target (units per second). */
export function eveningStep(current: number, target: number, dt: number, speed = 0.025): number {
  if (current < target) return Math.min(target, current + speed * dt);
  if (current > target) return Math.max(target, current - speed * 4 * dt);
  return current;
}
