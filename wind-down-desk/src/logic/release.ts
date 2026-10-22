/**
 * "Release": one heavy thing becomes a dark engraved stone that you let sink into still water.
 * Pure state machine (unit-tested); the ECS system drives the visuals from it.
 *
 *   ask ──heard──▶ forming ──formed──▶ hold ◀──over(false)── over
 *                                       │  ──over(true)──▶    │
 *                                       │                     │ drop over the water, or "let it go"
 *                                       └──── "let it go" ────┴──▶ sinking ──sunk──▶ gone ──settled──▶ done
 *   any phase: cancel ──▶ done (nothing is recorded)
 *
 * A drop away from the water is never a failure: the stone just returns to the tray.
 */

export type ReleasePhase = 'ask' | 'forming' | 'hold' | 'over' | 'sinking' | 'gone' | 'done';

export type ReleaseEvent =
  | { type: 'heard'; title: string }
  | { type: 'formed' }
  | { type: 'over'; over: boolean }
  | { type: 'drop'; overWater: boolean }
  | { type: 'voice-sink' }
  | { type: 'sunk' }
  | { type: 'settled' }
  | { type: 'cancel' };

export interface ReleaseState {
  phase: ReleasePhase;
  /** What is engraved on the stone (≤ 4 words). */
  title: string;
  /** True once something really sank (the evening records it). */
  released: boolean;
  /** How the stone went in: by hand (open fingers over the water) or by voice. */
  via: 'hand' | 'voice' | null;
  /** Drops that missed the water (the stone came back to the tray). */
  misses: number;
}

export function initialRelease(title = ''): ReleaseState {
  return { phase: title.length > 0 ? 'forming' : 'ask', title, released: false, via: null, misses: 0 };
}

export function stepRelease(state: ReleaseState, event: ReleaseEvent): ReleaseState {
  const s: ReleaseState = { ...state };
  switch (event.type) {
    case 'heard':
      if (s.phase === 'ask' && event.title.trim().length > 0) {
        s.title = event.title.trim();
        s.phase = 'forming';
      }
      break;
    case 'formed':
      if (s.phase === 'forming') s.phase = 'hold';
      break;
    case 'over':
      if (s.phase === 'hold' && event.over) s.phase = 'over';
      else if (s.phase === 'over' && !event.over) s.phase = 'hold';
      break;
    case 'drop':
      if (s.phase === 'hold' || s.phase === 'over') {
        if (event.overWater) {
          s.phase = 'sinking';
          s.via = 'hand';
        } else {
          s.phase = 'hold';
          s.misses += 1;
        }
      }
      break;
    case 'voice-sink':
      if (s.phase === 'hold' || s.phase === 'over') {
        s.phase = 'sinking';
        s.via = 'voice';
      }
      break;
    case 'sunk':
      if (s.phase === 'sinking') {
        s.phase = 'gone';
        s.released = true;
      }
      break;
    case 'settled':
      if (s.phase === 'gone') s.phase = 'done';
      break;
    case 'cancel':
      s.phase = 'done';
      break;
  }
  return s;
}

/** Glass panel text. `mic`: a microphone is listening (else the lamp offers tonight's heaviest stone). */
export function releaseCaption(state: ReleaseState, mic: boolean, quiet = false): { text: string; sub: string } {
  switch (state.phase) {
    case 'ask':
      if (quiet) return { text: 'What weighs on you tonight?', sub: 'Touch one of tonight\'s stones, or write it.' };
      return { text: 'What weighs on you tonight?', sub: mic ? 'Say it in a few words, or touch a stone below.' : 'Touch one of tonight\'s stones, or write it.' };
    case 'forming':
      return { text: 'What weighs on you tonight?', sub: '' };
    case 'hold':
      return { text: 'Hold it. Then let it sink.', sub: state.misses > 0 ? 'Over the water, then open your fingers. Or say "let it go".' : 'Pinch the stone, hold it over the water. Or say "let it go".' };
    case 'over':
      return { text: 'Hold it. Then let it sink.', sub: 'Open your fingers when you are ready.' };
    case 'sinking':
      return { text: 'Hold it. Then let it sink.', sub: '' };
    case 'gone':
    case 'done':
      return { text: 'Gone. Breathe out.', sub: '' };
  }
}

/** Lines the lamp may say during Release (voice catalogue). */
export const RELEASE_LINES = ['What weighs on you tonight?', 'Hold it. Then let it sink.', 'Gone. Breathe out.'];

/** Desk-local layout of the Release moment (metres): the black bowl at the centre of the tray. */
export const WATER_BOWL = {
  x: 0,
  z: -0.03,
  // v8: wider and deeper, like the reference images (≈ 40 % of the tray's width).
  outer: 0.162,
  inner: 0.149,
  height: 0.064,
  /** Water surface height above the tray floor. */
  water: 0.05,
  /** Inner floor height. */
  floor: 0.01,
} as const;

/** True when a desk-local point is above the water, inside the rim, low enough to "hold it over". */
export function overWater(local: { x: number; y: number; z: number }, margin = 0.008): boolean {
  const r = Math.hypot(local.x - WATER_BOWL.x, local.z - WATER_BOWL.z);
  return r <= WATER_BOWL.inner + margin && local.y >= WATER_BOWL.water - 0.01 && local.y <= WATER_BOWL.water + 0.32;
}
