/**
 * One light for the world and the tray (owner, 19 Oct: "why don't the place and the tray share the same light?").
 *
 * The place's panorama is turned into 9 spherical-harmonic coefficients (order 2, Ramamoorthi & Hanrahan 2001):
 * the light arriving from every direction, blurred like a matte surface sees it. The tray's shader evaluates them
 * for its normal (diffuse) and its reflection (sheen), so the oak, the bowls and the stones receive exactly the
 * place's light: moon-blue from above at night, warm from a fire, darker on the ground side.
 *
 * Pixels are graded here the same way the panorama shader grades them (saturation, tint, exposure, day-for-night,
 * the ground sinking into shadow), so a white matte surface shows the same brightness as the place around it.
 */
export type Vec3 = [number, number, number];
/** 9 coefficients × RGB, flat: [c0r, c0g, c0b, c1r, …]. */
export type SH9 = Float32Array;

export interface PlaceGradeLike {
  exposure: number;
  tint: readonly [number, number, number];
  saturation: number;
  night: number;
  /** How dark the ground near you sinks (environment.ts), default 0.22. */
  ground?: number;
}

/** Linear, graded radiance of an equirectangular image (row 0 = zenith), as the panorama shader would show it. */
export function gradedRadiance(rgba: Uint8ClampedArray, w: number, h: number, grade: PlaceGradeLike): Float32Array {
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const dy = Math.sin(Math.PI * (0.5 - (y + 0.5) / h));
    const ground = mix(grade.ground ?? 0.22, 1, smoothstep(-0.4, 0.03, dy));
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c: Vec3 = [lin(rgba[i * 4]), lin(rgba[i * 4 + 1]), lin(rgba[i * 4 + 2])];
      const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const sky = smoothstep(0.25, 0.7, luma) * smoothstep(-0.05, 0.25, dy);
      for (let k = 0; k < 3; k++) {
        let v = (luma + (c[k] - luma) * grade.saturation) * grade.tint[k] * grade.exposure;
        const nightCol = [0.006, 0.011, 0.024][k] + luma * [0.01, 0.015, 0.03][k];
        v = v + (nightCol - v) * sky * grade.night;
        out[i * 3 + k] = v * ground;
      }
    }
  }
  return out;
}

/**
 * Projects radiance onto 9 SH coefficients in WORLD space. `yaw` is the panorama's turn (place.yaw + desk yaw), with
 * the shader's convention u = atan(d.x, −d.z) / 2π + 0.5 + yaw / 2π. `keepLower` (0..1) mixes the lower view toward
 * `room` (Table stays: the real room lights you from below, the place from above).
 */
export function projectSH(radiance: Float32Array, w: number, h: number, yaw: number, keepLower = 1, room: Vec3 = [0, 0, 0]): SH9 {
  const sh = new Float32Array(27);
  let total = 0;
  for (let y = 0; y < h; y++) {
    const lat = Math.PI * (0.5 - (y + 0.5) / h);
    const dy = Math.sin(lat);
    const cl = Math.cos(lat);
    const weight = cl; // solid angle of an equirectangular row ∝ cos(latitude)
    // Table stays: the place covers the view above about −20°, the real room below (same mask as the shader).
    const keep = mix(smoothstep(-0.4, -0.14, dy), 1, keepLower);
    for (let x = 0; x < w; x++) {
      const theta = 2 * Math.PI * ((x + 0.5) / w - 0.5) - yaw;
      const dx = Math.sin(theta) * cl;
      const dz = -Math.cos(theta) * cl;
      const basis = shBasis(dx, dy, dz);
      const i = (y * w + x) * 3;
      for (let k = 0; k < 3; k++) {
        const r = radiance[i + k] * keep + room[k] * (1 - keep);
        for (let b = 0; b < 9; b++) sh[b * 3 + k] += r * basis[b] * weight;
      }
      total += weight;
    }
  }
  const norm = (4 * Math.PI) / total;
  for (let i = 0; i < 27; i++) sh[i] *= norm;
  return sh;
}

/** Diffuse light a matte surface with normal n receives, divided by π (so a white surface shows the scene's brightness). */
export function irradiance(sh: SH9, n: Vec3): Vec3 {
  const [x, y, z] = n;
  const c1 = 0.429043;
  const c2 = 0.511664;
  const c3 = 0.743125;
  const c4 = 0.886227;
  const c5 = 0.247708;
  const out: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const L = (b: number) => sh[b * 3 + k];
    const e =
      c1 * L(8) * (x * x - y * y) +
      c3 * L(6) * z * z +
      c4 * L(0) -
      c5 * L(6) +
      2 * c1 * (L(4) * x * y + L(7) * x * z + L(5) * y * z) +
      2 * c2 * (L(3) * x + L(1) * y + L(2) * z);
    out[k] = Math.max(0, e) / Math.PI;
  }
  return out;
}

export function lerpSH(a: SH9, b: SH9, t: number): SH9 {
  const out = new Float32Array(27);
  for (let i = 0; i < 27; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}

/** Real SH basis, order 2, in the order L00, L1−1 (y), L10 (z), L11 (x), L2−2 (xy), L2−1 (yz), L20, L21 (xz), L22. */
function shBasis(x: number, y: number, z: number): number[] {
  return [
    0.282095,
    0.488603 * y,
    0.488603 * z,
    0.488603 * x,
    1.092548 * x * y,
    1.092548 * y * z,
    0.315392 * (3 * z * z - 1),
    1.092548 * x * z,
    0.546274 * (x * x - y * y),
  ];
}

function lin(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
