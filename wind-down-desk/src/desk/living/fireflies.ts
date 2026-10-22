/**
 * Living places — fireflies over the meadow (firefly-meadow).
 *
 * One instanced mesh: slow drifting lights over the grass (1.5–22 m), each blinking on its own rhythm (a soft glow
 * that swells for ≈ 1 s then goes dark for 2–7 s: no flash), warm yellow-green. A few come near the tray, but only
 * in "Full": in "Table stays" the space around your table is your real room, so they stay out there.
 * Everything moves in the vertex shader (one time uniform). 1 draw call, 0 CPU per frame.
 */
import { AdditiveBlending, BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial } from '@iwsdk/core';
import { prng, type FirefliesSpec } from '../../logic/living.ts';
import type { Uniforms } from './pano.ts';

export function fireflySeeds(spec: FirefliesSpec, seed = 12): Float32Array {
  const rnd = prng(seed);
  const n = spec.count + spec.near;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const near = i >= spec.count;
    const yaw = near ? (rnd() - 0.5) * 2.4 : (rnd() * 2 - 1) * Math.PI;
    const r = near ? 0.75 + rnd() * 0.8 : Math.sqrt(spec.inner * spec.inner + (spec.outer * spec.outer - spec.inner * spec.inner) * rnd());
    out.set([yaw, r, rnd(), near ? 1 + rnd() * 0.99 : rnd() * 0.99], i * 4);
  }
  return out;
}

export function createFireflies(spec: FirefliesSpec, shared: Uniforms): Mesh {
  const seeds = fireflySeeds(spec);
  const quad = new PlaneGeometry(1, 1);
  const g = new InstancedBufferGeometry();
  g.setIndex(quad.getIndex());
  g.setAttribute('position', quad.getAttribute('position') as BufferAttribute);
  g.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
  g.instanceCount = seeds.length / 4;
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: shared,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uLivingFade;
      uniform vec4 uState;
      uniform float uEvening;
      attribute vec4 aSeed;
      varying vec2 vUv;
      varying float vGlow;
      void main() {
        float yaw = aSeed.x;
        float r = aSeed.y;
        float ph = aSeed.z;
        bool near = aSeed.w >= 1.0;
        float h = fract(aSeed.w);
        float t = uTime;
        // Wandering: slow loops in the grass, a little rise and fall.
        vec2 base = vec2(sin(yaw), -cos(yaw)) * r;
        float s1 = t * (0.05 + 0.05 * h) + ph * 6.28;
        float s2 = t * (0.07 + 0.04 * ph) + h * 6.28;
        float roam = near ? 0.25 : 0.9;
        vec2 xz = base + vec2(sin(s1) + 0.5 * sin(s2 * 1.7), cos(s1 * 0.8) + 0.5 * cos(s2 * 1.3)) * roam;
        float y = near ? 0.75 + 0.35 * h + 0.12 * sin(s2 * 2.0) : 0.25 + 1.1 * h + 0.3 * sin(s1 * 1.6);
        vec4 w = modelMatrix * vec4(xz.x, y, xz.y, 1.0);
        vec3 toCam = cameraPosition - w.xyz;
        float dist = length(toCam);
        // Blink: on for ≈ 1 s, then dark 2–7 s (each its own period and phase), smooth both ways.
        float period = 3.0 + 6.0 * fract(ph * 7.31);
        float k = fract(t / period + ph * 3.7);
        float on = smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.1, 0.1 + 1.2 / period, k));
        // Never in your real room: the near ones exist only in "Full"; the others follow the "Table stays" mask.
        vec3 d = -toCam / dist;
        float keep = mix(smoothstep(-0.4, -0.14, d.y), 1.0, uState.w);
        float gate = near ? smoothstep(0.9, 1.0, uState.w) : keep;
        vGlow = on * gate * uLivingFade * (near ? 1.0 : 0.85) * (1.0 - smoothstep(18.0, 24.0, dist)) * mix(1.0, 1.15, uEvening);
        float size = max(near ? 0.05 : 0.11, dist * 0.004);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        w.xyz += (right * position.x + up * position.y) * size;
        vUv = position.xy;
        gl_Position = projectionMatrix * viewMatrix * w;
        if (vGlow < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uRoomDim;
      varying vec2 vUv;
      varying float vGlow;
      void main() {
        float r = length(vUv) * 2.0;
        // A tiny hot core and a soft halo.
        float a = (exp(-r * r * 60.0) * 0.9 + exp(-r * r * 7.0) * 0.18) * vGlow;
        if (a < 0.002) discard;
        gl_FragColor = vec4(vec3(0.78, 0.95, 0.32) * a * (1.0 - uRoomDim * 0.3), 1.0);
      }
    `,
  });
  const mesh = new Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.renderOrder = -6.9;
  return mesh;
}
