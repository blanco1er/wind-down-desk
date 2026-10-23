/**
 * Places: a 360° evening backdrop that can replace the far view (visionOS
 * "Environments"). Default is your own room (passthrough): nothing is drawn
 * and nothing is loaded.
 *
 * - One sphere, one draw call, ≈ 2 k triangles, drawn first; it follows the
 *   eye in the vertex shader (the place is at infinity, no parallax).
 * - Panoramas are lazy-loaded the first time a place is chosen: KTX2 / Basis
 *   ETC1S, 6144 × 2048 in a cylindrical equal-area layout (≈ 17 px/° at the
 *   horizon, 1.2–1.6 MB to download), transcoded to ETC2 on Quest = 6 MiB of
 *   GPU memory per loaded place, no mipmaps. The Basis transcoder (public/basis,
 *   0.58 MB) is fetched with the first place only. At most two places live
 *   during a crossfade; the one you left is released afterwards. If KTX2 fails,
 *   a 2048 × 1024 equirectangular JPG is used instead.
 * - Crossfade (1.6 s) between places, or from / to passthrough via alpha.
 * - "Table stays" (default): the lower part of the view, your real table
 *   and hands, stays passthrough; "Full": the place surrounds you.
 * - The lamp-light rig of the desk follows the place (warm key, place fill).
 */
import {
  BackSide,
  LinearFilter,
  Mesh,
  NoColorSpace,
  NormalBlending,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  TextureLoader,
  Vector2,
  Vector4,
} from '@iwsdk/core';
import type { WebGLRenderer } from '@iwsdk/core';
import { ktx2Loader } from './ktx2.ts';
import { adaptLight, mixLight, PLACES, ROOM_LIGHT, type Immersion, type Place, type PlaceId, type PlaceLight, type PlaceMeasure } from '../logic/places.ts';
import { rig, timeUniform } from './materials.ts';
import { gradedRadiance, lerpSH, projectSH, type SH9 } from '../logic/sh-light.ts';

/** Told when the place or immersion changes (the emulator film set listens). */
export const placeListeners: Array<(place: PlaceId, immersion: Immersion, coverage: number) => void> = [];

const FADE_SECONDS = 1.6;
const GROUND_SHADE = 0.22;

/** How much the evening darkens a place (0..1): `grade.evening` when a place sets it (night panoramas), else 1. */
function eveningStrength(place: (typeof PLACES)[PlaceId]): number {
  const v = (place.grade as { evening?: number }).evening;
  return typeof v === 'number' ? Math.max(0, Math.min(1, v)) : 1;
}

/** How dark the ground near you sinks (PlaceGrade.ground, default 0.22 for the dusk photos). */
function groundShade(place: (typeof PLACES)[PlaceId]): number {
  const v = (place.grade as { ground?: number }).ground;
  return typeof v === 'number' ? Math.max(0, Math.min(1, v)) : GROUND_SHADE;
}

/** Places prepared in advance, besides the current one (6 MiB of GPU memory each on Quest). */
const PREPARED_MAX = 2;

/** Projection of a loaded panorama: 1 = equal-area KTX2 (row 0 = zenith), 0 = equirectangular JPG (flipY). */
type Loaded = { texture: Texture; equalArea: boolean; gpuBytes: number };

type Ktx2 = NonNullable<ReturnType<typeof ktx2Loader>>;

function gradeVectors(place: Place): [Vector4, Vector4] {
  const g = place.grade;
  // Never a daylight view at bedtime (owner, 18 Oct): the brightest panoramas are capped.
  return [new Vector4(Math.min(g.exposure, 0.86), g.saturation, g.night, g.rain), new Vector4(g.tint[0], g.tint[1], g.tint[2], g.stars)];
}

