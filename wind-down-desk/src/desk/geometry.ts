/**
 * Procedural geometry, built once and shared. Triangle counts are logged by
 * the perf probe; the whole tray (wood + three ceramic bowls) is one mesh.
 */
import {
  BufferAttribute,
  BufferGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Path,
  PlaneGeometry,
  Shape,
  Vector2,
} from '@iwsdk/core';
import type { DeskLayout } from '../logic/desk-layout.ts';

/** Physical dimensions of the tray and bowls (metres). */
export const TRAY = {
  /** Base board thickness under the floor; the desk frame (tray floor) is lifted by this on a table. */
  height: 0.018,
  bevel: 0.004,
  corner: 0.075,
  /** Raised rim around the edge. */
  rimWidth: 0.026,
  /** v8: a real tray wall (1.7 cm), like the reference images; the floor stays at y = 0. */
  rimHeight: 0.017,
  /** Stoneware bowls standing on the tray (v8: round, flat-bottomed, near-straight walls, 5.3 cm deep inside). */
  bowlOuter: 0.104,
  bowlInner: 0.0955,
  bowlHeight: 0.064,
  bowlFloor: 0.0105,
} as const;

/** Desk-local height of the bowl's inner surface at distance r from its centre. */
export function bowlFloorAt(r: number): number {
  // v8: a flat floor out to a tight 1 cm fillet at the wall.
  return TRAY.bowlFloor + Math.max(0, r - 0.083) * 0.3;
}

function roundedRect(shape: Shape | Path, w: number, d: number, r: number, clockwise = false): void {
  if (!clockwise) {
    shape.moveTo(-w + r, -d);
    shape.lineTo(w - r, -d);
    shape.absarc(w - r, -d + r, r, -Math.PI / 2, 0, false);
    shape.lineTo(w, d - r);
    shape.absarc(w - r, d - r, r, 0, Math.PI / 2, false);
    shape.lineTo(-w + r, d);
    shape.absarc(-w + r, d - r, r, Math.PI / 2, Math.PI, false);
    shape.lineTo(-w, -d + r);
    shape.absarc(-w + r, -d + r, r, Math.PI, Math.PI * 1.5, false);
  } else {
    shape.moveTo(-w + r, -d);
    shape.absarc(-w + r, -d + r, r, Math.PI * 1.5, Math.PI, true);
    shape.lineTo(-w, d - r);
    shape.absarc(-w + r, d - r, r, Math.PI, Math.PI / 2, true);
    shape.lineTo(w - r, d);
    shape.absarc(w - r, d - r, r, Math.PI / 2, 0, true);
    shape.lineTo(w, -d + r);
    shape.absarc(w - r, -d + r, r, 0, -Math.PI / 2, true);
  }
}

function nonIndexed(geometry: BufferGeometry): BufferGeometry {
  return geometry.index != null ? geometry.toNonIndexed() : geometry;
}

