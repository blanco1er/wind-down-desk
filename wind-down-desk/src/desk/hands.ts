/**
 * Hands, the Meta way (23 Oct, owner after trying a Quest: "Meta's hands don't look like the ones in our videos").
 *
 * What IWSDK 1.0.1 draws by default for tracked hands (on a Quest exactly as in the IWER emulator): an invisible
 * "stencil" hand (alpha 0 + depth, so your REAL hand shows through passthrough even in front of the tray) and a
 * white outline shell. HandLook keeps the useful part and restyles the rest, at no extra draw call:
 *   - passthrough ("Table stays", your room): your real hands via the cameras, with only a faint warm rim;
 *   - Full (a place, no passthrough): soft translucent hands, warm-white with a fresnel rim, fading at the wrist —
 *     like Horizon OS system hands; the stencil is hidden (24 Oct: written as depth only, it was drawn before the
 *     scene and left a dark hand-shaped hole of the clear colour — the "brown silhouette" in the captures).
 * GhostHand: the same hand model, cloned, more transparent, animated between IWER's relaxed and pinch poses —
 * the onboarding demonstration of "pinch a stone, drop it in a bowl".
 */
import { AdditiveBlending, Euler, Group, Matrix4, Quaternion, ShaderMaterial, Vector3, type Bone, type Object3D, type SkinnedMesh, type World } from '@iwsdk/core';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { HAND_JOINTS, MIRROR_TO_RIGHT, PINCH, RELAXED } from './hand-poses.ts';

export function createSoftHandMaterial(
  additive = false,
): ShaderMaterial & { uniforms: { uBody: { value: number }; uRim: { value: number }; uAlpha: { value: number } } } {
  const material = new ShaderMaterial({
    uniforms: { uBody: { value: 0.22 }, uRim: { value: 0.5 }, uAlpha: { value: 1 } },
    // The guide hand only ADDS light (it can never darken the table); the person's own hands blend normally.
    blending: additive ? AdditiveBlending : undefined,
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      attribute float wristDist;
      varying float vWristDist;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        #include <skinbase_vertex>
        #include <beginnormal_vertex>
        #include <skinnormal_vertex>
        #include <defaultnormal_vertex>
        vec3 transformed = vec3(position);
        #include <skinning_vertex>
        vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mv;
        vN = normalize(transformedNormal);
        vV = normalize(-mv.xyz);
        vWristDist = wristDist;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uBody;
      uniform float uRim;
      uniform float uAlpha;
      varying float vWristDist;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(f, 2.2);
        float fade = smoothstep(0.03, 0.09, vWristDist);
        float a = (uBody + uRim * rim) * fade * uAlpha;
        if (a < 0.003) discard;
        // Warm white, a little paler amber at the rim.
        gl_FragColor = vec4(mix(vec3(1.0, 0.95, 0.88), vec3(1.0, 0.86, 0.66), rim) * (0.85 + 0.35 * rim), a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  return material as ReturnType<typeof createSoftHandMaterial>;
}

interface Styled {
  stencil: SkinnedMesh;
  shell: SkinnedMesh;
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

export class HandLook {
  private readonly material = createSoftHandMaterial();
  private readonly styled = new Map<Object3D, Styled>();
  private full = -1;
  /** A live hand model (for the ghost): the right one if seen. */
  source: { model: Object3D; side: 'left' | 'right' } | null = null;

  /** Call every frame (cheap: two lookups, materials swapped only when a model appears or the mode changes). */
  update(world: World, full: boolean): void {
    const a = adapters(world);
    if (a == null) return;
    let changed = false;
    for (const side of ['right', 'left'] as const) {
      const model = a.hand[side]?.visual?.model;
      if (model == null || this.styled.has(model)) continue;
      const m = handMeshes(model);
      if (m == null) continue;
      this.styled.set(model, { stencil: m.stencil, shell: m.shell });
      m.shell.material = this.material;
      if (this.source == null || side === 'right') this.source = { model, side };
      changed = true;
    }
    const f = full ? 1 : 0;
    if (f === this.full && !changed) return;
    this.full = f;
    // Passthrough: real hands (stencil punches through), a faint warm rim. Full: soft translucent hands.
    this.material.uniforms.uBody.value = full ? 0.2 : 0;
    this.material.uniforms.uRim.value = full ? 0.5 : 0.3;
    for (const s of this.styled.values()) s.stencil.visible = !full;
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

/** Base orientation (Euler YXZ, radians) of the ghost hand in desk space, tuned in the emulator. */
const GHOST_BASE: [number, number, number] = [-Math.PI / 2, 0, 0];

export class GhostHand {
  readonly root = new Group();
  private readonly material = createSoftHandMaterial(true);
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
    meshes.stencil.visible = false;
    meshes.shell.material = this.material;
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
    // 24 Oct (coordinator): a light, luminous guide, ~35–45 % at its brightest, soft fresnel edge, no hard outline.
    this.material.uniforms.uAlpha.value = alpha;
    this.material.uniforms.uBody.value = 0.3;
    this.material.uniforms.uRim.value = 0.45;
    this.root.visible = alpha > 0.01;
  }

  hide(): void {
    this.root.visible = false;
  }
}
