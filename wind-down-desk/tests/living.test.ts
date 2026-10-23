import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MENU_PLACES, PLACE_IDS, PLACES } from '../src/logic/places.ts';
import {
  burstLight,
  CrackleScheduler,
  fireLight,
  firePosition,
  groundDirection,
  EYE_HEIGHT as EYE_HEIGHT_T,
  FLICKER,
  inRects,
  invSmoothstep,
  LIFE,
  lifeOf,
  LIVING_SOUNDS,
  ONE_SHOT_CEILING,
  PROMISES,
  recedePhase,
  snowSeeds,
  WAVE,
  WaveClock,
  waveFront,
} from '../src/logic/living.ts';

test('living places: every life belongs to a real place of the menu, never to your room', () => {
  assert.equal(lifeOf('room'), null);
  for (const id of Object.keys(LIFE)) {
    assert.ok((PLACE_IDS as readonly string[]).includes(id), `${id} is a place`);
    assert.ok((MENU_PLACES as readonly string[]).includes(id), `${id} is in the menu`);
  }
});

test('no arrival line promises something that is not there (UB: "the waves come and go" over a frozen sea)', () => {
  for (const id of PLACE_IDS) {
    const line = PLACES[id].arrive.toLowerCase();
    for (const p of PROMISES) {
      if (p.words.test(line)) assert.ok(p.has(lifeOf(id), PLACES[id].rain != null), `${id}: "${PLACES[id].arrive}" promises ${p.what}`);
    }
  }
});

test('every night place has its living layer', () => {
  for (const id of MENU_PLACES.slice(1)) {
    const life = lifeOf(id);
    const alive = life != null && Object.keys(life).length > 0;
    assert.ok(alive || PLACES[id].rain != null, `${id} has a living layer`);
  }
});

test('snow: flakes only behind the windows, never inside the shelter', () => {
  for (const id of PLACE_IDS) {
    const spec = lifeOf(id)?.snow;
    if (spec == null) continue;
    const seeds = snowSeeds(spec);
    assert.equal(seeds.length / 4, spec.flakes[0] + spec.flakes[1] + spec.flakes[2]);
    for (let i = 0; i < seeds.length; i += 4) {
      const yaw = (seeds[i] * 180) / Math.PI;
      assert.ok(seeds[i + 1] >= spec.glass + 0.25 - 1e-6, 'beyond the glass');
      assert.ok(spec.windows.some((w) => yaw >= w.yaw[0] - 4.01 && yaw <= w.yaw[1] + 4.01), 'behind a window (± drift margin)');
    }
    assert.ok(inRects(spec.windows, (spec.windows[0].yaw[0] + spec.windows[0].yaw[1]) / 2, 5));
  }
});

test('waves: the water edge is continuous, recedes as computed, one wave every 8–10 s', () => {
  const reach = 0.4;
  let prev = waveFront(0, reach);
  for (let s = 0.001; s < 1; s += 0.001) {
    const x = waveFront(s, reach);
    assert.ok(Math.abs(x - prev) < 0.05, `jump at ${s.toFixed(3)}`);
    prev = x;
  }
  assert.ok(Math.abs(waveFront(WAVE.top, reach) - reach) < 1e-9);
  for (const x of [0.05, 0.2, 0.35]) assert.ok(Math.abs(waveFront(recedePhase(x, reach), reach) - x) < 1e-6);
  assert.ok(Math.abs(invSmoothstep(0.5) - 0.5) < 1e-9);
  const spec = lifeOf('moon-beach')!.waves!;
  const clock = new WaveClock(spec);
  let waves = 0;
  for (let t = 0; t < 600; t += 1 / 72) if (clock.step(1 / 72, null)) waves++;
  assert.ok(waves >= 58 && waves <= 76, `${waves} waves in 10 minutes`);
  assert.ok(clock.period >= 8 && clock.period <= 10);
});

