/**
 * Materials with precomputed ("baked", analytic) lighting.
 *
 * No scene lights and no shadow maps: one fixed "evening lamp" rig is shared
 * by every shader (a warm key from a lamp behind-left of the tray with its
 * pool of light, a dim cool room fill, and the voice lamp's own glow as a
 * small point light). Lighting is computed in linear space with a GGX
 * highlight and Schlick Fresnel, then tone-mapped (ACES fit) and encoded to
 * display sRGB in the shader, so the look is identical in the emulator and
 * on Quest. Ambient occlusion is analytic: crescent shadows cast by each
 * bowl's rim, occlusion where the lip meets the wood, contact shadows under
 * every stone.
 *
 * Draw calls: tray (wood + three bowls + engraved labels + brass inlays) = 1.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  Vector4,
} from '@iwsdk/core';
import type { DeskLayout } from '../logic/desk-layout.ts';
import { LAMP, TRAY } from './geometry.ts';
import { FIRE_LIGHT_GLSL, fireUniforms } from './living/fire-light.ts';

export const MAX_SHADOWS = 8;

/** Shared clock: one uniform object referenced by every material. */
export const timeUniform = { value: 0 };

/** The evening light rig, shared (by reference) by every lit material. */
export const rig = {
  uKeyDir: { value: new Vector3(-0.45, 0.78, -0.42).normalize() },
  uKeyColor: { value: new Vector3(2.1, 1.52, 0.98) },
  uPoolCenter: { value: new Vector3(0, 0, 0) },
  uPoolRadius: { value: 0.4 },
  uFillSky: { value: new Vector3(0.075, 0.08, 0.1) },
  uFillGround: { value: new Vector3(0.05, 0.038, 0.03) },
  uOrbPos: { value: new Vector3(0, -10, 0) },
  uOrbPower: { value: 0.2 },
  uDim: { value: 0 },
  /** v6: the lamp's glow 0..1+ (water reflections), its world radius, and the room dimming of Breathe. */
  uOrbEnergy: { value: 0.6 },
  uOrbRadius: { value: 0.025 },
  uRoomDim: { value: 0 },
  /** Living places: the fire's light (campfire of "Ember fire", the cabin's fireplace); intensity 0 elsewhere. */
  uFire: fireUniforms.uFire,
  uFireBurst: fireUniforms.uFireBurst,
  /**
   * One light for the world and the tray (logic/sh-light.ts): the place's panorama as 9 SH coefficients (world space),
   * how much of it lights the tray (0 = your room's hand-tuned fill, 1 = the place), and the evening depth the
   * panorama is graded with right now (same sinking, same blue).
   */
  uSH: { value: Array.from({ length: 9 }, () => new Vector3()) },
  uShMix: { value: 0 },
  uEnvEvening: { value: 0 },
};

/** Desk-local key light direction (unrotated). */
export const KEY_LOCAL = new Vector3(-0.45, 0.78, -0.42).normalize();
/** Desk-local centre of the lamp's pool of light. */
export const POOL_LOCAL = new Vector3(-0.14, 0, -0.12);

export const NOISE = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i);
    float n100 = hash13(i + vec3(1, 0, 0));
    float n010 = hash13(i + vec3(0, 1, 0));
    float n110 = hash13(i + vec3(1, 1, 0));
    float n001 = hash13(i + vec3(0, 0, 1));
    float n101 = hash13(i + vec3(1, 0, 1));
    float n011 = hash13(i + vec3(0, 1, 1));
    float n111 = hash13(i + vec3(1, 1, 1));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }
`;

/** Linear lighting rig + tone mapping. */
export const RIG = /* glsl */ `
  uniform vec3 uKeyDir;
  uniform vec3 uKeyColor;
  uniform vec3 uPoolCenter;
  uniform float uPoolRadius;
  uniform vec3 uFillSky;
  uniform vec3 uFillGround;
  uniform vec3 uOrbPos;
  uniform float uOrbPower;
  uniform float uDim;
  uniform float uOrbEnergy;
  uniform float uOrbRadius;
  uniform float uRoomDim;
  ${FIRE_LIGHT_GLSL}
  uniform vec3 uSH[9];
  uniform float uShMix;
  uniform float uEnvEvening;
  /** Diffuse light from the place (SH order 2, Ramamoorthi & Hanrahan), divided by π: same scale as the panorama. */
  vec3 placeLight(vec3 n) {
    const float c1 = 0.429043, c2 = 0.511664, c3 = 0.743125, c4 = 0.886227, c5 = 0.247708;
    vec3 e = c1 * uSH[8] * (n.x * n.x - n.y * n.y) + c3 * uSH[6] * n.z * n.z + c4 * uSH[0] - c5 * uSH[6]
      + 2.0 * c1 * (uSH[4] * n.x * n.y + uSH[7] * n.x * n.z + uSH[5] * n.y * n.z)
      + 2.0 * c2 * (uSH[3] * n.x + uSH[1] * n.y + uSH[2] * n.z);
    e = max(e, vec3(0.0)) / 3.14159265;
    // The evening grades it exactly like the panorama (environment.ts eveningGradeK, without the sky mask).
    float ev = uEnvEvening;
    e *= mix(0.92, 0.3, ev);
    float l = dot(e, vec3(0.2126, 0.7152, 0.0722));
    e = mix(vec3(l), e, 1.0 - 0.5 * ev);
    return e * mix(vec3(1.0), vec3(0.74, 0.85, 1.12), ev);
  }

  vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
  vec3 toDisplay(vec3 c) {
    c *= 1.0 - uDim * 0.5;
    c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
    return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  }
  float lampPool(vec3 P) {
    vec2 d = P.xz - uPoolCenter.xz;
    return exp(-dot(d, d) / (uPoolRadius * uPoolRadius));
  }
  /** Diffuse (with wrap for soft materials) + GGX/Schlick specular, key + fill + orb. */
  vec3 shade(vec3 P, vec3 N, vec3 V, vec3 albedo, float rough, float f0, float wrap, float keyShadow) {
    float pool = lampPool(P);
    float keyAtt = mix(0.16, 1.0, pool) * keyShadow;
    float ndl = max((dot(N, uKeyDir) + wrap) / (1.0 + wrap), 0.0);
    // The fill is the world's own light: the place's panorama (or your room's hand-tuned fill), dimmed with the room.
    vec3 fill = mix(mix(uFillGround, uFillSky, N.y * 0.5 + 0.5), placeLight(N), uShMix) * (1.0 - uRoomDim * 0.7);
    vec3 col = albedo * (uKeyColor * ndl * keyAtt + fill);
    vec3 Lo = uOrbPos - P;
    float d2 = dot(Lo, Lo);
    vec3 lo = Lo * inversesqrt(max(d2, 1e-6));
    // The bigger the globe (the breathing moon), the wider its pool of light.
    float orb = uOrbPower / (1.0 + d2 * 260.0 * (0.000625 / max(uOrbRadius * uOrbRadius, 0.000625)));
    col += albedo * vec3(1.0, 0.7, 0.42) * orb * max((dot(N, lo) + 0.4) / 1.4, 0.0);
    // Living places: the fire out in the place lights the tray from its side (0 in your room and other places).
    // ×2.6: a campfire 5 m away must read as a warm side light on the bowls (≈ 6 % of the lamp), not vanish.
    // The cabin's painted fire is already in the SH fill: there uFire.w carries only its flicker (± around 0).
    col += albedo * fireLightAt(P, N, 0.3) * 2.6 * (1.0 - uRoomDim * 0.5);
    vec3 H = normalize(uKeyDir + V);
    float nh = max(dot(N, H), 0.0);
    float a = rough * rough;
    float a2 = a * a;
    float dd = nh * nh * (a2 - 1.0) + 1.0;
    float D = a2 / (3.14159 * dd * dd);
    float F = f0 + (1.0 - f0) * pow(1.0 - max(dot(V, H), 0.0), 5.0);
    col += uKeyColor * keyAtt * D * F * max(dot(N, uKeyDir), 0.0) * 0.25;
    float fr = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    // Sheen: the place itself reflected (blurred) in the varnish; your room keeps its hand-tuned reflection.
    vec3 envSpec = mix(fill * 2.2, placeLight(reflect(-V, N)) * (1.0 - uRoomDim * 0.7), uShMix);
    col += (envSpec + vec3(0.09, 0.07, 0.05) * pool) * (f0 + (1.0 - f0) * fr) * (1.0 - rough);
    return col;
  }
