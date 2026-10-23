/**
 * Living places — the orchestrator (hooked like RainField in desk-visuals.ts and ritual-system.ts).
 *
 *   const living = new LivingPlaces(world, backdrop);
 *   living.anchor(x, z, yaw)        the floor point under your eyes, facing the desk (same as the rain)
 *   living.setPlace(id)             after backdrop.go(id) resolves: builds that place's life (once), fades it in;
 *                                   every other place's life fades out and stops its sound
 *   living.update(dt)               each frame (a few flops: fade, wave clock, crackle timer, fire light)
 *   living.setBreath(frame | null)  Breathe: the waves follow your breath, the embers breathe
 *   living.onStoneReleased()        Release: the far fire throws a gerbe of sparks
 *   living.setGoodNight(on)         Good night: the fire settles to embers, crackles space out
 *   living.audioLog = sounds.log    every sound it starts goes into the app's audio log (demo film)
 *
 * Nothing is built or loaded until its place is first shown; your room shows nothing and plays nothing.
 * Panoramas: any place can get a life by adding an entry to LIFE (logic/living.ts); a new panorama for "Ember fire"
 * only needs its `photo` / `fallback` / `thumb` paths in places.ts (the fire's yaw and distances live in LIFE).
 */
import { Group, Mesh, Object3D, Vector3, Vector4, type Camera, type World } from '@iwsdk/core';
import type { PlaceBackdrop } from '../environment.ts';
import { PLACES, type PlaceId } from '../../logic/places.ts';
import { perfOpts } from '../../perf-opts.ts';
import {
  CrackleScheduler,
  EYE_HEIGHT,
  fireLight,
  firePosition,
  lifeOf,
  LIVING_SOUNDS,
  nextShootingStar,
  ONE_SHOT_CEILING,
  prng,
  shoreDistance,
  WaveClock,
  type BreathLike,
  type PlaceLife,
} from '../../logic/living.ts';
import { rig } from '../materials.ts';
import { LivingSound, type AudioLogEntry } from './audio.ts';
import { Campfire } from './fire.ts';
import { fireUniforms } from './fire-light.ts';
import { createHearthPatch } from './hearth.ts';
import { createAmbientPatch } from './ambient.ts';
import { createFireflies } from './fireflies.ts';
import { backdropUniforms, type Uniforms } from './pano.ts';
import { createShootingStar } from './sky.ts';
import { createSnow } from './snow.ts';
import { createSeaPatch, createWaveSheet } from './waves.ts';

/**
 * 25 Oct (axe 5): the panorama's ground is projected on the real ground plane (backdrop `groundDir`), so moving the
 * head gives motion parallax and each eye a slightly different ground: depth for ~10 ALU per pixel, no extra draw.
 * Off → the photo stays at infinity as before.
 */
export const GROUND_PARALLAX = true;

const { crackles: CRACKLES, surfs: SURFS, embers: EMBERS, sea: SEA, wind: WIND } = LIVING_SOUNDS;

interface Built {
  id: PlaceId;
  life: PlaceLife;
  /** Seat-frame group (anchored at the floor point under the eyes, turned with the desk and the photo). */
  root: Group;
  /** Meshes drawn right now (perf report). */
  meshes: Mesh[];
  sound: LivingSound;
  fire: Campfire | null;
  clock: WaveClock | null;
  star: Mesh | null;
  /** 26 Oct (adaptive quality): what 'simple' hides — snow, fireflies, sparks, the shooting star. */
  light: Object3D[];
  /**
   * 26 Oct (draw budget): the photo patches (hearth, sea, ambient, fire glow) hang on the shared root, not on the
   * place's own root — they used to stay drawn after leaving their place: one draw call per eye for every place
   * visited (+8 after a tour), and their animation painted over the next place's photo. They follow the place now.
   */
  patches: Object3D[];
}

