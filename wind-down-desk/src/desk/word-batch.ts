/**
 * Batched word chips (29 Oct, draw budget on Quest): the touch words (Unload's grid, Keep's good things, the bubbles,
 * the bead's Light / Some / Heavy, the night's minutes…) were up to 8 separate glass quads — one draw call each, so a
 * grid of words took the desk to 26 draws per eye (measured by tools/solidite-29oct). Now ONE instanced draw.
 *
 * Nothing else changes, by design (the stone batch's recipe):
 * - Each chip keeps its own Mesh, IWSDK entity and material: what the fingertip pokes, the ray hovers, the layout code
 *   moves and scales. Those meshes go to a layer no camera draws (HIDDEN_LAYER); pokes and rays ignore layers.
 * - Each chip's texture (drawWordChip) is copied once into a row of one atlas when its label changes; it is never
 *   uploaded on its own.
 * - Before each render (scene.onBeforeRender, after the matrices are updated), the batch copies each shown chip's
 *   world matrix, opacity and hover into per-instance attributes.
 * - The shader is the card shader itself (createCardMaterial), rewritten as text: same glass sheen, same hover lift,
 *   same high-contrast mode. A rewrite that fails leaves the chips drawing themselves, as before.
 */
import {
  CanvasTexture,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  ShaderMaterial,
  type BufferGeometry,
  type Mesh,
  type Object3D,
  type Scene,
  type Texture,
} from '@iwsdk/core';
import { CARD_CONTRAST, createCardMaterial, type CardUniforms } from './materials.ts';
import { HIDDEN_LAYER } from './stone-batch.ts';
import { TEXT_SCALE, WIDE_CHIP } from './text-canvas.ts';
import { instancedCardShaders } from './word-batch-shader.ts';

export interface BatchedChip {
  mesh: Mesh;
  uniforms: CardUniforms;
  label: string | null;
}

/** Pixels between atlas rows (mipmaps on the desktop player must not bleed a row into the next). */
const PAD = 8;

export class WordBatch {
  readonly mesh: InstancedMesh;
  readonly ready: boolean;
  private enabled = true;
  private readonly atlas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly texture: CanvasTexture;
  private readonly cellW: number;
  private readonly cellH: number;
  /** The texture each chip's atlas row was drawn from (a new one = its label changed). */
  private readonly drawnFrom: Array<Texture | null>;
  /** Each chip's UV rectangle in the atlas (u0, v0, u1, v1). */
  private readonly rects: Float32Array;
  private readonly iRect: InstancedBufferAttribute;
  private readonly iFade: InstancedBufferAttribute;
  /** Chips drawn by the batch in the last frame (tests). */
  drawn = 0;

  constructor(
    private readonly chips: BatchedChip[],
    geometry: BufferGeometry,
  ) {
    const n = chips.length;
    // One row per chip, as wide as a wide chip (drawWordChip: 768 × 228 logical, drawn at half size × TEXT_SCALE).
    this.cellW = Math.ceil((Math.round(768 * WIDE_CHIP) / 2) * TEXT_SCALE);
    this.cellH = Math.ceil(114 * TEXT_SCALE);
    this.atlas = document.createElement('canvas');
    this.atlas.width = this.cellW;
    this.atlas.height = n * (this.cellH + PAD);
    this.ctx = this.atlas.getContext('2d');
    const mipmaps = TEXT_SCALE > 1;
    this.texture = new CanvasTexture(this.atlas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = mipmaps ? 8 : 4;
    this.texture.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
    this.texture.generateMipmaps = mipmaps;
    this.drawnFrom = new Array<Texture | null>(n).fill(null);
    this.rects = new Float32Array(n * 4);
    const proto = createCardMaterial(this.texture);
    const shaders = instancedCardShaders(proto.vertexShader, proto.fragmentShader);
    this.ready = shaders != null && this.ctx != null;
    const material = new ShaderMaterial({
      transparent: proto.transparent,
      depthWrite: proto.depthWrite,
      side: proto.side,
      uniforms: { uMap: { value: this.texture }, uContrast: CARD_CONTRAST },
      vertexShader: shaders?.vertexShader ?? proto.vertexShader,
      fragmentShader: shaders?.fragmentShader ?? proto.fragmentShader,
    });
    proto.dispose();
    const g = geometry.clone();
    this.iRect = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.iFade = new InstancedBufferAttribute(new Float32Array(n * 2), 2);
    g.setAttribute('iRect', this.iRect);
    g.setAttribute('iFade', this.iFade);
    this.mesh = new InstancedMesh(g, material, n);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    this.mesh.raycast = () => {};
    this.mesh.name = 'wdd-word-batch';
    if (this.ready) for (const c of chips) c.mesh.layers.set(HIDDEN_LAYER);
  }

  /** A/B and safety: on (one draw) or off (each chip draws itself as before). */
  setEnabled(on: boolean): void {
    this.enabled = on && this.ready;
    for (const c of this.chips) c.mesh.layers.set(this.enabled ? HIDDEN_LAYER : 0);
    if (!this.enabled) {
      this.mesh.visible = false;
      this.mesh.count = 0;
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Hooks the copy into the scene's render (after the matrices are updated, before anything is drawn). */
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

  /** Copies chip i's own texture (its canvas) into its atlas row; its UV rectangle follows the canvas size. */
  private drawRow(i: number, map: Texture): void {
    const ctx = this.ctx;
    const img = (map as { image?: CanvasImageSource & { width: number; height: number } }).image;
    const y = i * (this.cellH + PAD);
    if (ctx == null || img == null) return;
    const w = Math.min(this.cellW, img.width);
    const h = Math.min(this.cellH, img.height);
    ctx.clearRect(0, y, this.cellW, this.cellH + PAD);
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, y, w, h);
    // flipY: canvas row 0 is the top of the texture (v = 1).
    const H = this.atlas.height;
    this.rects.set([0, 1 - (y + h) / H, w / this.cellW, 1 - y / H], i * 4);
    this.texture.needsUpdate = true;
  }

  sync(): void {
    let n = 0;
    if (this.enabled) {
      this.chips.forEach((c, i) => {
        const map = c.uniforms.uMap.value;
        if (c.label == null || !this.shown(c.mesh)) return;
        if (map !== this.drawnFrom[i]) {
          this.drawRow(i, map);
          this.drawnFrom[i] = map;
        }
        this.mesh.setMatrixAt(n, c.mesh.matrixWorld);
        this.iRect.setXYZW(n, this.rects[i * 4], this.rects[i * 4 + 1], this.rects[i * 4 + 2], this.rects[i * 4 + 3]);
        this.iFade.setXY(n, c.uniforms.uOpacity.value, c.uniforms.uHighlight.value);
        n++;
      });
      if (n > 0) {
        this.mesh.instanceMatrix.needsUpdate = true;
        this.iRect.needsUpdate = true;
        this.iFade.needsUpdate = true;
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.drawn = n;
  }
}
