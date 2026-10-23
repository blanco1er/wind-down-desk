/**
 * Instanced stones (26 Oct, draw budget on Quest): every stone used to be its own mesh and material — one draw call
 * per stone, so 5 stones or more in a busy place went over 25 draws per eye. Now ALL the stones (and the Release
 * weight) are drawn by ONE instanced mesh.
 *
 * Nothing else changes, by design:
 * - Each stone keeps its own Mesh and material: the IWSDK entity you grab, hover, look at and pinch, and the store of
 *   its look (engraving cell, kind, glow, dissolve, basalt, water…). The ritual code is untouched.
 * - Those meshes are moved to a layer no camera draws (HIDDEN_LAYER): rays, pokes and grabs ignore layers.
 * - Before each render (scene.onBeforeRender, after the matrices are updated and after the grab moved the stone),
 *   the batch copies each visible stone's world matrix and uniforms into per-instance attributes.
 * - The instanced shader is the stone shader itself, rewritten: the per-stone uniforms become flat varyings (exact
 *   values, no interpolation), and the pebble shape comes from a small float texture (all pebbles share one topology:
 *   926 vertices, the same index buffer) read with gl_VertexID. Same maths, same pixels (checked: stone-parity tool).
 * A shape that would not share the topology is simply not batched (that stone draws itself, as before).
 */
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  type Object3D,
  type Scene,
} from '@iwsdk/core';
import { linkShared, type StoneUniforms } from './materials.ts';

/** A layer no camera renders (the XR cameras draw layers 0–2). */
export const HIDDEN_LAYER = 7;
const CAPACITY = 48;

/** Per-stone uniforms → per-instance data (flat varyings in the shader, same names through #define). */
const FRAG_DEFINES = /* glsl */ `
  flat varying vec4 vICell;
  flat varying vec4 vIA;
  flat varying vec4 vIB;
  flat varying vec4 vIC;
  flat varying vec4 vIInk;
  flat varying vec4 vID;
  #define uCell vICell
  #define uLabel vID.zw
  #define uAlbedo vIC.xyz
  #define uSeed vIC.w
  #define uGlow vIA.x
  #define uDissolve vIA.y
  #define uDone vIA.z
  #define uWarm vIA.w
  #define uBasalt vIB.x
  #define uEngraveGlow vIB.y
  #define uEngraveFade vIB.z
  #define uWaterY vIB.w
  #define uInk vIInk
  #define uKind vID.xy
`;
export const PER_STONE = ['uCell', 'uLabel', 'uAlbedo', 'uSeed', 'uGlow', 'uDissolve', 'uDone', 'uWarm', 'uBasalt', 'uEngraveGlow', 'uEngraveFade', 'uWaterY', 'uInk', 'uKind'];

/** The stone shader, instanced (text rewrite of the very same shader: any change to the stone shader follows). */
export function instancedStoneShaders(vertex: string, fragment: string): { vertexShader: string; fragmentShader: string } | null {
  let v = vertex;
  let f = fragment;
  for (const name of PER_STONE) {
    const re = new RegExp(`\\n\\s*uniform\\s+\\w+\\s+${name};`, 'u');
    v = v.replace(re, '');
    f = f.replace(re, '');
  }
  if (PER_STONE.some((n) => new RegExp(`uniform\\s+\\w+\\s+${n};`, 'u').test(v + f))) return null;
  const mainAt = v.indexOf('void main() {');
  if (mainAt < 0 || f.indexOf('void main() {') < 0) return null;
  const head = v.slice(0, mainAt);
  let body = v.slice(mainAt + 'void main() {'.length);
  body = body.replace(/\bposition\b/gu, 'sPos').replace(/\bnormal\b/gu, 'sNrm').replace(/\bmodelMatrix\b/gu, 'sModel');
  v = `
    uniform highp sampler2D uShapes;
    attribute vec4 iCell;
    attribute vec4 iA;
    attribute vec4 iB;
    attribute vec4 iC;
    attribute vec4 iInk;
    attribute vec4 iD;
    attribute float iShape;
    flat varying vec4 vICell;
    flat varying vec4 vIA;
    flat varying vec4 vIB;
    flat varying vec4 vIC;
    flat varying vec4 vIInk;
    flat varying vec4 vID;
    #define uCell iCell
    #define uLabel iD.zw
    ${head}
    void main() {
      vICell = iCell; vIA = iA; vIB = iB; vIC = iC; vIInk = iInk; vID = iD;
      int sid = int(iShape + 0.5);
      vec3 sPos = texelFetch(uShapes, ivec2(gl_VertexID, sid * 2), 0).xyz;
      vec3 sNrm = texelFetch(uShapes, ivec2(gl_VertexID, sid * 2 + 1), 0).xyz;
      mat4 sModel = modelMatrix * instanceMatrix;
      ${body}`;
  f = `${FRAG_DEFINES}\n${f}`;
  return { vertexShader: v, fragmentShader: f };
}

interface Entry {
  proxy: Mesh;
  u: StoneUniforms;
  shape: number;
}

export class StoneBatch {
  readonly mesh: InstancedMesh;
  /** False: every stone draws itself as before (A/B parity checks, `__wdd.stoneBatch(false)`). */
  enabled = true;
  private readonly shapeOf = new Map<BufferGeometry, number>();
  private readonly entries: Entry[] = [];
  private readonly attrs: Record<'iCell' | 'iA' | 'iB' | 'iC' | 'iInk' | 'iD' | 'iShape', InstancedBufferAttribute>;
  private readonly index: ArrayLike<number> | null;
  private readonly vertexCount: number;
  private readonly ready: boolean;
  /** Stones drawn by the batch in the last frame (play-test report). */
  drawn = 0;