export class LivingPlaces {
  readonly root = new Group();
  private readonly world: World;
  private readonly backdrop: PlaceBackdrop;
  private readonly built = new Map<PlaceId, Built>();
  private current: Built | null = null;
  private leaving: Built[] = [];
  private fade = 0;
  private target = 0;
  private readonly shared: Uniforms;
  private anchored = false;
  private groundParallax = GROUND_PARALLAX;
  private readonly anchorPos = new Vector3();
  private anchorYaw = 0;
  private breath: BreathLike | null = null;
  private goodNight = false;
  private fireLevel = 1;
  private nextCrackle = 3;
  private readonly crackles = new CrackleScheduler(CRACKLES.length);
  private readonly rnd = prng(77);
  private nextStar = 40;
  private starT = -10;
  private readonly head = new Vector3();
  private headCheck = 0;
  private log: AudioLogEntry[] = [];

  constructor(world: World, backdrop: PlaceBackdrop) {
    this.world = world;
    this.backdrop = backdrop;
    const fade = { value: 0 };
    this.shared = {
      ...backdropUniforms(backdrop),
      ...(fireUniforms as unknown as Uniforms),
      uDim: rig.uDim as unknown as { value: unknown },
      // Breathe's veil: 3D effects drawn in front of it (fire, fireflies) dim themselves by this (lights less).
      uRoomDim: rig.uRoomDim as unknown as { value: unknown },
      uFade: fade,
      uLivingFade: fade,
      uLivingYaw: { value: 0 },
      uImm: backdrop.stateUniform as unknown as { value: unknown },
      uWhich: { value: 1 },
      uFireLevel: { value: 1 },
      uFlick: { value: 1 },
      uWave: { value: new Vector4(0.5, 0.6, 0.6, 0) },
      uWave2: { value: new Vector4(9, 9, 0, 0) },
      uSea: { value: new Vector4(0, 7, EYE_HEIGHT, 0) },
      uGroundY: { value: -EYE_HEIGHT },
      uFireTop: { value: new Vector4(30, -8, 4, 0) },
      uStar: { value: new Vector4(-100, 0, 0, 0) },
      uStarDir: { value: new Vector4(0, 0.5, -1, 0) },
    };
    this.root.visible = false;
    world.createTransformEntity(this.root);
  }

  /** Every sound this module starts is written here (attach the app's cue log for the demo film). */
  set audioLog(log: AudioLogEntry[]) {
    this.log = log;
    for (const b of this.built.values()) b.sound.log = log;
  }

  get audioLog(): AudioLogEntry[] {
    return this.log;
  }

  /** Same anchor as the rain: the floor point under your eyes, facing the desk. */
  anchor(x: number, z: number, yaw: number): void {
    this.anchorPos.set(x, 0, z);
    this.anchorYaw = yaw;
    this.anchored = true;
    this.updateGround();
    if (this.current != null) this.shared.uLivingYaw.value = yaw + PLACES[this.current.id].yaw;
    for (const b of this.built.values()) this.place(b);
  }

  /**
   * 25 Oct (axe 5): the backdrop's ground projection uses the same ground as these 3D effects — the photo is "taken"
   * from the seated head (the anchor), EYE_HEIGHT above uGroundY — so the photo, the wave sheet and the fire's ground
   * stay one picture when the head moves.
   */
  private updateGround(): void {
    const g = this.shared.uGround?.value as Vector4 | undefined;
    if (g == null) return;
    g.set(this.anchorPos.x, this.groundY() + EYE_HEIGHT, this.anchorPos.z, this.groundParallax && this.anchored && this.current?.life.flatGround === true ? EYE_HEIGHT : 0);
  }

  /** Play-test / A-B switch of the ground projection (the comparison shots and the perf measure). */
  setGroundParallax(on: boolean): void {
    this.groundParallax = on;
    this.updateGround();
  }

  private place(b: Built): void {
    const placeYaw = PLACES[b.id].yaw;
    b.root.position.set(this.anchorPos.x, this.groundY(), this.anchorPos.z);
    b.root.rotation.set(0, this.anchorYaw + placeYaw, 0);
    b.root.updateMatrixWorld(true);
  }

  private groundY(): number {
    return (this.shared.uGroundY.value as number) ?? 0;
  }

