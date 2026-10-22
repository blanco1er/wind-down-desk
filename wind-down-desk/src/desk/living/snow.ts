/**
 * Living places — snow behind the cabin windows (snow-cabin).
 *
 * You are inside, by the fire: no flake is ever closer than the glass, and flakes are only drawn where the photo shows
 * a window opening (soft per-pixel mask in photo angles; the vase in front of the right window is kept clear).
 * One instanced mesh, 3 distance layers = the LOD (near: big soft clumps that drift with parallax; mid; far: tiny,
 * kept at ≥ 0.12° so they never shimmer). Everything moves in the vertex shader (one time uniform): slow fall,
 * sway, a wind slant and slow gusts. Flakes close to the glass catch the warm light spilling from the cabin and
 * glint now and then as they turn; the others take the cool moonlight. 1 draw call, 0 CPU per frame.
 */
import { BufferAttribute, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial } from '@iwsdk/core';
import { snowSeeds, type SnowSpec } from '../../logic/living.ts';
import { PHOTO_ANGLES, type Uniforms } from './pano.ts';

export function createSnow(spec: SnowSpec, shared: Uniforms): Mesh {
  const seeds = snowSeeds(spec);
  const quad = new PlaneGeometry(1, 1);
  const g = new InstancedBufferGeometry();
  g.setIndex(quad.getIndex());
  g.setAttribute('position', quad.getAttribute('position') as BufferAttribute);
  g.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
  g.instanceCount = seeds.length / 4;
  const win = spec.windows.slice(0, 4).map((w) => [w.yaw[0], w.yaw[1], w.pitch[0], w.pitch[1]]);
  while (win.length < 4) win.push([0, 0, 0, 0]);
  const hole = spec.holes[0] ?? { yaw: [0, 0], pitch: [0, 0] };
  const wy = (spec.windYaw * Math.PI) / 180;
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    side: DoubleSide,
    uniforms: {
      ...shared,
      uWin: { value: win.flat() },
      uHole: { value: [hole.yaw[0], hole.yaw[1], hole.pitch[0], hole.pitch[1]] },
      uSnow: { value: [spec.fall, spec.drift, spec.gust, spec.spill] },
      uWind: { value: [Math.sin(wy), -Math.cos(wy)] },
      uGlass: { value: spec.glass },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uFade;
      uniform vec4 uImm;
      uniform vec4 uSnow;
      uniform vec2 uWind;
      uniform float uGlass;
      attribute vec4 aSeed;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vWarm;
      varying float vGlint;
      varying float vSoft;
      varying vec3 vWorld;
      void main() {
        float yaw = aSeed.x;
        float r = aSeed.y;
        float layer = floor(aSeed.w);
        float h = fract(aSeed.w);
        float ph = aSeed.z;
        float top = layer < 0.5 ? 4.6 : (layer < 1.5 ? 9.0 : 16.0);
        float bottom = -1.6;
        float span = top - bottom;
        float v = uSnow.x * (0.7 + 0.6 * h) * (layer < 0.5 ? 1.15 : 1.0);
        float y = top - mod(ph * span * 7.31 + uTime * v, span);
        vec2 radial = vec2(sin(yaw), -cos(yaw));
        vec2 tangent = vec2(cos(yaw), sin(yaw));
        vec2 xz = radial * r;
        // Wind: a slant (drift per metre of fall) and slow gusts travelling across the valley.
        float gust = uSnow.z * sin(uTime * 0.21 + r * 0.17 + yaw * 1.7) * (0.6 + 0.4 * sin(uTime * 0.07 + ph * 6.0));
        xz += uWind * (uSnow.y * (top - y) * 0.35 + gust * 0.9);
        // Each flake sways and flutters on its own (big near flakes the most: parallax).
        float amp = layer < 0.5 ? 0.16 + 0.12 * h : (layer < 1.5 ? 0.22 : 0.3);
        float w = 0.55 + 0.9 * fract(ph * 13.7);
        xz += tangent * amp * sin(uTime * w + ph * 40.0) + radial * amp * 0.5 * sin(uTime * w * 0.7 + ph * 23.0);
        vec4 wp = modelMatrix * vec4(xz.x, y, xz.y, 1.0);
        vec3 toCam = cameraPosition - wp.xyz;
        float dist = length(toCam);
        // Size: big soft clumps near, ≥ 0.12° far (sub-pixel flakes would shimmer).
        float size = layer < 0.5 ? 0.04 + 0.035 * h : 0.03 + 0.016 * h;
        size = max(size, dist * 0.0026);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        wp.xyz += (right * position.x + up * position.y) * size;
        float alpha = layer < 0.5 ? 0.9 : (layer < 1.5 ? 0.62 : 0.42);
        // Never inside: fade in just past the glass; thin out at the far end and near the ground outside.
        alpha *= smoothstep(uGlass, uGlass + 0.35, length(xz));
        alpha *= 1.0 - smoothstep(24.0, 30.0, dist);
        alpha *= uFade;
        vec3 d = normalize(wp.xyz - cameraPosition);
        alpha *= mix(smoothstep(-0.4, -0.14, d.y), 1.0, uImm.w);
        // Warm light spilling from the windows: the flakes just outside the glass glow and glint as they turn.
        vWarm = exp(-max(length(xz) - uGlass, 0.0) / uSnow.w) * smoothstep(-1.2, 1.0, y);
        float spin = sin(uTime * (1.3 + 2.4 * h) + ph * 31.0);
        vGlint = pow(max(spin, 0.0), 18.0);
        vSoft = layer < 0.5 ? 1.0 : (layer < 1.5 ? 0.55 : 0.2);
        vAlpha = alpha;
        vUv = position.xy;
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        if (alpha < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${PHOTO_ANGLES}
      uniform float uDim;
      uniform float uEvening;
      uniform vec4 uWin[4];
      uniform vec4 uHole;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vWarm;
      varying float vGlint;
      varying float vSoft;
      varying vec3 vWorld;
      void main() {
        float rr = length(vUv) * 2.0;
        // Soft clumps near, crisper far.
        float a = exp(-rr * rr * mix(4.5, 2.2, vSoft)) * (1.0 - smoothstep(0.85, 1.0, rr));
        a *= vAlpha;
        if (a < 0.004) discard;
        // Only through the window openings of the photo (the frames and the vase stay clear).
        vec3 d = normalize(vWorld - cameraPosition);
        vec2 yp = vec2(photoYaw(d), photoPitch(d));
        float m = 0.0;
        for (int i = 0; i < 4; i++) m = max(m, rectMask(yp, uWin[i], 0.18));
        m *= 1.0 - rectMask(yp, uHole, 0.25);
        a *= m;
        if (a < 0.004) discard;
        vec3 moon = vec3(0.62, 0.68, 0.82) * mix(1.0, 0.55, uEvening);
        vec3 warm = vec3(1.0, 0.74, 0.46);
        vec3 col = mix(moon, warm * 1.15, clamp(vWarm, 0.0, 1.0) * 0.85);
        col += (warm * vWarm * 0.9 + vec3(0.7, 0.78, 0.95) * 0.25) * vGlint;
        col *= 1.0 - uDim * 0.45;
        gl_FragColor = vec4(col, a);
      }
    `,
  });
  const mesh = new Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.renderOrder = -7.2; // before Breathe's veil (-7): the veil dims it like the place
  return mesh;
}
