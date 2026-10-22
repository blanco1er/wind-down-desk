/**
 * Living places — the cove: waves that run up the sand and pull back, and a sea that moves.
 *
 * (a) Near the shore, a 3D sheet laid on the sand along the shoreline MEASURED in the photo (tools/living-measure.mjs):
 *     the water's edge runs up and pulls back (one wave every 8–10 s, or with your breath in Breathe), a foam line
 *     at the edge and lace behind it, the foam bore of the next wave rolling in, the sand it wetted darker and
 *     slowly drying. The sheet is photo-lit: the sand under it IS the photo's sand (sampled a little up the beach,
 *     so the photo's own painted foam never shows as a frozen stain), the water reflects the photo's real sky, and it
 *     fades into the photo at both edges: no seam. Seen only in "Full" (in "Table stays" the beach is your room).
 * (b) Far out, a patch of the panorama itself moves: the swell rolls in (direction warp, stronger close, still at the
 *     horizon), slopes catch the sky, and the sunset path glitters (small sparkles that fade in and out, no flashes).
 * (c) Sound: each wave's surf is played where it breaks, as it breaks; a far sea bed on both sides.
 * 2 draw calls; the clock costs a few flops a frame on the CPU, nothing is uploaded.
 */
import { BufferAttribute, BufferGeometry, CustomBlending, DoubleSide, Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, SrcAlphaFactor, ZeroFactor } from '@iwsdk/core';
import type { PlaceBackdrop } from '../environment.ts';
import { shoreDistance, shorePitch, WAVE, type WavesSpec } from '../../logic/living.ts';
import { placeAtGlsl, patchFragment, PATCH_VERTEX, PHOTO_ANGLES, photoLitGlsl, type Uniforms } from './pano.ts';

/** Rows of the sheet across the shore (m, + = up the beach past the mean water line). */
const ROWS = [-1.05, -0.9, -0.75, -0.62, -0.5, -0.4, -0.31, -0.23, -0.15, -0.08, -0.02, 0.04, 0.1, 0.17, 0.24, 0.31, 0.38, 0.46, 0.55, 0.66, 0.78, 0.9];
/** Up the beach from here the photo shows wet sand, not foam: under the water the sand is read there (mirrored). */
export const CLEAN_SAND = 0.03;
/** The water body takes the photo's sea this far further out (m), so its texture continues the photo's. */
const SEA_SHIFT = -0.45;
/** The open sea patch stops above the photo's breaking surf (night beach: surf from ≈ −17° down to −33°). */
const SEA_LOW = -17;

function blendOver(material: ShaderMaterial): void {
  // Colour over the backdrop, alpha channel untouched (the passthrough composition stays the backdrop's).
  material.blending = CustomBlending;
  material.blendSrc = SrcAlphaFactor;
  material.blendDst = OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = ZeroFactor;
  material.blendDstAlpha = OneFactor;
}

