/**
 * Player mode (dev only): play the evening on a Mac with a mouse, like a product, not like a developer.
 *
 * Loaded only by `npm run playtest` (VITE_WDD_PLAYTEST=1) or `?player=1`, and only when the IWER emulator is present:
 * never in `dist/`, never on a Quest. `?dev=1` keeps the raw IWER developer UI instead.
 *
 * - Hides the IWER DevUI chrome (controller panels, axis gizmos, toolbar, "Enter XR" pill) with its own handles
 *   (`devui.devUIContainer`, `devui.devUICanvas`) and takes the device in `programmatic` control, so the DevUI stops
 *   writing its gizmo transforms into the headset and the hands every frame.
 * - Emulated HANDS (not controllers): IWSDK draws them as hand outlines, like Quest system hands. They rest out of
 *   view and come in only to pick, carry and drop a stone (the real IWSDK pinch-grab path).
 * - Seated camera: framed on the tray (bowls, lamp, caption), smooth limited look-around (drag, arrows), wheel zoom,
 *   R to recenter. Retina: the emulator canvas is rendered at devicePixelRatio (cap 2) instead of 1 CSS px.
 * - Mouse: click a stone then a bowl (or drag it there); glass buttons/menus are clicked through IWSDK's own canvas
 *   pointer path (CanvasPointerSystem, activeDuringXR); clicking the lamp starts dictation.
 */
import { CanvasPointerSystem, Quaternion, Vector3, type World } from '@iwsdk/core';
import { createDeskLayout, deskToWorld, type DeskFrame } from '../logic/desk-layout.ts';

type V3 = { x: number; y: number; z: number };
type Bin = 'tomorrow' | 'later' | 'let-go';
interface Hand {
  position: { set(x: number, y: number, z: number): void; x: number; y: number; z: number };
  quaternion: { set(x: number, y: number, z: number, w: number): void };
  updatePinchValue(v: number): void;
  connected?: boolean;
}
interface Device {
  controlMode: 'manual' | 'programmatic';
  primaryInputMode: 'controller' | 'hand';
  stereoEnabled: boolean;
  fovy: number;
  position: { set(x: number, y: number, z: number): void };
  quaternion: { set(x: number, y: number, z: number, w: number): void };
  hands: { left: Hand; right: Hand };
  appCanvas?: HTMLCanvasElement;
  activeSession?: unknown;
  devui?: { devUIContainer: HTMLElement; devUICanvas: HTMLCanvasElement; render(t: number): void };
  sem?: { environmentCanvas: HTMLCanvasElement; render(t: number): void };
  onControlModeChange(cb: (m: string) => void): () => void;
}
interface Wdd {
  state(): { frame: DeskFrame | null; placement: string | null; tokens: Array<{ id: string; text: string; bin: string | null; released: boolean }> };
  stoneWorld(id: string): V3 | null;
  binWorld(bin: Bin): V3 | null;
  weightWorld(): V3 | null;
  waterWorld(up?: number): V3 | null;
  evening(): { mode: string; weight: { held: boolean } | null };
  debug(): { stones: Map<string, { id: string; mesh: { position: V3 }; dissolving: number }> };
  film?: { grade(night?: number, blur?: number): unknown };
  pickButton?(ndcX: number, ndcY: number): string | null;
  hoverButton?(ndcX: number | null, ndcY?: number): string | null;
  press?(action: string): void;
}

const g = window as unknown as { __wdd?: Wdd; IWER_DEVICE?: Device; __wddPlayer?: unknown };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const BINS: Bin[] = ['tomorrow', 'later', 'let-go'];
const BIN_FR: Record<Bin, string> = { tomorrow: 'Tomorrow', later: 'Later', 'let-go': 'Let go' };

/** Player mode is on for `npm run playtest` and `?player=1`; `?dev=1` (or `?player=0`) keeps the raw emulator. */
export function playerModeWanted(search = location.search, playtest = import.meta.env.VITE_WDD_PLAYTEST === '1'): boolean {
  const p = new URLSearchParams(search);
  if (p.get('dev') === '1' || p.get('player') === '0') return false;
  return playtest || p.get('player') === '1';
}