export class PlaceBackdrop {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly loader = new TextureLoader();
  private readonly textures = new Map<PlaceId, Loaded>();
  /** Each place's light, read once from its thumbnail (owner, 19 Oct: the tray matches the place). */
  private readonly measures = new Map<PlaceId, PlaceMeasure>();
  private readonly measuring = new Set<PlaceId>();
  /** Graded radiance of each place (64 × 32, from its thumbnail) and its last SH projection (cached by yaw / immersion). */
  private readonly radiance = new Map<PlaceId, Float32Array>();
  private readonly shCache = new Map<PlaceId, { key: string; sh: SH9 }>();
  private readonly loading = new Map<PlaceId, Promise<Loaded | null>>();
  private renderer: WebGLRenderer | null = null;
  private ktx2: Promise<Ktx2 | null> | null = null;
  /** Format the GPU received for the last KTX2 panorama (for the perf report). */
  lastFormat = '';
  private from: PlaceId = 'room';
  private to: PlaceId = 'room';
  private progress = 1;
  private immersion: Immersion = 'table';
  private immersionValue = 0;
  private deskYaw = 0;
  private readonly light: PlaceLight = { key: [...ROOM_LIGHT.key], fillSky: [...ROOM_LIGHT.fillSky], fillGround: [...ROOM_LIGHT.fillGround] };

