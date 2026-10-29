/**
 * The evening ritual, end to end, as one ECS system:
 *
 *   placement on a real table (plane detection) or a floating desk
 *   → brain dump by voice (agent turns speech into stones)
 *   → sorting by hand (generous grab, magnetic halos) or by voice
 *   → "Let go" release moment (dissolve, motes, a new star, spatial sound)
 *   → tomorrow's gentle plan (agent proposes, a pinch confirms)
 *   → night: memory, streak, your sky of let-go worries
 *   → morning: the kept plan comes back.
 *
 * Per-frame work is allocation-free; everything else is event-driven.
 */
import {
  Box3,
  Color,
  createSystem,
  Euler,
  Grabbed,
  Hovered,
  Mesh,
  OneHandGrabbable,
  PokeInteractable,
  Pressed,
  Quaternion,
  RayInteractable,
  Vector2,
  Vector3,
  SceneUnderstandingSystem,
  Vector4,
  VisibilityState,
  XRMesh,
  XRPlane,
  type Entity,
} from '@iwsdk/core';
import { createDeskLayout, binById, BIN_IDS, BIN_STONE_SCALE, classifyDrop, deskToWorld, homePosition, nearestBinIndex, slotPosition, worldToDesk, type BinId, type DeskFrame, type DeskLayout, type Vec3 } from '../logic/desk-layout.ts';
import { easeToward, GAZE, gazeAngle, GazeFocus, gazePick, type GazeTarget } from '../logic/gaze.ts';
import { accessLine, DWELL_SELECT, parseAccessCommand, type AccessPrefs } from '../logic/access.ts';
import { answerOf, isForgetCommand } from '../logic/recall.ts';
import { bubbleLines, DONE_BUBBLE, hesitation } from '../logic/bubbles.ts';
import { TtsPlayer } from '../voice/tts-player.ts';
import { benchBackdrop } from '../desk/backdrop-bench.ts';
import { spokenSentences, TALK_OPENING, talkClock, WIND_DOWN_LINE, type TalkReply, type TalkTurn } from '../shared/agent/talk.ts';
import { cleanSummary, crisisInModelText, crisisSignal, CRISIS_REPLY, HELP_ROWS } from '../shared/agent/safety.ts';

/** 28 Oct: the mix's sound rail stands this far behind the voice rail (desk-local metres). */
const MIX_RAIL_GAP = 0.075;

/** 28 Oct: where the lamp shows your sky while the journal's page is open (to the page's right, desk-local). */
const JOURNAL_GLOBE = { x: 0.33, y: 0.2, z: -0.06 } as const;

/** The last place chosen (not your room), prepared first in calm moments. */
const LAST_PLACE_KEY = 'wdd.lastPlace';

/** Seconds of silence before the example stone when suggestion bubbles are offered (8 s otherwise, onboarding.ts). */
const BUBBLES_BEFORE_EXAMPLE = 14;
import { EXAMPLE_STONE, ghostFrame, ghostTarget, onboardingStep, SPOKEN_EXAMPLE } from '../logic/onboarding.ts';
import { GhostHand, HandLook } from '../desk/hands.ts';
import { nearness } from '../logic/hand-look.ts';
import { followUpQuestion, starPosition, type Recall } from '../logic/memory.ts';
import { figureFor, isSkyCommand, KEEPSAKE, MILESTONES, milestoneLine, milestoneToCelebrate, plantGrowth, type Milestone } from '../logic/milestones.ts';
import { KEEPSAKE_AT } from '../desk/keepsakes.ts';
import { guard } from '../runtime-guard.ts';
import { perfOpts } from '../perf-opts.ts';
import { StoneBatch } from '../desk/stone-batch.ts';
import type { QualityLevel } from '../logic/quality.ts';
import { clearOfSurfaces, fallbackFrame, frameOnTable, type HeadPose, type PlaneCandidate } from '../logic/placement.ts';
import { chooseSurface, meshTop, type MeshBox, type SurfaceChoice } from '../logic/surfaces.ts';
import { bearingCaption, bearingOf, decideAfterRestore, type Bearing, type PlaceSource, type RestoreDecision } from '../logic/desk-anchor.ts';
import { DeskAnchorService } from '../xr/desk-anchor-service.ts';
import { SurfaceProbe } from '../xr/surface-probe.ts';
import { caption, dumpEndsOnSort, initialRitual, step, type RitualEvent, type RitualState } from '../logic/ritual.ts';
import { startFresh, type EveningSpan } from '../logic/evening-reset.ts';
import { SortingSession, type TokenState } from '../logic/session.ts';
import { binLabel, isDeskMove, parseIntent, parseVoiceToggle, VOICE_HELP, type IntentContext } from '../logic/voice-intents.ts';
import { goingLine } from '../logic/lamp-lines.ts';
import { LampVoice } from '../desk/lamp-voice.ts';
import { DEMO_BRAIN_DUMP } from '../shared/agent/demo.ts';
import type { TomorrowPlan } from '../shared/agent/types.ts';
import { DS, Spring } from '../desk/design-tokens.ts';
import { DeskVisuals, GLOBE_SHOW, PLACES_IN_GLOBE } from '../desk/desk-visuals.ts';
import { bowlFloorAt, createPebbleGeometry, TRAY } from '../desk/geometry.ts';
import { createStoneMaterial, linkShared, STONE_LABEL, type StoneUniforms } from '../desk/materials.ts';
import { normalize } from '../logic/text.ts';
import { isPlaceId, parseGlobeCommand, parsePlaceCommand, PLACE_IDS, PLACES, type Immersion, type PlaceId } from '../logic/places.ts';
import { rig, timeUniform } from '../desk/materials.ts';
import { masterSound, setMasterSound, SoundBank } from '../desk/sounds.ts';
import { StoneAtlas } from '../desk/text-canvas.ts';
import { DeskButton, WeightStone, WorryToken } from '../ritual-components.ts';
import { services } from '../services.ts';
import { breathCaption, breathLine, BreatheSession, opennessFromCurl, type BreathFrame } from '../logic/breathe.ts';
import { initialRelease, overWater, releaseCaption, stepRelease, WATER_BOWL, type ReleaseEvent, type ReleaseState } from '../logic/release.ts';
import { parseRitualCommand, proposeRitual, PROPOSAL_LINES, type EveningMode, type Proposal, type RitualCommand, type RitualKind } from '../logic/evening.ts';
import { MOON, PEARL_ROW, RitualVisuals } from '../desk/ritual-visuals.ts';
import { LAMP, moonCentreY } from '../desk/geometry.ts';
import { DONE_LABEL, releaseChoices, unloadChoices, WRITE_LABEL } from '../logic/style.ts';
import { eveningStep, eveningTarget } from '../logic/evening-light.ts';
import { requestWrite } from '../voice/keyboard.ts';
import { secs, track } from '../visits.ts';
import { PauseGate, xrVisible } from '../logic/pause.ts';
import { checkoutLine, nightSummary, parseTension, RAIL, railTouch, TENSION_LINES, TENSION_WORDS, tensionArrow, TensionDial, tensionU, tensionWord, type TensionSide } from '../logic/tension.ts';
import { TensionRail } from '../desk/tension-rail.ts';
import { goodThing, isKeepDone, KEEP_COUNT, KEEP_LINES, keepChoices, keepLine, KEPT_FLIGHT, keptPlace, keptPlaceNear } from '../logic/keep.ts';
/** 29 Oct: world size of a kept light's quad: tonight's (in view, lighting the tray) and earlier evenings' (the ring). */
const KEPT_NEAR_SIZE = 0.17;
/** 29 Oct (Good night): the room's darkening while your sky is up, and the stars' rise (s). */
const NIGHT_DIM = 0.78;
const NIGHT_RISE = { gather: 0.9, step: 0.09, spread: 2.8, travel: 4.8 } as const;
const KEPT_RING_SIZE = 0.06;
const KEPT_WALL_OLD_SIZE = 0.1;
import { dateLabel, entryRows, entrySubtitle, isJournalCommand, journalEntries, parseJournalCommand, shortDate, weekSummary, type JournalEntry } from '../logic/journal.ts';
import { constellationSegments, eveningSkyPoint, skyDisc, type SkyStar } from '../logic/night-sky.ts';
import { keptOnWall, pickKeepWall, wallsFrom, type OrientedPlane, type Wall } from '../logic/walls.ts';
import { MAX_SKY_LINES } from '../desk/ceiling-sky.ts';
import { ceilingPoint, DimGesture, dimStrokeSeconds, findCeiling, parseSleepCommand, SLEEP_LINES, SLEEP_MINUTES, sleepLevels, UNANSWERED_STAY_S, type Ceiling } from '../logic/sleep.ts';
import { eveningDate } from '../logic/memory.ts';
import { setMasterLevel } from '../desk/sounds.ts';
import { MIX_LINES, mixLevels, parseMixCommand } from '../logic/mix.ts';
import { STAR_SLOTS } from '../desk/particles.ts';
import { FistState, squeezeButton, squeezeCaption, squeezeLine, SqueezeSession, type SqueezeFrame } from '../logic/squeeze.ts';

interface Stone {
  id: string;
  entity: Entity;
  mesh: Mesh;
  uniforms: StoneUniforms;
  cell: number;
  // Tween (world space).
  from: Vector3;
  to: Vector3;
  t: number;
  duration: number;
  arc: number;
  moving: boolean;
  delay: number;
  arrive: (() => void) | null;
  glow: number;
  glowTarget: number;
  scaleTarget: number;
  /** Scale spring (pops in with a little overshoot, swells 6 % in the hand). */
  scale: Spring;
  /** Squash on landing (tactile "clack"). */
  squash: Spring;
  /** Hover lift (visionOS-style: highlight + a few millimetres toward you). */
  lift: Spring;
  liftApplied: number;
  /** 0..1: soft gaze halo level (eased, never flashing). */
  gazeK: number;
  /** Small yaw offset so the stones do not line up like tiles (text stays readable). */
  yawJitter: number;
  dissolving: number; // < 0: not dissolving; else seconds elapsed
  done: number;
  emitted: number;
}

/** Listeners told where the desk landed (the emulator film set uses it). */
export const deskPlacedListeners: Array<(frame: DeskFrame, mode: 'table' | 'floating' | 'preview', plane: PlaneCandidate | null) => void> = [];

const RELEASE_HOLD = 0.55;
const RELEASE_DURATION = 2.1;

/** Height of the bowl's inner surface at distance `r` from its centre (desk-local). */
function bowlFloor(r: number): number {
  return bowlFloorAt(r);
}

/** On a table the tray's underside rests on the surface: the desk frame (tray top) sits higher. */
function lifted(frame: DeskFrame, mode: 'table' | 'floating'): DeskFrame {
  return mode === 'table' ? { ...frame, y: frame.y + TRAY.height } : frame;
}

/** Gaze ids of the bowls (same order as BIN_IDS). */
const BIN_GAZE_IDS = ['bin:tomorrow', 'bin:later', 'bin:let-go'];