test('waves breathe with you in Breathe: a new wave with each breath in, at the top when the breath is full', () => {
  const spec = lifeOf('moon-beach')!.waves!;
  const clock = new WaveClock(spec);
  const dt = 1 / 72;
  // Settle 6.5 s, then 4 s in / 6 s out.
  let starts = 0;
  for (let t = 0; t < 6.5; t += dt) clock.step(dt, { phase: 'settle', t, length: 6.5 });
  for (let c = 0; c < 6; c++) {
    for (let t = 0; t < 4; t += dt) if (clock.step(dt, { phase: 'in', t, length: 4 })) starts++;
    assert.ok(Math.abs(clock.phase - WAVE.top) < 0.02, `top of the wave at the top of breath ${c}`);
    for (let t = 0; t < 6; t += dt) if (clock.step(dt, { phase: 'out', t, length: 6 })) starts++;
    assert.ok(clock.phase > 0.97, 'pulled back at the end of the breath out');
  }
  assert.equal(starts, 6);
  assert.equal(clock.period, 10);
});

test('fire: crackles every 2–9 s from ≥ 6 different recordings, never twice the same in a row, never loud', () => {
  const s = new CrackleScheduler(LIVING_SOUNDS.crackles.length);
  const used = new Set<number>();
  let last = -1;
  for (let i = 0; i < 2000; i++) {
    const c = s.next(0);
    assert.ok(c.delay >= 2 && c.delay <= 9, `delay ${c.delay}`);
    assert.ok(c.rate >= 0.88 && c.rate <= 1.12);
    assert.ok(c.gain > 0 && c.gain <= 1);
    assert.notEqual(c.sample, last);
    last = c.sample;
    used.add(c.sample);
  }
  assert.ok(used.size >= 6);
  // Good night: spaced out and softer.
  const calm = Array.from({ length: 500 }, () => s.next(1));
  assert.ok(calm.reduce((a, c) => a + c.delay, 0) / 500 > 7);
  assert.ok(Math.max(...calm.map((c) => c.gain)) <= 0.56);
  assert.ok(ONE_SHOT_CEILING <= 0.6);
});

test('fire light: slow (every partial under 3 Hz), a crackle lifts it by 30 % at most, it settles for the night', () => {
  for (const [hz] of FLICKER) assert.ok(hz < 3);
  let max = 0;
  for (let a = 0; a < 3; a += 0.01) max = Math.max(max, burstLight(a, 1));
  assert.ok(max <= 0.3 + 1e-9);
  assert.ok(burstLight(0.15, 1) > 0.5 * max, 'rises in ≈ 0.15 s');
  const day = fireLight(10, 99, 0, 1);
  const night = fireLight(10, 99, 0, 0.18);
  assert.ok(night < day * 0.5);
});

test('fire: on the ground of the place, 3.8–6.3 m away and 25–40° to one side, never beside the table, never over the passthrough', () => {
  const spec = lifeOf('ember-fire')!.fire!;
  for (const imm of [0, 1]) {
    const p = firePosition(spec, imm);
    assert.ok(p.dist >= 3.8 && p.dist <= 6.3, `distance ${p.dist}`);
    const yaw = (Math.atan2(p.x, -p.z) * 180) / Math.PI;
    assert.ok(Math.abs(yaw) >= 25 && Math.abs(yaw) <= 40, `yaw ${yaw}`);
    // The tray stands within ≈ 0.7 m of your eyes: the fire ring is metres away.
    assert.ok(p.dist - spec.ringRadius > 3);
  }
  // "Table stays": the passthrough band is below −8° (fully below −23.6°). The flames (0.6 m) stand above it and
  // the base is still ≥ 90 % the place's (backdrop keep mask: smoothstep(−0.4, −0.14, sin(pitch))).
  const t = firePosition(spec, 0);
  const pitch = (h: number) => Math.atan2(h - 1.2, t.dist);
  assert.ok(Math.sin(pitch(0.6)) > -0.14, 'flames above the passthrough band');
  const k = Math.min(1, Math.max(0, (Math.sin(pitch(0)) + 0.4) / 0.26));
  assert.ok(k * k * (3 - 2 * k) >= 0.9, 'base on the place');
});

test('panorama patches: the backdrop shader still has the three lines they rewrite', () => {
  const src = readFileSync(new URL('../src/desk/environment.ts', import.meta.url), 'utf8');
  for (const anchor of ['vec3 d = normalize(vDir);', 'vec3 col = mix(a, b, k);', 'gl_FragColor = vec4(col, alpha);', 'void main()']) {
    assert.ok(src.includes(anchor), anchor);
  }
  // placeAt() (pano.ts) calls place() exactly as main() does.
  assert.match(src, /place\(uTexA,\s*d,([^;]*?)\)\s*:/u);
  assert.match(src, /place\(uTexB,\s*d,([^;]*?)\)\s*:/u);
});

