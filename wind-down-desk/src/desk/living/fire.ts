/**
 * Living places — "Ember fire": a real 3D campfire on the meadow, 4.0–6.2 m ahead and 35° to the left (clear of the panels on the right).
 *
 *   hearth   1 draw call: a ring of granite stones (soot on the inner faces, lit by the fire), a low pile of logs
 *            (charred bark whose cracks glow near the embers) and the ember bed (slow animated noise: a crust that
 *            darkens and cracks over a ≈ 1 800 K core that breathes).
 *   flames   1 draw call: a few low, soft tongues (cylindrical billboards, rising noise, blackbody ramp) and a faint
 *            glow in the air around them.
 *   sparks   1 draw call: a few always rising and dying, a spray with every crackle, a big gerbe when a stone is
 *            released into the water (Release).
 *   ground   1 draw call, "Full" only: a disk of scorched earth and short grass (Poly Haven CC0) lit by the fire,
 *            photo-lit and faded into the photo's own ground. Never drawn in "Table stays".
 *   glow     1 draw call: a patch of the panorama around the fire, its grass lit by the flickering light (both
 *            modes), and a faint heat shimmer above the flames.
 * In "Table stays" the fire stands farther (6.2 m): its flames above the passthrough band, on the photo's ground.
 * All motion in shaders (one time uniform); the CPU writes the light's intensity once a frame (fire-light.ts).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  NoColorSpace,
  NormalBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SrcAlphaFactor,
  TextureLoader,
  Vector3,
  ZeroFactor,
  type Texture,
} from '@iwsdk/core';
import type { PlaceBackdrop } from '../environment.ts';
import { prng, type FireSpec } from '../../logic/living.ts';
import { FIRE_LIGHT_GLSL } from './fire-light.ts';
import { patchFragment, PATCH_VERTEX, PHOTO_ANGLES, photoLitGlsl, sphereRegion, type Uniforms } from './pano.ts';

const NOISE2 = /* glsl */ `
  float fh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float fn(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(fh(i), fh(i + vec2(1.0, 0.0)), f.x), mix(fh(i + vec2(0.0, 1.0)), fh(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) { return fn(p) * 0.55 + fn(p * 2.03 + 7.1) * 0.3 + fn(p * 4.1 + 3.3) * 0.15; }
  vec2 fh2(vec2 p) { return vec2(fh(p), fh(p + 17.31)); }
  // x: distance to the nearest cell edge, y: to the nearest centre.
  vec2 fcells(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); float d1 = 8.0; float d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y)); float d = length(g + fh2(i + g) - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return vec2(d2 - d1, d1);
  }
  // Blackbody-like ramp for glowing wood: 0 = dark, 0.5 ≈ deep red, 0.8 ≈ orange (≈ 1 800 K), 1.1 ≈ yellow.
  vec3 glowRamp(float h) {
    h = max(h, 0.0);
    return vec3(1.0, 0.16, 0.02) * smoothstep(0.12, 0.55, h) * 1.6
         + vec3(0.6, 0.36, 0.05) * smoothstep(0.45, 0.85, h) * 2.0
         + vec3(0.5, 0.45, 0.25) * smoothstep(0.85, 1.25, h) * 2.0;
  }
`;

// ------------------------------------------------------------------ geometry

interface Parts {
  pos: number[];
  nrm: number[];
  kind: number[];
  local: number[];
  idx: number[];
}

function push(parts: Parts, g: BufferGeometry, kind: number, xform: Matrix4, local: (p: Vector3, i: number) => [number, number, number]): void {
  g.computeVertexNormals();
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const base = parts.pos.length / 3;
  const v = new Vector3();
  const nm = new Vector3();
  const normalMatrix = new Matrix4().copy(xform).invert().transpose();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    parts.local.push(...local(v, i));
    v.applyMatrix4(xform);
    nm.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix4(normalMatrix).normalize();
    parts.pos.push(v.x, v.y, v.z);
    parts.nrm.push(nm.x, nm.y, nm.z);
    parts.kind.push(kind);
  }
  const index = g.getIndex();
  if (index != null) for (let i = 0; i < index.count; i++) parts.idx.push(base + index.getX(i));
  else for (let i = 0; i < p.count; i++) parts.idx.push(base + i);
}

