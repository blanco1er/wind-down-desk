/**
 * Living places (pure, unit-tested): what moves in each place, where, and when.
 *
 * Every effect BELONGS TO ITS PLACE, like the garden's rain: it exists only while that place is shown, never in
 * your room; in "Table stays" nothing is drawn over the passthrough band (below ≈ −8°, the same mask as the
 * backdrop). Angles are measured in the panorama itself (tools/living-measure.mjs on the 2k JPG): yaw 0 = what you
 * face seated (the photo's centre column), positive = to your right; pitch 0 = horizon.
 *
 *   snow-cabin   snow falling behind the three big windows (never inside the cabin), the fireplace of the photo
 *                flickers and crackles, a soft muffled wind at the windows.
 *   cove         waves that run up the sand and pull back (one every 8–10 s, or with your breath in Breathe), wet
 *                sand that dries, the far sea moving, glitter on the sunset path, surf you hear where it breaks.
 *   ember-fire   a campfire on the meadow (stones, logs, embers, low flames, sparks, a light that breathes),
 *                crackles that each throw sparks and lift the light.
 *   hilltop, milky-way   a rare shooting star (one every 1–3 min).
 */
import type { PlaceId } from './places.ts';

/** A region of the panorama, degrees: yaw [from, to], pitch [from, to]. */
export interface Rect {
  yaw: [number, number];
  pitch: [number, number];
}

export interface SnowSpec {
  /** Window openings in the photo: snow is only ever seen through them. */
  windows: Rect[];
  /** Things standing in front of the glass inside the cabin (a vase): never snow over them. */
  holes: Rect[];
  /** Distance from the seat to the glass (m): no flake is closer (you are inside, sheltered). */
  glass: number;
  /** Flakes per layer: near (glass … 6 m, big and soft), mid (… 14 m), far (… 30 m). */
  flakes: [number, number, number];
  /** Fall speed (m/s), wind drift direction (yaw°) and strength (m of drift per m of fall), gust amount (0..1). */
  fall: number;
  windYaw: number;
  drift: number;
  gust: number;
  /** The warm light spilling out of the windows: flakes closer than this to the glass (m) catch it. */
  spill: number;
}

export interface HearthSpec {
  /** The fireplace opening and the flames in the photo (they flicker; the room around glows with them). */
  opening: Rect;
  flames: Rect;
  /** Where the fireplace is (for the sound): yaw°, distance (m), height above the floor (m). */
  yaw: number;
  dist: number;
  height: number;
}

export interface WavesSpec {
  /** The farthest reach of the water in the photo, [yaw°, pitch°], sorted by yaw (measured, smoothed). */
  shore: Array<[number, number]>;
  /** Mean water line, degrees seaward (up) of the measured wet limit: where the waves break onto the sand. */
  lineOffset: number;
  /** Seconds between waves (each wave picks a period in this range). */
  period: [number, number];
  /** How far a wave runs up past the water line (m, along the ground), min … max. */
  reach: [number, number];
  /** Sun (or moon) on the horizon: its yaw and the half-width of its glitter path (degrees). */
  sunYaw: number;
  glitterHalfWidth: number;
}

export interface FireSpec {
  /** Where the fire sits: yaw° (ahead = 0, right +), distance on the ground (m) in "Full" and in "Table stays". */
  yaw: number;
  distFull: number;
  distTable: number;
  /** Ring of hearth stones (m) and their number; logs. */
  ringRadius: number;
  stones: number;
  logs: number;
  /** Ground disk under the fire (Full only), radius (m). */
  groundRadius: number;
  /**
   * When the photo's flat ground stops short of the fire (the clearing ends ≈ 1.9 m away): in "Full" the clearing is
   * extended in 3D around you from `inner` to `outer` metres (photo-lit earth and short grass, lit by the fire).
   */
  clearing?: { inner: number; outer: number };
}

export interface FirefliesSpec {
  /** Fireflies out over the meadow (between inner and outer, m) and a few near the tray ("Full" only). */
  count: number;
  near: number;
  inner: number;
  outer: number;
}

/** A light of the photo that lives: a lantern that wavers, or string lights that breathe. */
export interface LightSpec {
  rect: Rect;
  kind: 'lantern' | 'string';
  /** Radius of its halo on the surroundings (degrees). */
  halo: number;
}

