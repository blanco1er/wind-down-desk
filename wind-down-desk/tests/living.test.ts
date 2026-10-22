import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MENU_PLACES, PLACE_IDS, PLACES } from '../src/logic/places.ts';
import {
  burstLight,
  CrackleScheduler,
  fireLight,
  firePosition,
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