  constructor() {
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: BackSide,
      blending: NormalBlending,
      uniforms: {
        uTime: timeUniform,
        uDim: rig.uDim,
        uEvening: { value: 0.12 },
        // How strongly the evening darkens place A / B (PlaceGrade.evening, default 1; night panoramas ≈ 0.35).
        // x, y: evening strength of A / B; z, w: how dark their ground sinks (PlaceGrade.ground, default 0.22).
        uEveningAB: { value: new Vector4(1, 1, 0.22, 0.22) },
        uTexA: { value: null },
        uTexB: { value: null },
        uGradeA0: { value: new Vector4(1, 1, 0, 0) },
        uGradeA1: { value: new Vector4(1, 1, 1, 0) },
        uGradeB0: { value: new Vector4(1, 1, 0, 0) },
        uGradeB1: { value: new Vector4(1, 1, 1, 0) },
        // x: photo A present, y: photo B present, z: crossfade, w: immersion (0 table-stays … 1 full)
        uState: { value: new Vector4(0, 0, 1, 0) },
        // yaw of A, yaw of B (photo + desk); z, w: A / B use the equal-area layout
        uYaw: { value: new Vector4(0, 0, 0, 0) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec3 world = cameraPosition + vDir * 60.0;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uDim;
        uniform float uEvening;
        uniform vec4 uEveningAB;
        uniform sampler2D uTexA;
        uniform sampler2D uTexB;
        uniform vec4 uGradeA0;
        uniform vec4 uGradeA1;
        uniform vec4 uGradeB0;
        uniform vec4 uGradeB1;
        uniform vec4 uState;
        uniform vec4 uYaw;
        varying vec3 vDir;
        const float PI = 3.14159265;
        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        // The evening deepens with the rituals (uEvening 0..1, logic/evening-light.ts): exposure and colour sink,
        // the light turns blue, the bright sky goes blue-black. col: linear colour after the place's grade.
        // skyMask: how much this direction is bright sky (0 if unknown). Also used by the living places' effects.
        vec3 eveningGradeK(vec3 col, vec3 d, float skyMask, float strength) {
          float e = uEvening * strength;
          col *= mix(0.92, 0.3, e);
          float l2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(l2), col, 1.0 - 0.5 * e);
          col *= mix(vec3(1.0), vec3(0.74, 0.85, 1.12), e);
          return mix(col, vec3(0.004, 0.007, 0.018) + vec3(l2) * vec3(0.01, 0.014, 0.03), skyMask * clamp(e * 0.85, 0.0, 1.0));
        }
        vec3 eveningGrade(vec3 col, vec3 d, float skyMask) {
          return eveningGradeK(col, d, skyMask, 1.0);
        }
        vec3 place(sampler2D tex, vec3 d, float yaw, float equalArea, vec4 g0, vec4 g1, float strength, float groundShade) {
          float u = atan(d.x, -d.z) / (2.0 * PI) + 0.5 + yaw / (2.0 * PI);
          // Equal-area KTX2: v = 0.5 − 0.5·sin(latitude), row 0 at the zenith (not flipped).
          float v = equalArea > 0.5 ? 0.5 - 0.5 * clamp(d.y, -1.0, 1.0) : asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5;
          vec3 c = pow(texture2D(tex, vec2(fract(u), v)).rgb, vec3(2.2));
          float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
          // Day-for-night: the bright sky sinks to deep blue; the rest goes dark and cool.
          float sky = smoothstep(0.25, 0.7, luma) * smoothstep(-0.05, 0.25, d.y);
          vec3 col = mix(vec3(luma), c, g0.y) * g1.rgb * g0.x;
          col = mix(col, vec3(0.006, 0.011, 0.024) + vec3(luma) * vec3(0.01, 0.015, 0.03), sky * g0.z);
          // Evening: the ground near you sinks into shadow, the eye goes to the horizon.
          // (Night panoramas whose life is on the ground, a beach, a fire, keep more of it: PlaceGrade.ground.)
          col *= mix(groundShade, 1.0, smoothstep(-0.4, 0.03, d.y));
          // A place that is already night (grade.evening < 1) only deepens gently: never unreadable.
          col = eveningGradeK(col, d, sky * (1.0 - g0.z), strength);
          // Stars in the dark upper sky (grid of 0.5°, sparse, twinkling).
          if (g1.w > 0.0 && d.y > 0.06) {
            vec2 a = vec2(atan(d.x, -d.z) + yaw, asin(d.y)) * (180.0 / PI) * 2.0;
            vec2 cell = floor(a);
            float h = hash12(cell);
            vec2 f = fract(a) - (0.25 + 0.5 * vec2(hash12(cell + 7.1), hash12(cell + 3.7)));
            float star = step(0.985, h) * exp(-dot(f, f) * 90.0);
            float tw = 0.65 + 0.35 * sin(uTime * (1.0 + h * 3.0) + h * 50.0);
            float dark = 1.0 - smoothstep(0.004, 0.03, dot(col, vec3(0.2126, 0.7152, 0.0722)));
            col += vec3(0.95, 0.93, 1.0) * star * tw * dark * g1.w * smoothstep(0.06, 0.25, d.y) * 0.5;
          }
          // Soft rain: two layers of thin falling streaks, faint, and a little mist low down.
          if (g0.w > 0.0) {
            float ang = atan(d.x, -d.z);
            float r = 0.0;
            for (int i = 0; i < 2; i++) {
              float s = i == 0 ? 90.0 : 150.0;
              vec2 q = vec2(ang * s / PI, d.y * s * 0.32 + uTime * (i == 0 ? 7.0 : 10.0));
              vec2 cell = floor(q);
              float h = hash12(cell + float(i) * 17.0);
              vec2 f = fract(q);
              float x = abs(f.x - 0.2 - 0.6 * h);
              r += step(0.62, h) * (1.0 - smoothstep(0.0, 0.03, x)) * smoothstep(0.0, 0.35, f.y) * (1.0 - smoothstep(0.55, 1.0, f.y)) * (i == 0 ? 0.6 : 0.35);
            }
            col += vec3(0.5, 0.58, 0.68) * r * 0.12 * g0.w;
            col += vec3(0.03, 0.036, 0.045) * (1.0 - smoothstep(-0.1, 0.15, abs(d.y))) * g0.w;
          }
          return col;
        }
        void main() {
          vec3 d = normalize(vDir);
          vec3 a = uState.x > 0.5 ? place(uTexA, d, uYaw.x, uYaw.z, uGradeA0, uGradeA1, uEveningAB.x, uEveningAB.z) : vec3(0.0);
          vec3 b = uState.y > 0.5 ? place(uTexB, d, uYaw.y, uYaw.w, uGradeB0, uGradeB1, uEveningAB.y, uEveningAB.w) : vec3(0.0);
          float k = uState.z;
          vec3 col = mix(a, b, k);
          float alpha = mix(uState.x, uState.y, k);
          // Table stays: the lower view (your real table and hands) remains passthrough.
          float keep = mix(smoothstep(-0.4, -0.14, d.y), 1.0, uState.w);
          alpha *= keep;
          if (alpha < 0.002) discard;
          col *= 1.0 - uDim * 0.45;
          col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
          col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -8;
    this.mesh.raycast = () => {};
    this.mesh.visible = false;
  }

  private applyLight(l: { key: [number, number, number]; fillSky: [number, number, number]; fillGround: [number, number, number] }, e: number): void {
    const key = 1 - 0.72 * e;
    const fill = 1 - 0.4 * e;
    rig.uKeyColor.value.set(l.key[0] * key, l.key[1] * key, l.key[2] * key);
    rig.uFillSky.value.set(l.fillSky[0] * fill, l.fillSky[1] * fill, l.fillSky[2] * fill);
    rig.uFillGround.value.set(l.fillGround[0] * fill, l.fillGround[1] * fill, l.fillGround[2] * fill);
  }

  /** How deep into the night the evening is (0..1, logic/evening-light.ts). */
  setEvening(depth: number): void {
    (this.material.uniforms.uEvening as { value: number }).value = depth;
  }

  /** v8: the crossfade/immersion uniform (the rain reads the same "Table stays" mask). */
  get stateUniform(): { value: Vector4 } {
    return this.material.uniforms.uState as { value: Vector4 };
  }

  /** Needed once to pick the GPU format the KTX2 panoramas are transcoded to. */
  setRenderer(renderer: WebGLRenderer): void {
    this.renderer = renderer;
  }

  /** GPU bytes held by place panoramas right now (0 in your room). */
  gpuBytes(): number {
    let total = 0;
    for (const loaded of this.textures.values()) total += loaded.gpuBytes;
    return total;
  }

  get place(): PlaceId {
    return this.to;
  }

  get immersionLevel(): Immersion {
    return this.immersion;
  }

  /** The photo is oriented relative to the desk (what you face when seated). */
  setDeskYaw(yaw: number): void {
    this.deskYaw = yaw;
    this.applyYaw();
  }

  setImmersion(level: Immersion): void {
    this.immersion = level;
    this.notify();
  }

  /** Lazy-loads the photo (once) and starts the crossfade. Resolves false if the photo is unavailable. */
  async go(id: PlaceId): Promise<boolean> {
    if (id === this.to && this.progress >= 1) {
      return true;
    }
    const place = PLACES[id];
    this.measure(id);
    if ((place.photo != null || place.fallback != null) && !this.textures.has(id)) {
      const texture = await this.load(id);
      if (texture == null) {
        return false;
      }
    }
    // Start from what is on screen now.
    this.from = this.progress < 0.5 ? this.from : this.to;
    this.to = id;
    this.progress = 0;
    const u = this.material.uniforms;
    const a = PLACES[this.from];
    const b = PLACES[this.to];
    u.uTexA.value = this.textures.get(a.id)?.texture ?? null;
    u.uTexB.value = this.textures.get(b.id)?.texture ?? null;
    [u.uGradeA0.value, u.uGradeA1.value] = gradeVectors(a);
    [u.uGradeB0.value, u.uGradeB1.value] = gradeVectors(b);
    (u.uEveningAB.value as Vector4).set(eveningStrength(a), eveningStrength(b), groundShade(a), groundShade(b));
    u.uState.value.x = a.photo != null ? 1 : 0;
    u.uState.value.y = b.photo != null ? 1 : 0;
    u.uState.value.z = 0;
    this.applyYaw();
    this.mesh.visible = true;
    this.notify();
    return true;
  }

  /**
   * 25 Oct ("fluide"): places prepared in a calm moment — downloaded, transcoded AND already on the GPU — so choosing
   * one later starts its crossfade at once, without the frozen frame of a first upload. At most PREPARED_MAX are
   * kept besides the current place (6 MiB of GPU memory each on Quest).
   */
  private readonly prepared: PlaceId[] = [];

  async prepare(id: PlaceId): Promise<boolean> {
    const place = PLACES[id];
    this.measure(id);
    if (id === this.to || (place.photo == null && place.fallback == null)) return true;
    const loaded = await this.load(id);
    if (loaded == null) return false;
    // The upload happens now (a calm moment), not on the first frame of the crossfade.
    this.renderer?.initTexture(loaded.texture);
    if (!this.prepared.includes(id)) this.prepared.push(id);
    while (this.prepared.length > PREPARED_MAX) {
      const old = this.prepared.shift();
      if (old != null && old !== this.to && old !== this.from) this.release(old);
    }
    return true;
  }

  get preparedPlaces(): readonly PlaceId[] {
    return this.prepared;
  }

  private release(id: PlaceId): void {
    const loaded = this.textures.get(id);
    if (loaded != null) loaded.texture.dispose();
    this.textures.delete(id);
    this.loading.delete(id);
  }

  /** Prefetch thumbnails / photos (e.g. when the picker opens). */
  preload(id: PlaceId): void {
    if (PLACES[id].photo != null || PLACES[id].fallback != null) {
      void this.load(id);
    }
    this.measure(id);
  }

  /**
   * Reads the place's light from its thumbnail (a 384 × 192 equirectangular copy, already shipped for the menu):
   * mean linear colour of the sky half and the ground half. The tray then takes that light (adaptLight).
   */
  private measure(id: PlaceId): void {
    const place = PLACES[id];
    if (place.thumb == null || this.measures.has(id) || this.measuring.has(id)) return;
    this.measuring.add(id);
    const img = new Image();
    img.onload = () => {
      try {
        const w = 64;
        const h = 32;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx == null) return;
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        const lin = (v: number) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        const sky = [0, 0, 0];
        const ground = [0, 0, 0];
        for (let y = 0; y < h; y++) {
          // Equirectangular rows: weight by cos(latitude) so the poles do not count more than the horizon.
          const wgt = Math.cos(((y + 0.5) / h - 0.5) * Math.PI);
          const acc = y < h / 2 ? sky : ground;
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            acc[0] += lin(data[i]) * wgt;
            acc[1] += lin(data[i + 1]) * wgt;
            acc[2] += lin(data[i + 2]) * wgt;
          }
        }
        const norm = (w * h) / Math.PI;
        const exposure = place.grade.exposure;
        const s = sky.map((v) => (v / norm) * exposure) as [number, number, number];
        const g = ground.map((v) => (v / norm) * exposure) as [number, number, number];
        const lum = 0.5 * (0.2126 * (s[0] + g[0]) + 0.7152 * (s[1] + g[1]) + 0.0722 * (s[2] + g[2]));
        this.measures.set(id, { sky: s, ground: g, lum } satisfies PlaceMeasure);
        this.radiance.set(id, gradedRadiance(data, w, h, place.grade));
      } catch {
        // A tainted or missing image: the hand-tuned light stays.
      }
    };
    img.src = place.thumb;
  }