export interface AmbientSpec {
  lights?: LightSpec[];
  /** Still water with a moon path: shimmer + glitter. */
  water?: { rect: Rect; pathYaw: number; pathHalfWidth: number };
  /** Mist drifting over the water: region, the pitch of its densest line, density (0..1). */
  mist?: { rect: Rect; level: number; density: number };
  /** Northern lights region (ripple + swell of the green). */
  aurora?: { rect: Rect };
}

export interface PlaceLife {
  snow?: SnowSpec;
  fireflies?: FirefliesSpec;
  ambient?: AmbientSpec;
  hearth?: HearthSpec;
  waves?: WavesSpec;
  fire?: FireSpec;
  /** A rare shooting star. */
  shootingStars?: boolean;
  /**
   * 25 Oct (axe 5): the photo below the horizon is open, flat ground (sand, water, grass, snow), so it is projected on
   * the ground plane for motion parallax and stereo depth. Off for interiors and ledges: a sofa or a wall projected on
   * the floor would bend when the head moves.
   */
  flatGround?: boolean;
}

/** Nominal eye height above the place's ground (seated): angles of the 3D effects match the photo at this height. */
export const EYE_HEIGHT = 1.2;

type V3 = readonly [number, number, number];
/**
 * Mirror of the backdrop's GLSL groundDir() (environment.ts), for the tests: the photo direction to sample when the
 * eye at `cam` looks along `d`, the photo being taken at `centre`, `h` above a flat ground (h = 0: no projection).
 */
export function groundDirection(d: V3, cam: V3, centre: V3, h: number): [number, number, number] {
  if (h <= 0 || d[1] > -0.0005) return [d[0], d[1], d[2]];
  const groundY = centre[1] - h;
  const t = Math.min((groundY - cam[1]) / d[1], 400);
  if (t <= 0) return [d[0], d[1], d[2]];
  const p = [cam[0] + d[0] * t - centre[0], cam[1] + d[1] * t - centre[1], cam[2] + d[2] * t - centre[2]];
  const n = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / n, p[1] / n, p[2] / n];
}

