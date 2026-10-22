/**
 * v8 — Rain in a place (the tea garden), drawn in-engine and anchored to the world around the seat.
 *
 * You sit sheltered under the veranda roof; the rain stays OUTSIDE: no drop, splash or ripple is ever
 * placed inside the roof (an ellipse around the seat, front edge at `roofFront`) nor behind you (the house).
 *
 *   drops     one instanced mesh: 3 distance layers (near ≤ 4 m, mid ≤ 10 m, far ≤ 24 m; fewer, wider,
 *             fainter streaks with distance = the LOD) + drips from the eave along the roof edge.
 *   splashes  one instanced mesh: small crowns on the ground and on the stones (near the eave: the drips
 *             land there), re-seeded every cycle so they never repeat in place.
 *   ripples   one quad on the pond of the panorama: analytic rings (3 × 3 cells per pixel).
 *
 * 3 draw calls, ≈ 2.6 k quads; everything moves in the vertex shader (one time uniform: zero CPU work and
 * zero buffer upload per frame). The panorama is at infinity and the rain is at 1.5–24 m: with a seated
 * head (a few cm of motion) the parallax error against the photo stays under ≈ 1°.
 * Sound: three looping rain beds placed out in the garden + a drip loop at the eave in front of you
 * (positional, HRTF), lazy-loaded the first time it rains.
 */
import {
  AudioSource,
  AudioUtils,
  BufferAttribute,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Group,
  Mesh,
  NormalBlending,
  AdditiveBlending,
  Object3D,
  PlaneGeometry,
  PlaybackMode,
  ShaderMaterial,
  type Entity,
  type World,
} from '@iwsdk/core';
import type { RainSpec } from '../logic/places.ts';
import { dropSeeds, prng } from '../logic/rain-layout.ts';
import { rig, timeUniform } from './materials.ts';

const COMMON = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  uniform vec4 uRoof;      // front, side, eave height, open half-angle (rad)
  uniform vec4 uWind;      // drift dir x, drift dir z, slant, gust
  uniform vec4 uImm;       // x: immersion (0 table stays … 1 full) — the backdrop's uState
  float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float roofEdge(float yaw) {
    float s = sin(yaw), c = cos(yaw);
    if (c <= 0.0) return uRoof.y;
    return inversesqrt((s / uRoof.y) * (s / uRoof.y) + (c / uRoof.x) * (c / uRoof.x));
  }
  // 1 when a floor point (seat frame) is outside, in the rain.
  float outside(vec2 xz) {
    float yaw = atan(xz.x, -xz.y);
    if (abs(yaw) > uRoof.w) return 0.0;
    return step(roofEdge(yaw) + 0.02, length(xz));
  }
  // Table stays: below ≈ −8° you see your real room, never rain.
  float keep(vec3 wp) {
    vec3 d = normalize(wp - cameraPosition);
    return mix(smoothstep(-0.4, -0.14, d.y), 1.0, uImm.w);
  }
`;

function dropMaterial(uniforms: Record<string, { value: unknown }>): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    side: DoubleSide,
    uniforms,
    vertexShader: /* glsl */ `
      ${COMMON}
      attribute vec4 aSeed;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        float yaw = aSeed.x;
        float r = aSeed.y;
        float layer = floor(aSeed.w);
        bool drip = layer > 2.5;
        vec2 base = vec2(sin(yaw), -cos(yaw)) * r;
        float gust = 1.0 + uWind.w * sin(uTime * 0.6 + yaw * 2.0 + r * 0.3);
        vec2 driftDir = uWind.xy * uWind.z * gust;
        float y;
        float speed;
        float alpha;
        if (drip) {
          // Eave drip: gravity from the eave, one drop every 0.9–2.2 s per drip point.
          float period = 0.9 + 1.3 * fract(aSeed.w);
          float t = mod(uTime + aSeed.z * period, period);
          float fall = sqrt(2.0 * uRoof.z / 9.81);
          y = uRoof.z - 4.905 * t * t;
          speed = 9.81 * t;
          alpha = step(t, fall) * 0.55;
          driftDir *= 0.0;
        } else {
          float top = layer < 0.5 ? uRoof.z + 0.4 : (layer < 1.5 ? 7.0 : 11.0);
          speed = 6.5 + 1.5 * aSeed.z;
          float t = fract(aSeed.z * 7.13 + uTime * speed / top);
          y = top * (1.0 - t);
          alpha = layer < 0.5 ? 0.62 : (layer < 1.5 ? 0.44 : 0.3);
          alpha *= smoothstep(0.0, 0.04, t) * smoothstep(0.0, 0.08, y);
          // From under the eave you see the rain fall past the roof edge, never above it inside.
        }
        vec2 xz = base + driftDir * (uRoof.z - y);
        alpha *= outside(xz);
        vec3 p = vec3(xz.x, y, xz.y);
        vec4 w = modelMatrix * vec4(p, 1.0);
        vec3 vel = normalize(mat3(modelMatrix) * vec3(driftDir.x * speed, -speed, driftDir.y * speed));
        vec3 toCam = cameraPosition - w.xyz;
        float dist = length(toCam);
        vec3 side = normalize(cross(vel, toCam / dist));
        // LOD: streaks keep ≈ 0.05° of width at any distance (sub-pixel drops would shimmer), length = motion blur.
        float width = max(0.0016, dist * 0.0011) * (drip ? 2.0 : 1.0);
        float len = drip ? clamp(speed * 0.02, 0.02, 0.16) : (0.09 + 0.012 * dist);
        w.xyz += side * position.x * width + vel * (position.y - 0.5) * len;
        alpha *= smoothstep(0.7, 1.4, dist) * (1.0 - smoothstep(18.0, 24.0, dist));
        alpha *= uFade * keep(w.xyz);
        vUv = position.xy + vec2(0.5, 0.0);
        vAlpha = alpha;
        gl_Position = projectionMatrix * viewMatrix * w;
        if (alpha < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uDim;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float along = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
        float a = vAlpha * across * across * along;
        if (a < 0.003) discard;
        // Cool rain light, a touch warm from the lanterns; dims with the Breathe veil.
        vec3 col = vec3(0.8, 0.85, 0.92) * (1.0 - uDim * 0.45);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}

