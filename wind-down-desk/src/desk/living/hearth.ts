/**
 * Living places — the snow cabin's fireplace (a patch of the panorama): the painted flames lick upward and flicker
 * with the fire light (same flicker and crackles as a campfire), and the stone, mantle and floor around catch it.
 * 1 draw call over the fireplace region only. Its crackles are heard from the fireplace (index.ts).
 */
import { CustomBlending, DoubleSide, Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, SrcAlphaFactor, ZeroFactor } from '@iwsdk/core';
import type { PlaceBackdrop } from '../environment.ts';
import type { HearthSpec } from '../../logic/living.ts';
import { patchFragment, PATCH_VERTEX, PHOTO_ANGLES, sphereRegion, type Uniforms } from './pano.ts';

export function createHearthPatch(spec: HearthSpec, backdrop: PlaceBackdrop, shared: Uniforms): Mesh | null {
  const o = spec.opening;
  const f = spec.flames;
  const centre = [(f.yaw[0] + f.yaw[1]) / 2, (f.pitch[0] + f.pitch[1]) / 2];
  const region = { yaw: [o.yaw[0] - 34, o.yaw[1] + 34] as [number, number], pitch: [-56, 34] as [number, number] };
  const body = /* glsl */ `
    ${PHOTO_ANGLES}
    uniform float uFlick;   // fire light now / nominal (1 ± 0.2, crackle lifts), 1 when no fire
    const vec4 H_OPEN = vec4(${o.yaw[0].toFixed(2)}, ${o.yaw[1].toFixed(2)}, ${o.pitch[0].toFixed(2)}, ${o.pitch[1].toFixed(2)});
    const vec4 H_FLAME = vec4(${f.yaw[0].toFixed(2)}, ${f.yaw[1].toFixed(2)}, ${f.pitch[0].toFixed(2)}, ${f.pitch[1].toFixed(2)});
    const vec2 H_CENTRE = vec2(${centre[0].toFixed(2)}, ${centre[1].toFixed(2)});
    const vec4 H_REGION = vec4(${region.yaw[0].toFixed(1)}, ${region.yaw[1].toFixed(1)}, ${region.pitch[0].toFixed(1)}, ${region.pitch[1].toFixed(1)});
    vec3 livingWarp(vec3 d0) {
      vec2 yp = vec2(photoYaw(d0), photoPitch(d0));
      float fm = rectMask(yp, H_FLAME, 1.2);
      if (fm < 0.001) return d0;
      float k = clamp((yp.y - H_FLAME.z) / (H_FLAME.w - H_FLAME.z), 0.0, 1.0);
      float t = uTime;
      // Rising licks: the tips sway and stretch (slow: under 1 Hz), the roots stay put.
      float up = (0.42 + 0.3 * sin(yp.x * 1.7 + t * 2.6) + 0.22 * sin(yp.x * 3.9 - t * 3.7 + yp.y * 0.9)) * k * k * 1.1;
      float side = 0.32 * sin(yp.y * 1.3 - t * 4.1 + yp.x * 0.6) * k;
      return photoDir(yp.x + side * fm, yp.y - up * fm);
    }
    vec3 livingColor(vec3 col, vec3 d0, vec3 d) {
      vec2 yp = vec2(photoYaw(d0), photoPitch(d0));
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float warm = smoothstep(0.0, 0.25, (col.r - col.b) / max(lum, 0.02));
      float flame = rectMask(yp, H_OPEN, 1.5) * smoothstep(0.03, 0.35, lum) * warm;
      vec2 dd = (yp - H_CENTRE) / vec2(30.0, 24.0);
      float halo = exp(-dot(dd, dd) * 1.4) * warm;
      return col * (1.0 + (uFlick - 1.0) * (flame * 1.5 + halo * 0.9));
    }
    float livingMask(vec3 d0) {
      vec2 yp = vec2(photoYaw(d0), photoPitch(d0));
      return rectMask(yp, H_REGION + vec4(4.0, -4.0, 4.0, -4.0), 3.0);
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
  const mesh = new Mesh(sphereRegion(region.yaw, region.pitch, [20, 16]), material);
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.renderOrder = -7.9;
  return mesh;
}
