import assert from 'node:assert/strict';
import { test } from 'node:test';
import { constellationSegments, eveningSkyPoint, skyDisc, skyStarAngle, type SkyStar } from '../src/logic/night-sky.ts';
import { ceilingPoint, CEILING_CONE_DEG } from '../src/logic/sleep.ts';
import { KEPT_FLIGHT, KEPT_NEAR, keptFlight, keptPlaceNear, keptWordAlpha } from '../src/logic/keep.ts';

// ------------------------------------------------------------------ 29 Oct: Keep, the light in view

test('Keep (29 Oct): tonight\'s lights rest in view just behind the tray, low, apart, never over it', () => {
  // Seated eyes (desk-local): 0.39 m above the tray floor, 0.58 m behind its centre; pitch −27°, 54° vertical FOV.
  const eye = { y: 0.39, z: 0.58 };
  const places = KEPT_NEAR.map((_, n) => keptPlaceNear(n, (n * 2654435761) >>> 0));
  for (const p of places) {
    assert.ok(p.z < -0.19, 'over the tray\'s back rim or behind it (the tray floor stays clear)');
    assert.ok(p.y > 0.03 && p.y < 0.1, 'a few centimetres up: it lights the rim and the back of the tray');
    assert.ok(Math.abs(p.x) > 0.09, 'never in the middle, where the reply buttons stand');
    const elevation = (Math.atan2(p.y - eye.y, eye.z - p.z) * 180) / Math.PI;
    const azimuth = (Math.atan2(p.x, eye.z - p.z) * 180) / Math.PI;
    assert.ok(elevation < -6 && elevation > -50, `in the seated frame (elevation ${elevation.toFixed(1)}°)`);
    assert.ok(Math.abs(azimuth) < 34, `inside a 16:9 frame (azimuth ${azimuth.toFixed(1)}°)`);
  }
  for (let i = 0; i < places.length; i++) for (let j = i + 1; j < places.length; j++) {
    const d = Math.hypot(places[i].x - places[j].x, places[i].z - places[j].z);
    assert.ok(d > 0.09, `lights ${i} and ${j} stand apart (${d.toFixed(2)} m)`);
  }
  // The 7th and later: the ring around the room, as before.
  assert.ok(keptPlaceNear(KEPT_NEAR.length, 7).y >= 0.18);
});

test('Keep (29 Oct): the flight rises first, arcs up and settles exactly on its place', () => {
  const a = { x: 0, y: 0.12, z: 0.2 };
  const b = { x: -0.24, y: 0.07, z: -0.3 };
  assert.deepEqual(keptFlight(a, b, 0, 0.4), a);
  const end = keptFlight(a, b, 1, 0.4);
  for (const k of ['x', 'y', 'z'] as const) assert.ok(Math.abs(end[k] - b[k]) < 1e-9);
  const mid = keptFlight(a, b, 0.5, 0.4);
  assert.ok(mid.y > a.y + 0.04, 'it rises above both ends on the way');
  // Smooth: no step larger than 2 cm between frames of a 3.6 s flight at 72 fps.
  let prev = a;
  for (let i = 1; i <= 260; i++) {
    const p = keptFlight(a, b, i / 260, 0.4);
    assert.ok(Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z) < 0.02);
    prev = p;
  }
});

test('Keep (29 Oct): the word appears as the light lands, stays, then fades', () => {
  assert.equal(keptWordAlpha(-0.1), 0);
  assert.ok(keptWordAlpha(KEPT_FLIGHT.wordIn / 2) > 0.4);
  assert.equal(keptWordAlpha(KEPT_FLIGHT.wordIn + 1), 1);
  assert.equal(keptWordAlpha(KEPT_FLIGHT.wordIn + KEPT_FLIGHT.wordHold + KEPT_FLIGHT.wordOut + 0.01), 0);
});

// ------------------------------------------------------------------ 29 Oct: the night sky

const star = (x: number, z: number, date: string): SkyStar => ({ x, y: 2.49, z, date });

