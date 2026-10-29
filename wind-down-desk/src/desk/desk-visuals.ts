/**
 * Everything drawn on and above the desk, except the stones themselves.
 *
 * Draw-call budget (per eye): tray shadow 1 · tray (+ lamp foot) 1 · lamp
 * globe + halo 2 · caption 1 · card 1 + buttons 2 (only during the plan) ·
 * light field 1 · Places ornament 1 (+ 4 menu rows while open) · place
 * backdrop 1 (only away from your room) → 8 to 15, plus one per stone.
 */
import {
  CanvasTexture,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MirroredRepeatWrapping,
  NoColorSpace,
  RGBAFormat,
  Texture,
  TextureLoader,
  Vector3,
  Vector4,
  type Entity,
  type World,
} from '@iwsdk/core';
import type { DeskFrame, DeskLayout } from '../logic/desk-layout.ts';
import { breatheReplyPose, createLampGlobeGeometry, createQuad, createTrayGeometry, LAMP } from './geometry.ts';
import { PlaceBackdrop } from './environment.ts';
import { RainField } from './rain.ts';
import { LivingPlaces } from './living/index.ts';
import { ktx2Bytes, loadKtx2 } from './ktx2.ts';
import { MENU_PLACES, PLACES, type PlaceId } from '../logic/places.ts';
import {
  CARD_CONTRAST,
  createCardMaterial,
  createDwellRingMaterial,
  createOrbMaterial,
  createTrayMaterial,
  KEY_LOCAL,
  MAX_SHADOWS,
  POOL_LOCAL,
  rig,
  type CardUniforms,
  type OrbUniforms,
  type TrayUniforms,
} from './materials.ts';
export type { TrayUniforms };
import { LightField } from './particles.ts';
import { LampSpirit } from './lamp-spirit.ts';
import { CeilingSky } from './ceiling-sky.ts';
import { DS, Spring } from './design-tokens.ts';
import { CaptionCanvas, CardCanvas, drawButton, drawEngravedLabels, drawGlobeButton, drawGlobeLabel, drawWordChip, drawImmersionOrnament, drawSettingChip, WIDE_CHIP, drawOrnament, drawPlaceChip, drawRitualChip, type CardContent, type SettingId } from './text-canvas.ts';
import { PlacePreviews } from './place-preview.ts';
import { WordBatch } from './word-batch.ts';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Keepsakes } from './keepsakes.ts';
import { GLOBE_STARS } from '../logic/milestones.ts';
import { FIG_MAX } from './materials.ts';
import type { QualityKnobs } from '../logic/quality.ts';
import { RITUAL_MENU, type RitualKind, type RitualMenuId } from '../logic/evening.ts';
import { createMoonGeometry } from './ritual-geometry.ts';
import { skyGlobeLayout } from '../logic/caption-layout.ts';

/**
 * 26 Oct (owner: "the lamp shows"): Places opens INSIDE the lamp. The globe floats up behind the bowls and grows to
 * 15 cm, and shows one place at a time (a lens onto it: move your head, look around inside); ‹ › beside it, the
 * place's name above, × to close. Touch, pinch or look at the globe to go there; or say the place's name. Five
 * panels at most instead of eleven (better for a 66° view). false = the v8 grid of chips.
 */
export const PLACES_IN_GLOBE = true;
/** Desk-local spot of the grown globe (above and behind the Later / Let go bowls, clear of them from the seat). */
export const GLOBE_SHOW = { x: 0.1, y: 0.22, z: -0.08, radius: 0.085, tilt: -0.45, button: 0.05, gap: 0.028, label: 0.24 } as const;
/**
 * 29 Oct: the globe's name row stands this high above the sphere's top (desk-local metres; the 24 cm label is
 * 7 cm tall). The "Table stays | Full" switch left the globe for the bottom row (one control, owner).
 */
const GLOBE_TITLE_DY = 0.05;
function globeTitleDy(): number {
  return GLOBE_TITLE_DY;
}
/**
 * 29 Oct (owner): the bottom row is Rituals · Places · Settings, plus « Mixed | Full » at its end while you are in a
 * place. Widths (m) and the gap; the row stays centred on the tray whether the capsule shows or not.
 */
const BOTTOM_ROW = { button: 0.088, capsule: 0.132, gap: 0.012 } as const;
/** The Settings rows, in the ritual menu's two columns of four. */
const SETTING_ROWS: ReadonlyArray<{ id: SettingId; name: string }> = [
  { id: 'volume', name: 'Volume' },
  { id: 'voice', name: 'Lamp voice' },
  { id: 'text', name: 'Larger text' },
  { id: 'contrast', name: 'High contrast' },
  { id: 'gaze', name: 'Choose by looking' },
  { id: 'recenter', name: 'Recenter desk' },
  { id: 'forget', name: 'Forget my evenings' },
  { id: 'close', name: 'Close' },
];
export type SettingStates = { voice: boolean; text: boolean; contrast: boolean; gaze: boolean };

function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

const Y_AXIS = new Vector3(0, 1, 0);

/** Desk-local row of the three ornaments: 4.4 cm tall capsules, centres 10.5 cm apart, 4 cm in front of the rim. */
export const ORNAMENT_ROW = { x: [-0.105, 0, 0.105], y: 0.006, z: (layout: DeskLayout) => layout.depth / 2 + 0.04, tilt: -1.0 } as const;

/**
 * v8: the caption pane (and everything laid out on its plane: the Places grid, the immersion switch).
 * One plane above the back of the tray, tilted toward the seated user: nothing on the tray can hide it.
 */
const PANE = { y: 0.235, tilt: -0.3, z: (layout: DeskLayout) => -layout.depth / 2 + 0.005 } as const;
/** Places grid on the caption plane: 5 columns × 2 rows of 16 × 4.7 cm (your room + 9 night places), one glance,
 * no paging; it spans the tray's width and stays above the bowls. */
const GRID = { x: [-0.336, -0.168, 0, 0.168, 0.336], dy: [0.058, -0.006], w: 0.16 } as const;
/** "Move desk here" under the Places grid, right of the immersion switch (which spans ±12.5 cm). */
const MOVE_CHIP = { x: 0.27, w: 0.14 } as const;
/** Touch words: 4 columns × 2 rows of 15.5 × 4.6 cm (24 Oct: was 3 rows, it stood over the bowls); the caption rises above. */
const WORDS = { x: [-0.2475, -0.0825, 0.0825, 0.2475], step: 0.165, dy: [0.027, -0.027], lift: 0.09, max: 8 } as const;
/** While the ritual menu is open by the lamp, the caption slides left so the two never overlap (ref. 02). */
const CAPTION_ASIDE = -0.22;
/** 25 Oct (Meta VR Glasses, ≈ 70° wide): while the ritual menu is open the caption is also 12 % smaller, so the
 * caption, the menu and the lamp fit in one 66° view. */
const CAPTION_ASIDE_SCALE = 0.84;
/** 25 Oct (Meta VR Glasses): the near Places grid shifts 2.5 cm toward the lamp, so grid + lamp fit in 66°. */
const GRID_NEAR_SHIFT = 0.04;
/** Replies under the caption: capsules at 70 % of the plan chips' width (owner, 19 Oct: "the blocks are big"). */
const REPLY_NARROW = 0.7;

/** A point at (dx, dy) on the caption plane (desk-local). */
function onPane(layout: DeskLayout, dx: number, dy: number, out: Vector3): Vector3 {
  return out.set(dx, PANE.y + dy * Math.cos(PANE.tilt), PANE.z(layout) + dy * Math.sin(PANE.tilt));
}

/**
 * 23 Oct — airplane-seat test: the touch menus (words, Places, Move desk, the switch) come to you when they open:
 * from the caption plane at the back (76–94 cm from the shoulder, measured) to a near plane above the front of the
 * bowls, tilted toward you (≤ ≈ 60 cm), and go back when they close. The caption stays at the back.
 */
/** Touch words stay above the bowls (stones are picked below them while they are open). */
const NEAR_WORDS = { y: 0.29, z: 0.02, tilt: -0.5, spread: 0.86 } as const;
/**
 * 24 Oct (coordinator review of the first minute): no panel may ever hide the tray, the bowls or a stone. The near
 * words sit ABOVE the seated line of sight to the bowls' back rims (≈ 0.2–0.24 m at the near plane for eyes 0.40–0.56
 * m above the table), and the caption rises above the words by as much (`CAPTION_OVER_WORDS`), still under eye level.
 */
const CAPTION_OVER_WORDS = 0.135;
/** 24 Oct: five ritual rows (Talk it through joined): a little smaller and tighter, starting a little higher. */
/**
 * 29 Oct (owner: "the two-column menu runs off the right of the frame"): the whole menu fits a 16:9 video frame seen
 * from the seat (eyes ≈ 0.39 m above the tray, 0.58 m behind its centre; pitch −27°, 54° vertical FOV): the top row
 * ≥ 3° under the frame's top edge (it stood above eye level), the right column ≤ 34° from the centre (it reached 52°).
 * The rows stand right of the caption (which steps aside to the left), above the Let go bowl and the lamp.
 */
// 29 Oct: 3 cm higher (owner's screen: the last row, Release / High contrast, sat behind the Let go bowl's rim).
const RITUAL_ROWS = { farY: 0.352, farStep: 0.056, nearY: 0.328, nearStep: 0.05, scale: 0.9 } as const;
/**
 * 28 Oct: eight rows (Squeeze, Keep and Your sky joined) stand in two columns of four, so the last row stays high
 * enough (the Let go bowl's rim never covers it) and the caption stays clear: the rituals in the first column, Keep …
 * Good night in a second column to their right. Desk-local x of the first column and the column step, far (beside
 * the lamp) and near (airplane seat), and their depth.
 */
const RITUAL_COLUMN = { rows: 4, farX: 0.2, far: 0.185, farZ: -0.12, nearX: 0.15, near: 0.175, nearZ: 0 } as const;
/** 29 Oct: the journal's page (desk-local centre, tilt, scale of the 0.52 × 0.343 m card) and its buttons. */
export const JOURNAL_CARD = { x: -0.07, y: 0.168, z: -0.13, tilt: -0.42, scale: 0.86, chipY: 0.034, chipZ: 0.035 } as const;
/** Modal menus (Places, Move desk) come closer still: nothing else is touched while they are open. */
const NEAR_MENU = { y: 0.25, z: 0.06, tilt: -0.7, spread: 0.77 } as const;
type NearPane = { readonly y: number; readonly z: number; readonly tilt: number; readonly spread: number };

/** A point at (dx, dy) on the plane blended between the caption plane (k = 0) and a near plane (k = 1). */
function onNearPane(layout: DeskLayout, dx: number, dy: number, k: number, out: Vector3, near: NearPane = NEAR_MENU): number {
  const tilt = PANE.tilt + (near.tilt - PANE.tilt) * k;
  const y = PANE.y + (near.y - PANE.y) * k;
  const z = PANE.z(layout) + (near.z - PANE.z(layout)) * k;
  const x = dx * (1 + (near.spread - 1) * k);
  out.set(x, y + dy * Math.cos(tilt), z + dy * Math.sin(tilt));
  return tilt;
}