/** Stones, logs and the ember bed in the fire's own frame (origin on the ground at the centre). Pure geometry. */
export function hearthGeometry(spec: FireSpec): BufferGeometry {
  const rnd = prng(21);
  const parts: Parts = { pos: [], nrm: [], kind: [], local: [], idx: [] };
  // Logs and ember bed grow with the ring (designed for a 0.46 m ring).
  const k = spec.ringRadius / 0.46;
  // Stones: lumpy, flattened spheres half sunk in the ground, a slightly irregular ring.
  for (let i = 0; i < spec.stones; i++) {
    const g = new SphereGeometry(1, 9, 6).toNonIndexed();
    const a1 = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    const a2 = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    const s1 = rnd() * 6;
    const p = g.getAttribute('position');
    const v = new Vector3();
    for (let k = 0; k < p.count; k++) {
      v.set(p.getX(k), p.getY(k), p.getZ(k));
      const bump = 1 + 0.16 * Math.sin(v.dot(a1) * 2.7 + s1) + 0.08 * Math.sin(v.dot(a2) * 5.9 + s1 * 2) + 0.035 * Math.sin(v.x * 11 + v.z * 7 + s1);
      v.multiplyScalar(bump);
      // Flat-ish faces (split stone) and a flat base sunk in the ground.
      if (v.dot(a2) > 0.55) v.addScaledVector(a2, (0.55 - v.dot(a2)) * 0.7);
      v.y = Math.max(v.y, -0.5);
      // Rounded field stones (no flat top: flat tops read as pucks), a bigger lump on one side.
      v.addScaledVector(a1, 0.12 * Math.max(0, v.dot(a1)));
      p.setXYZ(k, v.x, v.y, v.z);
    }
    // Field stones of very different sizes, unevenly spaced (a ring someone built by hand, not a pattern).
    const ang = (i / spec.stones) * Math.PI * 2 + (rnd() - 0.5) * 0.42;
    const big = rnd();
    const r = spec.ringRadius * (0.9 + rnd() * 0.2) + big * 0.03;
    const w = 0.065 + big * big * 0.045 + rnd() * 0.02;
    const h = 0.055 + big * 0.035 + rnd() * 0.02;
    const m = new Matrix4()
      .makeTranslation(Math.cos(ang) * r, h * 0.35, Math.sin(ang) * r)
      .multiply(new Matrix4().makeRotationY(-ang + (rnd() - 0.5) * 0.6))
      .multiply(new Matrix4().makeRotationX((rnd() - 0.5) * 0.5))
      .multiply(new Matrix4().makeRotationZ((rnd() - 0.5) * 0.5))
      .multiply(new Matrix4().makeScale(w * (0.95 + rnd() * 0.35), h, w * (0.8 + rnd() * 0.3)));
    push(parts, g, 0, m, (q) => [q.x * 3 + i * 7.3, q.y * 3, q.z * 3]);
  }
  // Logs: a low pile, pointing in, resting on each other over the embers.
  for (let i = 0; i < spec.logs; i++) {
    const len = (0.5 + rnd() * 0.14) * k;
    const rad = (0.038 + rnd() * 0.016) * Math.sqrt(k);
    const g = new CylinderGeometry(rad * 0.92, rad, len, 12, 5, false);
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k);
      const bend = 0.012 * Math.sin((y / len) * Math.PI * 2 + i);
      p.setX(k, p.getX(k) + bend);
    }
    const ang = (i / spec.logs) * Math.PI * 2 + 0.4 + (rnd() - 0.5) * 0.5;
    const tilt = 0.18 + rnd() * 0.12;
    const m = new Matrix4()
      .makeTranslation(Math.cos(ang) * 0.12 * k, 0.045 + i * 0.022, Math.sin(ang) * 0.12 * k)
      .multiply(new Matrix4().makeRotationY(-ang))
      .multiply(new Matrix4().makeRotationZ(Math.PI / 2 - tilt));
    push(parts, g, 1, m, (q) => [q.y / len, Math.atan2(q.z, q.x), Math.hypot(q.x, q.z) / rad]);
  }
  // Ember bed: a low irregular mound.
  {
    const rings = 10;
    const seg = 40;
    const pos: number[] = [];
    const idx: number[] = [];
    pos.push(0, 0.05, 0);
    for (let j = 1; j <= rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const edge = 0.3 * k * (1 + 0.12 * Math.sin(a * 3 + 1.3) + 0.07 * Math.sin(a * 7 + 0.4));
        const r = (j / rings) * edge;
        const y = 0.05 * (1 - (j / rings) ** 2) + 0.004;
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      }
    }
    for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
    for (let j = 1; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = 1 + (j - 1) * seg + i;
        const b = 1 + (j - 1) * seg + ((i + 1) % seg);
        idx.push(a, b, a + seg, b, b + seg, a + seg);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    push(parts, g, 2, new Matrix4(), (q) => [q.x, q.z, 0]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(parts.pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(parts.nrm), 3));
  g.setAttribute('aKind', new BufferAttribute(new Float32Array(parts.kind), 1));
  g.setAttribute('aLocal', new BufferAttribute(new Float32Array(parts.local), 3));
  g.setIndex(parts.idx);
  return g;
}

// ------------------------------------------------------------------ materials

