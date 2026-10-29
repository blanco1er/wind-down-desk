/**
 * One draw call for every point of light: the warm dust that rises when a
 * worry is let go, and the persistent night sky (one star per worry ever let
 * go). Motion is computed in the vertex shader from per-instance start data,
 * so the CPU only writes a few attributes when something is spawned.
 *
 * Look: fireflies and lamp-lit dust, not pixels. Small soft discs, warm
 * gold to pale amber, a slow rise with a lazy sideways drift, a gentle
 * twinkle, and a long fade. Additive but with a low gain (no bloom pass).
 *
 * 29 Oct (finishing pass, owner: "a real magic moment, readable in the video"):
 *   - a kept light (Keep) is a small living light, not a dot: a bright pearl with a warm glow and a soft halo
 *     (≈ 13 cm quad), born in your cupped hands with a swell, resting there a moment with a wider halo, rising gently
 *     and flying to its place with a light trail, settling with a soft bloom, then breathing. Its warm light on the
 *     tray, the table and the keepsakes is a faux light in the shared rig (`rig.uKept`, filled by update());
 *   - the word kept appears beside it for a few seconds, drawn in light, as one more quad of this same draw call;
 *   - the stars of Good night leave their place around the desk, gather in the lamp and rise out of it one after
 *     another in trails, then hold the same angular size wherever they land (a high ceiling no longer shrinks them),
 *     with varied sizes, a slow scintillation, and fine spikes on the brightest.
 * Trails are a quad stretched along the screen-space motion (the position a moment earlier is computed by the same
 * formula): no extra instance, nothing per frame on the CPU but a few uniforms.
 */
import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NoColorSpace,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type CanvasTexture,
} from '@iwsdk/core';
import { KEPT_FLIGHT, keptFlight, keptWordAlpha } from '../logic/keep.ts';
import { rig, timeUniform } from './materials.ts';
import { canvasTexture, FONT } from './text-canvas.ts';

export const STAR_SLOTS = 96;
/** 28 Oct: the good things kept (Keep), warm lights that float in the room, evening after evening. */
export const KEPT_SLOTS = 36;
const BURST_SLOTS = 192;
const TOTAL = STAR_SLOTS + KEPT_SLOTS + BURST_SLOTS;
const BURST0 = STAR_SLOTS + KEPT_SLOTS;
/** The instance after all lights: the kept word, written in light beside its light. */
const WORD = TOTAL;
/** Kept lights that light the desk (faux point lights in the rig): tonight's newest. */
export const KEPT_LIGHTS = 4;
/** World size of a kept light's quad (its halo reaches the edge). */
const KEPT_QUAD = 0.17;
/** The kept word's quad (metres) and its canvas (px). */
const WORD_SIZE = { w: 0.24, h: 0.048, px: 640, py: 128 } as const;

const DUST = [0xffd9a0, 0xffc77a, 0xffe7c2, 0xf6b86a];

/** Shared GLSL: the flight of a kept light (logic/keep.ts keptFlight) and the rise of a star out of the lamp. */
const FLIGHT_GLSL = /* glsl */ `
  vec3 keptFlight(vec3 a, vec3 b, float k, float seed) {
    float c = clamp(k, 0.0, 1.0);
    float exz = c * c * (3.0 - 2.0 * c);
    float ey = 1.0 - pow(1.0 - c, 3.0);
    float lift = (0.1 + 0.03 * seed) * sin(3.14159265 * c) * (1.0 - 0.35 * c);
    vec2 d = b.xz - a.xz;
    vec2 side = vec2(-d.y, d.x) / max(length(d), 1e-4);
    float sway = 0.035 * sin(6.2831853 * c) * (seed - 0.5) * 2.0;
    return vec3(a.x + d.x * exz + side.x * sway, a.y + (b.y - a.y) * ey + lift, a.z + d.y * exz + side.y * sway);
  }
  // A star leaving the lamp: it rises first (the height leads), curls away in a loose spiral, slows as it settles.
  vec3 starFlight(vec3 a, vec3 b, float k, float seed) {
    float c = clamp(k, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - c, 2.2);
    vec3 p = mix(a, b, e);
    p.y = mix(a.y, b.y, 1.0 - pow(1.0 - c, 3.2));
    float ang = seed * 6.2831853 + c * 2.6;
    p.xz += vec2(cos(ang), sin(ang)) * 0.13 * sin(3.14159265 * c);
    return p;
  }
`;

