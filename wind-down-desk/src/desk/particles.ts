/**
 * One draw call for every point of light: the warm dust that rises when a
 * worry is let go, and the persistent night sky (one star per worry ever let
 * go). Motion is computed in the vertex shader from per-instance start data,
 * so the CPU only writes a few attributes when something is spawned.
 *
 * Look: fireflies and lamp-lit dust, not pixels. Small soft discs, warm
 * gold to pale amber, a slow rise with a lazy sideways drift, a gentle
 * twinkle, and a long fade. Additive but with a low gain (no bloom pass).
 */
import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from '@iwsdk/core';
import { timeUniform } from './materials.ts';

export const STAR_SLOTS = 96;
const BURST_SLOTS = 192;
const TOTAL = STAR_SLOTS + BURST_SLOTS;

const DUST = [0xffd9a0, 0xffc77a, 0xffe7c2, 0xf6b86a];

export class LightField {
  readonly mesh: Mesh;
  private readonly start: InstancedBufferAttribute;
  private readonly vel: InstancedBufferAttribute;
  private readonly birth: InstancedBufferAttribute;
  private readonly life: InstancedBufferAttribute;
  private readonly color: InstancedBufferAttribute;
  private readonly size: InstancedBufferAttribute;
  private nextBurst = 0;
  private nextStar = 0;
  private readonly tmp = new Color();
  private dirty = false;

  constructor() {
    const quad = new PlaneGeometry(1, 1);
    const geometry = new InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.start = new InstancedBufferAttribute(new Float32Array(TOTAL * 3), 3);
    this.vel = new InstancedBufferAttribute(new Float32Array(TOTAL * 3), 3);
    this.birth = new InstancedBufferAttribute(new Float32Array(TOTAL), 1);
    this.life = new InstancedBufferAttribute(new Float32Array(TOTAL), 1);
    this.color = new InstancedBufferAttribute(new Float32Array(TOTAL * 3), 3);
    this.size = new InstancedBufferAttribute(new Float32Array(TOTAL), 1);
    for (const [name, attr] of [
      ['aStart', this.start],
      ['aVel', this.vel],
      ['aBirth', this.birth],
      ['aLife', this.life],
      ['aColor', this.color],
      ['aSize', this.size],
    ] as const) {
      geometry.setAttribute(name, attr);
    }
    geometry.instanceCount = TOTAL;
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: timeUniform },
      vertexShader: /* glsl */ `
        attribute vec3 aStart;
        attribute vec3 aVel;
        attribute float aBirth;
        attribute float aLife;
        attribute vec3 aColor;
        attribute float aSize;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vUv = uv;
          vColor = aColor;
          float age = uTime - aBirth;
          vec3 pos = aStart;
          float alpha = 0.0;
          float seed = fract(aStart.x * 91.7 + aStart.z * 37.3 + aBirth * 3.1);
          if (aLife > 0.0) {
            float k = age / aLife;
            if (age >= 0.0 && k <= 1.0) {
              // Rise that slows down (air drag), with a lazy figure-of-eight drift.
              float rise = 1.0 - exp(-age * 0.9);
              pos = aStart + aVel * rise / 0.9
                + vec3(sin(age * 1.3 + seed * 6.28), 0.0, sin(age * 0.9 + seed * 9.0)) * 0.014 * sqrt(age)
                + vec3(0.0, 0.012 * age * sign(aVel.y + 1e-5), 0.0);
              float twinkle = 0.65 + 0.35 * sin(age * (5.0 + seed * 6.0) + seed * 20.0);
              alpha = smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.45, 1.0, k)) * twinkle;
            }
          } else if (aLife < 0.0) {
            float fade = clamp(age / 2.5, 0.0, 1.0);
            alpha = fade * (0.55 + 0.45 * sin(uTime * (0.5 + seed * 0.7) + aStart.z * 40.0));
          }
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          mv.xy += position.xy * aSize * step(0.001, alpha);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float core = exp(-d * d * 14.0);
          float halo = exp(-d * d * 3.0) * 0.28;
          float a = (core + halo) * vAlpha * (1.0 - smoothstep(0.85, 1.0, d));
          vec3 c = mix(vColor, vec3(1.0, 0.95, 0.86), core * 0.35);
          gl_FragColor = vec4(c * a * 1.45, a);
        }
      `,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  /**
   * Warm dust rising from a small area (a dissolving stone). `spread` is the
   * radius of the emitting disc; `lift` scales the rise.
   */
  /** 26 Oct (adaptive quality): share of the sparks and dust emitted (0..1); the stars of the sky are kept. */
  density = 1;

