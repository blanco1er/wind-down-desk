/**
 * The lamp's dynamic voice in the browser ("Talk it through", 24 Oct). POST /api/speak streams raw PCM16 24 kHz
 * mono (Gemini TTS on the server; the key never reaches the browser); playback starts with the first ~0.2 s, as a
 * spatial sound placed at the lamp (HRTF panner, the scene's own AudioContext and listener), and its loudness drives
 * the lamp's light and aura. Any failure → 'unavailable': the caption stays on screen (never silence without text).
 * Steady state allocates nothing per frame (`tick` reads a preallocated buffer).
 */
const API = ((import.meta.env.VITE_WDD_API as string | undefined) ?? '/api').replace(/\/+$/u, '');
const RATE = 24_000;
/** Schedule audio in blocks of at least this many samples (0.2 s): fewer nodes, no gaps. */
const BLOCK = 4800;

export class TtsPlayer {
  /** 0..1 loudness of what is playing now (for the lamp). */
  level = 0;
  private readonly ctx: AudioContext;
  private readonly gain: GainNode;
  private readonly panner: PannerNode;
  private readonly analyser: AnalyserNode;
  private readonly wave: Float32Array<ArrayBuffer>;
  private abort: AbortController | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private endsAt = 0;
  /** Muted ("Sound off"): the caption alone. */
  muted = false;

  /** `destination`: the scene's AudioListener input, so "Sound off" (master volume) silences this voice too. */
  constructor(ctx: AudioContext, destination: AudioNode = ctx.destination) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.95;
    this.panner = ctx.createPanner();
    this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 0.6;
    this.panner.rolloffFactor = 0.6;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.wave = new Float32Array(this.analyser.fftSize);
    this.gain.connect(this.panner);
    this.panner.connect(destination);
    this.gain.connect(this.analyser);
  }

  /** The lamp's world position (call every frame while speaking; the listener follows the head). */
  place(x: number, y: number, z: number): void {
    const t = this.ctx.currentTime;
    this.panner.positionX.setValueAtTime(x, t);
    this.panner.positionY.setValueAtTime(y, t);
    this.panner.positionZ.setValueAtTime(z, t);
  }

  get speaking(): boolean {
    return this.ctx.currentTime < this.endsAt;
  }

  /** Seconds of audio still to play (0 when quiet). */
  get remaining(): number {
    return Math.max(0, this.endsAt - this.ctx.currentTime);
  }

  /**
   * Speaks `text`; resolves when the sound has been scheduled to its end ('played'), or at once with 'unavailable'
   * (no server voice, over the daily budget, network error, muted).
   */
  async speak(text: string): Promise<'played' | 'unavailable'> {
    this.stop();
    if (this.muted) return 'unavailable';
    const abort = new AbortController();
    this.abort = abort;
    let res: Response;
    try {
      res = await fetch(`${API}/speak`, { method: 'POST', signal: abort.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    } catch {
      return 'unavailable';
    }
    if (!res.ok || res.body == null) return 'unavailable';
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    const reader = res.body.getReader();
    let carry: number | null = null;
    let block = new Float32Array(BLOCK * 2);
    let filled = 0;
    let any = false;
    const flush = () => {
      if (filled === 0) return;
      const buffer = this.ctx.createBuffer(1, filled, RATE);
      buffer.copyToChannel(block.subarray(0, filled), 0);
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.gain);
      const at = Math.max(this.ctx.currentTime + 0.05, this.endsAt);
      src.start(at);
      this.endsAt = at + filled / RATE;
      this.sources.push(src);
      src.onended = () => {
        const i = this.sources.indexOf(src);
        if (i >= 0) this.sources.splice(i, 1);
      };
      block = new Float32Array(BLOCK * 2);
      filled = 0;
      any = true;
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || abort.signal.aborted) break;
        let i = 0;
        // A sample split across two network chunks.
        if (carry != null && value.length > 0) {
          block[filled++] = (((value[0] << 8) | carry) << 16 >> 16) / 32768;
          carry = null;
          i = 1;
        }
        for (; i + 1 < value.length; i += 2) {
          if (filled >= block.length) flush();
          block[filled++] = (((value[i + 1] << 8) | value[i]) << 16 >> 16) / 32768;
        }
        if (i < value.length) carry = value[i];
        if (filled >= BLOCK) flush();
      }
      flush();
    } catch {
      flush();
    }
    if (!any) return 'unavailable';
    return 'played';
  }

  stop(): void {
    this.abort?.abort();
    this.abort = null;
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        // Already ended.
      }
    }
    this.sources = [];
    this.endsAt = 0;
    this.level = 0;
  }

  /** Loudness now (RMS of the last few ms), smoothed; call once per frame. */
  tick(): void {
    if (!this.speaking) {
      this.level *= 0.85;
      return;
    }
    this.analyser.getFloatTimeDomainData(this.wave);
    let sum = 0;
    for (let i = 0; i < this.wave.length; i++) sum += this.wave[i] * this.wave[i];
    const rms = Math.sqrt(sum / this.wave.length);
    const target = Math.min(1, rms * 5);
    this.level += (target - this.level) * (target > this.level ? 0.5 : 0.15);
  }
}
