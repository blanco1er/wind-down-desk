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

interface Job {
  pending: Float32Array[];
  done: boolean;
}

export class TtsPlayer {
  /** 0..1 loudness of what is playing now (for the lamp). */
  level = 0;
  private readonly ctx: AudioContext;
  private readonly gain: GainNode;
  /** 28 Oct: the voice's level from the mix, after the analyser (the lamp's glow keeps following the words). */
  private readonly vol: GainNode;
  private readonly panner: PannerNode;
  private readonly analyser: AnalyserNode;
  private readonly wave: Float32Array<ArrayBuffer>;
  private abort: AbortController | null = null;
  private sources: AudioBufferSourceNode[] = [];
  /** Sentences in order; only the first one schedules directly, the others keep their sound until their turn. */
  private jobs: Job[] = [];
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
    this.vol = ctx.createGain();
    this.gain.connect(this.vol);
    this.vol.connect(this.panner);
    this.panner.connect(destination);
    this.gain.connect(this.analyser);
  }

  /** The voice's level (logic/mix.ts), 0..1. */
  setVolume(v: number): void {
    this.vol.gain.setTargetAtTime(Math.min(1, Math.max(0, v)), this.ctx.currentTime, 0.05);
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
   * Speaks `text` now (whatever was playing stops); resolves once its sound is fully received ('played'), or with
   * 'unavailable' (no server voice, over the daily budget, network error, muted).
   */
  speak(text: string): Promise<'played' | 'unavailable'> {
    this.stop();
    return this.append(text);
  }

  /**
   * Speaks `text` after what is already queued (25 Oct, lower latency: the reply arrives sentence by sentence).
   * Its sound is requested at once and kept aside, then played the moment the previous sentence ends: no gap.
   */
  async append(text: string): Promise<'played' | 'unavailable'> {
    if (this.muted) return 'unavailable';
    if (this.abort == null) this.abort = new AbortController();
    const abort = this.abort;
    const job: Job = { pending: [], done: false };
    this.jobs.push(job);
    let res: Response;
    try {
      res = await fetch(`${API}/speak`, { method: 'POST', signal: abort.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    } catch {
      this.finish(job);
      return 'unavailable';
    }
    if (!res.ok || res.body == null) {
      this.finish(job);
      return 'unavailable';
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    const reader = res.body.getReader();
    let carry: number | null = null;
    let block = new Float32Array(BLOCK * 2);
    let filled = 0;
    let any = false;
    const flush = () => {
      if (filled === 0) return;
      const samples = block.subarray(0, filled);
      if (this.jobs[0] === job) this.schedule(samples);
      else job.pending.push(samples);
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
    this.finish(job);
    return any ? 'played' : 'unavailable';
  }

  /** A sentence fully received: the next one in the queue plays its kept sound right after. */
  private finish(job: Job): void {
    job.done = true;
    while (this.jobs.length > 0 && this.jobs[0].done) {
      this.jobs.shift();
      const next = this.jobs[0];
      if (next == null) break;
      for (const samples of next.pending) this.schedule(samples);
      next.pending = [];
    }
  }

  private schedule(samples: Float32Array): void {
    const buffer = this.ctx.createBuffer(1, samples.length, RATE);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    const at = Math.max(this.ctx.currentTime + 0.05, this.endsAt);
    src.start(at);
    this.endsAt = at + samples.length / RATE;
    this.sources.push(src);
    src.onended = () => {
      const k = this.sources.indexOf(src);
      if (k >= 0) this.sources.splice(k, 1);
    };
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
    this.jobs = [];
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