// Seated framing, desk-local (+Z faces the user): eyes above the front edge, looking at the bowls.
const EYE = { x: 0.06, y: 0.5, z: 0.66 };
const LOOK = { x: 0.06, y: 0.04, z: -0.1 };
const FOV = { base: 58, min: 34, max: 74 };
const LOOK_LIMIT = { yaw: 0.85, up: 0.55, down: 0.3 };
// Hands rest just below the field of view and come in to act.
const REST: Record<'left' | 'right', V3> = { left: { x: -0.2, y: 0.02, z: 0.5 }, right: { x: 0.2, y: 0.02, z: 0.5 } };

export interface PlayerApi {
  readonly holding: string | null;
  readonly busy: boolean;
  /** Screen position (CSS px) of a world point, from the player camera. */
  screenOf(p: V3): { x: number; y: number } | null;
  /** Screen position of a stone / bowl / the water / the lamp (for tests that click with the real mouse). */
  target(kind: 'stone' | 'bin' | 'weight' | 'water' | 'lamp', id?: string): { x: number; y: number } | null;
  recenter(): void;
  look(yaw: number, pitch: number): void;
  view(): { yaw: number; pitch: number; fov: number; scale: number; frameMs: number };
  onStatus: ((text: string) => void) | null;
  onLamp: (() => void) | null;
  /** Width (CSS px) of the panel on the left: the view leans so the tray sits in the free area. */
  setLeftInset(px: number): void;
}