function hearthMaterial(backdrop: PlaceBackdrop, shared: Uniforms): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: shared,
    vertexShader: /* glsl */ `
      attribute float aKind;
      attribute vec3 aLocal;
      varying vec3 vN;
      varying vec3 vWorld;
      varying vec3 vObj;
      varying vec3 vLocal;
      varying float vKind;
      varying vec3 vDir;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vObj = position;
        vN = normalize(mat3(modelMatrix) * normal);
        vLocal = aLocal;
        vKind = aKind;
        vDir = normalize(w.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${photoLitGlsl(backdrop)}
      ${FIRE_LIGHT_GLSL}
      ${NOISE2}
      uniform float uLivingFade;
      uniform float uFireLevel;
      uniform float uRoomDim;
      varying vec3 vN;
      varying vec3 vWorld;
      varying vec3 vObj;
      varying vec3 vLocal;
      varying float vKind;
      void main() {
        vec3 N = normalize(vN);
        vec3 d = normalize(vWorld - cameraPosition);
        if (dot(N, d) > 0.0 && vKind > 1.5) N = -N;
        // Ambient from the photo itself: its sky above, its ground around (evening included).
        vec3 skyA = photo(vec3(0.0, 1.0, 0.0));
        vec3 grA = photo(normalize(vec3(d.x, -0.25, d.z)));
        vec3 amb = mix(grA * 0.9, skyA * 1.4, N.y * 0.5 + 0.5);
        float t = uTime;
        float breath = uFireBurst.w;
        vec3 col;
        float rad = length(vObj.xz);
        if (vKind < 0.5) {
          // Granite, sooted on the faces turned to the fire.
          // Split faces: the geometric facet normal mixed in (dFdx), a fine grain bump, lichen-dark patches.
          vec3 Nf = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
          if (dot(Nf, d) > 0.0) Nf = -Nf;
          N = normalize(mix(N, Nf, 0.55));
          float g = fn(vLocal.xz * 9.0 + vLocal.y * 5.0) * 0.6 + fn(vLocal.xy * 23.0) * 0.4;
          float tone = fh(vec2(floor(vLocal.x * 0.137 + 0.5), 3.1));
          vec3 alb = mix(vec3(0.1, 0.097, 0.092), vec3(0.27, 0.255, 0.235), g) * (0.78 + 0.44 * fn(vLocal.xz * 41.0)) * mix(0.75, 1.15, tone);
          float inner = max(dot(N, normalize(vec3(-vObj.x, 0.4, -vObj.z))), 0.0);
          alb *= mix(1.0, 0.45, inner * smoothstep(0.03, 0.08, vObj.y + 0.02));
          // Contact shadow where the stone meets the ground.
          float ao = mix(0.35, 1.0, smoothstep(0.0, 0.04, vObj.y));
          // + the warm bounce of the fire-lit ground on the outer faces (they are never pitch black).
          col = alb * ao * (amb * 1.6 + fireLightAt(vWorld, N, 0.15) * 0.42 + vec3(1.0, 0.46, 0.16) * max(uFire.w, 0.0) * 0.1 * (0.6 - 0.4 * N.y));
          // A cool sheen of the night sky on the tops.
          col += alb * skyA * 2.0 * pow(max(N.y, 0.0), 4.0) * ao;
        } else if (vKind < 1.5) {
          // Charred logs: bark grooves along the log, glowing cracks where it lies in the embers.
          float along = vLocal.x;
          float around = vLocal.y;
          vec2 c = fcells(vec2(along * 9.0, around * 2.4 + vObj.x * 3.0));
          float groove = fn(vec2(along * 3.0, around * 6.0));
          float near = 1.0 - smoothstep(0.08, 0.3, rad);
          // Bark: charred black near the fire, grey-brown further out.
          vec3 alb = mix(vec3(0.03, 0.026, 0.024), vec3(0.13, 0.095, 0.065) * (0.7 + 0.6 * groove), smoothstep(0.12, 0.34, rad));
          // The cut ends: pale wood with rings outside, charcoal inside the fire.
          float cap = smoothstep(0.93, 0.985, abs(along) * 2.0) * step(vLocal.z, 0.98);
          float rings = 0.5 + 0.5 * sin(vLocal.z * 38.0 + fn(vObj.xz * 40.0) * 3.0);
          vec3 endWood = mix(vec3(0.3, 0.2, 0.12), vec3(0.2, 0.13, 0.075), rings) * (1.0 - 0.6 * smoothstep(0.85, 1.0, vLocal.z));
          alb = mix(alb, mix(vec3(0.03), endWood, smoothstep(0.15, 0.3, rad)), cap);
          // The end burning in the fire glows through cracks of charcoal (never a black disc in front of the flames).
          vec2 cc = fcells(vObj.xz * 90.0 + vObj.y * 40.0);
          float capHeat = cap * (1.0 - smoothstep(0.1, 0.24, rad)) * uFireLevel;
          col = vec3(0.0);
          col += glowRamp(capHeat * (0.7 + 0.5 * smoothstep(0.12, 0.0, cc.x)) * (0.9 + 0.2 * breath)) * capHeat;
          float low = 1.0 - smoothstep(0.03, 0.16, vObj.y);
          float heat = near * (0.55 + 0.45 * low) * (0.85 + 0.15 * sin(t * 0.6 + along * 9.0)) * uFireLevel;
          float crack = smoothstep(0.09, 0.0, c.x);
          col += alb * (amb + fireLightAt(vWorld, N, 0.3) * 0.45);
          col += glowRamp(heat * (0.55 + 0.6 * crack) * (0.9 + 0.2 * breath)) * (0.25 + 0.75 * crack) * heat;
        } else {
          // Ember bed: a dark crust breaking over a core that breathes (slow, never flashing).
          vec2 q = vLocal.xy * 14.0;
          vec2 c = fcells(q + vec2(sin(t * 0.05), cos(t * 0.04)) * 0.6);
          float n = fbm(q * 0.45 + vec2(t * 0.07, -t * 0.05));
          float pulse = 0.88 + 0.12 * sin(t * 0.5 + n * 6.0) + 0.22 * (breath - 0.5);
          float core = (1.0 - smoothstep(0.0, 0.3, rad)) * (0.7 + 0.5 * n) * pulse * (0.35 + 0.65 * uFireLevel);
          float crust = smoothstep(0.02, 0.16, c.x) * smoothstep(0.35, 0.8, fbm(q * 0.3 - t * 0.03));
          float heat = core * mix(1.15, 0.25, crust);
          vec3 ash = vec3(0.05, 0.045, 0.042) * (0.6 + 0.6 * fn(q * 2.0));
          col = ash * (amb + fireLightAt(vWorld, vec3(0.0, 1.0, 0.0), 0.3) * 0.5) + glowRamp(heat) * (0.6 + 0.6 * core);
          // Embers that twinkle on the bed: tiny hot points, each fading in and out slowly (≤ 0.5 Hz, no flashing).
          vec2 cell = floor(q * 2.6);
          float pick = fh(cell + 0.37);
          vec2 fp = fract(q * 2.6) - 0.5;
          float spot = exp(-dot(fp, fp) * 60.0) * step(0.82, pick);
          float tw = 0.5 + 0.5 * sin(t * (0.9 + 2.2 * fh(cell + 9.1)) + pick * 40.0);
          col += glowRamp(0.75 + 0.35 * tw) * spot * tw * 0.9 * (1.0 - smoothstep(0.15, 0.36, rad)) * (0.4 + 0.6 * uFireLevel);
        }
        float a = uLivingFade * keepView(d);
        if (a < 0.002) discard;
        // Breathe's veil (drawn behind the fire): the lit stones and logs sink with the place, the glow less.
        col *= 1.0 - uRoomDim * 0.55;
        gl_FragColor = vec4(photoDisplay(col), a);
      }
    `,
    transparent: true,
    depthWrite: true,
  });
}