export class DeskVisuals {
  readonly root = new Group();
  readonly rootEntity: Entity;
  readonly tray: Mesh;
  readonly orb: Mesh;
  readonly orbEntity: Entity;
  readonly keepChip: Mesh;
  readonly keepEntity: Entity;
  readonly lighterChip: Mesh;
  readonly lighterEntity: Entity;
  readonly lights: LightField;
  readonly ceilingSky = new CeilingSky();
  readonly backdrop = new PlaceBackdrop();
  /** v8: in-engine rain of the tea garden (world-anchored around the seat, outside the veranda roof). */
  readonly rain: RainField;
  /** Living places: snow at the cabin, waves at the cove, the campfire, shooting stars (src/desk/living/). */
  readonly living: LivingPlaces;
  readonly ornament: Mesh;
  readonly ornamentEntity: Entity;
  /** 29 Oct: "Settings" (it was "Sound"); the mesh and entity keep their old names. */
  readonly voiceButton: Mesh;
  readonly voiceEntity: Entity;
  private readonly voiceUniforms: CardUniforms;
  /** Loudness of the lamp's voice right now (0..1), −1 when it is not speaking: drives the glow. */
  voiceLevel = -1;
  readonly placeChips: Array<{ id: PlaceId; mesh: Mesh; entity: Entity; uniforms: CardUniforms; hover: Spring }> = [];
  /** 29 Oct: « Mixed | Full », the capsule at the end of the bottom row while you are in a place. */
  readonly immersionToggle: Mesh;
  readonly immersionEntity: Entity;
  private readonly immersionUniforms: CardUniforms;
  /** 22 Oct: "Move desk here" under the open Places grid (the touch twin of "move my desk"). */
  readonly moveChip: Mesh;
  readonly moveEntity: Entity;
  private readonly moveUniforms: CardUniforms;
  private immersionFull = false;
  /** 0..1: the capsule's place in the bottom row (it slides in when you arrive in a place). */
  private immersionRowK = 0;
  /** The one-time hint: the capsule's edge pulses twice (seconds left, 0: none). */
  private immersionPulseT = 0;
  private immersionPulseDrawn = -1;
  /** 29 Oct: the Settings panel (rows in the ritual menu's place; one menu at a time). */
  readonly settingChips: Array<{ id: SettingId; mesh: Mesh; entity: Entity; uniforms: CardUniforms; hover: Spring }> = [];
  private readonly settingSpring = new Spring(0);
  private settingsOpen = false;
  private settingsModalK = 0;
  private readonly asideSpring = new Spring(0);
  private readonly paneTmp = new Vector3();
  /** v6: "Rituals" ornament (reads "Finish" during Breathe and Release) and its menu rows by the lamp. */
  readonly ritualsOrnament: Mesh;
  readonly ritualsEntity: Entity;
  private readonly ritualsUniforms: CardUniforms;
  readonly ritualChips: Array<{ id: RitualMenuId; mesh: Mesh; entity: Entity; uniforms: CardUniforms; hover: Spring }> = [];
  private readonly ritualSpring = new Spring(0);
  private ritualsOpen = false;
  private ritualsLabel = '';
  /**
   * v6: where the lamp's globe is asked to be (desk-local) and how big: home on its foot, the breathing
   * moon above the tray, or the "witness" above the black bowl. The globe glides there on a spring.
   */
  readonly orbTarget = { x: 0, y: 0, z: 0, scale: 1 };
  private readonly orbPose = { x: 0, y: 0, z: 0, scale: 1 };
  private readonly orbVel = { x: 0, y: 0, z: 0, scale: 0 };
  private readonly orbGeoHome: ReturnType<typeof createLampGlobeGeometry>;
  private readonly orbGeoMoon: ReturnType<typeof createMoonGeometry>;
  /** v6: true while a ritual drives the globe frame by frame (no spring). */
  orbDirect = false;
  /** 29 Oct: the globe shows your sky beside the caption (its x follows the caption pill's width, never over it). */
  private skyBesideCaption = false;
  /** 29 Oct: the caption's extra left shift while the sky globe needs more room (eased, desk-local metres, ≤ 0). */
  private skyCaptionShift = 0;
  /** v6: the bowls slide into the tray (0 = up, 1 = gone). */
  bowlsAwayTarget = 0;
  /** 29 Oct (owner: "the little lights should go dark during another ritual, not to blur the immersion"): set by the
   * evening while a ritual other than Keep runs; the kept lights then fall to a faint glow. */
  keptQuiet = false;
  /** 29 Oct: the kept lights' own moments (Keep, Your sky): full light whatever glass is open. */
  keptFull = false;
  /** 29 Oct (owner, the night): the glass row (Rituals · Places · Sound) fades away; only the question stays. */
  ornamentsNight = false;
  /** 29 Oct (the close): the light left as the night fades (1 → 0): the lamp sinks with the room and the stars. */
  sleepLight = 1;
  private nightRowK = 0;
  /** Lamp energy this frame (read by the rituals: water reflection, palm glow). */
  energy = 0;
  private readonly worldTmp = new Vector3();
  private readonly headLocal = new Vector3();
  private readonly eyeLocal = new Vector3();
  /**
   * 29 Oct (a low seat at a high table, the desk at chin height): the words' near pane never stands higher than
   * 2 cm above the eyes, or the near words rose in front of the far caption (parallax) and out of a downward gaze.
   */
  private readonly nearWordsNow = { y: NEAR_WORDS.y as number, z: NEAR_WORDS.z as number, tilt: NEAR_WORDS.tilt as number, spread: NEAR_WORDS.spread as number };
  private ritualModalK = 0;
  /** The lamp's aura (axe 4) and what it needs each frame (no allocation). */
  private readonly spirit: LampSpirit;
  private readonly spiritLook = new Vector3();
  private readonly prepRenderer: World['renderer'];
  private readonly prepCamera: World['camera'];
  private readonly prepScene: World['scene'];
  private readonly camera: { getWorldPosition(v: Vector3): Vector3 };
  private readonly ornamentUniforms: CardUniforms;
  private readonly menuSpring = new Spring(0);
  private menuOpen = false;
  private readonly thumbs = new Map<PlaceId, HTMLImageElement>();
  /** The lamp shows the places (PLACES_IN_GLOBE): previews, the carousel, its buttons and title. */
  private readonly previews = new PlacePreviews();
  private globeIndex = 1;
  private frameYaw = 0;
  private globeK = 0;
  private windowK = 0;
  private shownPreview: Texture | null = null;
  private globeHint = '';
  readonly globeButtons: Array<{ action: 'globe-prev' | 'globe-next' | 'globe-close'; mesh: Mesh; entity: Entity; uniforms: CardUniforms }> = [];
  /** Lot 2b: your sky shown in the lamp (seconds left, how much), and the keepsakes on the table. */
  private skyT = 0;
  private skyK = 0;
  private skyLines = 0;
  private skyLinesTarget = 0;
  private readonly figLit = new Float32Array(FIG_MAX);
  private readonly figLitTarget = new Float32Array(FIG_MAX);
  private figNewAt = -1;
  private figNewDelay = 0;
  readonly keepsakes = new Keepsakes();
  readonly globeLabel: Mesh;
  readonly globeLabelUniforms: CardUniforms;
  private readonly trayUniforms: TrayUniforms;
  /** On a real table the tray casts its (merged) contact shadow. */
  private groundedFlag = false;
  private readonly orbUniforms: OrbUniforms;
  private readonly caption: Mesh;
  private readonly captionCanvas = new CaptionCanvas();
  private readonly captionUniforms: { uOpacity: { value: number } };
  private readonly card: Mesh;
  private readonly cardCanvas = new CardCanvas();
  private readonly cardUniforms: CardUniforms;
  private readonly chipUniforms: CardUniforms[] = [];
  private readonly cardSpring = new Spring(0);
  private readonly captionLift = new Spring(0);
  private readonly hover: Record<string, Spring> = { keep: new Spring(0), lighter: new Spring(0), orb: new Spring(0), places: new Spring(0), voice: new Spring(0), rituals: new Spring(0) };
  private readonly layout: DeskLayout;
  private readonly orbLocal = new Vector3();
  private readonly tmp = new Vector3();

  // Animated targets.
  private reveal = 0;
  private revealTarget = 0;
  /** 0..1: the interface (caption, menus, replies, glass row) fades in only once the tray is revealed. */
  private uiK = 1;
  /** The interface (captions, replies) is on screen: the arrival reveal is over. */
  get uiShown(): boolean {
    return this.uiK > 0.85;
  }
  readonly relay: Mesh;
  private readonly relayUniforms: CardUniforms;
  private relayK = 0;
  private relayPlaced = false;
  private captionAt = -1e9;
  private readonly relayPos = new Vector3();
  /** Gaze-only selection: the dwell ring (world space, faces you). */
  readonly dwellRing: Mesh;
  private readonly dwellUniforms: { uProgress: { value: number }; uAlpha: { value: number } };
  private readonly relayTmp = new Vector3();
  private readonly relayTo = new Vector3();
  /** 0..1: touch menus on the caption plane (0) or come to you on the near plane (1). */
  private nearK = 0;
  private poolK = 0;
  private dim = 0;
  private dimTarget = 0;
  private readonly binGlowTarget = [0, 0, 0];
  private readonly suggestTarget = [0, 0, 0];
  private readonly gazeBinTarget = [0, 0, 0];
  private emberTarget = 0;
  private captionTarget = 0;
  private cardTarget = 0;
  /** Touch replies on the two chips under the caption ("Yes" / "Not now", "Longer" / "Enough"), when no card is up. */
  private replyLabels: string[] | null = null;
  /** Breathe: the replies stand right under the caption (the moon is lower), both plain glass. */
  private repliesBeside = false;
  private replyKey = '';
  private planLabelsDirty = false;
  private readonly replySpring = new Spring(0);
  /** Touch words grid (quiet evening). */
  /** Word chips; `col` is the centre column (0..3, halves for a wide bubble), `row` 0..1, `span` 1 or 2 columns. */
  readonly wordChips: Array<{ mesh: Mesh; entity: Entity; uniforms: CardUniforms; label: string | null; hover: Spring; col: number; row: number; span: number }> = [];
  /** 29 Oct: the word chips' single draw (A/B: setEnabled(false) draws each chip itself again). */
  readonly wordBatch: WordBatch;
  private wordKey = '';
  private wordsOpen = false;
  private readonly wordSpring = new Spring(0);
  private readonly blank: Texture;
  private captionDy = 0;
  /** The living lamp: evening depth, night (the candle goes out), and its slow life. */
  private eveningDepth = 0;
  private night = false;
  private lampOut = 0;
  private lifeT = 0;
  private moteAt = 0;
  private pendingCaption: { text: string; sub: string } | null = null;
  private orbListening = 0;
  private orbListeningTarget = 0;
  private ornamentsHidden = false;
  private orbThinkingTarget = 0;
  private orbLevel = 0;
  private orbHoverTarget = 0;
  private orbMuted = 0;
  private orbMutedTarget = 0;
  private wake = 0;
  private wakeT = -1;
  private speakLeft = 0;
  private speakPhase = 0;
  private speak = 0;
  private lastSpoken = '';