export function mountPlayer(world: World): PlayerApi | null {
  const d = g.__wdd;
  const dev = g.IWER_DEVICE;
  if (d == null || dev == null) return null;
  const layout = createDeskLayout();

  // ---------------------------------------------------------------- the emulator, as a product
  dev.primaryInputMode = 'hand';
  dev.stereoEnabled = false;
  const take = () => {
    if (dev.controlMode !== 'programmatic') dev.controlMode = 'programmatic';
  };
  take();
  // The IWSDK agent bridge may take and release the device (it sets 'manual' when done): take it back.
  dev.onControlModeChange((m) => {
    if (m === 'manual') queueMicrotask(take);
  });
  const hideChrome = () => {
    if (dev.devui != null) {
      dev.devui.devUIContainer.style.display = 'none';
      dev.devui.devUICanvas.style.display = 'none';
    }
    // IWER's "Enter XR" pill is a shadow-root host appended to <body> (the landing page has its own button).
    for (const el of Array.from(document.body.children)) {
      if (el instanceof HTMLElement && el.shadowRoot != null && el.id !== 'wdd-playtest' && !el.dataset.wddKeep) el.style.display = 'none';
    }
  };
  hideChrome();
  // Hidden layers must not cost frames: the DevUI gizmo scene (drawn every frame into its own full-screen canvas) and,
  // once the photographic film-set room covers it, the emulator's synthetic room (its canvas follows ours, at 2x
  // the pixel ratio again). Plane data for the table stays: only their drawing stops.
  if (dev.devui != null) dev.devui.render = () => {};
  const quietRoom = () => {
    if (dev.sem == null || d.film == null || dev.sem.environmentCanvas.style.display === 'none') return;
    dev.sem.render = () => {};
    dev.sem.environmentCanvas.style.display = 'none';
  };
  quietRoom();
  // Glass buttons and menus: IWSDK's own mouse path into the scene, kept on during the (emulated) session.
  const cps = world.getSystem(CanvasPointerSystem);
  // 29 Oct: the glass buttons are clicked through the desk's own pick at the click's exact point (pickButton below),
  // not the pointer library — it resolved a quick click on the last frame's hover (› fired ‹ on a busy Mac).
  const ownPick = typeof d.pickButton === 'function' && typeof d.press === 'function';
  if (cps != null) (cps.config.activeDuringXR as { value: boolean }).value = !ownPick;
  // 29 Oct (owner: "the buttons don't work", ‹ › ✕ of the globe): the emulated Quest keeps its 63 mm IPD while the
  // screen shows ONE centred view, so the mouse ray left from an eye 3 cm aside — every hit zone sat ≈ 25 px off its
  // button (big chips still caught it, small round buttons never). One eye at the centre: the ray is the view.
  (dev as Device & { ipd?: number }).ipd = 0;

  // ---------------------------------------------------------------- camera
  let frame: DeskFrame | null = null;
  let frameKey = '';
  const view = { yaw: 0, pitch: 0, fov: FOV.base, tYaw: 0, tPitch: 0, tFov: FOV.base };
  let leftInset = 0;
  const eye = new Vector3();
  const cam = new Vector3();
  const q = new Quaternion();
  const qa = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const right = new Vector3(1, 0, 0);
  const tmp = new Vector3();
  let baseYaw = 0;
  let basePitch = -0.62;

  // Before the desk exists (landing → session start): a seated head, looking down at a table.
  dev.position.set(0, 1.2, 0);
  qa.setFromAxisAngle(right, -0.42);
  dev.quaternion.set(qa.x, qa.y, qa.z, qa.w);

  const aspect = () => window.innerWidth / Math.max(1, window.innerHeight);
  let reach = 0.75; // eye → look point (m)
  /** Sideways shift (m) so the tray sits in the middle of the area the panel leaves free (the tray stays square-on). */
  const lean = () => {
    if (leftInset <= 0) return 0;
    const ndc = leftInset / window.innerWidth; // centre of the free area, in NDC
    return ndc * reach * Math.tan(((view.fov * Math.PI) / 180) / 2) * aspect();
  };

  let glideFrom: { x: number; y: number; z: number; yaw: number; pitch: number; t: number } | null = null;
  const applyFrame = (f: DeskFrame) => {
    // A desk that moves ("move the desk") is followed with a short ease, never a jump.
    if (frame != null) glideFrom = { x: eye.x, y: eye.y, z: eye.z, yaw: baseYaw, pitch: basePitch, t: performance.now() };
    frame = f;
    const e = deskToWorld(f, EYE);
    const l = deskToWorld(f, LOOK);
    eye.set(e.x, e.y, e.z);
    const dx = l.x - e.x;
    const dy = l.y - e.y;
    const dz = l.z - e.z;
    baseYaw = Math.atan2(-dx, -dz);
    basePitch = Math.atan2(dy, Math.hypot(dx, dz));
    reach = Math.hypot(dx, dy, dz);
  };

  const poseHead = () => {
    let yaw = baseYaw;
    let pitch = basePitch;
    let ex = eye.x;
    let ey = eye.y;
    let ez = eye.z;
    if (glideFrom != null) {
      const k = Math.min(1, (performance.now() - glideFrom.t) / 700);
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      let dyaw = baseYaw - glideFrom.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      yaw = glideFrom.yaw + dyaw * e;
      pitch = glideFrom.pitch + (basePitch - glideFrom.pitch) * e;
      ex = glideFrom.x + (eye.x - glideFrom.x) * e;
      ey = glideFrom.y + (eye.y - glideFrom.y) * e;
      ez = glideFrom.z + (eye.z - glideFrom.z) * e;
      if (k >= 1) glideFrom = null;
    }
    q.setFromAxisAngle(up, yaw + view.yaw);
    qa.setFromAxisAngle(right, pitch + view.pitch);
    q.multiply(qa);
    // Shift left along the seated body's right axis (not the look direction): the desk slides right, square-on.
    const s = -lean();
    cam.set(ex + Math.cos(yaw) * s, ey, ez - Math.sin(yaw) * s);
    dev.position.set(cam.x, cam.y, cam.z);
    dev.quaternion.set(q.x, q.y, q.z, q.w);
    dev.fovy = (view.fov * Math.PI) / 180;
  };

  // ---------------------------------------------------------------- Retina, with a dynamic resolution
  // The emulator draws the session at 1 CSS px (blurry on Retina). We draw at the screen's pixel ratio (cap 2) and
  // step down by quarters only if the frame time stays high (then back up).
  // 29 Oct (owner, on a busy Mac: "the text is pixelated, not sharp, not premium"): the old rule (step down above
  // 24 ms) sat at 1× on Retina — half resolution. A calm evening reads well at 30 i/s, blurry text never does:
  // never below 0.75 of the screen's ratio (1.5× on Retina), and step down only under ≈ 30 i/s.
  const cap = Math.min(2, window.devicePixelRatio || 1);
  const floor = Math.max(1, cap * 0.75);
  let scale = cap;
  let ema = 16.7;
  let lastAdapt = 0;
  const adapt = (now: number, dtMs: number) => {
    ema += (Math.min(dtMs, 100) - ema) * 0.05;
    if (now - lastAdapt < 2000) return;
    lastAdapt = now;
    if (ema > 34 && scale > floor) scale = Math.max(floor, scale - 0.25);
    else if (ema < 22 && scale < cap) scale = Math.min(cap, scale + 0.25);
  };
  const sharpen = () => {
    const c = dev.appCanvas;
    if (c == null) return;
    const ratio = scale;
    const w = Math.round(window.innerWidth * ratio);
    const h = Math.round(window.innerHeight * ratio);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    if (c.style.width !== '100vw') {
      c.style.width = '100vw';
      c.style.height = '100vh';
    }
  };

  // ---------------------------------------------------------------- projection (CSS px ↔ world)
  const screenOf = (p: V3): { x: number; y: number } | null => {
    if (frame == null) return null;
    tmp.set(p.x - cam.x, p.y - cam.y, p.z - cam.z);
    qa.copy(q).invert();
    tmp.applyQuaternion(qa);
    if (tmp.z >= -0.01) return null;
    const t = Math.tan(((view.fov * Math.PI) / 180) / 2);
    const nx = tmp.x / (-tmp.z * t * aspect());
    const ny = tmp.y / (-tmp.z * t);
    return { x: ((nx + 1) / 2) * window.innerWidth, y: ((1 - ny) / 2) * window.innerHeight };
  };
  /** Where the cursor ray meets the horizontal plane at desk height + h (world). */
  const planePoint = (cx: number, cy: number, h: number): V3 | null => {
    if (frame == null) return null;
    const t = Math.tan(((view.fov * Math.PI) / 180) / 2);
    const nx = (cx / window.innerWidth) * 2 - 1;
    const ny = 1 - (cy / window.innerHeight) * 2;
    tmp.set(nx * t * aspect(), ny * t, -1).normalize().applyQuaternion(q);
    if (tmp.y > -0.02) return null;
    const k = (frame.y + h - cam.y) / tmp.y;
    return { x: cam.x + tmp.x * k, y: frame.y + h, z: cam.z + tmp.z * k };
  };
  const pxRadius = (p: V3, r: number) => {
    const a = screenOf(p);
    const b = screenOf({ x: p.x + r, y: p.y, z: p.z });
    const c = screenOf({ x: p.x, y: p.y, z: p.z + r });
    if (a == null || b == null || c == null) return 0;
    return Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y));
  };

  const releaseMode = () => d.evening().mode === 'release';
  const stones = () => Array.from(d.debug().stones.values()).filter((s) => s.dissolving < 0);
  const lampWorld = (): V3 | null => (frame == null ? null : deskToWorld(frame, { x: layout.orb.x, y: 0.05, z: layout.orb.z }));

  type Hit = { kind: 'stone'; id: string } | { kind: 'weight' } | { kind: 'bin'; bin: Bin } | { kind: 'water' } | { kind: 'lamp' } | null;
  const hitAt = (cx: number, cy: number, wantDrop: boolean): Hit => {
    if (frame == null) return null;
    const near = (p: V3 | null, r: number, min: number) => {
      if (p == null) return Infinity;
      const s = screenOf(p);
      if (s == null) return Infinity;
      const dist = Math.hypot(s.x - cx, s.y - cy);
      return dist <= Math.max(min, pxRadius(p, r)) ? dist : Infinity;
    };
    if (wantDrop) {
      if (releaseMode()) {
        if (near(d.waterWorld(0), 0.11, 50) < Infinity) return { kind: 'water' };
        return null;
      }
      let best: Hit = null;
      let bestD = Infinity;
      for (const bin of BINS) {
        const dist = near(d.binWorld(bin), 0.11, 40);
        if (dist < bestD) {
          bestD = dist;
          best = { kind: 'bin', bin };
        }
      }
      return best;
    }
    if (releaseMode()) {
      const w = d.weightWorld();
      if (near(w, 0.055, 26) < Infinity) return { kind: 'weight' };
    }
    let best: Hit = null;
    let bestD = Infinity;
    for (const s of stones()) {
      const dist = near(s.mesh.position, 0.052, 22);
      if (dist < bestD) {
        bestD = dist;
        best = { kind: 'stone', id: s.id };
      }
    }
    if (best != null) return best;
    if (near(lampWorld(), 0.045, 24) < Infinity) return { kind: 'lamp' };
    return null;
  };

  // ---------------------------------------------------------------- hands (real pinch-grab path)
  const hand = dev.hands.right;
  const restWorld = (side: 'left' | 'right'): V3 => (frame == null ? { x: side === 'left' ? -0.2 : 0.2, y: 0.9, z: -0.1 } : deskToWorld(frame, REST[side]));
  const parkHands = () => {
    for (const side of ['left', 'right'] as const) {
      const p = restWorld(side);
      dev.hands[side].position.set(p.x, p.y, p.z);
      dev.hands[side].updatePinchValue(0);
    }
  };
  let follow: V3 | null = null; // drag target while a stone is held
  const handMeshes: Array<{ name: string; visible: boolean }> = [];
  let handScan = -1e9;
  let anim = 0; // cancels a glide when a newer one starts
  const glide = async (to: V3, ms: number, lift = 0): Promise<boolean> => {
    const id = ++anim;
    const from = { x: hand.position.x, y: hand.position.y, z: hand.position.z };
    const t0 = performance.now();
    for (;;) {
      if (id !== anim) return false;
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      hand.position.set(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e + Math.sin(Math.PI * k) * lift, from.z + (to.z - from.z) * e);
      if (k >= 1) return true;
      await new Promise((r) => requestAnimationFrame(r));
    }
  };

  let holding: string | null = null; // stone id, or 'weight'
  let busy = false;
  let lastStatus = '';
  const api: PlayerApi = {
    get holding() {
      return holding;
    },
    get busy() {
      return busy;
    },
    screenOf,
    target(kind, id) {
      if (kind === 'stone') {
        const s = id == null ? null : d.stoneWorld(id);
        return s == null ? null : screenOf(s);
      }
      if (kind === 'bin') {
        const b = d.binWorld((id ?? 'later') as Bin);
        return b == null ? null : screenOf(b);
      }
      if (kind === 'weight') {
        const w = d.weightWorld();
        return w == null ? null : screenOf(w);
      }
      if (kind === 'water') {
        const w = d.waterWorld(0);
        return w == null ? null : screenOf(w);
      }
      const l = lampWorld();
      return l == null ? null : screenOf(l);
    },
    recenter() {
      view.tYaw = 0;
      view.tPitch = 0;
      view.tFov = FOV.base;
    },
    /** Captures: turn the seated head (radians, + yaw = left, + pitch = up), within the same limits as the mouse. */
    look(yaw: number, pitch: number) {
      view.tYaw = clamp(yaw, -LOOK_LIMIT.yaw, LOOK_LIMIT.yaw);
      view.tPitch = clamp(pitch, -LOOK_LIMIT.down, LOOK_LIMIT.up);
    },
    view: () => ({ yaw: view.yaw, pitch: view.pitch, fov: view.fov, scale, frameMs: +ema.toFixed(1) }),
    onStatus: null,
    onLamp: null,
    setLeftInset(px: number) {
      leftInset = Math.max(0, px);
    },
  };
  const status = (text: string) => {
    lastStatus = text;
    api.onStatus?.(text);
  };

  const stoneLabel = (id: string) => d.state().tokens.find((t) => t.id === id)?.text ?? 'la pierre';

  const pick = async (target: 'weight' | string): Promise<void> => {
    if (busy || holding != null || frame == null) return;
    const p = target === 'weight' ? d.weightWorld() : d.stoneWorld(target);
    if (p == null) return;
    busy = true;
    await glide({ x: p.x, y: p.y + 0.06, z: p.z }, 380, 0.03);
    await glide({ x: p.x, y: p.y + 0.008, z: p.z }, 170);
    hand.updatePinchValue(1);
    await wait(260);
    holding = target;
    busy = false;
    const lift = target === 'weight' ? 0.1 : 0.07;
    void glide({ x: p.x, y: p.y + lift, z: p.z + 0.02 }, 260);
    status(
      target === 'weight'
        ? 'Pierre en main. Clique le bol d’eau (ou glisse-la au-dessus) pour la laisser couler.'
        : `« ${stoneLabel(target)} » en main. Clique un bol (ou 1, 2, 3). Échap pour la reposer.`,
    );
  };

  /** Carries the held stone to a bowl / the water / a desk point, opens the fingers, hand goes back to rest. */
  const drop = async (to: V3 | null, holdMs = 150): Promise<void> => {
    if (holding == null || busy) return;
    busy = true;
    follow = null;
    const wasWeight = holding === 'weight';
    if (to != null) await glide(to, wasWeight ? 900 : 650, wasWeight ? 0.03 : 0.07);
    await wait(holdMs);
    hand.updatePinchValue(0);
    await wait(320);
    holding = null;
    busy = false;
    status(wasWeight ? 'La pierre coule. Respire.' : '');
    void glide(restWorld('right'), 650, 0.05);
  };
  const dropInBin = (bin: Bin) => {
    const b = d.binWorld(bin);
    if (b == null) return;
    status(`→ ${BIN_FR[bin]}`);
    void drop({ x: b.x, y: b.y + 0.035, z: b.z });
  };
  const dropInWater = () => {
    const w = d.waterWorld(0.085);
    if (w == null) return;
    status('Au-dessus de l’eau… on la laisse partir.');
    // Held a moment over the water, then the fingers open: the stone sinks (Release).
    void drop({ x: w.x + 0.03, y: w.y, z: w.z + 0.035 }, 1500);
  };
  const putBack = () => {
    if (holding == null) return;
    const p = hand.position;
    void drop({ x: p.x, y: (frame?.y ?? p.y) + 0.03, z: p.z });
  };
  /** Keyboard 1/2/3 with empty hands: the next unsorted stone goes there (fast play). */
  const quickSort = async (bin: Bin) => {
    if (holding != null) return dropInBin(bin);
    if (busy) return;
    const next = d.state().tokens.find((t) => t.bin == null && !t.released);
    if (next == null) return status('Aucune pierre à trier.');
    await pick(next.id);
    if (holding != null) dropInBin(bin);
  };

  // ---------------------------------------------------------------- mouse & keyboard
  type Drag = { id: number; x: number; y: number; moved: boolean; kind: 'look' | 'stone'; hit: Hit; t: number };
  let drag: Drag | null = null;
  /** The event's point in the canvas, as normalized device coordinates. */
  const ndcOf = (e: PointerEvent): [number, number] => {
    const r = (dev.appCanvas ?? document.documentElement).getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2];
  };
  const onCanvas = (e: Event) => {
    const c = dev.appCanvas;
    return dev.activeSession != null && c != null && e.target === c;
  };
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!onCanvas(e) || e.button !== 0) return;
      const hit = holding == null ? hitAt(e.clientX, e.clientY, false) : null;
      const kind = hit != null && (hit.kind === 'stone' || hit.kind === 'weight') ? 'stone' : 'look';
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, kind, hit, t: performance.now() };
      if (kind === 'stone' && hit != null) void pick(hit.kind === 'weight' ? 'weight' : (hit as { id: string }).id);
    },
    true,
  );
  window.addEventListener(
    'pointermove',
    (e) => {
      if (dev.activeSession == null) return;
      const c = dev.appCanvas;
      if (drag != null && e.pointerId === drag.id) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 6) drag.moved = true;
        if (drag.moved && drag.kind === 'look') {
          view.tYaw = clamp(view.tYaw + e.movementX * 0.0032, -LOOK_LIMIT.yaw, LOOK_LIMIT.yaw);
          view.tPitch = clamp(view.tPitch - e.movementY * 0.0032, -LOOK_LIMIT.down, LOOK_LIMIT.up);
        }
      }
      // A held stone follows the cursor over the tray (drag-and-drop, or after a click).
      if (holding != null && !busy && (drag?.kind === 'stone' || drag == null)) {
        const p = planePoint(e.clientX, e.clientY, holding === 'weight' ? 0.12 : 0.07);
        if (p != null) follow = p;
      }
      if (c != null && e.target === c) {
        const over = holding != null ? hitAt(e.clientX, e.clientY, true) : hitAt(e.clientX, e.clientY, false);
        const button = ownPick && holding == null && !drag?.moved ? d.hoverButton!(...ndcOf(e)) : null;
        c.style.cursor = button != null ? 'pointer' : holding != null ? (over != null ? 'copy' : 'grabbing') : over != null ? (over.kind === 'lamp' ? 'pointer' : 'grab') : drag?.moved ? 'move' : '';
      }
    },
    true,
  );
  window.addEventListener(
    'pointerup',
    (e) => {
      if (drag == null || e.pointerId !== drag.id) return;
      const was = drag;
      drag = null;
      if (dev.activeSession == null) return;
      if (was.kind === 'stone') {
        // Drag-and-drop: released over a bowl (or the water) → there; elsewhere on the tray → put down there.
        if (was.moved) {
          const settle = async () => {
            while (busy) await wait(30);
            if (holding == null) return;
            const target = hitAt(e.clientX, e.clientY, true);
            if (target?.kind === 'bin') dropInBin(target.bin);
            else if (target?.kind === 'water') dropInWater();
            else putBack();
          };
          void settle();
        }
        return;
      }
      if (was.moved) return;
      // A click (no drag): with a stone in hand, a bowl / the water; with empty hands, the lamp.
      if (holding != null) {
        const target = hitAt(e.clientX, e.clientY, true);
        if (target?.kind === 'bin') dropInBin(target.bin);
        else if (target?.kind === 'water') dropInWater();
        else if (releaseMode()) status('Clique le bol d’eau pour la laisser couler (Échap pour la reposer).');
        else status('Clique un des trois bols : Tomorrow, Later ou Let go (Échap pour la reposer).');
        return;
      }
      if (ownPick) {
        const action = d.pickButton!(...ndcOf(e));
        if (action != null) {
          d.press!(action);
          return;
        }
      }
      if (was.hit?.kind === 'lamp' || hitAt(e.clientX, e.clientY, false)?.kind === 'lamp') api.onLamp?.();
    },
    true,
  );
  window.addEventListener(
    'wheel',
    (e) => {
      if (!onCanvas(e)) return;
      e.preventDefault();
      view.tFov = clamp(view.tFov + e.deltaY * 0.03, FOV.min, FOV.max);
    },
    { passive: false, capture: true },
  );
  const keys = new Set<string>();
  const typing = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return t != null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };
  window.addEventListener('keydown', (e) => {
    if (typing(e) || dev.activeSession == null || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.startsWith('Arrow')) {
      keys.add(e.key);
      e.preventDefault();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'r') api.recenter();
    else if (k === 'escape') putBack();
    else if (k === '1' || k === '2' || k === '3') void quickSort(BINS[Number(k) - 1]);
    else if (k === '+' || k === '=') view.tFov = clamp(view.tFov - 6, FOV.min, FOV.max);
    else if (k === '-') view.tFov = clamp(view.tFov + 6, FOV.min, FOV.max);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key));
  window.addEventListener('blur', () => keys.clear());

  // ---------------------------------------------------------------- per frame
  let last = performance.now();
  let tick = 0;
  let rays = 0;
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    take();
    if (dev.activeSession != null) {
      adapt(now, dt * 1000);
      sharpen();
      // Desk placed or moved ("move the desk"): frame it again.
      if ((tick++ & 7) === 0) {
        const st = d.state();
        // Only a real placement (not the 2D page's preview frame, not "finding your table").
        const f = st.placement === 'table' || st.placement === 'floating' ? st.frame : null;
        const key = f == null ? '' : `${f.x.toFixed(3)},${f.y.toFixed(3)},${f.z.toFixed(3)},${f.yaw.toFixed(3)}`;
        if (f != null && key !== frameKey) {
          frameKey = key;
          applyFrame(f);
          if (holding == null && !busy) parkHands();
        }
      }
      const sp = 1.1 * dt;
      if (keys.has('ArrowLeft')) view.tYaw = clamp(view.tYaw + sp, -LOOK_LIMIT.yaw, LOOK_LIMIT.yaw);
      if (keys.has('ArrowRight')) view.tYaw = clamp(view.tYaw - sp, -LOOK_LIMIT.yaw, LOOK_LIMIT.yaw);
      if (keys.has('ArrowUp')) view.tPitch = clamp(view.tPitch + sp, -LOOK_LIMIT.down, LOOK_LIMIT.up);
      if (keys.has('ArrowDown')) view.tPitch = clamp(view.tPitch - sp, -LOOK_LIMIT.down, LOOK_LIMIT.up);
      const k = 1 - Math.exp(-dt * 9);
      view.yaw += (view.tYaw - view.yaw) * k;
      view.pitch += (view.tPitch - view.pitch) * k;
      view.fov += (view.tFov - view.fov) * k;
      if (frame != null) poseHead();
      if (holding != null && !busy && follow != null) {
        const p = hand.position;
        const m = 1 - Math.exp(-dt * 14);
        hand.position.set(p.x + (follow.x - p.x) * m, p.y + (follow.y - p.y) * m, p.z + (follow.z - p.z) * m);
      }
      // Resting hands are not drawn (coordinator, 19 Oct: a white outlined hand showed at the bottom of the view when
      // the head turned or looked down): the emulated hands appear only while they pick, carry or drop a stone.
      {
        if (now - handScan > 500) {
          handScan = now;
          handMeshes.length = 0;
          (world as unknown as { scene: { traverse(f: (o: { name: string; visible: boolean }) => void): void } }).scene.traverse((o) => {
            if (/_handMeshNode$/u.test(o.name)) handMeshes.push(o);
          });
        }
        const shown = holding != null || busy || follow != null;
        for (const m of handMeshes) if (m.visible !== shown) m.visible = shown;
      }
      // The mouse is the pointer here: hand rays (and their cursor dots) stay off, even after a ritual turns them on.
      if (now - rays > 500) {
        rays = now;
        const mp = (world.input as unknown as { xr?: { multiPointers?: Record<string, { toggleSubPointer(k: string, on: boolean): boolean }> } }).xr?.multiPointers;
        for (const side of ['left', 'right']) {
          try {
            mp?.[side]?.toggleSubPointer('ray', false);
          } catch {
            // older input stack: rays stay
          }
        }
        hideChrome();
        quietRoom();
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // The emulator room photo was softened to look like passthrough; on a Retina screen it reads as blur.
  d.film?.grade(undefined, 0.9);
  void lastStatus;
  g.__wddPlayer = api;
  return api;
}