  /** The place's light as SH, in world space (turned with the panorama), or null until its thumbnail is read. */
  private shOf(id: PlaceId): SH9 | null {
    const rad = this.radiance.get(id);
    if (rad == null || PLACES[id].photo == null) return null;
    const yaw = PLACES[id].yaw + this.deskYaw;
    const keep = this.immersionValue;
    const key = `${yaw.toFixed(3)}|${keep.toFixed(2)}`;
    const cached = this.shCache.get(id);
    if (cached != null && cached.key === key) return cached.sh;
    const g = ROOM_LIGHT.fillGround;
    const sh = projectSH(rad, 64, 32, yaw, keep, [g[0], g[1], g[2]]);
    this.shCache.set(id, { key, sh });
    return sh;
  }

  /** Shares the place's light with the tray: SH coefficients, how much they light it, the evening grade. */
  private applyWorldLight(k: number): void {
    const a = this.shOf(this.from);
    const b = this.shOf(this.to);
    const mixA = a != null ? 1 : 0;
    const mixB = b != null ? 1 : 0;
    const sh = a != null && b != null ? lerpSH(a, b, k) : (b ?? a);
    if (sh != null) {
      const v = rig.uSH.value;
      for (let i = 0; i < 9; i++) v[i].set(sh[i * 3], sh[i * 3 + 1], sh[i * 3 + 2]);
    }
    rig.uShMix.value = mixA + (mixB - mixA) * k;
    const e = (this.material.uniforms.uEvening as { value: number }).value;
    rig.uEnvEvening.value = e * (eveningStrength(PLACES[this.from]) * (1 - k) + eveningStrength(PLACES[this.to]) * k);
  }