  /** Called when the backdrop has started showing `id` (after backdrop.go resolved). */
  /**
   * 25 Oct ("fluide"): builds a place's living layer in advance, compiles its shaders without blocking
   * (`compileAsync`, parallel compilation where the browser has it) and fetches its sounds, in a calm moment, so
   * arriving there freezes no frame. The layer stays hidden until the place is chosen.
   */
  prepare(id: PlaceId, renderer: { compileAsync(scene: Object3D, camera: Camera, target?: Object3D | null): Promise<unknown> }, camera: Camera, scene: Object3D): void {
    if (this.current?.id === id) return;
    const life = lifeOf(id);
    if (life == null) return;
    const b = this.build(id, life);
    b.sound.prefetch();
    // compile() only gathers visible objects: shown for this synchronous call only.
    const was = b.root.visible;
    this.show(b, true);
    void renderer.compileAsync(this.root, camera, scene).catch(() => {});
    this.show(b, was);
  }

  setPlace(id: PlaceId): void {
    if (this.current?.id === id) {
      this.target = 1;
      return;
    }
    if (this.current != null) {
      // The place we leave is now the backdrop's A side; it fades out (faster than the photo's 1.6 s).
      this.leaving.push(this.current);
      this.current = null;
    }
    const life = lifeOf(id);
    if (life == null) {
      this.target = 0;
      this.shared.uWhich.value = 0;
      this.updateGround();
      return;
    }
    this.current = this.build(id, life);
    this.shared.uWhich.value = 1;
    this.shared.uLivingYaw.value = this.anchorYaw + PLACES[id].yaw;
    this.fade = this.leaving.length > 0 ? 0 : this.fade;
    this.target = 1;
    this.show(this.current, true);
    this.current.sound.start();
    this.measureHead(true);
  }

  /** A place's living layer shown or hidden: its own root and its photo patches on the shared root. */
  private show(b: Built, on: boolean): void {
    b.root.visible = on;
    for (const p of b.patches) p.visible = on;
  }

  private build(id: PlaceId, life: PlaceLife): Built {
    const existing = this.built.get(id);
    if (existing != null) return existing;
    const root = new Group();
    this.root.add(root);
    const meshes: Mesh[] = [];
    const patches: Object3D[] = [];
    const sound = new LivingSound(this.world, root);
    sound.log = this.log;
    const loops: Array<{ src: string; volume: number; x: number; y: number; z: number; ref: number }> = [];
    let fire: Campfire | null = null;
    let clock: WaveClock | null = null;
    let star: Mesh | null = null;
    const at = (yawDeg: number, dist: number, y: number) => {
      const a = (yawDeg * Math.PI) / 180;
      return { x: Math.sin(a) * dist, y, z: -Math.cos(a) * dist };
    };
    if (life.snow != null) {
      const snow = createSnow(life.snow, this.shared);
      snow.userData.livingKind = 'particles';
      root.add(snow);
      meshes.push(snow);
      // A soft, muffled wind outside the two side windows.
      loops.push({ src: WIND, volume: 0.14, ...at(-62, 4.2, EYE_HEIGHT + 0.4), ref: 2.5 }, { src: WIND, volume: 0.12, ...at(64, 4.2, EYE_HEIGHT + 0.4), ref: 2.5 });
    }
    if (life.hearth != null) {
      const patch = createHearthPatch(life.hearth, this.backdrop, this.shared);
      if (patch != null) {
        this.root.add(patch);
        meshes.push(patch);
        patches.push(patch);
      }
      loops.push({ src: EMBERS, volume: 0.12, ...at(life.hearth.yaw, life.hearth.dist, life.hearth.height), ref: 1.6 });
      sound.preload(CRACKLES);
    }
    if (life.waves != null) {
      const sea = createSeaPatch(life.waves, this.backdrop, this.shared);
      if (sea != null) {
        this.root.add(sea);
        meshes.push(sea);
        patches.push(sea);
      }
      const sheet = createWaveSheet(life.waves, this.backdrop, this.shared);
      root.add(sheet);
      meshes.push(sheet);
      clock = new WaveClock(life.waves);
      (this.shared.uSea.value as Vector4).set(life.waves.sunYaw, life.waves.glitterHalfWidth, EYE_HEIGHT, 0);
      // The open sea on both sides, far.
      loops.push({ src: SEA, volume: 0.16, ...at(-55, 14, 0.5), ref: 6 }, { src: SEA, volume: 0.16, ...at(50, 14, 0.5), ref: 6 });
      sound.preload(SURFS);
    }
    if (life.fire != null) {
      fire = new Campfire(life.fire, this.backdrop, this.shared);
      root.add(fire.group);
      root.add(fire.ground);
      meshes.push(fire.hearth, fire.flames, fire.sparks, fire.ground);
      if (fire.glow != null) {
        this.root.add(fire.glow);
        meshes.push(fire.glow);
        patches.push(fire.glow);
      }
      loops.push({ src: EMBERS, volume: 0.32, x: 0, y: 0.2, z: 0, ref: 2.2 });
      sound.preload(CRACKLES);
    }
    if (life.fireflies != null) {
      const ff = createFireflies(life.fireflies, this.shared);
      ff.userData.livingKind = 'particles';
      root.add(ff);
      meshes.push(ff);
    }
    if (life.ambient != null) {
      const patch = createAmbientPatch(life.ambient, this.backdrop, this.shared);
      if (patch != null) {
        this.root.add(patch);
        meshes.push(patch);
        patches.push(patch);
      }
    }
    if (life.shootingStars === true) {
      star = createShootingStar(this.shared);
      this.root.add(star);
    }
    sound.setLoops(loops);
    const light: Object3D[] = [];
    for (const m of meshes) if (m.userData.livingKind === 'particles') light.push(m);
    if (fire != null) light.push(fire.sparks);
    if (star != null) light.push(star);
    const b: Built = { id, life, root, meshes, sound, fire, clock, star, light, patches };
    this.built.set(id, b);
    this.place(b);
    this.show(b, false);
    return b;
  }