test('living sounds and ground textures are shipped and credited', () => {
  const files = [...LIVING_SOUNDS.crackles, ...LIVING_SOUNDS.surfs, LIVING_SOUNDS.embers, LIVING_SOUNDS.sea, LIVING_SOUNDS.wind, 'textures/living/burned-ground.jpg', 'textures/living/grass-path.jpg'];
  for (const f of files) assert.ok(existsSync(new URL(`../public/${f}`, import.meta.url)), f);
  const credits = readFileSync(new URL('../CREDITS.md', import.meta.url), 'utf8');
  for (const who of ['Glaneur de sons', 'PagDev', 'AntumDeluge', 'Dsw4', 'RandomMind', 'Escoitar', 'Poly Haven']) assert.ok(credits.includes(who), who);
});

test('cheap depth (axe 5): the ground is projected only on open flat places, and is exact when the head is at rest', () => {
  for (const id of ['fireside-cabin', 'rain-veranda', 'rooftop-city'] as const) assert.notEqual(LIFE[id]?.flatGround, true, `${id}: furniture or a ledge would bend`);
  for (const id of ['moon-beach', 'moon-lake', 'ember-fire'] as const) assert.equal(LIFE[id]?.flatGround, true, id);
  const src = readFileSync(new URL('../src/desk/environment.ts', import.meta.url), 'utf8');
  assert.match(src, /vec3 place\([^)]*\) \{\s*d = groundDir\(d\);/u, 'place() samples through groundDir()');
  const centre = [0.3, 1.2, -0.4] as const;
  const norm = (v: number[]): number[] => { const n = Math.hypot(v[0], v[1], v[2]); return v.map((x) => x / n); };
  const close = (a: number[], b: number[], eps: number): boolean => a.every((x, i) => Math.abs(x - b[i]) < eps);
  // Head at the centre: the photo is unchanged in every direction (nothing moves until you move).
  for (const d of [[0, -1, 0], [0.5, -0.5, -0.7], [0.9, -0.05, 0.4], [0, 0.6, -0.8]]) {
    const n = norm(d) as unknown as [number, number, number];
    assert.ok(close(groundDirection(n, centre, centre, EYE_HEIGHT_T), n, 1e-9));
  }
  // Head moved 20 cm to the right: the ground point straight below now shows the photo slightly to the right.
  const moved = [0.5, 1.2, -0.4] as const;
  const g = groundDirection([0, -1, 0], moved, centre, EYE_HEIGHT_T);
  assert.ok(g[0] > 0.15 && g[1] < -0.9, `parallax ${g}`);
  // Sky untouched, and continuous at the horizon (a ray just under it hits the ground far away: same direction).
  assert.deepEqual(groundDirection([0, 0.2, -0.98], moved, centre, EYE_HEIGHT_T), [0, 0.2, -0.98]);
  const h = norm([0, -0.0006, -1]) as unknown as [number, number, number];
  assert.ok(close(groundDirection(h, moved, centre, EYE_HEIGHT_T), h, 0.01));
  // Off (h = 0): the photo stays at infinity.
  assert.deepEqual(groundDirection([0, -1, 0], moved, centre, 0), [0, -1, 0]);
});

test('a place\'s photo patches on the shared root follow their place (never drawn after leaving it)', () => {
  // 26 Oct: hearth, sea, ambient and fire-glow patches hang on the shared living root; they used to stay drawn after
  // their place was left (+1 draw call per eye for every place visited, and their animation over the next photo).
  const src = readFileSync(new URL('../src/desk/living/index.ts', import.meta.url), 'utf8');
  const build = src.slice(src.indexOf('private build(id: PlaceId'), src.indexOf('/** Breathe: the frame of the breath'));
  const added = [...build.matchAll(/this\.root\.add\((\w+(?:\.\w+)?)\);/gu)].map((m) => m[1]).filter((n) => n !== 'root' && n !== 'star');
  assert.ok(added.length >= 4);
  for (const name of added) assert.ok(build.includes(`patches.push(${name});`), `${name} follows its place`);
  // Shown and hidden only through show(): the place's root and its patches together.
  assert.doesNotMatch(src.replace(/private show\(b: Built, on: boolean\): void \{[^}]*\}/u, ''), /\b(b|this\.current)\.root\.visible = (true|false)/u);
});
