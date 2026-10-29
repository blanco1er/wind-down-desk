/**
 * Keepsakes on your real table (26 Oct, lot 2b; 28 Oct: photoreal): a polished pebble at 3 evenings, a stoneware cup
 * of tea on its saucer at 7 (owner, 28 Oct: a candle doubled the lamp's light — the lamp stays the only light on the
 * table), a little plant at 21 (it grows a little each evening after). They stand on the table just left of the
 * tray, toward the back, in the desk's own frame — so they come back to the same place every evening.
 *
 * Models: generated with Tripo (owner's Studio Pro account), Smart Low Poly, then prepared in Blender
 * (tools/objets-28oct/keepsakes.py): real sizes, one shared texture atlas (albedo; normal xy + roughness), ambient
 * occlusion per vertex. 1.4 k + 2.4 k + 2.9 k triangles. Until they are loaded (or if loading fails), a simple
 * procedural stand-in of each is shown.
 *
 * The cup steams only when you come back for the evening: a fine living steam for the first minute after your
 * arrival, then it fades out (it never smokes all evening). Three thin ribbons facing your eyes, shaped and moved in
 * the shader (no particles on the CPU, nothing allocated per frame).
 *
 * One mesh, one draw call for all three AND the steam (a `part` attribute shows / grows each one).
 */
import {
  BufferAttribute,
  BufferGeometry,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from '@iwsdk/core';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createPebbleGeometry, TRAY } from './geometry.ts';
import { loadKtx2, ktx2Bytes } from './ktx2.ts';
import { RIG, RIG_UNIFORMS, NOISE, timeUniform } from './materials.ts';
import type { Keepsake } from '../logic/milestones.ts';
import { KEEPSAKE_SHADOW, SHADOW_LIFT } from '../logic/keepsake-ground.ts';

/**
 * Desk-local spots, on the table (below the tray floor), just left of the tray (its outer edge is at x = −0.42),
 * toward the back: seen over the tray's wall from the seat, clear of the stones and of your hands. The cup at its
 * real size (10.5 cm saucer, 6 cm cup) between the pebble and the plant, ≥ 2 cm apart.
 */
export const KEEPSAKE_AT: Record<Keepsake, { x: number; z: number }> = {
  pebble: { x: -0.462, z: -0.005 },
  cup: { x: -0.49, z: -0.095 },
  plant: { x: -0.466, z: -0.205 },
};
const PARTS: Keepsake[] = ['pebble', 'cup', 'plant'];
const TABLE_Y = -TRAY.height;
/** The cup's steam origin (cup-local, metres: the tea's surface, from tools/objets-28oct/keepsakes.json). */
const CUP_STEAM: [number, number, number] = [0.0012, 0.048, 0.001];
/** How long the cup steams after you arrive (seconds), and how long it takes to fade out. */
export const STEAM = { seconds: 60, fadeIn: 4, fadeOut: 18 } as const;
const RIBBONS = 3;
const RIBBON_ROWS = 14;
/** Kinds of vertex: textured model, flat-colour stand-in, steam ribbon. */
const TEXTURED = 0;
const FLAT = 1;
const STEAMV = 2;
/** 29 Oct: a soft contact shadow on the table under each keepsake (the saucer's rim no longer reads as floating). */
const SHADOW = 3;

interface Piece {
  geometry: BufferGeometry;
  part: number;
  kind: number;
  color?: [number, number, number];
}

function lathe(points: Array<[number, number]>, segments = 28): BufferGeometry {
  return new LatheGeometry(
    points.map(([r, y]) => new Vector2(r, y)),
    segments,
  );
}

/** Stand-ins while the models load: a grey pebble, a cream cup on its saucer, a terracotta pot with leaves. */
function standIns(): Piece[] {
  const out: Piece[] = [];
  out.push({ geometry: createPebbleGeometry(0.02, 0.015, 0.012, 0, 5, 0).geometry, part: 0, kind: FLAT, color: [0.58, 0.57, 0.55] });
  out.push({ geometry: lathe([[0, 0], [0.03, 0], [0.039, 0.006], [0.037, 0.0075], [0.012, 0.004], [0, 0.004]]), part: 1, kind: FLAT, color: [0.86, 0.82, 0.74] });
  out.push({ geometry: lathe([[0, 0.004], [0.018, 0.004], [0.028, 0.03], [0.03, 0.045], [0.028, 0.045], [0.026, 0.032], [0, 0.04]]), part: 1, kind: FLAT, color: [0.86, 0.82, 0.74] });
  out.push({ geometry: lathe([[0, 0], [0.014, 0], [0.02, 0.034], [0.021, 0.035], [0.019, 0.032], [0, 0.032]]), part: 2, kind: FLAT, color: [0.62, 0.36, 0.24] });
  return out;
}

