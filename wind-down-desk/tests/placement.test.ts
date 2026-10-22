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
