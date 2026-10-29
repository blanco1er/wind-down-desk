/**
 * 28 Oct — "How heavy tonight?": a short brass rail that rises out of the tray, a glass bead that slides along it
 * (pale and bright when light, deep amber when heavy), last time's bead as a faint reflection, the value floating
 * above the bead while a finger moves it, and two engraved words, "light" and "heavy".
 *
 * ONE draw call for all of it (rail, feet, bead, ghost bead, labels, number): one mesh, parts told apart by a vertex
 * attribute, the bead moved in the vertex shader. Not drawn at all while it rests inside the tray.
 * Desk-local, child of the desk root (logic/tension.ts RAIL).
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  LinearFilter,
  Matrix4,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  type Group,
} from '@iwsdk/core';
import { RAIL, TENSION_MAX } from '../logic/tension.ts';
import { RIG, RIG_UNIFORMS, timeUniform } from './materials.ts';
import { DS } from './design-tokens.ts';

const FONT = '"General Sans", "Helvetica Neue", Arial, sans-serif';

type Part = 0 | 1 | 2 | 3 | 4;

function merge(parts: Array<{ geo: BufferGeometry; part: Part; m: Matrix4 }>): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const part: number[] = [];
  const index: number[] = [];
  let offset = 0;
  for (const p of parts) {
    const g = p.geo.clone().applyMatrix4(p.m);
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const U = g.getAttribute('uv');
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nrm.push(N.getX(i), N.getY(i), N.getZ(i));
      uv.push(U.getX(i), U.getY(i));
      part.push(p.part);
    }
    const I = g.getIndex();
    if (I != null) for (let i = 0; i < I.count; i++) index.push(I.getX(i) + offset);
    offset += P.count;
    g.dispose();
    p.geo.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  out.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  out.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  out.setAttribute('aPart', new BufferAttribute(new Float32Array(part), 1));
  out.setIndex(index);
  return out;
}

/** Label strip (top half of the canvas) and the value pill (bottom half). */
const CANVAS = { w: 512, h: 192 } as const;
const LABEL = { w: (RAIL.x1 - RAIL.x0) + 0.07, h: 0.026 } as const;
const NUMBER = { w: 0.034, h: 0.026 } as const;

export class TensionRail {
  readonly mesh: Mesh;
  private readonly uniforms: {
    uShow: { value: number };
    uBead: { value: number };
    uGhost: { value: number };
    uGhostA: { value: number };
    uTouch: { value: number };
    uNumA: { value: number };
    uMap: { value: CanvasTexture };
  };
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private shown = 0;
  showTarget = 0;
  /** 0..1 bead position (set every frame by the dial). */
  bead = 0.5;
  /** Last time's value as a faint bead (null: none). */
  ghost: number | null = null;
  touching = false;
  private touchK = 0;
  private numK = 0;
  private numHold = 0;
  private drawnValue = -1;
  private drawnLabels = '';

