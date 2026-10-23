/**
 * The lamp as a presence (24 Oct, axe 4; owner: "beyond Mindtopia's living sphere"). Around the opal globe, a small
 * aura of warm motes — and the lamp's soft halo — in ONE draw call (camera-facing quads expanded on the GPU; the halo
 * quad that used to be its own mesh is the first one), everything animated in the shader, no per-frame allocation:
 *   - it breathes with the lamp (≈ 6.2 s), and drifts so it never looks mechanical;
 *   - when the lamp speaks, ripples travel outward through it, in time with the words;
 *   - when you speak, the motes lean toward you and gather (it listens);
 *   - while it thinks, they turn faster and closer;
 *   - when you look at it, they turn toward you a little more.
 * 70 % of the motes form a luminous shell hugging the globe, 30 % wander further out. The globe's own inner filaments
 * and its warm heart (materials.ts createOrbMaterial) complete the character.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3 } from '@iwsdk/core';
import { timeUniform } from './materials.ts';

const MOTES = 320;
/** The halo quad's size relative to the globe radius (was the separate glow mesh: 7.5 × globe). */
const HALO = 7.5;

export interface SpiritState {
  energy: number;
  speak: number;
  listen: number;
  think: number;
  lookK: number;
  alpha: number;
  /** The halo's strength (the former glow mesh's uStrength). */
  halo: number;
}

export class LampSpirit {
  readonly mesh: Mesh;
  private readonly uniforms: {
    uTime: { value: number };
    uEnergy: { value: number };
    uSpeak: { value: number };
    uListen: { value: number };
    uThink: { value: number };
    uLookK: { value: number };
    uAlpha: { value: number };
    uHalo: { value: number };
    uLook: { value: Vector3 };
  };

