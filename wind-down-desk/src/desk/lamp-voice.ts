/**
 * The lamp's voice. Pre-rendered lines (public/voice, Kokoro-82M run locally:
 * no paid call, works offline) played as a positional sound from the lamp
 * itself, with a loudness envelope that drives the lamp's glow word by word.
 *
 * - Only lines of the catalogue are spoken (logic/lamp-lines.ts); captions stay.
 * - Mute toggle (the "Voice" button by the lamp, or "voice off" / "voice on"),
 *   remembered on the device.
 * - Fallback when the files are unavailable: the browser's speechSynthesis,
 *   if present ([UNVERIFIED on Quest Browser]: availability and voices).
 * - While the lamp talks, the microphone ignores sound (half-duplex), so it
 *   never transcribes its own voice; you can still interrupt once you speak.
 */
import { AudioSource, AudioUtils, Object3D, PlaybackMode, type Entity, type World } from '@iwsdk/core';
import { envelopeAt, lineKey, speakable, type VoiceClip, type VoiceManifest } from '../logic/lamp-lines.ts';
import { mixLevels } from '../logic/mix.ts';

const STORAGE_KEY = 'wdd.voice';

export class LampVoice {
  muted = false;
  /** Quiet evening: the lamp does not speak (captions and light only). */
  quiet = false;
  private manifest: VoiceManifest | null = null;
  private failed = false;
  private current: { clip: VoiceClip | null; start: number; until: number; entity: Entity | null } | null = null;
  private lastKey = '';
  private lastAt = -1e9;
  /** One line waits while another plays (a newer one replaces it): no chopped words, no backlog. */
  private pending: { text: string; x: number; y: number; z: number } | null = null;
  /** Film/debug: what was played and when (performance.now ms), to mix the real audio into the demo video. */
  readonly log: Array<{ t: number; src: string; volume: number }> = [];

  constructor(private readonly world: World) {
    try {
      this.muted = globalThis.localStorage?.getItem(STORAGE_KEY) === 'off';
    } catch {
      this.muted = false;
    }
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}voice/lines.json`);
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { lines: VoiceManifest };
      this.manifest = data.lines;
    } catch {
      this.failed = true;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, muted ? 'off' : 'on');
    } catch {
      // Private mode: the choice lasts for this session only.
    }
    if (muted) this.stop();
  }

  /** True while a line is playing (the mic holds still meanwhile). */
  speaking(nowS: number): boolean {
    return this.current != null && nowS < this.current.until;
  }

  /** 0..1 loudness of the voice right now (drives the lamp glow); -1 when not speaking. */
  level(nowS: number): number {
    const c = this.current;
    if (c == null || nowS >= c.until) return -1;
    if (c.clip == null) return 0.5 + 0.5 * Math.sin((nowS - c.start) * 11) * Math.sin((nowS - c.start) * 3.7 + 0.6);
    return envelopeAt(c.clip, nowS - c.start);
  }

  /**
   * Speaks a caption line from the lamp position. Returns the seconds it will last
   * (0 when silent: muted, unknown line, or repeated within 6 s).
   */
  /** Set every frame: the person is talking. The lamp never talks over them; its line waits. */
  userSpeaking = false;

  say(text: string, nowS: number, x: number, y: number, z: number): number {
    if (this.muted || this.quiet) return 0;
    const key = lineKey(text);
    if (key === this.lastKey && nowS - this.lastAt < 6) return 0;
    const clip = this.manifest?.[key];
    if (clip != null && (this.speaking(nowS) || this.userSpeaking)) {
      this.pending = { text, x, y, z };
      return clip.seconds;
    }
    if (clip != null) {
      this.stop();
      // 28 Oct: the voice's own level (logic/mix.ts; softer by default than the 0.9 of before).
      const volume = 0.9 * mixLevels.voice;
      this.log.push({ t: performance.now() + 50, src: `voice/${clip.file}`, volume });
      if (this.log.length > 400) this.log.shift();
      const entity = this.lineEntity(clip.file, volume);
      entity.object3D?.position.set(x, y, z);
      entity.object3D?.updateMatrixWorld();
      AudioUtils.setVolume(entity, volume);
      AudioUtils.play(entity);
      this.current = { clip, start: nowS + 0.05, until: nowS + 0.05 + clip.seconds, entity };
      this.lastKey = key;
      this.lastAt = nowS;
      return clip.seconds;
    }
    if (this.failed && this.manifest == null) {
      return this.synthesize(text, key, nowS);
    }
    return 0;
  }

  /**
   * 29 Oct (long session, heap snapshot): each line used to make a new one-shot audio entity that nothing removed
   * (IWSDK's createOneShot leaves it, and its scene group, behind): 634 PositionalAudio + Panner + Gain after 12
   * evenings on one page, ≈ 5 MB per evening. Now one reusable entity per line of the catalogue (sounds.ts does the
   * same per cue): at most the catalogue's size for the page's whole life, whatever the number of evenings.
   */
  private readonly lineEntities = new Map<string, Entity>();

  private lineEntity(file: string, volume: number): Entity {
    let entity = this.lineEntities.get(file);
    if (entity == null) {
      entity = this.world.createTransformEntity(new Object3D()).addComponent(AudioSource, {
        src: `${import.meta.env.BASE_URL}voice/${file}`,
        volume,
        positional: true,
        loop: false,
        maxInstances: 1,
        playbackMode: PlaybackMode.Restart,
      });
      this.lineEntities.set(file, entity);
    }
    return entity;
  }

  /** How many line players exist (tests: bounded by the catalogue). */
  get players(): number {
    return this.lineEntities.size;
  }

  /** Forget the last line (a replayed arrival may say the same welcome again). */
  forget(): void {
    this.lastKey = '';
    this.lastAt = -1e9;
  }

  /** Call every frame: plays the waiting line once the current one ends. */
  tick(nowS: number): void {
    if (this.pending != null && !this.speaking(nowS) && !this.userSpeaking) {
      const p = this.pending;
      this.pending = null;
      this.say(p.text, nowS + 0.15, p.x, p.y, p.z);
    }
  }

  stop(): void {
    this.pending = null;
    const c = this.current;
    if (c?.entity != null) {
      try {
        AudioUtils.stop(c.entity);
      } catch {
        // Already finished and removed.
      }
    }
    if (c != null && c.clip == null) globalThis.speechSynthesis?.cancel();
    this.current = null;
  }

  private synthesize(text: string, key: string, nowS: number): number {
    const synth = globalThis.speechSynthesis;
    if (synth == null || typeof SpeechSynthesisUtterance === 'undefined') return 0;
    const u = new SpeechSynthesisUtterance(speakable(text));
    const voices = synth.getVoices().filter((v) => v.lang.startsWith('en'));
    const preferred = voices.find((v) => /natural|samantha|serena|google uk english female|zira|aria/iu.test(v.name)) ?? voices[0];
    if (preferred != null) u.voice = preferred;
    u.rate = 0.92;
    u.pitch = 1.0;
    u.volume = 0.9 * mixLevels.voice;
    synth.cancel();
    synth.speak(u);
    const seconds = 0.45 + text.length * 0.065;
    this.current = { clip: null, start: nowS, until: nowS + seconds, entity: null };
    this.lastKey = key;
    this.lastAt = nowS;
    return seconds;
  }
}