  constructor(root: Group) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS.w;
    this.canvas.height = CANVAS.h;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    const len = RAIL.x1 - RAIL.x0 + 0.02;
    const cx = (RAIL.x0 + RAIL.x1) / 2;
    const m = (fn: (m: Matrix4) => Matrix4) => fn(new Matrix4());
    const label = new PlaneGeometry(LABEL.w, LABEL.h);
    // Label uv → top half of the canvas; number uv → bottom half.
    const lu = label.getAttribute('uv');
    for (let i = 0; i < lu.count; i++) lu.setY(i, 0.5 + lu.getY(i) * 0.5);
    const num = new PlaneGeometry(NUMBER.w, NUMBER.h);
    const nu = num.getAttribute('uv');
    for (let i = 0; i < nu.count; i++) nu.setY(i, nu.getY(i) * 0.5);
    const geometry = merge([
      { geo: new CylinderGeometry(0.0031, 0.0031, len, 12, 1), part: 0, m: m((x) => x.makeRotationZ(Math.PI / 2).setPosition(cx, RAIL.y, RAIL.z)) },
      { geo: new CylinderGeometry(0.0036, 0.0048, RAIL.y + 0.002, 10, 1), part: 0, m: m((x) => x.makeTranslation(RAIL.x0 - 0.012, RAIL.y / 2 - 0.001, RAIL.z)) },
      { geo: new CylinderGeometry(0.0036, 0.0048, RAIL.y + 0.002, 10, 1), part: 0, m: m((x) => x.makeTranslation(RAIL.x1 + 0.012, RAIL.y / 2 - 0.001, RAIL.z)) },
      { geo: new SphereGeometry(RAIL.bead, 20, 14), part: 1, m: new Matrix4() },
      { geo: new SphereGeometry(RAIL.bead * 0.92, 14, 10), part: 2, m: new Matrix4() },
      { geo: label, part: 3, m: m((x) => x.makeRotationX(-0.95).setPosition(cx, 0.012, RAIL.z - 0.03)) },
      { geo: num, part: 4, m: m((x) => x.makeRotationX(-0.32)) },
    ]);
    const u = {
      uShow: { value: 0 },
      uBead: { value: 0.5 },
      uGhost: { value: 0.5 },
      uGhostA: { value: 0 },
      uTouch: { value: 0 },
      uNumA: { value: 0 },
      uMap: { value: this.texture },
    };
    this.uniforms = u;
    const material = new ShaderMaterial({
      transparent: true,
      uniforms: { ...RIG_UNIFORMS, uTime: timeUniform, ...u, uX0: { value: RAIL.x0 }, uX1: { value: RAIL.x1 }, uRailY: { value: RAIL.y }, uRailZ: { value: RAIL.z }, uBeadR: { value: RAIL.bead } },
      vertexShader: /* glsl */ `
        attribute float aPart;
        uniform float uShow;
        uniform float uBead;
        uniform float uGhost;
        uniform float uX0;
        uniform float uX1;
        uniform float uRailY;
        uniform float uRailZ;
        uniform float uBeadR;
        uniform float uTouch;
        varying vec3 vN;
        varying vec3 vWorld;
        varying vec2 vUv;
        varying float vPart;
        varying float vLocalY;
        void main() {
          vPart = aPart;
          vUv = uv;
          vec3 p = position;
          float rise = smoothstep(0.0, 1.0, uShow);
          if (aPart > 0.5 && aPart < 1.5) {
            // The bead swells a little under the finger.
            p = p * (1.0 + 0.12 * uTouch) + vec3(mix(uX0, uX1, uBead), uRailY + 0.0006, uRailZ);
          } else if (aPart > 1.5 && aPart < 2.5) {
            p += vec3(mix(uX0, uX1, uGhost), uRailY + 0.0006, uRailZ);
          } else if (aPart > 3.5) {
            p += vec3(mix(uX0, uX1, uBead), uRailY + uBeadR + 0.02, uRailZ + 0.004);
          }
          p.y -= (1.0 - rise) * 0.05;
          vLocalY = p.y;
          vec4 w = modelMatrix * vec4(p, 1.0);
          vWorld = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uShow;
        uniform float uBead;
        uniform float uGhostA;
        uniform float uTouch;
        uniform float uNumA;
        uniform sampler2D uMap;
        varying vec3 vN;
        varying vec3 vWorld;
        varying vec2 vUv;
        varying float vPart;
        varying float vLocalY;
        ${RIG}
        void main() {
          if (vLocalY < -0.0004) discard;
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vWorld);
          float facing = max(dot(N, V), 0.0);
          vec3 col;
          float alpha = 1.0;
          if (vPart < 0.5) {
            // Brushed brass, a warm glint running along it while a finger slides the bead.
            col = shade(vWorld, N, V, toLinear(vec3(0.74, 0.55, 0.31)), 0.34, 0.62, 0.2, 1.0);
            col += vec3(1.0, 0.72, 0.4) * uTouch * 0.05 * (0.6 + 0.4 * sin(uTime * 3.0));
          } else if (vPart < 1.5) {
            // Glass bead: pale moonlight when light, a deep slow amber when heavy. It breathes, faintly.
            vec3 lightC = vec3(1.0, 0.93, 0.8);
            vec3 heavyC = vec3(0.62, 0.2, 0.06);
            vec3 inner = mix(lightC, heavyC, smoothstep(0.0, 1.0, uBead));
            float glow = (0.42 + 0.3 * (1.0 - uBead)) * (0.92 + 0.08 * sin(uTime * 1.3)) + 0.35 * uTouch;
            vec3 glass = shade(vWorld, N, V, toLinear(vec3(0.6, 0.58, 0.55)), 0.18, 0.05, 0.6, 1.0) * 0.5;
            col = glass + inner * glow * (0.35 + 0.9 * pow(facing, 1.3));
            col += vec3(0.95, 0.9, 0.82) * pow(1.0 - facing, 3.0) * 0.14;
            vec3 H = normalize(uKeyDir + V);
            col += uKeyColor * pow(max(dot(N, H), 0.0), 140.0) * 0.5;
          } else if (vPart < 2.5) {
            // Last time's bead: a faint smoky reflection of glass.
            col = vec3(0.5, 0.46, 0.42) * (0.25 + 0.5 * pow(1.0 - facing, 2.0));
            alpha = uGhostA * (0.35 + 0.4 * pow(1.0 - facing, 2.0));
          } else {
            vec4 t = texture2D(uMap, vUv);
            col = toLinear(t.rgb);
            alpha = t.a * (vPart < 3.5 ? 1.0 : uNumA);
            gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)) * (1.0 - uDim * 0.5), alpha * smoothstep(0.6, 1.0, uShow));
            return;
          }
          gl_FragColor = vec4(toDisplay(col), alpha);
        }
      `,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.renderOrder = 7;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.raycast = () => {};
    root.add(this.mesh);
    this.drawLabels('light', 'heavy');
  }

  /**
   * "light" / "heavy" with the 11 marks, on a strip just behind the rail (in front of it, the tray's rim would hide it
   * from the seat).
   */
  drawLabels(left: string, right: string): void {
    const key = `${left}|${right}`;
    if (key === this.drawnLabels) return;
    this.drawnLabels = key;
    const { ctx } = this;
    const h = CANVAS.h / 2;
    ctx.clearRect(0, 0, CANVAS.w, h);
    // Tick marks, one per value, aligned with the rail (the label quad is 7 cm wider than the rail).
    const px = (x: number) => ((x - (RAIL.x0 + RAIL.x1) / 2) / LABEL.w + 0.5) * CANVAS.w;
    ctx.fillStyle = 'rgba(255, 236, 206, 0.55)';
    for (let i = 0; i <= TENSION_MAX; i++) {
      const x = px(RAIL.x0 + ((RAIL.x1 - RAIL.x0) * i) / TENSION_MAX);
      ctx.beginPath();
      ctx.arc(x, 14, i % 5 === 0 ? 4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = `600 34px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = DS.text.primary;
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 6;
    ctx.textAlign = 'left';
    ctx.fillText(left, 6, 58);
    ctx.textAlign = 'right';
    ctx.fillText(right, CANVAS.w - 6, 58);
    ctx.shadowBlur = 0;
    this.texture.needsUpdate = true;
  }

  private drawNumber(value: number): void {
    if (value === this.drawnValue) return;
    this.drawnValue = value;
    const { ctx } = this;
    const y0 = CANVAS.h / 2;
    ctx.clearRect(0, y0, CANVAS.w, CANVAS.h / 2);
    // A small glass pill with the value. The quad is 1.3 : 1 but the canvas half is 5.3 : 1: everything is drawn in
    // a stretched frame (x × 4.1) so the pill's corners and the digits read round in 3D.
    const k = CANVAS.w / (CANVAS.h / 2) / (NUMBER.w / NUMBER.h);
    const W = CANVAS.w / k;
    const H = CANVAS.h / 2;
    ctx.save();
    ctx.translate(0, y0);
    ctx.scale(k, 1);
    const r = H / 2 - 6;
    ctx.beginPath();
    ctx.moveTo(6 + r, 6);
    ctx.lineTo(W - 6 - r, 6);
    ctx.arc(W - 6 - r, H / 2, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(6 + r, H - 6);
    ctx.arc(6 + r, H / 2, r, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(28, 22, 18, 0.66)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 252, 246, 0.38)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = DS.text.primary;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 64px ${FONT}`;
    ctx.fillText(String(value), W / 2, H / 2 + 3);
    ctx.restore();
    this.texture.needsUpdate = true;
  }

  get visible(): boolean {
    return this.shown > 0.003;
  }

  update(dt: number, value: number): void {
    this.shown += (this.showTarget - this.shown) * (1 - Math.exp(-(this.showTarget > this.shown ? 2.6 : 3.4) * dt));
    if (Math.abs(this.shown - this.showTarget) < 0.002) this.shown = this.showTarget;
    this.mesh.visible = this.shown > 0.003;
    if (!this.mesh.visible) return;
    const u = this.uniforms;
    u.uShow.value = this.shown;
    u.uBead.value = this.bead;
    this.touchK += ((this.touching ? 1 : 0) - this.touchK) * (1 - Math.exp(-10 * dt));
    u.uTouch.value = this.touchK;
    if (this.touching) this.numHold = 1.8;
    else this.numHold = Math.max(0, this.numHold - dt);
    this.numK += ((this.numHold > 0 ? 1 : 0) - this.numK) * (1 - Math.exp(-8 * dt));
    u.uNumA.value = this.numK;
    if (this.numK > 0.01) this.drawNumber(value);
    u.uGhostA.value += ((this.ghost != null ? 1 : 0) - u.uGhostA.value) * (1 - Math.exp(-3 * dt));
    if (this.ghost != null) u.uGhost.value = this.ghost;
  }

  /** Shows the value for a moment (voice, touch words). */
  flashNumber(): void {
    this.numHold = 2.2;
  }
}