/** The shoreline strip, in the seat frame (x right, z toward you), on the ground (y = 0 of its group). */
export function shoreGeometry(spec: WavesSpec): BufferGeometry {
  const y0 = spec.shore[0][0] + 4;
  const y1 = spec.shore[spec.shore.length - 1][0] - 4;
  const n = 140;
  const nr = ROWS.length;
  const pos = new Float32Array((n + 1) * nr * 3);
  const sh = new Float32Array((n + 1) * nr * 4);
  const sand = new Float32Array((n + 1) * nr * 3);
  const sea = new Float32Array((n + 1) * nr * 3);
  let along = 0;
  let prev: [number, number] | null = null;
  const at = (yawDeg: number, x: number): [number, number] => {
    const r = Math.max(0.3, (shoreDistance(spec, yawDeg) ?? 4) - x);
    const y = (yawDeg * Math.PI) / 180;
    return [Math.sin(y) * r, -Math.cos(y) * r];
  };
  for (let i = 0; i <= n; i++) {
    const yaw = y0 + ((y1 - y0) * i) / n;
    const line = at(yaw, 0);
    if (prev != null) along += Math.hypot(line[0] - prev[0], line[1] - prev[1]);
    prev = line;
    const rl = shoreDistance(spec, yaw) ?? 4;
    for (let j = 0; j < nr; j++) {
      const x = ROWS[j];
      const k = i * nr + j;
      const p = at(yaw, x);
      pos.set([p[0], 0, p[1]], k * 3);
      // Edges: 0 at the two ends of the cove, the seaward and landward rows.
      sh.set([yaw, x, along, rl], k * 4);
      const xs = x >= CLEAN_SAND ? x : CLEAN_SAND + (CLEAN_SAND - x) * 0.7;
      const s = at(yaw, xs);
      sand.set([s[0], 0, s[1]], k * 3);
      const q = at(yaw, x + SEA_SHIFT);
      sea.set([q[0], 0, q[1]], k * 3);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < nr - 1; j++) {
      const a = i * nr + j;
      idx.push(a, a + nr, a + 1, a + 1, a + nr, a + nr + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aShore', new BufferAttribute(sh, 4));
  g.setAttribute('aSand', new BufferAttribute(sand, 3));
  g.setAttribute('aSea', new BufferAttribute(sea, 3));
  g.setIndex(idx);
  return g;
}

const WAVE_GLSL = /* glsl */ `
  const float W_BORE = ${WAVE.bore.toFixed(4)};
  const float W_TOP = ${WAVE.top.toFixed(4)};
  const float W_BACK = ${WAVE.back.toFixed(4)};
  const float W_FROM = ${WAVE.boreFrom.toFixed(4)};
  float waveFront(float s, float reach) {
    if (s < W_BORE) return W_FROM * (1.0 - s / W_BORE);
    if (s < W_TOP) { float k = (s - W_BORE) / (W_TOP - W_BORE); return reach * (1.0 - (1.0 - k) * (1.0 - k)); }
    float k = (s - W_TOP) / (1.0 - W_TOP);
    return reach + (W_BACK - reach) * k * k * (3.0 - 2.0 * k);
  }
  float invSmooth(float y) { return 0.5 - sin(asin(1.0 - 2.0 * clamp(y, 0.0, 1.0)) / 3.0); }
  float recede(float x, float reach) { return W_TOP + (1.0 - W_TOP) * invSmooth((reach - x) / (reach - W_BACK)); }
`;

export function createWaveSheet(spec: WavesSpec, backdrop: PlaceBackdrop, shared: Uniforms): Mesh {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: shared,
    vertexShader: /* glsl */ `
      attribute vec4 aShore;
      attribute vec3 aSand;
      attribute vec3 aSea;
      varying vec4 vShore;
      varying vec3 vWorld;
      varying vec3 vSand;
      varying vec3 vSea;
      varying vec3 vDir;
      void main() {
        vShore = aShore;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vSand = (modelMatrix * vec4(aSand, 1.0)).xyz;
        vSea = (modelMatrix * vec4(aSea, 1.0)).xyz;
        vDir = normalize(w.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${photoLitGlsl(backdrop)}
      ${WAVE_GLSL}
      uniform float uLivingFade;
      uniform vec4 uWave;    // phase, reach, previous reach, cycle
      uniform vec4 uWave2;   // period, previous period
      uniform vec4 uSea;     // moon yaw, glitter half-width, eye height, 0
      varying vec4 vShore;
      varying vec3 vWorld;
      varying vec3 vSand;
      varying vec3 vSea;
      float vn(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float a = hash12(i); float b = hash12(i + vec2(1.0, 0.0)); float c = hash12(i + vec2(0.0, 1.0)); float e = hash12(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
      }
      float fbm2(vec2 p) { return vn(p) * 0.55 + vn(p * 2.07 + 5.3) * 0.3 + vn(p * 4.3 + 1.7) * 0.15; }
      void main() {
        vec3 d = normalize(vWorld - cameraPosition);
        float x = vShore.y;
        float along = vShore.z;
        float s = uWave.x;
        float reach = uWave.y;
        float cyc = uWave.w;
        // The edge is never a straight line: it bends along the beach, differently each wave.
        float bend = 0.07 * sin(along * 0.62 + cyc * 1.7) + 0.04 * sin(along * 1.9 - cyc * 2.3) + 0.02 * sin(along * 4.1 + cyc);
        float xf = waveFront(s, reach) + bend * (s < W_BORE ? 0.5 : 1.0);
        float water = smoothstep(xf + 0.02, xf - 0.03, x);
        // Sand drying behind the retreating water (and the previous wave's sand during the run-up).
        float dryT = 1000.0;
        if (s >= W_TOP) {
          if (x < reach + bend) dryT = max(0.0, (s - recede(x - bend, reach)) * uWave2.x);
        } else if (x < uWave.z + bend) {
          dryT = (s + 1.0 - recede(x - bend, uWave.z)) * uWave2.y;
        }
        float wet = max(water, exp(-dryT / 5.5));
        // Foam and film noise (declared first: used by the film and the foam).
        float onPathEarly = exp(-pow((vShore.x - uSea.x) / 9.0, 2.0));
        float n1 = fbm2(vec2(along * 5.0, x * 9.0 - xf * 7.0) + cyc * 3.1);
        float n2 = fbm2(vec2(along * 13.0 + 5.0, x * 30.0 - xf * 24.0));
        float n3 = fbm2(vec2(along * 26.0 - 2.0, x * 46.0 - xf * 40.0 + cyc));
        // Night beach (19 Oct): the photo's own surf stays (its breaking waves are the beauty of the place); the sheet
        // keeps the photo exactly seaward of the water line and only adds the moving bore and lace over it. Up the
        // beach, the swash: the water runs over the photo's own wet sand, darkens it, shines, pulls back, dries.
        vec3 here = photo(d);
        float up = smoothstep(-0.12, 0.04, x);           // 0 seaward of the line (the photo's surf), 1 on the swash
        float wetK = wet * up;
        // The photo's swash is already wet sand: the running water only deepens it a little (no dark ribbon).
        vec3 sandWet = here * mix(1.0, 0.82, wetK);
        float depth = clamp((xf - x) * 1.6, 0.0, 1.0);
        vec3 body = mix(sandWet * 0.95, here * 0.9, smoothstep(0.1, 0.9, depth) * up);
        body = mix(here, body, up);
        float t = uTime;
        vec2 slope = vec2(sin(along * 9.0 + t * 1.9 + x * 5.0) + 0.5 * sin(along * 17.0 - t * 2.7), sin(x * 14.0 - t * 2.2 + along * 3.0)) * 0.02 * water;
        vec3 n = normalize(vec3(slope.x, 1.0, slope.y));
        vec3 refl = photo(reflect(d, n));
        float cosv = max(dot(-d, n), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
        vec3 col = mix(sandWet, body, water);
        // The film mirrors the sky only where it has some depth, broken by its ripples (no grey ribbon at the edge).
        float film = smoothstep(xf + 0.02, xf - 0.14, x) * (0.45 + 0.55 * n2);
        // (night: the sky is dark, the film shines only where the moon is: on its path, below)
        // (an absolute add over a night photo reads as a grey veil: the film shines only on the moon's path)
        col += refl * fres * 0.5 * film * up * onPathEarly;
        // Foam: a thin broken line at the edge, the bore rolling in, then a lace of filaments that drains away.
        float age = s < W_TOP ? 0.0 : (s - W_TOP) / (1.0 - W_TOP);
        float w = 0.012 + 0.035 * n1;
        float edgeFoam = smoothstep(xf - w - 0.05, xf - 0.01, x) * smoothstep(xf + 0.01, xf - 0.004, x);
        // Broken, never a tube: gaps along the edge, thicker clumps, thinner as it drains.
        edgeFoam *= smoothstep(0.55, 0.9, n1 + 0.45 * n3) * (0.55 + 0.45 * n2) * (1.0 - 0.7 * age);
        float boreRidge = 1.0 - abs(2.0 * fbm2(vec2(along * 9.0 - 3.0, x * 22.0 - xf * 18.0)) - 1.0);
        float bore = smoothstep(xf - 0.16, xf - 0.02, x) * smoothstep(xf + 0.03, xf - 0.01, x) * smoothstep(0.45, 0.85, boreRidge * (0.6 + 0.6 * n3));
        bore *= 1.0 - smoothstep(W_BORE - 0.02, W_BORE + 0.08, s);
        // Lace: ridged noise (thin bright filaments), denser right behind the edge, fading with the backwash.
        float ridge = 1.0 - abs(2.0 * n2 - 1.0);
        float lace = smoothstep(0.84, 0.97, ridge) * smoothstep(0.35, 0.7, n1) * (0.6 + 0.4 * n3);
        lace *= water * smoothstep(xf - 0.45, xf - 0.06, x) * (1.0 - 0.8 * age) * smoothstep(-0.8, -0.3, x) * 0.65;
        float foam = clamp(max(max(edgeFoam, bore), lace * 0.8), 0.0, 1.0);
        // Foam is lit by the moon: a bright version of the photo's own light here (graded with the evening), warmer
        // on the moon's path.
        float onPath = exp(-pow((vShore.x - uSea.x) / 9.0, 2.0));
        // The photo's own breaking surf (≈ −24° on the same bearing) tells how bright moonlit foam is tonight.
        // Moonlit foam: a fixed night white (as bright as the photo's surf), graded by the same evening as the photo.
        float evK = mix(uEveningAB.x, uEveningAB.y, uWhich);
        // Warm like the golden moon of the photo; the lit tops of the foam brighter than its body.
        vec3 foamCol = eveningGradeK(vec3(0.27, 0.2, 0.115) * (0.7 + 0.6 * n3) * (1.0 + 0.8 * onPath) + vec3(0.06, 0.035, 0.0) * onPath, d, 0.0, evK);
        // Foam only ever lightens (never a grey veil over the bright moon path).
        col = mix(col, max(col, foamCol + col * 0.35), foam * (0.45 + 0.4 * n3));
        // Fade into the photo: seaward (into its sea), landward (its dry sand) and at both ends of the cove.
        float edges = smoothstep(-1.05, -0.5, x) * (1.0 - smoothstep(0.62, 0.88, x));
        float yaw = vShore.x;
        edges *= smoothstep(${(spec.shore[0][0] + 4).toFixed(1)}, ${(spec.shore[0][0] + 16).toFixed(1)}, yaw) * (1.0 - smoothstep(${(spec.shore[spec.shore.length - 1][0] - 16).toFixed(1)}, ${(spec.shore[spec.shore.length - 1][0] - 4).toFixed(1)}, yaw));
        float a = edges * uLivingFade * smoothstep(0.9, 1.0, keepView(d));
        if (a < 0.002) discard;
        gl_FragColor = vec4(photoDisplay(col), a);
      }
    `,
  });
  blendOver(material);
  material.defines = { LIVING_SHEET: 1 };
  const mesh = new Mesh(shoreGeometry(spec), material);
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.renderOrder = -7.5;
  return mesh;
}

/** The far sea: a strip of the panorama between the horizon and the beach, re-drawn with the swell and glitter. */
export function createSeaPatch(spec: WavesSpec, backdrop: PlaceBackdrop, shared: Uniforms): Mesh | null {
  const body = /* glsl */ `
    ${PHOTO_ANGLES}
    uniform vec4 uSea;     // sun yaw, glitter half-width, eye height, 0
    ${placeAtGlsl(backdrop)}
    float seaHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float seaNoise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(seaHash(i), seaHash(i + vec2(1.0, 0.0)), f.x), mix(seaHash(i + vec2(0.0, 1.0)), seaHash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    // Water between the headlands, from just under the horizon (kept still) down to the beach.
    float seaMask(vec2 yp) {
      float m = smoothstep(${(spec.shore[0][0] + 10).toFixed(1)}, ${(spec.shore[0][0] + 28).toFixed(1)}, yp.x) * (1.0 - smoothstep(${(spec.shore[spec.shore.length - 1][0] - 10).toFixed(1)}, ${(spec.shore[spec.shore.length - 1][0] + 8).toFixed(1)}, yp.x));
      return m * (1.0 - smoothstep(-1.6, -0.5, yp.y));
    }
    float seaDist(vec2 yp) { return uSea.z / tan(-min(yp.y, -0.3) / DEG); }
    // Flow toward the beach (texture advection, two phases crossfaded so nothing stretches): offset in pitch (deg).
    // A ground travel of 0.8 m per 4.5 s cycle, seen in perspective (large close in, nothing at the horizon).
    float flowPhase(vec2 yp, float shift) {
      float r = seaDist(yp);
      float jitter = seaNoise(vec2(yp.x * 0.05, log(r) * 1.6)) * 1.7;
      return fract(uTime / 4.5 + jitter + shift);
    }
    float flowAmp(vec2 yp) {
      float r = seaDist(yp);
      return 0.8 * uSea.z / (r * r + uSea.z * uSea.z) * DEG;
    }
    vec3 livingWarp(vec3 d0) {
      vec2 yp = vec2(photoYaw(d0), photoPitch(d0));
      float m = seaMask(yp);
      if (m < 0.001) return d0;
      float a = flowAmp(yp) * m;
      return photoDir(yp.x, yp.y + a * (flowPhase(yp, 0.0) - 0.5));
    }
    vec3 livingColor(vec3 col, vec3 d0, vec3 d) {
      vec2 yp = vec2(photoYaw(d0), photoPitch(d0));
      float m = seaMask(yp);
      if (m < 0.001) return col;
      // Second phase of the flow, crossfaded (the eye never sees a reset).
      float p0 = flowPhase(yp, 0.0);
      float w = abs(p0 - 0.5) * 2.0;
      vec3 d2 = photoDir(yp.x, yp.y + flowAmp(yp) * m * (flowPhase(yp, 0.5) - 0.5));
      vec3 c2 = placeAt(d2);
      col = mix(col, c2, w);
      // A slow swell: long, low brightness bands rolling in.
      float r = seaDist(yp);
      float lat = yp.x / DEG * r;
      float sw = sin(r * 0.8 - uTime * 0.7 + 0.6 * sin(lat * 0.09)) * 0.6 + sin(r * 1.5 + lat * 0.35 - uTime * 1.0) * 0.4;
      col *= 1.0 + 0.045 * sw * m * smoothstep(-0.8, -4.0, yp.y);
      // Glitter on the sunset path: sparse sparkles at random places, each fading in and out (≈ 1 s), never a flash.
      float path = exp(-pow((yp.x - uSea.x) / uSea.y, 2.0)) * smoothstep(-15.0, -1.8, yp.y) * (1.0 - smoothstep(-0.9, -0.35, yp.y));
      if (path > 0.01) {
        vec2 g = vec2(yp.x * 3.2, log(r) * 26.0);
        vec2 cell = floor(g);
        vec2 jit = vec2(seaHash(cell + 3.1), seaHash(cell + 8.7)) * 0.7 + 0.15;
        vec2 f = (fract(g) - jit) * vec2(1.0, 1.6);
        float h = seaHash(cell);
        float life = fract(uTime / (0.8 + 0.9 * h) + h * 7.0);
        float env = sin(3.14159 * life);
        float spark = step(0.72, seaHash(cell + 11.3)) * exp(-dot(f, f) * 140.0) * env * env;
        col += col * spark * path * 3.0;
      }
      return col;
    }
    float livingMask(vec3 d0) {
      vec2 yp = vec2(photoYaw(d0), photoPitch(d0));
      // The open sea only: above the photo's breaking surf (its foam is never smeared by the flow).
      return smoothstep(${(spec.shore[0][0]).toFixed(1)}, ${(spec.shore[0][0] + 10).toFixed(1)}, yp.x) * (1.0 - smoothstep(${(spec.shore[spec.shore.length - 1][0]).toFixed(1)}, ${(spec.shore[spec.shore.length - 1][0] + 10).toFixed(1)}, yp.x)) * (1.0 - smoothstep(-0.25, 0.4, yp.y)) * smoothstep(${SEA_LOW.toFixed(1)}, ${(SEA_LOW + 3).toFixed(1)}, yp.y);
    }
  `;
  const fragment = patchFragment(backdrop, body);
  if (fragment == null) return null;
  // The strip from just above the horizon down past the beach.
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: shared,
    vertexShader: PATCH_VERTEX,
    fragmentShader: fragment,
  });
  blendOver(material);
  const pitchLow = SEA_LOW - 2;
  void shorePitch;
  const mesh = new Mesh(seaRegion(pitchLow), material);
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.renderOrder = -7.9;
  return mesh;
}

function seaRegion(pitchLow: number): BufferGeometry {
  // Unit sphere strip: yaw −142…128°, pitch from pitchLow up to +0.6°.
  const nu = 40;
  const nv = 10;
  const pos: number[] = [];
  for (let j = 0; j <= nv; j++) {
    // Denser near the horizon (where the sea is thin).
    const t = j / nv;
    const p = ((pitchLow + (0.6 - pitchLow) * Math.sqrt(t)) * Math.PI) / 180;
    for (let i = 0; i <= nu; i++) {
      const y = ((-165 + (275 * i) / nu) * Math.PI) / 180;
      pos.push(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}
