/**
 * Living places — the shared base: effects that are glued to the panorama photo.
 *
 * Two tools, both reusing the BACKDROP'S OWN SHADER (read at run time from its material), so colours match the photo
 * exactly whatever the place grade or the evening darkening:
 *
 * 1. Patches: a piece of sphere at infinity drawn right after the backdrop over one region of the photo (the sea, a
 *    fireplace). It is the backdrop shader with three text injections: the view direction is warped (water flows,
 *    flames lick), the colour is touched (glitter, flicker) and the result is blended over the backdrop with a soft
 *    mask (alpha of the backdrop kept, so the "Table stays" passthrough band is untouched). 1 draw call, only the
 *    region's pixels.
 * 2. Photo-lit 3D: 3D surfaces (the wave sheet, the ground under the fire) call the backdrop's `place()` function to
 *    know the colour of the photo in any direction (the sky they reflect, the sand they cover), then the same tone
 *    mapping. They blend into the photo with no seam.
 *
 * If the backdrop shader ever loses one of the injection anchors, the patch is switched off (console warning) and
 * tests/living.test.ts fails: never a broken picture.
 */
import { BufferAttribute, BufferGeometry, type ShaderMaterial, type Vector4 } from '@iwsdk/core';
import type { PlaceBackdrop } from '../environment.ts';

export type Uniforms = Record<string, { value: unknown }>;

/** Text the patches replace in the backdrop's fragment shader (also checked by the tests on environment.ts). */
export const ANCHORS = {
  dir: 'vec3 d = normalize(vDir);',
  col: 'vec3 col = mix(a, b, k);',
  out: 'gl_FragColor = vec4(col, alpha);',
  main: 'void main()',
} as const;

export function backdropMaterial(backdrop: PlaceBackdrop): ShaderMaterial {
  return backdrop.mesh.material as ShaderMaterial;
}

/** Everything the backdrop declares before main(): uniforms, varyings, hash12, eveningGrade(), place(). */
export function panoHelpers(backdrop: PlaceBackdrop): string {
  const src = backdropMaterial(backdrop).fragmentShader;
  const i = src.indexOf(ANCHORS.main);
  return i < 0 ? '' : src.slice(0, i);
}

/**
 * `vec3 placeAt(vec3 dd)`: the photo's graded colour in any direction, for the side of the crossfade this place is on
 * (uWhich), called exactly as the backdrop's main() calls place() (same extra arguments, e.g. the evening strength).
 * Empty string if the backdrop's calls cannot be read (the effects then fall back to their own colour).
 */
export function placeAtGlsl(backdrop: PlaceBackdrop): string {
  const src = backdropMaterial(backdrop).fragmentShader;
  const a = /place\(uTexA,\s*d,([^;]*?)\)\s*:/u.exec(src);
  const b = /place\(uTexB,\s*d,([^;]*?)\)\s*:/u.exec(src);
  if (a == null || b == null) return 'vec3 placeAt(vec3 dd) { return vec3(0.0); }';
  return `
    uniform float uWhich;   // 1: the place is the backdrop's B side (arriving / shown), 0: its A side (leaving)
    vec3 placeAt(vec3 dd) { return uWhich > 0.5 ? place(uTexB, dd,${b[1]}) : place(uTexA, dd,${a[1]}); }
  `;
}

/** GLSL shared by the photo-lit 3D materials: the photo's colour in a direction (the place shown) and its tone map. */
export function photoLitGlsl(backdrop: PlaceBackdrop): string {
  // place() already applies the place grade and the evening (eveningGrade, called inside it).
  const helpers = panoHelpers(backdrop);
  return /* glsl */ `
    ${helpers}
    ${placeAtGlsl(backdrop)}
    vec3 photo(vec3 d) { return placeAt(d); }
    vec3 photoDisplay(vec3 col) {
      col *= 1.0 - uDim * 0.45;
      col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
      return pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
    }
    // Table stays: below ≈ −8° you see your real room (same mask as the backdrop).
    float keepView(vec3 d) {
      return mix(smoothstep(-0.4, -0.14, d.y), 1.0, uState.w);
    }
  `;
}