test('night sky: constellations join the stars of the same evening only, newest first, short lines', () => {
  const stars = [star(0, 0, '2026-10-20'), star(0.2, 0.1, '2026-10-20'), star(0.35, 0.3, '2026-10-20'), star(-0.5, 0.4, '2026-10-27'), star(-0.4, 0.6, '2026-10-27'), star(1.5, 1.5, '2026-10-25')];
  const segs = constellationSegments(stars);
  assert.equal(segs.length, 3, 'three stars → two lines, two stars → one line, a lone star → none');
  for (const [a, b] of segs) assert.equal(stars[a].date, stars[b].date);
  assert.equal(stars[segs[0][0]].date, '2026-10-27', 'the newest evening first');
  assert.equal(constellationSegments(stars, 1).length, 1, 'never more than asked');
  // A line longer than maxLen is not drawn (a constellation never crosses the whole sky).
  assert.equal(constellationSegments([star(0, 0, 'a'), star(3, 0, 'a')]).length, 0);
  // Each star at most twice (a path, not a web).
  const uses = new Map<number, number>();
  for (const [a, b] of segs) for (const i of [a, b]) uses.set(i, (uses.get(i) ?? 0) + 1);
  for (const n of uses.values()) assert.ok(n <= 2);
});

test('night sky: the disc covers every landed star, on the ceiling or the dome', () => {
  const head = { x: 0, y: 1.2, z: 0 };
  const forward = { x: 0, z: -1 };
  for (const ceiling of [{ y: 2.5, source: 'plane' as const }, { y: 3.8, source: 'plane' as const }, { y: 2.3, source: 'dome' as const }]) {
    const disc = skyDisc(head, forward, ceiling);
    for (let i = 0; i < 100; i++) {
      const p = ceilingPoint((i * 2654435761) >>> 0, head, forward, ceiling);
      if (ceiling.source === 'plane') {
        const r = Math.hypot(p.x - disc.center.x, p.z - disc.center.z);
        // Inside the opaque part of the disc (its edge fades from 50 % of the radius).
        assert.ok(r < disc.radius * 0.9, `star at ${r.toFixed(2)} of ${disc.radius.toFixed(2)}`);
      }
    }
    assert.equal(disc.dome, ceiling.source === 'dome' ? 1.1 : 0);
    // Same angular size on a low or a high ceiling: the radius grows with the height.
    const lift = ceiling.y - head.y;
    if (ceiling.source === 'plane') assert.ok(Math.abs(Math.atan2(disc.radius, lift) - Math.atan(Math.tan((CEILING_CONE_DEG * Math.PI) / 180) * 1.15)) < 1e-9);
  }
});

test('night sky: many small stars, a few bright ones, the same angle on any ceiling', () => {
  const sizes = Array.from({ length: 8 }, (_, k) => (0.016 + k * 0.0022) * 0.8);
  const angles = sizes.map(skyStarAngle);
  for (const a of angles) assert.ok(a >= 0.016 && a <= 0.0381);
  const small = angles.filter((a) => a < 0.021).length;
  const bright = angles.filter((a) => a > 0.031).length;
  assert.ok(small >= 3 && bright >= 1 && bright <= 2, `${small} small, ${bright} bright`);
});

test('night sky: the stars of one evening land together (a constellation), inside the cone', () => {
  const head = { x: 0, y: 1.2, z: 0 };
  const forward = { x: 0, z: -1 };
  for (const ceiling of [{ y: 2.5, source: 'plane' as const }, { y: 3.9, source: 'plane' as const }, { y: 2.3, source: 'dome' as const }]) {
    const lift = ceiling.y - head.y;
    const dates = ['2026-10-20', '2026-10-21', '2026-10-27'];
    const stars: SkyStar[] = [];
    dates.forEach((date, e) => {
      for (let k = 0; k < 4; k++) stars.push({ ...eveningSkyPoint((k * 2654435761 + e * 97) >>> 0, e, dates.length, head, forward, ceiling), date });
    });
    for (const p of stars) {
      const angle = (Math.atan2(Math.hypot(p.x - head.x, p.z - head.z), p.y - head.y) * 180) / Math.PI;
      assert.ok(angle <= CEILING_CONE_DEG + 0.5, `${angle.toFixed(1)}°`);
    }
    if (ceiling.source === 'plane') {
      // Same evening: within ≈ 0.55 × the ceiling's height of each other, so their lines are drawn.
      const segs = constellationSegments(stars, 48, 0.36 * lift);
      assert.ok(segs.length >= 8, `${segs.length} lines for 3 evenings of 4 stars`);
      // Evenings stand apart: every star is nearer its own evening's stars than any other evening's centre.
      const centre = (d: string) => { const g = stars.filter((s) => s.date === d); return { x: g.reduce((a, s) => a + s.x, 0) / g.length, z: g.reduce((a, s) => a + s.z, 0) / g.length }; };
      const cs = dates.map(centre);
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) assert.ok(Math.hypot(cs[i].x - cs[j].x, cs[i].z - cs[j].z) > 0.3 * lift, 'evenings do not overlap');
    }
  }
});