  constructor(globeRadius: number) {
    const quads = MOTES + 1;
    const seeds = new Float32Array(quads * 4 * 4);
    const corners = new Float32Array(quads * 4 * 2);
    const positions = new Float32Array(quads * 4 * 3);
    const index = new Uint16Array(quads * 6);
    const C = [-1, -1, 1, -1, 1, 1, -1, 1];
    for (let q = 0; q < quads; q++) {
      // Quad 0 is the halo (seed.x = −1); the motes get a deterministic golden-ratio spread (the same lamp every evening).
      const i = q - 1;
      const seed = q === 0 ? [-1, 0, 0, 0] : [(i * 0.618034) % 1, Math.pow((i * 0.754878) % 1, 1.4), (i * 0.56984) % 1, (i * 0.328573 + 0.13) % 1];
      for (let v = 0; v < 4; v++) {
        seeds.set(seed, (q * 4 + v) * 4);
        corners[(q * 4 + v) * 2] = C[v * 2];
        corners[(q * 4 + v) * 2 + 1] = C[v * 2 + 1];
      }
      index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 4));
    geometry.setAttribute('aCorner', new BufferAttribute(corners, 2));
    geometry.setIndex(new BufferAttribute(index, 1));
    this.uniforms = {
      uTime: timeUniform,
      uEnergy: { value: 0.6 },
      uSpeak: { value: 0 },
      uListen: { value: 0 },
      uThink: { value: 0 },
      uLookK: { value: 0 },
      uAlpha: { value: 0 },
      uHalo: { value: 0.3 },
      uLook: { value: new Vector3(0, 0.3, 1) },
    };
    const R = globeRadius.toFixed(4);
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uEnergy;
        uniform float uSpeak;
        uniform float uListen;
        uniform float uThink;
        uniform float uLookK;
        uniform float uAlpha;
        uniform vec3 uLook;
        attribute vec4 aSeed;
        attribute vec2 aCorner;
        varying vec2 vUv;
        varying float vA;
        varying float vWarm;
        varying float vHalo;
        void main() {
          float scale = length(modelMatrix[0].xyz);
          vUv = aCorner;
          if (aSeed.x < 0.0) {
            // The halo: a camera-facing quad at the globe's centre.
            vHalo = 1.0;
            vA = 1.0;
            vWarm = 0.0;
            vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            c.xy += aCorner * ${R} * ${HALO.toFixed(1)} * 0.5 * scale;
            gl_Position = projectionMatrix * c;
            return;
          }
          vHalo = 0.0;
          float ph = aSeed.x * 6.2831853;
          bool shell = aSeed.y < 0.7;
          float r = ${R} * (shell ? 1.12 + aSeed.y * 0.55 : 1.6 + (aSeed.y - 0.7) * 5.0);
          float dir = aSeed.z > 0.5 ? 1.0 : -1.0;
          float a = ph + uTime * (0.1 + aSeed.z * 0.22) * (1.0 + 2.4 * uThink) * dir;
          // Shell motes cover the sphere evenly (latitude from the seed); wanderers keep to looser rings.
          float lat = shell ? asin(aSeed.w * 2.0 - 1.0) : (aSeed.w - 0.5) * 1.1;
          vec3 p = shell ? vec3(cos(a) * cos(lat), sin(lat) + 0.08 * sin(a * 0.5 + ph), sin(a) * cos(lat)) : vec3(cos(a), lat + 0.3 * sin(a * 0.5 + ph), sin(a));
          float tilt = shell ? 0.0 : (aSeed.w - 0.5) * 1.6;
          p = vec3(p.x, p.y * cos(tilt) - p.z * sin(tilt), p.y * sin(tilt) + p.z * cos(tilt));
          p = normalize(p) * r;
          // Breath (the lamp's own 6.2 s rhythm).
          p *= 0.92 + 0.08 * (0.5 + 0.5 * sin(uTime * 1.0134));
          // Its voice: ripples travelling outward.
          p *= 1.0 + uSpeak * (0.14 + 0.16 * sin(uTime * 9.0 - aSeed.y * 10.0 + ph * 0.5));
          // It listens: the motes lean toward you and gather; looking at it turns it toward you a little more.
          vec3 toYou = normalize(uLook);
          p = mix(p, p * 0.72 + toYou * r * 0.5, clamp(uListen * 0.65 + uLookK * 0.25, 0.0, 0.85));
          // It thinks: closer, faster.
          p *= 1.0 - 0.18 * uThink;
          p.y += 0.004 * sin(uTime * 0.7 + ph * 3.0) + 0.006;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float size = (shell ? 0.00045 + 0.00035 * fract(aSeed.x * 7.13) : 0.00055 + 0.0006 * fract(aSeed.x * 7.13)) * (1.0 + 0.6 * uSpeak + 0.3 * uListen);
          mv.xy += aCorner * size * scale;
          gl_Position = projectionMatrix * mv;
          float twinkle = 0.55 + 0.45 * sin(uTime * (1.1 + aSeed.z * 1.7) + ph * 5.0);
          vA = uAlpha * twinkle * (0.32 + 0.35 * uEnergy + 0.8 * uSpeak + 0.55 * uListen + 0.3 * uThink) * (shell ? 0.75 : 0.55);
          vWarm = shell ? 0.25 + 0.3 * aSeed.y : 0.8;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uHalo;
        varying vec2 vUv;
        varying float vA;
        varying float vWarm;
        varying float vHalo;
        void main() {
          float d = length(vUv);
          if (vHalo > 0.5) {
            // Exactly the former glow mesh (warm 0xffb066, additive).
            float g = exp(-d * d * 5.0) * (1.0 - smoothstep(0.8, 1.0, d));
            gl_FragColor = vec4(vec3(1.0, 0.690, 0.4) * g * uHalo, g * uHalo);
            return;
          }
          float a = pow(max(1.0 - d, 0.0), 1.8) * vA;
          if (a < 0.004) discard;
          gl_FragColor = vec4(mix(vec3(1.0, 0.93, 0.8), vec3(1.0, 0.7, 0.4), vWarm), a);
        }
      `,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.raycast = () => {};
  }

  /** `lookLocal`: direction to your eyes in the globe's own space. */
  update(s: SpiritState, lookLocal: Vector3): void {
    const u = this.uniforms;
    u.uEnergy.value = s.energy;
    u.uSpeak.value = s.speak;
    u.uListen.value = s.listen;
    u.uThink.value = s.think;
    u.uLookK.value = s.lookK;
    u.uAlpha.value = s.alpha;
    u.uHalo.value = s.halo;
    u.uLook.value.copy(lookLocal);
  }
}