function splashMaterial(uniforms: Record<string, { value: unknown }>): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms,
    vertexShader: /* glsl */ `
      ${COMMON}
      attribute vec4 aSeed;   // yaw, distance, phase, kind (0 ground, 1 drip landing)
      varying vec2 vUv;
      varying float vAge;
      varying float vAlpha;
      void main() {
        bool drip = aSeed.w > 0.5;
        float period = drip ? 0.9 + 1.3 * fract(aSeed.w) : 0.55 + 0.5 * aSeed.z;
        float fall = drip ? sqrt(2.0 * uRoof.z / 9.81) : 0.0;
        float tc = uTime + aSeed.z * period * (drip ? 1.0 : 3.7) - fall;
        float cycle = floor(tc / period);
        float age = (tc - cycle * period) / 0.22;
        vec2 xz;
        if (drip) {
          xz = vec2(sin(aSeed.x), -cos(aSeed.x)) * aSeed.y;
        } else {
          // A new spot every cycle, in the open (most splashes near you, where you can see them).
          float h1 = hash11(cycle * 17.0 + aSeed.x * 131.0);
          float h2 = hash11(cycle * 29.0 + aSeed.y * 71.0);
          float yaw = (h1 * 2.0 - 1.0) * uRoof.w;
          float lo = roofEdge(yaw) + 0.1;
          float r = lo + max(aSeed.y - lo, 0.0) * h2;
          xz = vec2(sin(yaw), -cos(yaw)) * r;
        }
        float alpha = (1.0 - smoothstep(0.6, 1.0, age)) * step(age, 1.0) * outside(xz) * uFade;
        vec4 w = modelMatrix * vec4(xz.x, 0.0, xz.y, 1.0);
        vec3 toCam = cameraPosition - w.xyz;
        float dist = length(toCam);
        vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
        float size = (drip ? 0.07 : 0.05) * max(1.0, dist * 0.22);
        w.xyz += right * position.x * size + vec3(0.0, 1.0, 0.0) * (position.y + 0.5) * size * 0.7;
        alpha *= 1.0 - smoothstep(9.0, 14.0, dist);
        alpha *= keep(w.xyz);
        vUv = position.xy + 0.5;
        vAge = clamp(age, 0.0, 1.0);
        vAlpha = alpha;
        gl_Position = projectionMatrix * viewMatrix * w;
        if (alpha < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uDim;
      varying vec2 vUv;
      varying float vAge;
      varying float vAlpha;
      void main() {
        // A crown: droplets thrown up on a small arc, and a flat ring at the foot.
        vec2 p = vUv - vec2(0.5, 0.0);
        float a = 0.0;
        for (int i = 0; i < 5; i++) {
          float fi = float(i);
          float ang = -0.9 + fi * 0.45;
          float rise = sin(3.1416 * vAge) * (0.55 - abs(ang) * 0.25);
          vec2 c = vec2(sin(ang) * (0.12 + 0.28 * vAge), rise);
          a += exp(-dot(p - c, p - c) / 0.0016);
        }
        float ring = exp(-pow((length(vec2(p.x, p.y * 4.0)) - 0.12 - 0.3 * vAge) / 0.03, 2.0)) * step(p.y, 0.08);
        a = (a * 0.55 + ring * 0.45) * vAlpha;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(0.62, 0.68, 0.78) * a * 0.55 * (1.0 - uDim * 0.45), 1.0);
      }
    `,
  });
}