/** Concatenates geometries (position + normal) and tags each part with `aKind`. */
function mergeTagged(parts: Array<{ geometry: BufferGeometry; kind: number }>): BufferGeometry {
  const prepared = parts.map((p) => ({ g: nonIndexed(p.geometry), kind: p.kind }));
  const count = prepared.reduce((n, p) => n + p.g.getAttribute('position').count, 0);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const kind = new Float32Array(count);
  let offset = 0;
  for (const { g, kind: k } of prepared) {
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const o = (offset + i) * 3;
      position[o] = pos.getX(i);
      position[o + 1] = pos.getY(i);
      position[o + 2] = pos.getZ(i);
      normal[o] = nor.getX(i);
      normal[o + 1] = nor.getY(i);
      normal[o + 2] = nor.getZ(i);
      kind[offset + i] = k;
    }
    offset += pos.count;
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(position, 3));
  merged.setAttribute('normal', new BufferAttribute(normal, 3));
  merged.setAttribute('aKind', new BufferAttribute(kind, 1));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function extrudeFlat(shape: Shape, depth: number, bevel: number, top: number): BufferGeometry {
  const g = new ExtrudeGeometry(shape, {
    depth: depth - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 20,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, top - (depth - bevel), 0);
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

/**
 * The tray: an oiled walnut board with a softly raised rim, and three matte
 * stoneware bowls standing on it. Tray floor at y = 0; the board extends
 * TRAY.height below. aKind: 0 = wood, 1..3 = bowl (Tomorrow, Later, Let go), 4 = lamp foot, 5 = contact shadow.
 */
export function createTrayGeometry(layout: DeskLayout): BufferGeometry {
  const w = layout.width / 2 - TRAY.bevel;
  const d = layout.depth / 2 - TRAY.bevel;
  const r = TRAY.corner - TRAY.bevel;
  const board = new Shape();
  roundedRect(board, w, d, r);
  const base = extrudeFlat(board, TRAY.height, TRAY.bevel, 0);
  const rimShape = new Shape();
  roundedRect(rimShape, w, d, r);
  const hole = new Path();
  roundedRect(hole, w - TRAY.rimWidth, d - TRAY.rimWidth, r - TRAY.rimWidth * 0.6, true);
  rimShape.holes.push(hole);
  const rim = extrudeFlat(rimShape, TRAY.rimHeight + 0.004, 0.004, TRAY.rimHeight);

  // Stoneware bowl, outer foot → wall → rolled lip → inner wall → floor (normals face out, then up, then in).
  const O = TRAY.bowlOuter;
  const I = TRAY.bowlInner;
  const H = TRAY.bowlHeight;
  const profile: Vector2[] = [
    // Short foot, then a tall straight front wall: the stamped name sits on a vertical face, facing you.
    new Vector2(O - 0.009, 0.0),
    new Vector2(O - 0.0045, 0.0012),
    new Vector2(O - 0.0014, 0.0042),
    new Vector2(O - 0.0003, 0.0078),
    new Vector2(O, 0.0105),
    new Vector2(O, 0.024),
    new Vector2(O, 0.04),
    new Vector2(O, H - 0.004),
  ];
  const lipC = (O + I) / 2;
  const lipR = (O - I) / 2;
  for (let i = 1; i < 8; i++) {
    const a = (i / 8) * Math.PI;
    profile.push(new Vector2(lipC + Math.cos(a) * lipR, H - 0.004 + Math.sin(a) * lipR));
  }
  // v8: near-straight inner wall, a tight fillet, then a flat floor (no cone).
  profile.push(new Vector2(I, H - 0.004));
  profile.push(new Vector2(I - 0.0006, 0.036));
  profile.push(new Vector2(I - 0.0012, TRAY.bowlFloor + 0.012));
  profile.push(new Vector2(I - 0.0032, TRAY.bowlFloor + 0.0045));
  profile.push(new Vector2(I - 0.0075, TRAY.bowlFloor + 0.0012));
  profile.push(new Vector2(I - 0.0125, TRAY.bowlFloor + 0.0002));
  profile.push(new Vector2(0.0001, TRAY.bowlFloor));
  // 22 Oct: the soft contact shadow on the real table is part of the tray (aKind 5), first in the buffer so the
  // board draws over it: one draw call less per eye. A ground quad 8 cm larger than the tray, 0.8 mm above the table.
  // 23 Oct: larger, so the lamp's warm light can spill onto the real table beyond the rim (same draw call).
  const contact = createGroundQuad(layout.width + 0.5, layout.depth + 0.4);
  contact.translate(0, -TRAY.height + 0.0008, 0);
  const parts: Array<{ geometry: BufferGeometry; kind: number }> = [
    { geometry: contact, kind: 5 },
    { geometry: base, kind: 0 },
    { geometry: rim, kind: 0 },
  ];
  layout.bins.forEach((bin, i) => {
    const bowl = new LatheGeometry(profile, 56);
    bowl.translate(bin.x, 0, bin.z);
    parts.push({ geometry: bowl, kind: i + 1 });
  });
  const foot = createLampFoot();
  foot.translate(layout.orb.x, 0, layout.orb.z);
  parts.push({ geometry: foot, kind: 4 });
  return mergeTagged(parts);
}

/** Small deterministic PRNG (mulberry32) for per-stone shape variation. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shape parameters of one pebble (all stones differ: size, oval, egg, tilt). */
export interface PebbleShape {
  /** Overall size factor (≈ 0.92–1.08). */
  size: number;
  /** Half extents before variation (metres). */
  rx: number;
  rz: number;
  height: number;
}

/**
 * A river pebble: soft squircle profile with a domed top, an organic
 * footprint (oval, one end fuller like an egg, a gentle lobe), thickness that
 * varies along its length, a slight tilt and low-frequency surface undulation.
 * Indexed, with a shared seam, so normals are smooth everywhere. The base
 * rests at y = -height/2 (the token's logical bottom). Bounding volumes are
 * inflated by `grabMargin` so the hand-grab test accepts a pinch ~2 cm away.
 * Returns the geometry and the size factor (the engraved label scales with it).
 */
export function createPebbleGeometry(rx: number, rz: number, height: number, grabMargin = 0.02, seed = 1, restY = -height / 2): { geometry: BufferGeometry; size: number } {
  const rnd = prng(seed * 7919 + 13);
  const size = 0.93 + rnd() * 0.15;
  const aspect = 0.92 + rnd() * 0.2; // >1: more oval
  const egg = (rnd() - 0.5) * 0.16;
  const lobeA = rnd() * Math.PI * 2;
  const lobe = 0.015 + rnd() * 0.03;
  const lobe3A = rnd() * Math.PI * 2;
  const lobe3 = rnd() * 0.022;
  const thick = (rnd() - 0.5) * 0.22; // one end thicker
  const tiltX = (rnd() - 0.5) * 0.05;
  const tiltZ = (rnd() - 0.5) * 0.04;
  const dome = 0.85 + rnd() * 0.3;
  const hScale = 0.88 + rnd() * 0.22;
  const n1 = rnd() * 10;
  const n2 = rnd() * 10;
  const RX = rx * size * Math.sqrt(aspect);
  const RZ = (rz * size) / Math.sqrt(aspect);
  const H = height * hScale * (0.95 + size * 0.05);
  const LAT = 22;
  const LON = 44;
  const p = 2.4;
  const positions: number[] = [];
  const vertex = (theta: number, phi: number) => {
    // theta 0 = top pole, PI = bottom pole.
    const c = Math.sin(theta);
    const sv = Math.cos(theta);
    const xr = Math.pow(Math.abs(c), 2 / p);
    let y = Math.sign(sv) * Math.pow(Math.abs(sv), 2 / p) * 0.5;
    y += y > 0 ? 0.16 * dome * (1 - xr * xr) : -0.05 * (1 - xr * xr);
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    const radial = 1 + egg * cp + lobe * Math.cos(2 * phi + lobeA) + lobe3 * Math.cos(3 * phi + lobe3A);
    let x = xr * radial * cp * RX;
    let z = xr * radial * sp * RZ;
    let yy = y * H * (1 + thick * cp * (y > 0 ? 1 : 0.4));
    // Low-frequency undulation (no two surfaces alike), strongest on the shoulders.
    const shoulder = xr * (1 - xr * 0.6);
    const und = (Math.sin(phi * 3 + n1) * Math.sin(theta * 2.5 + n2) + 0.5 * Math.sin(phi * 5 + n2 * 1.7)) * 0.0007 * shoulder;
    x += cp * und;
    z += sp * und;
    yy += und * 0.6 * Math.sign(y);
    // Tilt: the stone sits a little askew on its base.
    yy += x * tiltX + z * tiltZ;
    positions.push(x, yy, z);
  };
  vertex(0, 0);
  for (let i = 1; i < LAT; i++) {
    const theta = (i / LAT) * Math.PI;
    for (let j = 0; j < LON; j++) {
      vertex(theta, (j / LON) * Math.PI * 2);
    }
  }
  vertex(Math.PI, 0);
  const index: number[] = [];
  const ring = (i: number, j: number) => 1 + (i - 1) * LON + (j % LON);
  const bottom = 1 + (LAT - 1) * LON;
  for (let j = 0; j < LON; j++) {
    index.push(0, ring(1, j + 1), ring(1, j));
  }
  for (let i = 1; i < LAT - 1; i++) {
    for (let j = 0; j < LON; j++) {
      const a = ring(i, j);
      const b = ring(i, j + 1);
      const c = ring(i + 1, j);
      const d = ring(i + 1, j + 1);
      index.push(a, b, c, b, d, c);
    }
  }
  for (let j = 0; j < LON; j++) {
    index.push(bottom, ring(LAT - 1, j), ring(LAT - 1, j + 1));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(index);
  geometry.computeBoundingBox();
  // Centre the footprint and rest the base on the token's logical bottom.
  const box = geometry.boundingBox!;
  geometry.translate(-(box.min.x + box.max.x) / 2, restY - 0.0004 - box.min.y, -(box.min.z + box.max.z) / 2);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.boundingBox!.expandByScalar(grabMargin);
  geometry.boundingSphere!.radius += grabMargin;
  return { geometry, size };
}

/** The lamp: a turned stoneware foot holding an opal glass globe (desk-local, foot at y = 0). */
export const LAMP = {
  /**
   * v8 (owner): the lamp stays SMALL outside Breathe (it only grows into the moon there). A low stoneware
   * base and a 5 cm opal globe — still above the 4.4 cm minimum touch target.
   */
  footRadius: 0.026,
  footHeight: 0.016,
  globe: 0.025,
  /** Globe centre height above the tray floor: resting on the cup rim (0.72 × globe), 0.95 vertical squash. */
  globeY: 0.016 - 0.0006 + 0.95 * Math.sqrt(0.025 * 0.025 - (0.72 * 0.025) ** 2),
} as const;

/** Turned stoneware lamp foot (merged into the tray mesh: no extra draw call). */
function createLampFoot(): BufferGeometry {
  const R = LAMP.footRadius;
  const H = LAMP.footHeight;
  const profile = [
    new Vector2(R - 0.004, 0.0),
    new Vector2(R - 0.0012, 0.0008),
    new Vector2(R, 0.003),
    new Vector2(R - 0.0004, 0.008),
    new Vector2(R - 0.0016, 0.0135),
    new Vector2(R - 0.0034, H - 0.0018),
    new Vector2(R - 0.0055, H - 0.0002),
    new Vector2(R - 0.0075, H),
    // The cup the globe rests in (brass collar drawn by the shader).
    new Vector2(LAMP.globe * 0.72, H - 0.0006),
    new Vector2(LAMP.globe * 0.6, H - 0.004),
    new Vector2(0.0001, H - 0.006),
  ];
  return new LatheGeometry(profile, 40);
}

/** Opal glass globe, slightly flattened like hand-blown glass. */
export function createLampGlobeGeometry(): BufferGeometry {
  const g = new IcosahedronGeometry(LAMP.globe, 3);
  g.scale(1, 0.95, 1);
  g.computeBoundingSphere();
  return g;
}

export function createOrbGeometry(radius: number): BufferGeometry {
  return new IcosahedronGeometry(radius, 3);
}

export function createQuad(width: number, height: number): BufferGeometry {
  return new PlaneGeometry(width, height);
}

/** Horizontal quad (XZ plane, facing +Y). */
export function createGroundQuad(width: number, depth: number): BufferGeometry {
  const g = new PlaneGeometry(width, depth);
  g.rotateX(-Math.PI / 2);
  return g;
}
