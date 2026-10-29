/**
 * 29 Oct — your sky on your ceiling, as a real night sky (owner: "the most beautiful shot of the video").
 *
 * The stars of the things you let go are drawn by the light field (particles.ts: they rise out of the lamp in trails
 * and land here). This mesh is everything around them, in ONE draw call, only during the night:
 *   - a soft disc of night sky laid on the ceiling plane (or on the virtual dome), inside the comfort cone above your
 *     seat, fading out at its edge: deep blue, a faint Milky Way (a band of value noise with dark dust lanes), and two
 *     layers of tiny background stars that twinkle slowly, denser along the band;
 *   - the constellations of your evenings: thin lines between the stars of the same evening (logic/night-sky.ts),
 *     drawn as camera-facing ribbons whose width follows the distance (≈ 0.05°: thin, never aliased), with a gap at
 *     each star.
 * Everything is in disc space (normalised by the disc radius, which grows with the ceiling height), so the sky keeps
 * the same angular size and density on a low or a high ceiling. Normal alpha blending: in passthrough the real
 * ceiling is covered by the night sky where the disc is opaque. No light, no texture.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, ShaderMaterial, Vector3 } from '@iwsdk/core';
import { NOISE, timeUniform } from './materials.ts';

/** Most constellation segments drawn (the newest evenings first). */
export const MAX_SKY_LINES = 48;
const RINGS = 18;
const SEGMENTS = 56;

export interface CeilingSkyPose {
  /** World centre of the disc (on the ceiling plane, or the dome's apex direction). */
  center: { x: number; y: number; z: number };
  /** Disc radius (metres, on the ceiling plane). */
  radius: number;
  /** The head when the sky was placed (the dome is centred on it). */
  head: { x: number; y: number; z: number };
  /** 0: a real ceiling plane; >0: the virtual dome's radius. */
  dome: number;
}

export class CeilingSky {
  readonly mesh: Mesh;
  private readonly lineA: BufferAttribute;
  private readonly lineB: BufferAttribute;
  private readonly discVerts: number;
  private readonly discIndex: number;
  private show = 0;
  private lines = 0;
  /** Targets: the sky (0..1) and the constellations (0..1). */
  showTarget = 0;
  linesTarget = 0;
  readonly uniforms = {
    uTime: timeUniform,
    uShow: { value: 0 },
    uLines: { value: 0 },
    uCenter: { value: new Vector3() },
    uRadius: { value: 1.5 },
    uHead: { value: new Vector3() },
    uDome: { value: 0 },
  };