function rippleMaterial(uniforms: Record<string, { value: unknown }>): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms,
    vertexShader: /* glsl */ `
      ${COMMON}
      varying vec2 vXZ;
      varying vec3 vWorld;
      varying vec2 vLocal;
      void main() {
        vLocal = position.xy;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vXZ = w.xz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform float uDim;
      varying vec2 vXZ;
      varying vec3 vWorld;
      varying vec2 vLocal;
      vec2 hash22(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973));
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.xx + p3.yz) * p3.zy);
      }
      void main() {
        // Soft oval mask: the pond of the panorama.
        float m = 1.0 - smoothstep(0.75, 1.0, length(vLocal));
        if (m < 0.002) discard;
        vec2 q = vXZ / 0.32;
        vec2 cell = floor(q);
        float rings = 0.0;
        for (int j = -1; j <= 1; j++) {
          for (int i = -1; i <= 1; i++) {
            vec2 c = cell + vec2(float(i), float(j));
            vec2 h = hash22(c);
            float period = 0.8 + 0.9 * h.y;
            float age = fract(uTime / period + h.x);
            vec2 centre = c + 0.2 + 0.6 * hash22(c + 3.7);
            float r = length(q - centre) * 0.32;
            float radius = age * 0.16;
            // 2 cells in 3 hold a drop at a time; soft rings (no hard graphic circles).
            rings += step(0.33, hash22(c + 9.1).x) * exp(-pow((r - radius) / 0.016, 2.0)) * (1.0 - age) * (1.0 - age);
          }
        }
        float a = rings * m * uFade * keep(vWorld);
        vec3 d = normalize(vWorld - cameraPosition);
        // The far rings are flattened by perspective: keep them faint.
        a *= smoothstep(0.02, 0.25, -d.y);
        gl_FragColor = vec4(vec3(0.75, 0.8, 0.9) * a * 0.16 * (1.0 - uDim * 0.45), 1.0);
      }
    `,
  });
}

export class RainField {
  readonly root = new Group();
  private readonly drops: Mesh;
  private readonly splashes: Mesh;
  private readonly ripples: Mesh;
  private readonly uniforms: Record<string, { value: unknown }>;
  private spec: RainSpec | null = null;
  private fade = 0;
  private target = 0;
  private audio: Entity[] = [];
  private audioVolumes: number[] = [];
  private audioLevel = -1;
  private readonly world: World;
  /** The rain's frame is an entity so its sounds (children) move with it. */
  readonly rootEntity: Entity;

  constructor(world: World, immersion: { value: { w: number } }) {
    this.world = world;
    this.uniforms = {
      uTime: timeUniform,
      uDim: rig.uDim,
      uFade: { value: 0 },
      uRoof: { value: [1.5, 2.6, 3.2, 2.06] },
      uWind: { value: [0.94, -0.34, 0.1, 0.35] },
      uImm: immersion,
    };
    const quad = new PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    const makeInstanced = (count: number): InstancedBufferGeometry => {
      const g = new InstancedBufferGeometry();
      g.setIndex(quad.getIndex());
      g.setAttribute('position', quad.getAttribute('position') as BufferAttribute);
      g.instanceCount = count;
      return g;
    };
    const dropGeo = makeInstanced(0);
    this.drops = new Mesh(dropGeo, dropMaterial(this.uniforms));
    const splashGeo = makeInstanced(0);
    const quadC = new PlaneGeometry(1, 1);
    splashGeo.setAttribute('position', quadC.getAttribute('position') as BufferAttribute);
    splashGeo.setIndex(quadC.getIndex());
    this.splashes = new Mesh(splashGeo, splashMaterial(this.uniforms));
    // The pond: a 2 × 2 plane in its own xy (vLocal), laid flat and turned toward the pond by the mesh transform.
    this.ripples = new Mesh(new PlaneGeometry(2, 2), rippleMaterial(this.uniforms));
    for (const m of [this.drops, this.splashes, this.ripples]) {
      m.frustumCulled = false;
      m.raycast = () => {};
      m.renderOrder = -7.2; // before Breathe's veil (-7): the veil dims the rain like the place
      this.root.add(m);
    }
    this.root.visible = false;
    this.rootEntity = world.createTransformEntity(this.root);
  }

  /** Draw calls right now (perf report). */
  get drawCalls(): number {
    return this.root.visible ? 3 : 0;
  }

