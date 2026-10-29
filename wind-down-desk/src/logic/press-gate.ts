/**
 * 29 Oct (robustness without a headset) — one touch, one action. Real hand tracking shakes by a few millimetres: a
 * fingertip resting on a glass button leaves it and comes back, and IWSDK reports a second Pressed. Measured in the
 * emulator with a 4 mm tremor: "That's all" pressed twice in 0.3 s. For a switch (Larger text, Mixed | Full, Lamp
 * voice) that is an on-then-off nobody wanted.
 *
 * - The same button again within SAME_PRESS_S is the same touch (ignored).
 * - The globe's ‹ › allow a quicker repeat (GLOBE_STEP_S): flicking through places is meant to be fast.
 * - Answers and words (they change meaning under the finger) keep their own cross-button rule in the system.
 */
export const SAME_PRESS_S = 0.45;
export const GLOBE_STEP_S = 0.2;

export class PressGate {
  private readonly last = new Map<string, number>();

  /** True when `action` at `now` (seconds) is a new touch, false when it is the same touch again. */
  allow(action: string, now: number): boolean {
    const gap = action === 'globe-prev' || action === 'globe-next' ? GLOBE_STEP_S : SAME_PRESS_S;
    const before = this.last.get(action);
    if (before != null && now - before < gap) return false;
    this.last.set(action, now);
    return true;
  }
}