export const LIFE: Partial<Record<PlaceId, PlaceLife>> = {
  // Measured by eye on night-chalet-2k.jpg with a degree grid (19 Oct 2026).
  'fireside-cabin': {
    snow: {
      // The two big windows of the living room (frames excluded): snow outside, never inside.
      windows: [
        { yaw: [-106, -59], pitch: [-9, 37] },
        { yaw: [-38, 31], pitch: [-8, 36] },
      ],
      // The plant on the window sill (left of the coffee table): never snow over it.
      holes: [{ yaw: [-26, -6], pitch: [-16, -7] }],
      glass: 3.3,
      flakes: [500, 700, 900],
      fall: 0.5,
      windYaw: 70,
      drift: 0.12,
      gust: 0.35,
      spill: 1.2,
    },
    hearth: {
      // The stone fireplace on the right: its opening and the painted flames.
      opening: { yaw: [73, 100], pitch: [-21, -4] },
      flames: { yaw: [80, 93], pitch: [-17, -6] },
      yaw: 86,
      dist: 3.6,
      height: 0.35,
    },
    ambient: {
      // The candles on the coffee table and by the sofa flicker softly with the room.
      lights: [
        { rect: { yaw: [-19, -9], pitch: [-29, -21] }, kind: 'lantern', halo: 3 },
        { rect: { yaw: [108, 113], pitch: [-25, -20] }, kind: 'lantern', halo: 2.5 },
      ],
    },
  },
  // Measured on night-lake-moon-2k.jpg: the moon (−10°, +48°) and its path on the water, the mist on the far shore.
  'moon-lake': {
    flatGround: true,
    ambient: {
      water: { rect: { yaw: [-125, 140], pitch: [-46, -0.6] }, pathYaw: -10, pathHalfWidth: 3.2 },
      mist: { rect: { yaw: [-125, 110], pitch: [-3, 6] }, level: 0.8, density: 0.55 },
    },
  },
  // Measured on night-aurora-2k.jpg: outside, on the snow; the aurora curtain above the far mountains.
  'northern-lights': {
    flatGround: true,
    snow: {
      // Out in the open: the whole view (two halves so the seam behind you is covered), nothing closer than 1.7 m
      // (never through the desk).
      windows: [
        { yaw: [-180, 0.5], pitch: [-89, 89] },
        { yaw: [-0.5, 180], pitch: [-89, 89] },
      ],
      holes: [],
      glass: 1.7,
      flakes: [450, 800, 1200],
      fall: 0.45,
      windYaw: 60,
      drift: 0.1,
      gust: 0.3,
      spill: 0.01,
    },
    ambient: {
      aurora: { rect: { yaw: [-40, 105], pitch: [8, 27] } },
    },
  },
  // Measured on night-veranda-2k.jpg: the paper lanterns of the veranda and the small lights in the garden.
  'rain-veranda': {
    ambient: {
      lights: [
        { rect: { yaw: [-158, -146], pitch: [27, 47] }, kind: 'lantern', halo: 6 },
        { rect: { yaw: [133, 147], pitch: [27, 47] }, kind: 'lantern', halo: 6 },
        { rect: { yaw: [63, 73], pitch: [-7, -1] }, kind: 'lantern', halo: 4 },
        { rect: { yaw: [-64, -59], pitch: [1, 6] }, kind: 'lantern', halo: 2.5 },
        { rect: { yaw: [-3, 2], pitch: [1, 6] }, kind: 'lantern', halo: 2.5 },
        { rect: { yaw: [28, 34], pitch: [3, 9] }, kind: 'lantern', halo: 2.5 },
      ],
    },
  },
  // night-fireflies-2k.jpg: a meadow out to the tree line; the photo's own painted fireflies stay, live ones fly.
  'firefly-meadow': {
    flatGround: true,
    fireflies: { count: 140, near: 9, inner: 2.2, outer: 24 },
  },
  // Measured on night-rooftop-2k.jpg: the string lights under the pergola (behind you, left) and the lanterns.
  'rooftop-city': {
    ambient: {
      lights: [
        { rect: { yaw: [-180, -133], pitch: [12, 43] }, kind: 'string', halo: 3 },
        { rect: { yaw: [163, 180], pitch: [10, 45] }, kind: 'string', halo: 3 },
        { rect: { yaw: [-70, -60], pitch: [-42, -27] }, kind: 'lantern', halo: 3 },
        { rect: { yaw: [-33, -27], pitch: [-21, -14] }, kind: 'lantern', halo: 2.5 },
        { rect: { yaw: [37, 46], pitch: [-45, -33] }, kind: 'lantern', halo: 3 },
        { rect: { yaw: [104, 110], pitch: [-37, -29] }, kind: 'lantern', halo: 2.5 },
      ],
    },
  },
  'moon-beach': {
    flatGround: true,
    waves: {
      // Measured by eye on night-beach-2k.jpg with a degree grid (19 Oct 2026): the landward edge of the broken foam
      // (the mean water line, where each wave's bore lands). The photo's wet limit (thin wash line) runs ≈ 10° lower
      // ahead (−45°, 1.2 m) and ≈ 7° lower on the sides: the swash below reaches it. The rock at 105…160° and the
      // cliff behind −160° have no beach: the sheet stops there.
      shore: [
        [-160, -20.0],
        [-150, -21.5],
        [-135, -23.5],
        [-120, -25.5],
        [-105, -27.5],
        [-90, -29.5],
        [-75, -31.0],
        [-60, -32.5],
        [-45, -33.5],
        [-30, -34.0],
        [-15, -34.5],
        [0, -34.5],
        [15, -35.0],
        [30, -34.5],
        [45, -34.0],
        [60, -33.5],
        [75, -32.5],
        [90, -31.0],
        [102, -29.5],
      ],
      lineOffset: 0,
      period: [8, 10],
      // Up to the photo's wet limit: 0.55 m past the line ahead (1.78 → 1.23 m), never wetter than the photo.
      reach: [0.3, 0.55],
      // The moon (yaw −3°, 21° up) and its path on the sea and the wet sand.
      sunYaw: -3,
      glitterHalfWidth: 6,
    },
  },
  'ember-fire': {
    flatGround: true,
    fire: {
      yaw: -35,
      // Clearing v2 (19 Oct): a flat meadow out to the tree line at the horizon. Owner: on the place's ground, 4–6 m
      // (left of ahead: the caption sits left of centre, the rituals panel right; −35° is clear of both, tools/player-overlap.mjs checks it)
      // ahead and a little to the side, never beside the desk, never over the passthrough band in "Table stays"
      // (the backdrop keeps the room below ≈ −8°, fully below ≈ −23.6°). Full: 4.0 m, a 1.1 m hearth (coordinator, 19 Oct:
      // the star of the video, big enough seated), base at −16.7°, left of the caption, above the tray's far edge. Table stays:
      // 6.2 m (base at −11°, where the photo is still ≥ 94 % opaque; the flames stand fully above −8°).
      distFull: 4.0,
      distTable: 6.2,
      ringRadius: 0.55,
      stones: 11,
      logs: 4,
      groundRadius: 2.8,
    },
    shootingStars: true,
  },
  // night-desert-2k.jpg: the Milky Way (yaw 45…110°); a far camp light at (47°, −9°) wavers like a lantern.
  'desert-stars': {
    flatGround: true,
    shootingStars: true,
    ambient: { lights: [{ rect: { yaw: [44, 50], pitch: [-11, -7] }, kind: 'lantern', halo: 3 }] },
  },
};