  /** Places the rain around the seat: floor point under your eyes (world), facing yaw (radians, Three.js). */
  anchor(x: number, z: number, yaw: number): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.set(0, yaw, 0);
    this.root.updateMatrixWorld(true);
  }

  /** Starts (spec) or stops (null) the rain; it fades with the place's crossfade. */
  setRain(spec: RainSpec | null): void {
    if (spec != null) {
      if (spec !== this.spec) this.build(spec);
      this.target = 1;
      this.startAudio(spec);
    } else {
      this.target = 0;
    }
  }

  private build(spec: RainSpec): void {
    this.spec = spec;
    const u = this.uniforms;
    u.uRoof.value = [spec.roofFront, spec.roofSide, spec.eave, (Math.max(-spec.open[0], spec.open[1]) * Math.PI) / 180];
    const wy = (spec.windYaw * Math.PI) / 180;
    u.uWind.value = [Math.sin(wy), -Math.cos(wy), spec.slant, 0.35];
    const seeds = dropSeeds(spec);
    const dg = this.drops.geometry as InstancedBufferGeometry;
    dg.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
    dg.instanceCount = seeds.length / 4;
    // Splashes: 220 on the ground (re-seeded each cycle) + one per eave drip, where it lands.
    const rnd = prng(11);
    const ground = 220;
    const drips: number[] = [];
    for (let i = 0; i < seeds.length; i += 4) if (seeds[i + 3] >= 3) drips.push(i);
    const sp = new Float32Array((ground + drips.length) * 4);
    for (let i = 0; i < ground; i++) {
      // Distance budget: half within 4 m, the rest out to 9 m.
      const reach = i < ground / 2 ? 4 : 9;
      sp.set([rnd() * 6.283, reach, rnd(), 0], i * 4);
    }
    drips.forEach((o, k) => {
      sp.set([seeds[o], seeds[o + 1], seeds[o + 2], 1 + (seeds[o + 3] - 3)], (ground + k) * 4);
    });
    const sg = this.splashes.geometry as InstancedBufferGeometry;
    sg.setAttribute('aSeed', new InstancedBufferAttribute(sp, 4));
    sg.instanceCount = ground + drips.length;
    // Pond ripples where the panorama shows the water.
    const py = (spec.pond.yaw * Math.PI) / 180;
    this.ripples.position.set(Math.sin(py) * spec.pond.dist, -spec.pond.drop, -Math.cos(py) * spec.pond.dist);
    // Euler YXZ: lay the plane flat (x), then turn it to face along the view to the pond (y).
    this.ripples.rotation.set(-Math.PI / 2, -py, 0, 'YXZ');
    this.ripples.scale.set(spec.pond.across, spec.pond.along, 1);
  }

  private startAudio(spec: RainSpec): void {
    if (this.audio.length > 0) {
      for (const e of this.audio) if (!AudioUtils.isPlaying(e)) AudioUtils.play(e, 2);
      return;
    }
    const base = import.meta.env.BASE_URL;
    const make = (src: string, x: number, y: number, z: number, volume: number, ref: number): Entity => {
      const holder = new Object3D();
      holder.position.set(x, y, z);
      const entity = this.world.createTransformEntity(holder, this.rootEntity).addComponent(AudioSource, {
        src: `${base}${src}`,
        volume,
        loop: true,
        positional: true,
        refDistance: ref,
        rolloffFactor: 0.8,
        playbackMode: PlaybackMode.FadeRestart,
      });
      return entity;
    };
    // Three beds out in the garden (left, ahead, right) and the eave drip just ahead of you.
    const d = 5;
    this.audioVolumes = [0.32, 0.3, 0.32, 0.22];
    this.audio = [
      make('audio/rain.ogg', -d * 0.8, 1.2, -d * 0.6, 0, 2.5),
      make('audio/rain.ogg', 0, 1.0, -d, 0, 2.5),
      make('audio/rain.ogg', d * 0.8, 1.2, -d * 0.6, 0, 2.5),
      make('audio/drip.ogg', 0.35, 1.6, -spec.roofFront, 0, 0.8),
    ];
    for (const e of this.audio) AudioUtils.play(e, 2);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt / 0.55);
    this.fade += (this.target - this.fade) * k;
    if (this.target === 0 && this.fade < 0.004) this.fade = 0;
    this.uniforms.uFade.value = this.fade;
    this.root.visible = this.fade > 0;
    if (this.audio.length > 0) {
      // The sound follows the picture's fade (updated only when it changes by ≥ 1 %).
      if (Math.abs(this.fade - this.audioLevel) > 0.01 || (this.fade === 0 && this.audioLevel !== 0)) {
        this.audioLevel = this.fade;
        this.audio.forEach((e, i) => AudioUtils.setVolume(e, this.audioVolumes[i] * this.fade));
      }
      if (this.target === 0 && this.fade === 0) {
        for (const e of this.audio) if (AudioUtils.isPlaying(e)) AudioUtils.stop(e);
      }
    }
  }
}
