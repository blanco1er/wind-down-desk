/**
 * Pause and resume, cleanly (pure, unit-tested). Jury design advice: the headset taken off, the Meta button
 * pressed, the browser tab hidden — the evening must pause (no microphone, no sound, no timers) and resume
 * exactly where it was, never listening twice.
 *
 * Sources: the XR session's visibilityState ('visible' | 'visible-blurred' | 'hidden') and the page's
 * document.hidden. Paused when ANY source is not fully visible; resumed only when all are visible again.
 */
export type PauseSource = 'xr' | 'page';

export class PauseGate {
  private readonly hidden = new Set<PauseSource>();

  get paused(): boolean {
    return this.hidden.size > 0;
  }

  /** Updates one source; returns 'pause' / 'resume' only when the overall state changes (idempotent). */
  set(source: PauseSource, visible: boolean): 'pause' | 'resume' | null {
    const before = this.paused;
    if (visible) this.hidden.delete(source);
    else this.hidden.add(source);
    if (before === this.paused) return null;
    return this.paused ? 'pause' : 'resume';
  }

  /** Session over: the XR source no longer exists. */
  clear(source: PauseSource): 'pause' | 'resume' | null {
    return this.set(source, true);
  }
}

/** XR visibility states that count as "the person can see and use the evening". */
export function xrVisible(state: string | undefined): boolean {
  return state == null || state === 'visible';
}