  /** Breathe: the frame of the breath (logic/breathe.ts), or null when not breathing. */
  setBreath(frame: BreathLike & { level?: number } | null): void {
    this.breath = frame;
    (fireUniforms.uFireBurst.value as Vector4).w = frame != null && (frame.phase === 'in' || frame.phase === 'out') ? (frame.level ?? 0.5) : 0.5;
  }

  /** Release: the stone touched the water. */
  onStoneReleased(): void {
    if (this.current?.fire == null || this.fade < 0.5) return;
    const now = this.now();
    (fireUniforms.uFireBurst.value as Vector4).z = now;
    this.crackle(1, true);
  }

  private level: 'full' | 'simple' | 'off' = 'full';

  /** 26 Oct (adaptive quality / safe mode): full, simple (no snow, fireflies, sparks, shooting star), or off. */
  setLevel(level: 'full' | 'simple' | 'off'): void {
    this.level = level;
    // Back to full: what 'simple' hid comes back (the shooting star keeps its own timing).
    if (level === 'full') for (const b of this.built.values()) for (const o of b.light) if (o !== b.star) o.visible = true;
  }

  /** After update(): hides what the level saves (sounds go on; the photo stays as it is). */
  enforceLevel(): void {
    // 26 Oct (CPU pass): a place's living layer that is not shown (built earlier, kept for later) skips the scene
    // graph's matrix updates — its meshes and its positional sounds were recomputed every frame for nothing.
    for (const b of this.built.values()) b.root.matrixWorldAutoUpdate = b.root.visible || !perfOpts.on;
    if (this.level === 'full') return;
    if (this.level === 'off') {
      this.root.visible = false;
      return;
    }
    for (const b of this.built.values()) for (const o of b.light) o.visible = false;
  }

  setGoodNight(on: boolean): void {
    this.goodNight = on;
  }

  private now(): number {
    return (this.shared.uTime.value as number) ?? 0;
  }

  private crackle(strength: number, big = false): void {
    const b = this.current;
    if (b == null) return;
    const c = this.crackles.next(1 - this.fireLevel);
    const s = Math.min(1, big ? 1 : c.strength * strength);
    const burst = fireUniforms.uFireBurst.value as Vector4;
    burst.x = this.now();
    burst.y = s;
    const gain = Math.min(ONE_SHOT_CEILING, c.gain * ONE_SHOT_CEILING * (big ? 1 : 0.9));
    if (b.fire != null) {
      b.sound.play(CRACKLES[c.sample], 0, 0.15, 0, gain * this.fade, c.rate, 2.0);
    } else if (b.life.hearth != null) {
      const h = b.life.hearth;
      const a = (h.yaw * Math.PI) / 180;
      b.sound.play(CRACKLES[c.sample], Math.sin(a) * h.dist, h.height, -Math.cos(a) * h.dist, gain * 0.55 * this.fade, c.rate, 1.4);
    }
    this.nextCrackle = c.delay;
  }