`;

export const RIG_UNIFORMS = rig as unknown as Record<string, { value: unknown }>;

/** Re-links the shared rig and clock after `material.clone()` (clone copies uniform values). */
export function linkShared(material: ShaderMaterial): void {
  Object.assign(material.uniforms, RIG_UNIFORMS, { uTime: timeUniform });
}

function hexToVec3(hex: number): Vector3 {
  const c = new Color(hex);
  return new Vector3(c.r, c.g, c.b);
}

// ---------------------------------------------------------------------------
// Tray: oiled oak, three dark-glazed ceramic bowls, engraved labels, brass
// count inlays, contact shadows, bowl glow. One draw call, opaque.
// ---------------------------------------------------------------------------

export interface TrayUniforms {
  uReveal: { value: number };
  uBinCount: { value: number[] };
  uBinGlow: { value: number[] };
  uBinPulse: { value: number[] };
  uSuggest: { value: number[] };
  uEmber: { value: number };
  uShadows: { value: Vector4[] };
  uLabels: { value: Texture | null };
  uKeyLocal: { value: Vector3 };
  uYaw: { value: number };
  uLampGlow: { value: number };
  /** v6: the three bowls slide down into the tray for Breathe and Release (0 = up, 1 = gone). */
  uBowlsAway: { value: number };
  /** v6: the lamp's foot slides into the tray while the globe floats elsewhere. */
  uFootAway: { value: number };
  /** v6 Breathe: the whole lamp (foot + globe) travels and grows: foot offset (dx, dz, desk-local) and scale. */
  uFootMove: { value: Vector3 };
  /** v6 Release: the black bowl on the tray (x, z, outer radius, presence) → its soft contact shadow. */
  uBlackBowl: { value: Vector4 };
  /** 22 Oct: opacity of the merged contact shadow (0 when the desk floats). */
  uContact: { value: number };
  /** 23 Oct: the lamp's warm light spilled on the real table around it (0..1). */
  uPool: { value: number };
  /** v6 Breathe: the pearl row (centre x, z, spacing, count) and how lit each pearl is → light on the walnut. */
  uPearlRow: { value: Vector4 };
  uPearlLit: { value: number[] };
}

/** Engraved names on the front of each bowl: angular half-span (radians) and height band (metres). */
export const BOWL_LABEL = { halfAngle: 0.64, y0: 0.0135, y1: 0.0495 } as const;

/** Real oak (Poly Haven "Oak Veneer 01", CC0): the crop covers 0.457 m (u) × 0.915 m (v), grain along v. */
export const OAK = { u: 0.457, v: 0.915 } as const;

export function createTrayMaterial(layout: DeskLayout, wood: Texture, labels: CanvasTexture, woodNrm: Texture): ShaderMaterial & { uniforms: TrayUniforms } {
  const material = new ShaderMaterial({
    // 22 Oct: drawn in the transparent pass (renderOrder 1, right after the place backdrop and the Breathe veil, as
    // the separate shadow quad was) so the merged contact shadow blends; the board itself writes alpha 1 and depth.
    transparent: true,
    depthWrite: true,
    uniforms: {
      ...RIG_UNIFORMS,
      uTime: timeUniform,
      uWood: { value: wood },
      uWoodNrm: { value: woodNrm },
      uWoodDetail: { value: 0 },
      uOakSpan: { value: new Vector2(OAK.u, OAK.v) },
      uLabels: { value: labels },
      uReveal: { value: 0 },
      uSize: { value: new Vector2(layout.width, layout.depth) },
      uBinPos: { value: layout.bins.map((b) => new Vector2(b.x, b.z)) },
      uBinGlow: { value: [0, 0, 0] },
      uBinPulse: { value: [0, 0, 0] },
      uBinCount: { value: [0, 0, 0] },
      uSuggest: { value: [0, 0, 0] },
      uEmber: { value: 0 },
      uShadows: { value: Array.from({ length: MAX_SHADOWS }, () => new Vector4(0, 0, 0, 0)) },
      uKeyLocal: { value: KEY_LOCAL.clone() },
      uOrbLocal: { value: new Vector2(layout.orb.x, layout.orb.z) },
      uFoot: { value: new Vector2(LAMP.footRadius, LAMP.footHeight) },
      uLampGlow: { value: 0.5 },
      uYaw: { value: 0 },
      uLabelTexel: { value: new Vector2(1 / labels.image.width, 1 / labels.image.height) },
      uOuter: { value: TRAY.bowlOuter },
      uInner: { value: TRAY.bowlInner },
      uBowlH: { value: TRAY.bowlHeight },
      uFloor: { value: TRAY.bowlFloor },
      uRimIn: { value: new Vector2(layout.width / 2 - TRAY.rimWidth - TRAY.bevel, layout.depth / 2 - TRAY.rimWidth - TRAY.bevel) },
      uLabel: { value: new Vector3(BOWL_LABEL.halfAngle, BOWL_LABEL.y0, BOWL_LABEL.y1) },
      uBowlsAway: { value: 0 },
      uFootAway: { value: 0 },
      uFootMove: { value: new Vector3(0, 0, 1) },
      uBlackBowl: { value: new Vector4(0, 0, 0.13, 0) },
      uContact: { value: 0 },
      uPool: { value: 0 },
      uPearlRow: { value: new Vector4(0, 0.13, 0.026, 0) },
      uPearlLit: { value: new Array(12).fill(0) },
    },
    vertexShader: /* glsl */ `
      attribute float aKind;
      uniform float uBowlsAway;
      uniform float uFootAway;
      uniform vec3 uFootMove;
      uniform vec2 uOrbLocal;
      varying vec3 vLocal;
      varying vec3 vWorld;
      varying vec3 vWorldNormal;
      varying vec3 vLocalNormal;
      varying float vKind;
      varying float vSink;
      void main() {
        vLocal = position;
        vKind = aKind;
        vLocalNormal = normal;
        vec3 pos = position;
        // v6: for Breathe and Release the bowls slide down into the tray (the board hides them).
        float bowl = step(0.5, aKind) * step(aKind, 3.5);
        float away = uBowlsAway * uBowlsAway * (3.0 - 2.0 * uBowlsAway);
        // Deeper than the tallest rim (5.8 cm): no white ring of a rim cut at the board while they slide away.
        pos.y -= bowl * away * ${(0.078).toFixed(3)};
        // The lamp's foot slides into the tray while its globe is away (Breathe, Release), and comes back with it.
        float foot = step(3.5, aKind) * step(aKind, 4.5);
        float fa = uFootAway * uFootAway * (3.0 - 2.0 * uFootAway);
        // The lamp travels as one object: its foot moves and grows with the globe (Breathe).
        pos.xz = mix(pos.xz, uOrbLocal + uFootMove.xy + (pos.xz - uOrbLocal) * uFootMove.z, foot);
        pos.y = mix(pos.y, pos.y * uFootMove.z, foot);
        pos.y -= foot * fa * ${(0.026).toFixed(3)};
        vSink = pos.y;
        vec4 world = modelMatrix * vec4(pos, 1.0);
        vWorld = world.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      #define MAX_SHADOWS ${MAX_SHADOWS}
      uniform float uTime;
      uniform sampler2D uWood;
      uniform sampler2D uWoodNrm;
      uniform float uWoodDetail;
      uniform vec2 uOakSpan;
      uniform sampler2D uLabels;
      uniform float uReveal;
      uniform vec2 uSize;
      uniform vec2 uBinPos[3];
      uniform float uBinGlow[3];
      uniform float uBinPulse[3];
      uniform float uBinCount[3];
      uniform float uSuggest[3];
      uniform float uEmber;
      uniform vec4 uShadows[MAX_SHADOWS];
      uniform vec3 uKeyLocal;
      uniform vec2 uOrbLocal;
      uniform vec2 uFoot;
      uniform float uLampGlow;
      uniform float uYaw;
      uniform vec2 uLabelTexel;
      uniform float uOuter;
      uniform float uInner;
      uniform float uBowlH;
      uniform float uFloor;
      uniform vec2 uRimIn;
      uniform vec3 uLabel;
      uniform float uBowlsAway;
      uniform float uFootAway;
      uniform vec3 uFootMove;
      uniform vec4 uBlackBowl;
      uniform vec4 uPearlRow;
      uniform float uPearlLit[12];
      varying vec3 vLocal;
      varying vec3 vWorld;
      varying vec3 vWorldNormal;
      varying vec3 vLocalNormal;
      uniform float uContact;
      uniform float uPool;
      varying float vKind;
      varying float vSink;
      ${NOISE}
      ${RIG}

      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      void main() {
        // 22 Oct: the contact shadow on the real table (aKind 5), merged into the tray's draw call.
        if (vKind > 4.5) {
          if (uContact < 0.002) discard;
          float sd = sdRoundRect(vLocal.xz + vec2(0.012, 0.016), uSize * 0.5 - 0.01, 0.07);
          float sa = ((1.0 - smoothstep(-0.02, 0.05, sd)) * 0.42 + (1.0 - smoothstep(-0.004, 0.006, sd)) * 0.3) * uContact;
          // 23 Oct: the lamp's light on the real table (a warm veil over passthrough, breathing with the lamp).
          vec2 dl = (vLocal.xz - uOrbLocal) * vec2(1.0, 1.3);
          float pool = exp(-dot(dl, dl) / 0.05) * 0.2 * uPool * (0.75 + 0.25 * uLampGlow) * smoothstep(-0.01, 0.03, sd);
          float a = sa + pool * (1.0 - sa);
          if (a < 0.004) discard;
          vec3 c = (vec3(0.02, 0.012, 0.008) * sa + vec3(1.0, 0.72, 0.44) * pool * (1.0 - sa)) / a;
          gl_FragColor = vec4(c, a);
          return;
        }
        vec2 p = vLocal.xz;
        float r = length(p * vec2(1.0, 1.6));
        // Reveal: a warm light front sweeps out from the centre.
        float front = uReveal * 0.8;
        float revealed = 1.0 - smoothstep(front - 0.03, front, r);
        float sweep = exp(-pow((r - front) / 0.016, 2.0)) * (1.0 - uReveal);
        if (revealed + sweep < 0.02) discard;
        bool isBowl = vKind > 0.5 && vKind < 3.5;
        if (isBowl && (uBowlsAway > 0.97 || vSink < -0.0005)) discard;
        if (vKind > 3.5 && vKind < 4.5 && (uFootAway > 0.995 || vSink < -0.0005)) discard;
        float present = 1.0 - uBowlsAway;

        vec3 N = normalize(vWorldNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        vec2 keyXZ = normalize(uKeyLocal.xz);
        float keyRun = length(uKeyLocal.xz) / max(uKeyLocal.y, 0.2);
        vec3 lamp = vec3(1.0, 0.68, 0.38);

        int bi = 0;
        float bd = 10.0;
        for (int i = 0; i < 3; i++) {
          float d = length(p - uBinPos[i]);
          if (d < bd) { bd = d; bi = i; }
        }
        vec2 rel = p - uBinPos[bi];
        float glow = uBinGlow[bi];
        float pulse = uBinPulse[bi];
        float suggest = uSuggest[bi] * (0.6 + 0.4 * sin(uTime * 2.2));

        vec3 albedo;
        float rough;
        float f0;
        float ao = 1.0;
        float keyShadow = 1.0;
        float wrap = 0.35;
        vec3 emit = vec3(0.0);

        if (vKind < 0.5) {
          // Real oak, satin oil finish (photo-scanned CC0 veneer: albedo, normal, roughness). Each part of the tray
          // takes its grain from its own piece of wood, the way a tray is built: the floor along the length, the
          // long rim pieces along the length, the end pieces across (grain turns at the mitred corners, where the
          // end grain shows darker). No tiling: the crop covers the whole tray at 22 px/cm.
          float side = 1.0 - step(0.6, vLocalNormal.y);
          vec2 halfIn = uRimIn;
          float inRim = step(0.0, sdRoundRect(p, halfIn, 0.05));
          // Rounded corners: the quarter where both coordinates pass the straight runs.
          vec2 cq = abs(p) - (uSize * 0.5 - vec2(0.075));
          float corner = step(0.0, cq.x) * step(0.0, cq.y);
          // End pieces (left / right): x beyond the straight run, or in a corner past the mitre line.
          float endPiece = max(step(uSize.x * 0.5 - 0.075, abs(p.x)) * (1.0 - corner), corner * step(cq.y, cq.x));
          if (side > 0.5) endPiece = step(abs(vLocalNormal.z), abs(vLocalNormal.x));
          float pieceOn = max(inRim, side);
          vec2 uvFloor = vec2(p.y / uOakSpan.x + 0.5, p.x / uOakSpan.y + 0.5);
          // Long rim pieces: same direction, another part of the board (front and back differ).
          vec2 uvLong = vec2(abs(p.y) / uOakSpan.x - 0.18 + 0.27 * step(0.0, p.y) - vLocal.y * 2.0, p.x / uOakSpan.y + 0.5 + 0.21 * sign(p.y));
          // End pieces: grain along z.
          vec2 uvEnd = vec2(abs(p.x) / uOakSpan.x - 0.62 + 0.31 * step(0.0, p.x) - vLocal.y * 2.0, p.y / uOakSpan.y + 0.5);
          vec2 uv = mix(uvFloor, mix(uvLong, uvEnd, endPiece), pieceOn);
          vec3 wood = toLinear(texture2D(uWood, uv).rgb);
          vec3 nr = texture2D(uWoodNrm, uv).rgb;
          // Honey oak under the evening lamp: the scan as is, a touch warmer; the floor a little lighter than the rim.
          // Honey oak: the scan's grain a little calmer (closer to quarter-sawn oak), a touch deeper in tone.
          // v8: honey oak, clearly lighter and more golden than the (darker) table; natural grain kept.
          vec3 woodMean = toLinear(vec3(0.66, 0.5, 0.32));
          wood = mix(woodMean, wood, 0.8);
          wood = mix(vec3(dot(wood, vec3(0.3, 0.55, 0.15))), wood, 0.84);
          albedo = wood * vec3(0.98, 0.9, 0.78) * (0.9 + 0.06 * (1.0 - pieceOn));
          // End grain at the mitred corners: denser, darker, a fine seam where the pieces meet.
          float mitre = corner * exp(-pow((cq.x - cq.y) / 0.0007, 2.0)) * (1.0 - side);
          albedo *= 1.0 - 0.14 * corner * pieceOn - 0.35 * mitre;
          // Satin oil: low roughness with the scan's variation (pores stay rougher).
          rough = mix(0.36, 0.3 + 0.38 * nr.b, uWoodDetail);
          f0 = 0.045;
          // Pores and grain relief from the scan's normal map (OpenGL convention), in the piece's orientation.
          if (uWoodDetail > 0.0 && side < 0.5) {
            vec2 t = (nr.rg * 2.0 - 1.0) * 0.85 * uWoodDetail;
            // Texture +u runs along the piece's width, texture +v along its grain (image up = -v).
            vec3 nl = mix(vec3(-t.g, 1.0, t.r), vec3(t.r * sign(p.x), 1.0, -t.g), endPiece * pieceOn);
            nl = normalize(nl);
            float cy = cos(uYaw);
            float sy = sin(uYaw);
            N = normalize(vec3(nl.x * cy + nl.z * sy, nl.y, -nl.x * sy + nl.z * cy));
          }
          float floorTop = step(0.6, vLocalNormal.y) * step(vLocal.y, 0.002);
          // Occlusion: where the floor meets the raised rim, around each bowl's foot, under the board.
          float dRim = -sdRoundRect(p, uRimIn, 0.05);
          ao *= 1.0 - 0.5 * exp(-max(dRim, 0.0) / 0.012) * floorTop;
          ao *= 1.0 - 0.55 * exp(-max(bd - uOuter + 0.004, 0.0) / 0.012) * floorTop * present;
          ao *= side > 0.5 ? 0.6 + 0.4 * smoothstep(-0.018, 0.0, vLocal.y) : 1.0;
          // The bowl casts a soft shadow away from the lamp.
          vec2 sh = rel + keyXZ * 0.03;
          ao *= 1.0 - 0.32 * (1.0 - smoothstep(uOuter - 0.01, uOuter + 0.03, length(sh))) * floorTop * step(uOuter, bd) * present;
          // Brass inlays in front of each bowl: one dot per stone inside.
          vec2 rowC = uBinPos[bi] + vec2(0.0, uOuter + 0.012);
          float n = uBinCount[bi] * step(uBowlsAway, 0.5);
          float brass = 0.0;
          if (n > 0.5 && floorTop > 0.5) {
            float k = clamp(floor((p.x - rowC.x) / 0.0105 + n * 0.5), 0.0, n - 1.0);
            vec2 c = rowC + vec2((k - (n - 1.0) * 0.5) * 0.0105, 0.0);
            brass = 1.0 - smoothstep(0.0021, 0.0029, length(p - c));
          }
          // The lamp foot: contact occlusion, and a warm pool of its light on the wood.
          float od = length(p - uOrbLocal - uFootMove.xy);
          float footR = uFoot.x * uFootMove.z;
          ao *= 1.0 - 0.6 * exp(-max(od - footR, 0.0) / (0.007 * uFootMove.z)) * floorTop * (1.0 - uFootAway);
          emit += lamp * exp(-pow(max(od - footR, 0.0) / (0.075 * uFootMove.z), 2.0)) * uLampGlow * 0.09 * floorTop;
          if (brass > 0.0) {
            albedo = mix(albedo, vec3(0.62, 0.43, 0.2), brass);
            rough = mix(rough, 0.3, brass);
            f0 = mix(f0, 0.75, brass);
          }
          // v6: the black bowl's soft contact shadow (cast away from the lamp) and its contact line.
          if (uBlackBowl.w > 0.0) {
            vec2 bb = p - uBlackBowl.xy;
            float db = length(bb + keyXZ * 0.025);
            ao *= 1.0 - 0.5 * uBlackBowl.w * (1.0 - smoothstep(uBlackBowl.z - 0.012, uBlackBowl.z + 0.045, db)) * floorTop;
            ao *= 1.0 - 0.45 * uBlackBowl.w * exp(-max(length(bb) - uBlackBowl.z + 0.004, 0.0) / 0.006) * floorTop;
          }
          // v6: each lit pearl pools a little warm light on the walnut under it.
          if (uPearlRow.w > 0.5 && abs(p.y - uPearlRow.y) < 0.04) {
            for (int i = 0; i < 12; i++) {
              if (float(i) > uPearlRow.w - 0.5) break;
              vec2 c = vec2(uPearlRow.x + (float(i) - (uPearlRow.w - 1.0) * 0.5) * uPearlRow.z, uPearlRow.y);
              vec2 dp = p - c;
              emit += lamp * uPearlLit[i] * (0.22 * exp(-dot(dp, dp) / 0.00018) + 0.05 * exp(-dot(dp, dp) / 0.0012)) * floorTop;
              ao *= 1.0 - 0.35 * exp(-dot(dp, dp) / 0.00003) * step(0.01, uPearlRow.w) * floorTop;
            }
          }
          float burst = exp(-pow((bd - uOuter - (1.0 - pulse) * 0.06) / 0.008, 2.0)) * pulse * step(uOuter, bd) * floorTop;
          emit += lamp * burst * 0.3;
        } else if (vKind > 3.5) {
          // Lamp foot: the same pale stoneware, a brass collar, the inside of the cup lit by the globe.
          vec2 lr = p - uOrbLocal;
          float speck = vnoise(vec3(vLocal * 1400.0));
          float speck2 = vnoise(vec3(vLocal * 380.0 + 7.0));
          float dots = smoothstep(0.78, 0.86, speck) * 0.5 + smoothstep(0.82, 0.9, speck2) * 0.35;
          albedo = toLinear(vec3(0.84, 0.8, 0.73)) * (0.94 + 0.08 * speck2) * (1.0 - dots * 0.55);
          rough = 0.6;
          f0 = 0.035;
          wrap = 0.5;
          float h = vLocal.y;
          float collar = smoothstep(uFoot.y - 0.0032, uFoot.y - 0.0026, h) * step(0.0, dot(vLocalNormal.xz, lr) + 0.2);
          if (collar > 0.0) {
            albedo = mix(albedo, vec3(0.62, 0.43, 0.2), collar);
            rough = mix(rough, 0.28, collar);
            f0 = mix(f0, 0.8, collar);
          }
          float cup = step(length(lr), uFoot.x - 0.0055) * step(uFoot.y - 0.007, h);
          emit += vec3(1.0, 0.62, 0.3) * cup * uLampGlow * 0.9;
          // Upper body catches the globe's light, the foot sits in its own contact shadow.
          emit += vec3(1.0, 0.62, 0.3) * smoothstep(0.008, uFoot.y, h) * uLampGlow * 0.05 * (1.0 - cup);
          ao *= 0.62 + 0.38 * smoothstep(0.0, 0.008, h);
        } else {
          // Matte speckled stoneware (pale, warm), a soft satin glaze inside.
          float speck = vnoise(vec3(vLocal * 1400.0));
          float speck2 = vnoise(vec3(vLocal * 380.0 + 7.0));
          float dots = smoothstep(0.78, 0.86, speck) * 0.5 + smoothstep(0.82, 0.9, speck2) * 0.35;
          albedo = toLinear(vec3(0.86, 0.82, 0.75)) * (0.94 + 0.08 * speck2) * (1.0 - dots * 0.55);
          bool inside = dot(vLocalNormal.xz, rel) < 0.0 || vLocalNormal.y > 0.9;
          rough = inside ? 0.42 : 0.62;
          f0 = 0.035;
          wrap = 0.5;
          float h = vLocal.y;
          if (inside && h < uBowlH - 0.003) {
            // Inner occlusion near the floor and the crescent shadow of the rim.
            float t = bd / uInner;
            ao *= mix(0.6, 1.0, smoothstep(1.0, 0.5, t) * 0.6 + 0.4 * smoothstep(uFloor, uBowlH, h));
            vec2 q = rel + keyXZ * keyRun * max(uBowlH - h, 0.0);
            keyShadow = 1.0 - smoothstep(uInner - 0.006, uInner + 0.004, length(q));
            float well = (1.0 - smoothstep(0.0, uInner, bd));
            emit += lamp * well * (glow * 0.5 + suggest * 0.06);
            if (vKind > 2.5) {
              float flick = 0.8 + 0.2 * vnoise(vec3(p * 40.0, uTime * 1.7));
              emit += vec3(1.0, 0.5, 0.18) * uEmber * pow(well, 1.6) * 0.35 * flick;
            }
            emit += lamp * pulse * 0.4 * well;
          } else if (!inside) {
            // Engraved, ink-filled name on the front of the bowl, facing you.
            float ang = atan(rel.x, rel.y);
            // v7: each name is turned halfway toward the seat, so
            // "Tomorrow" and "Let go" read as squarely as "Later".
            float a0 = atan(-uBinPos[bi].x, 1.0 - uBinPos[bi].y);
            float u = (ang - a0) / (2.0 * uLabel.x) + 0.5;
            float v = (h - uLabel.y) / (uLabel.z - uLabel.y);
            if (u > 0.0 && u < 1.0 && v > 0.0 && v < 1.0) {
              // Engraved name: a groove cut into the stoneware (same recipe as the stones).
              vec2 luv = vec2((float(bi) + u) / 3.0, v);
              // Fade the effect out at the band edges (mip blur never draws a line there).
              float band = smoothstep(0.0, 0.14, v) * smoothstep(1.0, 0.86, v) * smoothstep(0.0, 0.05, u) * smoothstep(1.0, 0.95, u);
              vec3 c = texture2D(uLabels, luv).rgb * band;
              if (c.g + c.b > 0.002) {
                vec2 ex = vec2(uLabelTexel.x, 0.0);
                vec2 ey = vec2(0.0, uLabelTexel.y);
                float gu = (texture2D(uLabels, luv + ex).g - texture2D(uLabels, luv - ex).g) * band;
                float gv = (texture2D(uLabels, luv + ey).g - texture2D(uLabels, luv - ey).g) * band;
                float rr = max(length(rel), 0.01);
                float dGds = gu * 0.5 / uLabelTexel.x / (6.0 * uLabel.x * rr);
                float dGdh = gv * 0.5 / uLabelTexel.y / (uLabel.z - uLabel.y);
                vec3 T = vec3(cos(ang), 0.0, -sin(ang));
                vec3 n0 = normalize(vec3(sin(ang), 0.0, cos(ang)));
                // Ink fills the cut: a shallower relief than the bare stones (no bright outline around the letters).
                vec3 nl = normalize(n0 + clamp(0.00045 * dGds, -0.6, 0.6) * T + clamp(-0.00045 * dGdh, -0.6, 0.6) * vec3(0.0, 1.0, 0.0));
                float cy = cos(uYaw);
                float sy = sin(uYaw);
                N = normalize(vec3(nl.x * cy + nl.z * sy, nl.y, -nl.x * sy + nl.z * cy));
                // Ink-filled like stamped stoneware: a deep umber glaze sits in the cut, so the name
                // reads as dark on pale in every light (contrast does not depend on the groove shading).
                // v8: a softer umber-grey (stamped, not printed black), still ≥ 7:1 against the pale stoneware.
                vec3 ink = vec3(0.062, 0.046, 0.034);
                albedo = mix(albedo, ink, c.r);
                ao *= 1.0 - 0.12 * c.b * (1.0 - c.r);
                rough = mix(rough, 0.46, c.r);
                f0 = mix(f0, 0.045, c.r);
                // A stone carried near the bowl: the name takes the lamp's warm light (which bowl am I over?).
                emit += lamp * c.r * (glow * 1.1 + suggest * 0.12);
              }
              emit += albedo * (1.0 - c.r) * band * glow * 0.12;
            }
            // Light bounced by the walnut onto the front wall keeps the stoneware pale behind the
            // name (the lamp is behind the bowls; in dim places the front would otherwise sink).
            emit += albedo * 0.075 * smoothstep(-0.1, 0.85, rel.y / max(length(rel), 1e-4));
            // Contact darkening at the foot.
            ao *= 0.7 + 0.3 * smoothstep(0.0, 0.012, h);
          }
          float lipLight = exp(-pow((h - uBowlH + 0.002) / 0.004, 2.0));
          emit += lamp * lipLight * (glow * 0.45 + suggest * 0.12);
          // Sliding into the tray: a thin warm seam where the bowl meets the board.
          emit += lamp * exp(-pow(vSink / 0.0016, 2.0)) * uBowlsAway * (1.0 - uBowlsAway) * 3.0;
        }

        // Contact shadows under each stone (height-aware penumbra).
        float shadeAmt = 0.0;
        for (int i = 0; i < MAX_SHADOWS; i++) {
          vec4 s = uShadows[i];
          if (s.w <= 0.0) continue;
          float hh = clamp(s.z, 0.0, 0.3);
          // Cast away from the lamp, softer and wider as the stone rises; a tight contact core when it rests.
          vec2 d = p - s.xy + keyXZ * (0.005 + hh * 0.55);
          float sd = length(d * vec2(1.0, 1.18));
          float core = (1.0 - smoothstep(0.02, 0.046, length((p - s.xy) * vec2(1.0, 1.18)))) * (1.0 - clamp(hh * 40.0, 0.0, 1.0));
          float soft = 1.0 - smoothstep(0.026 + hh * 0.15, 0.068 + hh * 0.45, sd);
          shadeAmt = max(shadeAmt, s.w * (0.55 * core + 0.6 * soft) * (1.0 - hh * 2.5));
        }
        ao *= 1.0 - 0.72 * clamp(shadeAmt, 0.0, 1.0) * step(0.5, vLocalNormal.y);

        vec3 col = shade(vWorld, N, V, albedo, rough, f0, wrap, keyShadow) * ao;
        col += albedo * vec3(0.06, 0.048, 0.036);
        col += emit;
        col += lamp * sweep * 1.4;
        gl_FragColor = vec4(toDisplay(col), 1.0);
      }
    `,
  });
  return material as ShaderMaterial & { uniforms: TrayUniforms };
}

// ---------------------------------------------------------------------------
// River stones: matte grey granite with micro-speckle, text cut into the
// surface (a real groove: the slope of the softened letter mask bends the
// normal, the inner walls take the lamp light on one side and the shadow of
// the lip on the other, the floor of the cut is darker), a warm hover light
// and an ember dissolve for "Let go".
// ---------------------------------------------------------------------------

export interface StoneUniforms {
  uCell: { value: Vector4 };
  uLabel: { value: Vector2 };
  uAlbedo: { value: Vector3 };
  uSeed: { value: number };
  uGlow: { value: number };
  uDissolve: { value: number };
  uDone: { value: number };
  uWarm: { value: number };
  /** v6 Release: dark matte basalt (1) instead of grey river granite (0). */
  uBasalt: { value: number };
  /** v6 Release: the cut fills with warm light (0..1), then the letters fade away (0..1). */
  uEngraveGlow: { value: number };
  uEngraveFade: { value: number };
  /** v6 Release: world height of the water surface (under it the stone is wet and dim); -100 = no water. */
  uWaterY: { value: number };
  /** v7: engraving ink (rgb, amount: 0 = bare groove) and stone kind (granite speck 0..1, white vein 0..1). */
  uInk: { value: Vector4 };
  uKind: { value: Vector2 };
}

/** Label area on the stone's top (metres), for a size-1 stone (v7: larger stones, larger words). */
export const STONE_LABEL = { w: 0.084, h: 0.0536 } as const;
/** Depth of the engraving (metres). */
export const ENGRAVE_DEPTH = 0.0007;

export function createStoneMaterial(atlas: Texture, atlasSize: Vector2): ShaderMaterial & { uniforms: StoneUniforms } {
  const material = new ShaderMaterial({
    uniforms: {
      ...RIG_UNIFORMS,
      uTime: timeUniform,
      uMap: { value: atlas },
      uTexel: { value: new Vector2(1 / atlasSize.x, 1 / atlasSize.y) },
      uLabel: { value: new Vector2(STONE_LABEL.w, STONE_LABEL.h) },
      uCell: { value: new Vector4(0, 0, 1, 1) },
      uAlbedo: { value: new Vector3(0.6, 0.6, 0.59) },
      uSeed: { value: 0 },
      uGlow: { value: 0 },
      uDissolve: { value: 0 },
      uDone: { value: 0 },
      uWarm: { value: 0 },
      uBasalt: { value: 0 },
      uEngraveGlow: { value: 0 },
      uEngraveFade: { value: 0 },
      uWaterY: { value: -100 },
      uInk: { value: new Vector4(0.14, 0.12, 0.11, 0) },
      uKind: { value: new Vector2(1, 0) },
    },
    vertexShader: /* glsl */ `
      uniform vec2 uLabel;
      uniform vec4 uCell;
      uniform vec3 uKeyDir;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec3 vObj;
      varying vec3 vTan;
      varying vec3 vBit;
      varying vec3 vKeyObj;
      varying vec2 vLabelUv;
      varying float vTop;
      void main() {
        vObj = position;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        mat3 m = mat3(modelMatrix);
        vNormal = normalize(m * normal);
        vTan = normalize(m * vec3(1.0, 0.0, 0.0));
        vBit = normalize(m * vec3(0.0, 0.0, 1.0));
        vKeyObj = normalize(transpose(m) * uKeyDir);
        vTop = smoothstep(0.7, 0.9, normal.y);
        vec2 t = vec2(position.x / uLabel.x + 0.5, position.z / uLabel.y + 0.5);
        vLabelUv = uCell.xy + vec2(t.x, 1.0 - t.y) * uCell.zw;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uMap;
      uniform vec2 uTexel;
      uniform vec2 uLabel;
      uniform vec4 uCell;
      uniform vec3 uAlbedo;
      uniform float uSeed;
      uniform float uGlow;
      uniform float uDissolve;
      uniform float uDone;
      uniform float uWarm;
      uniform float uBasalt;
      uniform float uEngraveGlow;
      uniform float uEngraveFade;
      uniform float uWaterY;
      uniform vec4 uInk;
      uniform vec2 uKind;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec3 vObj;
      varying vec3 vTan;
      varying vec3 vBit;
      varying vec3 vKeyObj;
      varying vec2 vLabelUv;
      varying float vTop;
      ${NOISE}
      ${RIG}
      void main() {
        // Burn front: large soft shapes from the rim inward, never pixel noise.
        float rim = length(vObj.xz) / 0.05;
        float edgeN = clamp(0.62 * (1.0 - rim) + 0.38 + 0.3 * (vnoise(vObj * 55.0 + uSeed) - 0.5), 0.0, 1.0);
        if (uDissolve > 0.0 && edgeN < uDissolve * 1.08) discard;
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        // Granite: soft mottling, fine grain, dark (biotite) and pale (quartz) specks.
        float mottle = vnoise(vObj * 34.0 + uSeed * 3.0);
        float n = vnoise(vObj * 150.0 + uSeed * 7.0);
        float grain = vnoise(vObj * 1500.0 + uSeed);
        float grain2 = vnoise(vObj * 900.0 + uSeed * 5.0 + 3.7);
        float dark = smoothstep(0.74, 0.86, grain) * 0.55 * (0.3 + 0.7 * uKind.x);
        float pale = smoothstep(0.8, 0.9, grain2) * 0.35 * (0.3 + 0.7 * uKind.x);
        vec3 albedo = toLinear(uAlbedo) * (0.86 + 0.22 * mottle) * (0.95 + 0.08 * n);
        albedo *= 1.0 - dark * 0.6;
        albedo += toLinear(uAlbedo) * 0.35 * pale + vec3(0.03) * pale * uKind.x;
        // Slate: one white quartz vein across the stone (a wandering line, soft edges).
        if (uKind.y > 0.0) {
          float along = dot(vObj.xz, normalize(vec2(0.8, -0.6) + 0.2 * uSeed / 13.0));
          float wob = (vnoise(vObj * 60.0 + uSeed) - 0.5) * 0.012;
          float vein = 1.0 - smoothstep(0.0007, 0.0019, abs(along + wob - 0.031));
          albedo = mix(albedo, toLinear(vec3(0.86, 0.85, 0.8)), vein * uKind.y * 0.9);
        }
        float rough = 0.74;
        float ao = 1.0;
        float lit = 1.0;
        // v7: a real stone skin: fine grain relief (bumped normal) and broad tonal clouds, so no stone reads as plastic.
        {
          float g0 = vnoise(vObj * 340.0 + uSeed * 2.0);
          float gx = vnoise(vObj * 340.0 + uSeed * 2.0 + vec3(0.35, 0.0, 0.0));
          float gz = vnoise(vObj * 340.0 + uSeed * 2.0 + vec3(0.0, 0.0, 0.35));
          float h0 = vnoise(vObj * 1100.0 + uSeed * 4.0);
          float hx = vnoise(vObj * 1100.0 + uSeed * 4.0 + vec3(0.35, 0.0, 0.0));
          float hz = vnoise(vObj * 1100.0 + uSeed * 4.0 + vec3(0.0, 0.0, 0.35));
          N = normalize(N + (1.0 - uBasalt) * (0.3 * ((gx - g0) * vTan + (gz - g0) * vBit) + 0.1 * ((hx - h0) * vTan + (hz - h0) * vBit)));
          // Tiny pits (sandstone, limestone): dark specks that catch no light.
          albedo *= 1.0 - 0.4 * smoothstep(0.8, 0.9, vnoise(vObj * 1500.0 + uSeed * 9.0)) * (1.0 - uKind.x * 0.6);
          albedo *= 1.0 - 0.22 * smoothstep(0.72, 0.85, vnoise(vObj * 700.0 + uSeed * 3.0)) * (1.0 - uKind.x * 0.5);
          float cloud = vnoise(vObj * 18.0 + uSeed * 1.7);
          albedo *= 0.9 + 0.2 * cloud;
          rough = 0.68 + 0.14 * g0;
        }
        if (uBasalt > 0.0) {
          // Basalt: near-black, matte, fine pale crystals, a slightly rough skin (bumped normal).
          float b1 = vnoise(vObj * 420.0 + uSeed);
          float b2 = vnoise(vObj * 420.0 + uSeed + vec3(0.37, 0.0, 0.0));
          float b3 = vnoise(vObj * 420.0 + uSeed + vec3(0.0, 0.0, 0.37));
          N = normalize(N + uBasalt * 0.22 * ((b2 - b1) * vTan + (b3 - b1) * vBit));
          // Dark basalt (display ≈ 0.2), a fine pale grain, matte.
          vec3 basalt = toLinear(vec3(0.2, 0.195, 0.19)) * (0.82 + 0.3 * mottle) * (1.0 - dark * 0.4);
          basalt += vec3(0.022, 0.021, 0.019) * smoothstep(0.84, 0.93, grain2);
          albedo = mix(albedo, basalt, uBasalt);
          rough = mix(rough, 0.82, uBasalt);
        }
        // Engraving (only on the top face, inside the label cell).
        vec2 local = (vLabelUv - uCell.xy) / uCell.zw;
        float inCell = step(0.004, local.x) * step(local.x, 0.996) * step(0.004, local.y) * step(local.y, 0.996) * vTop;
        if (inCell > 0.0) {
          vec3 c = texture2D(uMap, vLabelUv).rgb * (1.0 - uEngraveFade);
          float cut = c.r;
          if (c.g + c.b > 0.002) {
            vec2 ex = vec2(uTexel.x, 0.0);
            vec2 ey = vec2(0.0, uTexel.y);
            float gx = texture2D(uMap, vLabelUv + ex).g - texture2D(uMap, vLabelUv - ex).g;
            float gy = texture2D(uMap, vLabelUv + ey).g - texture2D(uMap, vLabelUv - ey).g;
            // Height = -depth * G: slope in object metres per metre.
            float sx = gx * 0.5 / uTexel.x * uCell.z / uLabel.x;
            float sz = -gy * 0.5 / uTexel.y * uCell.w / uLabel.y;
            vec2 slope = clamp(vec2(sx, sz) * ${ENGRAVE_DEPTH.toFixed(5)}, -0.9, 0.9) * inCell;
            N = normalize(N + slope.x * vTan + slope.y * vBit);
            // Lip shadow: inside a letter, if the edge is close on the lamp side, the wall hides the light.
            vec2 lpx = normalize(vec2(vKeyObj.x * uCell.z / uLabel.x / uTexel.x, -vKeyObj.z * uCell.w / uLabel.y / uTexel.y) + 1e-5);
            float toward = texture2D(uMap, vLabelUv + lpx * uTexel * 2.4).r;
            float away = texture2D(uMap, vLabelUv - lpx * uTexel * 2.0).r;
            float lip = cut * (1.0 - toward);
            lit = 1.0 - 0.75 * lip * inCell * (1.0 - 0.6 * uBasalt) * (1.0 - 0.6 * uInk.a);
            // The far lip catches the light: a fine bright edge just outside the cut.
            albedo *= 1.0 + 0.35 * (1.0 - cut) * away * inCell;
            // Floor of the cut: darker (stone dust, less light reaches it), cavity occlusion around it.
            // On basalt the cut shows paler, dusty stone (like the Release concept).
            albedo *= mix(1.0, 0.36 + 0.14 * uDone, cut * inCell * (1.0 - uBasalt));
            // Ink-light fill: a warm light grey in the cut (readable on dark basalt in any light).
            albedo = mix(albedo, toLinear(vec3(0.76, 0.75, 0.72)), cut * inCell * uBasalt);
            // v7: ink fills the cut (dark on light stones, light on dark ones): readable in the evening light.
            albedo = mix(albedo, toLinear(uInk.rgb), cut * inCell * uInk.a * (1.0 - uBasalt) * 0.94);
            ao *= 1.0 - (0.22 * cut + 0.12 * c.b) * inCell;
            rough = mix(rough, 0.9, cut * inCell);
          }
        }
        vec3 col = shade(vWorld, N, V, albedo, rough, 0.03, 0.3, lit) * ao;
        // Warm bounce from the walnut under the stone's lower flanks.
        col += albedo * vec3(0.1, 0.065, 0.04) * clamp(0.5 - N.y * 0.6, 0.0, 1.0) * ao;
        // Hover / held: warm rim light (visionOS-style highlight, not a colour change).
        float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
        vec3 lamp = vec3(1.0, 0.7, 0.42);
        col += lamp * uGlow * (0.035 + fres * 0.32);
        // Basalt keeps its volume in the dark: a soft sheen on the shoulders and a cool rim from the room.
        col += uBasalt * (vec3(0.035, 0.032, 0.028) * fres + vec3(0.012, 0.011, 0.01) * pow(max(N.y, 0.0), 6.0));
        // Release: the stone warms from within, then embers eat the edges.
        col += lamp * uWarm * 0.25;
        float edgeBand = uDissolve > 0.0 ? 1.0 - smoothstep(uDissolve * 1.08, uDissolve * 1.08 + 0.12, edgeN) : 0.0;
        col = mix(col, vec3(2.2, 1.0, 0.36), edgeBand * edgeBand);
        // Release: the words fill with warm light as the stone sinks, then fade with it.
        if (uEngraveGlow > 0.0 && inCell > 0.0) {
          float letters = texture2D(uMap, vLabelUv).r * inCell;
          col += vec3(1.6, 1.0, 0.5) * letters * uEngraveGlow;
        }
        // Under the water: wet, darker, a little cooler.
        float under = smoothstep(uWaterY + 0.002, uWaterY - 0.004, vWorld.y);
        col = mix(col, col * vec3(0.34, 0.38, 0.42), under);
        gl_FragColor = vec4(toDisplay(col), 1.0);
      }
    `,
  });
  return material as ShaderMaterial & { uniforms: StoneUniforms };
}

// ---------------------------------------------------------------------------
// The voice lamp (the agent's presence): an opal glass globe on a stoneware
// foot. One light language, readable at a glance:
//   resting   slow, deep breathing (≈ 6 s), low warm glow
//   listening brighter and steady; your voice swells it
//   thinking  a soft band of light turns slowly inside the glass
//   speaking  warm pulses with the rhythm of what it says (caption)
//   muted     the glass goes cold and milky, no breath
//   waking    on arrival: a filament warms up, flickers once, settles
// ---------------------------------------------------------------------------

export interface OrbUniforms {
  uLevel: { value: number };
  uListening: { value: number };
  uThinking: { value: number };
  uHover: { value: number };
  uSpeak: { value: number };
  uMuted: { value: number };
  uWake: { value: number };
  /** v6 Breathe: the lamp becomes a soft moon (0..1), and the breath drives its glow (-1 = resting breath). */
  uMoon: { value: number };
  uBreath: { value: number };
  /** 24 Oct (axe 4, the lamp as a presence): world direction from the globe to your eyes, and how much it attends. */
  uLook: { value: Vector3 };
  uLookK: { value: number };
  /**
   * 26 Oct (the lamp shows the places): how much the globe is a window onto a place (0..1), that place's preview
   * panorama (equirectangular, row 0 at the zenith), and its look: x = yaw (place yaw + desk yaw, as the backdrop),
   * y = exposure, z = saturation, w = day-for-night; uPlaceTint = the place grade's tint.
   */
  uWindow: { value: number };
  uPlaceTex: { value: Texture };
  uPlaceA: { value: Vector4 };
  uPlaceTint: { value: Vector3 };
  /** The globe grown to show the places: its own glow is softened (a 17 cm lamp at full glow would dazzle). */
  uGrown: { value: number };
  /** Brightness of the place in the glass (auto: a bright moonlit beach and a dark clearing read alike). */
  uPlaceGain: { value: number };
  /**
   * 26 Oct (lot 2b, progress inside the lamp): how much the globe shows your sky (0..1); the dust of stars (one per
   * thing let go: count); the constellation's points (x, y on the glass disk, z = lit 0..1, w = sparkle), how many,
   * and how much of its lines are drawn.
   */
  uSky: { value: number };
  uSkyDust: { value: number };
  uFig: { value: Vector4[] };
  uFigN: { value: number };
  uFigLines: { value: number };
}

/** Points of the largest constellation figure (logic/milestones.ts FIGURES[21]). */
export const FIG_MAX = 21;

/** Black 1 × 1 until a place preview is loaded. */
const NO_PLACE = (() => {
  const t = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/** The globe's base radius (geometry.ts LAMP.globe), for the inner march. */
const LAMP_GLOBE_R = 0.025;

export function createOrbMaterial(): ShaderMaterial & { uniforms: OrbUniforms } {
  const material = new ShaderMaterial({
    uniforms: {
      ...RIG_UNIFORMS,
      uTime: timeUniform,
      uLevel: { value: 0 },
      uListening: { value: 0 },
      uThinking: { value: 0 },
      uHover: { value: 0 },
      uSpeak: { value: 0 },
      uMuted: { value: 0 },
      uWake: { value: 0 },
      uMoon: { value: 0 },
      uBreath: { value: -1 },
      uLook: { value: new Vector3(0, 0.3, 1) },
      uLookK: { value: 0 },
      uWindow: { value: 0 },
      uPlaceTex: { value: NO_PLACE },
      uPlaceA: { value: new Vector4(0, 1, 1, 0) },
      uPlaceTint: { value: new Vector3(1, 1, 1) },
      uGrown: { value: 0 },
      uPlaceGain: { value: 2.6 },
      uSky: { value: 0 },
      uSkyDust: { value: 0 },
      uFig: { value: Array.from({ length: FIG_MAX }, () => new Vector4(0, 0, 0, 0)) },
      uFigN: { value: 0 },
      uFigLines: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec3 vObj;
      varying vec3 vCenter;
      varying float vRadius;
      void main() {
        vObj = normalize(position);
        vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vRadius = length(modelMatrix[0].xyz) * ${LAMP_GLOBE_R.toFixed(4)};
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uLevel;
      uniform float uListening;
      uniform float uThinking;
      uniform float uHover;
      uniform float uSpeak;
      uniform float uMuted;
      uniform float uWake;
      uniform float uMoon;
      uniform float uBreath;
      uniform vec3 uLook;
      uniform float uLookK;
      uniform float uWindow;
      uniform sampler2D uPlaceTex;
      uniform vec4 uPlaceA;
      uniform vec3 uPlaceTint;
      uniform float uGrown;
      uniform float uPlaceGain;
      uniform float uSky;
      uniform float uSkyDust;
      uniform vec4 uFig[${FIG_MAX}];
      uniform float uFigN;
      uniform float uFigLines;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec3 vObj;
      varying vec3 vCenter;
      varying float vRadius;
      ${NOISE}
      ${RIG}
      /**
       * The lamp's inner life (axe 4): luminous filaments drifting inside the opal (seen with depth: a short march
       * through the globe), stirred by its voice and by yours, turning faster while it thinks; and a warm heart
       * that turns toward your eyes, brighter when you look at it or speak.
       */
      vec2 innerLight(vec3 ro, vec3 rd) {
        vec3 oc = ro - vCenter;
        float b = dot(oc, rd);
        float h = b * b - (dot(oc, oc) - vRadius * vRadius);
        if (h <= 0.0) return vec2(0.0);
        float sq = sqrt(h);
        float t0 = -b - sq;
        float len = 2.0 * sq;
        float sw = uTime * (0.16 + 0.55 * uThinking) + uSpeak * 0.5;
        float cs = cos(sw);
        float sn = sin(sw);
        vec3 heartAt = normalize(uLook) * (0.28 + 0.14 * uLookK);
        float fil = 0.0;
        float heart = 0.0;
        for (int i = 0; i < 6; i++) {
          vec3 p = (oc + rd * (t0 + len * (float(i) + 0.5) / 6.0)) / vRadius;
          vec3 q = vec3(cs * p.x - sn * p.z, p.y, sn * p.x + cs * p.z);
          float n = vnoise(q * 2.3 + vec3(0.0, uTime * 0.17, uSpeak * 0.6));
          float f = pow(1.0 - abs(n * 2.0 - 1.0), 10.0);
          float n2 = vnoise(q * 4.4 - vec3(uTime * 0.12, uLevel * uListening * 0.8, 0.0));
          f += 0.55 * pow(1.0 - abs(n2 * 2.0 - 1.0), 14.0);
          fil += f * smoothstep(1.0, 0.45, dot(p, p));
          vec3 d = p - heartAt;
          heart += exp(-dot(d, d) * 6.5);
        }
        return vec2(fil, heart) / 6.0;
      }
      /**
       * The lamp shows a place (26 Oct): the glass is a lens onto it. The centre of the globe shows the place in
       * the direction you see the globe from (at the horizon), the rim ≈ 55° around it, so moving your head looks
       * around inside, like a window. Same mapping and grade as the backdrop: arriving shows what the globe showed.
       * One texture read per pixel, no second render of the scene.
       */
      vec3 placeWindow(vec3 N) {
        vec3 toGlobe = vCenter - cameraPosition;
        vec3 F = normalize(vec3(toGlobe.x, 0.0, toGlobe.z));
        vec3 R = normalize(cross(F, vec3(0.0, 1.0, 0.0)));
        vec3 U = vec3(0.0, 1.0, 0.0);
        // Where the pixel sits on the glass disk seen from the eye (−1..1), with the lens squeeze of a ball.
        vec3 Vd = normalize(toGlobe);
        vec3 Rd = normalize(cross(Vd, vec3(0.0, 1.0, 0.0)));
        vec3 Ud = cross(Rd, Vd);
        vec2 disk = vec2(dot(N, Rd), dot(N, Ud));
        float r = min(length(disk), 1.0);
        float th = asin(r) * (0.78 / 1.5708);
        vec2 dir2 = r > 1e-4 ? disk / r : vec2(0.0);
        // Look slightly up into the place: its horizon sits a little below the globe's middle.
        vec3 d = normalize(F * cos(th) + (R * dir2.x + U * dir2.y) * sin(th) + U * 0.1);
        // Longitude relative to the globe's own direction (no wrap inside the glass: mipmaps stay seamless).
        float u = (atan(F.x, -F.z) + atan(dot(d, R), dot(d, F)) + uPlaceA.x) / 6.2831853 + 0.5;
        float v = 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.1415927;
        vec3 c = pow(texture2D(uPlaceTex, vec2(u, v)).rgb, vec3(2.2));
        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float sky = smoothstep(0.25, 0.7, luma) * smoothstep(-0.05, 0.25, d.y);
        vec3 col = mix(vec3(luma), c, uPlaceA.z) * uPlaceTint * uPlaceA.y;
        col = mix(col, vec3(0.006, 0.011, 0.024) + vec3(luma) * vec3(0.01, 0.015, 0.03), sky * uPlaceA.w);
        // A night place seen through glass: lifted so it reads at arm's length, a little darker at the rim.
        col *= uPlaceGain;
        // Soft shoulder: a moon or a lit window never burns into flat beige.
        col = col / (1.0 + 0.6 * col);
        return col * (1.0 - 0.4 * r * r * r);
      }
      float skyHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float segDist(vec2 p, vec2 a, vec2 b) {
        vec2 ab = b - a;
        float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        return length(p - a - ab * t);
      }
      /**
       * Your sky inside the lamp (lot 2b): a deep night in the glass; a fine dust of stars, one per thing you let go
       * of; and your constellation, one point per evening you came back, its lines drawn as it completes.
       * Everything on the glass disk you see (it faces you), a touch of depth as the head moves.
       */
      vec3 skyWindow(vec3 N) {
        vec3 toGlobe = normalize(vCenter - cameraPosition);
        vec3 Rd = normalize(cross(toGlobe, vec3(0.0, 1.0, 0.0)));
        vec3 Ud = cross(Rd, toGlobe);
        vec2 disk = vec2(dot(N, Rd), dot(N, Ud));
        float r = length(disk);
        vec3 col = mix(vec3(0.004, 0.006, 0.016), vec3(0.012, 0.014, 0.03), smoothstep(-1.0, 1.0, disk.y));
        col += vec3(0.05, 0.03, 0.012) * smoothstep(0.2, -1.0, disk.y) * 0.5;
        // Dust: one star per thing let go (a cell lights when the count reaches its rank).
        vec2 g = (disk + 1.0) * 9.0;
        vec2 cell = floor(g);
        float h = skyHash(cell);
        float rank = floor(skyHash(cell + 17.3) * 324.0);
        if (rank < uSkyDust && h > 0.0) {
          vec2 at = (cell + 0.25 + 0.5 * vec2(h, skyHash(cell + 4.1))) / 9.0 - 1.0;
          float d = length(disk - at);
          float tw = 0.75 + 0.25 * sin(uTime * (0.8 + h * 2.0) + h * 40.0);
          col += vec3(1.0, 0.93, 0.82) * exp(-d * d / 0.00009) * 0.9 * tw;
        }
        // The constellation: lit points glow (the newest sparkles), the ones still to come are faint rings.
        for (int i = 0; i < ${FIG_MAX}; i++) {
          if (float(i) >= uFigN) break;
          vec4 f = uFig[i];
          float d = length(disk - f.xy);
          float lit = f.z;
          col += vec3(1.0, 0.86, 0.62) * (exp(-d * d / 0.0005) * 1.6 + exp(-d * d / 0.006) * 0.22) * lit * (1.0 + f.w * (0.6 + 0.4 * sin(uTime * 6.0)));
          col += vec3(0.6, 0.62, 0.7) * smoothstep(0.006, 0.0, abs(d - 0.022)) * 0.22 * (1.0 - lit);
          if (i + 1 < ${FIG_MAX} && float(i + 1) < uFigN) {
            vec4 n = uFig[i + 1];
            float both = min(lit, n.z);
            if (both > 0.01) {
              float sd = segDist(disk, f.xy, n.xy);
              col += vec3(1.0, 0.74, 0.42) * exp(-sd * sd / 0.000025) * 0.55 * both * uFigLines;
            }
          }
        }
        return col * (1.0 - 0.35 * r * r * r);
      }
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float facing = max(dot(N, V), 0.0);
        // Resting breath: slow inhale, slower exhale.
        float ph = fract(uTime / 6.2);
        float breath = ph < 0.42 ? smoothstep(0.0, 0.42, ph) : 1.0 - smoothstep(0.42, 1.0, ph);
        breath = uBreath >= 0.0 ? uBreath : breath;
        float energy = mix(0.62 + 0.26 * breath, 0.5 + 0.62 * breath, uMoon);
        energy = mix(energy, 0.78 + uLevel * 0.9, uListening);
        energy += uSpeak * 0.55 + uHover * 0.22;
        // Thinking: a soft band turning around the globe (about one turn every 2.6 s).
        float ang = atan(vObj.z, vObj.x);
        float band = pow(0.5 + 0.5 * cos(ang - uTime * 2.4), 6.0) * smoothstep(-0.7, 0.5, vObj.y);
        energy += uThinking * (0.18 + 0.75 * band);
        energy *= uWake * (1.0 - uMuted * 0.86);
        // Light source low in the globe (the bulb in the foot): the top half glows more evenly.
        float inner = 0.55 + 0.45 * smoothstep(-0.8, 0.6, vObj.y);
        vec3 core = mix(vec3(1.0, 0.42, 0.12), vec3(1.0, 0.74, 0.46), pow(facing, 1.6));
        vec3 emit = core * energy * inner * (0.35 + 0.8 * pow(facing, 1.3));
        if (uMoon > 0.0) {
          // The moon: an even, milky glow with faint soft maria, light rising inside on the inhale.
          float maria = vnoise(vObj * 2.3 + vec3(3.1, 1.7, 0.4)) * 0.65 + vnoise(vObj * 5.1 + 9.0) * 0.35;
          vec3 moon = mix(vec3(1.0, 0.46, 0.17), vec3(1.0, 0.76, 0.48), pow(facing, 1.4)) * energy;
          moon *= 0.3 + 0.62 * pow(facing, 0.9);
          moon *= 1.0 - 0.07 * smoothstep(0.45, 0.75, maria);
          moon *= 0.82 + 0.3 * smoothstep(-1.0, 1.0, vObj.y + (breath - 0.5) * 1.2);
          emit = mix(emit, moon, uMoon);
        }
        vec2 life = innerLight(cameraPosition, normalize(vWorld - cameraPosition));
        float alive = uWake * (1.0 - uMuted * 0.8) * (1.0 - uMoon) * (1.0 - 0.85 * uWindow);
        // The opal glows lower and warmer so the filaments read as threads of light inside it.
        emit *= mix(1.0, 0.42, alive);
        emit += vec3(1.0, 0.7, 0.38) * pow(life.x, 1.3) * (1.3 + 1.8 * uSpeak + 1.3 * uLevel * uListening + 0.7 * uThinking) * alive;
        emit += vec3(1.0, 0.78, 0.52) * life.y * (0.28 + 0.7 * uLookK + 0.4 * uListening + 0.4 * uSpeak) * alive;
        // The glass itself: milky opal lit by the room (visible when the lamp is dim or muted).
        vec3 opal = toLinear(vec3(0.88, 0.86, 0.83));
        vec3 glass = shade(vWorld, N, V, opal, 0.22, 0.045, 0.6, 1.0) * mix(0.55, 0.25, clamp(energy, 0.0, 1.0));
        glass = mix(glass, glass * vec3(0.86, 0.92, 1.05), uMuted);
        vec3 col = glass * (1.0 - 0.75 * uMoon) + emit * (1.0 - 0.6 * uGrown);
        if (uWindow > 0.001) {
          // The place inside the glass; the lamp's own warmth stays as a faint glow at the rim.
          // Clear glass over it: a cool sheen at grazing angles (the warm opal is gone while it shows).
          vec3 sheen = vec3(0.55, 0.62, 0.72) * pow(1.0 - facing, 2.5) * 0.12;
          col = mix(col, placeWindow(N) + sheen, uWindow);
        }
        if (uSky > 0.001) {
          vec3 sheen = vec3(0.55, 0.62, 0.72) * pow(1.0 - facing, 2.5) * 0.12;
          col = mix(col, skyWindow(N) + sheen, uSky);
        }
        // A small window highlight of the room key light, and a thin milky rim.
        vec3 H = normalize(uKeyDir + V);
        col += uKeyColor * pow(max(dot(N, H), 0.0), 160.0) * 0.5;
        col += vec3(0.9, 0.82, 0.72) * pow(1.0 - facing, 3.0) * (0.05 + 0.08 * energy);
        gl_FragColor = vec4(toDisplay(col), 1.0);
      }
    `,
  });
  return material as ShaderMaterial & { uniforms: OrbUniforms };
}

