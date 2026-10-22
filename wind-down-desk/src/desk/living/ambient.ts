/**
 * Living places — small touches glued to the photo, all in ONE patch per place (1 draw call, only the regions):
 *
 *   lights    lanterns that waver (candle-like, each its own slow rhythm, under 3 Hz) or string lights that breathe
 *             (±8 % over ≈ 12 s): only the bright warm pixels of the light and a soft halo around it change.
 *   water     a moon path on still water: the reflection shimmers (slow flow of the photo's own water) and glitters
 *             (sparse sparkles fading in and out, never a flash).
 *   mist      a thin mist drifting very slowly over the water, thicker near the far shore.
 *   aurora    the northern lights ripple: slow horizontal waves through the curtain and a brightness swell.
 * Built from the backdrop's own shader (pano.ts), so the colours stay the photo's at every evening depth.
 */
import { BufferAttribute, BufferGeometry, CustomBlending, DoubleSide, Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, SrcAlphaFactor, ZeroFactor } from '@iwsdk/core';
import type { PlaceBackdrop } from '../environment.ts';
import type { AmbientSpec, Rect } from '../../logic/living.ts';
import { placeAtGlsl, patchFragment, PATCH_VERTEX, PHOTO_ANGLES, sphereRegion, type Uniforms } from './pano.ts';

const v4 = (r: Rect) => `vec4(${r.yaw[0].toFixed(2)}, ${r.yaw[1].toFixed(2)}, ${r.pitch[0].toFixed(2)}, ${r.pitch[1].toFixed(2)})`;

function grow(r: Rect, dy: number, dp: number): Rect {
  return { yaw: [r.yaw[0] - dy, r.yaw[1] + dy], pitch: [Math.max(-89, r.pitch[0] - dp), Math.min(89, r.pitch[1] + dp)] };
}