export function lifeOf(id: PlaceId): PlaceLife | null {
  return LIFE[id] ?? null;
}

/** True when the photo direction (degrees) lies inside one of the rects (inclusive). */
export function inRects(rects: readonly Rect[], yaw: number, pitch: number): boolean {
  return rects.some((r) => yaw >= r.yaw[0] && yaw <= r.yaw[1] && pitch >= r.pitch[0] && pitch <= r.pitch[1]);
}

/** Deterministic PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ snow

export const SNOW_LAYERS = [
  { min: 0, max: 6 },
  { min: 6, max: 14 },
  { min: 14, max: 30 },
] as const;

/**
 * Flake seeds (yaw rad, distance m, phase 0..1, layer + size 0..0.99): only behind the windows (± a drift margin so
 * flakes drift in and out of the frame), never closer than the glass. Pure, tested.
 */
export function snowSeeds(spec: SnowSpec, seed = 5): Float32Array {
  const rnd = prng(seed);
  const total = spec.flakes[0] + spec.flakes[1] + spec.flakes[2];
  const out = new Float32Array(total * 4);
  // Pick windows by angular width (wider windows hold more flakes).
  const widths = spec.windows.map((w) => w.yaw[1] - w.yaw[0] + 8);
  const sum = widths.reduce((a, b) => a + b, 0);
  let o = 0;
  SNOW_LAYERS.forEach((layer, li) => {
    for (let i = 0; i < spec.flakes[li]; i++) {
      let pick = rnd() * sum;
      let w = 0;
      while (pick > widths[w] && w < widths.length - 1) pick -= widths[w++];
      const win = spec.windows[w];
      const yawDeg = win.yaw[0] - 4 + (win.yaw[1] - win.yaw[0] + 8) * rnd();
      const lo = Math.max(layer.min, spec.glass + 0.25);
      const r = Math.sqrt(lo * lo + (layer.max * layer.max - lo * lo) * rnd());
      out.set([(yawDeg * Math.PI) / 180, r, rnd(), li + rnd() * 0.99], o);
      o += 4;
    }
  });
  return out;
}

// ------------------------------------------------------------------ waves