  /** The place's light on the tray, adapted to its photo (and half-way in "Table stays"). */
  private lightOf(id: PlaceId): PlaceLight {
    const place = PLACES[id];
    if (place.photo == null) return place.light;
    return adaptLight(place.light, this.measures.get(id) ?? null, this.immersionValue);
  }

  private load(id: PlaceId): Promise<Loaded | null> {
    const existing = this.loading.get(id);
    if (existing != null) {
      return existing;
    }
    const place = PLACES[id];
    const promise = (async (): Promise<Loaded | null> => {
      let loaded = place.photo != null && place.photo.endsWith('.ktx2') ? await this.loadKtx2(place.photo) : null;
      if (loaded == null && place.fallback != null) {
        loaded = await this.loadJpg(place.fallback);
      }
      if (loaded == null) {
        this.loading.delete(id);
        return null;
      }
      this.textures.set(id, loaded);
      return loaded;
    })();
    this.loading.set(id, promise);
    return promise;
  }

  private ktx2Loader(): Promise<Ktx2 | null> {
    if (this.ktx2 == null) {
      this.ktx2 = (async () => {
        if (this.renderer == null) return null;
        // Shared with the tray's oak (one transcoder worker for the whole app).
        return ktx2Loader(this.renderer);
      })();
    }
    return this.ktx2;
  }