  constructor(world: World, layout: DeskLayout) {
    this.layout = layout;
    this.camera = world.camera;
    this.rootEntity = world.createTransformEntity(this.root);
    this.root.visible = false;

    // Real oak (Poly Haven "Oak Veneer 01", CC0): a 18 KB preview at once, then the KTX2 pair (albedo 1024 × 2048
    // ETC1S + normal/roughness 512 × 1024 UASTC, ≈ 2.1 MB of GPU memory with mips). Display sRGB values: the
    // shader linearises. Mirrored repeat: the rim pieces read other parts of the same board.
    const wood = new TextureLoader().load('./textures/oak-preview.jpg');
    wood.colorSpace = NoColorSpace;
    wood.wrapS = MirroredRepeatWrapping;
    wood.wrapT = MirroredRepeatWrapping;
    wood.anisotropy = 8;
    wood.minFilter = LinearMipmapLinearFilter;
    const flatNormal = new DataTexture(new Uint8Array([128, 128, 150, 255]), 1, 1, RGBAFormat);
    flatNormal.needsUpdate = true;

    // Soft contact shadow on the real table: since 22 Oct part of the tray's own draw call (aKind 5, uContact).

    const trayMaterial = createTrayMaterial(layout, wood, drawEngravedLabels(layout), flatNormal);
    void this.loadOak(world, trayMaterial.uniforms as unknown as Record<string, { value: unknown }>, wood);
    void this.loadLampFoot(world, layout);
    this.trayUniforms = trayMaterial.uniforms;
    this.tray = new Mesh(createTrayGeometry(layout), trayMaterial);
    this.tray.renderOrder = 1;
    this.tray.raycast = () => {};
    this.root.add(this.tray);

    // Voice lamp (the agent): an opal glass globe on a turned stoneware foot (the foot is part of the tray mesh).
    const orbMaterial = createOrbMaterial();
    this.orbUniforms = orbMaterial.uniforms;
    this.orbGeoHome = createLampGlobeGeometry();
    this.orbGeoMoon = createMoonGeometry(LAMP.globe);
    this.orb = new Mesh(this.orbGeoHome, orbMaterial);
    this.orb.position.set(layout.orb.x, LAMP.globeY, layout.orb.z);
    this.orbLocal.copy(this.orb.position);
    this.orbHome();
    Object.assign(this.orbPose, this.orbTarget);
    this.orb.renderOrder = 3;
    this.orb.name = 'wdd-lamp-globe';
    // 24 Oct (axe 4): the lamp's aura of living motes AND its soft halo, in one draw call (the halo was its own mesh),
    // child of the globe so it travels and grows with it.
    this.spirit = new LampSpirit(LAMP.globe);
    this.prepRenderer = world.renderer;
    this.prepCamera = world.camera;
    this.prepScene = world.scene;
    this.orb.add(this.spirit.mesh);
    this.root.add(this.orb);
    this.orbEntity = world.createTransformEntity(this.orb, this.rootEntity);

    // Caption: a glass pane above the back edge, tilted toward the seated user.
    const captionMaterial = createCardMaterial(this.captionCanvas.texture);
    this.captionUniforms = captionMaterial.uniforms;
    this.caption = new Mesh(createQuad(0.72, 0.18), captionMaterial);
    this.caption.position.set(0, PANE.y, PANE.z(layout));
    this.caption.rotation.x = PANE.tilt;
    this.caption.renderOrder = 6;
    this.caption.raycast = () => {};
    this.root.add(this.caption);
    // 23 Oct — FoV-aware: a relay of the caption that lazily follows your view when you have turned away from the
    // desk and the lamp just said something (same texture; one draw call only while it shows).
    const relayMaterial = createCardMaterial(this.captionCanvas.texture);
    this.relayUniforms = relayMaterial.uniforms;
    this.relay = new Mesh(this.caption.geometry, relayMaterial);
    this.relay.scale.setScalar(0.78);
    this.relay.renderOrder = 9;
    this.relay.visible = false;
    this.relay.raycast = () => {};
    world.scene.add(this.relay);
    const dwellMaterial = createDwellRingMaterial();
    this.dwellUniforms = dwellMaterial.uniforms;
    this.dwellRing = new Mesh(createQuad(0.056, 0.056), dwellMaterial);
    this.dwellRing.renderOrder = 12;
    this.dwellRing.visible = false;
    this.dwellRing.raycast = () => {};
    world.scene.add(this.dwellRing);

    // Plan / morning card.
    const cardMaterial = createCardMaterial(this.cardCanvas.texture);
    this.cardUniforms = cardMaterial.uniforms;
    this.card = new Mesh(createQuad(0.52, 0.343), cardMaterial);
    // v8: a little lower, so the whole plan sits in view above the bowls (never behind them).
    this.card.position.set(0, 0.258, -layout.depth / 2 - 0.02);
    this.card.rotation.x = -0.26;
    this.card.renderOrder = 5;
    this.card.visible = false;
    this.card.raycast = () => {};
    this.root.add(this.card);

    // Buttons: ≥ 4.4 cm tall capsules, centres 17 cm apart (HIG: ≥ 60 pt apart), pokeable and ray-clickable.
    const makeChip = (label: string, primary: boolean, x: number) => {
      const material = createCardMaterial(drawButton(label, DS.accent.lamp, primary));
      this.chipUniforms.push(material.uniforms);
      const chip = new Mesh(createQuad(0.15, Math.max(DS.minTarget, 0.0488)), material);
      // v7: above the taller bowls' back rims (5.8 cm).
      chip.position.set(x, 0.088, -layout.depth / 2 + 0.03);
      chip.rotation.x = -0.7;
      chip.renderOrder = 7;
      chip.visible = false;
      this.root.add(chip);
      return chip;
    };
    this.keepChip = makeChip('Keep this plan', true, -0.085);
    this.lighterChip = makeChip('Make it lighter', false, 0.085);
    this.keepEntity = world.createTransformEntity(this.keepChip, this.rootEntity);
    this.lighterEntity = world.createTransformEntity(this.lighterChip, this.rootEntity);

    // Quiet evening: a grid of words to touch, drawn only while open (a 1-pixel texture otherwise).
    const blankCanvas = document.createElement('canvas');
    blankCanvas.width = 1;
    blankCanvas.height = 1;
    this.blank = new CanvasTexture(blankCanvas);
    for (let i = 0; i < WORDS.max; i++) {
      const material = createCardMaterial(this.blank);
      const mesh = new Mesh(createQuad(0.155, 0.046), material);
      onPane(layout, WORDS.x[i % 4], WORDS.dy[Math.floor(i / 4)], mesh.position);
      mesh.rotation.x = PANE.tilt;
      mesh.renderOrder = 8;
      mesh.visible = false;
      this.root.add(mesh);
      const entity = world.createTransformEntity(mesh, this.rootEntity);
      const hover = new Spring(0);
      this.wordChips.push({ mesh, entity, uniforms: material.uniforms, label: null, hover, col: i % 4, row: Math.floor(i / 4), span: 1 });
      this.hover[`word:${i}`] = hover;
    }
    // 29 Oct (draw budget): every word chip is drawn by ONE instanced draw (word-batch.ts); the chips stay the
    // meshes the fingertip pokes.
    this.wordBatch = new WordBatch(this.wordChips, this.wordChips[0].mesh.geometry);
    this.wordBatch.attach(world.scene);

    // World-space light field (warm dust + night sky).
    this.lights = new LightField();
    world.createTransformEntity(this.lights.mesh);
    // 29 Oct: the night sky laid on your ceiling at Good night (one draw call, only then).
    world.createTransformEntity(this.ceilingSky.mesh);

    // Places: the backdrop sphere (drawn first, only away from your room) and its controls.
    this.backdrop.setRenderer(world.renderer);
    world.createTransformEntity(this.backdrop.mesh);
    this.rain = new RainField(world, this.backdrop.stateUniform);
    this.living = new LivingPlaces(world, this.backdrop);
    // Three glass ornaments in one aligned row, centred just in front of the tray's front rim (a visionOS
    // bottom ornament): Rituals · Places · Voice. Off the rim, never stacked across it (v6 review).
    const ritualsMaterial = createCardMaterial(drawOrnament('Rituals', false, 'rituals'));
    this.ritualsUniforms = ritualsMaterial.uniforms;
    this.ritualsOrnament = new Mesh(createQuad(0.088, 0.044), ritualsMaterial);
    this.ritualsOrnament.position.set(ORNAMENT_ROW.x[0], ORNAMENT_ROW.y, ORNAMENT_ROW.z(layout));
    this.ritualsOrnament.rotation.x = ORNAMENT_ROW.tilt;
    this.ritualsOrnament.renderOrder = 7;
    this.root.add(this.ritualsOrnament);
    this.ritualsEntity = world.createTransformEntity(this.ritualsOrnament, this.rootEntity);
    this.hover.rituals = new Spring(0);
    const ornamentMaterial = createCardMaterial(drawOrnament('Places', false));
    this.ornamentUniforms = ornamentMaterial.uniforms;
    this.ornament = new Mesh(createQuad(0.088, 0.044), ornamentMaterial);
    this.ornament.position.set(ORNAMENT_ROW.x[1], ORNAMENT_ROW.y, ORNAMENT_ROW.z(layout));
    this.ornament.rotation.x = ORNAMENT_ROW.tilt;
    this.ornament.renderOrder = 7;
    this.root.add(this.ornament);
    this.ornamentEntity = world.createTransformEntity(this.ornament, this.rootEntity);
    const voiceMaterial = createCardMaterial(drawOrnament('Settings', false, 'settings'));
    this.voiceUniforms = voiceMaterial.uniforms;
    this.voiceButton = new Mesh(createQuad(0.088, 0.044), voiceMaterial);
    this.voiceButton.position.set(ORNAMENT_ROW.x[2], ORNAMENT_ROW.y, ORNAMENT_ROW.z(layout));
    this.voiceButton.rotation.x = ORNAMENT_ROW.tilt;
    this.voiceButton.renderOrder = 7;
    this.root.add(this.voiceButton);
    this.voiceEntity = world.createTransformEntity(this.voiceButton, this.rootEntity);
    // v8: the Places menu is a grid on the caption's own plane (the caption steps aside while it is open):
    // 5 × 2 (16 × 4.7 cm) — never over the ritual menu, never behind a bowl or the lamp.
    MENU_PLACES.forEach((id, i) => {
      const material = createCardMaterial(drawPlaceChip(PLACES[id].name, null, id === 'room'));
      const mesh = new Mesh(createQuad(GRID.w, (GRID.w * 224) / 768), material);
      onPane(layout, GRID.x[i % GRID.x.length], GRID.dy[Math.floor(i / GRID.x.length) % GRID.dy.length], mesh.position);
      mesh.rotation.x = PANE.tilt;
      mesh.renderOrder = 8;
      mesh.visible = false;
      this.root.add(mesh);
      const entity = world.createTransformEntity(mesh, this.rootEntity);
      const hover = new Spring(0);
      this.placeChips.push({ id, mesh, entity, uniforms: material.uniforms, hover });
      this.hover[`place:${id}`] = hover;
    });
    // 29 Oct: « Mixed | Full » at the end of the bottom row (one mesh; a touch anywhere on it flips the mode).
    const toggleMaterial = createCardMaterial(drawImmersionOrnament(false));
    this.immersionUniforms = toggleMaterial.uniforms;
    this.immersionToggle = new Mesh(createQuad(BOTTOM_ROW.capsule, 0.044), toggleMaterial);
    this.immersionToggle.position.set(0, ORNAMENT_ROW.y, ORNAMENT_ROW.z(layout));
    this.immersionToggle.rotation.x = ORNAMENT_ROW.tilt;
    this.immersionToggle.renderOrder = 7;
    this.immersionToggle.visible = false;
    this.root.add(this.immersionToggle);
    this.immersionEntity = world.createTransformEntity(this.immersionToggle, this.rootEntity);
    this.hover.immersion = new Spring(0);
    // 22 Oct: "Move desk here", right of the switch under the grid (14 × 4.6 cm), only while Places is open.
    const moveMaterial = createCardMaterial(drawButton('Recenter desk', DS.accent.lamp, false, 640));
    this.moveUniforms = moveMaterial.uniforms;
    this.moveChip = new Mesh(createQuad(MOVE_CHIP.w, Math.max(DS.minTarget, (MOVE_CHIP.w * 208) / 640)), moveMaterial);
    onPane(layout, MOVE_CHIP.x, GRID.dy[GRID.dy.length - 1] - 0.066, this.moveChip.position);
    this.moveChip.rotation.x = PANE.tilt;
    this.moveChip.renderOrder = 8;
    this.moveChip.visible = false;
    this.root.add(this.moveChip);
    this.moveEntity = world.createTransformEntity(this.moveChip, this.rootEntity);
    this.hover['move-desk'] = new Spring(0);
    // 26 Oct (lot 2b): the keepsakes stand on your table, in the desk's frame (one mesh, built once).
    this.root.add(this.keepsakes.mesh);
    // 28 Oct: the Tripo keepsakes and their atlas load in the background (stand-ins until then).
    void this.keepsakes.load(world.renderer);
    // 26 Oct: the lamp's own Places (PLACES_IN_GLOBE): ‹ › ×, and the title over the grown globe.
    for (const action of ['globe-prev', 'globe-next', 'globe-close'] as const) {
      const material = createCardMaterial(drawGlobeButton(action === 'globe-prev' ? 'prev' : action === 'globe-next' ? 'next' : 'close'));
      const size = action === 'globe-close' ? GLOBE_SHOW.button * 0.88 : GLOBE_SHOW.button;
      const mesh = new Mesh(createQuad(size, size), material);
      mesh.renderOrder = 8;
      mesh.visible = false;
      this.root.add(mesh);
      const entity = world.createTransformEntity(mesh, this.rootEntity);
      this.globeButtons.push({ action, mesh, entity, uniforms: material.uniforms });
      this.hover[action] = new Spring(0);
    }
    {
      const material = createCardMaterial(drawGlobeLabel('', 0, MENU_PLACES.length, -1, ''));
      this.globeLabelUniforms = material.uniforms;
      this.globeLabel = new Mesh(createQuad(GLOBE_SHOW.label, (GLOBE_SHOW.label * 224) / 768), material);
      this.globeLabel.renderOrder = 8;
      this.globeLabel.visible = false;
      this.root.add(this.globeLabel);
    }
    // The ritual menu: rows stacked beside the lamp, facing you (only one menu is open at a time).
    RITUAL_MENU.forEach((row, i) => {
      const material = createCardMaterial(drawRitualChip(row.id, row.name, row.sub, false, 0));
      const mesh = new Mesh(createQuad(0.19, 0.0553), material);
      // v8: a little higher and further back, so the Let go bowl's rim never covers the last row.
      const col = i < RITUAL_COLUMN.rows ? 0 : 1;
      const line = i % RITUAL_COLUMN.rows;
      mesh.position.set(RITUAL_COLUMN.farX + col * RITUAL_COLUMN.far, RITUAL_ROWS.farY - line * RITUAL_ROWS.farStep, RITUAL_COLUMN.farZ);
      mesh.rotation.set(-0.18, -0.2, 0, 'YXZ');
      mesh.renderOrder = 8;
      mesh.visible = false;
      this.root.add(mesh);
      const entity = world.createTransformEntity(mesh, this.rootEntity);
      const hover = new Spring(0);
      this.ritualChips.push({ id: row.id, mesh, entity, uniforms: material.uniforms, hover });
      this.hover[`ritual:${row.id}`] = hover;
    });
    // 29 Oct: the Settings rows stand where the ritual rows do (they never show together).
    SETTING_ROWS.forEach((row) => {
      const material = createCardMaterial(drawSettingChip(row.id, row.name, null, false));
      const mesh = new Mesh(createQuad(0.19, 0.0553), material);
      mesh.renderOrder = 8;
      mesh.visible = false;
      this.root.add(mesh);
      const entity = world.createTransformEntity(mesh, this.rootEntity);
      const hover = new Spring(0);
      this.settingChips.push({ id: row.id, mesh, entity, uniforms: material.uniforms, hover });
      this.hover[`setting:${row.id}`] = hover;
    });
  }

  get settingsShown(): boolean {
    return this.settingsOpen;
  }

  /** 29 Oct: opens / closes the Settings panel (closes the ritual menu and Places); `states` draws the switches. */
  openSettings(open: boolean, states?: SettingStates): void {
    this.settingsOpen = open;
    if (open) {
      if (this.ritualsOpen) this.openRituals(false);
      if (this.menuOpen) this.openPlaces(false);
      if (states != null) this.refreshSettings(states);
    }
  }

  /** Redraws the Settings rows' states (On / Off). */
  refreshSettings(states: SettingStates): void {
    for (const chip of this.settingChips) {
      const row = SETTING_ROWS.find((r) => r.id === chip.id)!;
      const on = chip.id === 'voice' ? states.voice : chip.id === 'text' ? states.text : chip.id === 'contrast' ? states.contrast : chip.id === 'gaze' ? states.gaze : null;
      chip.uniforms.uMap.value.dispose();
      chip.uniforms.uMap.value = drawSettingChip(chip.id, row.name, on == null ? null : on ? 'On' : 'Off', on === true);
    }
  }

  /** The one-time hint of the capsule: its edge pulses twice (≈ 2.4 s). */
  pulseImmersion(): void {
    this.immersionPulseT = 2.4;
  }

  /** 28 Oct: triangles of the Tripo lamp foot and GPU bytes of its textures (perf report). */
  footTriangles = 0;
  footBytes = 0;

