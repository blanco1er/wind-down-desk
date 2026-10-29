import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeskLayout } from '../src/logic/desk-layout.ts';
import { chooseTable, frameOnTable, type PlaneCandidate } from '../src/logic/placement.ts';
import { chooseSurface, HITS, meshTop, surfaceFromHits, type MeshBox, type SurfaceHit } from '../src/logic/surfaces.ts';

const layout = createDeskLayout();
const seated = { position: { x: 0, y: 1.2, z: 0 }, forward: { x: 0, z: -1 } };
const standing = { position: { x: 0, y: 1.65, z: 0 }, forward: { x: 0, z: -1 } };

function plane(partial: Partial<PlaneCandidate>): PlaneCandidate {
  return { id: 'p', orientation: 'horizontal', label: '', center: { x: 0, y: 0.74, z: -0.7 }, yaw: 0, halfX: 0.6, halfZ: 0.4, offsetX: 0, offsetZ: 0, ...partial };
}

function box(partial: Partial<MeshBox>): MeshBox {
  return {
    id: 'm',
    label: 'table',
    isBounded3D: true,
    position: { x: 0, y: 0.37, z: -0.7 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    min: { x: -0.6, y: -0.37, z: -0.4 },
    max: { x: 0.6, y: 0.37, z: 0.4 },
    ...partial,
  };
}

/** A grid of up-facing hits on a table top at height y (what depth hit-tests return on a real desk). */
function tableHits(y: number, z0 = -0.75, n = 6): SurfaceHit[] {
  const out: SurfaceHit[] = [];
  for (let i = 0; i < n; i++) out.push({ x: -0.2 + (i % 3) * 0.2, y: y + (i % 2 ? 0.004 : -0.004), z: z0 - Math.floor(i / 3) * 0.15, up: 0.99 });
  return out;
}

// ------------------------------------------------------------ rooms never tested before (defined behaviours)

test('table too low (ottoman 0.30 m) → no table: the desk floats at a seated height', () => {
  assert.equal(chooseSurface({ planes: [plane({ label: 'table', center: { x: 0, y: 0.3, z: -0.6 } })] }, seated), null);
});

test('low coffee table (0.42 m) in reach is still a table', () => {
  const c = chooseSurface({ planes: [plane({ label: 'coffee table', center: { x: 0, y: 0.42, z: -0.6 } })] }, seated);
  assert.equal(c?.source, 'plane');
});

test('table too high for a seated person (bar 1.10 m, eyes 1.20 m) → floating; standing at it → the bar', () => {
  const bar = plane({ label: 'table', center: { x: 0, y: 1.1, z: -0.6 } });
  assert.equal(chooseSurface({ planes: [bar] }, seated), null);
  assert.equal(chooseSurface({ planes: [bar] }, standing)?.plane.center.y, 1.1);
  assert.equal(chooseSurface({ planes: [plane({ center: { x: 0, y: 1.3, z: -0.6 } })] }, standing), null, 'above 1.15 m: never');
});

test('no table at all (empty room, VR session, nothing scanned) → null (floating desk)', () => {
  assert.equal(chooseSurface({ planes: [], meshes: [], hits: [] }, seated), null);
  assert.equal(chooseSurface({ planes: [plane({ label: 'floor', center: { x: 0, y: 0, z: -0.6 } })] }, seated), null);
});

test('cluttered room: the table in front wins over bed, couch, chair, shelf, storage and far tables', () => {
  const room = [
    plane({ id: 'floor', label: 'floor', center: { x: 0, y: 0, z: 0 }, halfX: 3, halfZ: 3 }),
    plane({ id: 'ceiling', label: 'ceiling', center: { x: 0, y: 2.6, z: 0 }, halfX: 3, halfZ: 3 }),
    plane({ id: 'wall', orientation: 'vertical', label: 'wall' }),
    plane({ id: 'bed', label: 'bed', center: { x: 0.5, y: 0.55, z: -0.4 } }),
    plane({ id: 'couch', label: 'couch', center: { x: -0.6, y: 0.45, z: -0.3 } }),
    plane({ id: 'chair', label: 'chair', center: { x: 0.3, y: 0.46, z: 0.35 }, halfX: 0.22, halfZ: 0.22 }),
    plane({ id: 'shelf', label: 'other', center: { x: 0.7, y: 0.9, z: -0.3 }, halfX: 0.15, halfZ: 0.12 }),
    plane({ id: 'storage', label: 'storage', center: { x: -0.75, y: 0.85, z: -0.5 }, halfX: 0.4, halfZ: 0.2 }),
    plane({ id: 'far', label: 'table', center: { x: 0, y: 0.74, z: -3 } }),
    plane({ id: 'desk', label: 'desk', center: { x: 0, y: 0.73, z: -0.75 } }),
  ];
  assert.equal(chooseSurface({ planes: room }, seated)?.plane.id, 'desk');
  // Without the desk, a chair seat is never a table (the storage cabinet is the best left).
  const noDesk = room.filter((p) => p.id !== 'desk' && p.id !== 'storage');
  const c = chooseSurface({ planes: noDesk }, seated);
  assert.notEqual(c?.plane.id, 'chair');
});

test('a small table smaller than the tray: the mat stays centred on it, never pushed off its far edge', () => {
  const small = plane({ label: 'table', center: { x: 0, y: 0.7, z: -0.55 }, halfX: 0.25, halfZ: 0.2 });
  const c = chooseTable([small], seated);
  assert.ok(c);
  const f = frameOnTable(c, seated, layout);
  assert.ok(Math.abs(f.z - -0.55) <= 0.2 + 1e-6, 'centre inside the table');
});

// ------------------------------------------------------------ mesh detection (scene volumes)

test('a table volume gives its top face, whatever axis is "up" in mesh space', () => {
  const yUp = meshTop(box({}));
  assert.ok(yUp);
  assert.ok(Math.abs(yUp.center.y - 0.74) < 1e-6);
  assert.ok(Math.abs(yUp.halfX - 0.6) < 1e-6 && Math.abs(yUp.halfZ - 0.4) < 1e-6);
  // Same box authored z-up (rotated −90° about X): local z is world up.
  const s = Math.SQRT1_2;
  const zUp = meshTop(box({ quaternion: { x: -s, y: 0, z: 0, w: s }, min: { x: -0.6, y: -0.4, z: -0.37 }, max: { x: 0.6, y: 0.4, z: 0.37 } }));
  assert.ok(zUp);
  assert.ok(Math.abs(zUp.center.y - 0.74) < 1e-6, `top ${zUp.center.y}`);
  assert.ok(Math.abs(zUp.center.z - -0.7) < 1e-6);
});

test('mesh volumes that are not tables, global meshes and tilted boxes are ignored', () => {
  assert.equal(meshTop(box({ label: 'couch' })), null);
  assert.equal(meshTop(box({ isBounded3D: false, label: 'global mesh' })), null);
  const t = Math.sin(0.25); // ≈ 29° tilt about X
  assert.equal(meshTop(box({ quaternion: { x: t, y: 0, z: 0, w: Math.cos(0.25) } })), null);
});

test('no planes but a table volume → the desk sits on the volume (source "mesh")', () => {
  const c = chooseSurface({ planes: [], meshes: [box({})] }, seated);
  assert.equal(c?.source, 'mesh');
  assert.ok(Math.abs(c!.plane.center.y - 0.74) < 1e-6);
});

// ------------------------------------------------------------ hit test (depth, no Space Setup)

test('no scene model at all: depth hits on a desk top give a surface at its height, facing you', () => {
  const hits = [...tableHits(0.73), { x: 0, y: 0.002, z: -1.6, up: 1 }, { x: 0.1, y: 0.01, z: -1.7, up: 1 }, { x: 0.4, y: 0.95, z: -0.5, up: 0.3 }];
  const s = surfaceFromHits(hits, seated);
  assert.ok(s);
  assert.ok(Math.abs(s.center.y - 0.73) < 0.005);
  const c = chooseSurface({ planes: [], hits }, seated);
  assert.equal(c?.source, 'hit');
  const f = frameOnTable(c!, seated, layout);
  assert.ok(f.z < 0 && f.z > -1.2, 'in front, in reach');
  assert.ok(Math.abs(f.yaw) < 0.2, 'facing the person');
});

test('hits on your own lap / knees (right under the head) are never a table', () => {
  const lap: SurfaceHit[] = [];
  for (let i = 0; i < 8; i++) lap.push({ x: -0.1 + i * 0.03, y: 0.62, z: -0.05 - (i % 3) * 0.05, up: 0.97 });
  assert.equal(surfaceFromHits(lap, seated), null);
  // With the lap AND the desk in view, the desk wins.
  assert.ok(Math.abs((surfaceFromHits([...lap, ...tableHits(0.74)], seated)?.center.y ?? 0) - 0.74) < 0.005);
});

test('too few agreeing hits (a cup, an arm) are noise → null', () => {
  assert.equal(surfaceFromHits(tableHits(0.73).slice(0, HITS.minCount - 1), seated), null);
  assert.equal(surfaceFromHits([{ x: 0, y: 0.73, z: -0.6, up: 0.5 }, ...tableHits(0.73).map((h) => ({ ...h, up: 0.5 }))], seated), null, 'walls / slopes');
});

test('the same table seen as a plane and as a volume → the plane (the measured top surface)', () => {
  const c = chooseSurface({ planes: [plane({ id: 'top', label: 'table', center: { x: 0, y: 0.612, z: -0.7 } })], meshes: [box({ position: { x: 0, y: 0.304, z: -0.65 }, min: { x: -0.6, y: -0.304, z: -0.4 }, max: { x: 0.6, y: 0.304, z: 0.4 } })] }, seated);
  assert.equal(c?.source, 'plane');
  assert.equal(c?.plane.id, 'top');
});

test('labelled planes always beat raw hits', () => {
  const c = chooseSurface({ planes: [plane({ id: 'desk', label: 'desk' })], hits: tableHits(0.6) }, seated);
  assert.equal(c?.plane.id, 'desk');
});

test('29 Oct — no scene model, the couch: depth hits on the coffee table (65 cm under the eyes) are not a desk', () => {
  const couch = { position: { x: 0, y: 1.1, z: 0 }, forward: { x: 0, z: -1 } };
  const coffee = tableHits(0.455, -0.6);
  assert.equal(surfaceFromHits(coffee, couch), null);
  assert.equal(chooseSurface({ planes: [], hits: coffee }, couch), null, 'the desk floats at a comfortable height');
  // The ordinary desk from an ordinary chair is still found.
  assert.ok(surfaceFromHits(tableHits(0.74), seated) != null);
});
