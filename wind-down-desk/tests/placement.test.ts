import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeskLayout, deskToWorld } from '../src/logic/desk-layout.ts';
import { chooseTable, closestPointOnPlane, fallbackFrame, frameOnTable, type PlaneCandidate } from '../src/logic/placement.ts';

const layout = createDeskLayout();
const seated = { position: { x: 0, y: 1.2, z: 0 }, forward: { x: 0, z: -1 } };

function plane(partial: Partial<PlaneCandidate>): PlaneCandidate {
  return {
    id: 'p',
    orientation: 'horizontal',
    label: '',
    center: { x: 0, y: 0.74, z: -0.7 },
    yaw: 0,
    halfX: 0.6,
    halfZ: 0.4,
    offsetX: 0,
    offsetZ: 0,
    ...partial,
  };
}

test('floors, walls, ceilings and far tables are never chosen', () => {
  assert.equal(chooseTable([plane({ center: { x: 0, y: 0, z: -0.7 } })], seated), null, 'floor height');
  assert.equal(chooseTable([plane({ orientation: 'vertical' })], seated), null, 'wall');
  assert.equal(chooseTable([plane({ label: 'floor' })], seated), null, 'labelled floor');
  assert.equal(chooseTable([plane({ center: { x: 0, y: 0.74, z: -3 } })], seated), null, 'out of reach');
  assert.equal(chooseTable([plane({ halfX: 0.1, halfZ: 0.1 })], seated), null, 'too small');
});

test('a labelled table in front wins over a closer unlabelled shelf behind', () => {
  const shelf = plane({ id: 'shelf', center: { x: 0, y: 0.9, z: 0.5 }, halfX: 0.3, halfZ: 0.2 });
  const table = plane({ id: 'table', label: 'table' });
  assert.equal(chooseTable([shelf, table], seated)?.plane.id, 'table');
});

test('the desk lands on the table, near its front edge, facing the user', () => {
  for (const yaw of [0, 0.4, -1.1]) {
    const table = plane({ label: 'table', yaw, halfX: 0.7, halfZ: 0.45 });
    const choice = chooseTable([table], seated);
    assert.ok(choice != null);
    const frame = frameOnTable(choice, seated, layout);
    assert.ok(Math.abs(frame.y - 0.742) < 1e-6, 'sits on the surface');
    // Mat centre is on the table and within seated reach.
    const onTable = closestPointOnPlane(table, frame.x, frame.z);
    assert.ok(Math.hypot(onTable.x - frame.x, onTable.z - frame.z) < 1e-6, 'centre on the table');
    assert.ok(Math.hypot(frame.x, frame.z) < 0.95, 'within reach');
    // Desk +Z faces the user.
    const towardUser = deskToWorld({ ...frame, x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    const dx = seated.position.x - frame.x;
    const dz = seated.position.z - frame.z;
    assert.ok((towardUser.x * dx + towardUser.z * dz) / Math.hypot(dx, dz) > 0.99);
  }
});

test('without a table the desk floats at a seated height in front', () => {
  const frame = fallbackFrame(seated, layout);
  assert.ok(frame.y >= 0.55 && frame.y <= 1.05);
  assert.ok(Math.abs(frame.z + layout.reach) < 1e-9);
  const standing = fallbackFrame({ position: { x: 0, y: 1.7, z: 0 }, forward: { x: 1, z: 0 } }, layout);
  assert.ok(standing.y <= 1.05 && standing.x > 0);
});

test('29 Oct — the coffee table seen from the couch is out of a seated arm\'s reach: the desk floats instead', async () => {
  const { armToDesk, chooseTable, PLACEMENT } = await import('../src/logic/placement.ts');
  const couch = { position: { x: 0, y: 1.1, z: 0 }, forward: { x: 0, z: -1 } };
  // A 45 cm coffee table whose near edge is 55 cm in front (the emulator's living room, measured).
  const coffee = { id: 'c', orientation: 'horizontal', label: 'table', center: { x: 0, y: 0.455, z: -0.86 }, yaw: 0, halfX: 0.56, halfZ: 0.31, offsetX: 0, offsetZ: 0 };
  assert.ok(armToDesk(0.455, 0.55, couch) > PLACEMENT.maxArm, 'the tray centre would be ≈ 0.9 m from the shoulder');
  assert.equal(chooseTable([coffee], couch), null);
  // The same check keeps an ordinary desk: eyes 1.2 m, table 0.79 m, near edge 32 cm away (≈ 0.63 m to the tray).
  const desk = { ...coffee, center: { x: 0, y: 0.789, z: -0.7 }, halfZ: 0.38 };
  const seatedAtDesk = { position: { x: 0, y: 1.2, z: 0 }, forward: { x: 0, z: -1 } };
  assert.ok(chooseTable([desk], seatedAtDesk) != null);
  // And a high table close under the eyes (24 cm): reachable, kept.
  assert.ok(chooseTable([desk], { position: { x: 0, y: 1.03, z: 0 }, forward: { x: 0, z: -1 } }) != null);
});

test('29 Oct — a low seat at a high table: the table is refused, but the floating desk never sinks into it', async () => {
  const { clearOfSurfaces } = await import('../src/logic/placement.ts');
  const { createDeskLayout } = await import('../src/logic/desk-layout.ts');
  const lay = createDeskLayout();
  const lowSeat = { position: { x: 0, y: 0.98, z: 0 }, forward: { x: 0, z: -1 } };
  const table = { id: 't', orientation: 'horizontal', label: 'table', center: { x: 0, y: 0.789, z: -0.7 }, yaw: 0, halfX: 0.65, halfZ: 0.38, offsetX: 0, offsetZ: 0 };
  assert.equal(chooseTable([table], lowSeat), null, '19 cm under the eyes: refused as before');
  const floating = fallbackFrame(lowSeat, lay);
  assert.ok(floating.y < table.center.y, 'the plain floating height is under the real table top');
  const rested = clearOfSurfaces(floating, [table], lay, 0.02);
  assert.ok(Math.abs(rested.y - (table.center.y + 0.02)) < 1e-9, 'it rests on the table top instead');
  // Nothing under the tray (the table is elsewhere), a floor, or a shelf far overhead: unchanged.
  assert.equal(clearOfSurfaces(floating, [{ ...table, center: { x: 3, y: 0.789, z: 3 } }], lay, 0.02), floating);
  assert.equal(clearOfSurfaces(floating, [{ ...table, label: 'floor', center: { ...table.center, y: 0.7 } }], lay, 0.02), floating);
  assert.equal(clearOfSurfaces(floating, [{ ...table, center: { ...table.center, y: floating.y + 0.6 } }], lay, 0.02), floating);
});
