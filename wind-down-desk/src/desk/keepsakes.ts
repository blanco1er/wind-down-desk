/**
 * Keepsakes on your real table (26 Oct, lot 2b): a polished pebble at 3 evenings, a small candle at 7, a little plant
 * at 21 (a leaf more every few evenings after). They stand on the table just left of the tray, toward the back, in the
 * desk's own frame — so they come back to the same place every evening (the desk's anchor). Elegant and discreet:
 * a few centimetres, the room's light, the candle's tiny flame the only glow.
 *
 * One mesh, one draw call for all three (a `part` attribute shows / grows each one); built once.
 */
import { BufferAttribute, BufferGeometry, LatheGeometry, Mesh, ShaderMaterial, Vector2, Vector3 } from '@iwsdk/core';
import { createPebbleGeometry, TRAY } from './geometry.ts';
import { RIG, RIG_UNIFORMS, NOISE, timeUniform } from './materials.ts';
import type { Keepsake } from '../logic/milestones.ts';

/**
 * Desk-local spots, on the table (below the tray floor), just left of the tray, toward the back: seen over the
 * tray's wall from the seat (behind the tray, its 3.5 cm wall hid them), clear of the stones and of your hands.
 */
export const KEEPSAKE_AT: Record<Keepsake, { x: number; z: number }> = {
  pebble: { x: -0.462, z: -0.025 },
  candle: { x: -0.47, z: -0.095 },
  plant: { x: -0.464, z: -0.168 },
};
const PARTS: Keepsake[] = ['pebble', 'candle', 'plant'];
const TABLE_Y = -TRAY.height;

interface Piece {
  geometry: BufferGeometry;
  color: [number, number, number];
  part: number;
  emit?: number;
  leaf?: number;
}

function lathe(points: Array<[number, number]>, segments = 28): BufferGeometry {
  return new LatheGeometry(
    points.map(([r, y]) => new Vector2(r, y)),
    segments,
  );
}

