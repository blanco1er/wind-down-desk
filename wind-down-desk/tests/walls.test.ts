import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keptOnWall, pickKeepWall, wallsFrom, type OrientedPlane } from '../src/logic/walls.ts';
import { keptPlaceNear } from '../src/logic/keep.ts';
import type { MeshBox } from '../src/logic/surfaces.ts';

/** A vertical plane as WebXR gives it: local Y = its normal, the polygon in local X (here vertical) / Z. */
function wall(id: string, label: string, center: { x: number; y: number; z: number }, normal: { x: number; z: number }, halfW: number, halfH = 1.3): OrientedPlane {
  return {
    id,
    label,
    orientation: 'vertical',
    center,
    yaw: 0,
    halfX: halfH,
    halfZ: halfW,
    offsetX: 0,
    offsetZ: 0,
    axisX: { x: 0, y: 1, z: 0 },
    axisY: { x: normal.x, y: 0, z: normal.z },
    axisZ: { x: -normal.z, y: 0, z: normal.x },
  };
}

// The emulator's living room (measured 29 Oct): the seat at x = −0.84 faces −X, toward the desk.
const head = { x: -0.84, y: 1.2, z: 0.2 };
const forward = { x: -1, z: 0 };
const room = [
  wall('78', 'wall', { x: -2.94, y: 1.94, z: -0.23 }, { x: -1, z: 0 }, 2.26),
  wall('88', 'wall', { x: 3.0, y: 1.94, z: 0.22 }, { x: 1, z: 0 }, 1.92),
  wall('79', 'wall', { x: -0.03, y: 1.94, z: 2.08 }, { x: 0, z: 1 }, 2.96),
  wall('w', 'window', { x: -2.94, y: 1.6, z: 1.4 }, { x: -1, z: 0 }, 0.6),
];

test('walls: vertical planes are walls (doors, windows, wall art are not), normals face the seat once picked', () => {
  const walls = wallsFrom(room, []);
  assert.equal(walls.length, 3, 'the window is not a wall');
  const w = pickKeepWall(walls, head, forward);
  assert.ok(w != null);
  assert.equal(w.id, 'plane:78', 'the wall in front of the seat, past the desk');
  assert.ok(w.normal.x > 0.9, 'its normal turned toward the room');
  assert.ok(Math.abs(w.halfWidth - 2.26) < 1e-9 && Math.abs(w.top - w.bottom - 2.6) < 1e-9);
});

test('walls: a wall behind you, too near, too far or too narrow is never picked', () => {
  assert.equal(pickKeepWall(wallsFrom([room[1]], []), head, forward), null, 'behind the seat');
  assert.equal(pickKeepWall(wallsFrom([wall('n', '', { x: -1.3, y: 1.4, z: 0.2 }, { x: -1, z: 0 }, 1)], []), head, forward), null, 'closer than 0.7 m');
  assert.equal(pickKeepWall(wallsFrom([wall('f', '', { x: -6, y: 1.4, z: 0.2 }, { x: -1, z: 0 }, 2)], []), head, forward), null, 'beyond 4.5 m');
  assert.equal(pickKeepWall(wallsFrom([wall('s', '', { x: -2.5, y: 1.4, z: 0.2 }, { x: -1, z: 0 }, 0.2)], []), head, forward), null, 'a strip of wall');
});

test('walls: a "wall" volume stands in when the room gives no vertical plane', () => {
  const box: MeshBox = { id: 'm', label: 'wall', isBounded3D: true, position: { x: -2.9, y: 0, z: 0.2 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, min: { x: -0.05, y: 0, z: -2 }, max: { x: 0.05, y: 2.6, z: 2 } };
  const w = pickKeepWall(wallsFrom([], [box]), head, forward);
  assert.ok(w != null && w.id === 'mesh:m');
});

test('Keep on a wall: every light rests on the wall, in the band above the panels, apart, and in the same spot every evening', () => {
  const w = pickKeepWall(wallsFrom(room, []), head, forward)!;
  const spots = Array.from({ length: 12 }, (_, n) => keptOnWall(n, (n * 2654435761) >>> 0, w, head, forward));
  for (const p of spots) {
    // 2 cm off the wall's surface, toward the room.
    const off = (p.x - w.center.x) * w.normal.x + (p.z - w.center.z) * w.normal.z;
    assert.ok(Math.abs(off - 0.02) < 1e-6);
    const d = Math.hypot(p.x - head.x, p.z - head.z);
    const elevation = (Math.atan2(p.y - head.y, d) * 180) / Math.PI;
    const azimuth = (Math.atan2(-(p.z - head.z), -(p.x - head.x)) * 180) / Math.PI;
    assert.ok(elevation > -3 && elevation < 13, `just above the captions (${elevation.toFixed(1)}°)`);
    assert.ok(Math.abs(azimuth) < 34, `within a glance (${azimuth.toFixed(1)}°)`);
  }
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y, spots[i].z - spots[j].z) > 0.25, 'tonight\'s three stand apart');
  // The next evening: the same wall and the same light → the same spot (anchored).
  assert.deepEqual(keptOnWall(5, (5 * 2654435761) >>> 0, w, head, forward), spots[5]);
});

test('Keep without a wall (an open room, no scene data): tonight\'s lights stay in view at the desk', () => {
  assert.equal(pickKeepWall(wallsFrom([], []), head, forward), null);
  const p = keptPlaceNear(0, 123);
  assert.ok(p.z < -0.19 && p.y < 0.1, 'on the tray\'s back rim, in the seated view (tests/night-sky.test.ts)');
});

test('an unknown room (no table, no wall, no ceiling): every new moment still has its place', async () => {
  const { findCeiling } = await import('../src/logic/sleep.ts');
  const { chooseTable, fallbackFrame } = await import('../src/logic/placement.ts');
  const { createDeskLayout } = await import('../src/logic/desk-layout.ts');
  const seat = { position: head, forward };
  // The desk floats at a seated height in front of you.
  assert.equal(chooseTable([], seat), null);
  const frame = fallbackFrame(seat, createDeskLayout());
  assert.ok(frame.y > 0.5 && frame.y < 1.0);
  // The kept lights stay at the desk, in view.
  assert.equal(pickKeepWall(wallsFrom([], []), head, forward), null);
  // Your sky goes to a dome 1.1 m above you.
  assert.deepEqual(findCeiling([], [], head.y), { y: head.y + 1.1, source: 'dome' });
});