function easeInOut(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

/** True when the object and all its parents are visible (a hidden menu's chips are not gaze targets). */
function visibleInScene(obj: { visible: boolean; parent: unknown }): boolean {
  let o: { visible: boolean; parent: unknown } | null = obj;
  while (o != null) {
    if (!o.visible) return false;
    o = o.parent as typeof o;
  }
  return true;
}

/** 29 Oct: a touch on the open globe this soon after its arrows / Places / the switch is a brush, not a choice. */
const GLOBE_BRUSH_S = 0.9;
/** 29 Oct: a second press on an answer button or a word this soon after the last one is the same touch. */
const ANSWER_DEBOUNCE_S = 0.5;
const isAnswerAction = (action: string): boolean => action === 'keep' || action === 'lighter' || action.startsWith('word:');

function ordinalWord(n: number): string {
  return ['', 'once', 'twice', 'three times', 'four times', 'five times'][n] ?? `${n} times`;
}

export class RitualSystem extends createSystem({
  stones: { required: [WorryToken] },
  held: { required: [WorryToken, Grabbed] },
  weightHeld: { required: [WeightStone, Grabbed] },
  pressed: { required: [DeskButton, Pressed] },
  hovered: { required: [DeskButton, Hovered] },
  buttons: { required: [DeskButton] },
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
}) {
  private layout!: DeskLayout;
  private visuals!: DeskVisuals;
  private sounds!: SoundBank;
  private voice!: LampVoice;
  private atlas!: StoneAtlas;
  private stoneShapes: Array<ReturnType<typeof createPebbleGeometry>> = [];
  private stoneCount = 0;
  private stoneMaterialProto!: ReturnType<typeof createStoneMaterial>;
  private session = new SortingSession();
  private ritual: RitualState = initialRitual();
  private frame: DeskFrame | null = null;
  private placementMode: 'table' | 'floating' | 'preview' | null = null;
  private placementStart = -1;
  /** 22 Oct: where tonight's place came from (restored anchor, plane, mesh, hit test, floating). */
  private placeSource: PlaceSource | null = null;
  /** The desk's persistent anchor (same place evening after evening) and the hit-test probe (rooms never scanned). */
  private readonly deskAnchor = new DeskAnchorService();
  private readonly probe = new SurfaceProbe();
  private anchorDecision: RestoreDecision | null = null;
  /** "Move my desk" waiting for the hit-test probe (no plane / mesh table where you sit now). */
  private pendingMove: { since: number; quiet: boolean } | null = null;
  /** A desk restored outside your view: its sound plays again once if you have not turned to it. */
  private offscreenCueAt = -1;
  private lastBearing: Bearing | null = null;
  // 23 Oct — the first minute, shown not told (logic/onboarding.ts) and a desk that answers you.
  private firstEvening = false;
  private lastActivity = 0;
  private exampleShown = false;
  private ghostT = 0;
  private ghostStone: string | null = null;
  private ghostSuggest = false;
  private gazeTipAt = -1;
  private gazeTipShown = false;
  private sortedNow = 0;
  private lampGazeK = 0;
  private readonly hoveredIds = new Set<string>();
  private hoverSoundAt = -1;
  private readonly gazeFocus = new GazeFocus(GAZE.dwell, GAZE.release);
  private readonly gazeQ = new Quaternion();
  private gazeSource: 'eyes' | 'head' = 'head';
  private gazeGain = 1;
  private gazedBin = -1;
  /** Look and pinch: the stone chosen by gaze + pinch, waiting for a bowl. */
  private chosenId: string | null = null;
  /** Test / film only (debug API `lamp(state)`): forces one of the lamp's states. */
  private lampDemo: 'idle' | 'listen' | 'speak' | 'think' | 'look' | null = null;
  private lampDemoSpeakAt = 0;
  /**
   * 24 Oct — agent memory: a yes / no question of the lamp's own (a follow-up, "forget everything?"). It takes the
   * reply chips (touch, gaze dwell) and short spoken answers, before anything else.
   */
  private ask: { labels: [string, string]; actions: [() => void, () => void]; key: string } | null = null;
  /** Yesterday's open "Tomorrow" stones, checked one by one at the start of a returning evening. */
  private followUps: Array<{ text: string; id: string | null }> = [];
  private followUpIndex = 0;
  private followUpsDone = 0;
  private askStone: string | null = null;
  /** 24 Oct — "Talk it through": the talk in progress (bounded history; talk.ts), and the lamp's dynamic voice. */
  private talk: { summary: string; turns: TalkTurn[]; weights: string[]; startedAt: number; announced: boolean; busy: boolean; queued: string | null; closing: boolean } | null = null;
  private tts: TtsPlayer | null = null;
  /** After a refusal (no voice configured, budget reached), the voice is not asked again for a while: captions. */
  private ttsRetryAt = 0;
  /** The help card is on the desk (it goes when the talk or the ritual ends). */
  private helpShown = false;
  /** 25 Oct — places prepared in calm moments (no loading pause, no frozen frame when one is chosen). */
  private prepBusy = false;
  private prepAt = 0;
  private readonly prepLog: Array<{ id: string; why: string; ms: number; ok: boolean }> = [];
  /** Suggested replies (axe 4), decided ten times a second with the onboarding (no per-frame allocation). */
  private bubbles: string[] | null = null;
  private bubbleKey = '';
  private readonly usedBubbles = new Set<string>();
  /** 23 Oct — accessibility (logic/access.ts) and gaze-only selection by dwell. */
  private access: AccessPrefs = { gazeSelect: false, contrast: false, largeText: false };
  private dwellId: string | null = null;
  private dwellT = 0;
  private dwellAlpha = 0;
  /** After a selection, the same object needs the gaze to leave before it can be chosen again. */
  private dwellLock: string | null = null;
  private dwellHover: string | null = null;
  private dwellHintShown = false;
  /** Gaze id ("btn:<action>") ↔ action, cached so no string is built per frame. */
  private readonly btnGazeId = new Map<string, string>();
  private readonly btnAction = new Map<string, string>();
  private chosenAt = 0;
  private readonly onSelect = (e: XRInputSourceEvent) => this.onSelectStart(e.inputSource);
  private selectSession: XRSession | null = null;
  private readonly gazeDir: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly gazePool: GazeTarget[] = [];
  private readonly handLook = new HandLook();
  private abOff = false;
  /** 23 Oct — pause / resume (logic/pause.ts): headset off, Meta menu, tab hidden. */
  private readonly pauseGate = new PauseGate();
  private pausedAt = -1;
  private readonly onXrVisibility = () => this.applyPause(this.pauseGate.set('xr', xrVisible(this.selectSession?.visibilityState)));
  private readonly onPageVisibility = () => this.applyPause(this.pauseGate.set('page', !document.hidden));
  private readonly emulated = typeof window !== 'undefined' && (window as unknown as { IWER_DEVICE?: unknown }).IWER_DEVICE != null;
  private ghost!: GhostHand;
  private readonly ghostAt = new Vector3();
  private readonly relayHead = new Vector3();
  private readonly relayDir = new Vector3();
  private readonly ghostTo = new Vector3();
  /** An immersive session was really entered (the visit log's xr-exit is sent only then). */
  private xrEntered = false;
  /** The surface tonight's desk sits on (debug API, report). */
  private placedOn: Record<string, unknown> | null = null;
  private readonly stones = new Map<string, Stone>();
  private readonly pendingDrops: Entity[] = [];
  private elapsed = 0;
  private sessionStart = 0;
  private lastId: string | null = null;
  private gazedId: string | null = null;
  private plan: TomorrowPlan | null = null;
  private planBusy = false;
  private extracting = 0;
  private exampleUsed = false;
  private heardLine = '';
  private captionOverride: { text: string; sub: string; until: number } | null = null;
  private baseCaption = { text: '', sub: '' };
  private planKept = false;
  private goodnightAt = -1;
  private morning: ReturnType<typeof services.memory.morningPlan> = null;
  private shadowSeen = 0;
  private lastDropAt = -10;
  private masterApplied = false;
  // Quiet evening (and touch everywhere): the words grid and the two reply chips, with what each touch does.
  private readonly usedTopics = new Set<string>();
  private wordActions: Array<() => void> = [];
  private replyActions: Array<() => void> = [];
  private touchKey = '';
  /** How deep into the night (0..1): the places, your room and the lamp follow it (logic/evening-light.ts). */
  private evening = 0.12;
  private eveningGoal = 0.12;
  // Scratch (no per-frame allocation).
  private readonly v = new Vector3();
  private readonly v2 = new Vector3();
  private readonly local: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly world3: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly gazeTargets: GazeTarget[] = [];

  // ------------------------------------------------------------ v6: the evening and its rituals
  private rv!: RitualVisuals;
  private mode: EveningMode = 'arrive';
  private proposal: Proposal | null = null;
  /** Hand rays (and their cursor dots) rest during Breathe and Release: hands are for breathing and holding. */
  private setRays(on: boolean): void {
    const pointers = (this.world.input as unknown as { xr?: { multiPointers?: Record<'left' | 'right', { toggleSubPointer(kind: string, enabled: boolean): boolean }> } }).xr?.multiPointers;
    if (pointers == null) return;
    for (const side of ['left', 'right'] as const) {
      try {
        pointers[side]?.toggleSubPointer('ray', on);
      } catch {
        // Older input stacks: rays simply stay.
      }
    }
  }

  /** Unload stones step aside (shrink away, not grabbable) during Breathe and Release. */
  private stonesAway = 0;
  private stonesAwayTarget = 0;
  private stonesGrabbable = true;
  private breath: BreatheSession | null = null;
  private breathKey = '';
  private breathMoteAt = 0;
  private release: ReleaseState | null = null;
  private weight: {
    mesh: Mesh;
    entity: Entity;
    uniforms: StoneUniforms;
    cell: number;
    rest: Vec3;
    /** Scripted motion (desk-local): glide, fall, sink. */
    anim: { kind: 'glide' | 'fall' | 'sink' | 'none'; t: number; from: Vec3; to: Vec3; duration: number; then: (() => void) | null };
    vy: number;
    sinkT: number;
    held: boolean;
    title: string;
  } | null = null;
  private weightShape: ReturnType<typeof createPebbleGeometry> | null = null;
  /** 26 Oct (draw budget): every stone and the Release weight drawn by one instanced mesh (desk/stone-batch.ts). */
  private stoneBatch!: StoneBatch;
  private releaseDoneAt = -1;
  private weightLeaving = false;
  private readonly hands = {
    left: { tracked: false, palm: new Vector3(), open: 0 },
    right: { tracked: false, palm: new Vector3(), open: 0 },
  };
  private readonly jointTmp = new Vector3();

  // ------------------------------------------------------------ 28 Oct: the product pass (fields)
  /** "How heavy tonight?": the bead's rail, its dial while it waits, which moment, and what comes after. */
  private tensionRail!: TensionRail;
  private tensionDial: TensionDial | null = null;
  private tensionSide: TensionSide | null = null;
  private tensionThen: (() => void) | null = null;
  private tensionTickValue = -1;
  /** Good night already asked how heavy it is now (a second "good night" goes straight to the night). */
  private checkoutAsked = false;
  private readonly tipTmp = new Vector3();
  private readonly pressLog: string[] = [];
  private pressCount = 0;
  /**
   * 29 Oct (hands only): in this brain dump, has the person spoken (a real transcript), or only touched / typed?
   * Only speech makes "picking up a stone" mean "I'm done talking" (logic/ritual.ts dumpEndsOnSort).
   */
  private dumpSpoke = false;
  /** When an arrow, Places or the switch was last touched (a globe touch right after is a brush). */
  private globeNavAt = -1e9;
  /** When an answer button or a word was last really pressed (one touch never answers twice). */
  private answerPressAt = -1e9;
  /** The arrival bead was offered on this page already (a second XR entry does not ask it again). */
  private arrivalBeadAsked = false;
  /** 29 Oct: this desk session's evening (date, Good night reached, stones placed) — a finished one starts fresh. */
  private eveningSpan: EveningSpan = { startedOn: null, goodnight: false, placed: 0 };
  private dumpTouched = false;
  /** Last real input (a transcript, a touch, a typed line, a pinch): the bubbles' noise-proof clock. */
  private lastInputAt = 0;
  private abProduct = false;
  /** Test / film: the index fingertips last seen by fingerOnRail (world), to aim emulated hands in closed loop. */
  private readonly lastTips: Record<'left' | 'right', { x: number; y: number; z: number } | null> = { left: null, right: null };
  /** "Squeeze and let go": the session, its last phase key, a fist per hand, and the light's own clock. */
  private squeeze: SqueezeSession | null = null;
  private squeezeKey = '';
  private readonly fists = { left: new FistState(), right: new FistState() };
  private squeezeWasClosed = false;
  private squeezeMoteAt = 0;
  /** When the light last escaped (the palms flare for a moment). */
  private squeezeFlareAt = -10;
  private readonly lampTmp = new Vector3();
  /** Keep: good things kept in this ritual, the touch words already used. */
  private keepCount = 0;
  private readonly keepUsed = new Set<string>();
  private keepDoneAt = -1;
  /** The journal (Your sky): its pages, the one shown, the star looked at. */
  private journal: { entries: JournalEntry[]; index: number; week: string } | null = null;
  private starTexts: Array<{ text: string; date: string; seed: number }> = [];
  private readonly starIds = Array.from({ length: STAR_SLOTS }, (_, i) => `star:${i}`);
  private starGazeId: string | null = null;
  private starGazeT = 0;
  private starShown = -1;
  private readonly starTmp = { x: 0, y: 0, z: 0 };
  /** The living night: the steps after Good night, the ceiling found, and the slow fade of "stay till I sleep". */
  private nightSeq: { at: number; step: number; askedAt: number } | null = null;
  private ceiling: Ceiling | null = null;
  /** 29 Oct: how much the night darkens your room (eased; the stay-till-sleep fade takes it further). */
  private nightDim = 0;
  private sleep: { start: number; minutes: number; boost: number; phase: number; via: string } | null = null;
  private readonly dimGestures = { left: new DimGesture(), right: new DimGesture() };
  /** The voice / sound mix in the headset: two rails (voice in front, sound behind), open while set. */
  private mixRails: { voice: TensionRail; sound: TensionRail } | null = null;
  private mixOpen = false;
  private mixIdle = 0;
  private mixTouch: 'voice' | 'sound' | null = null;
  private mixTick = -1;
  /** The Sound button held: a short touch mutes as always; held 0.7 s, the mix opens. */
  private soundHeldAt = -1;
  private soundHoldUsed = false;

  init(): void {
    this.layout = createDeskLayout();
    this.visuals = new DeskVisuals(this.world, this.layout);
    this.sounds = new SoundBank(this.world);
    // Living places write every sound they start into the same log (the demo film lays the real audio).
    this.visuals.living.audioLog = this.sounds.log;
    this.voice = new LampVoice(this.world);
    this.atlas = new StoneAtlas();
    this.ghost = new GhostHand(this.world);
    this.access = services.access.get();
    this.visuals.setAccess(this.access.contrast, this.access.largeText);
    services.access.onChange((prefs) => {
      this.access = prefs;
      this.visuals.setAccess(prefs.contrast, prefs.largeText);
    });
    // Seven pebble shapes (size, oval, egg, tilt, thickness all differ); stones cycle through them.
    for (let seed = 1; seed <= 7; seed++) {
      this.stoneShapes.push(createPebbleGeometry(this.layout.tokenRadius * 1.08, this.layout.tokenRadius * 0.9, this.layout.tokenHeight * 1.5, 0.02, seed, -this.layout.tokenHeight / 2));
    }
    this.stoneMaterialProto = createStoneMaterial(this.atlas.texture, new Vector2(this.atlas.canvas.width, this.atlas.canvas.height));
    // The Release weight's shape is made now so that it joins the instanced stones (same topology, its own size).
    this.weightShape = createPebbleGeometry(0.06, 0.042, 0.026, 0.025, 11, -0.013);
    this.stoneBatch = new StoneBatch([...this.stoneShapes.map((s) => s.geometry), this.weightShape.geometry], this.stoneMaterialProto);
    this.stoneBatch.attach(this.world.scene);

    // The lamp is touched, not pointed at: a hand ray sweeping past it while carrying a stone must never mute the mic.
    this.visuals.orbEntity.addComponent(PokeInteractable).addComponent(DeskButton, { action: 'orb' });
    this.visuals.keepEntity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(DeskButton, { action: 'keep' });
    this.visuals.lighterEntity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(DeskButton, { action: 'lighter' });
    this.visuals.ornamentEntity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(DeskButton, { action: 'places' });
    this.visuals.voiceEntity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(DeskButton, { action: 'voice' });
    this.visuals.immersionEntity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(DeskButton, { action: 'immersion' });
    this.visuals.moveEntity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(DeskButton, { action: 'move-desk' });
    this.visuals.setVoiceMuted(this.voice.muted);
    this.masterApplied = false;
    for (const chip of this.visuals.placeChips) {
      chip.entity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(DeskButton, { action: `place:${chip.id}` });
    }
    for (const b of this.visuals.globeButtons) {
      b.entity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(DeskButton, { action: b.action });
    }
    // v6: the ritual ornament ("Rituals", or "Finish" during a ritual) and the menu rows.
    this.rv = new RitualVisuals(this.world, this.visuals);
    this.tensionRail = new TensionRail(this.visuals.root);
    // 28 Oct: the mix's two rails (voice, sound); the sound rail stands 7.5 cm further back.
    this.mixRails = { voice: new TensionRail(this.visuals.root), sound: new TensionRail(this.visuals.root) };
    this.mixRails.sound.mesh.position.z = -MIX_RAIL_GAP;
    this.mixRails.voice.drawLabels('voice', 'louder');
    this.mixRails.sound.drawLabels('sound', 'louder');
    services.mix.onChange(() => {
      this.sounds.applyMix();
      this.tts?.setVolume(mixLevels.voice);
    });
    this.visuals.setRitualsLabel(false);
    this.visuals.ritualsEntity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(DeskButton, { action: 'rituals' });
    for (const chip of this.visuals.ritualChips) {
      chip.entity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(DeskButton, { action: `ritual:${chip.id}` });
    }
    this.visuals.wordChips.forEach((chip, i) => {
      chip.entity.addComponent(RayInteractable).addComponent(PokeInteractable).addComponent(DeskButton, { action: `word:${i}` });
    });
    this.voice.quiet = services.style.quiet;
    services.style.onChange((style) => {
      track('style', { style }, `style:${style}`);
      this.voice.quiet = style === 'quiet';
      if (style === 'quiet') this.voice.stop();
      this.lastPhaseSpoken = '';
      this.refreshCaption();
    });
    this.queries.weightHeld.subscribe('qualify', () => this.onWeightPick());
    this.queries.weightHeld.subscribe('disqualify', () => this.onWeightDrop());

    this.queries.held.subscribe('disqualify', (entity) => this.pendingDrops.push(entity));
    this.queries.held.subscribe('qualify', (entity) => this.onPick(entity));
    this.queries.pressed.subscribe('qualify', (entity) => {
      const action = String(entity.getValue(DeskButton, 'action'));
      // 29 Oct (solidity tests): the last real touches (a fingertip or a ray), so a test knows a poke landed.
      this.pressCount++;
      this.pressLog.push(action);
      if (this.pressLog.length > 40) this.pressLog.shift();
      // 29 Oct (found by emulated hands): the answer buttons and the words change meaning under the finger ("Keep
      // this plan" becomes "Yes" a moment later, a new word slides into place): one touch fired twice and started
      // a ritual nobody chose. A second answer / word press within 0.5 s of the last one is that same touch.
      if (isAnswerAction(action)) {
        if (this.elapsed - this.answerPressAt < ANSWER_DEBOUNCE_S) return;
        this.answerPressAt = this.elapsed;
      }
      // 28 Oct: the Sound button acts on release (a short touch mutes as always); held 0.7 s it opens the mix.
      if (action === 'voice') {
        this.soundHeldAt = this.elapsed;
        this.soundHoldUsed = false;
        return;
      }
      this.onButton(action);
    });
    this.queries.pressed.subscribe('disqualify', (entity) => {
      if (String(entity.getValue(DeskButton, 'action')) !== 'voice' || this.soundHeldAt < 0) return;
      this.soundHeldAt = -1;
      if (!this.soundHoldUsed) this.onButton('voice');
    });
    this.queries.hovered.subscribe('qualify', (entity) => {
      const action = String(entity.getValue(DeskButton, 'action'));
      this.visuals.setHover(action, true);
      // A hand (or a ray) on a place: it is probably the next one, prepared right now.
      if (action.startsWith('place:')) void this.preparePlace(action.slice(6) as PlaceId, 'hover');
    });
    this.queries.hovered.subscribe('disqualify', (entity) => this.visuals.setHover(String(entity.getValue(DeskButton, 'action')), false));

    // 26 Oct (stability pass): every desk shader compiled now, while the table is being found — not on the first
    // frame of the desk (≈ 200 ms stall at each arrival, measured).
    this.visuals.precompile([new Mesh(this.stoneShapes[0].geometry, this.stoneMaterialProto)]);
    // In the headset the renderer builds its XR variants of the programs: compiled again as the session starts,
    // while the table is being found (the desk is not shown yet), never on the frame the desk appears.
    this.renderer.xr.addEventListener('sessionstart', () => {
      window.setTimeout(() => this.visuals.precompile([new Mesh(this.stoneShapes[0].geometry, this.stoneMaterialProto)]), 50);
      // 26 Oct (safety nets): what the hands are, 6 s in (hand tracking can take a moment to appear).
      window.setTimeout(() => this.checkInputs(), 6000);
    });
    // 26 Oct (safety nets): the adaptive quality (and safe mode) applied quietly to the aura, the light dust, the
    // 8k places and the living layers.
    guard.onQuality((_level, knobs) => this.visuals.applyQuality(knobs));
    services.voice.onUtterance = (clip) => void this.onClip(clip);
    services.voice.onState = (state) => {
      track('mic', { state: String(state) }, `mic:${String(state)}`);
      this.refreshCaption();
    };

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.Visible && this.placementMode !== 'table' && this.placementMode !== 'floating') {
          this.beginImmersive();
        } else if (state === VisibilityState.NonImmersive) {
          if (this.xrEntered) track('xr-exit', { secs: secs() });
          this.xrEntered = false;
          this.deskAnchor.end();
          this.probe.stop();
          this.selectSession?.removeEventListener('selectstart', this.onSelect as EventListener);
          this.selectSession?.removeEventListener('visibilitychange', this.onXrVisibility);
          this.applyPause(this.pauseGate.clear('xr'));
          this.selectSession = null;
          this.chosenId = null;
          this.pendingMove = null;
          this.preview2D();
        }
      }),
    );
    document.addEventListener('visibilitychange', this.onPageVisibility);
    this.cleanupFuncs.push(() => document.removeEventListener('visibilitychange', this.onPageVisibility));
    this.preview2D();
    this.exposeDebugApi();
  }

  // ------------------------------------------------------------------ setup

  /** 2D page: the desk sits under a calm camera as a backdrop for the landing. */
  private preview2D(): void {
    this.visuals.living.setGoodNight(false);
    // 28 Oct: back from a night that faded: full light and sound again, the stars home.
    this.resetNight();
    this.closeTension(false);
    this.placementMode = 'preview';
    this.frame = { x: 0, y: 0.72, z: -0.42, yaw: 0 };
    this.visuals.place(this.frame);
    this.visuals.setGrounded(false);
    // The opening shot: once the page is drawn (overlay.ts), the lamp wakes in the dark, then the tray appears in its
    // light. Never before: no half-loaded tray on screen.
    this.visuals.resetReveal();
    this.visuals.setOrnamentsHidden(true);
    // Back from an evening: a clean still life again (no caption, no buttons, your room, the lamp lit).
    this.visuals.hideCaption();
    this.visuals.setReplies(null);
    this.visuals.setWords(null);
    this.visuals.hideCard();
    this.visuals.openRituals(false);
    this.visuals.openPlaces(false);
    this.visuals.setEvening(0, false);
    this.visuals.backdrop.setEvening(0);
    this.rv.eveningDim = 0;
    if (this.visuals.backdrop.place !== 'room') void this.visuals.goPlace('room');
    const wake = () => this.visuals.setReveal(1);
    if (document.body.classList.contains('ready')) wake();
    else window.addEventListener('wdd:landing-ready', wake, { once: true });
    // Warm night backdrop behind the 2D landing (never in XR: passthrough must show). With a transparent canvas the
    // page's own lamp-glow vignette (index.html) shows through; otherwise a flat warm night.
    const transparent = this.renderer.getContext().getContextAttributes()?.alpha === true;
    this.world.scene.background = transparent ? null : new Color(0x0e0c0b);
    // Hero shot: a seated three-quarter view, tray centred above the landing bar, the lamp on the right third.
    // Narrow windows step back so the whole tray stays in frame.
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const back = Math.max(1, 1.45 / aspect);
    this.world.camera.position.set(0.02, 0.72 + 0.4 * back, -0.42 + 0.74 * back);
    this.world.camera.lookAt(0.02, 0.655, -0.43);
    this.showStars();
    for (const listener of deskPlacedListeners) listener(this.frame, 'preview', null);
  }

  private beginImmersive(): void {
    // 29 Oct (long session): a finished evening (Good night, stones placed, or another date) leaves a fresh desk.
    const tonight = services.memory.tonightDate();
    if (startFresh(this.eveningSpan, tonight)) this.freshDesk(this.eveningSpan.startedOn !== tonight);
    this.eveningSpan = { startedOn: tonight, goodnight: false, placed: 0 };
    const session = this.world.session as (XRSession & { updateTargetFrameRate?: (rate: number) => Promise<void> }) | undefined;
    session?.updateTargetFrameRate?.(72).catch(() => {});
    this.renderer.xr.setFoveation(1);
    this.world.scene.background = null;
    this.visuals.setOrnamentsHidden(false);
    this.visuals.root.visible = false;
    this.visuals.setReveal(0);
    this.placementMode = null;
    this.placementStart = this.elapsed;
    this.sessionStart = this.elapsed;
    // Tonight's place: the remembered anchor first (restore runs in the background, ≤ 3 s), then the surfaces.
    this.placeSource = null;
    this.anchorDecision = null;
    this.pendingMove = null;
    this.offscreenCueAt = -1;
    this.lastBearing = null;
    this.deskAnchor.start(session, this.elapsed);
    this.sceneUnderstanding(true);
    if (session != null) {
      this.selectSession = session;
      session.addEventListener('selectstart', this.onSelect as EventListener);
      session.addEventListener('visibilitychange', this.onXrVisibility);
    }
    this.xrEntered = true;
    track('xr-enter', { mode: session?.environmentBlendMode === 'opaque' ? 'vr' : 'ar' });
    this.firstEvening = services.memory.snapshot().nights.length === 0 && services.memory.doneTonight().length === 0;
    this.lastActivity = this.elapsed;
    this.exampleShown = false;
    this.ghostT = 0;
    this.gazeTipAt = -1;
    this.gazeTipShown = false;
    void this.probe.start(session);
    this.evening = 0.12;
    this.eveningGoal = 0.12;
    this.usedTopics.clear();
    this.dumpSpoke = false;
    this.dumpTouched = false;
    this.lastInputAt = this.elapsed;
    this.touchKey = '';
    this.ritual = initialRitual();
    this.mode = 'arrive';
    this.closeTension(false);
    this.checkoutAsked = false;
    this.resetNight();
    this.journal = null;
    this.morning = services.memory.morningPlan();
    this.say('Evening. Finding your table…', services.memory.welcomeLine());
  }

  /**
   * 29 Oct: the previous evening is over: its stones leave the desk (meshes, materials and atlas cells released;
   * what was sorted is already in memory), and its plan, bubbles and questions with them. Another date: the arrival
   * bead may be asked again.
   */
  private freshDesk(newDate: boolean): void {
    for (const stone of [...this.stones.values()]) this.disposeStone(stone);
    this.session = new SortingSession();
    this.plan = null;
    this.planKept = false;
    this.usedBubbles.clear();
    this.followUps = [];
    this.ask = null;
    this.askStone = null;
    this.dumpSpoke = false;
    this.dumpTouched = false;
    this.updateCounts();
    if (newDate) this.arrivalBeadAsked = false;
  }

  /**
   * "Move my desk" (voice, the Places menu's "Move desk here", R in player mode): finds the table again from where
   * you sit now; stones follow the desk; the new place replaces the remembered one. No plane or volume here →
   * the hit-test probe gets up to 1.5 s, then the floating desk.
   */
  /**
   * 26 Oct (CPU pass): IWSDK's plane / mesh tracking runs only while the table is being looked for (arrival, "move
   * my desk"); once the desk has been placed for 8 s it is paused (≈ 0.5 ms per frame at ×6 CPU, measured).
   */
  private sceneUnderstanding(on: boolean): void {
    const system = this.world.getSystem(SceneUnderstandingSystem) as { play(): void; stop(): void; isPaused: boolean } | undefined;
    if (system == null) return;
    if (on && system.isPaused) system.play();
    if (!on && !system.isPaused) system.stop();
  }

  recenter(quiet = false): void {
    this.sceneUnderstanding(true);
    if (this.placementMode === 'preview') {
      return;
    }
    const choice = this.findSurface();
    if (choice == null && this.probe.status !== 'unsupported' && this.pendingMove == null) {
      this.pendingMove = { since: this.elapsed, quiet };
      void this.probe.start(this.world.session as XRSession | undefined);
      return;
    }
    this.applyMove(choice, quiet);
  }

  /** The floating desk in front of you, never sunk into a real surface it floats over (29 Oct). */
  private floatingFrame(head: HeadPose): DeskFrame {
    const tops: PlaneCandidate[] = this.planeCandidates().filter((p) => p.orientation === 'horizontal');
    for (const m of this.meshCandidates()) {
      const t = meshTop(m);
      if (t != null) tops.push(t);
    }
    return clearOfSurfaces(fallbackFrame(head, this.layout), tops, this.layout, TRAY.height + 0.002);
  }

  private applyMove(choice: SurfaceChoice | null, quiet: boolean): void {
    this.pendingMove = null;
    this.probe.stop();
    const head = this.headPose();
    const previous = this.frame;
    const mode = choice != null ? 'table' : 'floating';
    const frame = lifted(choice != null ? frameOnTable(choice, head, this.layout) : this.floatingFrame(head), mode);
    this.relocate(previous, frame);
    this.placementMode = mode;
    this.placeSource = choice?.source ?? 'floating';
    this.visuals.setGrounded(mode === 'table');
    this.showStars();
    for (const listener of deskPlacedListeners) listener(frame, mode, choice?.plane ?? null);
    this.deskAnchor.moved(frame, mode, choice?.source ?? 'floating');
    track('moved-desk', { source: choice?.source ?? 'floating' });
    if (quiet && this.mode === 'choose' && this.proposal != null) {
      this.say(this.proposal.line, `${choice != null ? 'On your table. ' : ''}${services.memory.welcomeLine()}`);
    } else if (quiet && this.ritual.phase === 'dump') {
      this.say(caption(this.ritual, this.captionExtra()), `${choice != null ? 'On your table. ' : ''}${services.memory.welcomeLine()}`);
    } else if (!quiet) {
      this.flash(choice != null ? 'Desk moved to your table.' : 'Your desk is ready.', 2.5);
      this.cue('appear', { x: 0, y: 0.05, z: 0 });
    }
  }

  /**
   * Moves the desk (and the stones on it) to a new frame; a stone in the hand stays in the hand. A small anchor
   * correction (`keepTweens`) lets a stone already flying to a bowl finish its flight.
   */
  private relocate(previous: DeskFrame | null, frame: DeskFrame, keepTweens = false): void {
    this.frame = frame;
    this.visuals.place(frame);
    if (previous == null) return;
    for (const stone of this.stones.values()) {
      if (stone.entity.hasComponent(Grabbed) || (keepTweens && stone.moving)) continue;
      worldToDesk(previous, stone.mesh.position, this.local);
      deskToWorld(frame, this.local, this.world3);
      stone.mesh.position.set(this.world3.x, this.world3.y, this.world3.z);
      stone.mesh.rotation.y = frame.yaw + stone.yawJitter;
      stone.moving = false;
    }
  }

  /** The best real surface right now: planes, table volumes, then the hit-test points. */
  private findSurface(): SurfaceChoice | null {
    return chooseSurface({ planes: this.planeCandidates(), meshes: this.meshCandidates(), hits: this.probe.recent() }, this.headPose());
  }

  private headPose(): HeadPose {
    const head = this.player.head;
    head.getWorldPosition(this.v);
    head.getWorldDirection(this.v2); // +Z of the head; the view looks down -Z
    return { position: { x: this.v.x, y: this.v.y, z: this.v.z }, forward: { x: -this.v2.x, z: -this.v2.z } };
  }

  /** 29 Oct (test only, debug API `blindRoom`): pretend the room offers no planes and no volumes at all. */
  private sceneBlind = false;

  private planeCandidates(): OrientedPlane[] {
    const list: OrientedPlane[] = [];
    if (this.sceneBlind) return list;
    for (const entity of this.queries.planes.entities) {
      const object = entity.object3D;
      const plane = entity.getValue(XRPlane, '_plane') as (XRPlane & { semanticLabel?: string }) | undefined;
      if (object == null || plane == null) {
        continue;
      }
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const p of plane.polygon) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
      if (!Number.isFinite(minX)) {
        continue;
      }
      this.euler.setFromQuaternion(object.quaternion, 'YXZ');
      const q = object.quaternion;
      const axis = (x: number, y: number, z: number) => {
        const v = this.v2.set(x, y, z).applyQuaternion(q);
        return { x: v.x, y: v.y, z: v.z };
      };
      list.push({
        // 29 Oct: the full orientation, so vertical planes (walls) can host the kept lights (logic/walls.ts).
        axisX: axis(1, 0, 0),
        axisY: axis(0, 1, 0),
        axisZ: axis(0, 0, 1),
        id: String(entity.index),
        orientation: plane.orientation,
        label: plane.semanticLabel ?? '',
        center: { x: object.position.x, y: object.position.y, z: object.position.z },
        yaw: this.euler.y,
        halfX: (maxX - minX) / 2,
        halfZ: (maxZ - minZ) / 2,
        offsetX: (maxX + minX) / 2,
        offsetZ: (maxZ + minZ) / 2,
      });
    }
    return list;
  }

  private meshCandidates(): MeshBox[] {
    const list: MeshBox[] = [];
    if (this.sceneBlind) return list;
    for (const entity of this.queries.meshes.entities) {
      if (entity.getValue(XRMesh, 'isBounded3D') !== true) continue;
      const object = entity.object3D;
      const min = entity.getVectorView(XRMesh, 'min');
      const max = entity.getVectorView(XRMesh, 'max');
      if (object == null || min == null || max == null) continue;
      list.push({
        id: String(entity.index),
        label: String(entity.getValue(XRMesh, 'semanticLabel') ?? ''),
        isBounded3D: true,
        position: { x: object.position.x, y: object.position.y, z: object.position.z },
        quaternion: { x: object.quaternion.x, y: object.quaternion.y, z: object.quaternion.z, w: object.quaternion.w },
        min: { x: min[0], y: min[1], z: min[2] },
        max: { x: max[0], y: max[1], z: max[2] },
      });
    }
    return list;
  }

  /**
   * Arrival: 1. the remembered place (persistent anchor, judged against where you sit tonight);
   * 2. a real table (planes, volumes; the hit-test surface after 1.2 s); 3. after 2.2 s, the floating desk.
   */
  private tryPlace(): void {
    const waited = this.elapsed - this.placementStart;
    if (waited < 0.5) {
      return;
    }
    const head = this.headPose();
    if (this.anchorDecision == null) {
      const restore = this.deskAnchor.poll(this.xrFrame, this.renderer.xr.getReferenceSpace(), this.elapsed);
      if (restore == null) {
        return; // still restoring (≤ ANCHOR.restoreTimeout)
      }
      // Desk frame height above a table top = tray board + the 2 mm frameOnTable leaves (no z-fighting).
      this.anchorDecision = decideAfterRestore(restore, this.deskAnchor.saved, head, this.planeCandidates(), TRAY.height + 0.002);
    }
    const decision = this.anchorDecision;
    if (decision.place === 'anchor' && decision.frame != null && decision.mode != null) {
      this.deskAnchor.commit(decision, decision.frame, decision.mode, this.deskAnchor.saved?.source ?? 'plane');
      this.lastBearing = decision.bearing;
      this.placeDesk(decision.frame, decision.mode, null, 'anchor');
      return;
    }
    const choice = this.findSurface();
    if (choice != null && (choice.source !== 'hit' || waited > 1.2)) {
      const frame = lifted(frameOnTable(choice, head, this.layout), 'table');
      this.deskAnchor.commit(decision, frame, 'table', choice.source);
      this.placeDesk(frame, 'table', choice.plane, choice.source);
    } else if (waited > 2.2) {
      const frame = this.floatingFrame(head);
      this.deskAnchor.commit(decision, frame, 'floating', 'floating');
      this.placeDesk(frame, 'floating', null, 'floating');
    }
  }

  private placeDesk(frame: DeskFrame, mode: 'table' | 'floating', plane: PlaneCandidate | null, source: PlaceSource): void {
    this.frame = frame;
    this.placementMode = mode;
    this.placeSource = source;
    track('placed', { source, mode }, 'placed');
    const placedAt = this.elapsed;
    this.lastPlacedAt = placedAt;
    window.setTimeout(() => {
      if (this.lastPlacedAt === placedAt && this.frame != null) this.sceneUnderstanding(false);
    }, 8000);
    if (source === 'anchor') track('anchor-restored', { bearing: this.lastBearing ?? 'ahead' }, 'anchor-restored');
    this.placedOn = plane == null ? null : { label: plane.label, y: +plane.center.y.toFixed(3), halfX: +plane.halfX.toFixed(2), halfZ: +plane.halfZ.toFixed(2), hits: source === 'hit' ? this.probe.recent().map((h) => [+h.x.toFixed(2), +h.y.toFixed(3), +h.z.toFixed(2), +h.up.toFixed(2)]) : undefined };
    this.probe.stop();
    // Restored outside your view: the appear sound (from the desk itself) tells you where; once more at 3 s.
    this.offscreenCueAt = source === 'anchor' && this.lastBearing != null && this.lastBearing !== 'ahead' ? this.elapsed + 3 : -1;
    this.visuals.place(frame);
    this.visuals.setGrounded(mode === 'table');
    for (const listener of deskPlacedListeners) listener(frame, mode, plane);
    this.visuals.setReveal(1);
    this.sounds.startAmbient();
    this.cue('appear', { x: 0, y: 0.05, z: 0 });
    this.showStars();
    // No technical sentence for a floating desk (owner review, 18 Oct): the welcome line alone.
    const where = source === 'anchor' ? (bearingCaption(this.lastBearing ?? 'ahead') ?? 'Back where you left it.') : mode === 'table' ? 'On your table.' : '';
    if (this.morning != null) {
      this.mode = 'morning';
      this.event({ type: 'morning' });
      this.startMorning();
      return;
    }
    // v6: the lamp proposes a ritual (time, tonight, what it hears); the person decides.
    this.mode = 'choose';
    this.sounds.preloadRituals();
    // 26 Oct (lot 2b): your keepsakes on the table, and — on an evening you came back for — your sky in the lamp.
    this.arrivalSky();
    // 23 Oct: a first evening (a judge's cold start) goes straight to the core gesture — no question first.
    if (this.firstEvening) {
      this.lastActivity = this.elapsed;
      this.startRitual('unload', undefined, 'hand');
      return;
    }
    // 28 Oct: first, once the desk (and your sky) have been seen, the bead: "How heavy is tonight?". One gesture,
    // and it can be skipped; then the evening goes on as before.
    const goOn = () => {
      if (this.mode !== 'choose') return;
      // 24 Oct — agent memory: the lamp remembers (on this device) and opens with one true sentence; yesterday's open
      // "Tomorrow" stones come back to be checked ("Did you call the dentist?" → done → they dissolve into light).
      const recall = services.memory.recall();
      if (recall.followUps.length > 0) {
        this.startFollowUps(recall);
        return;
      }
      this.propose(null, `${where.length > 0 ? `${where} ` : ''}${recall.sentence ?? services.memory.welcomeLine()}`);
    };
    // 29 Oct (clean pause/resume): leaving XR and coming back on the same page is not a new arrival for the bead:
    // once asked tonight (even skipped), it is not asked again.
    if (services.memory.tonightRecord()?.tensionIn != null || this.arrivalBeadAsked) {
      goOn();
      return;
    }
    const ask = (tries: number) => {
      if (this.mode !== 'choose' || this.proposal != null) return;
      if ((this.visuals.uiShown && !this.visuals.skyShown) || tries > 80) this.askTension('in', goOn);
      else window.setTimeout(() => ask(tries + 1), 150);
    };
    window.setTimeout(() => ask(0), 900);
  }

  /**
   * 26 Oct (safety nets): no tracked hands 6 s into the session. Controllers present → they work (ray + trigger:
   * IWSDK's own input), said once. Nothing at all → gaze-only selection turns on, and the lamp says how to go on
   * (look and wait, or speak). Counted anonymously (hands / controllers / none).
   */
  private checkInputs(): void {
    const session = this.renderer.xr.getSession();
    if (session == null) return;
    const sources = [...session.inputSources];
    const hands = sources.some((s) => s.hand != null);
    const controllers = sources.some((s) => s.hand == null && s.gamepad != null && s.targetRayMode === 'tracked-pointer');
    const kind = hands ? 'hands' : controllers ? 'controllers' : 'none';
    track('input', { kind }, `input:${kind}`);
    if (hands) return;
    if (controllers) {
      this.flash('Your controllers work too: point, and pull the trigger.', 5);
      return;
    }
    if (!this.access.gazeSelect) {
      this.access = services.access.set({ gazeSelect: true });
    }
    this.flash('No hands seen. Look at something and hold your gaze, or just speak.', 6);
  }

  /**
   * Lot 2b (owner's go-ahead, 26 Oct): progress shown inside the lamp. The keepsakes already earned stand on the
   * table at once; on an evening you came back for, once the desk is revealed, the lamp floats up and shows your
   * sky (the last evening's point lights as you watch). A milestone (3, 7, 21 evenings) completes the figure and
   * leaves its keepsake on the table — once, with one plain line.
   */
  private arrivalSky(): void {
    const memory = services.memory;
    const evenings = memory.evenings();
    const celebrated = memory.celebrated();
    const have = MILESTONES.filter((m) => evenings >= m && celebrated.includes(m)).map((m) => KEEPSAKE[m]);
    this.visuals.keepsakes.set(have, plantGrowth(evenings));
    if (evenings === 0) return;
    const milestone = milestoneToCelebrate(evenings, celebrated);
    const start = (tries: number) => {
      if (!this.visuals.uiShown && tries < 40) {
        window.setTimeout(() => start(tries + 1), 150);
        return;
      }
      if (this.mode !== 'choose' && this.mode !== 'unload') return;
      this.showSky(true, milestone != null ? 9 : 6);
      if (milestone != null) window.setTimeout(() => this.celebrate(milestone), 3200);
    };
    window.setTimeout(() => start(0), 600);
  }

  /** The lamp shows your sky (at arrival, or when asked: "show me my sky"). */
  private showSky(fresh: boolean, seconds = 7): void {
    const memory = services.memory;
    const evenings = memory.evenings();
    if (evenings === 0 && memory.totalLetGo() === 0) {
      this.flash('Your sky starts tonight: a star for each thing you let go.', 3.5);
      return;
    }
    const f = figureFor(evenings);
    this.visuals.showSky(f.points, f.lit, memory.totalLetGo(), seconds, fresh, f.complete);
    track('sky', { evenings: Math.min(evenings, 99) }, `sky:${fresh ? 'arrival' : 'asked'}`);
  }

  private celebrate(m: Milestone): void {
    const k = KEEPSAKE[m];
    services.memory.celebrate(m);
    this.visuals.keepsakes.arrive(k);
    const at = KEEPSAKE_AT[k];
    if (this.frame != null) {
      const w = deskToWorld(this.frame, { x: at.x, y: 0.012, z: at.z }, this.world3);
      this.visuals.lights.star(w.x, w.y, w.z, 0.03, 0xffe2b8, 3);
      this.sounds.play('pearl', w.x, w.y, w.z);
    }
    const { line, sub } = milestoneLine(m);
    this.flash(line, 5.5, sub);
    track('milestone', { m }, `milestone:${m}`);
  }

  private startFollowUps(recall: Recall): void {
    this.followUps = recall.followUps.map((text) => ({ text, id: this.spawnStone({ title: text, detail: text, suggestion: 'tomorrow' }, 0.2, 'carried')?.id ?? null }));
    this.followUpIndex = 0;
    this.followUpsDone = 0;
    track('follow-up', { answer: 'asked' }, 'follow-up:asked');
    // The question waits for the arrival reveal: never asked before it can be read and answered.
    const ask = (tries: number) => {
      if (this.visuals.uiShown || tries > 40) this.askFollowUp(recall.sentence);
      else window.setTimeout(() => ask(tries + 1), 150);
    };
    window.setTimeout(() => ask(0), 900);
  }

  private askFollowUp(intro: string | null = null): void {
    const item = this.followUps[this.followUpIndex];
    if (item == null || this.mode !== 'choose') {
      this.finishFollowUps();
      return;
    }
    this.askStone = item.id;
    this.ask = {
      labels: ['Yes, done', 'Not yet'],
      actions: [() => this.answerFollowUp(true), () => this.answerFollowUp(false)],
      key: `f${this.followUpIndex}`,
    };
    const question = followUpQuestion(item.text, this.followUpIndex === 0);
    this.say(intro != null && this.followUpIndex === 0 ? `${intro} ${question}` : question, services.style.quiet ? 'Touch "Yes, done" or "Not yet".' : 'Say "done" or "not yet".');
  }

  private answerFollowUp(done: boolean): void {
    const item = this.followUps[this.followUpIndex];
    this.ask = null;
    this.askStone = null;
    this.lastActivity = this.elapsed;
    if (item == null) return;
    track('follow-up', { answer: done ? 'done' : 'not-yet' });
    const stone = item.id != null ? this.stones.get(item.id) : undefined;
    if (done) {
      services.memory.markDone(item.text);
      this.followUpsDone++;
      if (stone != null && this.session.get(stone.id) != null) {
        // Done: the stone dissolves into light where it lies (not a let go: no star, no bowl).
        this.session.discard(stone.id);
        stone.dissolving = 0;
        stone.emitted = 0;
        this.cue('release', { x: 0, y: 0.05, z: 0 });
        // The others close the gap only once it has gone (never sliding over the light).
        window.setTimeout(() => this.layoutUnsorted(0.6), (RELEASE_HOLD + RELEASE_DURATION) * 1000);
      }
      this.flash('Done. One less thing to carry.', 1.4, '', false);
    } else {
      this.flash('It stays on your desk.', 1.4, '', false);
    }
    this.followUpIndex++;
    window.setTimeout(() => this.askFollowUp(), 1500);
  }

  private finishFollowUps(): void {
    this.ask = null;
    this.askStone = null;
    const pending = this.followUps.length;
    this.followUps = [];
    if (pending === 0 || this.mode !== 'choose' || this.proposal != null) return;
    const done = this.followUpsDone;
    const sub = done > 0 ? `${done === 1 ? 'One thing' : `${done} things`} done since last time.` : services.memory.welcomeLine();
    this.propose(null, sub);
  }

  /** "Forget everything": one confirmation, then every evening kept on this device is erased (stars too). */
  private confirmForget(): void {
    const previous = this.ask;
    this.ask = {
      labels: ['Forget', 'Keep'],
      actions: [
        () => {
          this.ask = null;
          services.memory.forget();
          this.visuals.lights.clearStars();
          this.visuals.hideSky();
          this.visuals.keepsakes.set([], 0);
          track('forget', {});
          this.flash('Forgotten. Nothing from before is kept here.', 4);
        },
        () => {
          this.ask = previous;
          this.flash('Kept.', 1.8, '', false);
        },
      ],
      key: 'forget',
    };
    this.flash('Forget every evening kept on this device?', 30, 'Stones, stars and plans. This cannot be undone.');
  }

  /** "From last week's Later": items waiting a week come back when Unload starts. */
  private bringBackLater(): void {
    const due = services.memory.dueLater();
    if (due.length > 0) {
      window.setTimeout(() => {
        due.forEach((text, i) => this.spawnStone({ title: text, detail: text, suggestion: 'later' }, i * 0.2, 'carried'));
        this.event({ type: 'tokens-added', count: due.length });
        this.flash(`From last week's Later: ${due.length === 1 ? 'one thing' : `${due.length} things`} back on the desk.`, 4);
      }, 1800);
    }
  }

  private showStars(): void {
    if (this.frame == null) {
      return;
    }
    this.visuals.lights.clearStars();
    const stars = services.memory.stars().slice(-96);
    // 28 Oct (the journal): slot i of the light field is stars[i] — looking at a star tells what it was.
    this.starTexts = stars.map((s) => ({ text: s.text, date: s.date, seed: s.seed }));
    for (const star of stars) {
      const p = starPosition(star.seed);
      const w = deskToWorld(this.frame, p, this.world3);
      this.visuals.lights.star(w.x, w.y, w.z, p.size * 0.8, 0xffeed6, Math.random() * 1.5);
    }
    this.showKept();
  }

  /** 28 Oct (Keep): every good thing kept on recent evenings floats in the room, a warm light each. */
  private showKept(): void {
    if (this.frame == null) return;
    const kept = services.memory.keptLights();
    // 29 Oct: the same lights already shown (a ritual just ended): leave them be (a light still flying, its word).
    const key = kept.map((k) => `${k.date}|${k.text}`).join('\n');
    if (key === this.keptShownKey) return;
    this.keptShownKey = key;
    this.visuals.lights.clearKept();
    // 29 Oct: tonight's lights rest in view just behind the tray and light it; earlier evenings' float in the ring,
    // smaller (a room full of 13 cm halos would be a fairground).
    const tonight = services.memory.tonightRecord()?.date ?? null;
    const wall = this.keepWall();
    let n = 0;
    kept.forEach((k, i) => {
      const near = k.date === tonight;
      const w = this.keptSpot(i, near ? n++ : -1, k.seed, wall);
      // On a wall, earlier evenings' lights are a little smaller than tonight's (weeks of them stay calm).
      this.visuals.lights.kept(w.x, w.y, w.z, w.x, w.y, w.z, 0, 0.4 + i * 0.08, near ? KEPT_NEAR_SIZE : wall != null ? KEPT_WALL_OLD_SIZE : KEPT_RING_SIZE, null, near && wall == null);
    });
  }

  /**
   * 29 Oct ("walls host content"): the wall seen from the seat that hosts the kept lights, from scene understanding
   * (vertical planes, else wall volumes); null in a room without one (then they stay in view at the desk).
   */
  private keepWall(): Wall | null {
    if (this.frame == null) return null;
    this.player.head.getWorldPosition(this.v);
    const fx = this.frame.x - this.v.x;
    const fz = this.frame.z - this.v.z;
    return pickKeepWall(wallsFrom(this.planeCandidates(), this.meshCandidates()), { x: this.v.x, y: this.v.y, z: this.v.z }, { x: fx, z: fz });
  }

  /**
   * Where kept light `index` (all evenings) rests, world: on the wall (the same spot every evening for the same light),
   * else tonight's (`tonightN` ≥ 0) on the tray's back rim, earlier evenings' in the ring around the desk.
   */
  private keptSpot(index: number, tonightN: number, seed: number, wall: Wall | null): Vec3 {
    if (wall != null && this.frame != null) {
      // The seat's view as the desk sees it (stable from evening to evening: the desk anchor, not the head).
      const eye = deskToWorld(this.frame, { x: 0, y: 0.39, z: 0.58 }, { x: 0, y: 0, z: 0 });
      const p = keptOnWall(index, seed, wall, eye, { x: this.frame.x - eye.x, z: this.frame.z - eye.z });
      this.world3.x = p.x;
      this.world3.y = p.y;
      this.world3.z = p.z;
      return this.world3;
    }
    const p = tonightN >= 0 ? keptPlaceNear(tonightN, seed) : keptPlace(index, seed);
    return deskToWorld(this.frame!, p, this.world3);
  }

  // ----------------------------------------------------------------- stones

  private spawnStone(draft: { title: string; detail: string; suggestion: BinId | null }, delay: number, source: TokenState['source']): TokenState | null {
    if (this.frame == null) {
      return null;
    }
    let state: TokenState;
    try {
      state = this.session.add(draft.title, { detail: draft.detail, suggestion: draft.suggestion, source });
    } catch {
      this.flash('The desk is full. Sort a few first.', 3);
      return null;
    }
    const { cell, uv } = this.atlas.allocate(state.text);
    const material = this.stoneMaterialProto.clone() as typeof this.stoneMaterialProto;
    linkShared(material);
    material.uniforms.uMap.value = this.atlas.texture;
    material.uniforms.uCell.value = new Vector4(uv[0], uv[1], uv[2], uv[3]);
    const kind = DS.material.stoneKinds[this.stoneCount % DS.material.stoneKinds.length];
    material.uniforms.uAlbedo.value.set(kind.albedo[0], kind.albedo[1], kind.albedo[2]);
    material.uniforms.uInk.value.set(kind.ink[0], kind.ink[1], kind.ink[2], 1);
    material.uniforms.uKind.value.set(kind.speck, kind.vein);
    material.uniforms.uSeed.value = (this.stoneCount * 7.31) % 13;
    const shape = this.stoneShapes[(this.stoneCount * 3) % this.stoneShapes.length];
    // The engraved label scales with the stone, so small stones keep their margins.
    material.uniforms.uLabel.value.set(STONE_LABEL.w * shape.size, STONE_LABEL.h * shape.size);
    const yawJitter = (((this.stoneCount * 0.6180339) % 1) - 0.5) * 0.1;
    this.stoneCount++;
    const mesh = new Mesh(shape.geometry, material);
    mesh.renderOrder = 2;
    mesh.rotation.y = this.frame.yaw + yawJitter;
    const entity = this.world
      .createTransformEntity(mesh)
      .addComponent(WorryToken, { tokenId: state.id })
      .addComponent(OneHandGrabbable, { rotate: false, translate: true });
    this.stoneBatch.add(mesh, material.uniforms);
    const stone: Stone = {
      id: state.id,
      entity,
      mesh,
      uniforms: material.uniforms,
      cell,
      from: new Vector3(),
      to: new Vector3(),
      t: 0,
      duration: 0.7,
      arc: 0,
      moving: false,
      delay,
      arrive: null,
      glow: 0,
      glowTarget: 0,
      gazeK: 0,
      scaleTarget: 1,
      scale: new Spring(0.001),
      squash: new Spring(0),
      lift: new Spring(0),
      liftApplied: 0,
      yawJitter,
      dissolving: -1,
      done: 0,
      emitted: 0,
    };
    this.stones.set(state.id, stone);
    // Then everyone re-flows into the row.
    // Stones are born at the voice lamp and glide into the row.
    deskToWorld(this.frame, { x: this.layout.orb.x, y: 0.05, z: this.layout.orb.z - 0.02 }, this.world3);
    mesh.position.set(this.world3.x, this.world3.y, this.world3.z);
    mesh.scale.setScalar(0.001);
    this.layoutUnsorted(0.75);
    window.setTimeout(() => this.cue('appear', homePosition(this.session.unsortedIndex(state.id), this.session.unsorted().length, this.layout)), delay * 1000 + 150);
    this.lastId = state.id;
    const back = services.memory.cameBack(state.text);
    if (back != null) {
      this.flash('This one came back. That is okay. Place it again.', 3.5);
    }
    return state;
  }

  /** Starts a tween of a stone to a desk-local target. */
  private moveStone(stone: Stone, target: Vec3, duration: number, arc: number, arrive: (() => void) | null = null): void {
    if (this.frame == null) {
      return;
    }
    stone.from.copy(stone.mesh.position);
    deskToWorld(this.frame, target, this.world3);
    stone.to.set(this.world3.x, this.world3.y, this.world3.z);
    stone.t = 0;
    stone.duration = duration;
    stone.arc = arc;
    stone.moving = true;
    stone.arrive = arrive;
  }

  private layoutUnsorted(duration = 0.45): void {
    const unsorted = this.session.unsorted();
    unsorted.forEach((token, index) => {
      const stone = this.stones.get(token.id);
      if (stone != null && !stone.entity.hasComponent(Grabbed)) {
        stone.scaleTarget = 1;
        this.moveStone(stone, homePosition(index, unsorted.length, this.layout), duration, 0.02);
      }
    });
  }

  private onPick(entity: Entity): void {
    this.lastActivity = this.elapsed;
    if (this.mode === 'unload' && !this.dumpSpoke) this.dumpTouched = true;
    const id = String(entity.getValue(WorryToken, 'tokenId'));
    const stone = this.stones.get(id);
    if (stone != null) {
      stone.moving = false;
      stone.arrive = null;
      this.lastId = id;
      const suggestion = this.session.get(id)?.suggestion ?? null;
      this.visuals.setSuggest(suggestion == null ? -1 : BIN_IDS.indexOf(suggestion));
    }
    this.lastInputAt = this.elapsed;
    if (this.ritual.phase === 'dump' && this.session.all().length > 0 && this.extracting === 0 && dumpEndsOnSort({ quiet: services.style.quiet, spoke: this.dumpSpoke })) {
      // Picking up a stone means "I'm done talking": sorting begins. (A quiet evening — or anyone who has not said a
      // word in this dump, 29 Oct — goes on: once the stone is placed the words come back, and "That's all" ends it.)
      this.event({ type: 'dump-done', stones: this.session.all().length });
    }
  }

  private settle(entity: Entity): void {
    const id = String(entity.getValue(WorryToken, 'tokenId'));
    const stone = this.stones.get(id);
    const state = this.session.get(id);
    if (stone == null || state == null || state.released || this.frame == null) {
      return;
    }
    worldToDesk(this.frame, stone.mesh.position, this.local);
    const bin = classifyDrop(this.local, this.layout);
    this.visuals.setBinGlow(-1, 0);
    this.visuals.setSuggest(-1);
    if (bin == null) {
      this.session.assign(id, null);
      this.layoutUnsorted(0.5);
      this.cue('tock', this.local);
      this.updateCounts();
      return;
    }
    this.place(id, bin, 'hand');
  }

  /** Puts a stone in a bin, by hand or by voice. */
  private place(id: string, bin: BinId, via: 'hand' | 'voice'): void {
    const stone = this.stones.get(id);
    if (stone == null) {
      return;
    }
    const slot = this.session.assign(id, bin);
    this.eveningSpan.placed++;
    const binDef = binById(this.layout, bin);
    const index = this.layout.bins.indexOf(binDef);
    const target = this.inBowl(binDef, slot);
    stone.scaleTarget = BIN_STONE_SCALE;
    this.lastId = id;
    this.moveStone(stone, target, via === 'hand' ? 0.26 : 0.85, via === 'hand' ? 0.008 : 0.14, () => {
      this.visuals.pulseBin(index);
      stone.squash.kick(9);
      if (bin === 'let-go') {
        this.releaseStone(stone);
      } else {
        this.cue(bin === 'tomorrow' ? 'snap-tomorrow' : 'snap-later', target);
      }
    });
    this.layoutUnsorted(0.5);
    this.updateCounts();
    const remaining = this.session.unsorted().length;
    const keepDump = this.mode === 'unload' && !dumpEndsOnSort({ quiet: services.style.quiet, spoke: this.dumpSpoke });
    this.event({ type: 'sorted', remaining, keepDump });
    if (bin !== 'let-go') {
      const left = remaining === 0 ? '' : ` ${remaining} left.`;
      this.flash(`${binLabel(bin)}.${left}`, 1.6, via === 'voice' ? `"${this.heardLine}"` : '');
    }
    // Quiet evening (or nobody spoke yet): the phase stays (no refresh from event()); the next caption ("Touch more
    // words…") waits for the feedback line, or shows at once after Let go.
    if (keepDump && this.ritual.phase === 'dump') this.refreshCaption();
    this.persist();
  }

  private releaseStone(stone: Stone): void {
    const state = this.session.get(stone.id);
    if (state == null || this.frame == null) {
      return;
    }
    this.session.release(stone.id);
    const before = services.memory.timesLetGoBefore(state.text);
    stone.dissolving = 0;
    stone.emitted = 0;
    this.visuals.setEmber(1);
    const centre = this.layout.bins[2];
    this.cue('release', { x: centre.x, y: 0.05, z: centre.z });
    const star = starPosition(services.memory.stars().length + 7919 * (this.session.summary().letGo.length + 1));
    deskToWorld(this.frame, star, this.world3);
    this.visuals.lights.star(this.world3.x, this.world3.y, this.world3.z, star.size * 1.1, 0xffeed6, RELEASE_HOLD + RELEASE_DURATION);
    this.flash(
      before > 0 ? `Let go. You have released this ${ordinalWord(before + 1)} now. It gets lighter.` : 'Let go.',
      before > 0 ? 4 : 2.2,
      'A new star joins your sky.',
    );
    this.persist();
  }

  private undo(): void {
    const result = this.session.undo();
    if (result == null) {
      this.flash('Nothing to undo.', 1.8);
      return;
    }
    const stone = this.stones.get(result.token.id);
    if (stone != null && result.to != null) {
      const binDef = binById(this.layout, result.to);
      this.moveStone(stone, this.inBowl(binDef, this.session.binCount(result.to) - 1), 0.6, 0.08);
    }
    if (this.ritual.phase === 'plan' && result.to == null) {
      this.ritual = { ...this.ritual, phase: 'sort' };
      this.visuals.hideCard();
    }
    this.layoutUnsorted(0.5);
    this.updateCounts();
    this.flash(`Back ${result.to == null ? 'on the desk' : `in ${binLabel(result.to)}`}.`, 1.8);
    this.persist();
  }

  private discard(id: string): void {
    const stone = this.stones.get(id);
    if (stone == null) {
      return;
    }
    this.session.discard(id);
    this.disposeStone(stone);
    this.layoutUnsorted(0.4);
    this.flash('Removed.', 1.5);
  }

  private disposeStone(stone: Stone): void {
    this.stones.delete(stone.id);
    this.stoneBatch.remove(stone.mesh);
    this.atlas.release(stone.cell);
    (stone.mesh.material as { dispose(): void }).dispose();
    stone.entity.dispose();
  }

  private updateCounts(): void {
    const s = this.session.summary();
    this.visuals.setCounts(s.tomorrow.length, s.later.length, s.letGo.length);
  }

  private persist(): void {
    services.memory.recordNight(this.session.summary(), this.plan?.steps ?? [], this.planKept);
  }

  // ------------------------------------------------------------ voice + agent

  /** 26 Oct (safety nets): words that could not be turned into text in a row (the server or the network down). */
  private sttMisses = 0;
  private touchClock = 1;
  private lastPlacedAt = -1;
  private sttToldAt = -1e9;

  private async onClip(clip: Blob): Promise<void> {
    services.voice.level = 0;
    const text = await services.agent.transcribe(clip);
    if (text != null && text.trim().length > 0) {
      this.sttMisses = 0;
      await this.handleUtterance(text);
      return;
    }
    // Nobody ever hears silence back: two clips lost in a row (or no server at all) → the lamp says so, plainly,
    // and the hands take over (the ritual menu opens). Once every 2 minutes at most; counted anonymously.
    const state = services.agent.lastTranscribe;
    if (state === 'ok') return;
    this.sttMisses++;
    if ((state === 'no-server' || this.sttMisses >= 2) && this.elapsed - this.sttToldAt > 120) {
      this.sttToldAt = this.elapsed;
      track('voice-down', { why: state }, `voice-down:${state}`);
      this.flash('I can’t hear words right now. Your hands do everything: touch the lamp’s menu.', 5);
      if (this.mode === 'choose') this.openRitualMenu(true);
    }
  }

  private intentContext(): IntentContext {
    const tokens = this.session.active().filter((t) => t.bin == null || this.ritual.phase !== 'dump');
    return { tokens: tokens.map((t) => ({ id: t.id, text: t.text })), gazedId: this.gazedId, lastId: this.lastId };
  }

  /**
   * Every spoken sentence goes through here (real STT or the demo hook); touched bubbles ('touch') and typed lines
   * ('typed') too, exactly the same path — only a spoken one counts as "the person talks" (29 Oct, hands only).
   */
  async handleUtterance(text: string, via: 'voice' | 'touch' | 'typed' = 'voice'): Promise<void> {
    this.lastActivity = this.elapsed;
    const clean = text.trim();
    if (clean.length === 0) {
      return;
    }
    this.lastInputAt = this.elapsed;
    if (this.mode === 'unload' && this.ritual.phase === 'dump') {
      if (via === 'voice') this.dumpSpoke = true;
      else this.dumpTouched = true;
    }
    // Place and voice commands do not replace the last brain-dump line shown under the caption.
    // 24 Oct — safety first, in every ritual: suicide or self-harm never becomes a stone or a model call; one gentle
    // fixed answer and help resources on the desk (shared/agent/safety.ts).
    if (crisisSignal(clean)) {
      this.showHelp();
      this.lampSpeak(CRISIS_REPLY);
      return;
    }
    // 23 Oct — accessibility by voice: "look to select", "high contrast", "bigger text" (and their "off").
    const accessCommand = parseAccessCommand(normalize(clean));
    if (accessCommand != null) {
      this.setAccess(accessCommand, 'voice');
      return;
    }
    // 28 Oct — the bead is waiting: "about a seven", "pretty heavy", "skip". Anything else folds it away quietly (a
    // brain dump simply goes on); at Good night a second "good night" goes on to the night.
    if (this.tensionSide != null && this.tensionDial != null) {
      const answer = parseTension(clean);
      if (answer === 'skip') {
        this.skipTension();
        return;
      }
      if (answer != null) {
        this.keepTension(this.tensionDial.set(answer), 'voice');
        return;
      }
      if (this.tensionSide === 'in') this.closeTension(false);
    }
    // 28 Oct — the night ("stay", "twenty minutes", "dimmer", "lights out") and the journal ("earlier", "close").
    if (this.mode === 'night' && this.nightSeq != null) {
      const sleepCommand = parseSleepCommand(normalize(clean));
      if (sleepCommand != null) {
        this.onSleepCommand(sleepCommand, 'voice');
        return;
      }
    }
    if (this.journal != null) {
      const j = parseJournalCommand(normalize(clean));
      if (j != null) {
        this.stepJournal(j, 'voice');
        return;
      }
    }
    if (isJournalCommand(normalize(clean))) {
      this.openJournal('voice');
      return;
    }
    // 24 Oct — the lamp's own question first ("Did you call the dentist?" → "done" / "not yet").
    if (this.ask != null) {
      const answer = answerOf(normalize(clean));
      if (answer != null) {
        this.ask.actions[answer === 'yes' ? 0 : 1]();
        return;
      }
    }
    if (isSkyCommand(normalize(clean))) {
      // 28 Oct: "show me my sky" opens the journal (your sky in the lamp, and what each evening let go).
      this.openJournal('voice');
      return;
    }
    if (isForgetCommand(normalize(clean))) {
      this.confirmForget();
      return;
    }
    // 28 Oct: "voice softer", "sound louder", "volume".
    const mixCommand = parseMixCommand(clean);
    if (mixCommand != null) {
      this.onMixCommand(mixCommand);
      return;
    }
    const voiceCommand = parseVoiceToggle(normalize(clean));
    if (voiceCommand != null) {
      this.setVoice(voiceCommand);
      return;
    }
    if (isDeskMove(normalize(clean))) {
      this.recenter();
      return;
    }
    const globeCommand = PLACES_IN_GLOBE && this.visuals.placesOpen ? parseGlobeCommand(normalize(clean)) : null;
    if (globeCommand != null) {
      if (globeCommand === 'next' || globeCommand === 'previous') this.stepGlobe(globeCommand === 'next' ? 1 : -1);
      else if (globeCommand === 'choose') this.chooseGlobePlace('voice');
      else this.visuals.openPlaces(false);
      return;
    }
    const placeCommand = parsePlaceCommand(normalize(clean));
    if (placeCommand != null) {
      if (placeCommand.type === 'places') {
        this.openGlobePlaces();
        this.flash('Where would you like to be?', 3, PLACES_IN_GLOBE ? 'Say "next", "this one", or a place: "the lake", "the beach".' : 'Say "the lake", "the garden", "the hilltop" or "my room".');
      } else if (placeCommand.type === 'place') {
        void this.goPlace(placeCommand.place, 'voice');
      } else {
        this.setImmersion(placeCommand.level);
      }
      return;
    }
    // v6: ritual commands (whole sentences), then what each ritual does with free speech.
    const where = this.mode === 'choose' || this.mode === 'breathe' || this.mode === 'release' || this.mode === 'unload' || this.mode === 'talk' || this.mode === 'squeeze' || this.mode === 'keep' ? this.mode : 'other';
    const ritualCommand = parseRitualCommand(clean, where);
    if (ritualCommand != null) {
      this.onRitualCommand(ritualCommand);
      return;
    }
    if (this.mode === 'talk') {
      this.onTalkSpeech(clean);
      return;
    }
    if (this.mode === 'choose') {
      this.onChooseSpeech(clean);
      return;
    }
    if (this.mode === 'breathe' || this.mode === 'squeeze') {
      return;
    }
    if (this.mode === 'keep') {
      this.onKeepSpeech(clean);
      return;
    }
    if (this.mode === 'release') {
      if (this.release?.phase === 'ask') {
        this.formWeight(clean, false);
      } else if (this.release?.phase === 'gone') {
        // Already answering the next question ("yes"): the quiet moment ends now, and the answer counts.
        const title = this.release.title;
        this.releaseEvent({ type: 'settled' });
        this.completeRitual('release', { sunk: title });
        const next = parseRitualCommand(clean, 'choose');
        if (next != null) this.onRitualCommand(next);
      }
      return;
    }
    this.heardLine = clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
    if (via === 'voice') this.lastHeardAt = this.elapsed;
    const phase = this.ritual.phase;
    const kind = phase === 'dump' ? 'dump' : phase === 'plan' ? 'plan' : phase === 'sort' ? 'sort' : 'other';
    const intent = parseIntent(clean, this.intentContext(), kind);
    switch (intent.type) {
      case 'none':
        if (phase === 'dump' || (phase === 'sort' && clean.split(/\s+/u).length >= 4)) {
          await this.extract(clean);
        } else {
          this.flash('Say where it goes: "Tomorrow", "Later" or "Let go".', 3, `"${this.heardLine}"`);
        }
        break;
      case 'add':
        await this.extract(intent.text);
        break;
      case 'done':
        // 29 Oct: every stone already sorted (a touch dump) → straight to the plan, never an empty sorting phase.
        this.event({ type: 'dump-done', unsorted: this.session.unsorted().length, stones: this.session.all().length });
        this.refreshCaption();
        break;
      case 'move':
        if (this.session.get(intent.tokenId)?.bin !== intent.bin) {
          this.place(intent.tokenId, intent.bin, 'voice');
        }
        break;
      case 'move-all-suggested': {
        const todo = this.session.unsorted().filter((t) => t.suggestion != null);
        todo.forEach((t, i) => window.setTimeout(() => this.place(t.id, t.suggestion!, 'voice'), i * 450));
        this.flash(todo.length > 0 ? 'Following the suggestions. Say "undo" to change one.' : 'No suggestions to follow.', 3);
        break;
      }
      case 'undo':
        this.undo();
        break;
      case 'discard':
        this.discard(intent.tokenId);
        break;
      case 'confirm':
        if (phase === 'plan') {
          this.keepPlan();
        }
        break;
      case 'lighter':
        if (phase === 'plan') {
          await this.makePlan(true);
        }
        break;
      case 'help':
        this.flash(VOICE_HELP.slice(0, 3).join('   '), 6, VOICE_HELP.slice(3).join('   '));
        break;
      case 'mute':
        services.voice.mute(true);
        this.cue('orb-off', this.orbLocal());
        this.flash('Microphone off. Touch the lamp to talk again.', 3);
        break;
      case 'goodnight':
        this.goodnight();
        break;
      case 'recenter':
        this.recenter();
        break;
      case 'start':
        break;
      case 'ambiguous':
        this.flash(
          intent.candidates.length > 1 ? 'Which one? Say a word from it, or look at it and say "this one".' : 'I could not tell which stone. Look at it and say "this one".',
          3.5,
          `"${this.heardLine}"`,
        );
        break;
    }
  }

  private async extract(text: string): Promise<void> {
    this.extracting++;
    this.refreshOrb();
    try {
      const existing = this.session.active().map((t) => t.text);
      const drafts = await services.agent.extract(text, existing);
      if (drafts.length === 0) {
        this.flash('I did not catch a worry in that. Try again?', 2.5, `"${this.heardLine}"`);
        return;
      }
      let added = 0;
      drafts.forEach((draft, i) => {
        if (this.spawnStone(draft, i * 0.22, 'voice') != null) {
          added++;
        }
      });
      this.event({ type: 'tokens-added', count: added });
      this.refreshCaption();
    } finally {
      this.extracting--;
      this.refreshOrb();
    }
  }

  private onButton(action: string): void {
    this.lastActivity = this.elapsed;
    this.lastInputAt = this.elapsed;
    if (action === 'places' || action === 'immersion' || action.startsWith('globe-')) this.globeNavAt = this.elapsed;
    if (this.mode === 'unload' && action.startsWith('word:')) this.dumpTouched = true;
    // A stone in the hand (or just let go of) means the hand is busy: desk controls next to the bowls ignore it.
    // 1.6 s: the hand coming back from the Let go bowl passes over the lamp (found while filming v5).
    const nearLamp = action === 'orb' || action === 'places' || action === 'voice' || action === 'rituals' || action.startsWith('place:') || action.startsWith('ritual:') || action.startsWith('globe-');
    if (nearLamp && (this.queries.held.entities.size > 0 || this.queries.weightHeld.entities.size > 0 || this.elapsed - this.lastDropAt < 1.6)) {
      return;
    }
    // While breathing the moon floats where open hands rest: touching it never toggles the microphone.
    if (action === 'orb' && (this.mode === 'breathe' || this.mode === 'squeeze')) {
      return;
    }
    if (action.startsWith('word:')) {
      this.wordActions[Number(action.slice(5))]?.();
      return;
    }
    if ((action === 'keep' || action === 'lighter') && this.journal != null) {
      this.stepJournal(action === 'keep' ? 'earlier' : 'close', 'hand');
      return;
    }
    if ((action === 'keep' || action === 'lighter') && this.visuals.repliesShown) {
      this.replyActions[action === 'keep' ? 0 : 1]?.();
      return;
    }
    if (action === 'rituals') {
      if (this.mode === 'breathe' || this.mode === 'release' || this.mode === 'squeeze' || this.mode === 'keep') {
        this.finishRitual();
      } else {
        this.openRitualMenu(!this.visuals.ritualMenuOpen);
      }
      this.cue('tock', { x: this.layout.orb.x, y: 0.02, z: this.layout.orb.z + 0.068 });
      return;
    }
    if (action.startsWith('ritual:')) {
      const id = action.slice(7);
      if (id === 'sleep') {
        this.goodnight();
      } else if (id === 'sky') {
        this.openJournal('hand');
      } else if (id === 'unload' || id === 'breathe' || id === 'release' || id === 'talk' || id === 'squeeze' || id === 'keep') {
        this.startRitual(id, undefined, 'hand');
      }
      return;
    }
    if (action === 'voice') {
      this.setVoice(this.voice.muted);
      return;
    }
    if (action === 'move-desk') {
      // 22 Oct: the touch twin of "move my desk": the desk finds your table again from where you sit now.
      if (this.queries.held.entities.size > 0 || this.queries.weightHeld.entities.size > 0) return;
      this.visuals.openPlaces(false);
      this.recenter();
      return;
    }
    if (action === 'immersion') {
      // v8: the "Table stays | Full" switch of a place: a touch flips it.
      this.setImmersion(this.visuals.backdrop.immersionLevel === 'full' ? 'table' : 'full');
      this.cue('tock', { x: 0, y: 0.2, z: -this.layout.depth / 2 });
      return;
    }
    // v7: the Places button is hidden while its menu is open (a row closes it): ignore a stray poke on it.
    if (action === 'places' && this.visuals.placesOpen) {
      return;
    }
    if (action === 'places') {
      this.openGlobePlaces();
      this.cue('tock', { x: this.layout.orb.x, y: 0.02, z: this.layout.orb.z + 0.07 });
      return;
    }
    if (action === 'globe-prev' || action === 'globe-next') {
      this.stepGlobe(action === 'globe-next' ? 1 : -1);
      return;
    }
    if (action === 'globe-close') {
      this.visuals.openPlaces(false);
      this.cue('tock', { x: this.layout.orb.x, y: 0.02, z: this.layout.orb.z + 0.07 });
      return;
    }
    // The lamp shows a place: touching it (or looking at it, or pinching while you look) takes you there.
    if (action === 'orb' && PLACES_IN_GLOBE && this.visuals.placesOpen) {
      // 29 Oct (found by emulated hands): the open globe is a 17 cm sphere between its arrows; a fingertip coming
      // back from "next" brushed it and chose a place by accident. A globe touch within 0.9 s of an arrow, Places or
      // the switch is that brush, not a choice.
      if (this.elapsed - this.globeNavAt < GLOBE_BRUSH_S) return;
      this.chooseGlobePlace('hand');
      return;
    }
    if (action.startsWith('place:')) {
      const id = action.slice(6);
      if (isPlaceId(id)) {
        void this.goPlace(id, 'hand');
      }
      return;
    }
    if (action === 'orb') {
      this.onOrb();
    } else if (action === 'keep') {
      if (this.ritual.phase === 'plan') {
        this.keepPlan();
      } else if (this.ritual.phase === 'morning') {
        this.endMorning();
      }
    } else if (action === 'lighter' && this.ritual.phase === 'plan') {
      void this.makePlan(true);
    }
  }

  private onOrb(): void {
    const voice = services.voice;
    // Quiet evening: the lamp never opens a microphone; touching it does the next useful thing by hand.
    if (services.style.quiet) {
      if (this.mode === 'release' && this.release?.phase === 'ask') this.formWeight(this.heaviestStone(), true);
      else if (this.mode === 'unload' && this.ritual.phase === 'dump') this.onWord(WRITE_LABEL, 'unload');
      else this.openRitualMenu(true);
      return;
    }
    // No microphone: in Release the lamp offers your heaviest stone; elsewhere the ritual menu does everything.
    if ((voice.state === 'denied' || voice.state === 'unavailable') && this.mode === 'release' && this.release?.phase === 'ask') {
      this.formWeight(this.heaviestStone(), true);
      return;
    }
    if ((voice.state === 'denied' || voice.state === 'unavailable') && this.mode === 'choose') {
      this.openRitualMenu(true);
      this.flash('Microphone unavailable. Your hands still do everything.', 3);
      return;
    }
    if (voice.state === 'listening') {
      voice.mute(true);
      this.cue('orb-off', this.orbLocal());
      this.flash('Microphone off. Touch the lamp to talk again.', 2.5);
    } else if (voice.state === 'muted') {
      voice.mute(false);
      this.cue('orb-on', this.orbLocal());
      this.flash('Listening.', 1.5);
    } else if (voice.state === 'off' || voice.state === 'requesting') {
      void voice.start().then((state) => {
        if (state === 'listening') {
          this.cue('orb-on', this.orbLocal());
          this.refreshCaption();
        } else if (this.mode === 'release' && this.release?.phase === 'ask') {
          this.formWeight(this.heaviestStone(), true);
        } else if (this.mode === 'choose') {
          this.openRitualMenu(true);
          this.flash('Microphone unavailable. Your hands still do everything.', 3);
        } else {
          this.loadExample();
        }
      });
    } else if (this.mode === 'unload') {
      this.loadExample();
    }
    this.refreshOrb();
  }

  /** No microphone (or permission refused): an example evening keeps the ritual usable. */
  private loadExample(): void {
    if (this.exampleUsed || this.ritual.phase !== 'dump') {
      this.flash('Microphone unavailable. Your hands still do everything.', 3);
      return;
    }
    this.exampleUsed = true;
    this.cue('orb-on', this.orbLocal());
    this.heardLine = 'Example evening';
    // 26 Oct (cold judge): the microphone was refused — say why an example appears (it used to appear silently).
    const mic = services.voice.state;
    if (mic === 'denied' || mic === 'unavailable') this.flash('No microphone: here is an example evening. Your hands do the rest.', 5, '', false);
    void this.extract(DEMO_BRAIN_DUMP);
  }

  // ----------------------------------------------------------------- places

  /**
   * 26 Oct (the lamp shows the places): Places opens inside the lamp. In your room it starts on the last place you
   * chose (else the lake); in a place, on that place. The title says how to choose with what this person uses.
   */
  private openGlobePlaces(): void {
    if (!PLACES_IN_GLOBE) {
      this.visuals.openPlaces(!this.visuals.placesOpen);
      return;
    }
    if (this.visuals.placesOpen) return;
    this.visuals.setGlobeHint(this.access.gazeSelect ? 'Look at the lamp to go there' : services.style.quiet ? 'Touch the lamp to go there' : 'Touch the lamp, or say "this one"');
    this.visuals.openPlaces(true);
    if (this.visuals.backdrop.place === 'room') {
      let last: string | null = null;
      try {
        last = localStorage.getItem(LAST_PLACE_KEY);
      } catch {
        last = null;
      }
      this.visuals.showInGlobe(last != null && isPlaceId(last) && last !== 'room' ? last : 'moon-lake');
    }
    track('globe', { step: 'open' }, 'globe:open');
  }

  private stepGlobe(step: number): void {
    const id = this.visuals.stepGlobe(step);
    this.lastActivity = this.elapsed;
    this.sounds.play('pearl', this.visuals.orb.getWorldPosition(this.v2).x, this.v2.y, this.v2.z);
    track('globe', { step: step > 0 ? 'next' : 'previous', id }, `globe:${id}`);
  }

  private chooseGlobePlace(via: 'hand' | 'voice'): void {
    const id = this.visuals.globePlace;
    track('globe', { step: 'choose', id }, `globe-choose:${id}`);
    if (id === this.visuals.backdrop.place) {
      this.visuals.openPlaces(false);
      return;
    }
    void this.goPlace(id, via);
  }

  /** Changes place (crossfade, the desk light follows). Your room is always one word away. */
  private async goPlace(id: PlaceId, via: 'hand' | 'voice'): Promise<void> {
    track('place', { id, via }, `place:${id}`);
    const place = PLACES[id];
    if (id === this.visuals.backdrop.place) {
      this.visuals.openPlaces(false);
      return;
    }
    if (place.photo != null) {
      this.flash(goingLine(place.name), 2, '', false);
    }
    if (id !== 'room') {
      try {
        localStorage.setItem(LAST_PLACE_KEY, id);
      } catch {
        // Private window: no memory of the last place.
      }
    }
    const ok = await this.visuals.goPlace(id);
    if (!ok) {
      this.flash('That place could not load. You are still in your room.', 3);
      return;
    }
    this.cue('night', { x: 0, y: 0.4, z: -0.6 });
    window.setTimeout(() => this.visuals.openPlaces(false), via === 'hand' ? 700 : 0);
    this.flash(place.arrive, 4, id === 'room' ? '' : 'Say "back to my room" anytime.');
  }

  /** Prepares one place (panorama on the GPU, living layer compiled, sounds fetched). One at a time. */
  private async preparePlace(id: PlaceId, why: string): Promise<void> {
    if (this.prepBusy || id === 'room' || id === this.visuals.backdrop.place || this.visuals.backdrop.preparedPlaces.includes(id) || PLACES[id] == null) return;
    this.prepBusy = true;
    const t0 = performance.now();
    let ok = false;
    try {
      ok = await this.visuals.preparePlace(id);
    } catch {
      ok = false;
    }
    this.prepBusy = false;
    this.prepLog.push({ id, why, ms: Math.round(performance.now() - t0), ok });
    if (this.prepLog.length > 20) this.prepLog.shift();
  }

  private async upgradePlace(id: PlaceId): Promise<void> {
    if (this.prepBusy) return;
    this.prepBusy = true;
    const t0 = performance.now();
    let ok = false;
    try {
      ok = await this.visuals.backdrop.prepare(id);
    } catch {
      ok = false;
    }
    this.prepBusy = false;
    this.prepLog.push({ id, why: 'hd upgrade', ms: Math.round(performance.now() - t0), ok });
    if (this.prepLog.length > 20) this.prepLog.shift();
  }

  /**
   * Calm moments (once a second): the lamp silent, nothing touched or said for 3 s, not breathing or releasing, the
   * arrival over → the next likely place is prepared: the last place you chose, then the lake (Talk it through).
   */
  private updatePlacePrep(): void {
    if (this.elapsed < this.prepAt) return;
    this.prepAt = this.elapsed + 1;
    const placed = this.placementMode === 'table' || this.placementMode === 'floating';
    if (!placed || this.prepBusy || !this.visuals.uiShown) return;
    if (this.mode === 'breathe' || this.mode === 'release' || this.mode === 'night' || this.mode === 'arrive') return;
    if (this.elapsed - this.lastActivity < 3 || this.voice.speaking(this.elapsed) || (this.tts?.speaking ?? false) || this.talk?.busy === true) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_PLACE_KEY);
    } catch {
      last = null;
    }
    // 26 Oct (HD places): the place you are in, shown in 6k because it was chosen before its 8k was ready, comes
    // first: same image, sharper, swapped in place (no crossfade).
    const here = this.visuals.backdrop.place;
    if (here !== 'room' && this.visuals.backdrop.needsHd(here)) {
      void this.upgradePlace(here);
      return;
    }
    const ready = this.visuals.backdrop.preparedPlaces;
    for (const id of [last, 'moon-lake']) {
      if (id == null || !(id in PLACES) || id === 'room' || id === this.visuals.backdrop.place || ready.includes(id as PlaceId)) continue;
      void this.preparePlace(id as PlaceId, id === last ? 'last place' : 'talk place');
      return;
    }
  }

  private setImmersion(level: Immersion): void {
    track('immersion', { level }, `immersion:${level}`);
    if (this.visuals.backdrop.place === 'room') {
      this.flash('Choose a place first: say "take me to the lake".', 3);
      return;
    }
    this.visuals.backdrop.setImmersion(level);
    this.visuals.setImmersionFull(level === 'full');
    this.flash(level === 'full' ? 'Fully there.' : 'Your table stays with you.', 2.2);
  }

  // ------------------------------------------------------------- the evening (v6)

  /** The lamp proposes a ritual (and tints it in the menu). `heard`: what the person just said. */
  private propose(heard: string | null, sub?: string, justDone: RitualKind | null = null): void {
    const memory = services.memory;
    const proposal = proposeRitual({ hour: new Date().getHours(), heard: heard ?? undefined, doneTonight: memory.doneTonight(), justDone, firstEvening: this.firstEvening, tension: memory.tonightRecord()?.tensionIn ?? null });
    this.proposal = proposal;
    this.openRitualMenu(true);
    this.say(proposal.line, sub ?? (services.style.quiet ? 'Touch Yes, or Not now.' : proposal.sub));
  }

  private openRitualMenu(open: boolean): void {
    const memory = services.memory;
    this.visuals.openRituals(
      open,
      this.proposal?.ritual ?? null,
      { unload: memory.ritualEvenings('unload'), breathe: memory.ritualEvenings('breathe'), release: memory.ritualEvenings('release'), squeeze: memory.ritualEvenings('squeeze'), keep: memory.ritualEvenings('keep') },
      this.mode === 'choose' ? [] : this.mode === 'unload' ? ['unload'] : [],
    );
  }

  private onRitualCommand(command: RitualCommand): void {
    switch (command.type) {
      case 'pick':
        this.startRitual(command.ritual, undefined, 'voice');
        break;
      case 'accept': {
        const p = this.proposal;
        if (p == null) break;
        if (p.ritual === 'sleep') this.goodnight();
        else this.startRitual(p.ritual, p.carry, 'voice');
        break;
      }
      case 'decline':
        this.proposal = null;
        this.openRitualMenu(true);
        this.flash(PROPOSAL_LINES.decline, 4);
        break;
      case 'menu':
        this.openRitualMenu(true);
        this.flash('Which ritual?', 3, 'Touch one by the lamp, or say its name.', false);
        break;
      case 'finish':
        this.finishRitual();
        break;
      case 'clench':
        this.squeezeClench('voice');
        break;
      case 'unclench':
        this.squeezeUnclench('voice');
        break;
      case 'longer':
        if (this.mode === 'squeeze') {
          if (this.squeeze?.more(this.elapsed)) this.flash('One more.', 1.8, '', false);
          break;
        }
        if (this.breath?.longer()) {
          this.rv.setPearlCount(this.breath.pattern.cycles);
          this.flash('Four more breaths.', 2.5);
        }
        break;
      case 'sink':
        this.releaseEvent({ type: 'voice-sink' });
        break;
      case 'goodnight':
        this.goodnight();
        break;
    }
  }

  /** Free speech while choosing: the agent listens to how you are and proposes (or starts Unload with it). */
  private onChooseSpeech(text: string): void {
    const p = proposeRitual({ hour: new Date().getHours(), heard: text, doneTonight: services.memory.doneTonight() });
    if (p.reason === 'many' || (p.reason !== 'tense' && p.reason !== 'heavy' && text.split(/\s+/u).length >= 6)) {
      // A brain dump is already the start of Unload: the stones come, no question asked.
      this.proposal = { ...p, ritual: 'unload', line: PROPOSAL_LINES.many, reason: 'many', carry: text };
      this.startRitual('unload', text, 'voice', PROPOSAL_LINES.many);
      return;
    }
    if (p.reason === 'tense' || p.reason === 'heavy') {
      this.proposal = p;
      this.openRitualMenu(true);
      this.say(p.line, p.sub);
      return;
    }
    this.propose(null);
  }

  /** Starts a ritual (ending any other gently). `carry`: words heard by the agent, used by the ritual. */
  private startRitual(kind: RitualKind, carry?: string, via: 'hand' | 'voice' = 'hand', intro?: string): void {
    track('ritual-start', { kind, via }, `ritual-start:${kind}`);
    // 28 Oct: choosing a ritual answers the bead's question by itself: it slips back into the tray.
    this.closeTension(false);
    if (this.journal != null) this.closeJournal(false);
    // The lamp leaves your sky for the ritual (the milestone, if any, is already on the table).
    this.visuals.hideSky();
    // A ritual chosen during the follow-ups: the remaining stones simply stay on the desk.
    if (this.followUps.length > 0) {
      this.followUps = [];
      this.ask = null;
      this.askStone = null;
    }
    if (this.mode === kind) {
      this.visuals.openRituals(false);
      return;
    }
    this.endCurrentRitual();
    this.visuals.openRituals(false);
    this.visuals.openPlaces(false);
    this.proposal = null;
    this.cue('tock', { x: this.layout.orb.x, y: 0.02, z: this.layout.orb.z + 0.068 });
    if (kind === 'unload') {
      this.mode = 'unload';
      this.setStonesAway(false);
      this.visuals.bowlsAwayTarget = 0;
      // Started by a brain dump: the lamp answers what it heard; the generic "what is on your mind?" stays silent.
      const heard = carry != null && carry.trim().length > 0;
      if (heard) this.silentPhase = true;
      // 29 Oct: a dump started by a spoken sentence is a talking one; started by a touch, it stays touch until words.
      this.dumpSpoke = heard && via === 'voice';
      // Opening Unload by a touch says nothing about talking: only a touched word / bubble or a pinch marks
      // the evening as "hands only" (the bubbles then need no hesitation).
      this.dumpTouched = false;
      this.lastInputAt = this.elapsed;
      if (this.ritual.phase === 'arrive') {
        this.event({ type: 'placed' });
        this.bringBackLater();
      } else if (this.ritual.phase === 'night') {
        // Another round tonight: the bowls keep what was sorted, new stones join.
        this.ritual = { ...this.ritual, phase: 'dump' };
        this.planKept = false;
      }
      this.silentPhase = false;
      if (heard && carry != null) {
        this.heardLine = carry.length > 60 ? `${carry.slice(0, 57)}…` : carry;
        if (intro != null) this.flash(intro, 3.2, `"${this.heardLine}"`);
        void this.extract(carry);
      } else {
        this.lastPhaseSpoken = '';
        this.refreshCaption();
      }
      // Talk evening: touching Unload opens the microphone (once). A quiet evening never asks for it.
      if (via === 'hand' && services.voice.state === 'off' && !services.style.quiet) void services.voice.start().then(() => this.refreshCaption());
      return;
    }
    if (kind === 'talk') {
      this.startTalk();
      return;
    }
    if (kind === 'breathe') {
      this.startBreathe();
      return;
    }
    if (kind === 'squeeze') {
      this.startSqueeze();
      return;
    }
    if (kind === 'keep') {
      this.startKeep(carry);
      return;
    }
    this.startRelease(carry);
  }

  /** Cleans up Breathe / Release (no record): the globe goes home, the bowls come back. */
  private endCurrentRitual(): void {
    if (this.mode === 'talk') {
      // Another ritual chosen mid-talk: the lamp stops speaking; the stones of what weighs stay on the desk.
      // 26 Oct (stability pass): a talk the person had already closed ("that's all") still counts as done.
      if (this.talk?.closing === true && this.talk.turns.length > 0) {
        track('ritual-done', { kind: 'talk' }, 'ritual-done:talk');
        services.memory.recordRitual('talk');
      }
      this.tts?.stop();
      this.talk = null;
    }
    if (this.helpShown) {
      this.helpShown = false;
      this.visuals.hideCard();
    }
    if (this.mode === 'breathe') {
      this.breath = null;
      this.visuals.living.setBreath(null);
      this.visuals.setFootMove(0, 0, 1);
      if (!this.visuals.orbEntity.hasComponent(PokeInteractable)) this.visuals.orbEntity.addComponent(PokeInteractable);
      this.visuals.orbDirect = false;
      this.visuals.orbHome();
      this.visuals.setMoon(0, -1);
      this.rv.pearlTarget = 0;
      this.rv.dimTarget = 0;
      this.rv.palms(null, null, 0, 0);
    }
    if (this.mode === 'squeeze') {
      this.squeeze = null;
      this.rv.dimTarget = 0;
      this.rv.palms(null, null, 0, 0);
    }
    if (this.mode === 'keep') this.endKeep();
    if (this.mode === 'release') {
      const sank = this.release?.released === true;
      this.release = null;
      this.visuals.orbHome();
      this.rv.bowlTarget = 0;
      this.rv.hover(0, 0, 0);
      this.rv.under(0, 0, 0);
      // What sank stays at the bottom and goes down with the bowl; anything else dissolves now.
      if (this.weight != null && sank) {
        this.weightLeaving = true;
      } else {
        this.disposeWeight();
      }
    }
    this.visuals.setRitualsLabel(false);
    this.visuals.bowlsAwayTarget = 0;
    this.setStonesAway(false);
    this.setRays(true);
  }

  /** A ritual ended well: remember it, restore the tray, and the lamp proposes what comes next. */
  private completeRitual(kind: RitualKind, extra: { breaths?: number; sunk?: string } = {}): void {
    track('ritual-done', { kind }, `ritual-done:${kind}`);
    services.memory.recordRitual(kind, extra);
    if (kind !== 'unload') this.endCurrentRitual();
    this.mode = 'choose';
    this.showStars();
    this.lastPhaseSpoken = '';
    this.propose(null, undefined, kind);
  }

  /** "Finish" / "that's enough": ends Breathe or Release gently, never abruptly. */
  private finishRitual(): void {
    if (this.mode === 'talk') {
      this.closeTalk();
      return;
    }
    if (this.mode === 'breathe' && this.breath != null) {
      this.breath.finish(this.elapsed);
      return;
    }
    if (this.mode === 'squeeze' && this.squeeze != null) {
      this.squeeze.finish(this.elapsed);
      return;
    }
    if (this.mode === 'keep') {
      this.finishKeep();
      return;
    }
    if (this.mode === 'release' && this.release != null) {
      const phase = this.release.phase;
      if (phase === 'sinking' || phase === 'gone') return;
      this.releaseEvent({ type: 'cancel' });
    }
  }

  /** Unload stones shrink away (and cannot be grabbed) while another ritual uses the tray. */
  private setStonesAway(away: boolean): void {
    this.stonesAwayTarget = away ? 1 : 0;
    if (away === !this.stonesGrabbable) return;
    this.stonesGrabbable = !away;
    for (const stone of this.stones.values()) {
      if (away) {
        if (stone.entity.hasComponent(OneHandGrabbable)) stone.entity.removeComponent(OneHandGrabbable);
      } else if (!stone.entity.hasComponent(OneHandGrabbable) && stone.dissolving < 0) {
        stone.entity.addComponent(OneHandGrabbable, { rotate: false, translate: true });
      }
    }
  }

  // ---------------------------------------------------------------- Breathe

  private startBreathe(): void {
    this.mode = 'breathe';
    this.setRays(false);
    // The moon is not a button: fingertips resting near it must neither poke it nor draw a touch cursor on it.
    if (this.visuals.orbEntity.hasComponent(PokeInteractable)) this.visuals.orbEntity.removeComponent(PokeInteractable);
    this.breath = new BreatheSession();
    this.breath.begin(this.elapsed);
    this.breathKey = '';
    this.setStonesAway(true);
    this.visuals.bowlsAwayTarget = 1;
    this.visuals.hideCard();
    this.visuals.setRitualsLabel(true);
    this.visuals.orbDirect = true;
    this.rv.setPearlCount(this.breath.pattern.cycles);
    this.rv.clearPearls();
    this.rv.pearlTarget = 1;
    this.cue('moon', { x: MOON.x, y: MOON.y, z: MOON.z });
  }

  private updateBreathe(dt: number): void {
    const b = this.breath;
    if (b == null || this.frame == null) return;
    const f = b.frame(this.elapsed);
    const p = b.pattern;
    // Living places: the cove's waves come in with your breath in and pull back with your breath out; embers breathe.
    this.visuals.living.setBreath(f);
    // The whole lamp glides to the centre of the tray and grows; its globe becomes the moon, still resting in
    // its stoneware cup, swelling with the inhale and settling with the exhale.
    const radius = MOON.exhaled + (MOON.inhaled - MOON.exhaled) * f.level;
    const k = f.presence;
    const home = this.layout.orb;
    const footScale = 1 + (MOON.foot - 1) * k;
    const fx = home.x + (MOON.x - home.x) * k;
    const fz = home.z + (MOON.z - home.z) * k;
    this.visuals.setFootMove(fx - home.x, fz - home.z, footScale);
    const r = LAMP.globe + (radius - LAMP.globe) * k;
    // Resting on the cup rim, at the resting lamp's height at the start (no jump).
    const centreY = moonCentreY(r, footScale);
    this.visuals.orbTo(fx, centreY, fz, r / LAMP.globe);
    this.visuals.setMoon(k, k > 0.02 ? f.level : -1);
    // Pearls: one per completed breath (brighter when the hands breathed with it).
    for (let i = 0; i < p.cycles; i++) this.rv.setPearl(i, i < f.completed ? (b.followed(i) ? 1.3 : 1) : 0);
    this.rv.setBreath(f.phase === 'in' || f.phase === 'out' ? f.cycle : -1, f.level);
    // The room sinks into a real dusk for Breathe (owner, 19 Oct: "the room should darken, for immersion"): the moon
    // becomes the light; each exhale deepens it a little more. Passthrough or Place, never the desk.
    this.rv.dimTarget = (f.phase === 'in' || f.phase === 'out' ? 0.58 + 0.16 * (1 - f.level) : 0.55) * k;
    // Hands: open and close with the breath (optional); the moon's warm light lands on open palms.
    this.readHands();
    const opennessNow = this.hands.left.tracked || this.hands.right.tracked ? Math.max(this.hands.left.tracked ? this.hands.left.open : 0, this.hands.right.tracked ? this.hands.right.open : 0) : null;
    b.sample(this.elapsed, opennessNow);
    const moonWorld = rig.uOrbPos.value;
    const palmStrength = (h: { tracked: boolean; palm: Vector3; open: number }) => {
      if (!h.tracked) return 0;
      const d = h.palm.distanceTo(moonWorld);
      return k * (0.4 + 0.6 * h.open) * (0.6 + 0.4 * f.level) * Math.max(0, 1 - d / 0.75);
    };
    this.rv.palms(this.hands.left.tracked ? this.hands.left.palm : null, this.hands.right.tracked ? this.hands.right.palm : null, palmStrength(this.hands.left), palmStrength(this.hands.right));
    // Motes: rising around the moon on the inhale, drifting down on the exhale.
    if ((f.phase === 'in' || f.phase === 'out') && this.elapsed - this.breathMoteAt > 0.45) {
      this.breathMoteAt = this.elapsed;
      deskToWorld(this.frame, { x: MOON.x, y: f.phase === 'in' ? 0.03 : 0.2, z: MOON.z }, this.world3);
      this.visuals.lights.drift(this.world3.x, this.world3.y, this.world3.z, 2, 0.1, 0.2, f.phase === 'in' ? 0.03 : -0.022, f.phase === 'in' ? 4 : 5.5);
    }
    // Phase changes: caption, voice (first cycles and the last), tones, a chime for each pearl.
    const key = `${f.phase}${f.cycle}`;
    if (key !== this.breathKey) {
      const previous = this.breathKey;
      this.breathKey = key;
      const c = breathCaption(f, p, b.finishing);
      this.visuals.say(c.text, c.sub);
      this.baseCaption = c;
      const line = breathLine(f, p);
      if (line != null && !(b.finishing && f.phase === 'close' && previous.startsWith('close'))) this.speakLine(line);
      if (f.phase === 'in') this.cue('swell', { x: MOON.x, y: MOON.y, z: MOON.z });
      if (f.phase === 'out') this.cue('ebb', { x: MOON.x, y: MOON.y, z: MOON.z });
      if ((f.phase === 'in' && f.cycle > 0) || (f.phase === 'close' && f.completed > 0 && !previous.startsWith('close'))) {
        const n = f.completed - 1;
        const x = PEARL_ROW.x + (n - (p.cycles - 1) / 2) * PEARL_ROW.spacing;
        this.cue('pearl', { x, y: 0.01, z: PEARL_ROW.z });
        if (b.followed(n)) {
          deskToWorld(this.frame, { x, y: 0.02, z: PEARL_ROW.z }, this.world3);
          this.visuals.lights.emit(this.world3.x, this.world3.y, this.world3.z, 10, 0.01, 0.5);
        }
      }
      if (f.phase === 'close') {
        this.rv.pearlTarget = f.completed > 0 ? 1 : 0;
        this.visuals.orbDirect = true;
      }
    }
    if (f.phase === 'done') {
      const breaths = f.completed;
      this.visuals.orbDirect = false;
      // Stopped before a single full breath: nothing is recorded, the lamp simply proposes again.
      if (breaths > 0) this.completeRitual('breathe', { breaths });
      else this.completeRitualAbandoned();
    }
    void dt;
  }

  /** Hand joints (optional): palm position and openness for each tracked hand. */
  private readHands(): void {
    this.hands.left.tracked = false;
    this.hands.right.tracked = false;
    const frame = this.xrFrame as (XRFrame & { getJointPose?: (joint: XRSpace, base: XRSpace) => XRJointPose | undefined }) | undefined;
    const ref = this.renderer.xr.getReferenceSpace();
    const session = this.world.session as XRSession | undefined;
    if (frame?.getJointPose == null || ref == null || session == null) return;
    for (const src of session.inputSources) {
      if (src.hand == null || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
      const h = this.hands[src.handedness];
      const wrist = frame.getJointPose(src.hand.get('wrist')!, ref);
      const knuckle = frame.getJointPose(src.hand.get('middle-finger-phalanx-proximal')!, ref);
      if (wrist == null || knuckle == null) continue;
      const w = wrist.transform.position;
      let sum = 0;
      let n = 0;
      for (const name of ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip'] as const) {
        const tip = frame.getJointPose(src.hand.get(name)!, ref);
        if (tip == null) continue;
        const t = tip.transform.position;
        sum += Math.hypot(t.x - w.x, t.y - w.y, t.z - w.z);
        n++;
      }
      if (n === 0) continue;
      const kp = knuckle.transform.position;
      h.palm.set((w.x + kp.x) / 2, (w.y + kp.y) / 2, (w.z + kp.z) / 2).applyMatrix4(this.player.matrixWorld);
      h.open = opennessFromCurl(sum / n);
      h.tracked = true;
    }
  }

  // ---------------------------------------------------------------- Release

  private startRelease(carry?: string): void {
    this.mode = 'release';
    this.setRays(false);
    this.release = initialRelease();
    this.releaseDoneAt = -1;
    this.setStonesAway(true);
    this.visuals.bowlsAwayTarget = 1;
    this.visuals.hideCard();
    this.visuals.setRitualsLabel(true);
    this.visuals.orbDirect = false;
    // The lamp stays on its foot, where it always is (v6 review: a floating globe read as a bug).
    this.visuals.orbHome();
    window.setTimeout(() => {
      if (this.mode !== 'release') return;
      this.rv.bowlTarget = 1;
      this.cue('rise', { x: WATER_BOWL.x, y: 0.03, z: WATER_BOWL.z });
    }, 450);
    if (carry != null && carry.trim().length > 0) {
      this.formWeight(carry, false);
    } else {
      this.showReleaseCaption(true);
    }
  }

  private releaseEvent(event: ReleaseEvent): void {
    if (this.release == null) return;
    const before = this.release.phase;
    this.release = stepRelease(this.release, event);
    const after = this.release.phase;
    if (before === after && event.type !== 'drop') return;
    if (event.type === 'cancel') {
      // Ends gently: the stone dissolves into the lamp's light, the bowl goes back into the tray.
      if (this.weight != null) {
        this.weight.uniforms.uDissolve.value = 0.001;
        this.weight.anim.kind = 'none';
      }
      this.flash('Gently. Another time.', 2.5, '', false);
      window.setTimeout(() => {
        if (this.mode === 'release') this.completeRitualAbandoned();
      }, 1400);
      return;
    }
    if (after === 'sinking' && event.type === 'voice-sink') {
      this.floatToWater();
    }
    if (after === 'gone') {
      this.releaseDoneAt = this.elapsed;
    }
    this.showReleaseCaption(after !== before);
  }

  /** Release left before anything sank: no record, back to choosing. */
  private completeRitualAbandoned(): void {
    this.endCurrentRitual();
    this.mode = 'choose';
    this.propose(null);
  }

  private showReleaseCaption(speak: boolean): void {
    if (this.release == null) return;
    const mic = services.voice.state === 'listening' || services.voice.state === 'muted' || services.voice.state === 'off' || services.voice.state === 'requesting';
    const c = releaseCaption(this.release, mic, services.style.quiet);
    this.baseCaption = c;
    if (this.captionOverride == null || this.captionOverride.until <= this.elapsed) this.visuals.say(c.text, c.sub);
    if (speak) this.speakPhase(c.text);
  }

  /** What weighs on them becomes the dark engraved stone, born at the lamp, landing beside the bowl. */
  private formWeight(text: string, fromStone: boolean): void {
    if (this.release == null || this.frame == null) return;
    const said = text.trim();
    void (fromStone ? Promise.resolve(said) : services.agent.summarize(said)).then((title) => {
      if (this.mode !== 'release' || this.release == null || this.release.phase !== 'ask' || this.frame == null) return;
      this.releaseEvent({ type: 'heard', title });
      this.visuals.say('What weighs on you tonight?', fromStone ? '' : `"${said.length > 60 ? `${said.slice(0, 57)}…` : said}"`);
      this.createWeight(title);
    });
  }

  /** No microphone: tonight's heaviest stone (Let go, else the first unsorted), else the last star, else an example. */
  private heaviestStone(): string {
    const s = this.session.summary();
    return s.letGo.at(-1) ?? s.unsorted[0] ?? services.memory.stars().at(-1)?.text ?? 'The meeting with Paul';
  }

  private createWeight(title: string): void {
    if (this.frame == null) return;
    this.disposeWeight();
    this.weightShape ??= createPebbleGeometry(0.06, 0.042, 0.026, 0.025, 11, -0.013);
    const shape = this.weightShape;
    const { cell, uv } = this.atlas.allocate(title, true);
    const material = this.stoneMaterialProto.clone() as typeof this.stoneMaterialProto;
    linkShared(material);
    material.uniforms.uMap.value = this.atlas.texture;
    material.uniforms.uCell.value = new Vector4(uv[0], uv[1], uv[2], uv[3]);
    material.uniforms.uSeed.value = 5.3;
    material.uniforms.uBasalt.value = 1;
    // The engraving stays on the flat of the top face (two centred lines), never on the curved shoulders.
    material.uniforms.uLabel.value.set(0.074 * shape.size, 0.0472 * shape.size);
    const mesh = new Mesh(shape.geometry, material);
    mesh.renderOrder = 2;
    mesh.rotation.y = this.frame.yaw - 0.12;
    mesh.scale.setScalar(0.001);
    const entity = this.world.createTransformEntity(mesh).addComponent(WeightStone, { title }).addComponent(OneHandGrabbable, { rotate: false, translate: true });
    // Born at the lamp, it glides down beside the bowl, on your right, engraving up.
    const from = { x: this.layout.orb.x - 0.01, y: LAMP.globeY + 0.02, z: this.layout.orb.z + 0.01 };
    const rest = { x: 0.205, y: 0.013, z: 0.115 };
    deskToWorld(this.frame, from, this.world3);
    mesh.position.set(this.world3.x, this.world3.y, this.world3.z);
    this.stoneBatch.add(mesh, material.uniforms);
    this.weight = {
      mesh,
      entity,
      uniforms: material.uniforms,
      cell,
      rest,
      anim: { kind: 'glide', t: 0, from, to: rest, duration: 1.5, then: () => this.releaseEvent({ type: 'formed' }) },
      vy: 0,
      sinkT: 0,
      held: false,
      title,
    };
    this.cue('appear', from);
  }

  /** The sunk stone goes back into the tray with the bowl, then it is released (GPU memory freed). */
  private updateLeavingWeight(): void {
    const w = this.weight;
    if (w == null || !this.weightLeaving || this.frame == null) return;
    deskToWorld(this.frame, { x: 0, y: 0, z: 0 }, this.world3);
    const bottom = this.world3.y + WATER_BOWL.floor + 0.012 + this.rv.bowlOffset;
    w.mesh.position.y = bottom;
    w.uniforms.uWaterY.value = this.rv.waterWorldY();
    if (this.rv.bowlShown < 0.02) this.disposeWeight();
  }

  private disposeWeight(): void {
    const w = this.weight;
    if (w == null) return;
    this.weight = null;
    this.weightLeaving = false;
    this.stoneBatch.remove(w.mesh);
    this.atlas.release(w.cell);
    (w.mesh.material as { dispose(): void }).dispose();
    w.entity.dispose();
  }

  private onWeightPick(): void {
    const w = this.weight;
    if (w == null || this.release == null) return;
    if (this.release.phase !== 'hold' && this.release.phase !== 'over') return;
    w.held = true;
    w.anim.kind = 'none';
  }

  private onWeightDrop(): void {
    const w = this.weight;
    this.lastDropAt = this.elapsed;
    if (w == null || this.release == null || this.frame == null || !w.held) return;
    w.held = false;
    worldToDesk(this.frame, w.mesh.position, this.local);
    const over = overWater(this.local);
    this.releaseEvent({ type: 'drop', overWater: over });
    if (over && this.release.phase === 'sinking') {
      this.startFall();
    } else {
      // Missed the water: it simply comes back beside the bowl.
      w.anim = { kind: 'glide', t: 0, from: { ...this.local }, to: w.rest, duration: 0.6, then: null };
      this.cue('tock', w.rest);
    }
  }

  /** Voice "let it go": the stone rises by itself over the water, pauses, then falls. */
  private floatToWater(): void {
    const w = this.weight;
    if (w == null || this.frame == null) return;
    if (w.held) {
      // In the hand: the hand decides (the caption asks to open the fingers over the water).
      this.release = { ...this.release!, phase: 'over', via: null };
      this.flash('Hold it over the water, then open your fingers.', 3, '', false);
      return;
    }
    worldToDesk(this.frame, w.mesh.position, this.local);
    const above = { x: WATER_BOWL.x + 0.012, y: WATER_BOWL.water + 0.13, z: WATER_BOWL.z + 0.02 };
    w.anim = { kind: 'glide', t: 0, from: { ...this.local }, to: above, duration: 1.5, then: () => window.setTimeout(() => this.startFall(), 450) };
  }

  private startFall(): void {
    const w = this.weight;
    if (w == null || this.frame == null) return;
    worldToDesk(this.frame, w.mesh.position, this.local);
    w.anim = { kind: 'fall', t: 0, from: { ...this.local }, to: { ...this.local }, duration: 0, then: null };
    w.vy = 0;
  }

  private updateRelease(dt: number): void {
    const w = this.weight;
    const frame = this.frame;
    if (frame == null) return;
    if (w != null) {
      const m = w.mesh;
      // Scale in at birth.
      if (m.scale.x < 1 && w.uniforms.uDissolve.value === 0) m.scale.setScalar(Math.min(1, m.scale.x + dt * 2.2));
      w.uniforms.uWaterY.value = this.rv.bowlShown > 0.05 ? this.rv.waterWorldY() : -100;
      const a = w.anim;
      if (w.held) {
        worldToDesk(frame, m.position, this.local);
        const over = overWater(this.local);
        this.releaseEvent({ type: 'over', over });
        this.rv.hover(this.local.x, this.local.z, over ? 1 : 0);
        w.uniforms.uGlow.value += ((over ? 0.28 : 0.14) - w.uniforms.uGlow.value) * (1 - Math.exp(-8 * dt));
      } else {
        this.rv.hover(0, 0, 0);
        w.uniforms.uGlow.value += (0 - w.uniforms.uGlow.value) * (1 - Math.exp(-6 * dt));
      }
      if (!w.held && a.kind === 'glide') {
        a.t += dt / a.duration;
        const k = Math.min(1, a.t);
        const e = easeInOut(k);
        this.local.x = a.from.x + (a.to.x - a.from.x) * e;
        this.local.y = a.from.y + (a.to.y - a.from.y) * e + Math.sin(Math.PI * k) * 0.03;
        this.local.z = a.from.z + (a.to.z - a.from.z) * e;
        deskToWorld(frame, this.local, this.world3);
        m.position.set(this.world3.x, this.world3.y, this.world3.z);
        if (k >= 1) {
          a.kind = 'none';
          const then = a.then;
          a.then = null;
          then?.();
        }
      } else if (!w.held && a.kind === 'fall') {
        // Falls to the surface (a short drop, real gravity, capped), then the splash.
        worldToDesk(frame, m.position, this.local);
        w.vy = Math.max(-1.4, w.vy - 6.5 * dt);
        this.local.y += w.vy * dt;
        const surface = WATER_BOWL.water + 0.004;
        if (this.local.y <= surface) {
          this.local.y = surface;
          this.rv.ripple(this.local.x, this.local.z, 0.0011 + Math.min(0.0009, -w.vy * 0.0008));
          this.rv.bubbles(this.local.x, this.local.z, 5, 1.6);
          this.cue('sink', { x: this.local.x, y: WATER_BOWL.water, z: this.local.z });
          // Living places: far out in the clearing, the fire answers with a gerbe of sparks.
          this.visuals.living.onStoneReleased();
          window.setTimeout(() => this.cue('bubbles', { x: WATER_BOWL.x, y: WATER_BOWL.water, z: WATER_BOWL.z }), 700);
          a.kind = 'sink';
          a.t = 0;
          a.from = { ...this.local };
          // Drifts a little toward the centre as it goes down.
          a.to = { x: this.local.x * 0.55 + WATER_BOWL.x * 0.45, y: WATER_BOWL.floor + 0.012, z: this.local.z * 0.55 + WATER_BOWL.z * 0.45 };
          a.duration = 3.2;
          w.sinkT = 0;
        }
        deskToWorld(frame, this.local, this.world3);
        m.position.set(this.world3.x, this.world3.y, this.world3.z);
      } else if (a.kind === 'sink') {
        a.t += dt / a.duration;
        w.sinkT += dt;
        const k = Math.min(1, a.t);
        const e = 1 - Math.pow(1 - k, 2.2);
        this.local.x = a.from.x + (a.to.x - a.from.x) * e;
        this.local.y = a.from.y + (a.to.y - a.from.y) * e;
        this.local.z = a.from.z + (a.to.z - a.from.z) * e;
        deskToWorld(frame, this.local, this.world3);
        m.position.set(this.world3.x, this.world3.y, this.world3.z);
        m.rotation.y += dt * 0.12 * (1 - k);
        m.rotation.z = Math.sin(w.sinkT * 1.3) * 0.05 * (1 - k);
        // The words fill with light, then the light leaves them: they fade into the water.
        const t = w.sinkT;
        const glow = t < 0.7 ? t / 0.7 : Math.max(0, 1 - (t - 0.9) / 1.8);
        w.uniforms.uEngraveGlow.value = glow;
        w.uniforms.uEngraveFade.value = Math.min(1, Math.max(0, (t - 0.8) / 2.0));
        this.rv.under(this.local.x, this.local.z, glow);
        if (t > 0.5 && t < 2.6 && Math.floor(t * 6) !== Math.floor((t - dt) * 6)) {
          deskToWorld(frame, { x: this.local.x, y: WATER_BOWL.water + 0.006, z: this.local.z }, this.world3);
          this.visuals.lights.emit(this.world3.x, this.world3.y, this.world3.z, 3, 0.02, 0.55);
        }
        if (k >= 1) {
          a.kind = 'none';
          this.rv.ripple(this.local.x, this.local.z, 0.00025);
          this.rv.under(0, 0, 0);
          this.releaseEvent({ type: 'sunk' });
          this.cue('release', { x: WATER_BOWL.x, y: 0.08, z: WATER_BOWL.z });
          // A new star joins the sky (the stone is now part of it).
          const star = starPosition(services.memory.stars().length + 104729);
          deskToWorld(frame, star, this.world3);
          this.visuals.lights.star(this.world3.x, this.world3.y, this.world3.z, star.size * 1.1, 0xffeed6, 0.8);
        }
      }
      // Cancelled: the stone dissolves into light where it is.
      if (w.uniforms.uDissolve.value > 0) {
        w.uniforms.uDissolve.value = Math.min(1, w.uniforms.uDissolve.value + dt * 0.8);
        if (Math.random() < 0.5) this.visuals.lights.emit(m.position.x, m.position.y, m.position.z, 2, 0.03, 0.7);
        if (w.uniforms.uDissolve.value >= 1) this.disposeWeight();
      }
    }
    // "Gone. Breathe out." stays a moment, then the lamp proposes what comes next.
    if (this.release?.phase === 'gone' && this.releaseDoneAt >= 0 && this.elapsed - this.releaseDoneAt > 3.6) {
      const title = this.release.title;
      this.releaseEvent({ type: 'settled' });
      this.completeRitual('release', { sunk: title });
    }
  }

  // ------------------------------------------------------------------- plan

  private async makePlan(lighter: boolean): Promise<void> {
    if (this.planBusy) {
      return;
    }
    this.planBusy = true;
    this.refreshOrb();
    try {
      const tomorrow = this.session
        .all()
        .filter((t) => t.bin === 'tomorrow')
        .map((t) => ({ title: t.text, detail: t.detail }));
      this.plan = await services.agent.plan({
        tomorrow,
        later: this.session.summary().later,
        letGoCount: this.session.summary().letGo.length,
        lighter,
      });
      const minutes = this.plan.steps.reduce((sum, s) => sum + s.minutes, 0);
      this.visuals.showCard(
        {
          title: 'Tomorrow',
          subtitle: `${this.plan.steps.length === 1 ? 'One small start' : `${['', 'One', 'Two', 'Three'][this.plan.steps.length]} small starts`}, ${minutes} minutes in all`,
          rows: this.plan.steps.map((s) => ({ time: s.when, title: s.title, detail: `${s.step}, ${s.minutes} min` })),
          footer: this.plan.note,
          accent: DS.text.primary,
        },
        true,
      );
      this.cue('plan', { x: 0, y: 0.25, z: -0.25 });
      this.event({ type: 'plan-ready' });
      this.say('A gentle start for tomorrow. Keep it?', 'Touch a button, or say "keep it" or "lighter".');
    } finally {
      this.planBusy = false;
      this.refreshOrb();
    }
  }

  private keepPlan(): void {
    this.planKept = true;
    services.memory.recordNight(this.session.summary(), this.plan?.steps ?? [], true);
    this.visuals.hideCard();
    this.event({ type: 'plan-kept' });
  }

  private enterNight(): void {
    const memory = services.memory;
    memory.recordNight(this.session.summary(), this.plan?.steps ?? [], this.planKept);
    const s = this.session.summary();
    if (s.tomorrow.length + s.later.length + s.letGo.length > 0 && !memory.doneTonight().includes('unload')) {
      memory.recordRitual('unload');
    }
    this.endCurrentRitual();
    this.visuals.openRituals(false);
    this.visuals.openPlaces(false);
    this.proposal = null;
    const streak = memory.streak();
    const stars = memory.totalLetGo();
    this.visuals.setDim(1);
    this.sounds.fadeAmbient(0.06);
    this.cue('night', { x: 0, y: 0.3, z: -0.3 });
    for (const stone of this.stones.values()) {
      stone.done = 1;
    }
    const kept = this.planKept ? 'Your plan will be here in the morning. ' : '';
    const sky = `${stars} ${stars === 1 ? 'star' : 'stars'} in your sky`;
    // 28 Oct: the evening's summary ("Tonight: 3 let go · 6 breaths · 7 → 3"), true to what was recorded.
    const night = memory.tonightRecord();
    const summary = night == null ? null : nightSummary({ letGo: night.letGo.length + (night.sunk?.length ?? 0), breaths: night.breaths ?? 0, kept: night.kept?.length ?? 0, tensionIn: night.tensionIn, tensionOut: night.tensionOut });
    void streak;
    this.say('Your desk is clear. Good night.', summary != null && summary !== 'A quiet evening.' ? `${summary}. ${kept}` : `${kept}${streak > 1 ? `Evening ${streak} in a row, ${sky}.` : `${sky[0].toUpperCase()}${sky.slice(1)}.`}`);
  }

  private goodnight(): void {
    // 28 Oct: before the night, once, the bead again ("Before you sleep: how heavy now?"), with tonight's arrival as a
    // faint reflection. Skipped, or "good night" said again: the night comes at once.
    if (this.tensionSide === 'out') {
      this.skipTension();
      return;
    }
    if (this.mode !== 'night' && !this.checkoutAsked && this.frame != null && (this.placementMode === 'table' || this.placementMode === 'floating') && (services.memory.doneTonight().length > 0 || services.memory.tonightRecord()?.tensionIn != null)) {
      this.checkoutAsked = true;
      this.endCurrentRitual();
      this.visuals.openRituals(false);
      this.visuals.openPlaces(false);
      this.visuals.hideCard();
      this.proposal = null;
      this.mode = 'choose';
      this.askTension('out', () => this.goodnight());
      return;
    }
    track('goodnight', { secs: secs() }, 'goodnight');
    // Living places: the fire settles to embers, its crackles space out.
    this.visuals.living.setGoodNight(true);
    if (this.mode === 'night') {
      // "Good night" again in the night: the lamp says so, and the session closes gently.
      if (this.nightSeq != null) this.leaveNight('voice');
      else this.goodnightAt = this.elapsed;
      return;
    }
    this.mode = 'night';
    this.eveningSpan.goodnight = true;
    if (this.ritual.phase === 'plan') {
      this.event({ type: 'skip-plan' });
    }
    this.ritual = { ...this.ritual, phase: 'night' };
    this.visuals.hideCard();
    if (this.journal != null) this.closeJournal(false);
    this.enterNight();
    // 28 Oct: the session no longer closes 8.5 s later: your sky goes up to the ceiling, and the lamp offers to stay.
    this.goodnightAt = -1;
    this.nightSeq = { at: this.elapsed, step: 0, askedAt: -1 };
  }

  // ---------------------------------------------------------------- morning

  private startMorning(): void {
    this.visuals.living.setGoodNight(false);
    const plan = this.morning;
    if (plan == null) {
      return;
    }
    this.cue('morning', { x: 0, y: 0.25, z: -0.25 });
    plan.tomorrow.slice(0, 5).forEach((text, i) => this.spawnStone({ title: text, detail: text, suggestion: 'tomorrow' }, i * 0.25, 'carried'));
    this.visuals.showCard(
      {
        title: 'This morning',
        subtitle: plan.plan.length > 0 ? 'What you kept last night' : 'What you saved for today',
        // 24 Oct — agent memory: without a kept plan, the card still lists what you saved; and it cites what you
        // said was done last night.
        rows:
          plan.plan.length > 0
            ? plan.plan.map((s) => ({ time: s.when, title: s.title, detail: `${s.step}, ${s.minutes} min` }))
            : plan.tomorrow.slice(0, 4).map((t) => ({ time: '', title: t, detail: 'Saved for today' })),
        footer: plan.done.length > 0 ? `Done last night: ${plan.done.slice(0, 2).join(', ')}${plan.done.length > 2 ? '…' : ''}.` : 'One thing at a time. See you tonight.',
        accent: DS.text.primary,
      },
      true,
    );
    this.visuals.setChipLabels(true, 'Start my day');
    this.say('Good morning. Here is what you kept.', 'Touch "Start my day" when you are ready.');
  }

  private endMorning(): void {
    services.memory.markMorningSeen();
    this.visuals.hideCard();
    for (const stone of [...this.stones.values()]) {
      this.disposeStone(stone);
    }
    this.session = new SortingSession();
    this.morning = null;
    this.ritual = { ...initialRitual(), phase: 'night' };
    this.mode = 'night';
    this.say('Have a good day.', 'The desk will be here tonight.');
  }

  // ------------------------------------------------------------- the ritual

  private event(e: RitualEvent): void {
    const before = this.ritual.phase;
    this.ritual = step(this.ritual, e, this.elapsed - this.sessionStart);
    const after = this.ritual.phase;
    if (before !== after) {
      if (after === 'plan') {
        if (this.session.summary().tomorrow.length === 0) {
          this.plan = null;
          this.event({ type: 'skip-plan' });
          return;
        }
        void this.makePlan(false);
      } else if (after === 'night') {
        // v6: Unload is one ritual of the evening: the lamp proposes what comes next (night comes with "good night").
        if (this.mode === 'unload') {
          services.memory.recordNight(this.session.summary(), this.plan?.steps ?? [], this.planKept);
          this.completeRitual('unload');
        }
      } else {
        this.refreshCaption();
      }
    }
  }

  /** v8: when the last sentence was heard (seconds, `elapsed` clock). */
  private lastHeardAt = -1e9;

  /** The evening darkens with you: blue hour → night, slowly; the lamp becomes the main light, then goes out. */
  private updateEvening(dt: number): void {
    const placed = this.placementMode === 'table' || this.placementMode === 'floating';
    if (!placed) return;
    this.eveningGoal = eveningTarget(this.mode, services.memory.doneTonight().length, this.eveningGoal);
    // Good night: the last slide is quicker (≈ 8 s), the lamp goes out with it.
    this.evening = eveningStep(this.evening, this.eveningGoal, dt, this.mode === 'night' ? 0.05 : 0.025);
    this.visuals.backdrop.setEvening(this.evening);
    this.visuals.setEvening(this.evening, this.mode === 'night');
    // Your room dims too (more gently than a place, which is already graded); Breathe dims it further.
    this.rv.eveningDim = Math.max(this.evening * (this.visuals.backdrop.place === 'room' ? 0.42 : 0.18), this.nightDim);
  }

  /**
   * Everything the voice can do, a touch can do (owner, 18 Oct): the lamp's question gets "Yes" / "Not now",
   * Breathe gets "Longer" / "Enough", an empty Unload gets words to touch (and Write…), Release gets tonight's
   * stones (and Write…). Recomputed every frame from the state; textures are redrawn only when it changes.
   */
  private refreshTouch(): void {
    const placed = this.placementMode === 'table' || this.placementMode === 'floating';
    const unloadDump = placed && this.mode === 'unload' && (this.ritual.phase === 'dump' || this.ritual.phase === 'arrive');
    const releaseAsk = placed && this.mode === 'release' && this.release?.phase === 'ask';
    const stones = this.session.all().length;
    // 24 Oct: a stone waiting to be sorted folds the words away — nothing ever hides the tray, a bowl or a stone
    // (they come back once it is placed).
    const toSort = this.session.unsorted().length;
    const p = placed ? this.proposal : null;
    // Voice evening (microphone working): bubbles instead of the word grid, only once the person hesitates.
    const mic = services.voice.state;
    const talkVoice = !services.style.quiet && mic !== 'denied' && mic !== 'unavailable';
    const key = [
      unloadDump ? `u${stones}:${toSort}:${[...this.usedTopics].join(',')}:${this.extracting}:${talkVoice ? `b${this.bubbleKey}` : 'w'}` : '',
      releaseAsk ? `r${stones}` : '',
      p != null && this.mode === 'choose' ? `p${p.ritual}:${services.memory.doneTonight().length}` : '',
      placed && this.mode === 'breathe' ? 'b' : '',
      placed && this.mode === 'squeeze' && this.squeeze != null ? `s${squeezeButton(this.squeeze.frame(this.elapsed)) ?? ''}` : '',
      this.visuals.placesOpen || this.visuals.ritualMenuOpen ? 'm' : '',
      this.ask != null ? `a${this.ask.key}` : '',
      this.tensionSide != null ? `k${this.tensionSide}` : '',
      placed && this.mode === 'keep' ? `g${this.keepCount}:${[...this.keepUsed].join(',')}` : '',
      this.sleep != null ? `z${this.sleep.minutes}` : '',
      this.journal != null ? 'j' : '',
      this.mixOpen ? 'x' : '',
      placed && this.mode === 'talk' ? `t${this.bubbleKey}:${this.talk?.closing === true ? 1 : 0}` : '',
    ].join('|');
    if (key === this.touchKey) return;
    this.touchKey = key;
    // Words grid (closed while a menu takes the same plane).
    const menu = this.visuals.placesOpen;
    if (this.journal != null) {
      // 28 Oct: the journal's page has its own two buttons (Earlier, Close); nothing else on the desk meanwhile.
      this.wordActions = [];
      this.visuals.setWords(null);
    } else if (placed && this.tensionSide != null && !menu) {
      // 28 Oct: the bead's touch twins: three words (Light, Some, Heavy) — the finger on the rail stays the gesture.
      this.wordActions = TENSION_WORDS.map((w) => () => {
        if (this.tensionDial != null) this.keepTension(this.tensionDial.set(w.value), 'touch');
      });
      this.visuals.setWords(TENSION_WORDS.map((w) => ({ label: w.label, dim: false, accent: false })));
    } else if (placed && this.mode === 'keep' && !menu && this.keepDoneAt < 0) {
      // 28 Oct (Keep): good things to touch, and Write… for your own words.
      const words = keepChoices(this.keepUsed);
      this.wordActions = [...words.map((w) => () => this.addGood(w, 'touch')), () => requestWrite('unload', 'A good thing from today?', (text) => void this.handleUtterance(text, 'typed'))];
      this.visuals.setWords([...words.map((label) => ({ label, dim: false, accent: false })), { label: WRITE_LABEL, dim: false, accent: false }]);
    } else if (placed && this.sleep != null && !menu) {
      // 28 Oct (stay till I sleep): how long, by touch.
      this.wordActions = SLEEP_MINUTES.map((m) => () => this.onSleepCommand({ type: 'minutes', minutes: m }, 'touch'));
      this.visuals.setWords(SLEEP_MINUTES.map((m) => ({ label: `${m} min`, dim: false, accent: m === this.sleep!.minutes })));
    } else if (placed && this.mode === 'talk' && !menu) {
      // Talk it through: suggestion bubbles when the person falls silent; without a microphone, Write… too.
      const lines = this.bubbles ?? [];
      const typing = services.style.quiet || mic === 'denied' || mic === 'unavailable';
      const items = lines.map((label) => ({ label, dim: false, accent: false, wide: true }));
      if (typing) items.push({ label: WRITE_LABEL, dim: false, accent: false, wide: false });
      this.wordActions = items.map((w) =>
        w.label === WRITE_LABEL ? () => requestWrite('unload', 'What is on your mind?', (text) => void this.handleUtterance(text, 'typed')) : () => this.onBubble(w.label),
      );
      this.visuals.setWords(items.length > 0 ? items : null);
    } else if (unloadDump && !menu && toSort === 0 && talkVoice) {
      const lines = this.bubbles;
      this.wordActions = (lines ?? []).map((line) => () => this.onBubble(line));
      this.visuals.setWords(lines == null ? null : lines.map((label) => ({ label, dim: false, accent: label === DONE_BUBBLE, wide: true })));
    } else if (unloadDump && !menu && toSort === 0) {
      const words = unloadChoices(this.usedTopics, stones);
      this.wordActions = words.map((w) => () => this.onWord(w.label, 'unload'));
      this.visuals.setWords(words);
    } else if (releaseAsk && !menu) {
      const s = this.session.summary();
      const words = releaseChoices(s.letGo, [...s.unsorted, ...s.tomorrow, ...s.later]);
      this.wordActions = words.map((w) => () => this.onWord(w.label, 'release'));
      this.visuals.setWords(words);
    } else {
      this.wordActions = [];
      this.visuals.setWords(null);
    }
    // Replies.
    if (this.mixOpen) {
      this.replyActions = [() => this.closeMix()];
      this.visuals.setReplies(['Done']);
    } else if (this.journal != null) {
      this.replyActions = [];
      this.visuals.setReplies(null);
    } else if (this.mode === 'keep' && placed && this.keepDoneAt < 0) {
      this.replyActions = [() => this.finishKeep()];
      this.visuals.setReplies([this.keepCount > 0 ? 'That’s all' : 'Not tonight']);
    } else if (this.sleep != null) {
      this.replyActions = [() => this.onSleepCommand({ type: 'leave' }, 'touch')];
      this.visuals.setReplies(['Lights out']);
    } else if (this.tensionSide != null) {
      this.replyActions = [() => this.skipTension()];
      this.visuals.setReplies([this.tensionSide === 'out' ? 'Good night' : 'Skip']);
    } else if (this.ask != null) {
      this.replyActions = this.ask.actions;
      this.visuals.setReplies(this.ask.labels);
    } else if (placed && this.mode === 'talk' && this.talk?.closing !== true) {
      this.replyActions = [() => this.closeTalk()];
      this.visuals.setReplies(['That’s all']);
    } else if (p != null && this.mode === 'choose') {
      // "One bus stop" (23 Oct): once a ritual is done tonight, the way out is always one touch away.
      const canEnd = services.memory.doneTonight().length > 0 && p.ritual !== 'sleep';
      this.replyActions = [() => this.onRitualCommand({ type: 'accept' }), canEnd ? () => this.goodnight() : () => this.onRitualCommand({ type: 'decline' })];
      this.visuals.setReplies(['Yes', canEnd ? 'Good night' : 'Not now']);
    } else if (placed && this.mode === 'breathe') {
      this.replyActions = [() => this.onRitualCommand({ type: 'longer' }), () => this.onRitualCommand({ type: 'finish' })];
      this.visuals.setReplies(['Longer', 'Enough'], true);
    } else if (placed && this.mode === 'squeeze' && this.squeeze != null) {
      // 28 Oct: the touch twin of the fists: "Let go" while squeezing (the light escapes now), "Once more" otherwise.
      const label = squeezeButton(this.squeeze.frame(this.elapsed));
      this.replyActions = label == null ? [() => this.onRitualCommand({ type: 'finish' })] : [label === 'Let go' ? () => this.squeezeUnclench('touch') : () => this.onRitualCommand({ type: 'longer' }), () => this.onRitualCommand({ type: 'finish' })];
      this.visuals.setReplies(label == null ? ['Enough'] : [label, 'Enough'], true);
    } else {
      this.replyActions = [];
      this.visuals.setReplies(null);
    }
  }

  // ------------------------------------------------------- Talk it through

  /** The lamp's dynamic voice, created once the scene's audio listener exists (null before). */
  private ttsPlayer(): TtsPlayer | null {
    if (this.tts != null) return this.tts;
    let listener: { context: AudioContext; getInput(): AudioNode } | null = null;
    this.player.head.traverse((o) => {
      const l = o as unknown as { type?: string; context?: AudioContext; getInput?: () => AudioNode };
      if (l.type === 'AudioListener' && l.context != null && l.getInput != null) listener = l as { context: AudioContext; getInput(): AudioNode };
    });
    if (listener == null) return null;
    const found = listener as { context: AudioContext; getInput(): AudioNode };
    this.tts = new TtsPlayer(found.context, found.getInput());
    this.tts.setVolume(mixLevels.voice);
    return this.tts;
  }

  /**
   * The lamp says something new (not from the voice catalogue): the caption at once, and the dynamic voice from the
   * lamp when the server has one. Unavailable (no voice, budget, network) → the caption alone, never silence alone.
   */
  private lampSpeak(text: string, sub = ''): void {
    this.say(text, sub);
    const player = this.ttsPlayer();
    // 29 Oct: no voice on the server (or no server): the caption alone, without asking (a 503 every 30 s otherwise).
    if (player == null || this.voice.muted || this.voice.quiet || this.elapsed < this.ttsRetryAt || !services.agent.status.voice) return;
    void player.speak(text).then((r) => {
      if (r === 'unavailable') {
        this.ttsRetryAt = this.elapsed + 30;
        track('talk', { event: 'voice-unavailable' }, 'talk:voice-unavailable');
      }
    });
  }

  /** "Talk it through": a calm place, the lamp listens; what weighs becomes stones; up to 45 minutes. */
  private startTalk(): void {
    this.mode = 'talk';
    this.setStonesAway(false);
    this.visuals.bowlsAwayTarget = 0;
    this.talk = { summary: '', turns: [], weights: [], startedAt: this.elapsed, announced: false, busy: false, queued: null, closing: false };
    this.lastActivity = this.elapsed;
    // A calm place (owner): from your room, the lake at night; from a place, you stay where you are. The lamp
    // speaks once the place has been named (its caption first, then the lamp's).
    const travel = this.visuals.backdrop.place === 'room';
    if (travel) void this.goPlace('moon-lake', 'voice');
    if (services.voice.state === 'off' && !services.style.quiet) void services.voice.start();
    const talk = this.talk;
    window.setTimeout(
      () => {
        if (this.talk === talk) this.lampSpeak(TALK_OPENING, services.style.quiet ? 'Touch a sentence below, or Write….' : 'Speak freely. Say "that’s all" to end.');
      },
      travel ? 3600 : 0,
    );
    track('talk', { event: 'start' }, 'talk:start');
  }

  private onTalkSpeech(text: string): void {
    const talk = this.talk;
    if (talk == null || talk.closing) return;
    this.lastActivity = this.elapsed;
    if (talk.busy) {
      talk.queued = talk.queued == null ? text : `${talk.queued} ${text}`;
      return;
    }
    // You speak: the lamp stops talking at once (barge-in) and thinks, visibly.
    this.tts?.stop();
    talk.busy = true;
    this.say(this.baseCaption.text || TALK_OPENING, `"${text.length > 70 ? `${text.slice(0, 67)}…` : text}"`);
    const input = { text, summary: talk.summary, turns: talk.turns.slice(), weights: talk.weights.slice(), closing: false };
    talk.turns.push({ who: 'you', text });
    // Lower latency (25 Oct): the reply arrives sentence by sentence; the first one is shown and spoken at once,
    // the next ones queue behind it in the lamp's voice; the whole checked answer has the last word.
    const heard: string[] = [];
    const asked = this.elapsed;
    if (this.talkNoStream) {
      // Test only (latency A/B): the former path, whole answer first, then the voice.
      void services.agent.talk(input).then((r) => this.onTalkReply(talk, r));
      return;
    }
    void services.agent
      .talkStream(input, (sentence) => {
        if (this.talk !== talk) return;
        heard.push(sentence);
        if (heard.length === 1) {
          this.talkFirstSentenceS = this.elapsed - asked;
          this.say(sentence);
        }
        this.ttsSay(sentence, heard.length > 1);
      })
      .then((r) => this.onTalkReply(talk, r, heard));
  }

  /** Test only (latency A/B, debug API `talkStream(false)`): the whole answer first. */
  private talkNoStream = false;
  /** Seconds from the end of your sentence to the lamp's first sentence (test/debug). */
  private talkFirstSentenceS = 0;

  /** The dynamic voice only (the caption is handled by the caller): now, or after what is already queued. */
  private ttsSay(text: string, queue: boolean): void {
    const player = this.ttsPlayer();
    if (player == null || this.voice.muted || this.voice.quiet || this.elapsed < this.ttsRetryAt || !services.agent.status.voice) return;
    void (queue ? player.append(text) : player.speak(text)).then((r) => {
      if (r === 'unavailable') {
        this.ttsRetryAt = this.elapsed + 30;
        track('talk', { event: 'voice-unavailable' }, 'talk:voice-unavailable');
      }
    });
  }

  private onTalkReply(talk: NonNullable<RitualSystem['talk']>, r: TalkReply, heard: string[] = []): void {
    if (this.talk !== talk || this.mode !== 'talk') return;
    talk.busy = false;
    // Third net, in the browser: whatever the server said, a reply about a crisis is a crisis.
    const crisis = r.crisis || crisisInModelText(r.reply);
    talk.summary = cleanSummary(r.summary);
    if (crisis) {
      // The crisis words never stay in the history sent again, and nothing becomes a stone.
      const last = talk.turns.length - 1;
      if (last >= 0 && talk.turns[last].who === 'you') talk.turns.splice(last, 1);
      talk.queued = null;
      this.tts?.stop();
      this.showHelp();
      this.lampSpeak(CRISIS_REPLY);
      return;
    }
    talk.turns.push({ who: 'lamp', text: r.reply });
    // The browser keeps a little more than the server uses (the server keeps 6): memory stays small.
    if (talk.turns.length > 24) talk.turns.splice(0, talk.turns.length - 24);
    let added = 0;
    for (const w of r.weights) {
      talk.weights.push(w);
      if (this.spawnStone({ title: w, detail: w, suggestion: 'let-go' }, 0.4, 'voice') != null) added++;
    }
    // 29 Oct (found by the hands-only run): these stones count for the ritual too, or once they were let go in the
    // Unload that follows, "That's all" did nothing (no stone on the desk as far as the ritual knew): a dead end.
    if (added > 0) this.event({ type: 'tokens-added', count: added });
    if (heard.length === 0) {
      this.lampSpeak(r.reply);
    } else {
      // Already speaking: the caption shows the whole reply; what was not streamed yet follows in the voice.
      this.say(r.reply);
      const all = spokenSentences(r.reply, true);
      for (let i = heard.length; i < all.length; i++) this.ttsSay(all[i], true);
    }
    track('talk', { event: 'turn' });
    if (talk.queued != null) {
      const q = talk.queued;
      talk.queued = null;
      this.onTalkSpeech(q);
    }
  }

  /** The end, always gentle: a closing line, then the stones of what weighs are let go one by one (Unload). */
  private closeTalk(): void {
    const talk = this.talk;
    if (talk == null || talk.closing) return;
    talk.closing = true;
    talk.busy = true;
    void services.agent
      .talk({ text: 'That is all for tonight.', summary: talk.summary, turns: talk.turns.slice(), weights: talk.weights.slice(), closing: true })
      .then((r) => {
        if (this.talk !== talk) return;
        talk.busy = false;
        this.lampSpeak(r.reply);
        window.setTimeout(() => this.endTalk(talk), Math.max(4, r.reply.length / 12 + 2) * 1000);
      });
  }

  private endTalk(talk: NonNullable<RitualSystem['talk']>): void {
    if (this.talk !== talk || this.mode !== 'talk') return;
    this.talk = null;
    track('talk', { event: 'end' }, 'talk:end');
    if (this.helpShown) {
      this.helpShown = false;
      this.visuals.hideCard();
    }
    if (this.session.unsorted().length > 0) {
      track('ritual-done', { kind: 'talk' }, 'ritual-done:talk');
      services.memory.recordRitual('talk');
      this.mode = 'choose';
      this.startRitual('unload', undefined, 'hand');
      this.flash('Let them go, one by one. Or keep one for tomorrow.', 6);
      return;
    }
    this.completeRitual('talk');
  }

  /** Help resources on the desk (checked on their official sites, safety.ts). Stays until the person moves on. */
  private showHelp(): void {
    this.helpShown = true;
    this.visuals.showCard(
      {
        title: 'You are not alone',
        subtitle: 'Free, confidential help, any time',
        rows: HELP_ROWS.map((r) => ({ time: '', title: r.title, detail: r.detail })),
        footer: 'Wind-Down Desk is not therapy or medical advice.',
        accent: DS.text.primary,
      },
      false,
    );
  }

  /** A touched (or gazed) suggestion bubble: exactly as if the sentence had been said. */
  private onBubble(line: string): void {
    this.usedBubbles.add(line);
    this.lastActivity = this.elapsed;
    track('bubble', { kind: line === DONE_BUBBLE ? 'done' : 'worry' });
    this.cue('tock', { x: 0, y: 0.2, z: -this.layout.depth / 2 });
    void this.handleUtterance(line, 'touch');
  }

  /** A touched word: a topic becomes an engraved stone; a stone of tonight becomes the Release stone; Write… types. */
  private onWord(label: string, purpose: 'unload' | 'release'): void {
    if (label === WRITE_LABEL) {
      this.cue('tock', { x: 0, y: 0.2, z: -this.layout.depth / 2 });
      requestWrite(purpose, purpose === 'unload' ? 'What is on your mind?' : 'What weighs on you tonight?', (text) => void this.handleUtterance(text, 'typed'));
      return;
    }
    if (purpose === 'release') {
      this.formWeight(label, true);
      return;
    }
    if (label === DONE_LABEL) {
      if (this.session.all().length > 0) this.event({ type: 'dump-done', unsorted: this.session.unsorted().length, stones: this.session.all().length });
      return;
    }
    if (this.usedTopics.has(label)) return;
    this.usedTopics.add(label);
    const state = this.spawnStone({ title: label, detail: label, suggestion: null }, 0, 'typed');
    if (state != null) this.event({ type: 'tokens-added', count: 1 });
    this.refreshCaption();
  }

  private captionExtra(): { listening: boolean; micAvailable: boolean; unsorted: number; quiet: boolean } {
    const state = services.voice.state;
    return {
      // v8: a sentence just heard (typed in the play-test console, or a server transcript) means the person is
      // talking: keep inviting them to go on rather than switching to the "pinch" instruction mid-dump.
      listening: state === 'listening' || this.elapsed - this.lastHeardAt < 25,
      micAvailable: state !== 'denied' && state !== 'unavailable',
      unsorted: this.session.unsorted().length,
      // 29 Oct: someone who only touches tonight gets the touch captions, whatever the style.
      quiet: services.style.quiet || (this.dumpTouched && !this.dumpSpoke),
    };
  }

  private refreshCaption(): void {
    if (this.placementMode !== 'table' && this.placementMode !== 'floating') {
      return;
    }
    const phase = this.ritual.phase;
    if (this.mode === 'unload' && (phase === 'dump' || phase === 'sort')) {
      this.baseCaption = {
        text: caption(this.ritual, this.captionExtra()),
        sub:
          this.heardLine.length > 0 && phase === 'dump'
            ? `"${this.heardLine}"`
            : phase === 'dump' && this.ritual.tokensOnDesk === 0 && !services.style.quiet && services.voice.state !== 'denied' && services.voice.state !== 'unavailable'
              ? SPOKEN_EXAMPLE
              : '',
      };
    }
    if (this.captionOverride != null && this.captionOverride.until > this.elapsed) {
      return;
    }
    this.visuals.say(this.baseCaption.text, this.baseCaption.sub);
    // A new instruction that surfaces after a feedback line is said once (the same one is never repeated).
    this.speakPhase(this.baseCaption.text);
    this.refreshOrb();
  }

  /** Phase-level caption; shown now unless a short feedback line is on screen. */
  private say(text: string, sub = ''): void {
    this.baseCaption = { text, sub };
    if (this.captionOverride == null || this.captionOverride.until <= this.elapsed) {
      this.visuals.say(text, sub);
      this.speakPhase(text);
    }
  }

  private lastPhaseSpoken = '';

  /** v6: set while a ritual starts from what was heard (the answer to it is spoken instead). */
  private silentPhase = false;

  private speakPhase(text: string): void {
    if (text !== this.lastPhaseSpoken) {
      this.lastPhaseSpoken = text;
      if (!this.silentPhase) this.speakLine(text);
    }
  }

  /** Temporary caption (feedback), then back to the phase instruction. */
  private flash(text: string, seconds: number, sub = '', spoken = true): void {
    // Shown now, without replacing the phase caption that comes back when it expires.
    // (Before v4 this went through say(), which the new override itself blocked: feedback never showed.)
    this.captionOverride = { text, sub, until: this.elapsed + seconds };
    this.visuals.say(text, sub);
    if (spoken) this.speakLine(text);
  }

  /** The lamp says the line aloud (if it is in the voice catalogue and the voice is on). */
  private speakLine(text: string): void {
    if (this.frame == null || this.voice == null) {
      return;
    }
    deskToWorld(this.frame, { x: this.layout.orb.x, y: 0.05, z: this.layout.orb.z }, this.world3);
    this.voice.say(text, this.elapsed, this.world3.x, this.world3.y, this.world3.z);
  }

  /** Voice button, "voice off" / "voice on": the captions always stay. */
  /**
   * One switch, "Sound" / "Muted" (owner, 18 Oct): muted means total silence — the lamp's voice (and the
   * speechSynthesis fallback), cues, ambience, rain — through the master volume, so sounds created later stay silent
   * too. The choice is remembered (LampVoice's storage key). The microphone keeps listening, so "sound on" works.
   */
  private setVoice(on: boolean): void {
    if (on) {
      this.voice.setMuted(false);
      setMasterSound(this.world, true);
      this.cue('tock', { x: this.layout.orb.x, y: 0.02, z: this.layout.orb.z + 0.13 });
    } else {
      this.voice.setMuted(true);
      setMasterSound(this.world, false);
    }
    this.visuals.setVoiceMuted(!on);
    // 28 Oct: once sound is back, how to set the voice and the sound apart (said in the small line only).
    this.flash(on ? 'Sound on.' : 'Sound off. The captions stay.', on ? 3 : 2.2, on ? 'Hold the Sound button to set the voice and the sound apart.' : '');
  }

  private refreshOrb(): void {
    const voice = services.voice;
    this.visuals.orbState(voice.state === 'listening', this.extracting > 0 || this.planBusy || this.talk?.busy === true, voice.level, 0, voice.state === 'muted');
  }

  private orbLocal(): Vec3 {
    return { x: this.layout.orb.x, y: 0.04, z: this.layout.orb.z };
  }

  private cue(cue: Parameters<SoundBank['play']>[0], local: Vec3): void {
    if (this.frame == null) {
      return;
    }
    deskToWorld(this.frame, local, this.world3);
    this.sounds.play(cue, this.world3.x, this.world3.y, this.world3.z);
  }

  // ----------------------------------------------------------------- update

  /**
   * Pause: microphone off (an utterance in progress is dropped), the lamp stops talking, all sound suspended, and
   * the evening's clock stops (timers, rituals, onboarding, animations freeze). Resume: everything as it was.
   */
  private applyPause(change: 'pause' | 'resume' | null): void {
    if (change == null) return;
    const ctx = this.audioContext();
    if (change === 'pause') {
      this.pausedAt = performance.now();
      services.voice.pause(true);
      this.voice.stop();
      void ctx?.suspend().catch(() => {});
      track('landing', { kind: 'paused' });
    } else {
      services.voice.pause(false);
      void ctx?.resume().catch(() => {});
      this.pausedAt = -1;
    }
  }

  private audioContext(): AudioContext | null {
    let ctx: AudioContext | null = null;
    this.player.head.traverse((o) => {
      const l = o as unknown as { type?: string; context?: AudioContext };
      if (l.type === 'AudioListener' && l.context != null) ctx = l.context;
    });
    return ctx;
  }

  update(delta: number): void {
    // Paused: the evening's clock does not move (nothing runs, nothing listens).
    if (this.pauseGate.paused) return;
    const dt = Math.min(delta, 0.05);
    this.elapsed += dt;
    timeUniform.value = this.elapsed;
    const now = performance.now();
    this.voice.userSpeaking = services.voice.recording;
    this.voice.tick(this.elapsed);
    if (this.voice.speaking(this.elapsed)) {
      services.voice.holdUntil = now + 300;
    }
    this.visuals.voiceLevel = this.voice.level(this.elapsed);
    // The dynamic voice (Talk it through): spatial, from the lamp; the mic ignores it; it lights the lamp.
    if (this.tts != null) {
      this.tts.tick();
      if (this.tts.speaking) {
        services.voice.holdUntil = now + 300;
        this.visuals.voiceLevel = this.tts.level;
        this.visuals.orb.getWorldPosition(this.ttsAt);
        this.tts.place(this.ttsAt.x, this.ttsAt.y, this.ttsAt.z);
      }
    }
    this.updatePlacePrep();
    if (this.mode === 'talk' && this.talk != null && !this.talk.closing) {
      const c = talkClock((this.elapsed - this.talk.startedAt) / 60, this.talk.announced);
      if (c === 'announce') {
        this.talk.announced = true;
        this.lampSpeak(WIND_DOWN_LINE);
      } else if (c === 'close') this.closeTalk();
    }
    services.voice.tick(now);

    const xrFrame = this.xrFrame;
    const refSpace = xrFrame != null ? this.renderer.xr.getReferenceSpace() : null;
    if ((this.placementMode === null && this.placementStart >= 0) || this.pendingMove != null) {
      this.probe.update(xrFrame, refSpace);
    }
    if (this.placementMode === null && this.placementStart >= 0) {
      this.tryPlace();
    } else if (this.pendingMove != null) {
      const choice = this.findSurface();
      if (choice != null || this.elapsed - this.pendingMove.since > 1.5 || this.probe.status === 'unsupported') {
        this.applyMove(choice, this.pendingMove.quiet);
      }
    }
    if (this.placementMode === 'table' || this.placementMode === 'floating') {
      // The desk follows its anchor when the headset refines its map of the room (a few mm, rarely).
      const anchored = this.deskAnchor.track(xrFrame, refSpace, this.frame, this.elapsed);
      if (anchored != null) this.relocate(this.frame, { x: anchored.x, y: anchored.y, z: anchored.z, yaw: anchored.yaw }, true);
      if (this.offscreenCueAt >= 0 && this.elapsed >= this.offscreenCueAt && this.frame != null) {
        this.offscreenCueAt = -1;
        if (bearingOf(this.frame, this.headPose()).bearing !== 'ahead') this.cue('appear', { x: 0, y: 0.05, z: 0 });
      }
    }
    if (this.pendingDrops.length > 0) {
      this.lastDropAt = this.elapsed;
      for (const entity of this.pendingDrops.splice(0)) {
        this.settle(entity);
      }
    }
    if (this.captionOverride != null && this.captionOverride.until <= this.elapsed) {
      this.captionOverride = null;
      this.refreshCaption();
    }
    if (this.nightSeq != null) this.updateNight(dt);
    // The session ends once the lamp has gone out (≈ 8 s after "lights out" / a second "good night").
    if (this.goodnightAt >= 0 && this.elapsed - this.goodnightAt > 8.5) {
      this.goodnightAt = -1;
      this.world.exitXR();
    }
    this.updateStones(dt);
    this.updateHeld();
    // `abOff` (debug API, perf A/B only): skip this lot's per-frame additions to measure their cost at equal load.
    if (!this.abOff) {
      this.updateGaze(dt);
      this.updateOnboarding(dt);
    }
    // FoV-aware caption relay (follows your view when you have turned away from the desk).
    this.player.head.getWorldPosition(this.relayHead);
    this.player.head.getWorldDirection(this.relayDir).negate();
    this.visuals.updateRelay(this.relayHead, this.relayDir, dt);
    // Meta's hands (logic/hand-look.ts): VR hands in Full immersion; otherwise your real hands with Meta's light
    // outline and a faint tint. In an emulator no camera image of a real hand exists, so the tint is drawn after the
    // desk instead of punching through it.
    if (!this.abOff) this.handLook.update(this.world, this.visuals.backdrop.place !== 'room' && this.visuals.backdrop.immersionLevel === 'full', this.emulated);
    if (this.mode === 'breathe') this.updateBreathe(dt);
    if (this.mode === 'release') this.updateRelease(dt);
    if (this.mode === 'squeeze') this.updateSqueeze(dt);
    if (this.mode === 'keep') this.updateKeep(dt);
    this.updateLeavingWeight();
    // `abProduct` (debug API, perf A/B only): skips this pass's per-frame additions to measure their cost.
    if (!this.abProduct) {
      this.updateTension(dt);
      this.updateMix(dt);
    }
    this.rv.update(dt);
    // The opening shot (2D page): the lamp glows warm and full, the focal point of the still life.
    const preview = this.placementMode === 'preview';
    const demo = this.lampDemo;
    if (demo != null) {
      // Test / film only: the lamp's states on demand (listen with a voice level, speak, think, look at it).
      const level = demo === 'listen' ? 0.35 + 0.3 * Math.abs(Math.sin(this.elapsed * 5.3) * Math.sin(this.elapsed * 1.7)) : 0;
      if (demo === 'speak' && this.elapsed > this.lampDemoSpeakAt) {
        this.lampDemoSpeakAt = this.elapsed + 3.5;
        this.visuals.speakFor('Last night you let go of three things.');
      }
      this.visuals.orbState(demo === 'listen', demo === 'think', level, demo === 'look' ? 0.6 : 0, false);
    } else {
      this.visuals.orbState(preview || services.voice.state === 'listening', this.extracting > 0 || this.planBusy || this.talk?.busy === true, services.voice.level, preview ? 0.6 : this.lampGazeK * 0.6, services.voice.state === 'muted');
    }
    this.visuals.update(dt);
    // 26 Oct (CPU pass): the touch words are recomputed 12 times a second, not every frame (it built strings and
    // arrays each frame; a word appears ≤ 80 ms later, unnoticeable).
    this.touchClock += dt;
    if (this.touchClock >= 0.08 || !perfOpts.on) {
      this.touchClock = 0;
      this.refreshTouch();
    }
    this.updateEvening(dt);
    // The remembered "Muted" holds from the first frame on (the audio listener appears after this system's init).
    if (!this.masterApplied) this.masterApplied = setMasterSound(this.world, !this.voice.muted);
  }

  /** Resting place of the n-th stone in a bowl: on the curved ceramic floor, piled. */
  private inBowl(bin: ReturnType<typeof binById>, slot: number): Vec3 {
    const p = slotPosition(bin, slot, this.layout);
    const r = Math.hypot(p.x - bin.x, p.z - bin.z);
    p.y += bowlFloor(r);
    return p;
  }

  /** Height of the surface under a desk-local point (tray top or bowl floor). */
  private surfaceAt(x: number, z: number): number {
    for (const bin of this.layout.bins) {
      const r = Math.hypot(x - bin.x, z - bin.z);
      if (r < TRAY.bowlInner) {
        return bowlFloor(r);
      }
    }
    return 0;
  }

  private updateStones(dt: number): void {
    if (this.frame == null) {
      return;
    }
    const tips = this.player.indexTipSpaces;
    tips.left.getWorldPosition(this.v);
    tips.right.getWorldPosition(this.v2);
    const shadows = this.visuals.shadowSlots();
    let shadowIndex = 0;
    let anyReleasing = false;
    // 28 Oct: how near each index tip is to a stone (Meta's blended hands: more fill as you reach a target).
    let nearLeft = 9;
    let nearRight = 9;
    this.stonesAway += (this.stonesAwayTarget - this.stonesAway) * (1 - Math.exp(-3.2 * dt));
    if (Math.abs(this.stonesAway - this.stonesAwayTarget) < 0.002) this.stonesAway = this.stonesAwayTarget;
    for (const stone of this.stones.values()) {
      const mesh = stone.mesh;
      const held = stone.entity.hasComponent(Grabbed);
      // Scale: springs in from the lamp with a little overshoot, swells in the hand.
      if (stone.delay > 0) {
        stone.delay -= dt;
      } else if (stone.dissolving < 0) {
        stone.scale.target = stone.scaleTarget * (held ? 1.06 : 1);
        const s = Math.max(0.001, stone.scale.step(dt, 210, 15) * (1 - this.stonesAway));
        const q = stone.squash.step(dt, 520, 18);
        mesh.scale.set(s * (1 + 0.035 * q), s * (1 - 0.07 * q), s * (1 + 0.035 * q));
        mesh.visible = this.stonesAway < 0.985;
      }
      if (stone.moving && !held && stone.delay <= 0) {
        stone.t += dt / stone.duration;
        const k = Math.min(1, stone.t);
        const e = easeInOut(k);
        mesh.position.lerpVectors(stone.from, stone.to, e);
        mesh.position.y += Math.sin(Math.PI * k) * stone.arc + stone.liftApplied;
        if (k >= 1) {
          stone.moving = false;
          const arrive = stone.arrive;
          stone.arrive = null;
          arrive?.();
        }
      }
      // Let go: the stone settles, warms, lifts a little and turns to warm dust.
      if (stone.dissolving >= 0) {
        anyReleasing = true;
        stone.dissolving += dt;
        const k = (stone.dissolving - RELEASE_HOLD) / RELEASE_DURATION;
        stone.uniforms.uWarm.value = Math.min(1, stone.dissolving / RELEASE_HOLD);
        if (k > 0) {
          const kk = Math.min(1, k);
          stone.uniforms.uDissolve.value = kk * kk * (3 - 2 * kk);
          mesh.position.y += dt * 0.022 * (1 - kk * 0.5);
          mesh.rotation.y += dt * 0.35;
          // Dust leaves the stone as it dissolves (≈ 96 motes in all, no burst).
          const want = Math.floor(96 * Math.min(1, k * 1.15));
          if (want > stone.emitted) {
            const n = want - stone.emitted;
            stone.emitted = want;
            const r = this.layout.tokenRadius * mesh.scale.x * (1 - kk * 0.6);
            this.visuals.lights.emit(mesh.position.x, mesh.position.y + 0.006, mesh.position.z, n, r, 0.8 + kk * 0.6);
          }
        }
        if (k >= 1) {
          this.disposeStone(stone);
          continue;
        }
      }
      // Hover affordance: a hand within pinching range lights the stone and lifts it 4 mm.
      const nearL = mesh.position.distanceTo(this.v);
      const nearR = mesh.position.distanceTo(this.v2);
      if (mesh.visible) {
        nearLeft = Math.min(nearLeft, nearL);
        nearRight = Math.min(nearRight, nearR);
      }
      const near = Math.min(nearL, nearR);
      const hovered = !held && stone.dissolving < 0 && near < this.layout.tokenRadius + 0.045;
      // 23 Oct: a soft chime when a hand comes within reach of a stone (once per approach, never a stream).
      if (hovered && !this.hoveredIds.has(stone.id)) {
        this.hoveredIds.add(stone.id);
        if (this.elapsed - this.hoverSoundAt > 0.6) {
          this.hoverSoundAt = this.elapsed;
          this.sounds.play('pearl', mesh.position.x, mesh.position.y, mesh.position.z);
        }
      } else if (!hovered) this.hoveredIds.delete(stone.id);
      const shown = this.ghostStone === stone.id || this.askStone === stone.id ? 0.3 + 0.2 * Math.sin(this.elapsed * 3.2) : 0;
      // Gaze: a soft halo with its own slow ease (≥ 300 ms, logic/gaze.ts), halved in calm moments.
      stone.gazeK = easeToward(stone.gazeK, this.gazedId === stone.id ? this.gazeGain : 0, dt);
      const chosen = this.chosenId === stone.id ? 0.7 : 0;
      stone.glowTarget = stone.dissolving >= 0 ? 0 : held ? 0.8 : hovered ? 0.6 : Math.max(chosen, shown, 0.4 * stone.gazeK);
      stone.glow += (stone.glowTarget - stone.glow) * (1 - Math.exp(-12 * dt));
      stone.uniforms.uGlow.value = stone.glow;
      stone.uniforms.uDone.value += (stone.done - stone.uniforms.uDone.value) * (1 - Math.exp(-2 * dt));
      stone.lift.target = hovered && !stone.moving ? 0.004 : 0;
      const lift = stone.lift.step(dt, 300, 22);
      if (!held) {
        mesh.position.y += lift - stone.liftApplied;
      }
      stone.liftApplied = lift;
      // Contact shadow on the tray or the bowl floor (desk-local).
      if (shadowIndex < shadows.length && mesh.scale.x > 0.05) {
        worldToDesk(this.frame, mesh.position, this.local);
        const below = this.surfaceAt(this.local.x, this.local.z);
        const height = Math.max(0, this.local.y - this.layout.tokenHeight * 0.6 * mesh.scale.y - below);
        const strength = (1 - stone.uniforms.uDissolve.value) * Math.min(1, mesh.scale.x) * (height < 0.35 ? 1 : 0);
        shadows[shadowIndex++].set(this.local.x, this.local.z, height, strength);
      }
    }
    // v6: the Release stone casts the same contact shadow on the walnut (not once it is over or in the water).
    const weight = this.weight;
    if (weight != null && shadowIndex < shadows.length && weight.uniforms.uDissolve.value === 0) {
      worldToDesk(this.frame, weight.mesh.position, this.local);
      if (Math.hypot(this.local.x - WATER_BOWL.x, this.local.z - WATER_BOWL.z) > WATER_BOWL.outer + 0.01) {
        const height = Math.max(0, this.local.y - 0.014);
        shadows[shadowIndex++].set(this.local.x, this.local.z, height, Math.min(1, weight.mesh.scale.x) * (height < 0.35 ? 1.1 : 0));
      }
    }
    for (let i = shadowIndex; i < this.shadowSeen; i++) {
      shadows[i].w = 0;
    }
    this.handLook.setNear('left', nearness(Math.max(0, nearLeft - this.layout.tokenRadius)));
    this.handLook.setNear('right', nearness(Math.max(0, nearRight - this.layout.tokenRadius)));
    this.shadowSeen = shadowIndex;
    if (!anyReleasing) {
      this.visuals.setEmber(0);
    }
  }

  /** While a stone is held, the halo it would land in glows (magnetic preview). */
  private updateHeld(): void {
    if (this.frame == null) {
      return;
    }
    let glowIndex = -1;
    for (const entity of this.queries.held.entities) {
      const object = entity.object3D;
      if (object == null) {
        continue;
      }
      worldToDesk(this.frame, object.position, this.local);
      if (this.local.y <= this.layout.dropAbove) {
        glowIndex = nearestBinIndex(this.local, this.layout, this.layout.magnetRadius);
      }
    }
    this.visuals.setBinGlow(glowIndex, 1);
  }

  /** Head gaze → "this one" for voice commands. */
  /**
   * The gaze ray: eye gaze where the runtime provides it (an input source with targetRayMode "gaze", e.g. Quest Pro,
   * Meta VR glasses), else the head (Quest 3 / 3S have no eye tracking). Writes origin → this.v, direction → gazeDir.
   */
  private gazeRay(): void {
    const session = this.world.session as XRSession | undefined;
    const frame = this.xrFrame;
    const ref = this.renderer.xr.getReferenceSpace();
    if (session != null && frame != null && ref != null) {
      for (const src of session.inputSources) {
        if (src.targetRayMode !== 'gaze') continue;
        const pose = frame.getPose(src.targetRaySpace, ref);
        if (pose == null) break;
        const o = pose.transform.position;
        const q = pose.transform.orientation;
        this.v.set(o.x, o.y, o.z).applyMatrix4(this.player.matrixWorld);
        // Target ray looks down -Z of its space.
        this.v2.set(0, 0, -1).applyQuaternion(this.gazeQ.set(q.x, q.y, q.z, q.w)).transformDirection(this.player.matrixWorld);
        this.gazeDir.x = this.v2.x;
        this.gazeDir.y = this.v2.y;
        this.gazeDir.z = this.v2.z;
        this.gazeSource = 'eyes';
        return;
      }
    }
    const head = this.player.head;
    head.getWorldPosition(this.v);
    head.getWorldDirection(this.v2);
    this.gazeDir.x = -this.v2.x;
    this.gazeDir.y = -this.v2.y;
    this.gazeDir.z = -this.v2.z;
    this.gazeSource = 'head';
  }

  private pushGazeTarget(id: string, x: number, y: number, z: number): void {
    let g = this.gazePool[this.gazeTargets.length];
    if (g == null) {
      g = { id: '', x: 0, y: 0, z: 0 };
      this.gazePool.push(g);
    }
    g.id = id;
    g.x = x;
    g.y = y;
    g.z = z;
    this.gazeTargets.push(g);
  }

  /**
   * One gaze focus over the useful objects only (owner's rules, logic/gaze.ts GAZE): the lamp (it "looks up" at
   * you), the stones ("you can take me"), and the bowls only while a stone is in hand or chosen ("drop here").
   * ~250 ms dwell, hysteresis cone, one object at a time, soft rise and fall, halved in calm moments.
   */
  private updateGaze(dt: number): void {
    const targets = this.gazeTargets;
    targets.length = 0;
    if (this.frame == null || !this.visuals.placed || this.placementMode === 'preview') {
      this.gazedId = null;
      this.gazeFocus.update(null, false, dt);
      this.updateDwell(null, dt);
      return;
    }
    this.gazeRay();
    this.visuals.orb.getWorldPosition(this.ghostTo);
    this.pushGazeTarget('lamp', this.ghostTo.x, this.ghostTo.y, this.ghostTo.z);
    for (const stone of this.stones.values()) {
      if (stone.dissolving < 0) this.pushGazeTarget(stone.id, stone.mesh.position.x, stone.mesh.position.y, stone.mesh.position.z);
    }
    const holding = this.queries.held.entities.size > 0;
    if ((holding || this.chosenId != null) && this.mode === 'unload') {
      for (let i = 0; i < BIN_IDS.length; i++) {
        const bin = this.layout.bins[i];
        this.local.x = bin.x;
        this.local.y = 0.03;
        this.local.z = bin.z;
        deskToWorld(this.frame, this.local, this.world3);
        this.pushGazeTarget(BIN_GAZE_IDS[i], this.world3.x, this.world3.y, this.world3.z);
      }
    }
    if (this.access.gazeSelect) this.pushButtonTargets();
    // 28 Oct (the journal): every star of your sky can be looked at.
    if (this.journal != null) {
      const n = Math.min(this.starTexts.length, STAR_SLOTS);
      for (let i = 0; i < n; i++) if (this.visuals.lights.starAt(i, this.starTmp)) this.pushGazeTarget(this.starIds[i], this.starTmp.x, this.starTmp.y, this.starTmp.z);
    }
    const dir = this.gazeDir;
    const pick = gazePick(this.v, dir, targets, GAZE.take);
    let keep = false;
    for (let i = 0; i < targets.length; i++) {
      if (targets[i].id === this.gazeFocus.focused) keep = gazeAngle(this.v, dir, targets[i]) <= GAZE.keep;
    }
    const focus = this.gazeFocus.update(pick, keep, dt);
    const calm = this.mode === 'breathe' || this.mode === 'release' || this.mode === 'night' ? GAZE.calm : 1;
    this.gazeGain = calm;
    this.gazedId = focus != null && focus !== 'lamp' && !focus.startsWith('bin:') && !focus.startsWith('star:') ? focus : null;
    this.updateStarGaze(focus, dt);
    this.gazedBin = focus != null && focus.startsWith('bin:') ? BIN_GAZE_IDS.indexOf(focus) : -1;
    // The lamp "looks up" when you look at it: a slight, slow brightening (rule 7).
    this.lampGazeK = easeToward(this.lampGazeK, focus === 'lamp' ? calm : 0, dt);
    this.visuals.setGazeBin(this.gazedBin);
    // A chosen stone (look and pinch) waits 8 s at most (gaze-only selection: 20 s, nothing hurries you).
    const wait = this.access.gazeSelect ? 20 : 8;
    if (this.chosenId != null && (this.elapsed - this.chosenAt > wait || !this.stones.has(this.chosenId))) this.chosenId = null;
    this.updateDwell(focus, dt);
  }

  /** Spoken or touched accessibility setting: saved in this browser, applied at once, said by the lamp. */
  private setAccess(change: Partial<AccessPrefs>, via: 'voice' | 'button'): void {
    this.access = services.access.set(change);
    const setting = change.gazeSelect != null ? 'gaze-select' : change.contrast != null ? 'contrast' : 'large-text';
    track('access', { setting: `${setting}:${Object.values(change)[0] ? 'on' : 'off'}`, via });
    this.flash(accessLine(change), 3.5);
    this.lastActivity = this.elapsed;
  }

  /** Gaze-only selection: every visible glass button is a gaze target too (the lamp stands for its own button). */
  private pushButtonTargets(): void {
    for (const entity of this.queries.buttons.entities) {
      const action = String(entity.getValue(DeskButton, 'action'));
      if (action === 'orb') continue;
      const obj = entity.object3D;
      if (obj == null || !visibleInScene(obj)) continue;
      let id = this.btnGazeId.get(action);
      if (id == null) {
        id = `btn:${action}`;
        this.btnGazeId.set(action, id);
        this.btnAction.set(id, action);
      }
      obj.getWorldPosition(this.ghostTo);
      this.pushGazeTarget(id, this.ghostTo.x, this.ghostTo.y, this.ghostTo.z);
    }
  }

  /** What a dwell may select right now (the same rules as the hands). */
  private dwellAllowed(id: string): boolean {
    if (id.startsWith('star:')) return false;
    if (id === 'lamp') return this.mode !== 'breathe';
    if (id.startsWith('btn:')) return true;
    const unloading = this.mode === 'unload' && (this.ritual.phase === 'dump' || this.ritual.phase === 'sort');
    if (id.startsWith('bin:')) return unloading && this.chosenId != null;
    if (!unloading || id === this.chosenId) return false;
    const token = this.session.get(id);
    return token != null && token.bin == null && !token.released;
  }

  /**
   * Gaze-only selection (accessibility, no hands, no voice): look at something for 1.2 s — the ring fills — and it
   * is chosen: a stone, then a bowl to put it in; the lamp (listen); any glass button (replies, words, menus).
   */
  private updateDwell(focus: string | null, dt: number): void {
    if (!this.access.gazeSelect) {
      if (this.dwellId != null || this.dwellAlpha > 0) {
        this.dwellId = null;
        this.dwellT = 0;
        this.dwellAlpha = 0;
        this.visuals.showDwell(0, 0, 0, this.v, 0, 0);
        if (this.dwellHover != null) this.visuals.setHover(this.dwellHover, false);
        this.dwellHover = null;
      }
      return;
    }
    if (focus !== this.dwellId) {
      if (this.dwellHover != null) this.visuals.setHover(this.dwellHover, false);
      this.dwellHover = null;
      this.dwellId = focus;
      this.dwellT = 0;
      if (focus !== this.dwellLock) this.dwellLock = null;
      const action = focus != null ? this.btnAction.get(focus) : undefined;
      if (action != null) {
        this.visuals.setHover(action, true);
        this.dwellHover = action;
      }
    }
    const armed = focus != null && focus !== this.dwellLock && this.dwellAllowed(focus);
    this.dwellT = armed ? this.dwellT + dt : 0;
    this.dwellAlpha = easeToward(this.dwellAlpha, armed ? 1 : 0, dt, 8);
    let tx = 0;
    let ty = 0;
    let tz = 0;
    const targets = this.gazeTargets;
    for (let i = 0; i < targets.length; i++) {
      if (targets[i].id !== focus) continue;
      tx = targets[i].x;
      ty = targets[i].y;
      tz = targets[i].z;
    }
    this.visuals.showDwell(tx, ty, tz, this.v, Math.min(1, this.dwellT / DWELL_SELECT), focus != null ? this.dwellAlpha : 0);
    if (!armed || focus == null || this.dwellT < DWELL_SELECT) return;
    this.dwellLock = focus;
    this.dwellT = 0;
    this.lastActivity = this.elapsed;
    if (focus === 'lamp') {
      this.onButton('orb');
      return;
    }
    const action = this.btnAction.get(focus);
    if (action != null) {
      this.onButton(action);
      return;
    }
    if (focus.startsWith('bin:')) {
      const id = this.chosenId;
      this.chosenId = null;
      const bin = BIN_IDS[BIN_GAZE_IDS.indexOf(focus)];
      if (id != null && bin != null) {
        track('look-pinch', { bin }, 'look-dwell');
        this.place(id, bin, 'hand');
      }
      return;
    }
    this.chosenId = focus;
    this.chosenAt = this.elapsed;
    this.sounds.play('pearl', tx, ty, tz);
    if (!this.dwellHintShown) {
      this.dwellHintShown = true;
      this.flash('Now look at a bowl.', 3, '', false);
    }
  }

  /**
   * Look and pinch (23 Oct, seated and accessible): look at a stone and pinch (anywhere, without reaching it) to
   * choose it; look at a bowl and pinch to place it there. A pinch near a stone stays a normal grab; a pinch on a
   * glass button stays a button.
   */
  private onSelectStart(source: XRInputSource): void {
    // 28 Oct (the journal): look at a star and pinch: it tells you what it was.
    const focusedStar = this.gazeFocus.focused;
    if (this.journal != null && focusedStar != null && focusedStar.startsWith('star:')) {
      this.pickStar(Number(focusedStar.slice(5)), 'pinch');
      return;
    }
    // The lamp shows a place: look at it and pinch (anywhere) to go there. A pinch on a glass button stays a button.
    if (PLACES_IN_GLOBE && this.visuals.placesOpen && this.gazeFocus.focused === 'lamp' && this.queries.hovered.entities.size === 0) {
      this.lastActivity = this.elapsed;
      this.chooseGlobePlace('hand');
      return;
    }
    if (this.mode !== 'unload' || (this.ritual.phase !== 'dump' && this.ritual.phase !== 'sort')) return;
    if (this.queries.held.entities.size > 0 || this.queries.hovered.entities.size > 0) return;
    const side = source.handedness === 'left' ? 'left' : 'right';
    this.player.indexTipSpaces[side].getWorldPosition(this.v2);
    for (const stone of this.stones.values()) {
      if (stone.mesh.position.distanceTo(this.v2) < 0.09) return;
    }
    this.lastActivity = this.elapsed;
    if (this.chosenId != null && this.gazedBin >= 0) {
      const id = this.chosenId;
      this.chosenId = null;
      track('look-pinch', { bin: BIN_IDS[this.gazedBin] }, 'look-pinch');
      this.place(id, BIN_IDS[this.gazedBin], 'hand');
      return;
    }
    const token = this.gazedId != null ? this.session.get(this.gazedId) : undefined;
    if (token != null && token.bin == null && !token.released) {
      this.chosenId = token.id;
      this.chosenAt = this.elapsed;
      const m = this.stones.get(token.id)?.mesh.position;
      if (m != null) this.sounds.play('pearl', m.x, m.y, m.z);
      return;
    }
    this.chosenId = null;
  }

  /**
   * 23 Oct — the first minute (logic/onboarding.ts): after 8 s of silence an example stone lands; while no stone
   * has been placed, a ghost hand shows the pinch, carrying it to the bowl that now breathes with light; after the
   * first stone, once, the head-gaze tip ("look at a stone and say later").
   */
  private updateOnboarding(dt: number): void {
    if (services.voice.recording) this.lastActivity = this.elapsed;
    const holding = this.queries.held.entities.size > 0;
    // Decisions ten times a second (no per-frame allocation); the ghost's motion below runs every frame.
    this.onbTick -= dt;
    if (this.onbTick <= 0) {
      this.onbTick = 0.1;
      this.decideOnboarding(holding);
    }
    this.animateGhost(dt, holding);
  }

  private onbTick = 0;
  private readonly tallies = { sorted: 0, unsorted: 0, first: null as TokenState | null };
  private ghostBin: BinId | null = null;
  private readonly ghostF = { travel: 0, lift: 0, pinch: 0, alpha: 0 };

  private decideOnboarding(holding: boolean): void {
    const placed = this.placementMode === 'table' || this.placementMode === 'floating';
    const t = this.session.tally(this.tallies);
    // Voice evenings with a working microphone get suggestion bubbles when they hesitate; otherwise the word grid.
    const mic = services.voice.state;
    // Talking it through: bubbles whatever the microphone (touch works too), only while the lamp is quiet.
    const talking = this.mode === 'talk' && this.talk != null;
    const lampQuiet = !talking || (!this.talk!.busy && !this.talk!.closing && !(this.tts?.speaking ?? false));
    const bubbles =
      placed && (talking || (mic !== 'denied' && mic !== 'unavailable'))
        ? bubbleLines({
            quiet: services.style.quiet,
            mode: this.mode,
            phase: this.ritual.phase,
            stones: t.sorted + t.unsorted,
            toSort: t.unsorted,
            idle: !lampQuiet
              ? 0
              : this.mode === 'talk'
                ? this.elapsed - this.lastActivity
                : hesitation({ sinceActivity: this.elapsed - this.lastActivity, sinceInput: this.elapsed - this.lastInputAt, touchOnly: this.dumpTouched && !this.dumpSpoke }),
            used: this.usedBubbles,
            seed: new Date().getDate(),
          })
        : null;
    const key = bubbles == null ? '' : bubbles.join('|');
    if (key !== this.bubbleKey) {
      this.bubbleKey = key;
      this.bubbles = bubbles;
    }
    const sorted = t.sorted;
    if (sorted > this.sortedNow && this.sortedNow === 0 && this.firstEvening && !services.style.quiet && !this.gazeTipShown) this.gazeTipAt = this.elapsed + 2.4;
    this.sortedNow = sorted;
    const step = placed
      ? onboardingStep({
          firstEvening: this.firstEvening,
          mode: this.mode,
          phase: this.ritual.phase,
          stonesOnDesk: t.unsorted,
          sortedThisSession: sorted,
          holding,
          idle: this.elapsed - this.lastActivity,
          exampleShown: this.exampleShown,
        })
      : { spawnExample: false, ghost: false };
    // Voice evening with suggestion bubbles up: they get time to be read and touched before the example stone.
    if (step.spawnExample && this.bubbles != null && this.elapsed - this.lastActivity < BUBBLES_BEFORE_EXAMPLE) step.spawnExample = false;
    if (step.spawnExample) {
      this.exampleShown = true;
      if (this.spawnStone(EXAMPLE_STONE, 0, 'example') != null) {
        this.event({ type: 'tokens-added', count: 1 });
        this.flash('An example. Pinch it, drop it in a bowl.', 6, '', false);
      }
      this.lastActivity = this.elapsed;
    }
    if (this.gazeTipAt >= 0 && this.elapsed >= this.gazeTipAt) {
      this.gazeTipAt = -1;
      this.gazeTipShown = true;
      if (this.session.unsorted().length > 0) this.flash('Tip: look at a stone and say "later".', 5, '', false);
    }
    const target = step.ghost && t.first != null ? ghostTarget([t.first]) : null;
    if (target == null || !this.stones.has(target.stone) || (!this.ghost.ready && (this.handLook.source == null || !this.ghost.build(this.handLook.source)))) {
      this.ghostStone = null;
      this.ghostBin = null;
      return;
    }
    if (this.ghostStone !== target.stone) this.ghostT = 0;
    this.ghostStone = target.stone;
    this.ghostBin = target.bin;
  }

  private ghostTrailT = 0;
  private readonly ttsAt = new Vector3();

  private animateGhost(dt: number, holding: boolean): void {
    const stone = this.ghostStone != null ? this.stones.get(this.ghostStone) : undefined;
    if (stone == null || this.ghostBin == null || this.frame == null || holding) {
      if (this.ghostStone != null && holding) this.ghostStone = null;
      this.ghost.hide();
      this.ghostT = 0;
      if (this.ghostSuggest && !holding) this.visuals.setSuggest(-1);
      this.ghostSuggest = false;
      return;
    }
    this.ghostT += dt;
    const f = ghostFrame(this.ghostT, this.ghostF);
    // Same order as BIN_IDS (desk-layout): an index lookup, no closure per frame.
    const bin = this.layout.bins[BIN_IDS.indexOf(this.ghostBin)];
    this.local.x = bin.x;
    this.local.y = 0.03;
    this.local.z = bin.z;
    deskToWorld(this.frame, this.local, this.world3);
    this.ghostTo.set(this.world3.x, this.world3.y, this.world3.z);
    this.ghostAt.copy(stone.mesh.position).lerp(this.ghostTo, f.travel);
    this.ghostAt.y += f.lift;
    this.ghost.pose(this.ghostAt, this.frame.yaw, f.pinch, f.alpha);
    // A fine trail of light along the carried arc (24 Oct): one warm mote every ~40 ms, only while carrying.
    this.ghostTrailT += dt;
    if (f.pinch > 0.6 && f.travel > 0.02 && f.travel < 0.98 && this.ghostTrailT >= 0.04) {
      this.ghostTrailT = 0;
      this.visuals.lights.emit(this.ghostAt.x, this.ghostAt.y, this.ghostAt.z, 1, 0.004, 0.2);
    }
    this.visuals.setSuggest(BIN_IDS.indexOf(this.ghostBin));
    this.ghostSuggest = true;
  }

  // ------------------------------------------------------------ 28 Oct: Squeeze and let go

  private startSqueeze(): void {
    this.mode = 'squeeze';
    this.setRays(false);
    this.squeeze = new SqueezeSession();
    this.squeeze.begin(this.elapsed);
    this.squeezeKey = '';
    this.squeezeWasClosed = false;
    this.fists.left.closed = false;
    this.fists.right.closed = false;
    this.setStonesAway(true);
    this.visuals.bowlsAwayTarget = 1;
    this.visuals.hideCard();
    this.visuals.setRitualsLabel(true);
    this.cue('moon', this.orbLocal());
  }

  /** Where the gathered light is: your fists when they are seen, else the lamp itself (never blocked). */
  private squeezeTargets(): { left: Vector3 | null; right: Vector3 | null } {
    return { left: this.hands.left.tracked ? this.hands.left.palm : null, right: this.hands.right.tracked ? this.hands.right.palm : null };
  }

  /** The fists closed (hands, "squeeze", touch): the round counts; a soft swell from the lamp. */
  private squeezeClench(via: 'hand' | 'voice' | 'touch'): void {
    if (this.squeeze?.clench(this.elapsed) === true) {
      this.lastActivity = this.elapsed;
      if (via !== 'hand') this.flash('Hold it…', 1.4, '', false);
    }
  }

  /** The fists opened (hands, "let go", touch): after 2 s of squeezing the light escapes now. */
  private squeezeUnclench(via: 'hand' | 'voice' | 'touch'): void {
    const s = this.squeeze;
    if (s == null) return;
    // A touch or a word counts as squeezing too (no hands needed).
    if (via !== 'hand') s.clench(this.elapsed);
    s.unclench(this.elapsed);
    this.lastActivity = this.elapsed;
  }

  /** The light escapes: warm dust from each open hand (or from the lamp), a soft burst, the room a breath darker. */
  private squeezeBurst(f: SqueezeFrame): void {
    if (this.frame == null || this.squeeze == null) return;
    const followed = this.squeeze.followed(f.round);
    const t = this.squeezeTargets();
    const n = followed ? 30 : 20;
    let any = false;
    for (const p of [t.left, t.right]) {
      if (p == null) continue;
      any = true;
      this.visuals.lights.emit(p.x, p.y + 0.02, p.z, n + 14, 0.05, 1.9, 1.6);
      this.sounds.play('burst', p.x, p.y, p.z);
    }
    this.squeezeFlareAt = this.elapsed;
    if (!any) {
      this.visuals.orb.getWorldPosition(this.lampTmp);
      this.visuals.lights.emit(this.lampTmp.x, this.lampTmp.y + 0.01, this.lampTmp.z, n + 20, 0.04, 2, 1.6);
      this.sounds.play('burst', this.lampTmp.x, this.lampTmp.y, this.lampTmp.z);
    }
    track('squeeze', { event: followed ? 'followed' : 'watched' });
  }

  private updateSqueeze(dt: number): void {
    const s = this.squeeze;
    if (s == null || this.frame == null) return;
    this.readHands();
    // Fists (hysteresis): any fist closes; both hands open again opens.
    const l = this.fists.left.update(this.hands.left.tracked ? this.hands.left.open : null);
    const r = this.fists.right.update(this.hands.right.tracked ? this.hands.right.open : null);
    const closed = (this.hands.left.tracked && l) || (this.hands.right.tracked && r);
    if (closed && !this.squeezeWasClosed) this.squeezeClench('hand');
    if (!closed && this.squeezeWasClosed) this.squeezeUnclench('hand');
    this.squeezeWasClosed = closed;
    const f = s.frame(this.elapsed);
    const p = s.pattern;
    // The gathered light glows in the fists (or the lamp keeps it), the room dims a little as you squeeze.
    const t = this.squeezeTargets();
    // The light gathers with the squeeze; as the fists open it flares once in the palms, then escapes.
    const flare = Math.max(0, 1 - (this.elapsed - this.squeezeFlareAt) / 0.6);
    const glow = f.presence * Math.max(0.25 + 0.75 * f.tight, 1.25 * flare);
    const openK = flare > 0 ? 1 : 0.6;
    this.rv.palms(t.left, t.right, t.left != null ? glow * (this.fists.left.closed ? 1 : openK) : 0, t.right != null ? glow * (this.fists.right.closed ? 1 : openK) : 0);
    this.rv.dimTarget = f.presence * (0.32 + 0.22 * f.tight);
    // Light flows from the lamp into the fists while squeezing; while the shoulders rise and drop, motes rise and
    // settle around the lamp; on the jaw, slow motes drift down.
    this.squeezeMoteAt -= dt;
    if (this.squeezeMoteAt <= 0) {
      this.squeezeMoteAt = 0.14;
      this.visuals.orb.getWorldPosition(this.lampTmp);
      if (f.phase === 'squeeze') {
        let any = false;
        for (const h of [t.left, t.right]) {
          if (h == null) continue;
          any = true;
          // 29 Oct: larger motes with comet tails: the stream reads past Meta's grey hands.
          this.visuals.lights.stream(this.lampTmp.x, this.lampTmp.y, this.lampTmp.z, h.x, h.y, h.z, 3, 1.3, 1.7);
        }
        // No hands seen: the light gathers into the lamp from a ring around it.
        if (!any) this.visuals.lights.drift(this.lampTmp.x, this.lampTmp.y - 0.06, this.lampTmp.z, 2, 0.06, 0.12, 0.05, 1.6);
      } else if (f.phase === 'shoulders-up' || f.phase === 'shoulders-down') {
        this.visuals.lights.drift(this.lampTmp.x, this.lampTmp.y + (f.phase === 'shoulders-up' ? 0 : 0.14), this.lampTmp.z, 1, 0.05, 0.14, f.phase === 'shoulders-up' ? 0.04 : -0.03, 3.5);
      } else if (f.phase === 'jaw' && this.squeezeMoteAt <= 0.14) {
        this.visuals.lights.drift(this.lampTmp.x, this.lampTmp.y + 0.16, this.lampTmp.z, 1, 0.08, 0.2, -0.025, 5);
      }
    }
    const key = `${f.phase}${f.round}`;
    if (key !== this.squeezeKey) {
      const previous = this.squeezeKey;
      this.squeezeKey = key;
      const c = squeezeCaption(f, p, services.style.quiet);
      this.visuals.say(c.text, c.sub);
      this.baseCaption = c;
      const line = squeezeLine(f, p);
      if (line != null && !(s.finishing && f.phase === 'close' && previous.startsWith('close'))) this.speakLine(line);
      if (f.phase === 'squeeze') this.cue('gather', this.orbLocal());
      if (f.phase === 'release') this.squeezeBurst(f);
      if (f.phase === 'shoulders-down') this.cue('ebb', this.orbLocal());
      if (f.phase === 'close') this.rv.dimTarget = 0;
    }
    if (f.phase === 'done') {
      this.rv.palms(null, null, 0, 0);
      track('squeeze', { event: `done:${s.followedCount()}` });
      if (f.completed > 0) this.completeRitual('squeeze');
      else this.completeRitualAbandoned();
    }
  }

  // ------------------------------------------------------------ 28 Oct: Keep (three good things)

  private startKeep(carry?: string): void {
    this.mode = 'keep';
    this.keepCount = 0;
    this.keepUsed.clear();
    this.keepDoneAt = -1;
    this.setStonesAway(true);
    this.visuals.bowlsAwayTarget = 1;
    this.visuals.hideCard();
    this.visuals.setRitualsLabel(true);
    this.lastPhaseSpoken = '';
    this.say(KEEP_LINES.start, services.style.quiet ? 'Touch one, or Write… your own.' : 'A few words is enough. Or touch one.');
    // Proposed after a good sentence ("I had a lovely day with my sister"): that sentence is the first good thing.
    const first = carry != null ? goodThing(carry) : null;
    if (first != null) window.setTimeout(() => this.mode === 'keep' && this.addGood(first, 'voice'), 1400);
  }

  private onKeepSpeech(text: string): void {
    if (this.keepDoneAt >= 0) return;
    if (isKeepDone(text)) {
      this.finishKeep();
      return;
    }
    const g = goodThing(text);
    if (g != null) this.addGood(g, 'voice');
  }

  /** Both hands open, palms close together (cupped): the new light waits there a moment before it floats away. */
  private cuppedHands(): Vector3 | null {
    const l = this.hands.left;
    const r = this.hands.right;
    if (!l.tracked || !r.tracked || l.open < 0.55 || r.open < 0.55 || l.palm.distanceTo(r.palm) > 0.17) return null;
    return this.lampTmp.copy(l.palm).add(r.palm).multiplyScalar(0.5);
  }

  /**
   * A good thing becomes a warm light: born in the lamp (or in your cupped hands), it floats to its own place in the
   * room and stays there — tonight and the evenings after.
   */
  private addGood(text: string, via: 'voice' | 'touch'): void {
    if (this.mode !== 'keep' || this.keepDoneAt >= 0 || this.frame == null) return;
    const memory = services.memory;
    const before = memory.tonightRecord()?.kept ?? [];
    if (before.some((k) => k.toLowerCase() === text.toLowerCase())) {
      this.flash('Already kept tonight.', 1.8, '', false);
      return;
    }
    memory.recordKept(text);
    this.keepUsed.add(text);
    this.keepCount++;
    this.lastActivity = this.elapsed;
    track('kept', { via });
    const all = memory.keptLights();
    const index = all.length - 1;
    // 29 Oct: on the wall you see from your seat (scene understanding), else in view just behind the tray.
    const wall = this.keepWall();
    const spot = this.keptSpot(index, (memory.tonightRecord()?.kept ?? []).length - 1, all[index]?.seed ?? 0, wall);
    const sideX = worldToDesk(this.frame, spot, { x: 0, y: 0, z: 0 }).x;
    // The hands as last seen in the frame loop (updateKeep).
    const cup = this.cuppedHands();
    const from = cup ?? this.visuals.orb.getWorldPosition(this.v2);
    const fx = from.x;
    const fy = from.y + (cup != null ? 0.035 : 0.02);
    const fz = from.z;
    // Born in your cupped hands, it rests there a moment, glowing in the palms; from the lamp it leaves at once. It
    // rises, flies to its place with a light trail, and its word appears beside it as it lands.
    const wait = cup != null ? KEPT_FLIGHT.restCupped : KEPT_FLIGHT.restLamp;
    this.visuals.lights.kept(fx, fy, fz, this.world3.x, this.world3.y, this.world3.z, wall != null ? KEPT_FLIGHT.travelWall : KEPT_FLIGHT.travel, wait, KEPT_NEAR_SIZE, text, wall == null, wall != null ? (sideX < 0 ? 1 : -1) : sideX < 0 ? -1 : 1);
    this.visuals.lights.emit(fx, fy, fz, 6, 0.014, 0.4);
    this.keptShownKey = all.map((k) => `${k.date}|${k.text}`).join('\n');
    if (cup != null) this.keepGlowAt = this.elapsed;
    this.sounds.play('keep', fx, fy, fz);
    // The third stays as the caption while its light lands (the opening line must not come back meanwhile).
    if (this.keepCount >= KEEP_COUNT) this.say(keepLine(this.keepCount), `“${text}”`);
    else this.flash(keepLine(this.keepCount), 3.2, `“${text}”`);
    if (this.keepCount >= KEEP_COUNT) {
      this.keepDoneAt = this.elapsed;
      // The last light lands and its word is read (and fades) before the lamp moves on and its menu rises.
      window.setTimeout(() => {
        if (this.mode === 'keep') this.completeRitual('keep');
      }, (wait + (wall != null ? KEPT_FLIGHT.travelWall : KEPT_FLIGHT.travel) + KEPT_FLIGHT.wordIn + KEPT_FLIGHT.wordHold + 0.6) * 1000);
    }
  }

  /** Hands are read in the frame loop (joint poses only exist there); cupped open hands glow softly, ready. */
  private keepGlow = 0;
  /** 29 Oct: which kept lights the light field shows now (showKept rebuilds them only when this changes). */
  private keptShownKey = '';
  private keepGlowAt = -10;
  private updateKeep(dt: number): void {
    this.readHands();
    const cup = this.keepDoneAt < 0 ? this.cuppedHands() : null;
    const receiving = Math.max(0, 1 - (this.elapsed - this.keepGlowAt) / 1.8);
    // 29 Oct: softer: the new light's own halo carries the moment now.
    const target = cup != null ? 0.24 + 0.34 * receiving : 0;
    this.keepGlow += (target - this.keepGlow) * (1 - Math.exp(-6 * dt));
    if (this.keepGlow > 0.004) this.rv.palms(this.hands.left.palm, this.hands.right.palm, this.keepGlow, this.keepGlow);
    else this.rv.palms(null, null, 0, 0);
  }

  /** "That's all": one or two is enough. None: nothing recorded, the lamp proposes again. */
  private finishKeep(): void {
    if (this.mode !== 'keep') return;
    if (this.keepCount === 0) {
      this.completeRitualAbandoned();
      return;
    }
    if (this.keepDoneAt < 0) {
      this.keepDoneAt = this.elapsed;
      this.flash(KEEP_LINES.fewer, 2.6);
      window.setTimeout(() => {
        if (this.mode === 'keep') this.completeRitual('keep');
      }, 2200);
    }
  }

  private endKeep(): void {
    this.rv.palms(null, null, 0, 0);
    this.keepUsed.clear();
  }

  // ------------------------------------------------------------ 28 Oct: the journal (Your sky)

  /** Opens the journal: your sky in the lamp, this week in one true sentence, and one evening per page. */
  private openJournal(via: 'hand' | 'voice'): void {
    if (this.frame == null || (this.placementMode !== 'table' && this.placementMode !== 'floating')) return;
    const memory = services.memory;
    const entries = journalEntries(memory.nights());
    track('journal', { step: 'open' }, `journal:open:${via}`);
    this.closeTension(false);
    this.proposal = null;
    this.visuals.openRituals(false);
    this.visuals.openPlaces(false);
    if (entries.length === 0) {
      this.showSky(false);
      return;
    }
    this.journal = { entries, index: 0, week: weekSummary(memory.nights(), eveningDate(new Date())) };
    this.starShown = -1;
    // 29 Oct: the bowls (and any stone) step aside while the page is open: it stands on the tray, all of it in view.
    this.setStonesAway(true);
    this.visuals.bowlsAwayTarget = 1;
    // The lamp shows your sky while the journal is open — beside the page, never in front of it.
    if (memory.evenings() > 0 || memory.totalLetGo() > 0) {
      this.showSky(false, 600);
      this.visuals.orbTo(JOURNAL_GLOBE.x, JOURNAL_GLOBE.y, JOURNAL_GLOBE.z, GLOBE_SHOW.radius / LAMP.globe);
    }
    this.showJournalPage();
    this.lastPhaseSpoken = '';
    this.say(this.journal.week, this.access.gazeSelect ? 'Look at a star: it tells you what it was.' : 'Look at a star to read it. Touch Earlier for the evening before.');
    this.cue('pearl', this.orbLocal());
  }

  private showJournalPage(): void {
    const j = this.journal;
    if (j == null) return;
    const e = j.entries[j.index];
    this.visuals.showCard(
      {
        title: e.label,
        subtitle: entrySubtitle(e) || 'A quiet evening',
        rows: entryRows(e).map((r) => ({ time: '', title: r.title, detail: r.detail })),
        footer: `${j.index + 1} of ${j.entries.length} · ${j.index === 0 ? 'the latest evening' : `${j.index} ${j.index === 1 ? 'evening' : 'evenings'} before`}`,
        accent: DS.text.primary,
      },
      true,
      'journal',
    );
    this.visuals.setChipLabels(false, j.index < j.entries.length - 1 ? 'Earlier' : 'Latest', 'Close');
  }

  private stepJournal(step: 'earlier' | 'later' | 'newest' | 'close', via: 'hand' | 'voice'): void {
    const j = this.journal;
    if (j == null) return;
    this.lastActivity = this.elapsed;
    if (step === 'close') {
      this.closeJournal(true);
      return;
    }
    const n = j.entries.length;
    j.index = step === 'newest' ? 0 : step === 'earlier' ? (j.index + 1) % n : Math.max(0, j.index - 1);
    track('journal', { step }, `journal:${step}:${via}`);
    this.cue('tock', { x: 0, y: 0.2, z: -0.1 });
    this.showJournalPage();
  }

  /** Closes the journal; `propose`: the lamp proposes again (choosing). */
  private closeJournal(propose: boolean): void {
    this.journal = null;
    this.starShown = -1;
    this.visuals.lights.skyUniforms.uPick.value = -1;
    this.visuals.lights.skyUniforms.uPickK.value = 0;
    this.visuals.hideCard();
    this.visuals.hideSky();
    this.visuals.setChipLabels(false);
    // The bowls come back (rituals that keep them away restore them themselves when they end).
    if (this.mode === 'choose' || this.mode === 'unload') {
      this.setStonesAway(false);
      this.visuals.bowlsAwayTarget = 0;
    }
    if (propose && this.mode === 'choose') this.propose(null);
    else if (propose) this.refreshCaption();
  }

  /** Looking at a star for half a second (or pinching while looking) tells what it was. */
  private updateStarGaze(focus: string | null, dt: number): void {
    const u = this.visuals.lights.skyUniforms;
    u.uPickK.value = easeToward(u.uPickK.value, this.journal != null && this.starShown >= 0 ? 1 : 0, dt, 4);
    if (this.journal == null) {
      this.starGazeId = null;
      return;
    }
    const star = focus != null && focus.startsWith('star:') ? focus : null;
    if (star !== this.starGazeId) {
      this.starGazeId = star;
      this.starGazeT = 0;
      return;
    }
    if (star == null) return;
    this.starGazeT += dt;
    if (this.starGazeT >= 0.5) {
      const i = Number(star.slice(5));
      if (i !== this.starShown) this.pickStar(i, 'look');
    }
  }

  private pickStar(i: number, via: 'look' | 'pinch'): void {
    const s = this.starTexts[i];
    if (s == null) return;
    // The page of that evening opens on the desk (the star's words are read where the eyes come back to).
    const j = this.journal;
    if (j != null) {
      const page = j.entries.findIndex((e) => e.date === s.date);
      if (page >= 0 && page !== j.index) {
        j.index = page;
        this.showJournalPage();
      }
    }
    this.starShown = i;
    this.visuals.lights.skyUniforms.uPick.value = i;
    this.lastActivity = this.elapsed;
    if (this.visuals.lights.starAt(i, this.starTmp)) this.sounds.play('pearl', this.starTmp.x, this.starTmp.y, this.starTmp.z);
    track('journal', { step: `star-${via}` });
    this.flash(`“${s.text}”`, 5, `Let go on ${dateLabel(s.date)}.`, false);
    void shortDate;
  }

  // ------------------------------------------------------------ 28 Oct: the living night

  private resetNight(): void {
    this.nightSeq = null;
    this.sleep = null;
    this.ceiling = null;
    this.nightDim = 0;
    this.visuals.ceilingSky.hide();
    const u = this.visuals.lights.skyUniforms;
    u.uStarDim.value = 1;
    u.uStarBreath.value = 0;
    this.visuals.lights.starsHome();
    setMasterLevel(this.world, this.voice.muted ? 0 : 1);
  }

  /** Good night, step by step: your sky rises to the ceiling, then the lamp offers to stay. */
  private updateNight(dt: number): void {
    const n = this.nightSeq;
    if (n == null) return;
    const since = this.elapsed - n.at;
    // 29 Oct: your room darkens slowly as your sky rises (≈ 5 s), so the stars carry the shot.
    if (n.step >= 1) this.nightDim += (NIGHT_DIM - this.nightDim) * (1 - Math.exp(-0.45 * dt));
    // The constellations draw themselves once the stars have landed.
    if (n.step >= 1 && since > 2.4 + NIGHT_RISE.gather + NIGHT_RISE.travel) this.visuals.ceilingSky.linesTarget = 1;
    if (n.step === 0 && since > 2.4) {
      n.step = 1;
      this.ascendStars();
    } else if (n.step === 1 && since > 9.5) {
      // 29 Oct: still 9.5 s ("one bus stop": nothing new lengthens the shortest path); the last stars are landing.
      n.step = 2;
      n.askedAt = this.elapsed;
      this.ask = {
        labels: ['Stay with me', 'Good night'],
        actions: [() => this.onSleepCommand({ type: 'stay' }, 'touch'), () => this.onSleepCommand({ type: 'leave' }, 'touch')],
        key: 'sleep',
      };
      this.lastPhaseSpoken = '';
      this.say(SLEEP_LINES.ask, services.style.quiet ? 'Touch "Stay with me", or "Good night".' : 'Say "stay", or "good night".');
    } else if (n.step === 2 && this.elapsed - n.askedAt > UNANSWERED_STAY_S) {
      // Nobody answered (already drifting off?): the lamp stays, for the shortest time, and fades.
      this.stayTillSleep(SLEEP_MINUTES[0], 'unanswered');
    }
    if (this.sleep != null) this.updateSleep(dt);
  }

  /** The stars of the things you let go leave the lamp's sky and settle on your ceiling (or a dome above you). */
  private ascendStars(): void {
    const lights = this.visuals.lights;
    const count = Math.min(this.starTexts.length, STAR_SLOTS);
    if (count === 0 || this.frame == null) return;
    this.player.head.getWorldPosition(this.v);
    const ceiling = findCeiling(this.planeCandidates(), this.meshCandidates(), this.v.y);
    this.ceiling = ceiling;
    // The seat faces the desk: forward is from the head toward the desk, flattened.
    const fx = this.frame.x - this.v.x;
    const fz = this.frame.z - this.v.z;
    const len = Math.hypot(fx, fz) || 1;
    const forward = { x: fx / len, z: fz / len };
    const head = { x: this.v.x, y: this.v.y, z: this.v.z };
    // 29 Oct: they gather in the lamp, then rise out of it one after another in trails, and land as a real sky.
    const lamp = this.visuals.orb.getWorldPosition(this.v2);
    const from = { x: lamp.x, y: lamp.y + 0.01, z: lamp.z };
    const points: Array<SkyStar> = [];
    // Evenings newest first: the newest constellation nearest the middle of your view.
    const dates = [...new Set(this.starTexts.slice(0, count).map((t) => t.date))].sort().reverse();
    for (let i = 0; i < count; i++) {
      const p = eveningSkyPoint(this.starTexts[i].seed, dates.indexOf(this.starTexts[i].date), dates.length, head, forward, ceiling);
      points.push({ ...p, date: this.starTexts[i].date });
      lights.starTo(i, p.x, p.y, p.z, NIGHT_RISE.gather + Math.min(NIGHT_RISE.spread, i * NIGHT_RISE.step), NIGHT_RISE.travel, from);
    }
    const disc = skyDisc(head, forward, ceiling);
    // A constellation never spans more than ≈ 23° of your sky, whatever the ceiling's height.
    const segments = constellationSegments(points, MAX_SKY_LINES, 0.36 * Math.max(0.45, ceiling.y - head.y)).map(([a, b]) => [points[a], points[b]] as const);
    this.visuals.ceilingSky.place({ center: disc.center, radius: disc.radius, head, dome: disc.dome }, segments);
    this.visuals.ceilingSky.showTarget = 1;
    this.visuals.ceilingSky.linesTarget = 0;
    this.sounds.play('ascend', this.v.x, this.v.y + 0.6, this.v.z);
    track('ceiling', { source: ceiling.source }, `ceiling:${ceiling.source}`);
    this.flash(ceiling.source === 'dome' ? SLEEP_LINES.dome : SLEEP_LINES.ceiling, 6, 'Each star is something you let go.');
  }

  /** "Stay with me": light and sound sink over `minutes`, the sky breathes slower, then the session ends by itself. */
  private stayTillSleep(minutes: number, via: string): void {
    this.ask = null;
    if (this.nightSeq != null) this.nightSeq.step = 3;
    if (this.sleep == null) {
      this.sleep = { start: this.elapsed, minutes, boost: 0, phase: 0, via };
      track('sleep', { event: `stay:${via}`, minutes });
      this.lastPhaseSpoken = '';
      this.say(SLEEP_LINES.stay, `${minutes} minutes. Lower an open hand to dim sooner, or say "lights out".`);
    } else {
      this.sleep.minutes = minutes;
      this.flash(`${minutes} minutes.`, 2, '', false);
    }
    this.touchKey = '';
  }

  private onSleepCommand(c: ReturnType<typeof parseSleepCommand> & object, via: 'voice' | 'touch' | 'hand'): void {
    this.lastActivity = this.elapsed;
    if (c.type === 'leave') {
      this.leaveNight(via);
      return;
    }
    if (c.type === 'stay') {
      this.stayTillSleep(c.minutes ?? (this.sleep?.minutes ?? 20), via);
      return;
    }
    if (c.type === 'minutes') {
      this.stayTillSleep(c.minutes, via);
      return;
    }
    if (this.sleep == null) {
      this.stayTillSleep(SLEEP_MINUTES[0], via);
      return;
    }
    this.sleep.boost += dimStrokeSeconds(this.sleep.minutes);
    this.cue('ebb', this.orbLocal());
    track('sleep', { event: `dimmer:${via}`, minutes: this.sleep.minutes });
  }

  /** "Good night" / "lights out": the lamp says so; the session closes a few seconds later. */
  private leaveNight(via: string): void {
    this.ask = null;
    track('sleep', { event: `leave:${via}`, minutes: this.sleep?.minutes ?? 0 });
    if (this.nightSeq != null) this.nightSeq.step = 4;
    this.sleep = null;
    this.touchKey = '';
    this.lastPhaseSpoken = '';
    this.say(SLEEP_LINES.leave, '');
    this.goodnightAt = this.elapsed - 5.5;
  }

  private updateSleep(dt: number): void {
    const z = this.sleep;
    if (z == null) return;
    // The dimmer: an open hand lowered slowly.
    this.readHands();
    for (const side of ['left', 'right'] as const) {
      const h = this.hands[side];
      if (this.dimGestures[side].sample(this.elapsed, h.tracked ? h.palm.y : null, h.tracked ? h.open : null)) this.onSleepCommand({ type: 'dimmer' }, 'hand');
    }
    const lv = sleepLevels(this.elapsed - z.start, z.minutes, z.boost);
    z.phase += dt * (lv.breathsPerMinute / 60) * Math.PI * 2;
    const u = this.visuals.lights.skyUniforms;
    u.uStarDim.value = lv.light;
    u.uStarBreath.value = 0.32 * (0.5 + 0.5 * Math.cos(z.phase));
    this.nightDim = Math.max(this.nightDim, 0.4 + 0.5 * (1 - lv.light));
    setMasterLevel(this.world, this.voice.muted ? 0 : lv.sound);
    if (lv.done) {
      track('sleep', { event: 'faded', minutes: z.minutes });
      this.sleep = null;
      this.nightSeq = null;
      this.world.exitXR();
    }
  }

  // ------------------------------------------------------------ 28 Oct: the voice and the sound, apart

  private onMixCommand(c: NonNullable<ReturnType<typeof parseMixCommand>>): void {
    this.lastActivity = this.elapsed;
    if (c.type === 'open') {
      this.openMix('voice');
      return;
    }
    const now = services.mix.get()[c.channel];
    const next = services.mix.set({ [c.channel]: now + c.delta });
    track('mix', { setting: `${c.channel}:${c.delta > 0 ? 'up' : 'down'}`, via: 'voice' });
    this.flash(`${c.channel === 'voice' ? 'Voice' : 'Sound'} ${Math.round(next[c.channel] * 100)} %.`, 2.4, '', false);
    // The voice changed: the lamp says a word at the new level, so it can be heard.
    if (c.channel === 'voice') window.setTimeout(() => this.speakLine(MIX_LINES.sample), 350);
    if (this.mixOpen && this.mixRails != null) this.mixRails[c.channel].flashNumber();
  }

  private openMix(via: 'hand' | 'voice'): void {
    if (this.mixRails == null || this.frame == null || this.tensionSide != null) return;
    this.mixOpen = true;
    this.mixIdle = 0;
    this.mixRails.voice.showTarget = 1;
    this.mixRails.sound.showTarget = 1;
    track('mix', { setting: 'open', via });
    this.lastPhaseSpoken = '';
    this.flash(MIX_LINES.open, 4, 'Voice in front, sound behind. A finger on a rail.');
    this.touchKey = '';
  }

  private closeMix(): void {
    if (!this.mixOpen || this.mixRails == null) return;
    this.mixOpen = false;
    this.mixTouch = null;
    this.mixRails.voice.showTarget = 0;
    this.mixRails.sound.showTarget = 0;
    this.mixRails.voice.touching = false;
    this.mixRails.sound.touching = false;
    this.touchKey = '';
    this.refreshCaption();
  }

  private updateMix(dt: number): void {
    const rails = this.mixRails;
    if (rails == null) return;
    // The Sound button held: the mix opens (and the release does not mute).
    if (this.soundHeldAt >= 0 && !this.soundHoldUsed && this.elapsed - this.soundHeldAt >= 0.7) {
      this.soundHoldUsed = true;
      if (this.mixOpen) this.closeMix();
      else this.openMix('hand');
    }
    if (this.mixOpen) {
      this.mixIdle += dt;
      // A fingertip on a rail sets its level at once (no waiting: you hear it change).
      let touched: 'voice' | 'sound' | null = null;
      let u: number | null = null;
      const tip = this.fingerOnRail();
      if (tip != null) {
        touched = 'voice';
        u = tip;
      } else {
        const back = this.fingerOnRail(-MIX_RAIL_GAP);
        if (back != null) {
          touched = 'sound';
          u = back;
        }
      }
      if (touched != null && u != null) {
        this.mixIdle = 0;
        const level = Math.round(u * 20) / 20;
        if (Math.abs(level - mixLevels[touched]) >= 0.05) {
          services.mix.set({ [touched]: level });
          const mark = Math.round(level * 10);
          if (mark !== this.mixTick) {
            this.mixTick = mark;
            this.cue('tick', { x: RAIL.x0 + (RAIL.x1 - RAIL.x0) * level, y: RAIL.y, z: RAIL.z - (touched === 'sound' ? MIX_RAIL_GAP : 0) });
          }
        }
      }
      if (this.mixTouch === 'voice' && touched !== 'voice') {
        track('mix', { setting: 'voice:set', via: 'hand' });
        this.speakLine(MIX_LINES.sample);
      } else if (this.mixTouch === 'sound' && touched !== 'sound') {
        track('mix', { setting: 'sound:set', via: 'hand' });
      }
      this.mixTouch = touched;
      rails.voice.touching = touched === 'voice';
      rails.sound.touching = touched === 'sound';
      if (this.mixIdle > 25) this.closeMix();
    }
    rails.voice.bead += (mixLevels.voice - rails.voice.bead) * (1 - Math.exp(-14 * dt));
    rails.sound.bead += (mixLevels.sound - rails.sound.bead) * (1 - Math.exp(-14 * dt));
    rails.voice.update(dt, Math.round(mixLevels.voice * 10));
    rails.sound.update(dt, Math.round(mixLevels.sound * 10));
  }

  // ------------------------------------------------------------ 28 Oct: "How heavy tonight?" (the bead)

  private tensionToken = 0;

  /**
   * The bead's question. The rail rises out of the tray; a fingertip on it slides the bead (the value floats above
   * it); once the finger leaves and the bead is still, it is kept. The voice and three touch words do the same;
   * "Skip" (or doing anything else) lets it go. Never asked twice for the same moment.
   */
  private askTension(side: TensionSide, then: () => void): void {
    if (side === 'in') this.arrivalBeadAsked = true;
    const memory = services.memory;
    const tonightIn = memory.tonightRecord()?.tensionIn;
    this.tensionToken++;
    this.tensionSide = side;
    this.tensionThen = then;
    // Arrival: the bead starts in the middle. Good night: it starts where you came in, and stays there as a
    // reflection while you move it.
    const start = side === 'out' && tonightIn != null ? tensionU(tonightIn) : 0.5;
    this.tensionDial = new TensionDial(start);
    this.tensionRail.bead = start;
    this.tensionRail.ghost = side === 'out' && tonightIn != null ? tensionU(tonightIn) : null;
    this.tensionRail.drawLabels('light', 'heavy');
    this.tensionRail.showTarget = 1;
    this.tensionTickValue = this.tensionDial.value;
    this.cue('appear', { x: 0, y: RAIL.y, z: RAIL.z });
    this.lastPhaseSpoken = '';
    const quiet = services.style.quiet;
    const sub = quiet ? 'Slide it with a finger, or touch a word.' : 'Slide it with a finger, or say a number.';
    this.say(side === 'in' ? TENSION_LINES.askIn : TENSION_LINES.askOut, side === 'out' && tonightIn != null ? `You came in at ${tonightIn}. ${sub}` : sub);
    this.touchKey = '';
  }

  /** The bead is kept (by the finger, the voice or a word): remembered, said once, then the evening goes on. */
  private keepTension(value: number, via: 'hand' | 'voice' | 'touch'): void {
    const side = this.tensionSide;
    if (side == null) return;
    const memory = services.memory;
    const before = memory.tonightRecord()?.tensionIn;
    memory.recordTension(side, value);
    track('tension', { side, via }, `tension:${side}:${via}`);
    this.lastActivity = this.elapsed;
    this.tensionRail.flashNumber();
    this.tensionRail.touching = false;
    const bx = RAIL.x0 + (RAIL.x1 - RAIL.x0) * tensionU(value);
    this.cue('pearl', { x: bx, y: RAIL.y, z: RAIL.z });
    if (this.frame != null) {
      deskToWorld(this.frame, { x: bx, y: RAIL.y + 0.01, z: RAIL.z }, this.world3);
      this.visuals.lights.emit(this.world3.x, this.world3.y, this.world3.z, 8, 0.008, 0.45);
    }
    const then = this.tensionThen;
    this.tensionThen = null;
    this.tensionSide = null;
    this.touchKey = '';
    if (side === 'in') this.flash(TENSION_LINES.keptIn, 2.6, `${value} · ${tensionWord(value)}`);
    else this.flash(checkoutLine(before, value), 3.6, tensionArrow(before, value));
    const token = this.tensionToken;
    window.setTimeout(
      () => {
        if (token !== this.tensionToken) return;
        this.closeTension(false);
        then?.();
      },
      side === 'in' ? 1700 : 3000,
    );
  }

  /** "Skip" / "not now" / a second "good night": nothing is recorded, the evening goes on. */
  private skipTension(): void {
    const side = this.tensionSide;
    if (side == null) return;
    track('tension', { side, via: 'skip' }, `tension:${side}:skip`);
    const then = this.tensionThen;
    this.closeTension(false);
    then?.();
  }

  /** The rail slips back into the tray (`then` runs only if asked). */
  private closeTension(runThen: boolean): void {
    const then = this.tensionThen;
    this.tensionToken++;
    this.tensionSide = null;
    this.tensionThen = null;
    this.tensionDial = null;
    if (this.tensionRail != null) {
      this.tensionRail.showTarget = 0;
      this.tensionRail.touching = false;
    }
    this.touchKey = '';
    if (runThen) then?.();
  }

  /** A tracked index fingertip on the rail → its position along it (0..1), else null. */
  private fingerOnRail(dz = 0): number | null {
    const frame = this.xrFrame as (XRFrame & { getJointPose?: (joint: XRSpace, base: XRSpace) => XRJointPose | undefined }) | undefined;
    const ref = this.renderer.xr.getReferenceSpace();
    const session = this.world.session as XRSession | undefined;
    if (frame?.getJointPose == null || ref == null || session == null || this.frame == null) return null;
    let found: number | null = null;
    for (const src of session.inputSources) {
      if (src.hand == null) continue;
      const tip = src.hand.get('index-finger-tip');
      const pose = tip != null ? frame.getJointPose(tip, ref) : undefined;
      if (pose == null) continue;
      const p = pose.transform.position;
      this.tipTmp.set(p.x, p.y, p.z).applyMatrix4(this.player.matrixWorld);
      if (src.handedness === 'left' || src.handedness === 'right') this.lastTips[src.handedness] = { x: this.tipTmp.x, y: this.tipTmp.y, z: this.tipTmp.z };
      worldToDesk(this.frame, this.tipTmp, this.local);
      this.local.z -= dz;
      const u = railTouch(this.local);
      if (u != null) found = u;
    }
    return found;
  }

  private updateTension(dt: number): void {
    const dial = this.tensionDial;
    if (dial != null) {
      const finger = this.tensionSide != null ? this.fingerOnRail() : null;
      if (dial.finger(finger, this.elapsed)) this.lastActivity = this.elapsed;
      const kept = dial.tick(this.elapsed, dt);
      this.tensionRail.bead = dial.u;
      this.tensionRail.touching = dial.touching;
      const v = dial.value;
      if (dial.touching && v !== this.tensionTickValue) {
        // A soft glass tick at each mark under the finger (the tactile notches of a real slider).
        this.tensionTickValue = v;
        this.cue('tick', { x: RAIL.x0 + (RAIL.x1 - RAIL.x0) * dial.u, y: RAIL.y, z: RAIL.z });
        this.lastActivity = this.elapsed;
      }
      if (kept != null && this.tensionSide != null) this.keepTension(kept, 'hand');
    }
    this.tensionRail.update(dt, this.tensionDial?.value ?? 0);
  }

  // --------------------------------------------------------------- debug API

  private exposeDebugApi(): void {
    const api = {
      say: (text: string) => this.handleUtterance(text),
      state: () => ({
        phase: this.ritual.phase,
        milestones: this.ritual.milestones,
        placement: this.placementMode,
        source: this.placeSource,
        placedOn: this.placedOn,
        frame: this.frame,
        tokens: this.session.all().map((t) => ({ id: t.id, text: t.text, bin: t.bin, suggestion: t.suggestion, released: t.released })),
        plan: this.plan,
        agent: services.agent.status,
        mic: services.voice.state,
        streak: services.memory.streak(),
        stars: services.memory.totalLetGo(),
        planes: this.planeCandidates()
          .filter((p) => p.orientation === 'horizontal')
          .map((p) => ({ label: p.label, x: +p.center.x.toFixed(2), y: +p.center.y.toFixed(3), z: +p.center.z.toFixed(2), yaw: +p.yaw.toFixed(2), halfX: +p.halfX.toFixed(2), halfZ: +p.halfZ.toFixed(2) })),
      }),
      /** World position of a stone (for scripted hand moves in the emulator). */
      stoneWorld: (id: string) => {
        const p = this.stones.get(id)?.mesh.position;
        return p == null ? null : { x: p.x, y: p.y, z: p.z };
      },
      /** World position of a desk-local point. */
      deskPoint: (x: number, y: number, z: number) => (this.frame == null ? null : deskToWorld(this.frame, { x, y, z })),
      binWorld: (bin: BinId) => {
        if (this.frame == null) {
          return null;
        }
        const def = binById(this.layout, bin);
        return deskToWorld(this.frame, { x: def.x, y: 0.03, z: def.z });
      },
      press: (action: string) => this.onButton(action),
      /** Talk it through (tests): its state; `minutes` moves its clock (e.g. 41 → the end is announced). */
      talk: (minutes?: number) => {
        if (minutes != null && this.talk != null) this.talk.startedAt = this.elapsed - minutes * 60;
        const t = this.talk;
        return {
          mode: this.mode,
          active: t != null,
          busy: t?.busy ?? false,
          closing: t?.closing ?? false,
          turns: t?.turns.length ?? 0,
          weights: t?.weights.slice() ?? [],
          summary: t?.summary ?? '',
          speaking: this.tts?.speaking ?? false,
          level: +(this.tts?.level ?? 0).toFixed(2),
          voiceRetryIn: Math.max(0, +(this.ttsRetryAt - this.elapsed).toFixed(1)),
          firstSentenceS: +this.talkFirstSentenceS.toFixed(2),
          streamFallbacks: services.agent.streamFallbacks.slice(-5),
          card: (this.visuals as unknown as { card: { visible: boolean } }).card.visible,
          caption: this.baseCaption.text,
        };
      },
      /** Places prepared in calm moments (tests): ready ones, pending, and the log (place, why, ms). */
      prepared: () => ({ ready: this.visuals.backdrop.preparedPlaces.slice(), pending: this.prepBusy ? 1 : 0, log: this.prepLog.slice() }),
      /** Latency A/B (tests): false = the former path (whole answer, then the voice). */
      talkStream: (on: boolean) => {
        this.talkNoStream = !on;
        return on;
      },
      /** The lamp's states on demand (axe 4 captures): idle, listen, speak, think, look; null gives it back. */
      lamp: (state: 'idle' | 'listen' | 'speak' | 'think' | 'look' | null) => {
        this.lampDemo = state;
        this.lampDemoSpeakAt = 0;
        return state;
      },
      /** Accessibility settings (as the landing's button would) and the gaze-dwell state. */
      access: (change?: Partial<AccessPrefs>) => {
        if (change != null) this.setAccess(change, 'button');
        return { ...this.access };
      },
      dwell: () => ({ id: this.dwellId, t: +this.dwellT.toFixed(2), chosen: this.chosenId, lock: this.dwellLock, ring: this.visuals.dwellRing.visible, gazed: this.gazeFocus.focused }),
      /** Talk with the lamp / quiet evening (the play-test panel's switch; the landing page has its own). */
      style: (style: 'talk' | 'quiet') => {
        services.style.set(style);
        if (style === 'talk' && services.voice.state === 'off') void services.voice.start().then(() => this.refreshCaption());
      },
      /** Places (also by voice: "take me to the lake", "back to my room"). */
      place: (id: PlaceId) => this.goPlace(id, 'hand'),
      places: PLACE_IDS,
      /** v8: "Table stays" / "Full" as the switch would. */
      immersion: (level: Immersion) => this.setImmersion(level),
      /** v8: rain state (draw calls, fade) for the perf report. */
      rain: () => ({ drawCalls: this.visuals.rain.drawCalls }),
      /** Living places: what is alive now (place, fade, draw calls, sounds playing, waves, fire). */
      living: () => this.visuals.living.debug(),
      /** Axe 5: the panorama's ground projected on the real ground (motion parallax, stereo) — on/off for A/B. */
      groundParallax: (on: boolean) => this.visuals.living.setGroundParallax(on),
      /** Safety nets: force a quality level (null: the governor decides again) and read the governor. */
      quality: (level?: QualityLevel | null) => {
        if (level !== undefined) {
          guard.forced = level;
          if (level != null) guard.setLevel(level, 'forced');
        }
        return { level: guard.level, floor: guard.floor, safe: guard.safe, forced: guard.forced, governor: guard.governor?.last ?? null, knobs: guard.knobs(), hdPlaces: this.visuals.backdrop.hdStatus() };
      },
      /** Instanced stones: on (one draw for all) or off (each stone draws itself), for parity captures and draw counts. */
      /** 29 Oct: the word chips in one draw (on) or one draw each (off), for parity captures and draw counts. */
      wordBatch: (on?: boolean) => {
        if (on != null) this.visuals.wordBatch.setEnabled(on);
        return { enabled: this.visuals.wordBatch.isEnabled, ready: this.visuals.wordBatch.ready, drawn: this.visuals.wordBatch.drawn };
      },
      stoneBatch: (on?: boolean) => {
        if (on != null) this.stoneBatch.setEnabled(on);
        return { enabled: this.stoneBatch.enabled, stones: this.stoneBatch.size, drawn: this.stoneBatch.drawn };
      },
      /** CPU / overdraw pass: switch its savings off (false) or on, for an interleaved A/B measure. */
      perfOpts: (on: boolean) => {
        perfOpts.on = on;
        services.memory.cacheOn = on;
        return on;
      },
      /** The short message shown now over the phase caption (play-test checks). */
      caption: () => ({ flash: this.captionOverride != null && this.captionOverride.until > this.elapsed ? this.captionOverride.text : null }),
      /** Safety nets: the input check, as at 6 s into the session. */
      checkInputs: () => this.checkInputs(),
      /** Lot 2b: show the sky now (as asked by voice), and the state of the keepsakes on the table. */
      sky: (fresh = false) => {
        this.showSky(fresh);
        return { evenings: services.memory.evenings(), celebrated: services.memory.celebrated(), keepsakes: this.visuals.keepsakes.shown, shown: this.visuals.skyShown };
      },
      /** The lamp shows the places: state, and the same moves as the buttons (tests, films). */
      globe: (move?: 'open' | 'next' | 'previous' | 'choose' | 'close') => {
        if (move === 'open') this.openGlobePlaces();
        else if (move === 'next' || move === 'previous') this.stepGlobe(move === 'next' ? 1 : -1);
        else if (move === 'choose') this.chooseGlobePlace('hand');
        else if (move === 'close') this.visuals.openPlaces(false);
        return { open: this.visuals.placesOpen, place: this.visuals.globePlace, previews: this.visuals.globePreviewCount, window: +this.visuals.globeWindow.toFixed(2), ...this.visuals.globeDebug, scale: +this.visuals.orbScale.toFixed(2) };
      },
      /** HD places: force on / off (null = this GPU decides), and the state of each place on the GPU. */
      hd: (on?: boolean | null) => {
        if (on !== undefined) this.visuals.backdrop.hdForced = on;
        const b = this.visuals.backdrop;
        return { ...b.hdStatus(), here: b.place, hereHd: b.isHd(b.place), prepared: b.preparedPlaces.map((id) => ({ id, hd: b.isHd(id) })), gpuBytes: b.gpuBytes(), format: b.lastFormat, uploadMs: b.lastUploadMs, timeline: b.prepTimeline.slice() };
      },
      /** Axe 5: GPU cost of the ground projection (backdrop alone, one Quest 3 eye, on vs off). */
      backdropBench: (n?: number) => benchBackdrop(this.renderer, this.visuals.backdrop.mesh, this.player.head.getWorldPosition(new Vector3()), n),
      /** GPU memory held by place panoramas (bytes) and the compressed format the GPU received. */
      placeMemory: () => ({ bytes: this.visuals.backdrop.gpuBytes(), format: this.visuals.backdrop.lastFormat }),
      /** Play-test check of "Muted": master volume, and the loudness actually leaving the listener (RMS). */
      sound: () => {
        let listener: { gain?: GainNode; context?: AudioContext } | null = null;
        this.player.head.traverse((o) => {
          if ((o as unknown as { type?: string }).type === 'AudioListener') listener = o as unknown as { gain: GainNode; context: AudioContext };
        });
        const l = listener as { gain?: GainNode; context?: AudioContext } | null;
        let rms = -1;
        if (l?.gain != null && l.context != null) {
          const holder = l as { __probe?: AnalyserNode };
          if (holder.__probe == null) {
            holder.__probe = l.context.createAnalyser();
            holder.__probe.fftSize = 2048;
            l.gain.connect(holder.__probe);
          }
          const buf = new Float32Array(holder.__probe.fftSize);
          holder.__probe.getFloatTimeDomainData(buf);
          rms = Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length);
        }
        return { master: masterSound(this.world), muted: this.voice.muted, rms, context: l?.context?.state ?? null, speaking: globalThis.speechSynthesis?.speaking ?? false };
      },
      /** The lamp's voice: on/off, and what was played when (film: mix the real audio into the video). */
      /** Test only: pretend the microphone is in a given state (the emulator has none), e.g. 'listening'. */
      micState: (state: typeof services.voice.state) => {
        services.voice.state = state;
        this.refreshCaption();
        return services.voice.state;
      },
      voice: (on?: boolean) => {
        if (on != null) this.setVoice(on);
        return { muted: this.voice.muted, log: this.voice.log, cues: this.sounds.log };
      },
      /** Film: replays the arrival (the lamp wakes, the desk appears in its light) without resetting the evening. */
      arrive: () => {
        this.lastPhaseSpoken = '';
        this.voice.forget();
        this.visuals.resetReveal();
        window.setTimeout(() => {
          this.visuals.setReveal(1);
          this.cue('appear', { x: 0, y: 0.05, z: 0 });
          const where = `${this.placementMode === 'table' ? 'On your table. ' : ''}${services.memory.welcomeLine()}`;
          if (this.mode === 'choose') this.propose(null, where);
          else this.say(caption(this.ritual, this.captionExtra()), where);
          this.showStars();
        }, 500);
      },
      /** 29 Oct (pause tests): the evening's clock and whether it is paused, read only. */
      clock: () => ({ elapsed: +this.elapsed.toFixed(3), paused: this.pauseGate.paused, mic: services.voice.state, xrEntered: this.xrEntered }),
      /** Pause / resume as the headset would (tests): source 'xr' or 'page', visible or not. */
      pause: (source: 'xr' | 'page', visible: boolean) => {
        this.applyPause(this.pauseGate.set(source, visible));
        return { paused: this.pauseGate.paused, mic: services.voice.state, elapsed: +this.elapsed.toFixed(2) };
      },
      /** Perf A/B: switch this lot's per-frame additions (gaze, onboarding, hand look) off / on. */
      ab: (off: boolean) => {
        this.abOff = off;
        return this.abOff;
      },
      /** 23 Oct: the first minute (example stone, ghost hand target, gaze focus). */
      onboarding: () => {
        const t = this.ghostStone != null ? ghostTarget(this.session.all()) : null;
        return { gazeSource: this.gazeSource, gazedBin: this.gazedBin, chosen: this.chosenId, firstEvening: this.firstEvening, example: this.exampleShown, ghost: this.ghostStone != null, stone: t?.stone ?? null, bin: t?.bin ?? null, gazed: this.gazedId, lampGaze: +this.lampGazeK.toFixed(2), idle: +(this.elapsed - this.lastActivity).toFixed(1), ghostReady: this.ghost.ready, bubbles: this.bubbles, mic: services.voice.state };
      },
      /** 22 Oct: the desk's persistent anchor (status, saved record, tonight's decision, short log). */
      anchor: () => this.deskAnchor.debug(),
      /** 22 Oct: what the room offers right now (planes, table volumes, hit-test points) and the pick. */
      surfaces: () => {
        const choice = this.findSurface();
        return {
          planes: this.planeCandidates().filter((p) => p.orientation === 'horizontal').length,
          meshes: this.meshCandidates().map((m) => { const t = meshTop(m); return t == null ? m.label : `${m.label}@${t.center.x.toFixed(2)},${t.center.y.toFixed(3)},${t.center.z.toFixed(2)}`; }),
          hits: this.probe.recent().length,
          probe: this.probe.status,
          choice: choice == null ? null : { source: choice.source, label: choice.plane.label, y: +choice.plane.center.y.toFixed(3), reach: +choice.reach.toFixed(2) },
        };
      },
      /** Re-runs table detection from the current head pose (also: voice "move the desk"). */
      recenter: (quiet?: boolean) => this.recenter(quiet === true),
      bins: BIN_IDS,
      /** v6: the evening mode, the lamp's proposal, Breathe and Release. */
      evening: () => ({
        mode: this.mode,
        proposal: this.proposal,
        done: services.memory.doneTonight(),
        breath: this.breath == null ? null : (this.breath.frame(this.elapsed) as BreathFrame),
        followed: this.breath?.followedCount() ?? 0,
        release: this.release,
        hands: { left: { ...this.hands.left, palm: this.hands.left.palm.toArray() }, right: { ...this.hands.right, palm: this.hands.right.palm.toArray() } },
        weight: this.weight == null ? null : { world: this.weight.mesh.position.toArray(), anim: this.weight.anim.kind, held: this.weight.held, title: this.weight.title },
        bowlsAway: this.visuals.trayUniformsV6.uBowlsAway.value,
        roomDim: rig.uRoomDim.value,
        evening: this.evening,
      }),
      /** v6 debug: what the input stack exposes for hand pointers. */
      pointers: () => {
        const input = this.world.input as unknown as Record<string, unknown> & { xr?: Record<string, unknown> };
        return { input: Object.keys(input ?? {}), xr: Object.keys(input?.xr ?? {}), mp: Object.keys((input?.xr?.multiPointers as object) ?? {}) };
      },
      togglePointer: (kind: string, on: boolean) => {
        const mp = (this.world.input as unknown as { xr: { multiPointers: Record<string, { toggleSubPointer(k: string, e: boolean): boolean; getActiveKind(): string | null }> } }).xr.multiPointers;
        return ['left', 'right'].map((side) => ({ changed: mp[side].toggleSubPointer(kind, on), active: mp[side].getActiveKind() }));
      },
      /**
       * 28 Oct — the bead: its state; `value` answers as the voice would; `slide` moves it as a fingertip would (u
       * 0..1, null lifts the finger) — the hand path itself is fingerOnRail (emulated hands, tools/produit-28oct).
       */
      tension: (value?: number | 'skip') => {
        if (value === 'skip') this.skipTension();
        else if (value != null && this.tensionDial != null && this.tensionSide != null) this.keepTension(this.tensionDial.set(value), 'voice');
        const night = services.memory.tonightRecord();
        return { side: this.tensionSide, u: this.tensionDial?.u ?? null, value: this.tensionDial?.value ?? null, touching: this.tensionDial?.touching ?? false, rail: this.tensionRail.visible, in: night?.tensionIn ?? null, out: night?.tensionOut ?? null };
      },
      /** 29 Oct (test only): an unknown room — no plane, no volume (no table, no wall, no ceiling) — or back. */
      blindRoom: (on: boolean) => {
        this.sceneBlind = on;
        return on;
      },
      /** 29 Oct: the walls scene understanding offers, and the one that hosts the kept lights. */
      walls: () => ({ walls: wallsFrom(this.planeCandidates(), this.meshCandidates()), picked: this.keepWall(), planes: this.planeCandidates().map((p) => `${p.orientation}:${p.label}`) }),
      /** 28 Oct — Keep: add a good thing as the voice / a touch would. */
      keep: (text?: string) => {
        if (text != null) this.addGood(text, 'touch');
        return { mode: this.mode, count: this.keepCount, tonight: services.memory.tonightRecord()?.kept ?? [], lights: services.memory.keptLights().length };
      },
      /** 28 Oct — the journal: open / earlier / later / close, or look at star i (as the gaze would). */
      journal: (step?: 'open' | 'earlier' | 'later' | 'newest' | 'close' | number) => {
        if (step === 'open') this.openJournal('hand');
        else if (typeof step === 'number') this.pickStar(step, 'look');
        else if (step != null) this.stepJournal(step, 'hand');
        return { open: this.journal != null, index: this.journal?.index ?? null, entries: this.journal?.entries.length ?? 0, week: this.journal?.week ?? null, star: this.starShown, stars: this.starTexts.length };
      },
      starWorld: (i: number) => (this.visuals.lights.starAt(i, this.starTmp) ? { ...this.starTmp } : null),
      /** 28 Oct — the night: its step, the ceiling found, the fade; `command` as the voice would. */
      night: (command?: string) => {
        if (command != null) void this.handleUtterance(command);
        const z = this.sleep;
        return { mode: this.mode, step: this.nightSeq?.step ?? null, since: this.nightSeq == null ? null : +(this.elapsed - this.nightSeq.at).toFixed(2), lines: this.visuals.ceilingSky.lineCount, ceiling: this.ceiling, sleep: z == null ? null : { minutes: z.minutes, seconds: +(this.elapsed - z.start).toFixed(1), boost: z.boost, ...sleepLevels(this.elapsed - z.start, z.minutes, z.boost) }, starDim: this.visuals.lights.skyUniforms.uStarDim.value };
      },
      /** 28 Oct — the night (test only): jump `seconds` into the fade. */
      sleepSkip: (seconds: number) => {
        if (this.sleep != null) this.sleep.start -= seconds;
        return this.sleep != null;
      },
      tips: () => ({ ...this.lastTips }),
      /** 29 Oct (solidity tests): how many real presses (fingertip or ray) so far, and the last ones (oldest first). */
      presses: () => ({ count: this.pressCount, last: this.pressLog.slice() }),
      /** 29 Oct (solidity, emulated hands): the index fingertip now (world), whatever the ritual. */
      tipWorld: (side: 'left' | 'right') => {
        const p = this.player.indexTipSpaces[side].getWorldPosition(this.tipTmp);
        return { x: p.x, y: p.y, z: p.z };
      },
      /**
       * 29 Oct (solidity, emulated hands): where a touchable button is (world centre of its box) and whether it can
       * be touched now (shown and still pokeable), so a test pokes it with a real fingertip, not a call.
       */
      buttonWorld: (action: string) => {
        for (const e of this.queries.buttons.entities) {
          if (String(e.getValue(DeskButton, 'action')) !== action) continue;
          const o = e.object3D;
          if (o == null) return null;
          let shown = true;
          o.traverseAncestors((a) => { if (!a.visible) shown = false; });
          if (!o.visible) shown = false;
          const box = new Box3().setFromObject(o);
          const c = box.isEmpty() ? o.getWorldPosition(new Vector3()) : box.getCenter(new Vector3());
          const size = box.isEmpty() ? null : box.getSize(new Vector3());
          return { x: c.x, y: c.y, z: c.z, shown, poke: e.hasComponent(PokeInteractable), size: size == null ? null : { x: size.x, y: size.y, z: size.z } };
        }
        return null;
      },
      /** 28 Oct (perf A/B): switch this pass's per-frame additions (bead, mix rails) off / on. */
      abProduct: (off: boolean) => {
        this.abProduct = off;
        return off;
      },
      /** 28 Oct (perf, captures): ask the bead's question now, as the arrival / Good night would. */
      askTension: (side: TensionSide) => this.askTension(side, () => {}),
      /** 28 Oct — the mix: open / close, or set a level as a fingertip would; returns the levels. */
      mix: (change?: 'open' | 'close' | { voice?: number; sound?: number }) => {
        if (change === 'open') this.openMix('hand');
        else if (change === 'close') this.closeMix();
        else if (change != null) services.mix.set(change);
        return { open: this.mixOpen, ...services.mix.get() };
      },
      railWorld: (u: number, back = false) => (this.frame == null ? null : deskToWorld(this.frame, { x: RAIL.x0 + (RAIL.x1 - RAIL.x0) * u, y: RAIL.y, z: RAIL.z - (back ? MIX_RAIL_GAP : 0) })),
      /** v6: start a ritual as the menu would (hand path). */
      ritual: (kind: RitualKind) => this.startRitual(kind, undefined, 'hand'),
      /** v6: world position of the Release stone, and of a desk-local point over the water. */
      weightWorld: () => {
        const p = this.weight?.mesh.position;
        return p == null ? null : { x: p.x, y: p.y, z: p.z };
      },
      waterWorld: (up = 0.12) => (this.frame == null ? null : deskToWorld(this.frame, { x: WATER_BOWL.x, y: WATER_BOWL.water + up, z: WATER_BOWL.z })),
      /** Debug: scene objects, for perf bisection. */
      debug: () => ({ visuals: this.visuals, stones: this.stones, rituals: this.rv, hands: this.handLook, ghost: this.ghost }),
    };
    (window as unknown as { __wdd: typeof api & Record<string, unknown> }).__wdd = Object.assign(
      (window as unknown as { __wdd?: Record<string, unknown> }).__wdd ?? {},
      api,
    );
  }
}