function flameMaterial(shared: Uniforms): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: shared,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uFireLevel;
      uniform vec4 uFireBurst;
      attribute vec4 aFlame;   // x, z offset, height, seed
      attribute float aGlow;   // 1: the air glow around the flames
      varying vec2 vUv;
      varying float vSeed;
      varying float vGlow;
      varying vec3 vWorld;
      void main() {
        float seed = aFlame.w;
        float t = uTime;
        float burst = exp(-max(t - uFireBurst.x, 0.0) / 0.5) * step(uFireBurst.x, t) * uFireBurst.y;
        float level = uFireLevel;
        // Tongues breathe slowly (all under 3 Hz) and shrink to almost nothing as the fire settles for the night.
        float h = aFlame.z * (0.82 + 0.1 * sin(t * (0.9 + seed * 1.3) + seed * 9.0) + 0.08 * sin(t * (2.1 + seed) + seed * 3.0) + 0.25 * burst);
        h *= mix(0.12, 1.0, level) * (1.0 + 0.08 * (uFireBurst.w - 0.5));
        vec3 base = vec3(aFlame.x, 0.04, aFlame.y);
        float wid = aGlow > 0.5 ? 2.6 : (0.16 + 0.34 * aFlame.z) * mix(0.6, 1.0, level);
        float hgt = aGlow > 0.5 ? 2.6 : h;
        vec4 c = modelMatrix * vec4(base, 1.0);
        vec3 toCam = cameraPosition - c.xyz;
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 right = normalize(cross(up, toCam));
        vec3 wpos;
        if (aGlow > 0.5) {
          vec3 vup = normalize(cross(toCam, right));
          wpos = c.xyz + up * 0.42 + right * position.x * wid + vup * position.y * hgt;
        } else {
          wpos = c.xyz + right * position.x * wid + up * (position.y + 0.5) * hgt;
        }
        vUv = position.xy + vec2(0.0, 0.5);
        vSeed = seed;
        vGlow = aGlow;
        vWorld = wpos;
        gl_Position = projectionMatrix * viewMatrix * vec4(wpos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE2}
      uniform float uTime;
      uniform float uLivingFade;
      uniform float uFireLevel;
      uniform float uRoomDim;
      uniform vec4 uFire;
      uniform vec4 uState;
      varying vec2 vUv;
      varying float vSeed;
      varying float vGlow;
      varying vec3 vWorld;
      void main() {
        vec3 d = normalize(vWorld - cameraPosition);
        float keep = mix(smoothstep(-0.4, -0.14, d.y), 1.0, uState.w);
        float f = uLivingFade * keep;
        if (vGlow > 0.5) {
          // Warm air glow around the fire (very faint, it only lifts the night around the flames).
          float r = length(vUv - vec2(0.0, 0.5)) * 2.0;
          // A soft volumetric glow in the warm air above the fire (additive, two gaussians, follows the light).
          float g = (exp(-r * r * 4.0) * 0.075 + exp(-r * r * 22.0) * 0.07) * clamp(uFire.w, 0.0, 2.0);
          gl_FragColor = vec4(vec3(1.0, 0.45, 0.14) * g * f * (1.0 - uRoomDim * 0.3), 1.0);
          return;
        }
        float t = uTime;
        float y = clamp(vUv.y, 0.0, 1.0);
        // An organic flame, no sprite: three layers of rising noise (slow body, licks, fine flicker), a sideways
        // sway that grows with height, soft edges everywhere (no hard threshold), temperature that falls with
        // height: white-yellow core at the base → orange → dark red at the tips, then nothing (smoke is not drawn).
        float sx = vUv.x;
        float sway = (fbm(vec2(vSeed * 7.0, y * 1.2 - t * 0.55)) - 0.5) * 0.55 * y * y;
        float x = sx - sway;
        float n1 = fbm(vec2(x * 2.4 + vSeed * 13.0, y * 1.6 - t * 1.25));
        float n2 = fbm(vec2(x * 5.3 - vSeed * 5.0, y * 3.4 - t * 2.3));
        float n3 = fn(vec2(x * 11.0 + vSeed * 3.0, y * 7.5 - t * 3.6));
        float n = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;
        // Width: full at the root, pinched at the tip; the noise eats the outline (licks), more with height.
        float w = 0.46 * pow(1.0 - y, 0.55) * smoothstep(0.0, 0.1, y + 0.02);
        float edge = abs(x) / max(w, 1e-3);
        float body = 1.0 - smoothstep(0.35, 1.0, edge + (n - 0.5) * (0.5 + 1.1 * y));
        float tear = smoothstep(0.0, 0.45, n * 1.25 - y * 0.85 + 0.25);
        float dens = body * tear * smoothstep(0.0, 0.06, y);
        dens = dens * dens * (3.0 - 2.0 * dens);
        // Temperature: hottest low and in the middle.
        float temp = dens * (1.0 - y * 0.95) * (0.75 + 0.35 * (1.0 - smoothstep(0.0, 0.7, edge)));
        vec3 col = vec3(0.32, 0.03, 0.005) * smoothstep(0.0, 0.25, temp)
                 + vec3(0.75, 0.24, 0.03) * smoothstep(0.15, 0.5, temp)
                 + vec3(0.55, 0.42, 0.16) * smoothstep(0.4, 0.75, temp)
                 + vec3(0.35, 0.33, 0.28) * smoothstep(0.65, 0.95, temp);
        col *= dens * 1.35;
        // A hint of blue at the very root, where the gas is hottest.
        col += vec3(0.03, 0.05, 0.16) * body * (1.0 - smoothstep(0.0, 0.08, y)) * 0.5;
        col *= mix(0.55, 1.0, uFireLevel);
        gl_FragColor = vec4(col * f * (1.0 - uRoomDim * 0.3), 1.0);
      }
    `,
  });
}

function flameGeometry(k = 1): InstancedBufferGeometry {
  const quad = new PlaneGeometry(1, 1);
  const g = new InstancedBufferGeometry();
  g.setIndex(quad.getIndex());
  g.setAttribute('position', quad.getAttribute('position') as BufferAttribute);
  const rnd = prng(33);
  const flames: number[] = [];
  const glow: number[] = [];
  const n = 13;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6;
    const r = (i < 3 ? 0.02 + rnd() * 0.04 : 0.06 + rnd() * 0.11) * k;
    flames.push(Math.cos(a) * r, Math.sin(a) * r, (i < 3 ? 0.5 + rnd() * 0.12 : 0.18 + rnd() * 0.22) * Math.sqrt(k), rnd());
    glow.push(0);
  }
  flames.push(0, 0, 1, 0.5);
  glow.push(1);
  g.setAttribute('aFlame', new InstancedBufferAttribute(new Float32Array(flames), 4));
  g.setAttribute('aGlow', new InstancedBufferAttribute(new Float32Array(glow), 1));
  g.instanceCount = n + 1;
  return g;
}

/** Spark groups: 0 = always rising, 1 = thrown by each crackle, 2 = the Release gerbe. */
export const SPARKS = { ambient: 30, crackle: 22, release: 44 } as const;

function sparkGeometry(): InstancedBufferGeometry {
  const quad = new PlaneGeometry(1, 1);
  const g = new InstancedBufferGeometry();
  g.setIndex(quad.getIndex());
  g.setAttribute('position', quad.getAttribute('position') as BufferAttribute);
  const rnd = prng(44);
  const data: number[] = [];
  const add = (group: number, n: number) => {
    for (let i = 0; i < n; i++) data.push(group, rnd(), rnd(), rnd());
  };
  add(0, SPARKS.ambient);
  add(1, SPARKS.crackle);
  add(2, SPARKS.release);
  g.setAttribute('aSpark', new InstancedBufferAttribute(new Float32Array(data), 4));
  g.instanceCount = data.length / 4;
  return g;
}

function sparkMaterial(shared: Uniforms): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: shared,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uFireLevel;
      uniform vec4 uFireBurst;
      uniform vec4 uState;
      attribute vec4 aSpark;
      varying vec2 vUv;
      varying float vHeat;
      varying float vAlpha;
      void main() {
        float group = aSpark.x;
        float s1 = aSpark.y;
        float s2 = aSpark.z;
        float s3 = aSpark.w;
        float t = uTime;
        float life;
        float age;
        float v0;
        float spread;
        float on = 1.0;
        if (group < 0.5) {
          life = 1.3 + 1.5 * s1;
          float period = life + 0.6 + 3.0 * s2;
          age = mod(t + s3 * period * 7.0, period);
          v0 = 0.7 + 0.8 * s2;
          spread = 0.25;
          on = step(s1, 0.15 + 0.85 * uFireLevel);
        } else if (group < 1.5) {
          age = t - uFireBurst.x - s3 * 0.12;
          life = 0.7 + 1.3 * s1;
          v0 = 1.2 + 1.9 * s2;
          spread = 0.55;
          on = step(s2, 0.25 + 0.75 * uFireBurst.y);
        } else {
          age = t - uFireBurst.z - s3 * 0.35;
          life = 1.2 + 1.6 * s1;
          v0 = 1.8 + 2.4 * s2;
          spread = 0.75;
        }
        float k = clamp(age / life, 0.0, 1.0);
        on *= step(0.0, age) * step(age, life);
        // Rise with drag and a little buoyancy; drift and flutter in the hot air.
        float a = s1 * 37.0 + s3 * 11.0;
        vec2 dir = vec2(cos(a), sin(a)) * spread * (0.4 + 0.6 * s3);
        float drag = 1.6;
        float rise = v0 / drag * (1.0 - exp(-drag * age)) + 0.12 * age;
        vec2 lat = dir * v0 / drag * (1.0 - exp(-drag * age)) * 0.6;
        lat += vec2(sin(t * 1.7 + s1 * 20.0), cos(t * 1.3 + s2 * 20.0)) * 0.05 * age;
        lat += vec2(0.18, -0.05) * age * age * 0.25;
        vec3 p = vec3(lat.x + (s2 - 0.5) * 0.18, 0.08 + rise, lat.y + (s3 - 0.5) * 0.18);
        vec3 vel = vec3(dir.x * 0.6, 1.0, dir.y * 0.6) * exp(-drag * age) * v0 + vec3(0.0, 0.12, 0.0);
        vec4 w = modelMatrix * vec4(p, 1.0);
        vec3 toCam = cameraPosition - w.xyz;
        float dist = length(toCam);
        vec3 vdir = normalize(mat3(modelMatrix) * vel);
        vec3 side = normalize(cross(vdir, toCam / dist));
        float width = max(0.005, dist * 0.0012);
        float len = width + length(vel) * 0.022;
        w.xyz += side * position.x * width + vdir * position.y * len;
        vHeat = 1.0 - k;
        vec3 d = normalize(w.xyz - cameraPosition);
        float keep = mix(smoothstep(-0.4, -0.14, d.y), 1.0, uState.w);
        vAlpha = on * keep * smoothstep(0.0, 0.06, k) * (1.0 - smoothstep(0.6, 1.0, k)) * (0.75 + 0.25 * sin(t * 2.3 + s1 * 40.0));
        vUv = position.xy;
        gl_Position = projectionMatrix * viewMatrix * w;
        if (vAlpha < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uLivingFade;
      uniform float uRoomDim;
      varying vec2 vUv;
      varying float vHeat;
      varying float vAlpha;
      void main() {
        float r = length(vUv * vec2(2.0, 2.0));
        float a = exp(-r * r * 2.5) * vAlpha * uLivingFade;
        if (a < 0.003) discard;
        // Cooling: white-yellow → orange → deep red.
        vec3 c = mix(vec3(0.85, 0.16, 0.02), vec3(1.0, 0.58, 0.18), smoothstep(0.25, 0.9, vHeat));
        gl_FragColor = vec4(c * a * 1.25 * (1.0 - uRoomDim * 0.3), 1.0);
      }
    `,
  });
}