  constructor() {
    // Disc: unit radius in XZ (kind 0), rings of quads. Then MAX_SKY_LINES ribbons (kind 1), 4 vertices each.
    const discVerts = 1 + RINGS * SEGMENTS;
    const total = discVerts + MAX_SKY_LINES * 4;
    const position = new Float32Array(total * 3);
    const other = new Float32Array(total * 3);
    const meta = new Float32Array(total * 3);
    const index: number[] = [];
    for (let r = 1; r <= RINGS; r++) {
      const rr = Math.pow(r / RINGS, 0.85);
      for (let s = 0; s < SEGMENTS; s++) {
        const a = (s / SEGMENTS) * Math.PI * 2;
        const i = 1 + (r - 1) * SEGMENTS + s;
        position.set([Math.cos(a) * rr, 0, Math.sin(a) * rr], i * 3);
      }
    }
    for (let s = 0; s < SEGMENTS; s++) index.push(0, 1 + ((s + 1) % SEGMENTS), 1 + s);
    for (let r = 1; r < RINGS; r++) {
      for (let s = 0; s < SEGMENTS; s++) {
        const a = 1 + (r - 1) * SEGMENTS + s;
        const b = 1 + (r - 1) * SEGMENTS + ((s + 1) % SEGMENTS);
        const c = a + SEGMENTS;
        const d = b + SEGMENTS;
        index.push(a, b, c, b, d, c);
      }
    }
    this.discVerts = discVerts;
    this.discIndex = index.length;
    for (let l = 0; l < MAX_SKY_LINES; l++) {
      const o = discVerts + l * 4;
      // meta: kind 1, side (−1 / 1), along (0 / 1).
      [[-1, 0], [1, 0], [-1, 1], [1, 1]].forEach(([side, along], v) => meta.set([1, side, along], (o + v) * 3));
      index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
    const geometry = new BufferGeometry();
    this.lineA = new BufferAttribute(position, 3);
    this.lineB = new BufferAttribute(other, 3);
    geometry.setAttribute('position', this.lineA);
    geometry.setAttribute('aOther', this.lineB);
    geometry.setAttribute('aMeta', new BufferAttribute(meta, 3));
    geometry.setIndex(index);
    geometry.setDrawRange(0, this.discIndex);
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // Seen from below (the ceiling) and from inside (the dome): never culled.
      side: DoubleSide,
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 aOther;
        attribute vec3 aMeta;
        uniform vec3 uCenter;
        uniform float uRadius;
        uniform vec3 uHead;
        uniform float uDome;
        varying vec2 vQ;
        varying vec3 vMeta;
        varying float vLen;
        vec3 onSky(vec3 w) {
          if (uDome > 0.0) return uHead + normalize(w - uHead) * uDome;
          return w;
        }
        void main() {
          vMeta = aMeta;
          vec3 w;
          if (aMeta.x < 0.5) {
            vQ = position.xz;
            // 2 cm under the ceiling: the stars (1 cm under it) stay in front of their sky.
            w = onSky(uCenter + vec3(position.x * uRadius, -0.01, position.z * uRadius));
            vLen = 0.0;
          } else {
            // A constellation line: a ribbon facing the eye, ≈ 0.05° wide at any distance.
            vec3 a = position;
            vec3 b = aOther;
            vec3 p = mix(a, b, aMeta.z);
            vec3 toEye = cameraPosition - p;
            vec3 side = normalize(cross(b - a, toEye));
            w = p + side * aMeta.y * 0.0009 * length(toEye);
            vLen = length(b - a);
            vQ = vec2(aMeta.z * vLen, aMeta.y);
          }
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uShow;
        uniform float uLines;
        varying vec2 vQ;
        varying vec3 vMeta;
        varying float vLen;
        ${NOISE}
        float fbm(vec2 p) {
          float s = 0.0;
          float a = 0.55;
          for (int i = 0; i < 4; i++) {
            s += a * vnoise(vec3(p, 1.7 * float(i)));
            p = p * 2.03 + vec2(4.1, 1.3);
            a *= 0.5;
          }
          return s;
        }
        /** One layer of tiny stars on a jittered grid (cells per disc radius), anti-aliased with fwidth. */
        vec3 starLayer(vec2 q, float cells, float density, float seed) {
          vec2 g = q * cells;
          vec2 id = floor(g);
          vec2 f = fract(g) - 0.5;
          float h = hash13(vec3(id, seed));
          if (h > density) return vec3(0.0);
          vec2 o = vec2(hash13(vec3(id, seed + 3.1)), hash13(vec3(id, seed + 7.7))) - 0.5;
          float d = length(f - o * 0.7);
          float w = fwidth(g.x) * 0.9;
          float r = 0.035 + 0.05 * pow(hash13(vec3(id, seed + 11.0)), 3.0);
          float core = smoothstep(r + w, r - w * 0.3, d);
          float glow = exp(-d * d / (r * r * 9.0)) * 0.25;
          float tw = 0.7 + 0.3 * sin(uTime * (0.5 + 1.3 * h) + h * 40.0);
          float b = (0.35 + 0.65 * pow(hash13(vec3(id, seed + 5.0)), 2.0)) * tw;
          vec3 tint = mix(vec3(0.78, 0.86, 1.0), vec3(1.0, 0.9, 0.76), hash13(vec3(id, seed + 2.0)));
          return tint * (core + glow) * b;
        }
        void main() {
          if (vMeta.x > 0.5) {
            // Line: soft across, a gap at each star (3.5 cm), faint and warm.
            float across = 1.0 - smoothstep(0.25, 1.0, abs(vQ.y));
            float g = 0.05 * vLen / max(vLen, 0.5) + 0.02;
            float gap = smoothstep(g, g * 1.8, vQ.x) * smoothstep(g, g * 1.8, vLen - vQ.x);
            float a = across * gap * uLines * 0.5;
            if (a < 0.003) discard;
            gl_FragColor = vec4(0.86, 0.84, 0.8, a);
            return;
          }
          vec2 q = vQ;
          float r = length(q);
          float edge = 1.0 - smoothstep(0.5, 1.0, r);
          // The Milky Way: a slanted band, uneven, with darker dust lanes.
          vec2 bandN = normalize(vec2(0.55, 0.84));
          float across = dot(q, bandN) + 0.12 * (fbm(q * 1.3 + 7.0) - 0.5);
          float band = exp(-across * across / 0.05);
          float cloud = fbm(q * 3.2 + vec2(1.3, 9.1));
          float lanes = smoothstep(0.42, 0.7, fbm(q * 6.5 + vec2(5.0, 2.0)));
          float neb = band * (0.35 + 0.9 * cloud * cloud) * (1.0 - 0.55 * lanes * band);
          vec3 sky = vec3(0.018, 0.026, 0.06) * (1.0 - 0.35 * r);
          sky += neb * mix(vec3(0.08, 0.1, 0.2), vec3(0.17, 0.13, 0.11), cloud) * 1.15;
          // A faint warm glow far off along the band (the galaxy's core).
          sky += vec3(0.07, 0.05, 0.035) * band * exp(-dot(q - bandN.yx * vec2(0.45, -0.45), q - bandN.yx * vec2(0.45, -0.45)) * 5.0);
          // Fainter and cooler than your stars (the light field draws those, warm and larger, on top).
          vec3 stars = starLayer(q, 34.0, 0.22, 1.0) * 0.8 + starLayer(q, 78.0, 0.08 + 0.3 * band, 2.0) * 0.6;
          sky += stars;
          float a = edge * uShow;
          if (a < 0.003) discard;
          // Opaque enough to replace the ceiling, the stars always on top of their sky.
          gl_FragColor = vec4(sky, a * 0.9);
        }
      `,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 9;
    this.mesh.raycast = () => {};
    this.mesh.name = 'wdd-ceiling-sky';
  }

  /** Lays the disc on the ceiling (or the dome) and draws `segments` (world point pairs) as constellations. */
  place(pose: CeilingSkyPose, segments: ReadonlyArray<readonly [{ x: number; y: number; z: number }, { x: number; y: number; z: number }]>): void {
    const u = this.uniforms;
    u.uCenter.value.set(pose.center.x, pose.center.y, pose.center.z);
    u.uRadius.value = pose.radius;
    u.uHead.value.set(pose.head.x, pose.head.y, pose.head.z);
    u.uDome.value = pose.dome;
    const n = Math.min(MAX_SKY_LINES, segments.length);
    for (let l = 0; l < n; l++) {
      const [a, b] = segments[l];
      for (let v = 0; v < 4; v++) {
        const i = this.discVerts + l * 4 + v;
        this.lineA.setXYZ(i, a.x, a.y, a.z);
        this.lineB.setXYZ(i, b.x, b.y, b.z);
      }
    }
    this.lineA.needsUpdate = true;
    this.lineB.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, this.discIndex + n * 6);
    this.lineCount = n;
  }

  /** Constellation lines drawn tonight (debug, tests). */
  lineCount = 0;

  /** The sky fades in (and out) slowly; the lines follow once the stars have landed. */
  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 0.7);
    this.show += (this.showTarget - this.show) * k;
    this.lines += (this.linesTarget - this.lines) * (1 - Math.exp(-dt * 0.5));
    if (this.showTarget === 0 && this.show < 0.003) this.show = 0;
    this.uniforms.uShow.value = this.show;
    this.uniforms.uLines.value = this.lines * this.show;
    this.mesh.visible = this.show > 0.003;
  }

  hide(): void {
    this.showTarget = 0;
    this.linesTarget = 0;
  }

  get shown(): number {
    return +this.show.toFixed(3);
  }
}
