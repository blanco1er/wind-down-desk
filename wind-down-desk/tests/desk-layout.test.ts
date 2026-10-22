import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyDrop,
  createDeskLayout,
  deskToWorld,
  homePosition,
  nearestBinIndex,
  slotPosition,
  worldToDesk,
  type DeskFrame,
} from '../src/logic/desk-layout.ts';
import { gazePick } from '../src/logic/gaze.ts';

const layout = createDeskLayout();

test('everything stays inside the seated ~60 cm reach', () => {
  // The user sits at desk-local z = +reach (projected eyes).
  const user = { x: 0, z: layout.reach };
  for (const bin of layout.bins) {
    assert.ok(Math.hypot(bin.x - user.x, bin.z - user.z) <= 0.6, `${bin.id} out of reach`);
  }
  for (let count = 1; count <= 8; count++) {
    for (let i = 0; i < count; i++) {
      const p = homePosition(i, count, layout);
      assert.ok(Math.hypot(p.x - user.x, p.z - user.z) <= 0.6, `token ${i}/${count} out of reach`);
    }
  }
  assert.ok(Math.hypot(layout.orb.x - user.x, layout.orb.z - user.z) <= 0.6);
});

test('home positions never overlap tokens or bins', () => {
  for (let count = 1; count <= 8; count++) {
    const points = Array.from({ length: count }, (_, i) => homePosition(i, count, layout));
    for (let a = 0; a < points.length; a++) {
      for (let b = a + 1; b < points.length; b++) {
        const d = Math.hypot(points[a].x - points[b].x, points[a].z - points[b].z);
        assert.ok(d >= layout.tokenRadius * 2, `tokens ${a} and ${b} overlap for count ${count}`);
      }
      for (const bin of layout.bins) {
        assert.ok(Math.hypot(points[a].x - bin.x, points[a].z - bin.z) > bin.snapRadius * 0.6);
      }
    }
  }
});

test('frame transforms round-trip for any yaw', () => {
  for (const yaw of [0, 0.7, -2.1, Math.PI]) {
    const frame: DeskFrame = { x: 1.2, y: 0.74, z: -0.6, yaw };
    const local = { x: 0.13, y: 0.02, z: -0.07 };
    const back = worldToDesk(frame, deskToWorld(frame, local));
    assert.ok(Math.abs(back.x - local.x) < 1e-9 && Math.abs(back.y - local.y) < 1e-9 && Math.abs(back.z - local.z) < 1e-9);
  }
  // yaw 0: desk +Z (towards the user) is world +Z.
  const p = deskToWorld({ x: 0, y: 0, z: 0, yaw: 0 }, { x: 0, y: 0, z: 1 });
  assert.equal(p.z, 1);
});

test('snapping is generous: a drop near a halo still lands in it', () => {
  for (const bin of layout.bins) {
    assert.equal(classifyDrop({ x: bin.x, y: 0.01, z: bin.z }, layout), bin.id);
    // 11 cm off-centre (beyond the 8.8 cm visual halo) still snaps.
    assert.equal(classifyDrop({ x: bin.x, y: 0.05, z: bin.z + 0.11 }, layout), bin.id);
    // Released from 20 cm above the desk: still counts (tired arms).
    assert.equal(classifyDrop({ x: bin.x, y: 0.2, z: bin.z }, layout), bin.id);
  }
});

test('ambiguous drops pick the nearest halo; real misses return null', () => {
  const [a] = layout.bins;
  // Between Tomorrow (x -0.25) and Later (x 0): the nearest halo wins.
  assert.equal(classifyDrop({ x: -0.14, y: 0, z: a.z }, layout), 'tomorrow');
  assert.equal(classifyDrop({ x: -0.11, y: 0, z: a.z }, layout), 'later');
  assert.equal(classifyDrop({ x: a.x, y: 0.4, z: a.z }, layout), null);
  assert.equal(classifyDrop({ x: 2, y: 0, z: -2 }, layout), null);
  assert.equal(classifyDrop({ x: 0, y: 0, z: layout.tokenRowZ + 0.05 }, layout), null);
});

test('hover magnet finds the closest bin within range without allocating', () => {
  assert.equal(nearestBinIndex({ x: layout.bins[2].x + 0.05, y: 0.1, z: layout.bins[2].z }, layout, layout.magnetRadius), 2);
  assert.equal(nearestBinIndex({ x: 0, y: 0, z: 0.5 }, layout, layout.magnetRadius), -1);
});

test('slots keep several tokens visible inside one halo', () => {
  for (const bin of layout.bins) {
    for (let slot = 0; slot < 10; slot++) {
      const p = slotPosition(bin, slot, layout);
      assert.ok(Math.hypot(p.x - bin.x, p.z - bin.z) < bin.radius, `slot ${slot} leaves ${bin.id}`);
    }
  }
});

test('head gaze picks the stone you look at, within a cone', () => {
  const head = { x: 0, y: 1.2, z: 0.42 };
  const targets = [
    { id: 'a', x: -0.1, y: 0.72, z: 0.1 },
    { id: 'b', x: 0.1, y: 0.72, z: 0.1 },
  ];
  const lookAtB = { x: 0.1 - head.x, y: 0.72 - head.y, z: 0.1 - head.z };
  assert.equal(gazePick(head, lookAtB, targets), 'b');
  assert.equal(gazePick(head, { x: 0, y: 1, z: 0 }, targets), null);
});