let groundTextures: Promise<[Texture, Texture]> | null = null;
function loadGroundTextures(): Promise<[Texture, Texture]> {
  if (groundTextures == null) {
    const loader = new TextureLoader();
    const one = (src: string) =>
      loader.loadAsync(`${import.meta.env.BASE_URL}${src}`).then((t) => {
        t.wrapS = RepeatWrapping;
        t.wrapT = RepeatWrapping;
        t.colorSpace = NoColorSpace;
        t.anisotropy = 4;
        return t;
      });
    groundTextures = Promise.all([one('textures/living/burned-ground.jpg'), one('textures/living/grass-path.jpg')]);
  }
  return groundTextures;
}

function groundMaterial(backdrop: PlaceBackdrop, shared: Uniforms, spec: FireSpec): ShaderMaterial {
  const c = spec.clearing;
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      ...shared,
      uBurnt: { value: null },
      uGrass: { value: null },
      uReady: { value: 0 },
      // x, y: the fire on the ground (seat frame); z: disk radius; w: 1 = clearing extended around you.
      uGround: { value: [0, -spec.distFull, spec.groundRadius, c != null ? 1 : 0] },
      uRing: { value: [c?.inner ?? 0, c?.outer ?? 0] },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec2 vLocal;
      varying vec3 vDir;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vLocal = position.xz;
        vDir = normalize(w.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${photoLitGlsl(backdrop)}
      ${FIRE_LIGHT_GLSL}
      ${NOISE2}
      uniform float uLivingFade;
      uniform sampler2D uBurnt;
      uniform sampler2D uGrass;
      uniform float uReady;
      uniform vec4 uGround;
      uniform vec2 uRing;
      varying vec3 vWorld;
      varying vec2 vLocal;
      void main() {
        vec3 d = normalize(vWorld - cameraPosition);
        float rs = length(vLocal);
        vec2 f = vLocal - uGround.xy;
        float rf = length(f);
        float wob = fn(vLocal * 2.3) * 0.35 + fn(vLocal * 6.0) * 0.12;
        vec3 ph = photo(d);
        // Night light on this ground: the sky above and the horizon around (the photo's own light, evening included).
        vec3 sky = photo(vec3(0.0, 1.0, 0.0)) * 0.55 + photo(normalize(vec3(d.x, 0.04, d.z))) * 0.45;
        vec3 illum = sky / 0.12 * 0.45;
        vec3 burnt = pow(texture2D(uBurnt, f * 0.85).rgb, vec3(2.2));
        vec3 grass = pow(texture2D(uGrass, vLocal * 0.55 + 0.37).rgb, vec3(2.2));
        float inner = 1.0 - smoothstep(0.55, 1.1, rf + wob * 0.6);
        vec3 alb = mix(grass * 0.8, burnt * 0.75, inner);
        // Soot and ash just around the stones.
        alb *= mix(1.0, 0.55, (1.0 - smoothstep(0.35, 0.75, rf)) * 0.8);
        vec3 lightF = fireLightAt(vWorld, vec3(0.0, 1.0, 0.0), 0.0) * 0.5 + fireGlowAt(vWorld);
        vec3 col = alb * illum + alb * lightF * 0.9;
        float a;
        if (uGround.w > 0.5) {
          // The clearing, extended around you: blends into the photo's own ground near you, into the trees far out.
          float near = smoothstep(uRing.x, uRing.x + 0.6, rs + wob * 0.3);
          float far = 1.0 - smoothstep(uRing.y - 1.6, uRing.y, rs + wob * 1.2);
          col = mix(ph * (1.0 + lightF * 1.6), col, near * uReady);
          a = far;
        } else {
          float own = 1.0 - smoothstep(uGround.z * 0.55, uGround.z * 0.95, rf + wob * 0.5);
          col = mix(ph * (1.0 + lightF * 1.6), col, own * uReady);
          a = 1.0 - smoothstep(uGround.z * 0.85, uGround.z, rf + wob * 0.4);
        }
        // "Full" only: in "Table stays" this ground is your room.
        a *= uLivingFade * smoothstep(0.9, 1.0, uState.w);
        if (a < 0.002) discard;
        gl_FragColor = vec4(photoDisplay(col), a);
      }
    `,
  });
  material.blending = CustomBlending;
  material.blendSrc = SrcAlphaFactor;
  material.blendDst = OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = ZeroFactor;
  material.blendDstAlpha = OneFactor;
  void loadGroundTextures().then(([b, g]) => {
    material.uniforms.uBurnt.value = b;
    material.uniforms.uGrass.value = g;
    material.uniforms.uReady.value = 1;
  });
  return material;
}

/** Ground in the seat frame: a polar patch around you, r ∈ [r0, r1], yaw ∈ [y0, y1] (radians, 0 = ahead, + right). */
function groundGeometry(r0: number, r1: number, y0: number, y1: number): BufferGeometry {
  const rings = 22;
  const seg = Math.max(12, Math.round(((y1 - y0) / (Math.PI * 2)) * 112));
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rings; j++) {
    const r = r0 + (r1 - r0) * (j / rings) ** 1.25;
    for (let i = 0; i <= seg; i++) {
      const a = y0 + ((y1 - y0) * i) / seg;
      pos.push(Math.sin(a) * r, 0.003, -Math.cos(a) * r);
    }
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      idx.push(a, a + seg + 1, a + 1, a + 1, a + seg + 1, a + seg + 2);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

/** The panorama around the fire: its grass lit by the flickering light, and heat shimmer above the flames. */
function glowPatch(backdrop: PlaceBackdrop, shared: Uniforms, fireYaw: number): Mesh | null {
  const body = /* glsl */ `
    ${PHOTO_ANGLES}
    ${FIRE_LIGHT_GLSL}
    uniform float uGroundY;
    uniform vec4 uFireTop;   // photo yaw (deg), pitch of the flame tips (deg), angular half-width (deg), 0
    vec3 livingWarp(vec3 d0) {
      vec2 yp = vec2(photoYaw(d0), photoPitch(d0));
      // Heat shimmer: a narrow column above the flames, rising.
      float dx = (yp.x - uFireTop.x) / uFireTop.z;
      float up = yp.y - uFireTop.y;
      float col = exp(-dx * dx * 1.5) * smoothstep(-0.5, 0.6, up) * (1.0 - smoothstep(2.0, 9.0, up));
      if (col < 0.001) return d0;
      float s = sin(yp.y * 9.0 - uTime * 4.0 + dx * 2.0) * 0.6 + sin(yp.y * 17.0 - uTime * 6.3) * 0.4;
      return photoDir(yp.x + s * 0.05 * col * uFireTop.z, yp.y + s * 0.02 * col);
    }
    vec3 livingColor(vec3 col, vec3 d0, vec3 d) {
      if (d0.y > -0.002) return col;
      float t = (cameraPosition.y - uGroundY) / -d0.y;
      vec3 P = cameraPosition + d0 * t;
      return col * (1.0 + (fireLightAt(P, vec3(0.0, 1.0, 0.0), 0.0) * 0.8 + fireGlowAt(P)) * 1.6);
    }
    float livingMask(vec3 d0) {
      vec2 yp = vec2(photoYaw(d0), photoPitch(d0));
      float dx = abs(yp.x - uFireTop.x);
      return (1.0 - smoothstep(40.0, 50.0, dx)) * (1.0 - smoothstep(uFireTop.y + 8.0, uFireTop.y + 11.0, yp.y));
    }
  `;
  const fragment = patchFragment(backdrop, body);
  if (fragment == null) return null;
  const material = new ShaderMaterial({ transparent: true, depthWrite: false, side: DoubleSide, uniforms: shared, vertexShader: PATCH_VERTEX, fragmentShader: fragment });
  material.blending = CustomBlending;
  material.blendSrc = SrcAlphaFactor;
  material.blendDst = OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = ZeroFactor;
  material.blendDstAlpha = OneFactor;
  const mesh = new Mesh(sphereRegion([fireYaw - 52, fireYaw + 52], [-55, 12], [24, 14]), material);
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.renderOrder = -7.9;
  return mesh;
}

export class Campfire {
  /** Fire frame: on the place's ground at the fire (moved by LivingPlaces). */
  readonly group = new Group();
  readonly hearth: Mesh;
  readonly flames: Mesh;
  readonly sparks: Mesh;
  /** Ground in the seat frame (the disk under the fire, or the clearing extended around you); "Full" only. */
  readonly ground: Mesh;
  readonly groundMaterial: ShaderMaterial;
  /** In the seat frame (sphere at infinity, turned with the photo). */
  readonly glow: Mesh | null;

  constructor(spec: FireSpec, backdrop: PlaceBackdrop, shared: Uniforms) {
    this.hearth = new Mesh(hearthGeometry(spec), hearthMaterial(backdrop, shared));
    this.flames = new Mesh(flameGeometry(spec.ringRadius / 0.46), flameMaterial(shared));
    this.sparks = new Mesh(sparkGeometry(), sparkMaterial(shared));
    this.groundMaterial = groundMaterial(backdrop, shared, spec);
    const c = spec.clearing;
    const fy = (spec.yaw * Math.PI) / 180;
    const span = Math.asin(Math.min(0.99, spec.groundRadius / spec.distFull));
    this.ground =
      c != null
        ? new Mesh(groundGeometry(c.inner, c.outer, -Math.PI, Math.PI), this.groundMaterial)
        : new Mesh(groundGeometry(spec.distFull - spec.groundRadius, spec.distFull + spec.groundRadius, fy - span, fy + span), this.groundMaterial);
    this.hearth.renderOrder = -6.8;
    this.ground.renderOrder = -7.4;
    this.flames.renderOrder = -6.5;
    this.sparks.renderOrder = -6.4;
    for (const m of [this.hearth, this.flames, this.sparks, this.ground]) {
      m.frustumCulled = false;
      m.raycast = () => {};
      if (m !== this.ground) this.group.add(m);
    }
    this.glow = glowPatch(backdrop, shared, spec.yaw);
    void NormalBlending;
  }

  drawCalls(fullGround: boolean): number {
    return 3 + (fullGround ? 1 : 0) + (this.glow != null ? 1 : 0);
  }
}