  private async loadKtx2(url: string): Promise<Loaded | null> {
    const loader = await this.ktx2Loader();
    if (loader == null) return null;
    try {
      const texture = await loader.loadAsync(url);
      // Raw sRGB values, decoded in the shader (same path as the JPG): linear GPU format.
      texture.colorSpace = NoColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      const level = (texture as Texture & { mipmaps?: Array<{ data: ArrayBufferView }> }).mipmaps?.[0];
      const format = String((texture as Texture & { format: unknown }).format);
      this.lastFormat = format;
      return { texture, equalArea: true, gpuBytes: level?.data.byteLength ?? 0 };
    } catch {
      return null;
    }
  }

  private loadJpg(url: string): Promise<Loaded | null> {
    return new Promise((resolve) => {
      this.loader.load(
        url,
        (texture) => {
          texture.colorSpace = NoColorSpace;
          texture.generateMipmaps = false;
          texture.minFilter = LinearFilter;
          texture.magFilter = LinearFilter;
          const img = texture.image as { width: number; height: number };
          resolve({ texture, equalArea: false, gpuBytes: img.width * img.height * 4 });
        },
        undefined,
        () => resolve(null),
      );
    });
  }

  private applyYaw(): void {
    const y = this.material.uniforms.uYaw.value;
    // u(forward) = 0.5 + place.yaw / 2π whatever the desk orientation.
    y.x = PLACES[this.from].yaw + this.deskYaw;
    y.y = PLACES[this.to].yaw + this.deskYaw;
    y.z = this.textures.get(this.from)?.equalArea ? 1 : 0;
    y.w = this.textures.get(this.to)?.equalArea ? 1 : 0;
  }

  private notify(): void {
    const coverage = PLACES[this.to].photo == null ? 0 : this.immersion === 'full' ? 1 : 0.5;
    for (const listener of placeListeners) listener(this.to, this.immersion, coverage);
  }

  update(dt: number): void {
    const u = this.material.uniforms;
    // The evening dims the place's light on the desk (key and fill), so the lamp becomes the main light.
    const e = (u.uEvening as { value: number }).value;
    const base = this.progress < 1 ? null : this.lightOf(this.to);
    if (base != null) this.applyLight(base, e);
    this.applyWorldLight(this.progress < 1 ? this.progress * this.progress * (3 - 2 * this.progress) : 1);
    // Immersion eases (2 s) so the room dissolves rather than pops.
    const target = this.immersion === 'full' ? 1 : 0;
    this.immersionValue += (target - this.immersionValue) * (1 - Math.exp(-2.4 * dt));
    u.uState.value.w = this.immersionValue;
    if (this.progress < 1) {
      this.progress = Math.min(1, this.progress + dt / FADE_SECONDS);
      const k = this.progress * this.progress * (3 - 2 * this.progress);
      u.uState.value.z = k;
      const l = mixLight(this.lightOf(this.from), this.lightOf(this.to), k);
      this.applyLight(l, e);
      this.light.key = l.key;
      if (this.progress >= 1) {
        // Release the place we left (GPU memory), keep the one we are in — and the places prepared in advance.
        const i = this.prepared.indexOf(this.to);
        if (i >= 0) this.prepared.splice(i, 1);
        for (const id of [...this.textures.keys()]) {
          if (id !== this.to && !this.prepared.includes(id)) this.release(id);
        }
        this.from = this.to;
        u.uTexA.value = u.uTexB.value;
        u.uGradeA0.value.copy(u.uGradeB0.value);
        u.uGradeA1.value.copy(u.uGradeB1.value);
        (u.uEveningAB.value as Vector4).x = (u.uEveningAB.value as Vector4).y;
        (u.uEveningAB.value as Vector4).z = (u.uEveningAB.value as Vector4).w;
        u.uState.value.x = u.uState.value.y;
        u.uState.value.z = 0;
        this.applyYaw();
        this.mesh.visible = PLACES[this.to].photo != null;
      }
    }
  }
}
