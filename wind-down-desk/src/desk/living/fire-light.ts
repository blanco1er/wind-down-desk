/**
 * Living places — the ONE dynamic light they add: a fire (the campfire of "Ember fire", or the cabin's fireplace).
 *
 * Not a three.js light (the app has none): two uniforms shared by every lit material of the desk (materials.ts rig)
 * and by the fire's own meshes. The CPU evaluates the flicker once a frame (5 sines, logic/living.ts fireLight: all
 * partials under 3 Hz, crackle lifts ≤ +30 % with a 0.15 s rise, for photosensitivity) and writes it in uFire.w;
 * the shaders only read it. uFire.w = 0 everywhere else (your room, every other place): the term costs nothing.
 */
import { Vector4 } from '@iwsdk/core';

/** World position of the light (centre of the flames) and its intensity right now (0 = no fire). */
export const fireUniforms = {
  uFire: { value: new Vector4(0, -100, 0, 0) },
  /** x: time of the last crackle, y: its strength, z: time of the last Release gerbe, w: breath (0..1). */
  uFireBurst: { value: new Vector4(-100, 0, -100, 0) },
};

/** Colour of a wood fire's light (≈ 1 900 K), linear. */
export const FIRE_RGB = [1.0, 0.46, 0.16] as const;

/** GLSL: declarations + the fire's diffuse light at P with normal N (inverse square, a little wrap). */
export const FIRE_LIGHT_GLSL = /* glsl */ `
  uniform vec4 uFire;
  uniform vec4 uFireBurst;
  vec3 fireLightAt(vec3 P, vec3 N, float wrap) {
    if (uFire.w == 0.0) return vec3(0.0);   // < 0 allowed: the flicker of a fire painted in the photo
    vec3 L = uFire.xyz - P;
    float d2 = max(dot(L, L), 0.01);
    float ndl = max((dot(N, L * inversesqrt(d2)) + wrap) / (1.0 + wrap), 0.0);
    return vec3(${FIRE_RGB.map((c) => c.toFixed(3)).join(', ')}) * uFire.w * ndl / (0.35 + d2);
  }
  /**
   * The fire's glow on the GROUND around it: a wide, soft pool (≈ 2.5 m radius) instead of the grazing point-light
   * term that stops at the stones. 1/(1 + r²/r0²) with r0 = 0.9 m: 1 at the stones, ≈ 0.12 at 2.5 m, 0.04 at 4.5 m.
   */
  vec3 fireGlowAt(vec3 P) {
    if (uFire.w <= 0.0) return vec3(0.0);
    vec2 r = P.xz - uFire.xz;
    return vec3(${FIRE_RGB.map((c) => c.toFixed(3)).join(', ')}) * uFire.w * 0.55 / (1.0 + dot(r, r) / 0.81);
  }
`;
