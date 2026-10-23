/**
 * Living places — sound. Positional (HRTF) loops and one-shots placed where things happen (the fire, the surf, the
 * windows), lazy-loaded the first time their place is shown.
 *
 * Everything goes through the ONE AudioListener on the player's head (IWSDK's), so the app's master volume ("Muted",
 * sounds.ts setMasterSound) silences it too. Three's PositionalAudio is used directly (not AudioSource) for what
 * IWSDK does not expose: a playback rate per crackle (pitch variation). Every sound started is written to the app's
 * audio log (performance.now ms) so the demo film can lay the real sound under the picture.
 */
import { AudioLoader, Object3D, PositionalAudio, type World } from '@iwsdk/core';

type Listener = ConstructorParameters<typeof PositionalAudio>[0];

export interface AudioLogEntry {
  t: number;
  src: string;
  volume: number;
  rate?: number;
  loop?: boolean;
}

export function findListener(world: World): Listener | null {
  let found: Listener | null = null;
  world.player.head.traverse((o) => {
    if ((o as unknown as { type?: string }).type === 'AudioListener') found = o as unknown as Listener;
  });
  return found;
}

const buffers = new Map<string, Promise<AudioBuffer | null>>();
const loader = new AudioLoader();

function load(src: string): Promise<AudioBuffer | null> {
  let p = buffers.get(src);
  if (p == null) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}${src}`).catch(() => null);
    buffers.set(src, p);
  }
  return p;
}

export interface LoopDef {
  src: string;
  volume: number;
  x: number;
  y: number;
  z: number;
  ref: number;
}

/** A set of positional sounds owned by one living effect, parented to its frame (they move with it). */
export class LivingSound {
  readonly holder = new Object3D();
  /** Shared log (the app's cue log once attached; a local one before). */
  log: AudioLogEntry[] = [];
  private readonly world: World;
  private loops: Array<{ def: LoopDef; audio: PositionalAudio | null }> = [];
  private readonly shots: PositionalAudio[] = [];
  private level = 0;
  private applied = -1;
  private wanted = false;

  constructor(world: World, parent: Object3D) {
    this.world = world;
    parent.add(this.holder);
  }

  private listener(): Listener | null {
    return findListener(this.world);
  }

  /** 25 Oct: fetches and decodes the loops now (a calm moment), so arriving in the place plays them at once. */
  prefetch(): void {
    for (const loop of this.loops) void load(loop.def.src);
  }

  /** Declares the loops (started on `start`, lazily loaded). */
  setLoops(defs: LoopDef[]): void {
    this.loops = defs.map((def) => ({ def, audio: null }));
  }

  start(): void {
    this.wanted = true;
    const listener = this.listener();
    if (listener == null) return;
    for (const loop of this.loops) {
      if (loop.audio != null) {
        if (!loop.audio.isPlaying) this.playLoop(loop.audio, loop.def);
        continue;
      }
      const audio = new PositionalAudio(listener);
      audio.position.set(loop.def.x, loop.def.y, loop.def.z);
      audio.setRefDistance(loop.def.ref);
      audio.setRolloffFactor(0.8);
      audio.setLoop(true);
      audio.setVolume(0);
      this.holder.add(audio);
      loop.audio = audio;
      void load(loop.def.src).then((buffer) => {
        if (buffer == null || loop.audio !== audio) return;
        audio.setBuffer(buffer);
        if (this.wanted) this.playLoop(audio, loop.def);
      });
    }
  }

  private playLoop(audio: PositionalAudio, def: LoopDef): void {
    if (audio.buffer == null || audio.isPlaying) return;
    // Start somewhere inside the loop so two copies of the same file never phase.
    audio.offset = Math.random() * Math.max(0, audio.buffer.duration - 0.5);
    audio.play();
    this.log.push({ t: performance.now(), src: def.src, volume: def.volume * this.level, loop: true });
    this.applied = -1;
  }

  stop(): void {
    this.wanted = false;
    for (const loop of this.loops) if (loop.audio?.isPlaying) loop.audio.stop();
    for (const shot of this.shots) if (shot.isPlaying) shot.stop();
  }

  /** The loops' level follows the picture's fade (0..1), applied when it changes by ≥ 1 %. */
  setLevel(level: number, loopGain: number[] | null = null): void {
    this.level = level;
    if (Math.abs(level - this.applied) < 0.01 && !(level === 0 && this.applied !== 0) && loopGain == null) return;
    this.applied = level;
    this.loops.forEach((loop, i) => loop.audio?.setVolume(loop.def.volume * level * (loopGain?.[i] ?? 1)));
  }

  /** Preloads one-shot files (no sound). */
  preload(srcs: string[]): void {
    for (const s of srcs) void load(s);
  }

  /** A one-shot at a point of the frame, with its own playback rate (pitch) and gain. Silently skipped if not loaded. */
  play(src: string, x: number, y: number, z: number, gain: number, rate = 1, ref = 1.5): void {
    if (!this.wanted) return;
    const listener = this.listener();
    if (listener == null) return;
    void load(src).then((buffer) => {
      if (buffer == null || !this.wanted) return;
      let shot = this.shots.find((s) => !s.isPlaying);
      if (shot == null) {
        if (this.shots.length >= 6) return;
        shot = new PositionalAudio(listener);
        shot.setRolloffFactor(0.9);
        this.holder.add(shot);
        this.shots.push(shot);
      }
      shot.setRefDistance(ref);
      shot.position.set(x, y, z);
      shot.updateMatrixWorld();
      shot.setBuffer(buffer);
      shot.setPlaybackRate(rate);
      shot.setVolume(gain);
      shot.play();
      this.log.push({ t: performance.now(), src, volume: +gain.toFixed(3), rate: +rate.toFixed(3) });
      if (this.log.length > 400) this.log.shift();
    });
  }

  get playing(): number {
    return this.loops.filter((l) => l.audio?.isPlaying).length + this.shots.filter((s) => s.isPlaying).length;
  }
}