/**
 * Builds a patch fragment shader from the backdrop's: `body` defines livingWarp(d0), livingColor(col, d0, d) and
 * livingMask(d0). Returns null if an anchor is missing (the patch stays off).
 */
export function patchFragment(backdrop: PlaceBackdrop, body: string): string | null {
  const src = backdropMaterial(backdrop).fragmentShader;
  if (!Object.values(ANCHORS).every((a) => src.includes(a))) {
    console.warn('[living] backdrop shader changed: panorama patch disabled');
    return null;
  }
  return src
    .replace(ANCHORS.main, `${body}\n${ANCHORS.main}`)
    .replace(ANCHORS.dir, 'vec3 d0 = normalize(vDir); vec3 d = livingWarp(d0);')
    .replace(ANCHORS.col, `${ANCHORS.col} col = livingColor(col, d0, d);`)
    .replace(ANCHORS.out, 'float lm = livingMask(d0) * uLivingFade; if (lm < 0.002) discard; gl_FragColor = vec4(col * alpha, lm);');
}

/** The patch vertex shader: like the backdrop's (sphere at infinity), turned so photo yaw 0 faces the desk. */
export const PATCH_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(mat3(modelMatrix) * position);
    vec3 world = cameraPosition + vDir * 60.0;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

/** Photo-frame direction (degrees) helpers for patch bodies; uLivingYaw = place yaw + desk yaw (radians). */
export const PHOTO_ANGLES = /* glsl */ `
  uniform float uLivingYaw;
  uniform float uLivingFade;
  const float DEG = 57.29578;
  float photoYaw(vec3 d) {
    float y = atan(d.x, -d.z) + uLivingYaw;
    y = mod(y + 3.14159265, 6.2831853) - 3.14159265;
    return y * DEG;
  }
  float photoPitch(vec3 d) { return asin(clamp(d.y, -1.0, 1.0)) * DEG; }
  vec3 photoDir(float yawDeg, float pitchDeg) {
    float y = yawDeg / DEG - uLivingYaw;
    float p = pitchDeg / DEG;
    return vec3(sin(y) * cos(p), sin(p), -cos(y) * cos(p));
  }
  // Soft rectangle in degrees (feather in degrees).
  float rectMask(vec2 yp, vec4 r, float feather) {
    vec2 a = smoothstep(r.xz - feather, r.xz + feather, yp);
    vec2 b = 1.0 - smoothstep(r.yw - feather, r.yw + feather, yp);
    return a.x * a.y * b.x * b.y;
  }
`;

/**
 * A piece of sphere in the photo frame (yaw / pitch ranges in degrees), unit radius. The mesh is turned by
 * (place yaw + desk yaw) so photo yaw 0 faces the seat.
 */
export function sphereRegion(yaw: [number, number], pitch: [number, number], seg = [24, 12]): BufferGeometry {
  const [nu, nv] = seg;
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
  const idx: number[] = [];
  let o = 0;
  for (let j = 0; j <= nv; j++) {
    const p = ((pitch[0] + ((pitch[1] - pitch[0]) * j) / nv) * Math.PI) / 180;
    for (let i = 0; i <= nu; i++) {
      const y = ((yaw[0] + ((yaw[1] - yaw[0]) * i) / nu) * Math.PI) / 180;
      pos[o++] = Math.sin(y) * Math.cos(p);
      pos[o++] = Math.sin(p);
      pos[o++] = -Math.cos(y) * Math.cos(p);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** Shares the backdrop's uniforms (same objects: crossfade, grade, immersion and evening stay in sync). */
export function backdropUniforms(backdrop: PlaceBackdrop): Uniforms {
  return backdropMaterial(backdrop).uniforms as Uniforms;
}

/** Copy of a vec4 uniform's current value (for the perf report / tests). */
export function v4(u: { value: unknown }): Vector4 {
  return u.value as Vector4;
}
