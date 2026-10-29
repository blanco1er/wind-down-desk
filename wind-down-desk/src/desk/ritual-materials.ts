/**
 * v6 rituals: materials for Breathe and Release, same baked "evening lamp" rig as the tray
 * (no scene lights, no shadow maps, no render targets).
 *
 *   black bowl     polished black marble with pale veins, the lamp mirrored in its glaze     1 draw call
 *   water          still, dark, a planar fake reflection of the lamp (analytic, no render
 *                  target), luminous ripples, warm bubbles, light under the sinking stone   1 draw call
 *   pearls         one glass pearl per breath, lit as each cycle completes                   1 draw call
 *   palm glow      the moon's warm light on your open hands (two soft billboards)            1 draw call
 *   room dimmer    darkens the room (passthrough or a Place) on the exhale, never the desk   1 draw call
 */
import { AdditiveBlending, BackSide, NormalBlending, ShaderMaterial, Vector2, Vector3, Vector4 } from '@iwsdk/core';
import { NOISE, RIG, RIG_UNIFORMS, timeUniform } from './materials.ts';
import { WATER_BOWL } from '../logic/release.ts';

export const MAX_RIPPLES = 4;
export const MAX_BUBBLES = 6;
export const MAX_PEARLS = 12;

/** Shared GLSL: the lamp (or the moon) mirrored in a glossy surface, as a disc of its real angular size. */
const MIRROR = /* glsl */ `
  vec3 lampMirror(vec3 P, vec3 R, float discGain, float haloGain) {
    vec3 toO = uOrbPos - P;
    float dO = max(length(toO), 1e-3);
    float dd = dot(R, toO / dO);
    float cosA = sqrt(1.0 - min(0.98, (uOrbRadius * uOrbRadius) / (dO * dO)));
    float disc = smoothstep(cosA - 0.0035, cosA + 0.0015, dd);
    float halo = pow(max(dd, 0.0), 260.0) * 0.4 + pow(max(dd, 0.0), 30.0) * 0.05;
    return vec3(1.0, 0.7, 0.42) * (0.45 + uOrbEnergy) * (disc * discGain + halo * haloGain);
  }
  vec3 roomMirror(vec3 R) {
    // A dim evening room around you: warmer low (walnut, lamp-lit walls), cooler and darker high.
    vec3 env = mix(uFillGround * 1.8, uFillSky * 2.2, smoothstep(-0.25, 0.65, R.y));
    float kd = dot(R, uKeyDir);
    // The room's own evening lamp (the key light) as a small warm reflection.
    env += uKeyColor * vec3(1.0, 0.82, 0.62) * (smoothstep(0.9975, 0.9992, kd) * 0.2 + pow(max(kd, 0.0), 300.0) * 0.1);
    return env * (1.0 - uRoomDim * 0.6);
  }
`;

export interface BlackBowlUniforms {
  uRise: { value: number };
}