/** One geometry made of several sphere regions (one draw call). */
function regions(rects: Rect[]): BufferGeometry {
  const parts = rects.map((r) => sphereRegion(r.yaw, r.pitch, [Math.max(4, Math.ceil((r.yaw[1] - r.yaw[0]) / 4)), Math.max(3, Math.ceil((r.pitch[1] - r.pitch[0]) / 4))]));
  const pos: number[] = [];
  const idx: number[] = [];
  for (const g of parts) {
    const base = pos.length / 3;
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

export function createAmbientPatch(spec: AmbientSpec, backdrop: PlaceBackdrop, shared: Uniforms): Mesh | null {
  const lights = spec.lights ?? [];
  const covered: Rect[] = [];
  const lightCode = lights
    .map((l, i) => {
      const halo = grow(l.rect, l.halo, l.halo * 0.8);
      covered.push(grow(halo, 1.5, 1.5));
      const c = [(l.rect.yaw[0] + l.rect.yaw[1]) / 2, (l.rect.pitch[0] + l.rect.pitch[1]) / 2];
      const rhythm =
        l.kind === 'lantern'
          ? `(1.0 + 0.05 * sin(t * 1.9 + ${(i * 2.3).toFixed(2)}) + 0.035 * sin(t * 2.7 + ${(i * 1.1).toFixed(2)}) + 0.025 * sin(t * 0.6 + ${(i * 4.1).toFixed(2)}))`
          : `(1.0 + 0.08 * sin(t * 0.52 + ${(i * 0.9).toFixed(2)}))`;
      return `{
        float k = ${rhythm} - 1.0;
        float core = rectMask(yp, ${v4(l.rect)}, 0.4) * warm * smoothstep(0.02, 0.25, lum);
        vec2 dd = (yp - vec2(${c[0].toFixed(2)}, ${c[1].toFixed(2)})) / ${Math.max(1, l.halo).toFixed(2)};
        float halo = exp(-dot(dd, dd)) * warm;
        gain += k * (core * 1.6 + halo * 0.7);
      }`;
    })
    .join('\n');
  const water = spec.water;
  if (water != null) covered.push(grow(water.rect, 2, 1));
  const mist = spec.mist;
  if (mist != null) covered.push(grow(mist.rect, 3, 2));
  const aurora = spec.aurora;
  if (aurora != null) covered.push(grow(aurora.rect, 3, 3));
  if (covered.length === 0) return null;
  const body = /* glsl */ `
    ${PHOTO_ANGLES}
    ${placeAtGlsl(backdrop)}
    float aHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float aNoise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(aHash(i), aHash(i + vec2(1.0, 0.0)), f.x), mix(aHash(i + vec2(0.0, 1.0)), aHash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float aFbm(vec2 p) { return aNoise(p) * 0.55 + aNoise(p * 2.1 + 3.7) * 0.3 + aNoise(p * 4.3 + 1.1) * 0.15; }
    vec3 livingWarp(vec3 d0) {
      vec2 yp = vec2(photoYaw(d0), photoPitch(d0));
      float t = uTime;
      ${
        aurora != null
          ? `{
        float m = rectMask(yp, ${v4(aurora.rect)}, 3.0);
        if (m > 0.001) {
          float wv = sin(yp.x * 0.11 - t * 0.17) * 0.6 + sin(yp.x * 0.29 + t * 0.11) * 0.4;
          yp.x += wv * 0.9 * m;
          yp.y += sin(yp.x * 0.07 + t * 0.09) * 0.35 * m;
        }
      }`
          : ''
      }
      ${
        water != null
          ? `{
        float m = rectMask(yp, ${v4(water.rect)}, 1.0);
        if (m > 0.001) {
          // Still water: a barely moving shimmer, stronger near you.
          float near = clamp((${water.rect.pitch[1].toFixed(2)} - yp.y) / 6.0, 0.0, 1.0);
          float n = aFbm(vec2(yp.x * 0.35, yp.y * 2.4 - t * 0.25)) - 0.5;
          yp.x += n * 0.35 * m * near;
          yp.y += (aFbm(vec2(yp.x * 0.5 + 9.0, yp.y * 3.0 + t * 0.2)) - 0.5) * 0.18 * m * near;
        }
      }`
          : ''
      }
      return photoDir(yp.x, yp.y);
    }
    vec3 livingColor(vec3 col, vec3 d0, vec3 d) {
      vec2 yp = vec2(photoYaw(d0), photoPitch(d0));
      float t = uTime;
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float warm = smoothstep(0.0, 0.3, (col.r - col.b) / max(lum, 0.004));
      float gain = 0.0;
      ${lightCode}
      col *= 1.0 + gain;
      ${
        water != null
          ? `{
        // Glitter on the moon path.
        float path = exp(-pow((yp.x - ${water.pathYaw.toFixed(2)}) / ${water.pathHalfWidth.toFixed(2)}, 2.0)) * rectMask(yp, ${v4(water.rect)}, 0.8);
        if (path > 0.01) {
          vec2 g = vec2(yp.x * 3.0, log(max(0.5, -yp.y)) * 30.0);
          vec2 cell = floor(g);
          vec2 jit = vec2(aHash(cell + 3.1), aHash(cell + 8.7)) * 0.7 + 0.15;
          vec2 f = (fract(g) - jit) * vec2(1.0, 1.6);
          float h = aHash(cell);
          float life = fract(t / (0.9 + 1.0 * h) + h * 7.0);
          float env = sin(3.14159 * life);
          float spark = step(0.74, aHash(cell + 11.3)) * exp(-dot(f, f) * 140.0) * env * env;
          col += col * spark * path * 2.6;
        }
      }`
          : ''
      }
      ${
        mist != null
          ? `{
        float m = rectMask(yp, ${v4(mist.rect)}, 2.0);
        if (m > 0.001) {
          float band = 1.0 - smoothstep(0.0, ${(mist.rect.pitch[1] - mist.rect.pitch[0]).toFixed(2)}, abs(yp.y - ${mist.level.toFixed(2)}) * 2.0);
          float n = aFbm(vec2(yp.x * 0.09 + t * 0.012, yp.y * 0.6)) * 0.7 + aFbm(vec2(yp.x * 0.23 - t * 0.02, yp.y * 1.4 + 2.0)) * 0.3;
          float amt = smoothstep(0.38, 0.8, n) * band * m * ${mist.density.toFixed(3)};
          // The mist takes the light of the sky above (moonlit), slightly cool.
          vec3 skyCol = placeAt(normalize(vec3(d0.x, 0.25, d0.z)));
          col = mix(col, skyCol * 1.15 + vec3(0.004, 0.005, 0.007), amt);
        }
      }`
          : ''
      }
      ${
        aurora != null
          ? `{
        float m = rectMask(yp, ${v4(aurora.rect)}, 3.0);
        float green = smoothstep(0.0, 0.25, (col.g - max(col.r, col.b)) / max(lum, 0.003));
        float swell = 0.12 * sin(yp.x * 0.05 - t * 0.21) + 0.06 * sin(t * 0.13 + yp.x * 0.13);
        col *= 1.0 + swell * green * m;
      }`
          : ''
      }
      return col;
    }
    float livingMask(vec3 d0) {
      vec2 yp = vec2(photoYaw(d0), photoPitch(d0));
      float m = 0.0;
      ${covered.map((r) => `m = max(m, rectMask(yp, ${v4(grow(r, -1, -1))}, 1.0));`).join('\n      ')}
      return m;
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
  const mesh = new Mesh(regions(covered), material);
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.renderOrder = -7.9;
  return mesh;
}