  /**
   * 28 Oct: the lamp's foot becomes the Tripo walnut ring with its brass inlay (photoreal; the globe rests exactly
   * where it rested). The tray mesh is rebuilt once with it (same single draw call); the turned foot stays if
   * anything fails to load.
   */
  private async loadLampFoot(world: World, layout: DeskLayout): Promise<void> {
    try {
      const [gltf, albedo, nrm] = await Promise.all([
        new GLTFLoader().loadAsync('./models/lamp-foot.glb'),
        loadKtx2(world.renderer, './textures/lamp-foot-albedo.ktx2'),
        loadKtx2(world.renderer, './textures/lamp-foot-nrm-rough-metal.ktx2'),
      ]);
      const mesh = gltf.scene.getObjectByName('foot') as Mesh | undefined;
      if (mesh?.geometry == null || albedo == null || nrm == null) return;
      for (const t of [albedo, nrm]) {
        t.minFilter = LinearMipmapLinearFilter;
        t.magFilter = LinearFilter;
        t.anisotropy = 4;
        t.needsUpdate = true;
      }
      const old = this.tray.geometry;
      this.tray.geometry = createTrayGeometry(layout, mesh.geometry);
      old.dispose();
      this.trayUniforms.uFootAlb.value = albedo;
      this.trayUniforms.uFootNrm.value = nrm;
      this.trayUniforms.uFootTex.value = 1;
      this.footTriangles = (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
      this.footBytes = ktx2Bytes(albedo) + ktx2Bytes(nrm);
    } catch {
      // The turned foot stays.
    }
  }

  /** Bytes of GPU memory held by the oak (for the perf report). */
  oakBytes = 0;

  private async loadOak(world: World, u: Record<string, { value: unknown }>, preview: Texture): Promise<void> {
    const [albedo, nrm] = await Promise.all([loadKtx2(world.renderer, './textures/oak-albedo.ktx2'), loadKtx2(world.renderer, './textures/oak-nrm-rough.ktx2')]);
    if (albedo == null || nrm == null) return;
    for (const t of [albedo, nrm]) {
      t.wrapS = MirroredRepeatWrapping;
      t.wrapT = MirroredRepeatWrapping;
      t.anisotropy = 8;
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
      t.needsUpdate = true;
    }
    u.uWood.value = albedo;
    u.uWoodNrm.value = nrm;
    u.uWoodDetail.value = 1;
    this.oakBytes = ktx2Bytes(albedo) + ktx2Bytes(nrm);
    preview.dispose();
  }

  // ---------------------------------------------------------------- rituals (v6)

  get ritualMenuOpen(): boolean {
    return this.ritualsOpen;
  }

  /** Opens / closes the ritual menu; `proposed` gets the lamp's warm tint, `evenings` the quiet counts. */
  openRituals(open: boolean, proposed: RitualMenuId | null = null, evenings: Partial<Record<RitualKind, number>> = {}, hidden: RitualMenuId[] = []): void {
    this.ritualsOpen = open;
    if (open) {
      if (this.menuOpen) this.openPlaces(false);
      if (this.settingsOpen) this.settingsOpen = false;
      RITUAL_MENU.forEach((row, i) => {
        const chip = this.ritualChips[i];
        chip.uniforms.uMap.value.dispose();
        chip.uniforms.uMap.value = drawRitualChip(row.id, row.name, row.sub, row.id === proposed, row.id === 'sleep' || row.id === 'sky' ? 0 : (evenings[row.id] ?? 0));
        chip.mesh.visible = !hidden.includes(row.id);
      });
    }
  }

  /** "Rituals" normally; "Finish" while a Breathe or Release is running (ends it gently). */
  setRitualsLabel(finish: boolean): void {
    const label = finish ? 'Finish' : 'Rituals';
    if (label === this.ritualsLabel) return;
    this.ritualsLabel = label;
    this.ritualsUniforms.uMap.value.dispose();
    this.ritualsUniforms.uMap.value = drawOrnament(label, false, finish ? 'finish' : 'rituals');
  }

  /** The globe goes home to its foot. */
  orbHome(): void {
    this.skyBesideCaption = false;
    Object.assign(this.orbTarget, { x: this.orbLocal.x, y: this.orbLocal.y, z: this.orbLocal.z, scale: 1 });
  }

  /** v6 Breathe: the lamp's foot travels with the globe (desk-local offset from home) and grows. */
  setFootMove(dx: number, dz: number, scale: number): void {
    this.trayUniforms.uFootMove.value.set(dx, dz, scale);
  }

  /** Moves the globe (desk-local target, uniform scale). */
  orbTo(x: number, y: number, z: number, scale: number): void {
    this.skyBesideCaption = false;
    Object.assign(this.orbTarget, { x, y, z, scale });
  }

  /** The globe's distance from its foot (0 = home): the foot's cup dims as the globe leaves it. */
  get orbAway(): number {
    return Math.min(1, Math.hypot(this.orbPose.x - this.orbLocal.x, this.orbPose.y - this.orbLocal.y, this.orbPose.z - this.orbLocal.z) / 0.03);
  }

  get orbScale(): number {
    return this.orbPose.scale;
  }

  /** Moon look (0..1) and the breath that drives the globe's glow (-1 = its own resting breath). */
  setMoon(moon: number, breath: number): void {
    this.orbUniforms.uMoon.value = moon;
    this.orbUniforms.uBreath.value = breath;
  }

  get trayUniformsV6(): TrayUniforms {
    return this.trayUniforms;
  }

  // ------------------------------------------------------------------ places

  /** Redraws the voice toggle ("Voice" with sound arcs, or "Muted"). */
  setVoiceMuted(_muted: boolean): void {
    // 29 Oct: the bottom row's third button is Settings; the voice's state is its "Lamp voice" row (refreshSettings).
  }

  get placesOpen(): boolean {
    return this.menuOpen;
  }

  /** Opens / closes the Places menu (thumbnails are fetched the first time it opens). */
  openPlaces(open: boolean): void {
    this.menuOpen = open;
    if (open && this.ritualsOpen) this.openRituals(false);
    if (open && this.settingsOpen) this.settingsOpen = false;
    this.ornamentUniforms.uMap.value.dispose();
    this.ornamentUniforms.uMap.value = drawOrnament('Places', open);
    if (PLACES_IN_GLOBE) {
      if (open) {
        // The globe floats up and grows (never while a ritual drives it).
        if (!this.orbDirect) this.orbTo(GLOBE_SHOW.x, GLOBE_SHOW.y, GLOBE_SHOW.z, GLOBE_SHOW.radius / LAMP.globe);
        const here = this.backdrop.place;
        this.showInGlobe(here !== 'room' ? here : (MENU_PLACES[this.globeIndex] ?? MENU_PLACES[1]));
        for (const b of this.globeButtons) b.mesh.visible = true;
        this.globeLabel.visible = true;
        this.moveChip.visible = true;
      } else if (!this.orbDirect) {
        this.orbHome();
      }
      return;
    }
    if (open) {
      this.refreshChips();
      for (const id of MENU_PLACES) {
        const url = PLACES[id].thumb;
        if (url != null && !this.thumbs.has(id)) {
          const image = new Image();
          image.onload = () => this.refreshChips();
          image.src = url;
          this.thumbs.set(id, image);
        }
      }
      for (const chip of this.placeChips) chip.mesh.visible = true;
      this.moveChip.visible = true;
    }
  }

  /** The place the globe shows (PLACES_IN_GLOBE). */
  get globePlace(): PlaceId {
    return MENU_PLACES[this.globeIndex] ?? 'room';
  }

  /** Shows a place inside the globe (the carousel moves to it); its preview and its neighbours' are decoded. */
  showInGlobe(id: PlaceId): void {
    const i = MENU_PLACES.indexOf(id);
    if (i < 0) return;
    this.globeIndex = i;
    this.refreshGlobe();
  }

  /** ‹ / ›: the next place in the globe. Returns it. */
  stepGlobe(step: number): PlaceId {
    const n = MENU_PLACES.length;
    this.globeIndex = (((this.globeIndex + step) % n) + n) % n;
    this.refreshGlobe();
    return this.globePlace;
  }

  /** How to choose, said on the title (the input the person uses). */
  setGlobeHint(hint: string): void {
    if (hint === this.globeHint) return;
    this.globeHint = hint;
    if (this.menuOpen) this.refreshGlobe();
  }

  private refreshGlobe(): void {
    const id = this.globePlace;
    const n = MENU_PLACES.length;
    const here = this.backdrop.place;
    const name = id === 'room' ? 'Your room' : PLACES[id].name;
    // 29 Oct (live globe): the world follows the globe, so the line only says where you are, or that it is coming.
    const hint = id === here ? this.globeHint || 'You are here' : 'On the way…';
    this.globeLabelUniforms.uMap.value.dispose();
    this.globeLabelUniforms.uMap.value = drawGlobeLabel(name, this.globeIndex, n, MENU_PLACES.indexOf(here), hint);
    const keep = [id, MENU_PLACES[(this.globeIndex + 1) % n], MENU_PLACES[(this.globeIndex + n - 1) % n]];
    for (const k of keep) if (k !== 'room') void this.previews.load(k, keep);
  }

  /** Previews decoded for the globe (play-test report). */
  get globePreviewCount(): number {
    return this.previews.count;
  }

  /** How much the globe shows its place right now (0..1, play-test report). */
  get globeWindow(): number {
    return this.orbUniforms.uWindow.value;
  }

  /** Is the shown place's preview decoded, and its auto gain (play-test report). */
  get globeDebug(): { preview: boolean; gain: number; windowK: number } {
    return { preview: this.previews.get(this.globePlace) != null, gain: +this.orbUniforms.uPlaceGain.value.toFixed(2), windowK: +this.windowK.toFixed(2) };
  }

  /**
   * Lot 2b: the lamp shows your sky for a few seconds — it floats up and grows (as for Places), and inside: a dust
   * of stars (one per thing let go) and your constellation (one point per evening; `fresh`: the last evening's
   * point lights as you watch; `complete`: its lines draw in full).
   */
  showSky(points: ReadonlyArray<readonly [number, number]>, lit: number, dust: number, seconds: number, fresh: boolean, complete: boolean): void {
    const o = this.orbUniforms;
    const n = Math.min(points.length, FIG_MAX);
    for (let i = 0; i < FIG_MAX; i++) {
      const p = points[i];
      o.uFig.value[i].set(p?.[0] ?? 0, p?.[1] ?? 0, 0, 0);
      this.figLitTarget[i] = i < lit ? 1 : 0;
      this.figLit[i] = i < lit - (fresh ? 1 : 0) ? 1 : 0;
    }
    this.figNewAt = fresh && lit > 0 ? lit - 1 : -1;
    this.figNewDelay = 1.3;
    o.uFigN.value = n;
    // 28 Oct: the first GLOBE_STARS things let go float inside the clear glass (and stay there after the sky is
    // shown); the rest are the dust on the glass's disk (≈ one visible star each: cells outside the disk do not count).
    o.uStarN.value = Math.min(GLOBE_STARS, Math.max(0, Math.floor(dust)));
    o.uSkyDust.value = Math.min(290, Math.max(0, dust - GLOBE_STARS) * (324 / 254));
    this.skyLines = 0;
    this.skyLinesTarget = complete ? 1 : 0.55;
    this.skyT = seconds;
    if (!this.orbDirect && !this.menuOpen) {
      this.orbTo(GLOBE_SHOW.x, GLOBE_SHOW.y, GLOBE_SHOW.z, GLOBE_SHOW.radius / LAMP.globe);
      // 29 Oct: never in front of the caption (the milestone's sentence comes with the sky): see the caption layout.
      this.skyBesideCaption = true;
    }
  }

  get skyShown(): boolean {
    return this.skyT > 0;
  }

  /** Ends the sky now (a ritual starts, Places opens). */
  hideSky(): void {
    if (this.skyT <= 0) return;
    this.skyT = 0;
    if (!this.orbDirect && !this.menuOpen) this.orbHome();
  }

  private updateSky(dt: number): void {
    const o = this.orbUniforms;
    if (this.skyT > 0) {
      this.skyT -= dt;
      if (this.skyT <= 0 && !this.orbDirect && !this.menuOpen) this.orbHome();
    }
    const showing = this.skyT > 0 && !this.menuOpen;
    this.skyK = approach(this.skyK, showing ? 1 : 0, showing ? 3 : 4, dt);
    if (this.skyK < 0.002 && !showing) {
      o.uSky.value = 0;
      return;
    }
    if (this.figNewDelay > 0) this.figNewDelay -= dt;
    for (let i = 0; i < FIG_MAX; i++) {
      const target = i === this.figNewAt && this.figNewDelay > 0 ? 0 : this.figLitTarget[i];
      this.figLit[i] = approach(this.figLit[i], target, 2.2, dt);
      const f = o.uFig.value[i];
      f.z = this.figLit[i];
      f.w = i === this.figNewAt && this.figNewDelay <= 0 ? Math.max(0, 1 + this.figNewDelay * 0.4) : 0;
    }
    this.skyLines = approach(this.skyLines, this.skyK > 0.8 ? this.skyLinesTarget : 0, 0.9, dt);
    o.uFigLines.value = this.skyLines;
    o.uSky.value = this.skyK;
  }

  /** The globe as a window onto the place it shows: grows, fades the place in, keeps ‹ › and the title beside it. */
  private updateGlobePlaces(dt: number): void {
    if (!PLACES_IN_GLOBE) return;
    const open = this.menuOpen;
    this.globeK = approach(this.globeK, open ? 1 : 0, 5, dt);
    const o = this.orbUniforms;
    const id = this.globePlace;
    const tex = open && id !== 'room' ? this.previews.get(id) : null;
    if (tex !== this.shownPreview) {
      // A new place: the glass clouds over for a moment, then the new place clears in.
      this.windowK = approach(this.windowK, 0, 16, dt);
      if (this.windowK < 0.04) {
        this.shownPreview = tex;
        if (tex != null) {
          const place = PLACES[id];
          const g = place.grade;
          o.uPlaceTex.value = tex;
          o.uPlaceA.value.set(place.yaw + this.frameYaw, Math.min(g.exposure, 0.86), g.saturation, g.night);
          o.uPlaceTint.value.set(g.tint[0], g.tint[1], g.tint[2]);
          // Auto exposure: the place's mean (after its grade) brought to ≈ 0.07 — a night that still reads.
          const mean = (this.previews.mean(id) ?? 0.08) * Math.min(g.exposure, 0.86) * (1 - 0.6 * g.night);
          o.uPlaceGain.value = Math.min(4, Math.max(0.7, 0.07 / Math.max(mean, 1e-3)));
        }
      }
    } else {
      this.windowK = approach(this.windowK, tex != null ? 1 : 0, 5, dt);
    }
    o.uWindow.value = this.windowK * this.globeK * (1 - this.skyK);
    o.uGrown.value = Math.max(this.globeK, this.skyK);
    const k = this.globeK;
    const show = k > 0.02;
    const r = LAMP.globe * this.orbPose.scale;
    const cx = this.orbPose.x;
    const cy = this.orbPose.y;
    const cz = this.orbPose.z;
    for (const b of this.globeButtons) {
      b.mesh.visible = show;
      if (!show) continue;
      const hover = this.hover[b.action].step(dt);
      b.uniforms.uOpacity.value = k * (1 - this.dim * 0.4);
      b.uniforms.uHighlight.value = hover;
      b.mesh.rotation.x = GLOBE_SHOW.tilt;
      b.mesh.scale.setScalar((0.9 + 0.1 * k) * (1 + 0.06 * hover));
      const side = r + GLOBE_SHOW.gap + GLOBE_SHOW.button / 2;
      if (b.action === 'globe-prev') b.mesh.position.set(cx - side, cy, cz);
      else if (b.action === 'globe-next') b.mesh.position.set(cx + side, cy, cz);
      else b.mesh.position.set(cx + GLOBE_SHOW.label / 2 + GLOBE_SHOW.gap, cy + r + globeTitleDy(), cz - 0.004);
    }
    this.globeLabel.visible = show;
    if (show) {
      this.globeLabelUniforms.uOpacity.value = k;
      this.globeLabel.rotation.x = GLOBE_SHOW.tilt;
      this.globeLabel.position.set(cx, cy + r + globeTitleDy(), cz - 0.004);
      // 29 Oct: "Recenter desk" moved to Settings; the globe keeps its name, ‹ › and ×.
      this.moveChip.visible = false;
    } else if (!this.menuOpen) {
      this.moveChip.visible = false;
    }
  }

  private refreshChips(): void {
    const current = this.backdrop.place;
    for (const chip of this.placeChips) {
      chip.uniforms.uMap.value.dispose();
      chip.uniforms.uMap.value = drawPlaceChip(PLACES[chip.id].name, this.thumbs.get(chip.id) ?? null, chip.id === current);
    }
  }

  /** v8: redraws the immersion switch. */
  setImmersionFull(full: boolean): void {
    if (full === this.immersionFull) return;
    this.immersionFull = full;
    this.immersionUniforms.uMap.value.dispose();
    this.immersionUniforms.uMap.value = drawImmersionOrnament(full);
    this.immersionPulseDrawn = -1;
  }

  /** Crossfades to a place; the desk light follows. Resolves false if the photo could not load. */
  /** 26 Oct (safety nets): the adaptive quality's knobs (logic/quality.ts), applied quietly. */
  applyQuality(k: QualityKnobs): void {
    this.spirit.setDensity(k.aura);
    this.lights.density = k.dust;
    this.backdrop.setHdAllowed(k.hd);
    this.living.setLevel(k.living);
  }

  /**
   * 26 Oct (stability pass): every desk shader compiled before the desk first appears, while the table is being
   * found. The first frame of the desk used to compile ≈ 17 programs at once (a ≈ 200 ms stall at each arrival).
   * Hidden things (menus, the moon, the keepsakes) are shown for this synchronous call only; `extra` adds meshes
   * that do not exist yet (a stone).
   */
  precompile(extra: Mesh[] = []): void {
    const hidden: Array<{ visible: boolean }> = [];
    for (const m of extra) this.root.add(m);
    // The whole scene, not only the desk: the hands, the rain, the ghost hand, the dwell ring live beside it.
    this.prepScene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    void this.prepRenderer.compileAsync(this.prepScene, this.prepCamera).catch(() => {});
    // Their textures too (the oak, its normal map, the engraved labels, the cards): uploaded now, not at the reveal.
    const seen = new Set<unknown>();
    this.prepScene.traverse((o) => {
      const mats = (o as Mesh).material;
      for (const m of Array.isArray(mats) ? mats : mats != null ? [mats] : []) {
        const uniforms = (m as { uniforms?: Record<string, { value: unknown }> }).uniforms ?? {};
        for (const u of Object.values(uniforms)) {
          const t = u?.value as { isTexture?: boolean } | null;
          if (t?.isTexture === true && !seen.has(t)) {
            seen.add(t);
            this.prepRenderer.initTexture(t as Texture);
          }
        }
      }
    });
    for (const o of hidden) o.visible = false;
    for (const m of extra) this.root.remove(m);
  }

  /** 25 Oct: prepares a place in advance (panorama on the GPU, living layer compiled, sounds fetched). */
  async preparePlace(id: PlaceId): Promise<boolean> {
    const ok = await this.backdrop.prepare(id);
    if (ok) this.living.prepare(id, this.prepRenderer, this.prepCamera, this.prepScene);
    return ok;
  }

  async goPlace(id: PlaceId): Promise<boolean> {
    const ok = await this.backdrop.go(id);
    if (ok) {
      this.rain.setRain(PLACES[id].rain ?? null);
      this.living.setPlace(id);
    }
    if (this.menuOpen) {
      this.refreshChips();
      // 29 Oct (live globe): its label turns from "On the way" to "You are here" once the place is around you.
      this.refreshGlobe();
    }
    return ok;
  }

  place(frame: DeskFrame): void {
    this.root.position.set(frame.x, frame.y, frame.z);
    this.root.rotation.set(0, frame.yaw, 0);
    this.root.updateMatrixWorld(true);
    this.root.visible = true;
    this.backdrop.setDeskYaw(frame.yaw);
    this.frameYaw = frame.yaw;
    // The rain's floor point is under your eyes (≈ 45 cm toward you from the desk centre), on the real floor.
    this.rain.anchor(frame.x + Math.sin(frame.yaw) * 0.45, frame.z + Math.cos(frame.yaw) * 0.45, frame.yaw);
    this.living.anchor(frame.x + Math.sin(frame.yaw) * 0.45, frame.z + Math.cos(frame.yaw) * 0.45, frame.yaw);
    this.trayUniforms.uYaw.value = frame.yaw;
    // The lamp rig turns with the desk so the light always comes from behind-left.
    rig.uKeyDir.value.copy(KEY_LOCAL).applyAxisAngle(Y_AXIS, frame.yaw);
    this.trayUniforms.uKeyLocal.value.copy(KEY_LOCAL);
    rig.uPoolCenter.value.copy(POOL_LOCAL).applyMatrix4(this.root.matrixWorld);
    this.tmp.copy(this.orbLocal);
    rig.uOrbPos.value.copy(this.tmp.applyMatrix4(this.root.matrixWorld));
  }

  /** On a real table the tray casts a soft shadow; floating in the air it does not. */
  setGrounded(grounded: boolean): void {
    this.groundedFlag = grounded;
  }

  get grounded(): boolean {
    return this.groundedFlag;
  }

  get placed(): boolean {
    return this.root.visible;
  }

  /** Hides the glass row (Rituals · Places · Voice) for the 2D opening shot. */
  setOrnamentsHidden(hidden: boolean): void {
    this.ornamentsHidden = hidden;
  }

  setReveal(target: number): void {
    if (target > 0 && this.revealTarget === 0) {
      // The lamp wakes first: a filament warms up, flickers once, then the desk appears in its light.
      this.wakeT = 0;
      // The interface waits for the tray (23 Oct): hidden at once, it fades in once the light has found the tray.
      this.uiK = 0;
    } else if (target === 0) {
      this.wake = 0;
      this.wakeT = -1;
    }
    this.revealTarget = target;
  }

  /** Hides the desk at once (film: replay the arrival from darkness). */
  resetReveal(): void {
    this.reveal = 0;
    this.revealTarget = 0;
    this.wake = 0;
    this.wakeT = -1;
    this.trayUniforms.uReveal.value = 0;
  }

  /** The lamp speaks: warm pulses with the rhythm of the line (no voice synthesis, the caption carries the words). */
  speakFor(text: string): void {
    this.speakLeft = Math.min(3.2, 0.45 + text.length * 0.032);
  }

  setDim(target: number): void {
    this.dimTarget = target;
  }

  setBinGlow(index: number, value: number): void {
    for (let i = 0; i < 3; i++) {
      this.binGlowTarget[i] = i === index ? value : 0;
    }
  }

  /** 23 Oct: the bowl you look at while a stone is in hand or chosen ("drop here"), eased like the suggestion. */
  setGazeBin(index: number): void {
    for (let i = 0; i < 3; i++) this.gazeBinTarget[i] = i === index ? 1 : 0;
  }

  /**
   * FoV-aware caption relay (call every frame with the head position and view direction, world space): when the
   * desk caption is outside your view (> 42° from where you look; Quest 3S ≈ 96° wide) and the lamp spoke in the
   * last 7 s, a smaller copy floats in front of you, following lazily (≈ 0.4 s lag), and fades when you look back.
   */
  updateRelay(head: Vector3, dir: Vector3, dt: number): void {
    this.caption.getWorldPosition(this.relayTmp);
    const tx = this.relayTmp.x - head.x;
    const ty = this.relayTmp.y - head.y;
    const tz = this.relayTmp.z - head.z;
    const len = Math.hypot(tx, ty, tz) * (Math.hypot(dir.x, dir.y, dir.z) || 1);
    const angle = len < 1e-6 ? 0 : (Math.acos(Math.max(-1, Math.min(1, (tx * dir.x + ty * dir.y + tz * dir.z) / len))) * 180) / Math.PI;
    const capOpacity = this.captionUniforms.uOpacity.value;
    const want = this.root.visible && angle > 42 && this.lifeT - this.captionAt < 7 && capOpacity > 0.3 ? 1 : 0;
    this.relayK = approach(this.relayK, want, 3, dt);
    this.relay.visible = this.relayK > 0.02;
    if (!this.relay.visible) {
      this.relayPlaced = false;
      return;
    }
    const fl = Math.hypot(dir.x, dir.z) || 1;
    this.relayTo.set(head.x + (dir.x / fl) * 0.85, head.y - 0.1, head.z + (dir.z / fl) * 0.85);
    if (!this.relayPlaced) {
      this.relayPos.copy(this.relayTo);
      this.relayPlaced = true;
    } else {
      this.relayPos.lerp(this.relayTo, 1 - Math.exp(-2.5 * dt));
    }
    this.relay.position.copy(this.relayPos);
    this.relay.lookAt(head);
    this.relayUniforms.uOpacity.value = this.relayK * Math.min(1, capOpacity);
  }

  /** The agent's suggestion for the stone in hand: a faint breathing light in that bowl. */
  setSuggest(index: number): void {
    for (let i = 0; i < 3; i++) {
      this.suggestTarget[i] = i === index ? 1 : 0;
    }
  }

  /** Warm ember in the "Let go" bowl during a release. */
  setEmber(value: number): void {
    this.emberTarget = value;
  }

  pulseBin(index: number): void {
    this.trayUniforms.uBinPulse.value[index] = 1;
  }

  setCounts(tomorrow: number, later: number, letGo: number): void {
    const c = this.trayUniforms.uBinCount.value;
    c[0] = Math.min(tomorrow, 8);
    c[1] = Math.min(later, 8);
    c[2] = Math.min(letGo, 8);
  }

  /** Writes stone shadows: x, z (desk-local), height above the surface below, strength. */
  shadowSlots(): Vector4[] {
    return this.trayUniforms.uShadows.value;
  }

  get maxShadows(): number {
    return MAX_SHADOWS;
  }

  /** Cross-fades the caption to a new text. */
  say(text: string, sub = ''): void {
    this.pendingCaption = { text, sub };
    this.captionTarget = 0;
    // Every new line is the lamp speaking.
    if (text !== this.lastSpoken && this.root.visible && this.revealTarget > 0) {
      this.lastSpoken = text;
      this.speakFor(text);
    }
  }

  /** No caption (the 2D opening shot is a still life). */
  hideCaption(): void {
    this.pendingCaption = null;
    this.captionTarget = 0;
  }

  /** The evening's depth (0..1) and the night: the lamp lowers with the evening and, at night, goes out like a candle. */
  setEvening(depth: number, night: boolean): void {
    this.eveningDepth = depth;
    this.night = night;
  }

  /**
   * Touch replies under the caption (a proposal: "Yes" / "Not now"; Breathe: "Longer" / "Enough"). Null hides them.
   * They use the plan's two chips; the plan card, when it comes, takes them back with its own labels.
   */
  setReplies(labels: string[] | null, beside = false): void {
    const key = labels == null ? '' : `${labels.join('|')}${beside ? '>' : ''}`;
    // "beside" (Breathe): two equal glass capsules under the caption, no action colour (neither looks chosen).
    if (key === this.replyKey) return;
    this.replyKey = key;
    this.replyLabels = labels;
    this.repliesBeside = beside;
    if (labels == null) return;
    this.chipUniforms[0].uMap.value.dispose();
    this.chipUniforms[0].uMap.value = drawButton(labels[0], DS.accent.lamp, !beside, REPLY_NARROW * 640);
    if (labels[1] != null) {
      this.chipUniforms[1].uMap.value.dispose();
      this.chipUniforms[1].uMap.value = drawButton(labels[1], DS.accent.lamp, false, REPLY_NARROW * 640);
    }
    this.planLabelsDirty = true;
  }

  get repliesShown(): boolean {
    return this.replyLabels != null && this.cardTarget === 0 && !this.settingsOpen;
  }

  /** The quiet evening's touch words (null closes the grid and frees its textures). */
  /**
   * Words to touch (two rows of four), or suggestion bubbles (`wide`: a sentence spanning two columns; 24 Oct,
   * axe 4). Rows that are not full are centred.
   */
  setWords(words: Array<{ label: string; dim: boolean; accent: boolean; wide?: boolean }> | null): void {
    const key = words == null ? '' : words.map((w) => `${w.label}:${w.dim ? 1 : 0}${w.accent ? 1 : 0}${w.wide ? 1 : 0}`).join('|');
    if (key === this.wordKey) return;
    this.wordKey = key;
    this.wordsOpen = words != null && words.length > 0;
    // Lay out: fill rows of 4 columns; a wide chip takes 2.
    const slots: Array<{ start: number; row: number; span: number }> = [];
    let row = 0;
    let col = 0;
    for (const w of words ?? []) {
      const span = w.wide ? 2 : 1;
      if (col + span > 4) {
        row++;
        col = 0;
      }
      slots.push({ start: col, row, span });
      col += span;
    }
    const used = new Map<number, number>();
    for (const sl of slots) used.set(sl.row, Math.max(used.get(sl.row) ?? 0, sl.start + sl.span));
    this.wordChips.forEach((chip, i) => {
      const w = words?.[i];
      const sl = slots[i];
      if (chip.uniforms.uMap.value !== this.blank) chip.uniforms.uMap.value.dispose();
      chip.uniforms.uMap.value = w == null ? this.blank : drawWordChip(w.label, w.dim, w.accent, w.wide === true);
      chip.mesh.visible = w != null;
      chip.label = w?.label ?? null;
      if (sl != null) {
        chip.span = sl.span;
        chip.row = Math.min(sl.row, WORDS.dy.length - 1);
        chip.col = sl.start + (sl.span - 1) / 2 + (4 - (used.get(sl.row) ?? 4)) / 2;
      }
    });
  }

  get wordsShown(): boolean {
    return this.wordsOpen;
  }

  /**
   * 29 Oct (owner: "the top of the journal page is cut off"): the journal's page stands lower, nearer and a little
   * smaller, on the tray's back half (the bowls step aside while it is open), so the whole page, its two buttons and the
   * sky beside it fit a 16:9 frame seen from the seat (top edge ≈ 6° under the frame's top). The plan card is as before.
   */
  private cardPose: 'plan' | 'journal' = 'plan';

  showCard(content: CardContent, withChips: boolean, pose: 'plan' | 'journal' = 'plan'): void {
    this.cardPose = pose;
    if (pose === 'journal') {
      this.card.position.set(JOURNAL_CARD.x, JOURNAL_CARD.y, JOURNAL_CARD.z);
      this.card.rotation.x = JOURNAL_CARD.tilt;
    } else {
      this.card.position.set(0, 0.258, -this.layout.depth / 2 - 0.02);
      this.card.rotation.x = -0.26;
    }
    if (this.planLabelsDirty) {
      this.planLabelsDirty = false;
      this.chipUniforms[0].uMap.value.dispose();
      this.chipUniforms[0].uMap.value = drawButton('Keep this plan', DS.accent.lamp, true);
      this.chipUniforms[1].uMap.value.dispose();
      this.chipUniforms[1].uMap.value = drawButton('Make it lighter', DS.accent.lamp, false);
    }
    this.cardCanvas.draw(content);
    this.card.visible = true;
    this.cardTarget = 1;
    this.keepChip.visible = withChips;
    this.lighterChip.visible = withChips;
    this.captionLift.target = 1;
  }

  hideCard(): void {
    this.cardTarget = 0;
    this.keepChip.visible = false;
    this.lighterChip.visible = false;
    this.captionLift.target = 0;
  }

  setChipLabels(primaryOnly: boolean, primaryLabel = 'Keep this plan', secondaryLabel?: string): void {
    this.lighterChip.visible = !primaryOnly && this.keepChip.visible;
    const uniforms = this.chipUniforms[0];
    uniforms.uMap.value.dispose();
    uniforms.uMap.value = drawButton(primaryLabel, DS.accent.lamp, true);
    // 28 Oct (the journal's "Earlier" / "Close"): the second chip can be renamed too; the plan's own labels come
    // back with the next plan card.
    if (secondaryLabel != null) {
      this.chipUniforms[1].uMap.value.dispose();
      this.chipUniforms[1].uMap.value = drawButton(secondaryLabel, DS.accent.lamp, false);
    }
    this.planLabelsDirty = true;
  }

  /** 23 Oct — accessibility: caption scale (large text) and touch-chip scale. */
  private textK = 1;
  private chipK = 1;

  /**
   * Accessibility settings (logic/access.ts): high contrast switches every glass pane at once (one shared uniform);
   * large text makes the caption (and its relay) 30 % larger and the reply / word chips 10 % larger, spread apart
   * by as much so they never touch.
   */
  setAccess(contrast: boolean, largeText: boolean): void {
    CARD_CONTRAST.value = contrast ? 1 : 0;
    this.textK = largeText ? 1.3 : 1;
    this.chipK = largeText ? 1.1 : 1;
    this.caption.scale.setScalar(this.textK);
    this.relay.scale.setScalar(0.78 * this.textK);
  }

  /**
   * Gaze-only selection: the ring around what you look at fills (progress 0..1), placed 3 cm in front of the
   * target toward your eyes; alpha 0 hides it. No allocation.
   */
  showDwell(x: number, y: number, z: number, head: Vector3, progress: number, alpha: number): void {
    const ring = this.dwellRing;
    ring.visible = alpha > 0.01;
    if (!ring.visible) return;
    this.relayTmp.set(head.x - x, head.y - y, head.z - z);
    const d = this.relayTmp.length();
    if (d > 1e-4) this.relayTmp.multiplyScalar(Math.min(0.03, d * 0.5) / d);
    ring.position.set(x + this.relayTmp.x, y + this.relayTmp.y, z + this.relayTmp.z);
    ring.lookAt(head);
    // Same angular size at any distance (≈ 3.2°).
    ring.scale.setScalar(Math.max(0.6, d / 0.55));
    this.dwellUniforms.uProgress.value = progress;
    this.dwellUniforms.uAlpha.value = alpha;
  }

  /** Hover from a hand ray or a finger approaching (InputSystem `Hovered`). */
  setHover(action: string, on: boolean): void {
    const spring = this.hover[action as keyof typeof this.hover];
    if (spring != null) {
      spring.target = on ? 1 : 0;
    }
  }

  orbState(listening: boolean, thinking: boolean, level: number, hover: number, muted = false): void {
    this.orbMutedTarget = muted ? 1 : 0;
    this.orbListeningTarget = listening ? 1 : 0;
    this.orbThinkingTarget = thinking ? 1 : 0;
    this.orbLevel = Math.max(level, this.orbLevel * 0.85);
    this.orbHoverTarget = hover;
  }

  update(dt: number): void {
    this.ceilingSky.update(dt);
    const m = this.trayUniforms;
    this.backdrop.update(dt);
    this.rain.update(dt);
    this.living.update(dt);
    this.living.enforceLevel();
    // v6: the bowls slide into the tray for Breathe and Release (≈ 1.2 s), and come back.
    m.uBowlsAway.value = approach(m.uBowlsAway.value, this.bowlsAwayTarget, 2.6, dt);
    if (Math.abs(m.uBowlsAway.value - this.bowlsAwayTarget) < 0.002) m.uBowlsAway.value = this.bowlsAwayTarget;
    // v6: the globe glides (critically damped spring, no overshoot) to where the ritual wants it.
    const kOrb = 4.2; // ≈ 1.1 s to arrive, critically damped: it floats, it never bounces
    for (const key of ['x', 'y', 'z', 'scale'] as const) {
      if (this.orbDirect) {
        // Breathe drives the globe itself (already smooth): no lag on the breath.
        this.orbVel[key] = 0;
        this.orbPose[key] = this.orbTarget[key];
        continue;
      }
      const x = this.orbPose[key] - this.orbTarget[key];
      const v = this.orbVel[key];
      const a = -kOrb * kOrb * x - 2 * kOrb * v;
      this.orbVel[key] = v + a * dt;
      this.orbPose[key] += this.orbVel[key] * dt;
    }
    this.orb.position.set(this.orbPose.x, this.orbPose.y, this.orbPose.z);
    const big = this.orbPose.scale > 1.25;
    this.orb.geometry = big ? this.orbGeoMoon : this.orbGeoHome;
    // Lamp wake-up (≈ 1.4 s): warms, dips once like a filament, settles. The tray reveal waits for it.
    if (this.wakeT >= 0) {
      this.wakeT += dt;
      const t = this.wakeT;
      this.wake = t < 0.5 ? (t / 0.5) * 0.7 : t < 0.62 ? 0.7 - (t - 0.5) * 3.5 : Math.min(1, 0.28 + (t - 0.62) * 0.9);
      if (t > 1.5) {
        this.wake = 1;
        this.wakeT = -1;
      }
    }
    this.orbUniforms.uWake.value = (this.revealTarget > 0 ? this.wake : 1) * (1 - this.lampOut);
    const revealGate = this.wakeT >= 0 && this.wakeT < 0.55 ? 0 : this.revealTarget;
    // 23 Oct (first five seconds): a slower, silkier light front (≈ 2.3 s to 95 %) — the lamp wakes, then its light
    // finds the tray on your real table; the interface waits until the tray is fully there, then fades in.
    this.reveal = approach(this.reveal, revealGate, 1.3, dt);
    m.uReveal.value = this.reveal;
    this.uiK = approach(this.uiK, this.revealTarget > 0 && this.reveal > 0.97 ? 1 : this.revealTarget > 0 ? 0 : 1, 2.4, dt);
    this.trayUniforms.uContact.value = this.groundedFlag ? Math.min(1, this.reveal * 1.4) : 0;
    // The lamp's warm light spills onto the real table around it (passthrough only: in Full there is no table).
    this.poolK = approach(this.poolK, this.groundedFlag && this.backdrop.immersionLevel !== 'full' ? 1 : 0, 2, dt);
    this.trayUniforms.uPool.value = this.poolK * this.reveal * Math.min(1, this.wake + (this.wakeT < 0 ? 1 : 0)) * (1 - this.lampOut);
    this.dim = approach(this.dim, this.dimTarget, 0.7, dt);
    rig.uDim.value = this.dim;
    rig.uSleepDark.value = 1 - this.sleepLight;
    for (let i = 0; i < 3; i++) {
      m.uBinGlow.value[i] = approach(m.uBinGlow.value[i], this.binGlowTarget[i], 9, dt);
      m.uSuggest.value[i] = approach(m.uSuggest.value[i], Math.max(this.suggestTarget[i], this.gazeBinTarget[i]), 3.2, dt);
      m.uBinPulse.value[i] = Math.max(0, m.uBinPulse.value[i] - dt * 1.2);
    }
    m.uEmber.value = approach(m.uEmber.value, this.emberTarget, this.emberTarget > m.uEmber.value ? 6 : 1.5, dt);
    // Caption cross-fade: fade out, swap texture, fade in.
    const cap = this.captionUniforms.uOpacity;
    if (this.pendingCaption != null) {
      cap.value = Math.max(0, cap.value - dt * 5);
      if (cap.value <= 0.01) {
        this.captionCanvas.draw(this.pendingCaption.text, this.pendingCaption.sub);
        this.pendingCaption = null;
        this.captionAt = this.lifeT;
        this.captionTarget = 1;
      }
    } else {
      // 29 Oct (owner: the night's title turned grey and dull): the night never dims the caption — white, legible.
      cap.value = approach(cap.value, this.captionTarget * (1 - this.dim * (this.night ? 0 : 0.25)) * this.uiK, 6, dt);
    }
    // While the plan card is up, it carries the title: the caption steps aside (fades, rises a little).
    const lift = this.captionLift.step(dt, 120, 20);
    cap.value *= 1 - Math.min(1, Math.max(0, lift) * 4);
    // v8: the open Places grid takes the caption's plane (the caption fades out meanwhile); the open ritual
    // menu by the lamp pushes the caption left; in a place the caption rises a little over the immersion switch.
    const menuK = Math.max(0, Math.min(1, this.menuSpring.value));
    cap.value *= 1 - Math.min(1, menuK * 2.5);
    // 26 Oct (stability pass, draw budget): a caption faded out is not drawn at all (it cost a draw per eye).
    this.caption.visible = cap.value > 0.004;
    this.asideSpring.target = this.ritualsOpen || this.settingsOpen ? 1 : 0;
    const aside = this.asideSpring.step(dt, 150, 24);
    this.caption.scale.setScalar(this.textK * (1 - (1 - CAPTION_ASIDE_SCALE) * Math.max(0, Math.min(1, aside))));
    // v8: in Breathe the moon grows: the caption rises with it, so the moon never covers its lower line.
    const moonLift = Math.max(0, this.orbPose.scale - 1.5) * 0.014;
    this.wordSpring.target = this.wordsOpen && !this.ritualsOpen && !this.settingsOpen ? 1 : 0;
    const wk = Math.max(0, Math.min(1, this.wordSpring.step(dt, 160, 24)));
    // Touch menus come to you (airplane-seat test): a slow, calm glide (≈ 0.5 s).
    this.nearK = approach(this.nearK, this.menuOpen || this.wordsOpen || this.ritualsOpen || this.settingsOpen ? 1 : 0, 5, dt);
    const nk = this.nearK * this.nearK * (3 - 2 * this.nearK);
    // A lower head sees the near words higher against the far caption (parallax): the caption rises a little more.
    let over = CAPTION_OVER_WORDS;
    if (wk > 0.01 && nk > 0.01) {
      this.root.updateMatrixWorld();
      this.root.worldToLocal(this.camera.getWorldPosition(this.eyeLocal));
      over += Math.min(0.05, Math.max(0, (0.48 - this.eyeLocal.y) * 0.55));
      this.nearWordsNow.y = Math.max(0.12, Math.min(NEAR_WORDS.y, this.eyeLocal.y + 0.02));
    }
    this.captionDy = lift * 0.05 + moonLift + wk * WORDS.lift * (1 - nk) + wk * nk * over;
    // 29 Oct (coordinator review): while the lamp shows your sky, the globe stands right of the caption's pill, as far
    // as the pill's real width needs (seen from the seat); a very long sentence also slides the caption left.
    let skyShift = 0;
    if (this.skyBesideCaption && this.skyT > 0 && !this.orbDirect && !this.menuOpen) {
      const halfW = 0.36 * this.caption.scale.x;
      // The pill's right edge where the caption would stand without this shift (the canvas is wider than the pill).
      const pillRight = aside * CAPTION_ASIDE + (this.captionCanvas.box.x1 - 0.5) * 2 * halfW;
      const spot = skyGlobeLayout(pillRight, PANE.z(this.layout), { x: GLOBE_SHOW.x, z: GLOBE_SHOW.z, radius: GLOBE_SHOW.radius });
      this.orbTarget.x = spot.x;
      skyShift = cap.value > 0.004 ? spot.captionShift : 0;
    }
    this.skyCaptionShift = approach(this.skyCaptionShift, skyShift, 6, dt);
    onPane(this.layout, aside * CAPTION_ASIDE + this.skyCaptionShift, this.captionDy, this.caption.position);
    this.wordChips.forEach((chip, i) => {
      chip.mesh.rotation.x = onNearPane(this.layout, (WORDS.x[0] + chip.col * WORDS.step) * this.chipK, WORDS.dy[chip.row] * this.chipK, nk, chip.mesh.position, this.nearWordsNow);
      const hover = chip.hover.step(dt);
      chip.uniforms.uOpacity.value = Math.min(1, Math.max(0, wk * 1.3 - (i % 4) * 0.06)) * (1 - this.dim * 0.3) * this.uiK;
      chip.uniforms.uHighlight.value = hover;
      // Closer menus are spread tighter: the chips shrink by as much, so they never overlap (same angle to the eye).
      const ws = (0.94 + 0.06 * wk) * (1 + 0.05 * hover) * this.chipK * (1 + (NEAR_WORDS.spread - 1) * nk);
      chip.mesh.scale.set(ws * (chip.span === 2 ? WIDE_CHIP : 1), ws, 1);
      // A word that stepped aside (ritual menu open) cannot be touched either.
      chip.mesh.visible = chip.label != null && wk > 0.02;
    });
    // Card: spring in (scale 0.94 → 1 with opacity), calm fade out.
    this.cardSpring.target = this.cardTarget;
    const k = Math.max(0, Math.min(1.05, this.cardSpring.step(dt, 180, 24)));
    this.cardUniforms.uOpacity.value = Math.min(1, k);
    this.card.scale.setScalar((0.94 + 0.06 * k) * (this.cardPose === 'journal' ? JOURNAL_CARD.scale : 1));
    if (this.cardTarget === 0 && k < 0.01) {
      this.card.visible = false;
    }
    this.updateSky(dt);
    this.updateGlobePlaces(dt);
    this.keepsakes.update(dt);
    // Places menu: rows rise in one after another (spring), fade out when closed.
    this.menuSpring.target = this.menuOpen ? 1 : 0;
    const menu = Math.max(0, this.menuSpring.step(dt, 200, 24));
    this.placeChips.forEach((chip, i) => {
      chip.mesh.rotation.x = onNearPane(this.layout, GRID.x[i % GRID.x.length] + GRID_NEAR_SHIFT * nk, GRID.dy[Math.floor(i / GRID.x.length) % GRID.dy.length], nk, chip.mesh.position);
      const k = Math.min(1, Math.max(0, menu * 1.25 - i * 0.08));
      const hover = chip.hover.step(dt);
      chip.uniforms.uOpacity.value = k;
      chip.uniforms.uHighlight.value = hover;
      chip.mesh.scale.setScalar((0.9 + 0.1 * k) * (1 + 0.04 * hover) * (1 + (NEAR_MENU.spread - 1) * nk));
      if (!this.menuOpen && menu < 0.02) chip.mesh.visible = false;
    });
    if (!PLACES_IN_GLOBE) {
      const k = Math.min(1, Math.max(0, menu * 1.25 - this.placeChips.length * 0.08));
      this.moveChip.rotation.x = onNearPane(this.layout, MOVE_CHIP.x + GRID_NEAR_SHIFT * nk, GRID.dy[GRID.dy.length - 1] - 0.066, nk, this.moveChip.position);
      const hover = this.hover['move-desk'].step(dt);
      this.moveUniforms.uOpacity.value = k * (1 - this.dim * 0.4);
      this.moveUniforms.uHighlight.value = hover;
      this.moveChip.scale.setScalar((0.9 + 0.1 * k) * (1 + 0.04 * hover) * (1 + (NEAR_MENU.spread - 1) * nk));
      if (!this.menuOpen && menu < 0.02) this.moveChip.visible = false;
    }
    const placesHover = this.hover.places.step(dt);
    const ornamentOpacity = Math.min(1, this.reveal * 1.2) * this.uiK * (1 - this.dim * 0.5);
    // v7: while the Places menu is open its own button steps away (the rows close the menu; no duplicate control).
    // 24 Oct: the ritual menu is modal too: Places and Sound step away while it is open (one menu at a time; and the
    // fifth ritual row costs no draw call: 25 per eye at most).
    this.ritualModalK = approach(this.ritualModalK, this.ritualsOpen ? 1 : 0, 6, dt);
    // 29 Oct: the kept lights step back whenever there is glass to read (a question and its replies, words to
    // touch, a page, a menu) and during the other rituals and the night; full light only in their own moments (Keep,
    // Your sky) or when nothing is open.
    const hush = this.lights.skyUniforms.uKeptHush;
    const reading = this.ritualsOpen || this.cardTarget === 1 || this.placesOpen || this.replyLabels != null || this.wordsOpen;
    hush.value = approach(hush.value, !this.keptFull && (this.keptQuiet || reading) ? 1 : 0, 3, dt);
    this.nightRowK = approach(this.nightRowK, this.ornamentsNight ? 1 : 0, 2.5, dt);
    const nightRow = 1 - this.nightRowK;
    const modal = 1 - this.ritualModalK;
    // 29 Oct: the Settings panel is modal like the ritual menu: Rituals and Places step away while it is open.
    this.settingsModalK = approach(this.settingsModalK, this.settingsOpen ? 1 : 0, 6, dt);
    const setModal = 1 - this.settingsModalK;
    this.ornamentUniforms.uOpacity.value = ornamentOpacity * Math.max(0, 1 - menu * 1.6) * modal * nightRow * setModal;
    // The opening shot (2D page) is a still life: tray, bowls, lamp; the glass row appears with the evening.
    this.ornament.visible = !this.ornamentsHidden && !(this.menuOpen && menu > 0.6) && this.ritualModalK < 0.95 && this.nightRowK < 0.98 && this.settingsModalK < 0.95;
    // 29 Oct (owner): « Mixed | Full » joins the row's end while you are in a place; the row stays centred.
    const inPlace = PLACES[this.backdrop.place].photo != null;
    this.immersionRowK = approach(this.immersionRowK, inPlace && !this.ornamentsHidden && !this.ornamentsNight ? 1 : 0, 6, dt);
    const ik = this.immersionRowK;
    const rowW = 3 * BOTTOM_ROW.button + 2 * BOTTOM_ROW.gap + ik * (BOTTOM_ROW.gap + BOTTOM_ROW.capsule);
    const x0 = -rowW / 2 + BOTTOM_ROW.button / 2;
    const rz = ORNAMENT_ROW.z(this.layout);
    this.ritualsOrnament.position.set(x0, ORNAMENT_ROW.y, rz);
    this.ornament.position.set(x0 + BOTTOM_ROW.button + BOTTOM_ROW.gap, ORNAMENT_ROW.y, rz);
    this.voiceButton.position.set(x0 + 2 * (BOTTOM_ROW.button + BOTTOM_ROW.gap), ORNAMENT_ROW.y, rz);
    this.immersionToggle.position.set(rowW / 2 - BOTTOM_ROW.capsule / 2, ORNAMENT_ROW.y, rz);
    if (this.immersionPulseT > 0) this.immersionPulseT = Math.max(0, this.immersionPulseT - dt);
    // Two soft pulses (sin² over 2 × 1.2 s), redrawn in 6 steps only (a canvas upload per step, not per frame).
    const pulse = this.immersionPulseT > 0 ? Math.sin(((2.4 - this.immersionPulseT) / 1.2) * Math.PI) ** 2 : 0;
    const pulseStep = Math.round(pulse * 5);
    if (pulseStep !== this.immersionPulseDrawn) {
      this.immersionPulseDrawn = pulseStep;
      this.immersionUniforms.uMap.value.dispose();
      this.immersionUniforms.uMap.value = drawImmersionOrnament(this.immersionFull, pulseStep / 5);
    }
    const immHover = this.hover.immersion.step(dt);
    this.immersionUniforms.uOpacity.value = ornamentOpacity * ik * nightRow;
    this.immersionUniforms.uHighlight.value = Math.max(immHover, pulse * 0.6);
    this.immersionToggle.scale.setScalar((0.9 + 0.1 * ik) * (1 + 0.05 * immHover + 0.04 * pulse));
    this.immersionToggle.visible = ik > 0.02 && this.nightRowK < 0.98 && !this.ornamentsHidden;
    // 26 Oct (stability pass, draw budget): the lamp showing the places is modal too — Rituals and Sound step away
    // (× and the voice close it), two draws per eye saved: 23 per eye with the globe open.
    const globeModal = 1 - this.globeK;
    this.ritualsOrnament.visible = !this.ornamentsHidden && this.globeK < 0.95 && this.nightRowK < 0.98 && this.settingsModalK < 0.95;
    this.voiceButton.visible = !this.ornamentsHidden && this.ritualModalK < 0.95 && this.globeK < 0.95 && this.nightRowK < 0.98;
    this.ornamentUniforms.uHighlight.value = placesHover;
    this.ornament.scale.setScalar((1 + 0.06 * placesHover) * (1 - 0.12 * Math.min(1, menu)));
    const voiceHover = this.hover.voice.step(dt);
    this.voiceUniforms.uOpacity.value = ornamentOpacity * modal * globeModal * nightRow;
    this.voiceUniforms.uHighlight.value = voiceHover;
    this.voiceButton.scale.setScalar(1 + 0.06 * voiceHover);
    const keepHover = this.hover.keep.step(dt);
    const lighterHover = this.hover.lighter.step(dt);
    // Replies (no card up): the same two chips fade in under the caption.
    this.replySpring.target = this.replyLabels != null && this.cardTarget === 0 ? 1 : 0;
    const rk = Math.max(0, Math.min(1, this.replySpring.step(dt, 170, 24)));
    if (this.cardTarget === 0) {
      const two = this.replyLabels != null && this.replyLabels.length > 1;
      // While the lamp shows the places, its question waits (one thing at a time; the globe stands there).
      // 29 Oct: Settings open, the question waits too (one thing at a time).
      const free = Math.max(this.globeK, this.skyK, this.settingsModalK) < 0.5;
      this.keepChip.visible = rk > 0.01 && free;
      this.lighterChip.visible = rk > 0.01 && two && free;
    }
    this.chipUniforms[0].uOpacity.value = Math.min(1, Math.max(k, rk)) * this.uiK;
    this.chipUniforms[1].uOpacity.value = Math.min(1, Math.max(k, rk)) * this.uiK;
    this.chipUniforms[0].uHighlight.value = keepHover;
    this.chipUniforms[1].uHighlight.value = lighterHover;
    // Replies (Yes / Not now, Longer / Enough) are narrower capsules (10.5 cm, same 4.9 cm height for the finger);
    // the plan card's chips keep their full width. The x scale matches the canvas.
    const narrow = this.cardTarget === 0 && this.replyLabels != null ? REPLY_NARROW : 1;
    const ck = this.chipK;
    this.keepChip.scale.set(narrow * (1 + 0.05 * keepHover) * ck, (1 + 0.05 * keepHover) * ck, 1);
    this.lighterChip.scale.set(narrow * (1 + 0.05 * lighterHover) * ck, (1 + 0.05 * lighterHover) * ck, 1);
    if (this.cardTarget === 0 && this.replyLabels != null && this.repliesBeside) {
      // Breathe (28 Oct): one on each side of the moon, on the near side (the full moon hid them on the caption
      // plane, and that plane is out of reach): equal size, larger text spreads them apart by as much.
      const l = breatheReplyPose(-1, ck);
      const r = breatheReplyPose(1, ck);
      this.keepChip.position.set(l.x, l.y + 0.004 * keepHover, l.z);
      this.lighterChip.position.set(r.x, r.y + 0.004 * lighterHover, r.z);
      this.keepChip.rotation.x = l.tilt;
      this.lighterChip.rotation.x = r.tilt;
    } else if (this.cardTarget === 1 && this.cardPose === 'journal') {
      // The journal's two buttons lie in front of its page, on the tray (the bowls are away).
      this.keepChip.position.set(JOURNAL_CARD.x - 0.085 * ck, JOURNAL_CARD.chipY + 0.006 * keepHover, JOURNAL_CARD.chipZ);
      this.lighterChip.position.set(JOURNAL_CARD.x + 0.085 * ck, JOURNAL_CARD.chipY + 0.006 * lighterHover, JOURNAL_CARD.chipZ);
      this.keepChip.rotation.x = -0.75;
      this.lighterChip.rotation.x = -0.75;
    } else {
      // Replies (no card) sit 2 cm higher than the plan card's chips: clear of the tray behind the bowls.
      const chipY = this.cardTarget === 0 ? 0.108 : 0.088;
      // 29 Oct: with the ritual menu open, the answers follow their question to the left (they slid behind the menu).
      const ax = this.cardTarget === 0 ? Math.max(0, Math.min(1, aside)) * CAPTION_ASIDE : 0;
      this.keepChip.position.set(ax - 0.085 * ck, chipY + 0.006 * keepHover, -this.layout.depth / 2 + 0.03);
      this.lighterChip.position.set(ax + 0.085 * ck, chipY + 0.006 * lighterHover, -this.layout.depth / 2 + 0.03);
      this.keepChip.rotation.x = -0.7;
      this.lighterChip.rotation.x = -0.7;
    }
    // Lamp: listening brightens it, the voice level makes it breathe, thinking shimmers.
    const o = this.orbUniforms;
    this.orbListening = approach(this.orbListening, this.orbListeningTarget, 6, dt);
    o.uListening.value = this.orbListening;
    o.uThinking.value = approach(o.uThinking.value, this.orbThinkingTarget, 4, dt);
    o.uLevel.value = approach(o.uLevel.value, this.orbLevel, 18, dt);
    o.uHover.value = Math.max(this.hover.orb.step(dt), approach(o.uHover.value, this.orbHoverTarget, 10, dt));
    this.orbMuted = approach(this.orbMuted, this.orbMutedTarget, 4, dt);
    o.uMuted.value = this.orbMuted;
    // Speaking: syllable-like pulses (two incommensurate rhythms), eased in and out.
    if (this.speakLeft > 0) {
      this.speakLeft -= dt;
      this.speakPhase += dt;
    }
    const syl = 0.5 + 0.5 * Math.sin(this.speakPhase * 11.0) * Math.sin(this.speakPhase * 3.7 + 0.6);
    // With the voice on, the glow follows the loudness of the words themselves.
    this.speak = this.voiceLevel >= 0 ? approach(this.speak, this.voiceLevel, 22, dt) : approach(this.speak, this.speakLeft > 0 ? syl : 0, 14, dt);
    o.uSpeak.value = this.speak;
    this.orb.scale.setScalar(this.orbPose.scale * (1 + 0.06 * this.hover.orb.value));
    const wakeK = o.uWake.value;
    // The living lamp (owner, 18 Oct): a slow breath (≈ 6 per minute) and a very soft flame flutter (all under 3 Hz,
    // never a blink); lower as the evening deepens; at night it goes out like a candle (≈ 6 s, a last waver).
    this.lifeT += dt;
    const moonK = this.orbUniforms.uMoon.value;
    const t = this.lifeT;
    const flutter = 0.022 * Math.sin(t * 2 * Math.PI * 1.3) * Math.sin(t * 2 * Math.PI * 0.37 + 1.1) + 0.014 * Math.sin(t * 2 * Math.PI * 2.1 + 0.4);
    const life = 1 + (1 - moonK) * (0.07 * Math.sin(t * 2 * Math.PI * 0.1) + flutter);
    this.lampOut = approach(this.lampOut, this.night ? 1 : 0, this.night ? 0.18 : 2, dt);
    const out = this.lampOut;
    const candle = out > 0.6 ? 1 + 0.12 * Math.sin(t * 2 * Math.PI * 1.7) * (1 - out) : 1;
    const evening = (1 - 0.22 * this.eveningDepth) * (1 - out) * candle * this.sleepLight;
    const energy = (0.62 + this.orbListening * 0.45 + o.uLevel.value * 0.8 + o.uHover.value * 0.25 + this.speak * 0.4 + o.uThinking.value * 0.2) * wakeK * (1 - this.orbMuted * 0.8) * life * evening;
    // The moon's halo is wider and warmer than the little lamp's (the glow quad scales with the globe).
    const moon = this.orbUniforms.uMoon.value;
    const halo = (0.16 + energy * 0.3) * (1 - this.dim * 0.4) * (1 + moon * 1.1);
    this.energy = energy;
    // The globe never leaves its foot (v6 review): the lamp travels and grows as one object.
    m.uLampGlow.value = energy;
    m.uFootAway.value = 0;
    // The globe's light follows it (and grows with it: the moon lights the tray and your hands).
    const s = this.orbPose.scale;
    // The main light of the tray as the night comes: a warm pool on the wood, the bowls and the stones.
    rig.uOrbPower.value = (0.06 * (1 - out) * this.sleepLight + energy * (0.24 + 0.14 * this.eveningDepth)) * this.reveal * (1 + (s - 1) * 0.55) * (1 - 0.45 * Math.max(this.globeK, this.skyK));
    this.root.updateMatrixWorld();
    this.orb.getWorldPosition(this.worldTmp);
    rig.uOrbPos.value.copy(this.worldTmp);
    // The lamp looks at you: its heart and its aura turn toward your eyes (world direction for the globe's shader,
    // the globe's own space for the aura).
    this.camera.getWorldPosition(this.spiritLook);
    o.uLook.value.copy(this.spiritLook).sub(this.worldTmp).normalize();
    o.uLookK.value = Math.min(1, o.uHover.value / 0.6);
    this.orb.worldToLocal(this.spiritLook).normalize();
    this.spirit.update(
      {
        energy,
        speak: this.speak,
        listen: this.orbListening * Math.min(1, 0.35 + o.uLevel.value * 2),
        think: o.uThinking.value,
        lookK: o.uLookK.value,
        alpha: wakeK * (1 - out) * (1 - moonK) * (1 - this.orbMuted * 0.7) * this.reveal * (1 - Math.max(this.globeK, this.skyK)),
        halo,
      },
      this.spiritLook,
    );
    rig.uOrbRadius.value = LAMP.globe * s;
    rig.uOrbEnergy.value = energy * this.reveal;
    // A few golden motes drift up around the lamp (the dust field already exists: no extra draw call).
    // 29 Oct: half as many (the close-up read them as glitter with the aura).
    if (this.reveal > 0.9 && out < 0.5 && moonK < 0.2 && this.lifeT - this.moteAt > 2.8) {
      this.moteAt = this.lifeT + Math.random() * 1.6;
      this.lights.drift(this.worldTmp.x, this.worldTmp.y + 0.01, this.worldTmp.z, 1, 0.025, 0.06, 0.006, 5.5);
    }
    // Ritual menu rows rise in like the Places rows.
    // Lot 2b: while the lamp shows your sky, its proposal waits (one thing at a time), then the rows rise.
    this.ritualSpring.target = this.ritualsOpen && this.uiK > 0.6 && this.skyK < 0.3 ? 1 : 0;
    const rm = Math.max(0, this.ritualSpring.step(dt, 200, 24));
    // The rows stand upright and turn to face you (yaw only): never sheared like italics, wherever you sit.
    if (rm > 0.001) {
      this.root.updateMatrixWorld();
      this.root.worldToLocal(this.camera.getWorldPosition(this.headLocal));
    }
    const rowK = this.nearK * this.nearK * (3 - 2 * this.nearK);
    this.ritualChips.forEach((chip, i) => {
      if (rm > 0.001) {
        // Airplane-seat test: the rows glide from beside the lamp (≈ 77 cm from the shoulder) to in front of the
        // Let go bowl, lower (≈ 60 cm). 28 Oct: two columns of four.
        const col = i < RITUAL_COLUMN.rows ? 0 : 1;
        const row = i % RITUAL_COLUMN.rows;
        const farX = RITUAL_COLUMN.farX + col * RITUAL_COLUMN.far;
        const nearX = RITUAL_COLUMN.nearX + col * RITUAL_COLUMN.near;
        chip.mesh.position.set(
          farX + (nearX - farX) * rowK,
          RITUAL_ROWS.farY - row * RITUAL_ROWS.farStep + (RITUAL_ROWS.nearY - row * RITUAL_ROWS.nearStep - (RITUAL_ROWS.farY - row * RITUAL_ROWS.farStep)) * rowK,
          RITUAL_COLUMN.farZ + (RITUAL_COLUMN.nearZ - RITUAL_COLUMN.farZ) * rowK,
        );
        const p = chip.mesh.position;
        chip.mesh.rotation.set(-0.08, Math.atan2(this.headLocal.x - p.x, this.headLocal.z - p.z), 0, 'YXZ');
      }
      const kk = Math.min(1, Math.max(0, rm * 1.25 - (i % RITUAL_COLUMN.rows) * 0.08 - (i < RITUAL_COLUMN.rows ? 0 : 0.04)));
      const hover = chip.hover.step(dt);
      chip.uniforms.uOpacity.value = kk;
      chip.uniforms.uHighlight.value = hover;
      chip.mesh.scale.setScalar((0.9 + 0.1 * kk) * (1 + 0.04 * hover) * RITUAL_ROWS.scale);
      if ((!this.ritualsOpen || this.skyK > 0.3) && rm < 0.02) chip.mesh.visible = false;
      else if (this.ritualsOpen && rm > 0.02) chip.mesh.visible = true;
    });
    // 29 Oct: the Settings rows rise in where the ritual rows stand (same columns, same airplane-seat glide).
    this.settingSpring.target = this.settingsOpen && this.uiK > 0.6 ? 1 : 0;
    const sm = Math.max(0, this.settingSpring.step(dt, 200, 24));
    if (sm > 0.001 && rm <= 0.001) {
      this.root.updateMatrixWorld();
      this.root.worldToLocal(this.camera.getWorldPosition(this.headLocal));
    }
    this.settingChips.forEach((chip, i) => {
      if (sm > 0.001) {
        const col = i < RITUAL_COLUMN.rows ? 0 : 1;
        const row = i % RITUAL_COLUMN.rows;
        const farX = RITUAL_COLUMN.farX + col * RITUAL_COLUMN.far;
        const nearX = RITUAL_COLUMN.nearX + col * RITUAL_COLUMN.near;
        chip.mesh.position.set(
          farX + (nearX - farX) * rowK,
          RITUAL_ROWS.farY - row * RITUAL_ROWS.farStep + (RITUAL_ROWS.nearY - row * RITUAL_ROWS.nearStep - (RITUAL_ROWS.farY - row * RITUAL_ROWS.farStep)) * rowK,
          RITUAL_COLUMN.farZ + (RITUAL_COLUMN.nearZ - RITUAL_COLUMN.farZ) * rowK,
        );
        const p = chip.mesh.position;
        chip.mesh.rotation.set(-0.08, Math.atan2(this.headLocal.x - p.x, this.headLocal.z - p.z), 0, 'YXZ');
      }
      const kk = Math.min(1, Math.max(0, sm * 1.25 - (i % RITUAL_COLUMN.rows) * 0.08 - (i < RITUAL_COLUMN.rows ? 0 : 0.04)));
      const hover = chip.hover.step(dt);
      chip.uniforms.uOpacity.value = kk;
      chip.uniforms.uHighlight.value = hover;
      chip.mesh.scale.setScalar((0.9 + 0.1 * kk) * (1 + 0.04 * hover) * RITUAL_ROWS.scale);
      chip.mesh.visible = sm > 0.02;
    });
    const ritualsHover = this.hover.rituals.step(dt);
    this.ritualsUniforms.uOpacity.value = ornamentOpacity * (1 - this.globeK) * (1 - this.nightRowK) * (1 - this.settingsModalK);
    this.ritualsUniforms.uHighlight.value = ritualsHover;
    this.ritualsOrnament.scale.setScalar(1 + 0.06 * ritualsHover);
    this.lights.flush();
    this.syncPointers();
  }

  private pointerTargets: Array<{ mesh: Mesh; opacity: () => number }> | null = null;

  /**
   * 26 Oct (CPU pass): a hidden or faded glass button is not tested by the hand rays and pokes at all. The pointer
   * library raycasts every interactable each frame whether it is shown or not (IWSDK's input system was the largest
   * CPU cost of a frame, measured at ×6).
   */
  private syncPointers(): void {
    if (this.pointerTargets == null) {
      const t: Array<{ mesh: Mesh; opacity: () => number }> = [];
      const card = (mesh: Mesh, u: CardUniforms) => t.push({ mesh, opacity: () => u.uOpacity.value });
      for (const c of this.placeChips) card(c.mesh, c.uniforms);
      for (const c of this.ritualChips) card(c.mesh, c.uniforms);
      for (const c of this.settingChips) card(c.mesh, c.uniforms);
      for (const c of this.wordChips) card(c.mesh, c.uniforms);
      for (const c of this.globeButtons) card(c.mesh, c.uniforms);
      card(this.keepChip, this.chipUniforms[0]);
      card(this.lighterChip, this.chipUniforms[1]);
      card(this.moveChip, this.moveUniforms);
      card(this.ornament, this.ornamentUniforms);
      card(this.voiceButton, this.voiceUniforms);
      card(this.ritualsOrnament, this.ritualsUniforms);
      card(this.immersionToggle, this.immersionUniforms);
      this.pointerTargets = t;
    }
    for (const { mesh, opacity } of this.pointerTargets) {
      const on = mesh.visible && opacity() > 0.03;
      const m = mesh as Mesh & { pointerEvents?: string };
      if (m.pointerEvents == null) continue; // not registered by IWSDK yet
      const want = on ? 'auto' : 'none';
      if (m.pointerEvents !== want) m.pointerEvents = want;
    }
  }
}