/** A leaf: a thin curved blade from the soil, turned by `turn`, leaning by `lean`. */
function leaf(length: number, width: number, turn: number, lean: number): BufferGeometry {
  const rows = 6;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const w = Math.sin(Math.PI * t) * width * (1 - 0.3 * t);
    const y = t * length * Math.cos(lean * t);
    const out = t * length * Math.sin(lean * t);
    for (const s of [-1, 1]) {
      const lx = s * w;
      const lz = out;
      pos.push(lx * Math.cos(turn) - lz * Math.sin(turn), y, lx * Math.sin(turn) + lz * Math.cos(turn));
    }
  }
  for (let j = 0; j < rows; j++) {
    const a = j * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function pieces(): Piece[] {
  const out: Piece[] = [];
  // The polished pebble: a smooth river stone, pale grey with a warm cast.
  const pebble = createPebbleGeometry(0.019, 0.015, 0.012, 0, 5, 0).geometry;
  out.push({ geometry: pebble, color: [0.58, 0.57, 0.55], part: 0 });
  // The candle: a brass saucer, an ivory wax pillar, a tiny flame (the only glow).
  out.push({ geometry: lathe([[0, 0], [0.019, 0], [0.02, 0.003], [0.017, 0.0035], [0, 0.0035]]), color: [0.62, 0.48, 0.26], part: 1 });
  out.push({ geometry: lathe([[0, 0.003], [0.0105, 0.003], [0.011, 0.038], [0.0095, 0.0395], [0.0012, 0.0392], [0, 0.0392]]), color: [0.9, 0.86, 0.78], part: 1 });
  out.push({ geometry: lathe([[0, 0.0396], [0.0028, 0.0425], [0.0024, 0.0475], [0.0006, 0.0525], [0, 0.0535]], 12), color: [1.0, 0.72, 0.36], part: 1, emit: 1 });
  // The plant: a small terracotta pot, dark soil, five leaves (more of them show as it grows).
  out.push({ geometry: lathe([[0, 0], [0.013, 0], [0.0175, 0.026], [0.0185, 0.0262], [0.0172, 0.024], [0, 0.024]]), color: [0.56, 0.32, 0.22], part: 2 });
  for (let k = 0; k < 5; k++) {
    const g = leaf(0.03 + 0.008 * (k % 3), 0.0065, (k / 5) * Math.PI * 2 + 0.4, 0.5 + 0.12 * (k % 2));
    g.translate(0, 0.023, 0);
    out.push({ geometry: g, color: [0.3, 0.46, 0.26], part: 2, leaf: k + 1 });
  }
  return out;
}

export interface KeepsakeUniforms {
  uShow: { value: Vector3 };
  uGlow: { value: Vector3 };
  uGrow: { value: number };
  uFlame: { value: number };
}

export class Keepsakes {
  readonly mesh: Mesh;
  private readonly uniforms: KeepsakeUniforms;
  private readonly target = new Vector3(0, 0, 0);
  private readonly glowT = new Vector3(0, 0, 0);

  constructor() {
    const list = pieces();
    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];
    const meta: number[] = [];
    const base: number[] = [];
    for (const p of list) {
      const g = p.geometry.index != null ? p.geometry.toNonIndexed() : p.geometry;
      if (g.getAttribute('normal') == null) g.computeVertexNormals();
      const at = KEEPSAKE_AT[PARTS[p.part]];
      const P = g.getAttribute('position');
      const N = g.getAttribute('normal');
      for (let i = 0; i < P.count; i++) {
        pos.push(P.getX(i) + at.x, P.getY(i) + TABLE_Y, P.getZ(i) + at.z);
        nrm.push(N.getX(i), N.getY(i), N.getZ(i));
        col.push(...p.color);
        meta.push(p.part, p.emit ?? 0, p.leaf ?? 0);
        base.push(at.x, TABLE_Y, at.z);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
    geometry.setAttribute('albedo', new BufferAttribute(new Float32Array(col), 3));
    geometry.setAttribute('meta', new BufferAttribute(new Float32Array(meta), 3));
    geometry.setAttribute('base', new BufferAttribute(new Float32Array(base), 3));
    this.uniforms = { uShow: { value: new Vector3() }, uGlow: { value: new Vector3() }, uGrow: { value: 0 }, uFlame: { value: 1 } };
    const material = new ShaderMaterial({
      side: 2,
      uniforms: { ...RIG_UNIFORMS, uTime: timeUniform, ...this.uniforms },
      vertexShader: /* glsl */ `
        attribute vec3 albedo;
        attribute vec3 meta;
        attribute vec3 base;
        uniform vec3 uShow;
        uniform float uGrow;
        uniform float uTime;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec3 vAlbedo;
        varying vec3 vMeta;
        varying float vH;
        void main() {
          float part = meta.x;
          float show = part < 0.5 ? uShow.x : part < 1.5 ? uShow.y : uShow.z;
          vec3 p = base + (position - base) * show;
          // Leaves: three at first, all five as the plant grows; each grows from the soil.
          if (meta.z > 0.5) {
            float on = clamp((uGrow * 5.0 + 3.0) - (meta.z - 1.0), 0.0, 1.0);
            vec3 soil = base + vec3(0.0, 0.023 * show, 0.0);
            p = soil + (p - soil) * on * (0.75 + 0.25 * uGrow);
          }
          // The flame breathes a little (under 3 Hz, never a flicker).
          if (meta.y > 0.5) {
            float k = 1.0 + 0.08 * sin(uTime * 2.3) + 0.05 * sin(uTime * 5.1 + 1.0);
            vec3 wick = base + vec3(0.0, 0.0396 * show, 0.0);
            p = wick + (p - wick) * vec3(1.0, k, 1.0);
          }
          vec4 w = modelMatrix * vec4(p, 1.0);
          vWorld = w.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          vAlbedo = albedo;
          vMeta = meta;
          vH = (p.y - base.y) / max(uShow.y, 0.001);
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uGlow;
        uniform float uFlame;
        uniform float uTime;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec3 vAlbedo;
        varying vec3 vMeta;
        varying float vH;
        ${NOISE}
        ${RIG}
        void main() {
          vec3 N = normalize(vNormal);
          vec3 V = normalize(cameraPosition - vWorld);
          if (dot(N, V) < 0.0) N = -N;
          float part = vMeta.x;
          float glow = part < 0.5 ? uGlow.x : part < 1.5 ? uGlow.y : uGlow.z;
          float polished = part < 0.5 ? 1.0 : 0.0;
          vec3 col = shade(vWorld, N, V, toLinear(vAlbedo), mix(0.62, 0.3, polished), mix(0.04, 0.06, polished), 0.35, 1.0);
          // The moment it arrives: a soft warm light around it, fading in a few seconds.
          col += vec3(1.0, 0.78, 0.5) * glow * (0.12 + 0.3 * pow(1.0 - max(dot(N, V), 0.0), 2.0));
          // The wax glows a little under its flame (light through the candle's top).
          if (part > 0.5 && part < 1.5 && vAlbedo.r > 0.85) col += vec3(1.0, 0.66, 0.34) * smoothstep(0.012, 0.039, vH) * 0.22 * uFlame;
          if (vMeta.y > 0.5) col = vec3(1.0, 0.7, 0.34) * (1.6 + 0.3 * sin(uTime * 2.3)) * uFlame;
          gl_FragColor = vec4(toDisplay(col), 1.0);
        }
      `,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
  }

  /** Which keepsakes stand on the table (immediately, e.g. at arrival), and how tall the plant is. */
  set(have: readonly Keepsake[], grow: number): void {
    const v = (k: Keepsake): number => (have.includes(k) ? 1 : 0);
    this.target.set(v('pebble'), v('candle'), v('plant'));
    this.uniforms.uShow.value.copy(this.target);
    this.uniforms.uGrow.value = grow;
    this.mesh.visible = have.length > 0;
  }

  /** A milestone: this keepsake arrives (grows in with a soft light) — the others stay as they are. */
  arrive(k: Keepsake): void {
    const i = PARTS.indexOf(k);
    this.target.setComponent(i, 1);
    this.uniforms.uShow.value.setComponent(i, 0.001);
    this.glowT.setComponent(i, 1);
    this.uniforms.uGlow.value.setComponent(i, 1);
    this.mesh.visible = true;
  }

  /** The candle's flame (out at night, like the lamp). */
  setFlame(on: number): void {
    this.uniforms.uFlame.value = on;
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
  }

  get shown(): number[] {
    const s = this.uniforms.uShow.value;
    return [s.x, s.y, s.z].map((x) => +x.toFixed(2));
  }
}
