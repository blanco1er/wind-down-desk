/**
 * Hands-free microphone: getUserMedia → analyser (level for the orb) →
 * energy VAD → one MediaRecorder clip per utterance → server transcription.
 *
 * Permission is requested from the 2D page before entering XR, because a
 * permission prompt during an immersive session may be invisible on headset
 * ([UNVERIFIED on Quest]: to be checked on device).
 */
import { rms, VadSegmenter } from '../logic/vad.ts';

export type MicState = 'off' | 'requesting' | 'listening' | 'muted' | 'denied' | 'unavailable';

function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

/** Longest single utterance sent for transcription (ms). */
export const MAX_CLIP_MS = 45_000;

export class VoiceInput {
  state: MicState = 'off';
  /** Smoothed 0..1 level for visuals. */
  level = 0;
  onUtterance: ((clip: Blob) => void) | null = null;
  onState: ((state: MicState) => void) | null = null;

  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer: Float32Array<ArrayBuffer> | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private readonly vad = new VadSegmenter();
  private lastTick = 0;

  static supported(): boolean {
    return typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia != null && typeof MediaRecorder !== 'undefined';
  }

  async start(): Promise<MicState> {
    if (this.stream != null) {
      this.setState('listening');
      return this.state;
    }
    if (!VoiceInput.supported()) {
      this.setState('unavailable');
      return this.state;
    }
    this.setState('requesting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (error) {
      this.setState(error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied' : 'unavailable');
      return this.state;
    }
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.buffer = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    source.connect(this.analyser);
    this.setState('listening');
    return this.state;
  }

  mute(muted: boolean): void {
    if (this.stream == null) {
      return;
    }
    this.stream.getAudioTracks().forEach((t) => (t.enabled = !muted));
    if (muted && this.recorder?.state === 'recording') {
      this.recorder.stop();
    }
    this.setState(muted ? 'muted' : 'listening');
  }

  get active(): boolean {
    return this.state === 'listening';
  }

  /** Call every frame; samples at ~30 Hz without allocating. */
  /** True while an utterance is being recorded (the person is talking: the lamp waits). */
  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** While the lamp talks (and 0.3 s after), new utterances are not started: it never hears itself. */
  holdUntil = 0;

  tick(nowMs: number): void {
    if (nowMs < this.holdUntil && this.recorder?.state !== 'recording') {
      this.level *= 0.9;
      return;
    }
    if (this.analyser == null || this.buffer == null || this.state !== 'listening' || nowMs - this.lastTick < 33) {
      this.level *= 0.9;
      return;
    }
    this.lastTick = nowMs;
    this.analyser.getFloatTimeDomainData(this.buffer);
    const value = rms(this.buffer);
    this.level = Math.min(1, this.level * 0.6 + Math.min(1, value * 9) * 0.4);
    const event = this.vad.push(value, nowMs);
    if (event === 'start') {
      this.beginClip();
    } else if (event === 'end') {
      this.recorder?.stop();
    }
  }

  private beginClip(): void {
    if (this.stream == null) {
      return;
    }
    const mimeType = pickMime();
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, mimeType.length > 0 ? { mimeType, audioBitsPerSecond: 32_000 } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.chunks.push(e.data);
      }
    };
    this.recorder.onstop = () => {
      const clip = new Blob(this.chunks, { type: this.recorder?.mimeType || mimeType || 'audio/webm' });
      this.chunks = [];
      if (clip.size > 1500) {
        this.onUtterance?.(clip);
      }
    };
    this.recorder.start();
    // Cost guard (22 Oct): one clip is at most 45 s (≈ 180 KB at 32 kb/s), well under the server's cap.
    const recorder = this.recorder;
    window.setTimeout(() => {
      if (this.recorder === recorder && recorder.state === 'recording') recorder.stop();
    }, MAX_CLIP_MS);
  }

  private setState(state: MicState): void {
    this.state = state;
    this.onState?.(state);
  }
}
