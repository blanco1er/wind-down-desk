/**
 * Hands, the Meta way (28 Oct; replaces the warm "glass" hands of 23–24 Oct, owner: "not at all like a Quest 3").
 *
 * The rules and numbers live in logic/hand-look.ts (with their sources). What is drawn, per hand, with the SAME two
 * draw calls IWSDK already spends (its stencil hand and its outline shell, restyled in place):
 *   - the fill: Meta's two dark greys blended by fresnel, translucent, fading out toward the wrist. In passthrough it
 *     is only a faint tint over your real hand (stronger near a stone or while pinching), and it is drawn before the
 *     desk so that, like IWSDK's stencil, it keeps your real hand in front of the tray. In Full immersion it is
 *     Meta's VR hand (0.79 opaque).
 *   - the outline: a thin translucent light grey edge (inset fill + back faces of the shell), fading at the wrist;
 *     the fingers that pinch or curl turn white (Meta's progress feedback).
 * GhostHand (onboarding: "pinch a stone, drop it in a bowl"): the same Meta hand (fill + outline), cloned, lighter,
 * animated between IWER's relaxed and pinch poses; its thumb and index outline light up as it pinches. Two draw calls,
 * only during the first minute (a single-mesh version with a fresnel "outline" read as glass on thin fingers).
 */
import {
  BackSide,
  BufferAttribute,
  Euler,
  FrontSide,
  Group,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
  Vector4,
  type Bone,
  type BufferGeometry,
  type Object3D,
  type SkinnedMesh,
  type World,
} from '@iwsdk/core';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { curlStrength, fillOpacity, fingerOfJoint, handStage, META_HAND, pinchStrength, type HandStage } from '../logic/hand-look.ts';
import { HAND_JOINTS, MIRROR_TO_RIGHT, PINCH, RELAXED } from './hand-poses.ts';

const v3 = (c: readonly number[]) => `vec3(${c.map((x) => x.toFixed(4)).join(', ')})`;

/** Shared GLSL: Meta's fill colour and the wrist fade. */
const META_GLSL = /* glsl */ `
  const vec3 FILL_FACE = ${v3(META_HAND.fillFace)};
  const vec3 FILL_EDGE = ${v3(META_HAND.fillEdge)};
  const vec3 OUTLINE = ${v3(META_HAND.outline)};
  const vec3 OUTLINE_LIT = ${v3(META_HAND.outlineLit)};
  vec3 metaFill(vec3 n, vec3 v) {
    float f = pow(1.0 - clamp(abs(dot(normalize(n), normalize(v))), 0.0, 1.0), ${META_HAND.fresnelPower.toFixed(2)});
    return mix(FILL_FACE, FILL_EDGE, f);
  }
  float wristFade(float d) { return smoothstep(${META_HAND.wristFade[0].toFixed(3)}, ${META_HAND.wristFade[1].toFixed(3)}, d); }
`;

const SKIN_VERTEX_HEAD = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  attribute float wristDist;
  attribute vec4 fingerW;
  uniform vec4 uGlow;
  varying float vWristDist;
  varying float vGlow;
  varying vec3 vN;
  varying vec3 vV;