/** Three steam ribbons (two vertices per row: uv = side −1 / 1, height 0..1), shaped in the vertex shader. */
function steamRibbons(): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const rib: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r < RIBBONS; r++) {
    const o = pos.length / 3;
    for (let j = 0; j <= RIBBON_ROWS; j++) {
      for (const side of [-1, 1]) {
        pos.push(CUP_STEAM[0], CUP_STEAM[1], CUP_STEAM[2]);
        uv.push(side, j / RIBBON_ROWS);
        rib.push(r);
      }
    }
    for (let j = 0; j < RIBBON_ROWS; j++) {
      const a = o + j * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('aRibbon', new BufferAttribute(new Float32Array(rib), 1));
  g.setIndex(idx);
  return g;
}

/** A flat square on the table (uv 0..1 across it), the contact shadow's disc is drawn in the fragment shader. */
function shadowQuad(radius: number): BufferGeometry {
  const y = SHADOW_LIFT;
  const r = radius;
  const g = new BufferGeometry();
  // Two triangles facing up (counter-clockwise seen from above).
  g.setAttribute('position', new BufferAttribute(new Float32Array([-r, y, -r, -r, y, r, r, y, r, -r, y, -r, r, y, r, r, y, -r]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0]), 2));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  return g;
}

/** Merges pieces (desk-placed) and the steam into one non-indexed geometry with the attributes the shader reads. */
function build(pieces: Piece[]): BufferGeometry {
  const steam = steamRibbons().toNonIndexed();
  // The contact shadows first in the buffer: drawn on the table before the keepsakes that stand on them.
  const shadows: Piece[] = PARTS.map((k, part) => ({ geometry: shadowQuad(KEEPSAKE_SHADOW[k].radius), part, kind: SHADOW, color: [KEEPSAKE_SHADOW[k].dark, 0, 0] }));
  const all: Array<{ g: BufferGeometry; part: number; kind: number; color: [number, number, number] }> = [...shadows, ...pieces].map((p) => ({
    g: p.geometry.index != null ? p.geometry.toNonIndexed() : p.geometry,
    part: p.part,
    kind: p.kind,
    color: p.color ?? [1, 1, 1],
  }));
  // The steam last in the buffer: it blends over the cup drawn just before it.
  all.push({ g: steam, part: 1, kind: STEAMV, color: [1, 1, 1] });
  const count = all.reduce((n, p) => n + p.g.getAttribute('position').count, 0);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const tangent = new Float32Array(count * 4);
  const uv = new Float32Array(count * 2);
  const ao = new Float32Array(count).fill(1);
  const albedo = new Float32Array(count * 3);
  const meta = new Float32Array(count * 3);
  const base = new Float32Array(count * 3);
  let o = 0;
  for (const { g, part, kind, color } of all) {
    if (kind !== STEAMV && g.getAttribute('normal') == null) g.computeVertexNormals();
    const at = KEEPSAKE_AT[PARTS[part]];
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const T = g.getAttribute('tangent');
    const U = g.getAttribute('uv');
    const A = g.getAttribute('_ao') ?? g.getAttribute('_AO');
    const R = g.getAttribute('aRibbon');
    for (let i = 0; i < P.count; i++, o++) {
      position.set([P.getX(i) + at.x, P.getY(i) + TABLE_Y, P.getZ(i) + at.z], o * 3);
      if (N != null) normal.set([N.getX(i), N.getY(i), N.getZ(i)], o * 3);
      tangent.set(T != null ? [T.getX(i), T.getY(i), T.getZ(i), T.getW(i)] : [1, 0, 0, 1], o * 4);
      if (U != null) uv.set([U.getX(i), U.getY(i)], o * 2);
      if (A != null) ao[o] = A.getX(i);
      albedo.set(color, o * 3);
      meta.set([part, kind, R != null ? R.getX(i) : 0], o * 3);
      base.set([at.x, TABLE_Y, at.z], o * 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setAttribute('tangent', new BufferAttribute(tangent, 4));
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  geometry.setAttribute('aAo', new BufferAttribute(ao, 1));
  geometry.setAttribute('albedo', new BufferAttribute(albedo, 3));
  geometry.setAttribute('meta', new BufferAttribute(meta, 3));
  geometry.setAttribute('base', new BufferAttribute(base, 3));
  return geometry;
}

export interface KeepsakeUniforms {
  uShow: { value: Vector3 };
  uGlow: { value: Vector3 };
  uGrow: { value: number };
  uSteam: { value: number };
  uAlbedoMap: { value: Texture | null };
  uNrmMap: { value: Texture | null };
  uTextured: { value: number };
}

export class Keepsakes {
  readonly mesh: Mesh;
  private readonly uniforms: KeepsakeUniforms;
  private readonly target = new Vector3(0, 0, 0);
  private readonly glowT = new Vector3(0, 0, 0);
  /** Seconds since the cup started steaming (−1: not steaming). */
  private steamT = -1;
  /** Triangles of the models (for the perf report) and GPU bytes of the atlas. */
  triangles = 0;
  textureBytes = 0;

  constructor() {
    const geometry = build(standIns());
    this.uniforms = {
      uShow: { value: new Vector3() },
      uGlow: { value: new Vector3() },
      uGrow: { value: 0 },
      uSteam: { value: 0 },
      uAlbedoMap: { value: null },
      uNrmMap: { value: null },
      uTextured: { value: 0 },
    };
    const material = new ShaderMaterial({
      side: 2,
      // The steam blends; the keepsakes themselves write alpha 1 and depth (drawn before it in the same call).
      transparent: true,
      depthWrite: true,
      // One pass (three.js draws transparent double-sided materials twice otherwise).
      forceSinglePass: true,
      uniforms: { ...RIG_UNIFORMS, uTime: timeUniform, ...this.uniforms },
      vertexShader: /* glsl */ `
        attribute vec4 tangent;
        attribute float aAo;
        attribute vec3 albedo;
        attribute vec3 meta;
        attribute vec3 base;
        uniform vec3 uShow;
        uniform float uGrow;
        uniform float uTime;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec4 vTangent;
        varying vec2 vUv;
        varying float vAo;
        varying vec3 vAlbedo;
        varying vec3 vMeta;
        void main() {
          float part = meta.x;
          float show = part < 0.5 ? uShow.x : part < 1.5 ? uShow.y : uShow.z;
          vec3 p = base + (position - base) * show;
          // The plant grows a little each evening after the 21st.
          if (part > 1.5) p = base + (p - base) * (0.82 + 0.18 * uGrow);
          vec4 w = modelMatrix * vec4(p, 1.0);
          vNormal = normalize(mat3(modelMatrix) * normal);
          if (meta.y > 1.5 && meta.y < 2.5) {
            // Steam: a ribbon rising from the tea, facing the eye around the vertical, swaying slowly and widening.
            float t = uv.y;
            float rib = meta.z;
            vec3 up = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
            vec3 toEye = cameraPosition - w.xyz;
            vec3 right = normalize(cross(up, toEye));
            vec3 fwd = cross(right, up);
            float H = 0.07 * show;
            float sway = (sin(t * 3.1 + uTime * 0.8 + rib * 2.1) * 0.006 + sin(t * 6.7 - uTime * 1.25 + rib * 4.0) * 0.0022) * t;
            float width = (0.0035 + 0.011 * t) * show;
            w.xyz += right * (sway + uv.x * width + (rib - 1.0) * 0.0035 * t) + fwd * sin(rib * 1.7 + t * 2.3) * 0.004 * t + up * (t * H);
            vNormal = normalize(toEye);
          }
          vWorld = w.xyz;
          vTangent = vec4(normalize(mat3(modelMatrix) * tangent.xyz), tangent.w);
          vUv = uv;
          vAo = aAo;
          vAlbedo = albedo;
          vMeta = meta;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uGlow;
        uniform float uTime;
        uniform float uSteam;
        uniform sampler2D uAlbedoMap;
        uniform sampler2D uNrmMap;
        uniform float uTextured;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec4 vTangent;
        varying vec2 vUv;
        varying float vAo;
        varying vec3 vAlbedo;
        varying vec3 vMeta;
        ${NOISE}
        ${RIG}
        void main() {
          vec3 V = normalize(cameraPosition - vWorld);
          if (vMeta.y > 2.5) {
            // 29 Oct: contact shadow: dark under the object, soft to nothing at its edge (albedo.r = its darkness).
            float r = length(vUv * 2.0 - 1.0);
            // Full under the object (its footprint ends at 0.75–0.8 of the radius), a short soft fade just beyond it.
            float a = vAlbedo.r * (1.0 - smoothstep(0.7, 1.0, r)) * (0.8 + 0.2 * (1.0 - smoothstep(0.0, 0.6, r)));
            if (a < 0.004) discard;
            gl_FragColor = vec4(0.0, 0.0, 0.0, a);
            return;
          }
          if (vMeta.y > 1.5) {
            // Steam: soft wisps drifting up (two octaves of noise scrolling upward), thin at the cup, fading as it rises.
            float t = vUv.y;
            float across = 1.0 - smoothstep(0.15, 1.0, abs(vUv.x));
            float n = vnoise(vec3(vUv.x * 1.2 + vMeta.z * 3.1, t * 2.6 - uTime * 0.5, uTime * 0.1 + vMeta.z));
            float n2 = vnoise(vec3(vUv.x * 3.0 + 9.0, t * 6.5 - uTime * 1.05, vMeta.z * 5.0));
            float wisp = smoothstep(0.38, 0.86, n * 0.72 + n2 * 0.42);
            float a = across * wisp * smoothstep(0.0, 0.14, t) * pow(1.0 - t, 1.5) * uSteam * 0.3;
            if (a < 0.004) discard;
            vec3 lit = shade(vWorld, V, V, vec3(0.85, 0.84, 0.82), 1.0, 0.0, 1.0, 1.0) + vec3(0.04, 0.035, 0.03);
            gl_FragColor = vec4(toDisplay(lit), a);
            return;
          }
          vec3 N = normalize(vNormal);
          if (dot(N, V) < 0.0) N = -N;
          float part = vMeta.x;
          float glow = part < 0.5 ? uGlow.x : part < 1.5 ? uGlow.y : uGlow.z;
          vec3 albedo = toLinear(vAlbedo);
          float rough = 0.62;
          if (vMeta.y < 0.5 && uTextured > 0.5) {
            // The Tripo model: its albedo, its relief (tangent-space normal) and roughness from the shared atlas.
            albedo = toLinear(texture2D(uAlbedoMap, vUv).rgb);
            vec3 nr = texture2D(uNrmMap, vUv).rgb;
            vec3 T = normalize(vTangent.xyz - N * dot(N, vTangent.xyz));
            vec3 B = cross(N, T) * (vTangent.w < 0.0 ? -1.0 : 1.0);
            vec2 d = nr.rg * 2.0 - 1.0;
            N = normalize(T * d.x + B * d.y + N * sqrt(max(1.0 - dot(d, d), 0.0)));
            rough = clamp(nr.b, 0.2, 1.0);
          }
          vec3 col = shade(vWorld, N, V, albedo * vAo, rough, 0.04, 0.35, 1.0) * mix(1.0, vAo, 0.5);
          // 28 Oct (review): glazed ceramic stays warm in its shadow (light through the glaze, warm bounce from the
          // table): a soft warm fill on the side away from the key, strongest on the cup.
          float away = 1.0 - smoothstep(-0.15, 0.55, dot(N, uKeyDir));
          col += albedo * vAo * vec3(0.16, 0.115, 0.07) * away * (part > 0.5 && part < 1.5 ? 1.0 : 0.45);
          // The moment it arrives: a soft warm light around it, fading in a few seconds.
          col += vec3(1.0, 0.78, 0.5) * glow * (0.12 + 0.3 * pow(1.0 - max(dot(N, V), 0.0), 2.0));
          gl_FragColor = vec4(toDisplay(col), 1.0);
        }
      `,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'wdd-keepsakes';
  }

  /** Loads the Tripo models and their atlas (the stand-ins stay if anything fails). */
  async load(renderer: WebGLRenderer | null): Promise<void> {
    try {
      const [gltf, albedo, nrm] = await Promise.all([
        new GLTFLoader().loadAsync('./models/keepsakes.glb'),
        loadKtx2(renderer, './textures/keepsakes-albedo.ktx2'),
        loadKtx2(renderer, './textures/keepsakes-nrm-rough.ktx2'),
      ]);
      if (albedo == null || nrm == null) return;
      const pieces: Piece[] = [];
      PARTS.forEach((name, part) => {
        const m = gltf.scene.getObjectByName(name) as Mesh | undefined;
        if (m?.geometry != null) pieces.push({ geometry: m.geometry, part, kind: TEXTURED });
      });
      if (pieces.length !== PARTS.length) return;
      for (const t of [albedo, nrm]) {
        t.minFilter = LinearMipmapLinearFilter;
        t.magFilter = LinearFilter;
        t.anisotropy = 4;
        t.needsUpdate = true;
      }
      const old = this.mesh.geometry;
      this.mesh.geometry = build(pieces);
      old.dispose();
      this.uniforms.uAlbedoMap.value = albedo;
      this.uniforms.uNrmMap.value = nrm;
      this.uniforms.uTextured.value = 1;
      this.triangles = pieces.reduce((n, p) => n + (p.geometry.index?.count ?? p.geometry.getAttribute('position').count) / 3, 0);
      this.textureBytes = ktx2Bytes(albedo) + ktx2Bytes(nrm);
    } catch {
      // Stand-ins stay.
    }
  }

  /** Which keepsakes stand on the table (immediately, e.g. at arrival), and how tall the plant is. */
  set(have: readonly Keepsake[], grow: number): void {
    const v = (k: Keepsake): number => (have.includes(k) ? 1 : 0);
    this.target.set(v('pebble'), v('cup'), v('plant'));
    this.uniforms.uShow.value.copy(this.target);
    this.uniforms.uGrow.value = grow;
    this.mesh.visible = have.length > 0;
    // You came back: the cup steams again (only at arrival), then goes quiet.
    this.steamT = have.includes('cup') ? 0 : -1;
  }

  /** A milestone: this keepsake arrives (grows in with a soft light) — the others stay as they are. */
  arrive(k: Keepsake): void {
    const i = PARTS.indexOf(k);
    this.target.setComponent(i, 1);
    this.uniforms.uShow.value.setComponent(i, 0.001);
    this.glowT.setComponent(i, 1);
    this.uniforms.uGlow.value.setComponent(i, 1);
    this.mesh.visible = true;
    if (k === 'cup') this.steamT = 0;
  }

  /** How much the cup steams at `t` seconds after it started (0 before, eased in, then a slow fade out). */
  static steamAt(t: number): number {
    if (t < 0) return 0;
    const rise = Math.min(1, t / STEAM.fadeIn);
    const fall = Math.min(1, Math.max(0, (STEAM.seconds - t) / STEAM.fadeOut));
    const e = (x: number) => x * x * (3 - 2 * x);
    return e(rise) * e(fall);
  }

  update(dt: number): void {
    const s = this.uniforms.uShow.value;
    const g = this.uniforms.uGlow.value;
    for (let i = 0; i < 3; i++) {
      const cur = s.getComponent(i);
      const t = this.target.getComponent(i);
      // Grows in over ≈ 1.5 s, eased; the light around it fades over ≈ 5 s.
      s.setComponent(i, cur + (t - cur) * (1 - Math.exp(-2.6 * dt)));
      g.setComponent(i, Math.max(0, g.getComponent(i) - dt * 0.2));
    }
    if (this.steamT >= 0) {
      this.steamT += dt;
      if (this.steamT > STEAM.seconds) this.steamT = -1;
    }
    this.uniforms.uSteam.value = Keepsakes.steamAt(this.steamT) * s.y;
  }

  get shown(): number[] {
    const s = this.uniforms.uShow.value;
    return [s.x, s.y, s.z].map((x) => +x.toFixed(2));
  }

  /** The cup's steam now (0..1), for tests and the perf report. */
  get steam(): number {
    return +this.uniforms.uSteam.value.toFixed(3);
  }
}