  private measureHead(force = false): void {
    // The 3D effects sit on the place's ground, EYE_HEIGHT below the eyes (angles then match the photo).
    if (!force && this.headCheck > 0) return;
    this.headCheck = 2;
    this.world.player.head.getWorldPosition(this.head);
    const y = this.head.y > 0.6 ? this.head.y - EYE_HEIGHT : 0;
    if (Math.abs(y - this.groundY()) > 0.01) {
      this.shared.uGroundY.value = y;
      for (const b of this.built.values()) this.place(b);
    }
    this.updateGround();
  }

  /** Draw calls of the living effects right now (perf report). */
  get drawCalls(): number {
    if (!this.root.visible) return 0;
    let n = 0;
    for (const b of [this.current, ...this.leaving]) {
      if (b == null) continue;
      for (const m of b.meshes) if (m.visible && m.parent != null && (m.parent.visible || m.parent === this.root)) n++;
      if (b.star?.visible) n++;
    }
    return n;
  }

  /** State for tests and the perf report. */
  debug(): Record<string, unknown> {
    return {
      place: this.current?.id ?? null,
      fade: +this.fade.toFixed(3),
      drawCalls: this.drawCalls,
      sounds: [...this.built.values()].reduce((n, b) => n + b.sound.playing, 0),
      wave: this.current?.clock == null ? null : { phase: +this.current.clock.phase.toFixed(3), cycle: this.current.clock.cycle, period: +this.current.clock.period.toFixed(2), breathing: this.current.clock.breathing },
      fire: this.current?.fire == null ? null : { level: +this.fireLevel.toFixed(3), light: +(fireUniforms.uFire.value as Vector4).w.toFixed(3), nextCrackle: +this.nextCrackle.toFixed(2) },
      built: [...this.built.keys()],
      roomDim: +((this.shared.uRoomDim.value as number) ?? 0).toFixed(3),
    };
  }