  emit(x: number, y: number, z: number, count: number, spread = 0.035, lift = 1): void {
    count = this.density >= 1 ? count : Math.round(count * this.density + (Math.random() < (count * this.density) % 1 ? 1 : 0));
    if (count <= 0) return;
    const now = timeUniform.value;
    for (let i = 0; i < count; i++) {
      const slot = STAR_SLOTS + this.nextBurst;
      this.nextBurst = (this.nextBurst + 1) % BURST_SLOTS;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      this.start.setXYZ(slot, x + Math.cos(a) * r, y + Math.random() * 0.012, z + Math.sin(a) * r * 0.85);
      const out = 0.004 + Math.random() * 0.016;
      this.vel.setXYZ(slot, Math.cos(a) * out, (0.035 + Math.random() * 0.06) * lift, Math.sin(a) * out);
      this.birth.setX(slot, now + Math.random() * 0.12);
      this.life.setX(slot, 2.2 + Math.random() * 2.4);
      this.tmp.setHex(DUST[(Math.random() * DUST.length) | 0]);
      this.color.setXYZ(slot, this.tmp.r, this.tmp.g, this.tmp.b);
      this.size.setX(slot, 0.0045 + Math.random() * Math.random() * 0.009);
    }
    this.dirty = true;
  }

  /**
   * v6 Breathe: slow motes in a ring around a point, drifting up (inhale, `vy` > 0) or down (exhale, `vy` < 0).
   * `ring`: inner and outer radius of the ring (metres).
   */
  drift(x: number, y: number, z: number, count: number, inner: number, outer: number, vy: number, life = 4.5): void {
    const now = timeUniform.value;
    for (let i = 0; i < count; i++) {
      const slot = STAR_SLOTS + this.nextBurst;
      this.nextBurst = (this.nextBurst + 1) % BURST_SLOTS;
      const a = Math.random() * Math.PI * 2;
      const r = inner + Math.random() * (outer - inner);
      this.start.setXYZ(slot, x + Math.cos(a) * r, y + (Math.random() - 0.5) * 0.04, z + Math.sin(a) * r * 0.8);
      this.vel.setXYZ(slot, Math.cos(a) * 0.003, vy * (0.6 + Math.random() * 0.8), Math.sin(a) * 0.003);
      this.birth.setX(slot, now + Math.random() * 0.4);
      this.life.setX(slot, life * (0.75 + Math.random() * 0.5));
      this.tmp.setHex(DUST[(Math.random() * DUST.length) | 0]);
      this.color.setXYZ(slot, this.tmp.r, this.tmp.g, this.tmp.b);
      this.size.setX(slot, 0.0035 + Math.random() * Math.random() * 0.006);
    }
    this.dirty = true;
  }

  /** Back-compat: a single burst of dust at a point. */
  burst(x: number, y: number, z: number, _hex: number, count = 44): void {
    this.emit(x, y, z, count, 0.03, 1);
  }

  /** Adds (or rewrites) a persistent star. `delay` lets it fade in after a release. */
  star(x: number, y: number, z: number, size: number, hex = 0xffeacc, delay = 0): void {
    const slot = this.nextStar;
    this.nextStar = (this.nextStar + 1) % STAR_SLOTS;
    this.start.setXYZ(slot, x, y, z);
    this.vel.setXYZ(slot, 0, 0, 0);
    this.birth.setX(slot, timeUniform.value + delay);
    this.life.setX(slot, -1);
    this.tmp.setHex(hex);
    this.color.setXYZ(slot, this.tmp.r, this.tmp.g, this.tmp.b);
    this.size.setX(slot, size);
    this.dirty = true;
  }

  clearStars(): void {
    for (let i = 0; i < STAR_SLOTS; i++) {
      this.life.setX(i, 0);
    }
    this.nextStar = 0;
    this.dirty = true;
  }

  /** Uploads changed attributes at most once per frame. */
  flush(): void {
    if (!this.dirty) {
      return;
    }
    this.dirty = false;
    this.start.needsUpdate = true;
    this.vel.needsUpdate = true;
    this.birth.needsUpdate = true;
    this.life.needsUpdate = true;
    this.color.needsUpdate = true;
    this.size.needsUpdate = true;
  }
}