/** Measured wet limit of the photo at a yaw (degrees), linear between samples; null outside the cove. */
export function shorePitch(spec: WavesSpec, yaw: number): number | null {
  const s = spec.shore;
  if (yaw < s[0][0] || yaw > s[s.length - 1][0]) return null;
  for (let i = 1; i < s.length; i++) {
    if (yaw <= s[i][0]) {
      const k = (yaw - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return s[i - 1][1] + (s[i][1] - s[i - 1][1]) * k;
    }
  }
  return s[s.length - 1][1];
}

/** Ground distance (m) of the mean water line at a yaw, for an eye `eye` m above the sand. */
export function shoreDistance(spec: WavesSpec, yaw: number, eye = EYE_HEIGHT): number | null {
  const p = shorePitch(spec, yaw);
  if (p == null) return null;
  const line = Math.min(-2, p + spec.lineOffset);
  return eye / Math.tan((-line * Math.PI) / 180);
}

/** Phase landmarks of one wave cycle (0..1): the foam bore rolls in until BORE, runs up until TOP, then pulls back. */
export const WAVE = { bore: 0.12, top: 0.4, back: -0.42, boreFrom: -0.95 } as const;

/** Inverse of smoothstep on [0, 1] (exact): k such that 3k² − 2k³ = y. */
export function invSmoothstep(y: number): number {
  const c = Math.min(1, Math.max(0, y));
  return 0.5 - Math.sin(Math.asin(1 - 2 * c) / 3);
}

/**
 * Where the water's edge is (m along the ground, + = up the beach past the mean water line) at phase s of a wave
 * that reaches `reach`. Same formula as the shader (waves.ts). Before BORE the edge is the incoming foam bore.
 */
export function waveFront(s: number, reach: number): number {
  if (s < WAVE.bore) {
    const k = s / WAVE.bore;
    return WAVE.boreFrom * (1 - k);
  }
  if (s < WAVE.top) {
    const k = (s - WAVE.bore) / (WAVE.top - WAVE.bore);
    return reach * (1 - (1 - k) * (1 - k));
  }
  const k = (s - WAVE.top) / (1 - WAVE.top);
  const e = k * k * (3 - 2 * k);
  return reach + (WAVE.back - reach) * e;
}

/** Phase (≥ TOP) at which the retreating edge passes x (0 < x < reach): to know how long the sand has been drying. */
export function recedePhase(x: number, reach: number): number {
  const y = (reach - x) / (reach - WAVE.back);
  return WAVE.top + (1 - WAVE.top) * invSmoothstep(y);
}

/** A breath frame as Breathe exposes it (logic/breathe.ts BreathFrame). */
export interface BreathLike {
  phase: 'settle' | 'in' | 'out' | 'close' | 'done';
  t: number;
  length: number;
}

/**
 * The wave clock (CPU, a few flops a frame). Free: one wave every 8–10 s (period chosen per wave, deterministic).
 * During Breathe the sea breathes with you: the wave runs up while you breathe in (4 s) and pulls back while you
 * breathe out (6 s), i.e. 6 waves a minute; during the settle phase the wave in progress is stretched or hurried so
 * the first breath in starts exactly with a new wave.
 */
export class WaveClock {
  /** Phase of the current wave, 0..1. */
  phase = 0.55;
  /** Count of waves since the start (re-seeds foam patterns, per-wave reach). */
  cycle = 0;
  period: number;
  reach: number;
  /** Reach of the previous wave (the sand it wetted is still drying). */
  prevReach: number;
  prevPeriod: number;
  breathing = false;
  private readonly spec: WavesSpec;
  private readonly rnd: () => number;

  constructor(spec: WavesSpec, seed = 3) {
    this.spec = spec;
    this.rnd = prng(seed);
    this.period = this.pick(spec.period);
    this.reach = this.pick(spec.reach);
    this.prevReach = this.reach;
    this.prevPeriod = this.period;
  }

  private pick(range: [number, number]): number {
    return range[0] + (range[1] - range[0]) * this.rnd();
  }

  private next(period?: number): void {
    this.cycle++;
    this.prevReach = this.reach;
    this.prevPeriod = this.period;
    this.period = period ?? this.pick(this.spec.period);
    this.reach = this.pick(this.spec.reach);
  }

  /** Advances the clock; returns true on the frame a new wave starts (its foam bore rolls in: play the surf). */
  step(dt: number, breath: BreathLike | null): boolean {
    if (breath != null && (breath.phase === 'in' || breath.phase === 'out')) {
      const inhale = breath.phase === 'in';
      const k = breath.length > 0 ? Math.min(1, Math.max(0, breath.t / breath.length)) : 0;
      const target = inhale ? WAVE.top * k : WAVE.top + (1 - WAVE.top) * k;
      let started = false;
      // A new breath in = a new wave; otherwise the phase only follows the breath forward.
      if (inhale && (!this.breathing || target < this.phase - 0.3)) {
        this.next(10);
        started = true;
      }
      this.breathing = true;
      this.period = 10;
      // Full swells while breathing: the wave runs as far as the breath goes.
      this.reach = this.spec.reach[1];
      if (started || target > this.phase) this.phase = target;
      return started;
    }
    if (breath != null && breath.phase === 'settle' && breath.length > 0) {
      // Land the current wave on the first breath in.
      const remaining = Math.max(0.2, breath.length - breath.t);
      const rate = (1 - this.phase) / remaining;
      const clamped = Math.min(1 / 5, Math.max(1 / 18, rate));
      // Never wraps here: the first breath in starts the new wave.
      this.phase = Math.min(0.999, this.phase + clamped * dt);
      return false;
    } else {
      this.breathing = false;
      this.phase += dt / this.period;
    }
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
      this.next();
      return true;
    }
    return false;
  }
}

// ------------------------------------------------------------------ fire

/** Flicker partials of the fire light (Hz, amplitude): all under 3 Hz (photosensitivity: no fast flashing). */
export const FLICKER: ReadonlyArray<[number, number]> = [
  [0.11, 0.07],
  [0.37, 0.06],
  [0.73, 0.05],
  [1.31, 0.035],
  [2.17, 0.02],
];