  update(dt: number): void {
    const leavingNow = this.leaving.length > 0;
    const tau = this.target === 0 || leavingNow ? 0.32 : 0.6;
    this.fade += (this.target - this.fade) * (1 - Math.exp(-dt / tau));
    if (this.target === 0 && this.fade < 0.004) this.fade = 0;
    if (leavingNow) {
      // Leave first (fade the old life out), then the new one fades in.
      this.shared.uLivingFade.value = this.fade;
      if (this.fade < 0.01 || this.current == null) {
        for (const b of this.leaving) {
          this.show(b, false);
          b.sound.stop();
          b.sound.setLevel(0);
          if (b.star != null) b.star.visible = false;
        }
        this.leaving = [];
        this.fade = 0;
        if (this.current != null) {
          this.shared.uWhich.value = 1;
          this.target = 1;
        }
      } else {
        this.target = 0;
      }
    }
    this.shared.uLivingFade.value = this.fade;
    const any = this.current != null || this.leaving.length > 0;
    this.root.visible = any && this.fade > 0;
    for (const b of this.leaving) b.sound.setLevel(this.fade);
    const b = this.current;
    const fire = fireUniforms.uFire.value as Vector4;
    if (b == null) {
      fire.w = 0;
      return;
    }
    if (this.leaving.length === 0 && this.target === 0 && this.fade === 0) {
      b.sound.stop();
      fire.w = 0;
      return;
    }
    if (this.leaving.length === 0) this.target = 1;
    this.show(b, true);
    b.sound.setLevel(this.fade);
    this.headCheck -= dt;
    this.measureHead();
    const t = this.now();
    // Waves.
    if (b.clock != null) {
      const started = b.clock.step(dt, this.breath);
      const w = this.shared.uWave.value as Vector4;
      w.set(b.clock.phase, b.clock.reach, b.clock.prevReach, b.clock.cycle % 64);
      (this.shared.uWave2.value as Vector4).set(b.clock.period, b.clock.prevPeriod, 0, 0);
      if (started && this.fade > 0.2) {
        // The surf where this wave breaks, ahead of you, a little to one side or the other.
        // The surf where this wave breaks: on the photo's line of breaking foam (≈ 1 m beyond the water line).
        const yawDeg = (this.rnd() - 0.5) * 60;
        const yaw = (yawDeg * Math.PI) / 180;
        const r = (shoreDistance(b.life.waves!, yawDeg) ?? 2.2) + 1.0;
        const k = Math.floor(this.rnd() * SURFS.length);
        b.sound.play(SURFS[k], Math.sin(yaw) * r, 0.1, -Math.cos(yaw) * r, ONE_SHOT_CEILING * (0.55 + 0.3 * this.rnd()) * this.fade, 0.94 + 0.12 * this.rnd(), 2.5);
      }
    }
    // Fire (campfire or fireplace): level, light, crackles.
    const hasFire = b.fire != null || b.life.hearth != null;
    if (hasFire) {
      const goal = this.goodNight ? 0.18 : 1;
      this.fireLevel += (goal - this.fireLevel) * (1 - Math.exp(-dt / (this.goodNight ? 9 : 3)));
      this.shared.uFireLevel.value = this.fireLevel;
      this.nextCrackle -= dt;
      if (this.nextCrackle <= 0 && this.fade > 0.3) this.crackle(1);
      const burst = fireUniforms.uFireBurst.value as Vector4;
      const breathK = this.breath != null && (this.breath.phase === 'in' || this.breath.phase === 'out') ? 0.92 + 0.16 * burst.w : 1;
      const light = fireLight(t, t - burst.x, burst.y, this.fireLevel) * breathK;
      this.shared.uFlick.value = light;
      if (b.fire != null) {
        const spec = b.life.fire!;
        const imm = (this.backdrop.stateUniform.value as Vector4).w;
        const p = firePosition(spec, imm);
        b.fire.group.position.set(p.x, 0, p.z);
        const gu = b.fire.groundMaterial.uniforms.uGround.value as number[];
        gu[0] = p.x;
        gu[1] = p.z;
        b.fire.group.updateMatrixWorld(true);
        // The light hangs in the flames; the photo patch knows where the flame tips are.
        const lp = b.fire.group.localToWorld(LIGHT_LOCAL.clone());
        fire.set(lp.x, lp.y, lp.z, 1.25 * light * this.fade);
        b.fire.ground.visible = imm > 0.85;
        const top = (this.shared.uFireTop.value as Vector4);
        const eye = EYE_HEIGHT;
        top.set(spec.yaw, (Math.atan2(0.55 - eye, p.dist) * 180) / Math.PI, Math.max(1.5, (Math.atan2(0.3, p.dist) * 180) / Math.PI), 0);
      } else if (b.life.hearth != null) {
        const h = b.life.hearth;
        const a = (h.yaw * Math.PI) / 180;
        const lp = b.root.localToWorld(new Vector3(Math.sin(a) * h.dist, h.height + 0.25, -Math.cos(a) * h.dist));
        // The painted fire is already in the SH light of the tray: only its flicker is added (mean ≈ 0, no double count).
        const flick = (light - (0.25 + 0.75 * this.fireLevel)) * 1.4 * this.fade;
        fire.set(lp.x, lp.y, lp.z, Math.abs(flick) < 1e-4 ? 1e-4 : flick);
      }
    } else {
      fire.w = 0;
    }
    // A rare shooting star.
    if (b.star != null) {
      this.nextStar -= dt;
      if (this.nextStar <= 0) {
        this.nextStar = nextShootingStar(this.rnd);
        this.starT = t;
        const yaw = ((this.rnd() - 0.5) * 140 * Math.PI) / 180;
        const pitch = ((22 + this.rnd() * 30) * Math.PI) / 180;
        (this.shared.uStar.value as Vector4).set(t, 0.9 + this.rnd() * 0.5, (this.rnd() - 0.5) * 1.2, 0);
        (this.shared.uStarDir.value as Vector4).set(yaw, pitch, 0, 0);
      }
      b.star.visible = t - this.starT < 1.6;
    }
  }

  /** Test hook: a shooting star now. */
  shootStar(): void {
    this.nextStar = 0;
  }

  /** Test hook: a crackle now. */
  crackleNow(): void {
    this.nextCrackle = 0;
  }
}

const LIGHT_LOCAL = new Vector3(0, 0.28, 0);
void Object3D;
