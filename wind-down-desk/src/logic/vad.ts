/**
 * Hands-free listening: a tiny energy-based voice activity detector
 * (pure, unit-tested). It turns a stream of RMS levels into utterances so the
 * user never has to press anything to speak (accessibility: voice for every
 * gesture, including "start talking").
 *
 * Adaptive noise floor: speech must rise `ratio`× above the running floor.
 */

export interface VadOptions {
  /** Absolute minimum RMS that can count as speech. */
  minLevel?: number;
  /** Speech threshold relative to the noise floor. */
  ratio?: number;
  /** Speech must last this long to open an utterance (ms). */
  attackMs?: number;
  /** Silence needed to close an utterance (ms). */
  hangoverMs?: number;
  /** Utterances are cut at this length (ms) to keep requests small. */
  maxUtteranceMs?: number;
}

export type VadEvent = 'start' | 'end' | null;

export class VadSegmenter {
  private readonly minLevel: number;
  private readonly ratio: number;
  private readonly attackMs: number;
  private readonly hangoverMs: number;
  private readonly maxUtteranceMs: number;
  private floor = 0.01;
  private speaking = false;
  private aboveSince = -1;
  private belowSince = -1;
  private startedAt = -1;

  constructor(options: VadOptions = {}) {
    this.minLevel = options.minLevel ?? 0.015;
    this.ratio = options.ratio ?? 2.6;
    this.attackMs = options.attackMs ?? 120;
    this.hangoverMs = options.hangoverMs ?? 900;
    this.maxUtteranceMs = options.maxUtteranceMs ?? 14_000;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  get noiseFloor(): number {
    return this.floor;
  }

  /** Feed one RMS sample at time `tMs`. Returns a boundary event or null. */
  push(rms: number, tMs: number): VadEvent {
    const threshold = Math.max(this.minLevel, this.floor * this.ratio);
    const loud = rms >= threshold;
    if (!this.speaking) {
      // Track the floor only while not speaking (slow rise, faster fall).
      this.floor += (rms - this.floor) * (rms > this.floor ? 0.02 : 0.1);
      if (loud) {
        if (this.aboveSince < 0) {
          this.aboveSince = tMs;
        }
        if (tMs - this.aboveSince >= this.attackMs) {
          this.speaking = true;
          this.startedAt = this.aboveSince;
          this.belowSince = -1;
          return 'start';
        }
      } else {
        this.aboveSince = -1;
      }
      return null;
    }
    if (tMs - this.startedAt >= this.maxUtteranceMs) {
      this.reset();
      return 'end';
    }
    if (loud) {
      this.belowSince = -1;
      return null;
    }
    if (this.belowSince < 0) {
      this.belowSince = tMs;
    }
    if (tMs - this.belowSince >= this.hangoverMs) {
      this.reset();
      return 'end';
    }
    return null;
  }

  private reset(): void {
    this.speaking = false;
    this.aboveSince = -1;
    this.belowSince = -1;
    this.startedAt = -1;
  }
}

/** RMS of a time-domain buffer (allocation-free). */
export function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
}