/** Light lift of one crackle: rises in ≈ 0.15 s, fades in ≈ 0.6 s, at most +30 %. Same as the shader. */
export function burstLight(age: number, strength: number): number {
  if (age < 0) return 0;
  const rise = 1 - Math.exp(-age / 0.06);
  return Math.min(0.3, 0.3 * strength) * rise * Math.exp(-age / 0.6);
}

/** Fire light (1 = nominal) at time t: slow flicker + the latest crackle. `level` 0..1 (good night → embers). */
export function fireLight(t: number, burstAge: number, burstStrength: number, level = 1): number {
  let f = 1;
  for (const [hz, a] of FLICKER) f += a * Math.sin(2 * Math.PI * hz * t + hz * 7.1);
  return (f + burstLight(burstAge, burstStrength)) * (0.25 + 0.75 * level);
}

/** Where the fire stands on the ground (seat frame: x right, z toward you, metres) for an immersion 0..1. */
export function firePosition(spec: FireSpec, immersion: number): { x: number; z: number; dist: number } {
  const k = Math.min(1, Math.max(0, immersion));
  const dist = spec.distTable + (spec.distFull - spec.distTable) * k;
  const yaw = (spec.yaw * Math.PI) / 180;
  return { x: Math.sin(yaw) * dist, z: -Math.cos(yaw) * dist, dist };
}

export interface Crackle {
  /** Seconds until this crackle. */
  delay: number;
  /** Which recording (index into the crackle bank). */
  sample: number;
  /** Playback rate (pitch) and gain (0..1, before the bank's ceiling). */
  rate: number;
  gain: number;
  /** Sparks and light lift strength (0..1), tied to the gain: a loud crackle throws more sparks. */
  strength: number;
}

/** Crackle timing: one every 2–9 s (spaced out ×2.5 and softer as the fire settles for the night). Pure, tested. */
export class CrackleScheduler {
  private last = -1;
  private readonly rnd: () => number;
  private readonly samples: number;
  constructor(samples: number, seed = 9) {
    this.samples = samples;
    this.rnd = prng(seed);
  }

  next(settle = 0): Crackle {
    const s = Math.min(1, Math.max(0, settle));
    // Skewed toward short gaps (fires crackle in little runs), always within 2–9 s.
    const u = this.rnd();
    const delay = (2 + 7 * u * u) * (1 + 1.5 * s);
    let sample = Math.floor(this.rnd() * this.samples);
    if (this.samples > 1 && sample === this.last) sample = (sample + 1 + Math.floor(this.rnd() * (this.samples - 1))) % this.samples;
    this.last = sample;
    const rate = 0.88 + 0.24 * this.rnd();
    const gain = (0.5 + 0.5 * this.rnd()) * (1 - 0.45 * s);
    return { delay, sample, rate, gain, strength: Math.min(1, gain * (0.7 + 0.6 * this.rnd())) };
  }
}

// ------------------------------------------------------------------ sounds

/** Real recordings (CC0 / public domain / CC BY, credited in CREDITS.md), cut by tools/make-living-sounds.mjs. */
export const LIVING_SOUNDS = {
  crackles: Array.from({ length: 8 }, (_, i) => `audio/living/crackle-${i + 1}.ogg`),
  surfs: Array.from({ length: 4 }, (_, i) => `audio/living/surf-${i + 1}.ogg`),
  embers: 'audio/living/embers.ogg',
  sea: 'audio/living/sea.ogg',
  wind: 'audio/living/wind.ogg',
} as const;
/** Ceiling of any one-shot (a crackle, a wave): nothing that makes you jump. Before the master volume. */
export const ONE_SHOT_CEILING = 0.55;

// ------------------------------------------------------------------ shooting stars

/** Seconds until the next shooting star: 60–180 s. */
export function nextShootingStar(rnd: () => number): number {
  return 60 + 120 * rnd();
}

// ------------------------------------------------------------------ coherence of the words

/** What an arrival line promises → which life must exist (tested: no text promises an effect that is not there). */
export const PROMISES: ReadonlyArray<{ words: RegExp; has: (life: PlaceLife | null, rain: boolean) => boolean; what: string }> = [
  { words: /\bwaves?\b/u, has: (l) => l?.waves != null, what: 'moving waves' },
  { words: /\brain\b/u, has: (_l, rain) => rain, what: 'falling rain' },
  { words: /\bsnow(ing|fall)?\b/u, has: (l) => l?.snow != null, what: 'falling snow' },
  { words: /\b(fire|embers?|campfire)\b/u, has: (l) => l?.fire != null || l?.hearth != null, what: 'a living fire' },
];