  constructor(shapes: BufferGeometry[], proto: ShaderMaterial) {
    const first = shapes[0];
    this.vertexCount = first.getAttribute('position').count;
    this.index = first.index?.array ?? null;
    const rows = shapes.length * 2;
    const data = new Float32Array(this.vertexCount * rows * 4);
    shapes.forEach((g, s) => {
      if (!this.sameTopology(g)) return;
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      for (let i = 0; i < this.vertexCount; i++) {
        data.set([p.getX(i), p.getY(i), p.getZ(i), 1], ((s * 2) * this.vertexCount + i) * 4);
        data.set([n.getX(i), n.getY(i), n.getZ(i), 0], ((s * 2 + 1) * this.vertexCount + i) * 4);
      }
      this.shapeOf.set(g, s);
    });
    const tex = new DataTexture(data, this.vertexCount, rows, RGBAFormat, FloatType);
    tex.minFilter = NearestFilter;
    tex.magFilter = NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    const shaders = instancedStoneShaders(proto.vertexShader, proto.fragmentShader);
    this.ready = shaders != null && this.shapeOf.size > 0;
    const material = new ShaderMaterial({
      uniforms: { ...proto.uniforms, uShapes: { value: tex } },
      vertexShader: shaders?.vertexShader ?? proto.vertexShader,
      fragmentShader: shaders?.fragmentShader ?? proto.fragmentShader,
    });
    linkShared(material);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute((first.getAttribute('position').array as Float32Array).slice(), 3));
    if (first.index != null) geometry.setIndex(new BufferAttribute((first.index.array as Uint32Array | Uint16Array).slice(), 1));
    const make = (size: number) => new InstancedBufferAttribute(new Float32Array(CAPACITY * size), size);
    this.attrs = { iCell: make(4), iA: make(4), iB: make(4), iC: make(4), iInk: make(4), iD: make(4), iShape: make(1) };
    for (const [name, a] of Object.entries(this.attrs)) geometry.setAttribute(name, a);
    this.mesh = new InstancedMesh(geometry, material, CAPACITY);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    this.mesh.raycast = () => {};
  }

  private sameTopology(g: BufferGeometry): boolean {
    if (g.getAttribute('position').count !== this.vertexCount || g.getAttribute('normal') == null) return false;
    const idx = g.index?.array ?? null;
    if ((idx == null) !== (this.index == null)) return false;
    if (idx == null || this.index == null) return true;
    if (idx.length !== this.index.length) return false;
    for (let i = 0; i < idx.length; i++) if (idx[i] !== this.index[i]) return false;
    return true;
  }

  /** A stone (or the Release weight) joins the batch; it stops drawing itself. False: not batchable, unchanged. */
  add(proxy: Mesh, u: StoneUniforms): boolean {
    const shape = this.shapeOf.get(proxy.geometry);
    if (!this.ready || shape == null) return false;
    this.entries.push({ proxy, u, shape });
    if (this.enabled) proxy.layers.set(HIDDEN_LAYER);
    return true;
  }

  remove(proxy: Mesh): void {
    const i = this.entries.findIndex((e) => e.proxy === proxy);
    if (i >= 0) this.entries.splice(i, 1);
  }

  /** A/B: the batch on (stones hidden from the cameras) or off (each stone draws itself as before). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    for (const e of this.entries) on ? e.proxy.layers.set(HIDDEN_LAYER) : e.proxy.layers.set(0);
  }

  /** Hooks the copy into the scene's render (after the matrices and the grab, before anything is drawn). */
  attach(scene: Scene): void {
    scene.add(this.mesh);
    const previous = scene.onBeforeRender;
    scene.onBeforeRender = (...args: Parameters<Scene['onBeforeRender']>) => {
      previous.apply(scene, args);
      this.sync();
    };
  }

  private shown(o: Object3D | null): boolean {
    for (let p = o; p != null; p = p.parent) if (!p.visible) return false;
    return true;
  }

  private readonly m = new Matrix4();

  sync(): void {
    let n = 0;
    if (this.enabled) {
      const a = this.attrs;
      for (const e of this.entries) {
        if (n >= CAPACITY) break;
        // A stone removed from the scene (disposed) or hidden is not drawn.
        if (e.proxy.parent == null || !this.shown(e.proxy)) continue;
        this.m.copy(e.proxy.matrixWorld);
        this.mesh.setMatrixAt(n, this.m);
        const u = e.u;
        const c = u.uCell.value;
        a.iCell.setXYZW(n, c.x, c.y, c.z, c.w);
        a.iA.setXYZW(n, u.uGlow.value, u.uDissolve.value, u.uDone.value, u.uWarm.value);
        a.iB.setXYZW(n, u.uBasalt.value, u.uEngraveGlow.value, u.uEngraveFade.value, u.uWaterY.value);
        const al = u.uAlbedo.value;
        a.iC.setXYZW(n, al.x, al.y, al.z, u.uSeed.value);
        const ink = u.uInk.value;
        a.iInk.setXYZW(n, ink.x, ink.y, ink.z, ink.w);
        a.iD.setXYZW(n, u.uKind.value.x, u.uKind.value.y, u.uLabel.value.x, u.uLabel.value.y);
        a.iShape.setX(n, e.shape);
        n++;
      }
      if (n > 0) {
        this.mesh.instanceMatrix.needsUpdate = true;
        for (const attr of Object.values(a)) attr.needsUpdate = true;
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.drawn = n;
  }

  get size(): number {
    return this.entries.length;
  }
}
