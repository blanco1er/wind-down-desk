/**
 * Spatial sound bank. Each cue is a positional AudioSource (HRTF panning by
 * the IWSDK audio system) moved to where the event happens before playing:
 * a stone lands where you put it, "Let go" rises from its halo.
 * Files are synthesized offline by tools/make-sounds.mjs (≈130 KB total, mp3).
 */
import { AudioSource, AudioUtils, Object3D, PlaybackMode, type Entity, type World } from '@iwsdk/core';

export type Cue = 'appear' | 'tock' | 'snap-tomorrow' | 'snap-later' | 'release' | 'orb-on' | 'orb-off' | 'plan' | 'night' | 'morning' | RitualCue;
/** v6 ritual sounds (209 KB), loaded only once the evening reaches the ritual choice. */
export type RitualCue = 'sink' | 'bubbles' | 'pearl' | 'swell' | 'ebb' | 'rise' | 'moon';
const RITUAL_CUES: readonly RitualCue[] = ['sink', 'bubbles', 'pearl', 'swell', 'ebb', 'rise', 'moon'];

const FILES: Record<Cue, { src: string; volume: number }> = {
  sink: { src: 'audio/sink.mp3', volume: 0.7 },
  bubbles: { src: 'audio/bubbles.mp3', volume: 0.35 },
  pearl: { src: 'audio/pearl.mp3', volume: 0.32 },
  swell: { src: 'audio/swell.mp3', volume: 0.22 },
  ebb: { src: 'audio/ebb.mp3', volume: 0.22 },
  rise: { src: 'audio/rise.mp3', volume: 0.5 },
  moon: { src: 'audio/moon.mp3', volume: 0.45 },
  appear: { src: 'audio/appear.mp3', volume: 0.45 },
  tock: { src: 'audio/tock.mp3', volume: 0.55 },
  'snap-tomorrow': { src: 'audio/snap-tomorrow.mp3', volume: 0.55 },
  'snap-later': { src: 'audio/snap-later.mp3', volume: 0.55 },
  release: { src: 'audio/release.mp3', volume: 0.75 },
  'orb-on': { src: 'audio/orb-on.mp3', volume: 0.35 },
  'orb-off': { src: 'audio/orb-off.mp3', volume: 0.3 },
  plan: { src: 'audio/plan.mp3', volume: 0.5 },
  night: { src: 'audio/night.mp3', volume: 0.6 },
  morning: { src: 'audio/morning.mp3', volume: 0.55 },
};

/**
 * One master volume for everything the app plays: every IWSDK AudioSource (voice lines, cues, ambience, rain)
 * goes through the single AudioListener on the player's head, so its gain is the one switch. Sounds created
 * later inherit it. Returns false while the listener does not exist yet (the caller retries).
 */
export function setMasterSound(world: World, on: boolean): boolean {
  let done = false;
  world.player.head.traverse((o) => {
    const listener = o as unknown as { type?: string; setMasterVolume?(v: number): void; getMasterVolume?(): number };
    if (listener.type === 'AudioListener' && listener.setMasterVolume != null) {
      if (listener.getMasterVolume?.() !== (on ? 1 : 0)) listener.setMasterVolume(on ? 1 : 0);
      done = true;
    }
  });
  return done;
}

/** The master volume now (null before the audio system exists): for the play-test check. */
export function masterSound(world: World): number | null {
  let value: number | null = null;
  world.player.head.traverse((o) => {
    const listener = o as unknown as { type?: string; getMasterVolume?(): number };
    if (listener.type === 'AudioListener' && listener.getMasterVolume != null) value = listener.getMasterVolume();
  });
  return value;
}

export class SoundBank {
  private readonly entities = new Map<Cue, Entity>();
  private ambient: Entity | null = null;
  private readonly world: World;

  constructor(world: World) {
    this.world = world;
    for (const [cue, def] of Object.entries(FILES) as Array<[Cue, { src: string; volume: number }]>) {
      if (!(RITUAL_CUES as readonly string[]).includes(cue)) this.create(cue, def);
    }
    const base = import.meta.env.BASE_URL;
    this.ambient = world.createTransformEntity(new Object3D()).addComponent(AudioSource, {
      src: `${base}audio/ambient.mp3`,
      volume: 0.16,
      loop: true,
      positional: false,
      playbackMode: PlaybackMode.FadeRestart,
    });
  }

  /** v6: fetch the ritual sounds (once). */
  preloadRituals(): void {
    for (const cue of RITUAL_CUES) {
      if (!this.entities.has(cue)) this.create(cue, FILES[cue]);
    }
  }

  private create(cue: Cue, def: { src: string; volume: number }): void {
    const base = import.meta.env.BASE_URL;
    {
      const holder = new Object3D();
      const entity = this.world.createTransformEntity(holder).addComponent(AudioSource, {
        src: `${base}${def.src}`,
        volume: def.volume,
        positional: true,
        refDistance: 0.6,
        rolloffFactor: 1.2,
        maxInstances: 3,
        playbackMode: PlaybackMode.Overlap,
      });
      this.entities.set(cue, entity);
    }
  }

  /** Film/debug: cues played and when (performance.now ms), to mix the real audio into the demo video. */
  readonly log: Array<{ t: number; src: string; volume: number }> = [];

  play(cue: Cue, x: number, y: number, z: number): void {
    if (!this.entities.has(cue)) this.create(cue, FILES[cue]);
    const entity = this.entities.get(cue);
    if (entity?.object3D == null) {
      return;
    }
    this.log.push({ t: performance.now(), src: FILES[cue].src, volume: FILES[cue].volume });
    if (this.log.length > 400) this.log.shift();
    entity.object3D.position.set(x, y, z);
    entity.object3D.updateMatrixWorld();
    AudioUtils.play(entity);
  }

  startAmbient(): void {
    if (this.ambient != null && !AudioUtils.isPlaying(this.ambient)) {
      AudioUtils.play(this.ambient, 3);
    }
  }

  fadeAmbient(volume: number): void {
    if (this.ambient != null) {
      AudioUtils.setVolume(this.ambient, volume);
    }
  }
}