`;

function skinnedVertex(offset: string): string {
  return /* glsl */ `
    ${SKIN_VERTEX_HEAD}
    uniform float uInset;
    void main() {
      #include <skinbase_vertex>
      #include <beginnormal_vertex>
      #include <skinnormal_vertex>
      #include <defaultnormal_vertex>
      vec3 transformed = ${offset};
      #include <skinning_vertex>
      vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
      gl_Position = projectionMatrix * mv;
      vN = normalize(transformedNormal);
      vV = normalize(-mv.xyz);
      vWristDist = wristDist;
      vGlow = clamp(dot(fingerW, uGlow), 0.0, 1.0);
    }
  `;
}

type FillMaterial = ShaderMaterial & { uniforms: { uOpacity: { value: number }; uInset: { value: number }; uGlow: { value: Vector4 } } };
type OutlineMaterial = ShaderMaterial & { uniforms: { uAlpha: { value: number }; uFade: { value: number }; uInset: { value: number }; uGlow: { value: Vector4 } } };
/** Meta's fill: two dark greys by fresnel, translucent, fading at the wrist; inset under the outline shell. */
export function createFillMaterial(): FillMaterial {
  return new ShaderMaterial({
    uniforms: { uOpacity: { value: META_HAND.vrOpacity }, uInset: { value: META_HAND.insetMetres }, uGlow: { value: new Vector4() } },
    vertexShader: skinnedVertex('position - normal * uInset'),
    fragmentShader: /* glsl */ `
      ${META_GLSL}
      uniform float uOpacity;
      varying float vWristDist;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float a = uOpacity * wristFade(vWristDist);
        if (a < 0.002) discard;
        gl_FragColor = vec4(metaFill(vN, vV), a);
      }
    `,
    side: FrontSide,
    transparent: true,
    // Writes depth like IWSDK's stencil: in passthrough (drawn first) it keeps the real hand in front of the desk;
    // elsewhere it hides the shell's back faces so only a thin rim of outline remains.
    depthWrite: true,
    depthTest: true,
  }) as FillMaterial;
}

/** Meta's outline: translucent light grey back faces around the inset fill; pinching / curling fingers turn white. */
export function createOutlineMaterial(): OutlineMaterial {
  return new ShaderMaterial({
    uniforms: { uAlpha: { value: 0.85 }, uFade: { value: 1 }, uInset: { value: 0 }, uGlow: { value: new Vector4() } },
    vertexShader: skinnedVertex('position + normal * uInset'),
    fragmentShader: /* glsl */ `
      ${META_GLSL}
      uniform float uAlpha;
      uniform float uFade;
      varying float vWristDist;
      varying float vGlow;
      void main() {
        float a = mix(uAlpha, 1.0, vGlow) * wristFade(vWristDist) * uFade;
        if (a < 0.002) discard;
        gl_FragColor = vec4(mix(OUTLINE, OUTLINE_LIT, vGlow), a);
      }
    `,
    side: BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  }) as OutlineMaterial;
}

/**
 * Per-vertex finger weights (thumb, index, middle, ring + little) from the skinning weights, once per geometry, so a
 * finger's outline can light up on its own. Also adds `wristDist` if IWSDK has not (a clone keeps both).
 */
export function ensureHandAttributes(mesh: SkinnedMesh): void {
  const g = mesh.geometry as BufferGeometry;
  if (g.getAttribute('fingerW') != null) return;
  const bones = mesh.skeleton.bones;
  const finger = bones.map((b) => fingerOfJoint(b.name));
  const index = g.getAttribute('skinIndex');
  const weight = g.getAttribute('skinWeight');
  const n = g.getAttribute('position').count;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) {
      const f = finger[index.getComponent(i, k)] ?? -1;
      if (f >= 0) out[i * 4 + f] += weight.getComponent(i, k);
    }
  }
  g.setAttribute('fingerW', new BufferAttribute(out, 4));
  if (g.getAttribute('wristDist') == null) {
    const wrist = bones.find((b) => b.name === 'wrist');
    const d = new Float32Array(n);
    const w = new Vector3();
    if (wrist != null) {
      // Bind-pose wrist in the mesh's local space (as IWSDK computes it).
      const bindWorld = new Matrix4().copy(mesh.skeleton.boneInverses[bones.indexOf(wrist)]).invert();
      w.setFromMatrixPosition(bindWorld).applyMatrix4(mesh.bindMatrixInverse);
    }
    const p = g.getAttribute('position');
    for (let i = 0; i < n; i++) d[i] = Math.hypot(p.getX(i) - w.x, p.getY(i) - w.y, p.getZ(i) - w.z);
    g.setAttribute('wristDist', new BufferAttribute(d, 1));
  }
}

interface Styled {
  side: 'left' | 'right';
  model: Object3D;
  fill: SkinnedMesh;
  shell: SkinnedMesh;
  fillMaterial: FillMaterial;
  outlineMaterial: OutlineMaterial;
  thumbTip: Object3D | null;
  indexTip: Object3D | null;
  wrist: Object3D | null;
  longTips: Object3D[];
  near: number;
  pinch: number;
}

type Adapters = { hand: Record<'left' | 'right', { visual?: { model?: Object3D } }> };

function adapters(world: World): Adapters | null {
  return ((world.input as unknown as { xr?: { visualAdapters?: Adapters } }).xr?.visualAdapters ?? null) as Adapters | null;
}

/** The two skinned meshes IWSDK builds per hand: the stencil (renderOrder 0) and the outline shell (999). */
function handMeshes(model: Object3D): { stencil: SkinnedMesh; shell: SkinnedMesh } | null {
  const meshes: SkinnedMesh[] = [];
  model.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh);
  });
  if (meshes.length < 2) return null;
  const shell = meshes.find((m) => m.renderOrder === 999) ?? meshes[1];
  const stencil = meshes.find((m) => m !== shell) ?? meshes[0];
  return { stencil, shell };
}

/** Render order of the fill: before the desk in passthrough (keeps the real hand in front), else after it. */
const FILL_ORDER: Record<HandStage, number> = { passthrough: 0, simulated: 990, vr: 990 };

export class HandLook {
  private readonly styled: Styled[] = [];
  private readonly seen = new Set<Object3D>();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  stage: HandStage = 'passthrough';
  /** A live hand model (for the ghost): the right one if seen. */
  source: { model: Object3D; side: 'left' | 'right' } | null = null;

  /** How near each hand's index tip is to something it can take (0..1), written by the ritual system. */
  setNear(side: 'left' | 'right', near: number): void {
    for (const s of this.styled) if (s.side === side) s.near = near;
  }

  /** Call every frame: styles new hand models once, then a few uniforms (pinch, curl, opacity). */
  update(world: World, full: boolean, emulated: boolean): void {
    const a = adapters(world);
    if (a == null) return;
    for (const side of ['right', 'left'] as const) {
      const model = a.hand[side]?.visual?.model;
      if (model == null || this.seen.has(model)) continue;
      const m = handMeshes(model);
      if (m == null) continue;
      this.seen.add(model);
      ensureHandAttributes(m.stencil);
      const fillMaterial = createFillMaterial();
      const outlineMaterial = createOutlineMaterial();
      m.stencil.material = fillMaterial;
      m.shell.material = outlineMaterial;
      m.shell.renderOrder = 999;
      const named = (n: string) => model.getObjectByName(n) ?? null;
      this.styled.push({
        side,
        model,
        fill: m.stencil,
        shell: m.shell,
        fillMaterial,
        outlineMaterial,
        thumbTip: named('thumb-tip'),
        indexTip: named('index-finger-tip'),
        wrist: named('wrist'),
        longTips: ['middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'].map(named).filter((o): o is Object3D => o != null),
        near: 0,
        pinch: 0,
      });
      if (this.source == null || side === 'right') this.source = { model, side };
    }
    this.stage = handStage(full, emulated);
    for (const s of this.styled) {
      if (!s.model.visible) continue;
      let pinch = 0;
      let curl = 0;
      // Joint positions from last frame's world matrices (no parent-chain update: ~free).
      if (s.thumbTip != null && s.indexTip != null) {
        pinch = pinchStrength(this.a.setFromMatrixPosition(s.thumbTip.matrixWorld).distanceTo(this.b.setFromMatrixPosition(s.indexTip.matrixWorld)));
      }
      if (s.wrist != null && s.longTips.length > 0) {
        this.a.setFromMatrixPosition(s.wrist.matrixWorld);
        let sum = 0;
        for (const t of s.longTips) sum += this.b.setFromMatrixPosition(t.matrixWorld).distanceTo(this.a);
        curl = curlStrength(sum / s.longTips.length);
      }
      s.pinch = pinch;
      // Meta's progress feedback: the pinching fingers (thumb, index), or all of them for a grab, turn white.
      const g = s.outlineMaterial.uniforms.uGlow.value;
      g.set(Math.max(pinch, curl), Math.max(pinch, curl), curl, curl);
      s.fillMaterial.uniforms.uOpacity.value = fillOpacity(this.stage, s.near, pinch);
      s.fill.renderOrder = FILL_ORDER[this.stage];
      s.fill.visible = true;
    }
  }

  /** For tools: the current per-hand values. */
  snapshot(): Array<{ side: string; stage: HandStage; opacity: number; pinch: number; near: number; order: number }> {
    return this.styled.map((s) => ({
      side: s.side,
      stage: this.stage,
      opacity: s.fillMaterial.uniforms.uOpacity.value,
      pinch: s.pinch,
      near: s.near,
      order: s.fill.renderOrder,
    }));
  }
}

/** Decomposed joint poses (mirrored for the right hand), for allocation-free blending. */
function decompose(pose: readonly (readonly number[])[], right: boolean): Array<{ p: Vector3; q: Quaternion }> {
  const m = new Matrix4();
  return pose.map((arr) => {
    const e = right ? arr.map((v, i) => v * MIRROR_TO_RIGHT[i]) : [...arr];
    m.fromArray(e);
    const p = new Vector3();
    const q = new Quaternion();
    m.decompose(p, q, new Vector3());
    return { p, q };
  });
}

/** The guide's fill opacity at full presence (your own hand in the room: 0.3 to 0.55). */
const GHOST_FILL = 0.45;

/** Base orientation (Euler YXZ, radians) of the ghost hand in desk space, tuned in the emulator. */
const GHOST_BASE: [number, number, number] = [-Math.PI / 2, 0, 0];

export class GhostHand {
  readonly root = new Group();
  private readonly fillMaterial = createFillMaterial();
  private readonly outlineMaterial = createOutlineMaterial();
  private bones: Array<Bone | null> = [];
  private relaxed: Array<{ p: Vector3; q: Quaternion }> = [];
  private pinch: Array<{ p: Vector3; q: Quaternion }> = [];
  /** Pinch point (between thumb and index tips) in the hand's own space, pinched pose. */
  private readonly pinchPoint = new Vector3();
  /** The hand's base orientation in desk space (fingers away from you, palm toward the table), then the desk yaw. */
  private readonly base = new Quaternion();
  private readonly yawQ = new Quaternion();
  private readonly tmp = new Vector3();
  private static readonly UP = new Vector3(0, 1, 0);
  ready = false;

  constructor(world: World) {
    this.root.visible = false;
    this.root.renderOrder = 998;
    world.scene.add(this.root);
  }

  /** Builds the ghost from a live hand model (once). */
  build(source: { model: Object3D; side: 'left' | 'right' }): boolean {
    if (this.ready) return true;
    const clone = cloneSkinned(source.model);
    const meshes = handMeshes(clone);
    if (meshes == null) return false;
    ensureHandAttributes(meshes.shell);
    meshes.stencil.material = this.fillMaterial;
    meshes.stencil.frustumCulled = false;
    meshes.stencil.renderOrder = 997;
    meshes.stencil.visible = true;
    meshes.shell.material = this.outlineMaterial;
    meshes.shell.frustumCulled = false;
    meshes.shell.renderOrder = 998;
    clone.position.set(0, 0, 0);
    clone.quaternion.identity();
    clone.visible = true;
    this.root.add(clone);
    this.bones = HAND_JOINTS.map((n) => (clone.getObjectByName(n) as Bone | undefined) ?? null);
    const right = source.side === 'right';
    this.relaxed = decompose(RELAXED, right);
    this.pinch = decompose(PINCH, right);
    const thumb = HAND_JOINTS.indexOf('thumb-tip');
    const index = HAND_JOINTS.indexOf('index-finger-tip');
    this.pinchPoint.copy(this.pinch[thumb].p).add(this.pinch[index].p).multiplyScalar(0.5);
    let e = GHOST_BASE;
    if (import.meta.env.DEV) {
      try {
        const tuned = JSON.parse(localStorage.getItem('tune.ghost') ?? 'null') as [number, number, number] | null;
        if (tuned != null) e = tuned;
      } catch {
        // No tuning.
      }
    }
    this.base.setFromEuler(new Euler(e[0], e[1], e[2], 'YXZ'));
    this.ready = true;
    return true;
  }

  /**
   * Shows the ghost with its pinch point at `at` (world), turned by `yaw` (desk yaw: fingers toward the far side),
   * pinch 0..1, opacity 0..1.
   */
  pose(at: Vector3, yaw: number, pinch: number, alpha: number): void {
    if (!this.ready) return;
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      if (b == null) continue;
      b.position.lerpVectors(this.relaxed[i].p, this.pinch[i].p, pinch);
      b.quaternion.slerpQuaternions(this.relaxed[i].q, this.pinch[i].q, pinch);
      b.updateMatrix();
    }
    this.yawQ.setFromAxisAngle(GhostHand.UP, yaw);
    this.root.quaternion.copy(this.yawQ).multiply(this.base);
    // Put the pinch point (thumb/index, pinched pose) exactly on the target.
    this.root.position.copy(this.tmp.copy(this.pinchPoint).applyQuaternion(this.root.quaternion)).negate().add(at);
    // A guide, lighter than your own hand: Meta's fill at half strength, its outline; thumb and index light up as
    // it pinches (the same feedback your own hand gives).
    this.fillMaterial.uniforms.uOpacity.value = GHOST_FILL * alpha;
    this.outlineMaterial.uniforms.uFade.value = alpha;
    this.outlineMaterial.uniforms.uGlow.value.set(pinch, pinch, 0, 0);
    this.root.visible = alpha > 0.01;
  }

  hide(): void {
    this.root.visible = false;
  }
}