/** Soft additive halo sprite around the lamp (no bloom pass: a single quad). */
export function createGlowMaterial(color: number): ShaderMaterial & { uniforms: { uStrength: { value: number } } } {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { uColor: { value: hexToVec3(color) }, uStrength: { value: 0.4 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
        center.xy += position.xy * scale;
        gl_Position = projectionMatrix * center;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = exp(-d * d * 5.0) * (1.0 - smoothstep(0.8, 1.0, d));
        gl_FragColor = vec4(uColor * a * uStrength, a * uStrength);
      }
    `,
  });
  return material as ShaderMaterial & { uniforms: { uStrength: { value: number } } };
}

/** Floating glass card (caption / plan / buttons): canvas texture + a view-dependent sheen. */
export interface CardUniforms {
  uMap: { value: Texture };
  uOpacity: { value: number };
  uHighlight: { value: number };
  uContrast: { value: number };
}

/**
 * 23 Oct — accessibility, high contrast: ONE uniform shared by every glass pane (captions, chips, menus, cards),
 * so the setting switches the whole interface at once with no material rebuilt. 0 = frosted glass, 1 = high contrast.
 */
export const CARD_CONTRAST = { value: 0 };

export function createCardMaterial(map: Texture): ShaderMaterial & { uniforms: CardUniforms } {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { uMap: { value: map }, uOpacity: { value: 0 }, uHighlight: { value: 0 }, uContrast: CARD_CONTRAST },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vView;
      varying vec3 vN;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vView = normalize(cameraPosition - world.xyz);
        vN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uOpacity;
      uniform float uHighlight;
      uniform float uContrast;
      varying vec2 vUv;
      varying vec3 vView;
      varying vec3 vN;
      void main() {
        vec4 c = texture2D(uMap, vUv);
        // Glass catches the room: a soft sheen that slides as the head moves.
        float sheen = pow(max(dot(normalize(vView + vec3(0.0, 0.35, 0.0)), vN), 0.0), 18.0) * 0.06;
        // Hover: a gentle lift of light across the surface (visionOS highlight).
        float hover = uHighlight * (0.09 + 0.07 * (1.0 - abs(vUv.x - 0.5) * 2.0));
        vec3 rgb = c.rgb + (sheen + hover) * c.a;
        float a = c.a;
        if (uContrast > 0.0) {
          // High contrast: grey glass → near-black and almost opaque, light text → pure white, the warm accent
          // (primary buttons) kept but opaque, its dark text darker. The pane's edge stays as a white outline.
          float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
          float chroma = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
          float accentK = smoothstep(0.2, 0.3, chroma);
          // Text is what is brighter OR more opaque than the glass (every pane shares the same ~0.6-alpha glass):
          // secondary and tertiary labels become white too, never grey on black.
          float overGlass = smoothstep(0.66, 0.74, c.a) * smoothstep(0.45, 0.55, lum);
          float textK = max(smoothstep(0.66, 0.8, lum), overGlass) * (1.0 - accentK);
          vec3 hc = mix(mix(vec3(0.03), c.rgb, accentK), vec3(1.0), textK) + hover * 0.6 * c.a;
          float ha = mix(c.a * 0.5, max(c.a, 0.94), smoothstep(0.4, 0.5, c.a));
          rgb = mix(rgb, hc, uContrast);
          a = mix(a, ha, uContrast);
        }
        gl_FragColor = vec4(rgb, a * uOpacity);
      }
    `,
  });
  return material as ShaderMaterial & { uniforms: CardUniforms };
}

/**
 * 23 Oct — accessibility, gaze-only selection: the dwell ring (Horizon OS-like). A thin warm ring that fills
 * clockwise while you keep looking; at 1 it selects. One quad, one draw call, only while you dwell.
 */
export function createDwellRingMaterial(): ShaderMaterial & { uniforms: { uProgress: { value: number }; uAlpha: { value: number } } } {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: { uProgress: { value: 0 }, uAlpha: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uProgress;
      uniform float uAlpha;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float band = smoothstep(0.66, 0.72, r) * (1.0 - smoothstep(0.9, 0.96, r));
        // Clockwise from 12 o'clock.
        float a = atan(p.x, p.y) / 6.2831853 + 0.5;
        a = fract(a + 0.5);
        float filled = step(a, uProgress);
        vec3 track = vec3(0.0);
        vec3 fill = vec3(1.0, 0.86, 0.62);
        float alpha = band * mix(0.45, 1.0, filled) * uAlpha;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(mix(track, fill, filled), alpha);
      }
    `,
  });
  return material as ReturnType<typeof createDwellRingMaterial>;
}