interface KeptLight {
  slot: number;
  from: Vector3;
  to: Vector3;
  /** Departure time (shared clock) and flight duration (0: already there). */
  t0: number;
  travel: number;
  /** Creation time (fade-in). */
  born: number;
  seed: number;
}

export class LightField {
  readonly mesh: Mesh;
  private readonly start: InstancedBufferAttribute;
  private readonly vel: InstancedBufferAttribute;
  private readonly birth: InstancedBufferAttribute;
  private readonly life: InstancedBufferAttribute;
  private readonly color: InstancedBufferAttribute;
  private readonly size: InstancedBufferAttribute;
  /** 28 Oct: a journey for persistent lights (xyz target, start time) and its duration (0: none). */
  private readonly target: InstancedBufferAttribute;
  private readonly travel: InstancedBufferAttribute;
  /** Persistent stars and kept lights: overall level (the slow fade of "stay till I sleep"), their slow breath, and
   * the one star picked in the journal (−1: none). */
  readonly skyUniforms = { uStarDim: { value: 1 }, uStarBreath: { value: 0 }, uPick: { value: -1 }, uPickK: { value: 0 } };
  /** 29 Oct: the kept word (texture, where its light is, how visible). */
  private readonly wordUniforms = { uWord: { value: null as CanvasTexture | null }, uWordPos: { value: new Vector3() }, uWordK: { value: 0 }, uWordSide: { value: 1 } };
  private readonly wordCanvas: HTMLCanvasElement | null;
  private word: { at: number; light: KeptLight } | null = null;
  /** Tonight's kept lights that light the desk (newest last). */
  private readonly desk: KeptLight[] = [];
  /** Each persistent star's home (the lamp's sky), restored when a journey ends (starsHome). */
  private readonly home = new Float32Array(STAR_SLOTS * 3);
  private nextKept = 0;
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
    const n = TOTAL + 1;
    this.start = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.vel = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.birth = new InstancedBufferAttribute(new Float32Array(n), 1);
    this.life = new InstancedBufferAttribute(new Float32Array(n), 1);
    this.color = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.size = new InstancedBufferAttribute(new Float32Array(n), 1);
    this.target = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.travel = new InstancedBufferAttribute(new Float32Array(n), 1);
    for (const [name, attr] of [
      ['aTarget', this.target],
      ['aTravel', this.travel],
      ['aStart', this.start],
      ['aVel', this.vel],
      ['aBirth', this.birth],
      ['aLife', this.life],
      ['aColor', this.color],
      ['aSize', this.size],
    ] as const) {
      geometry.setAttribute(name, attr);
    }
    geometry.instanceCount = n;
    this.wordCanvas = typeof document === 'undefined' ? null : document.createElement('canvas');
    if (this.wordCanvas != null) {
      this.wordCanvas.width = WORD_SIZE.px;
      this.wordCanvas.height = WORD_SIZE.py;
      const t = canvasTexture(this.wordCanvas, 4, true);
      t.colorSpace = NoColorSpace;
      this.wordUniforms.uWord.value = t;
    }
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: timeUniform, ...this.skyUniforms, ...this.wordUniforms },
      vertexShader: /* glsl */ `
        attribute vec3 aStart;
        attribute vec3 aVel;
        attribute float aBirth;
        attribute float aLife;
        attribute vec3 aColor;
        attribute float aSize;
        attribute vec4 aTarget;
        attribute float aTravel;
        uniform float uTime;
        uniform float uStarDim;
        uniform float uStarBreath;
        uniform float uPick;
        uniform float uPickK;
        uniform vec3 uWordPos;
        uniform float uWordK;
        uniform float uWordSide;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vAlpha;
        // x: kind (0 dust / star, 1 kept, 2 word), y: tail length (in half-sizes), z: glow boost, w: spikes.
        varying vec4 vKind;
        ${FLIGHT_GLSL}
        // Places the quad: a disc at p, or a streak from where it was a moment ago (prev) to p.
        void place(vec3 p, vec3 prev, float size) {
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vec4 mv0 = modelViewMatrix * vec4(prev, 1.0);
          float h = size * 0.5;
          vec2 d = mv.xy - mv0.xy;
          float len = length(d);
          vec2 ax = len > 1e-5 ? d / len : vec2(1.0, 0.0);
          vec2 pe = vec2(-ax.y, ax.x);
          float tail = min(len, size * 4.0);
          float along = mix(-(tail + h), h, position.x + 0.5);
          float across = position.y * 2.0 * h;
          mv.xy += ax * along + pe * across;
          vUv = vec2(along, across) / h;
          vKind.y = tail / h;
          gl_Position = projectionMatrix * mv;
        }
        void main() {
          vUv = uv;
          vKind = vec4(0.0);
          vColor = aColor;
          if (gl_InstanceID == ${WORD}) {
            // The kept word, beside its light on the outer side (never over the buttons in the middle), in light.
            vKind.x = 2.0;
            vAlpha = uWordK;
            vec4 mv = modelViewMatrix * vec4(uWordPos, 1.0);
            float ws = max(1.0, -mv.z / 0.85);
            mv.x += uWordSide * ${(KEPT_QUAD * 0.2 + WORD_SIZE.w * 0.5).toFixed(4)} * ws;
            mv.y += 0.004 * ws;
            mv.xy += position.xy * vec2(${WORD_SIZE.w.toFixed(3)}, ${WORD_SIZE.h.toFixed(3)}) * ws * step(0.002, uWordK);
            gl_Position = projectionMatrix * mv;
            return;
          }
          float age = uTime - aBirth;
          vec3 pos = aStart;
          float alpha = 0.0;
          float seed = fract(aStart.x * 91.7 + aStart.z * 37.3 + aBirth * 3.1);
          if (aLife > 0.0) {
            float k = age / aLife;
            vec3 prev = aStart;
            if (age >= 0.0 && k <= 1.0) {
              // Rise that slows down (air drag), with a lazy figure-of-eight drift.
              float rise = 1.0 - exp(-age * 0.9);
              pos = aStart + aVel * rise / 0.9
                + vec3(sin(age * 1.3 + seed * 6.28), 0.0, sin(age * 0.9 + seed * 9.0)) * 0.014 * sqrt(age)
                + vec3(0.0, 0.012 * age * sign(aVel.y + 1e-5), 0.0);
              // 29 Oct: where it was 0.1 s ago: a fast mote (the lamp's light streaming into your fists) draws a short
              // comet tail; slow dust barely any.
              float a0 = max(age - 0.1, 0.0);
              float rise0 = 1.0 - exp(-a0 * 0.9);
              prev = aStart + aVel * rise0 / 0.9
                + vec3(sin(a0 * 1.3 + seed * 6.28), 0.0, sin(a0 * 0.9 + seed * 9.0)) * 0.014 * sqrt(a0)
                + vec3(0.0, 0.012 * a0 * sign(aVel.y + 1e-5), 0.0);
              float twinkle = 0.65 + 0.35 * sin(age * (5.0 + seed * 6.0) + seed * 20.0);
              alpha = smoothstep(0.0, 0.12, k) * (1.0 - smoothstep(0.45, 1.0, k)) * twinkle;
            }
            vAlpha = alpha;
            place(pos, prev, aSize * step(0.001, alpha));
            return;
          }
          if (aLife == 0.0) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            vAlpha = 0.0;
            return;
          }
          bool kept = aLife < -1.5;
          // A stable per-light seed (slot), independent of where it starts.
          float id = fract(sin(float(gl_InstanceID) * 12.9898 + 1.3) * 43758.5453);
          vec3 prev = pos;
          float size = aSize;
          float glow = 1.0;
          if (kept) {
            vKind.x = 1.0;
            float since = uTime - aBirth;
            // Born with a swell (a little larger, then settling), then breathing slowly, never blinking.
            float born = smoothstep(0.0, 0.45, since);
            float swell = 1.0 + 0.55 * exp(-max(since - 0.2, 0.0) * 2.4) * born;
            float breath = 0.5 + 0.5 * sin(uTime * (0.95 + 0.25 * id) + id * 11.0);
            glow = (0.85 + 0.3 * breath) * swell;
            alpha = born;
            size = aSize * (0.92 + 0.08 * breath);
            if (aTravel > 0.0) {
              float k = (uTime - aTarget.w) / aTravel;
              if (k < 0.0) {
                // Resting where it was born (your cupped hands): a wider, warmer halo.
                vKind.z = 1.0;
              } else {
                float kp = k - 0.28 / aTravel;
                pos = keptFlight(aStart, aTarget.xyz, k, id);
                prev = keptFlight(aStart, aTarget.xyz, kp, id);
                vKind.z = 1.0 - smoothstep(0.0, 0.25, k);
                // Landing: a soft bloom, then it breathes in its place.
                float landed = uTime - aTarget.w - aTravel;
                glow *= 1.0 + 0.7 * exp(-max(landed, 0.0) * 2.2) * step(0.0, landed);
              }
            }
            if (aTravel <= 0.0 || uTime > aTarget.w + aTravel) {
              // Alive in its place: a slow figure of eight.
              vec3 drift = vec3(sin(uTime * 0.37 + id * 6.28) * 0.008, sin(uTime * 0.53 + id * 9.1) * 0.01, cos(uTime * 0.31 + id * 4.2) * 0.008);
              pos += drift;
              prev = pos;
            }
            alpha *= uStarDim * (1.0 - uStarBreath * 0.6);
            vAlpha = alpha;
            vKind.w = glow;
            // 29 Oct: on a wall across the room it keeps the size it has at the desk (same angle, never a dot).
            size *= max(1.0, length(cameraPosition - pos) / 0.85);
            place(pos, prev, size * step(0.001, alpha));
            return;
          }
          // A star of your sky.
          float fade = clamp(age / 2.5, 0.0, 1.0);
          float tw = 0.55 + 0.45 * sin(uTime * (0.5 + seed * 0.7) + aStart.z * 40.0);
          alpha = fade * tw;
          if (aTravel > 0.0) {
            float k = (uTime - aTarget.w) / aTravel;
            if (k < 0.0) {
              // Waiting for its turn: it leaves its place around the desk (fading), it is gathered in the lamp.
              pos = aVel;
              prev = pos;
              alpha *= 1.0 - smoothstep(0.0, 0.9, uTime - aBirth);
            } else {
              float c = clamp(k, 0.0, 1.0);
              float kp = k - 0.3 / aTravel;
              pos = starFlight(aStart, aTarget.xyz, k, id);
              prev = starFlight(aStart, aTarget.xyz, kp, id);
              // Out of the lamp: it appears there, then holds the same angular size wherever it lands.
              float dist = length(cameraPosition - pos);
              float ang = 0.016 + 0.022 * pow(clamp((aSize - 0.0128) / 0.0123, 0.0, 1.0), 2.2);
              size = mix(0.045, ang * dist, smoothstep(0.0, 0.7, c));
              // A slow, real scintillation once it is there; brighter ones carry fine spikes.
              float sc = 0.78 + 0.14 * sin(uTime * (1.1 + id * 1.7) + id * 30.0) + 0.08 * sin(uTime * (2.3 + id * 2.9) + id * 7.0);
              alpha = smoothstep(0.0, 0.06, c) * mix(1.0, sc, smoothstep(0.85, 1.0, c)) * (0.62 + 0.38 * smoothstep(0.018, 0.034, ang));
              vKind.z = 0.35 + 0.65 * smoothstep(0.024, 0.038, ang);
              vKind.w = smoothstep(0.028, 0.038, ang) * smoothstep(0.9, 1.0, c);
            }
          }
          alpha *= uStarDim * (1.0 - uStarBreath);
          float picked = step(abs(float(gl_InstanceID) - uPick), 0.5) * uPickK;
          size *= 1.0 + 1.6 * picked;
          alpha = mix(alpha, 1.0, picked);
          vAlpha = alpha;
          place(pos, prev, size * step(0.001, alpha));
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uWord;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vAlpha;
        varying vec4 vKind;
        void main() {
          if (vKind.x > 1.5) {
            // The kept word: warm white light with a soft glow (the canvas holds both, in alpha).
            vec4 t = texture2D(uWord, vUv);
            float a = t.a * vAlpha;
            if (a < 0.004) discard;
            gl_FragColor = vec4(mix(vec3(1.0, 0.72, 0.42), vec3(1.0, 0.95, 0.86), t.r), a * 0.95);
            return;
          }
          // Distances in half-sizes: to the head (the light itself) and to its trail (from the head back).
          vec2 u = vUv;
          float tailLen = vKind.y;
          float tx = clamp(u.x, -tailLen, 0.0);
          float dTrail = length(vec2(u.x - tx, u.y));
          float trailFade = tailLen > 0.0 ? 1.0 + tx / tailLen : 1.0;
          float d = length(u);
          if (vKind.x > 0.5) {
            // A kept light (quad ${KEPT_QUAD} m): a bright pearl (≈ 1.7 cm), a warm glow, a soft halo; while it rests in
            // your hands, a wider, warmer halo; its trail a thin warm thread.
            float g = vKind.w;
            float pearl = 1.0 - smoothstep(0.075, 0.14, d);
            float inner = exp(-d * d / 0.02) * 0.9;
            float glowR = exp(-d * d / 0.09) * 0.55;
            float halo = exp(-d * d / (0.36 + 0.14 * vKind.z)) * (0.22 + 0.06 * vKind.z);
            float trail = exp(-dTrail * dTrail / 0.006) * trailFade * trailFade * step(0.01, tailLen) * 0.7;
            vec3 c = vec3(1.0, 0.95, 0.84) * (pearl * 1.25 + inner * 0.6) + vec3(1.0, 0.6, 0.26) * (glowR + inner * 0.5) + vec3(1.0, 0.46, 0.16) * halo + vec3(1.0, 0.7, 0.38) * trail;
            float a = (pearl + inner + glowR + halo + trail) * vAlpha * g * (1.0 - smoothstep(0.9, 1.0, max(d, dTrail)));
            if (a < 0.003) discard;
            gl_FragColor = vec4(c / max(pearl + inner + glowR + halo + trail, 1e-3) * g * 1.15, a);
            return;
          }
          // The head only (a trail never gets a core of its own: it read as a white line).
          float core = exp(-d * d * 14.0);
          float halo = exp(-d * d * 3.0) * 0.28 * (1.0 + vKind.z);
          // Fine diffraction spikes on the brightest stars of the ceiling (screen-aligned, like a photograph).
          float spikes = (exp(-abs(u.y) * 30.0) * exp(-abs(u.x) * 3.4) + exp(-abs(u.x) * 30.0) * exp(-abs(u.y) * 3.4)) * 0.28 * vKind.w;
          float trail = exp(-dTrail * dTrail * 10.0) * trailFade * trailFade * step(0.01, tailLen) * 0.75;
          float a = (core + halo + spikes + trail) * vAlpha * (1.0 - smoothstep(0.85, 1.0, d) * (1.0 - step(0.01, tailLen)));
          // A trail is warm gold (light leaving the lamp), the head a white-gold point.
          vec3 c = mix(mix(vColor, vec3(1.0, 0.7, 0.36), step(0.01, tailLen) * (1.0 - core)), vec3(1.0, 0.95, 0.86), core * 0.35);
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

  emit(x: number, y: number, z: number, count: number, spread = 0.035, lift = 1, size = 1): void {
    count = this.density >= 1 ? count : Math.round(count * this.density + (Math.random() < (count * this.density) % 1 ? 1 : 0));
    if (count <= 0) return;
    const now = timeUniform.value;
    for (let i = 0; i < count; i++) {
      const slot = BURST0 + this.nextBurst;
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
      this.size.setX(slot, (0.0045 + Math.random() * Math.random() * 0.009) * size);
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
      const slot = BURST0 + this.nextBurst;
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

  /**
   * 28 Oct (Squeeze): motes drawn from one point to another (the lamp's light flowing into your fists), arriving
   * after about `life` seconds. `size`: their scale (29 Oct: larger, so the stream reads past the new grey hands).
   */
  stream(fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, count: number, life = 1.6, size = 1): void {
    count = this.density >= 1 ? count : Math.max(1, Math.round(count * this.density));
    const now = timeUniform.value;
    for (let i = 0; i < count; i++) {
      const slot = BURST0 + this.nextBurst;
      this.nextBurst = (this.nextBurst + 1) % BURST_SLOTS;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 0.02;
      const sx = fx + Math.cos(a) * r;
      const sz = fz + Math.sin(a) * r;
      const L = life * (0.85 + Math.random() * 0.3);
      const g = 0.9 / (1 - Math.exp(-0.9 * L));
      this.start.setXYZ(slot, sx, fy, sz);
      // The shader adds a slow lift (0.012 m/s): taken out so the motes land in the hand.
      this.vel.setXYZ(slot, (tx - sx) * g, (ty - fy - 0.012 * L) * g, (tz - sz) * g);
      this.birth.setX(slot, now + Math.random() * 0.25);
      this.life.setX(slot, L * 1.05);
      this.tmp.setHex(DUST[(Math.random() * DUST.length) | 0]);
      this.color.setXYZ(slot, this.tmp.r, this.tmp.g, this.tmp.b);
      this.size.setX(slot, (0.004 + Math.random() * 0.005) * size);
    }
    this.dirty = true;
  }

  /**
   * Star `i` (0..STAR_SLOTS-1) travels to a world point over `duration` s. 29 Oct: it leaves its place around the
   * desk at once (fading), and rises out of `from` (the lamp) after `delay` s.
   */
  starTo(i: number, x: number, y: number, z: number, delay: number, duration: number, from?: { x: number; y: number; z: number }): void {
    if (i < 0 || i >= STAR_SLOTS) return;
    const now = timeUniform.value;
    // aVel holds where it waits (its home); aStart the lamp it rises from; aBirth the moment it was called.
    this.vel.setXYZ(i, this.home[i * 3], this.home[i * 3 + 1], this.home[i * 3 + 2]);
    if (from != null) this.start.setXYZ(i, from.x + (Math.random() - 0.5) * 0.01, from.y, from.z + (Math.random() - 0.5) * 0.01);
    this.birth.setX(i, now);
    this.target.setXYZW(i, x, y, z, now + delay);
    this.travel.setX(i, duration);
    this.dirty = true;
  }

  /** The stars come home (a new evening): no journey. */
  starsHome(): void {
    for (let i = 0; i < STAR_SLOTS; i++) {
      this.travel.setX(i, 0);
      this.start.setXYZ(i, this.home[i * 3], this.home[i * 3 + 1], this.home[i * 3 + 2]);
    }
    this.dirty = true;
  }

  /** World position of star `i` (persistent), as the CPU last wrote it (its home, or its journey's end once there). */
  starAt(i: number, out: { x: number; y: number; z: number }): boolean {
    if (i < 0 || i >= STAR_SLOTS || this.life.getX(i) >= 0) return false;
    const travelling = this.travel.getX(i) > 0 && timeUniform.value >= this.target.getW(i) + this.travel.getX(i);
    out.x = travelling ? this.target.getX(i) : this.home[i * 3];
    out.y = travelling ? this.target.getY(i) : this.home[i * 3 + 1];
    out.z = travelling ? this.target.getZ(i) : this.home[i * 3 + 2];
    return true;
  }

  /** How many persistent stars are lit. */
  get starCount(): number {
    let n = 0;
    for (let i = 0; i < STAR_SLOTS; i++) if (this.life.getX(i) < 0) n++;
    return n;
  }

  /**
   * 28 Oct (Keep): a kept light, born at a point and floating to its place in the room (`travel` s; 0: already
   * there), leaving after `delay` s. Persistent: it stays until clearKept(). 29 Oct: `word` is written in light
   * beside it once it lands; `lightsDesk`: tonight's lights shed their warm light on the tray (faux light).
   */
  kept(fromX: number, fromY: number, fromZ: number, x: number, y: number, z: number, travel = 0, delay = 0, size = KEPT_QUAD, word: string | null = null, lightsDesk = false, wordSide = 1): void {
    const slot = STAR_SLOTS + this.nextKept;
    this.nextKept = (this.nextKept + 1) % KEPT_SLOTS;
    const now = timeUniform.value;
    if (travel > 0) {
      this.start.setXYZ(slot, fromX, fromY, fromZ);
      this.target.setXYZW(slot, x, y, z, now + delay);
    } else {
      this.start.setXYZ(slot, x, y, z);
    }
    this.travel.setX(slot, travel);
    this.vel.setXYZ(slot, 0, 0, 0);
    // A light already in its place (earlier evenings) fades in after `delay`; a new one is born now, in your hands.
    this.birth.setX(slot, travel > 0 ? now : now + delay);
    this.life.setX(slot, -2);
    this.tmp.setHex(0xffc27a);
    this.color.setXYZ(slot, this.tmp.r, this.tmp.g, this.tmp.b);
    this.size.setX(slot, size);
    this.dirty = true;
    const light: KeptLight = {
      slot,
      from: new Vector3(travel > 0 ? fromX : x, travel > 0 ? fromY : y, travel > 0 ? fromZ : z),
      to: new Vector3(x, y, z),
      t0: travel > 0 ? now + delay : now,
      travel,
      born: travel > 0 ? now : now + delay,
      seed: fract(Math.sin(slot * 12.9898 + 1.3) * 43758.5453),
    };
    const old = this.desk.findIndex((l) => l.slot === slot);
    if (old >= 0) this.desk.splice(old, 1);
    if (lightsDesk) {
      this.desk.push(light);
      if (this.desk.length > KEPT_LIGHTS) this.desk.shift();
    }
    if (word != null && word.length > 0) {
      // Its side (−1 left, 1 right, as seen from the seat) comes from the caller, who knows the desk.
      this.wordUniforms.uWordSide.value = wordSide;
      this.drawWord(word, wordSide);
      this.word = { at: light.t0 + light.travel, light };
    }
  }

  clearKept(): void {
    for (let i = STAR_SLOTS; i < STAR_SLOTS + KEPT_SLOTS; i++) this.life.setX(i, 0);
    this.nextKept = 0;
    this.desk.length = 0;
    this.word = null;
    this.wordUniforms.uWordK.value = 0;
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
    this.home.set([x, y, z], slot * 3);
    this.vel.setXYZ(slot, 0, 0, 0);
    this.birth.setX(slot, timeUniform.value + delay);
    this.life.setX(slot, -1);
    this.tmp.setHex(hex);
    this.color.setXYZ(slot, this.tmp.r, this.tmp.g, this.tmp.b);
    this.size.setX(slot, size);
    this.travel.setX(slot, 0);
    this.dirty = true;
  }

  clearStars(): void {
    for (let i = 0; i < STAR_SLOTS; i++) {
      this.life.setX(i, 0);
      this.travel.setX(i, 0);
    }
    this.nextStar = 0;
    this.dirty = true;
  }

  /** The kept word in light: warm white letters with a soft glow, on a transparent canvas (alpha carries both). */
  private drawWord(text: string, side: number): void {
    const c = this.wordCanvas;
    const t = this.wordUniforms.uWord.value;
    if (c == null || t == null) return;
    const ctx = c.getContext('2d');
    if (ctx == null) return;
    ctx.clearRect(0, 0, c.width, c.height);
    let size = 74;
    ctx.font = `600 ${size}px ${FONT}`;
    while (size > 40 && ctx.measureText(text).width > c.width - 40) {
      size -= 2;
      ctx.font = `600 ${size}px ${FONT}`;
    }
    // The text hugs the light: left-aligned on its right, right-aligned on its left.
    ctx.textAlign = side > 0 ? 'left' : 'right';
    const x = side > 0 ? 16 : c.width - 16;
    ctx.textBaseline = 'middle';
    // Glow first (red = 0: the shader tints it amber), then the letters (red = 1: warm white).
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillText(text, x, c.height / 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x, c.height / 2);
    t.needsUpdate = true;
  }

  /**
   * 29 Oct: per frame, a few uniforms only: tonight's kept lights as faux point lights on the desk (position along
   * the same flight as the shader, strength with its fade-in and breath), and the kept word's visibility.
   */
  update(): void {
    const now = timeUniform.value;
    const lights = rig.uKept.value;
    for (let i = 0; i < KEPT_LIGHTS; i++) {
      const l = this.desk[i];
      if (l == null) {
        lights[i].w = 0;
        continue;
      }
      const k = l.travel > 0 ? (now - l.t0) / l.travel : 1;
      const p = k <= 0 ? l.from : keptFlight(l.from, l.to, k, l.seed);
      const born = Math.min(1, Math.max(0, (now - l.born) / 0.45));
      const breath = 0.5 + 0.5 * Math.sin(now * (0.95 + 0.25 * l.seed) + l.seed * 11);
      lights[i].set(p.x, p.y, p.z, born * (0.85 + 0.3 * breath) * this.skyUniforms.uStarDim.value);
    }
    const w = this.word;
    const wk = w == null ? 0 : keptWordAlpha(now - w.at);
    this.wordUniforms.uWordK.value = wk;
    if (w != null) {
      this.wordUniforms.uWordPos.value.copy(w.light.to);
      if (wk === 0 && now > w.at + 1) this.word = null;
    }
  }

  /** Uploads changed attributes at most once per frame. */
  flush(): void {
    this.update();
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
    this.target.needsUpdate = true;
    this.travel.needsUpdate = true;
  }
}

function fract(x: number): number {
  return x - Math.floor(x);
}

/** 29 Oct: re-exported for the ritual system (the kept light's timing lives with its logic). */
export { KEPT_FLIGHT };