/** Polished black stone bowl (Nero Marquina-like): near-black, pale veins, glossy, opaque. */
export function createBlackBowlMaterial(): ShaderMaterial & { uniforms: BlackBowlUniforms } {
  const material = new ShaderMaterial({
    uniforms: { ...RIG_UNIFORMS, uTime: timeUniform, uRise: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec3 vLocalN;
      void main() {
        vLocal = position;
        vLocalN = normal;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uRise;
      varying vec3 vLocal;
      varying vec3 vWorld;
      varying vec3 vN;
      varying vec3 vLocalN;
      ${NOISE}
      ${RIG}
      ${MIRROR}
      void main() {
        // Rising out of the tray: nothing below the tray floor is drawn (uPoolCenter.y is the tray floor height).
        if (vWorld.y < uPoolCenter.y - 0.0004) discard;
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 p = vLocal;
        // Nero Marquina: warm near-black stone, thin branching white veins, polished.
        // v8: long flowing veins (low-frequency warp, thin lines, broad masks) instead of short blotches.
        float warp = vnoise(p * 7.0) * 0.7 + vnoise(p * 21.0 + 3.0) * 0.25 + vnoise(p * 90.0 + 7.0) * 0.05;
        float v1 = abs(sin((p.x * 0.8 + p.z * 0.6 + p.y * 1.7) * 52.0 + warp * 9.0));
        float v2 = abs(sin((p.x * -0.5 + p.z * 0.9 - p.y * 1.1) * 78.0 + warp * 12.0 + 2.0));
        float vein = (1.0 - smoothstep(0.0, 0.055, v1)) * smoothstep(0.3, 0.55, vnoise(p * 4.5 + 1.3));
        vein = max(vein, (1.0 - smoothstep(0.0, 0.04, v2)) * smoothstep(0.42, 0.62, vnoise(p * 3.5 + 5.1)) * 0.65);
        float cloud = vnoise(p * 60.0 + 11.0);
        // v8: the veins read from the seat (they were lost in the dark), still thin and branching.
        vec3 albedo = toLinear(vec3(0.085, 0.078, 0.072)) * (0.82 + 0.36 * cloud) + toLinear(vec3(0.7, 0.68, 0.64)) * vein * 0.95;
        float rough = mix(0.12, 0.3, vein);
        bool inside = dot(vLocalN.xz, vLocal.xz) < 0.0 && vLocalN.y < 0.9;
        float ao = inside ? 0.55 + 0.45 * smoothstep(0.0, 0.05, p.y) : 0.75 + 0.25 * smoothstep(0.0, 0.012, p.y);
        // Below the water line the stone is wet and deep in shadow (the water is drawn over it).
        float wet = inside ? 1.0 - smoothstep(${WATER_BOWL.water.toFixed(4)} - 0.002, ${WATER_BOWL.water.toFixed(4)} + 0.002, p.y) : 0.0;
        vec3 col = shade(vWorld, N, V, albedo, rough, 0.05, 0.1, 1.0) * ao;
        vec3 R = reflect(-V, N);
        float fr = 0.05 + 0.95 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        col += roomMirror(R) * vec3(1.05, 0.95, 0.85) * fr * 1.5 * (1.0 - vein * 0.5) * ao;
        col += lampMirror(vWorld, R, 0.9, 1.0) * (0.25 + fr) * (1.0 - rough);
        col *= 1.0 - wet * 0.82;
        gl_FragColor = vec4(toDisplay(col), 1.0);
      }
    `,
  });
  return material as ShaderMaterial & { uniforms: BlackBowlUniforms };
}

export interface WaterUniforms {
  uRipples: { value: Vector4[] };
  uBubbles: { value: Vector4[] };
  /** x, z (bowl-local), strength: a stone held over the water warms the surface under it. */
  uHover: { value: Vector3 };
  /** x, z (bowl-local), strength: the light of the engraving under the water. */
  uUnder: { value: Vector3 };
  uOpacity: { value: number };
  uRadius: { value: number };
}

/** Still dark water. Transparent (the stone shows faintly through it), drawn after opaque objects. */
export function createWaterMaterial(radius: number): ShaderMaterial & { uniforms: WaterUniforms } {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      ...RIG_UNIFORMS,
      uTime: timeUniform,
      uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new Vector4(0, 0, -100, 0)) },
      uBubbles: { value: Array.from({ length: MAX_BUBBLES }, () => new Vector4(0, 0, -100, 0)) },
      uHover: { value: new Vector3(0, 0, 0) },
      uUnder: { value: new Vector3(0, 0, 0) },
      uOpacity: { value: 0 },
      uRadius: { value: radius },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      varying vec3 vWorld;
      varying vec3 vAxisX;
      varying vec3 vAxisZ;
      void main() {
        vP = position.xz;
        vAxisX = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
        vAxisZ = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      #define MAX_RIPPLES ${MAX_RIPPLES}
      #define MAX_BUBBLES ${MAX_BUBBLES}
      uniform float uTime;
      uniform vec4 uRipples[MAX_RIPPLES];
      uniform vec4 uBubbles[MAX_BUBBLES];
      uniform vec3 uHover;
      uniform vec3 uUnder;
      uniform float uOpacity;
      uniform float uRadius;
      varying vec2 vP;
      varying vec3 vWorld;
      varying vec3 vAxisX;
      varying vec3 vAxisZ;
      ${RIG}
      ${MIRROR}
      // Concentric ripples: a travelling wave packet per source (≈ 7 cm/s), damped, with a trailing ring.
      float waves(vec2 p) {
        float h = 0.0;
        for (int i = 0; i < MAX_RIPPLES; i++) {
          vec4 r = uRipples[i];
          float age = uTime - r.z;
          if (r.w <= 0.0 || age < 0.0 || age > 7.0) continue;
          float d = length(p - r.xy);
          float x = d - age * 0.072;
          h += r.w * exp(-x * x / 0.0011) * exp(-age * 0.5) * sin(x * 170.0);
          float x2 = d - age * 0.045;
          h += 0.45 * r.w * exp(-x2 * x2 / 0.0006) * exp(-age * 0.75) * sin(x2 * 230.0);
        }
        // Waves fade at the wall instead of crossing it.
        h *= smoothstep(uRadius, uRadius - 0.012, length(p));
        // Still water still breathes: a barely visible slow swell.
        h += 0.00004 * sin(p.x * 55.0 + uTime * 0.7) * sin(p.y * 47.0 - uTime * 0.5);
        return h;
      }
      void main() {
        vec2 p = vP;
        float e = 0.0015;
        float hx = (waves(p + vec2(e, 0.0)) - waves(p - vec2(e, 0.0))) / (2.0 * e);
        float hz = (waves(p + vec2(0.0, e)) - waves(p - vec2(0.0, e))) / (2.0 * e);
        vec3 nl = normalize(vec3(-hx, 1.0, -hz));
        vec3 N = normalize(nl.x * vAxisX + vec3(0.0, nl.y, 0.0) + nl.z * vAxisZ);
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 R = reflect(-V, N);
        float fr = 0.06 + 0.94 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 deep = vec3(0.0022, 0.0026, 0.003);
        // Dark, still water: it mirrors a dim warm room, the lamp, and little else.
        vec3 col = deep + roomMirror(R) * vec3(1.0, 0.9, 0.78) * fr * 0.85;
        // The lamp (or the moon) mirrored on the still water: the planar fake reflection.
        col += lampMirror(vWorld, R, 2.6, 1.6) * fr;
        vec3 warm = vec3(1.0, 0.68, 0.38);
        // Luminous ripples: crests catch the lamp light.
        float slope = length(vec2(hx, hz));
        col += warm * smoothstep(0.03, 0.22, slope) * 0.13 * (0.4 + uOrbEnergy);
        // Warm bubbles: small rings that open and pop at the surface.
        for (int i = 0; i < MAX_BUBBLES; i++) {
          vec4 b = uBubbles[i];
          float age = uTime - b.z;
          if (age < 0.0 || age > 0.9) continue;
          float k = age / 0.9;
          float d = length(p - b.xy);
          float rr = b.w * (0.4 + 0.6 * k);
          float ring = exp(-pow((d - rr) / (0.0012 + 0.001 * k), 2.0)) * (1.0 - k);
          float dot0 = exp(-d * d / (b.w * b.w * 0.25)) * (1.0 - k) * 0.6;
          col += warm * (ring * 0.9 + dot0) * 0.7;
        }
        // A stone held over the water warms the surface under it; the sinking words glow through.
        vec2 hv = p - uHover.xy;
        col += warm * uHover.z * 0.06 * exp(-dot(hv, hv) / 0.0035);
        vec2 uv = p - uUnder.xy;
        col += warm * uUnder.z * 0.22 * exp(-dot(uv, uv) / 0.0022);
        // Meniscus: a thin bright line where the water meets the wall.
        float rim = smoothstep(uRadius - 0.004, uRadius, length(p));
        col += roomMirror(vec3(0.0, 0.3, 0.0)) * rim * 0.8;
        float alpha = mix(0.9, 0.98, fr) * uOpacity;
        gl_FragColor = vec4(toDisplay(col), alpha);
      }
    `,
  });
  return material as ShaderMaterial & { uniforms: WaterUniforms };
}

export interface PearlUniforms {
  uLit: { value: number[] };
  uCount: { value: number };
  uShow: { value: number };
  uCurrent: { value: number };
  uBreath: { value: number };
  uSpacing: { value: number };
  uRadius: { value: number };
}

/** Glass pearls in a row, one per breath: frosted when waiting, warm light inside once breathed. */
export function createPearlMaterial(): ShaderMaterial & { uniforms: PearlUniforms } {
  const material = new ShaderMaterial({
    uniforms: {
      ...RIG_UNIFORMS,
      uTime: timeUniform,
      uLit: { value: new Array(MAX_PEARLS).fill(0) },
      uCount: { value: 6 },
      uShow: { value: 0 },
      uCurrent: { value: -1 },
      uBreath: { value: 0 },
      uSpacing: { value: 0.026 },
      uRadius: { value: 0.0075 },
    },
    vertexShader: /* glsl */ `
      attribute float aIdx;
      uniform float uCount;
      uniform float uShow;
      uniform float uSpacing;
      uniform float uRadius;
      varying vec3 vN;
      varying vec3 vWorld;
      varying float vIdx;
      void main() {
        vIdx = aIdx;
        float visible = step(aIdx, uCount - 0.5);
        float rise = clamp(uShow * 1.7 - aIdx * 0.06, 0.0, 1.0);
        rise = rise * rise * (3.0 - 2.0 * rise);
        float x = (aIdx - (uCount - 1.0) * 0.5) * uSpacing;
        vec3 local = vec3(x, uRadius * 0.96 - (1.0 - rise) * uRadius * 2.2, 0.0) + position * uRadius * visible;
        vec4 w = modelMatrix * vec4(local, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      #define MAX_PEARLS ${MAX_PEARLS}
      uniform float uTime;
      uniform float uLit[MAX_PEARLS];
      uniform float uCurrent;
      uniform float uBreath;
      varying vec3 vN;
      varying vec3 vWorld;
      varying float vIdx;
      ${RIG}
      void main() {
        if (vWorld.y < uPoolCenter.y - 0.0003) discard;
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorld);
        float facing = max(dot(N, V), 0.0);
        int i = int(vIdx + 0.5);
        float lit = uLit[i];
        // Unlit: smoky frosted glass, quiet. Lit: amber light inside (never blown to white).
        vec3 glass = shade(vWorld, N, V, toLinear(vec3(0.62, 0.6, 0.57)), 0.24, 0.05, 0.6, 1.0) * 0.7 + vec3(0.016, 0.014, 0.012);
        vec3 warm = mix(vec3(1.0, 0.45, 0.14), vec3(1.0, 0.76, 0.42), pow(facing, 1.6));
        float glow = lit * (0.95 + 0.05 * sin(uTime * 1.7 + vIdx * 1.3));
        // The pearl being breathed now glows faintly with the breath.
        // v8: the breath being taken warms its pearl with the breath (the reference shows it already lit).
        glow += step(abs(vIdx - uCurrent), 0.1) * (0.25 + 0.45 * uBreath);
        vec3 col = glass * (1.0 - min(glow, 1.0) * 0.7) + warm * glow * (0.55 + 1.0 * pow(facing, 1.1));
        col += vec3(0.9, 0.85, 0.78) * pow(1.0 - facing, 3.0) * 0.08;
        vec3 H = normalize(uKeyDir + V);
        col += uKeyColor * pow(max(dot(N, H), 0.0), 120.0) * 0.4;
        gl_FragColor = vec4(toDisplay(col), 1.0);
      }
    `,
  });
  return material as ShaderMaterial & { uniforms: PearlUniforms };
}

export interface PalmUniforms {
  uPalm: { value: Vector3[] };
  uStrength: { value: number[] };
  uSize: { value: number };
}

/** The moon's warm light on your open hands: two soft additive billboards held just in front of the palms. */
export function createPalmGlowMaterial(): ShaderMaterial & { uniforms: PalmUniforms } {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    // 29 Oct: normal blending: a warm veil that never clips (additive over the light oak saturated red and slid
    // toward yellow-green around Meta's grey fists).
    blending: NormalBlending,
    uniforms: { uPalm: { value: [new Vector3(), new Vector3()] }, uStrength: { value: [0, 0] }, uSize: { value: 0.2 } },
    vertexShader: /* glsl */ `
      attribute float aHand;
      uniform vec3 uPalm[2];
      uniform float uStrength[2];
      uniform float uSize;
      varying vec2 vUv;
      varying float vStrength;
      void main() {
        int h = int(aHand + 0.5);
        vUv = position.xy * 2.0;
        vStrength = uStrength[h];
        vec4 mv = viewMatrix * vec4(uPalm[h], 1.0);
        mv.xyz -= normalize(mv.xyz) * 0.035;
        mv.xy += position.xy * uSize * step(0.002, vStrength);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying float vStrength;
      void main() {
        float d = length(vUv);
        float a = exp(-d * d * 4.2) * (1.0 - smoothstep(0.85, 1.0, d));
        // 29 Oct: light held inside the hand: a warm white heart and a deep amber glow around it. Added over the oak
        // or Meta's grey hands it stays warm (the flat orange disc clipped to yellow-green).
        float core = exp(-d * d * 26.0);
        vec3 c = mix(vec3(1.0, 0.52, 0.2), vec3(1.0, 0.9, 0.74), core);
        gl_FragColor = vec4(c, clamp((a * 0.78 + core * 0.55) * vStrength, 0.0, 0.88));
      }
    `,
  });
  return material as ShaderMaterial & { uniforms: PalmUniforms };
}

/** Darkens everything beyond the desk (passthrough room or a Place) by `rig.uRoomDim`: black, translucent, at infinity. */
export function createDimmerMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Seen from inside: the far wall's faces point away from the eye (owner, 19 Oct: with the default front side
    // the veil was culled and the room never dimmed during Breathe).
    side: BackSide,
    uniforms: { uRoomDim: RIG_UNIFORMS.uRoomDim },
    vertexShader: /* glsl */ `
      void main() {
        vec3 world = cameraPosition + normalize(position) * 50.0;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uRoomDim;
      void main() {
        gl_FragColor = vec4(0.0, 0.0, 0.0, uRoomDim);
      }
    `,
  });
}

export const PEARL_SIZE = new Vector2(0.0075, 0.026);
