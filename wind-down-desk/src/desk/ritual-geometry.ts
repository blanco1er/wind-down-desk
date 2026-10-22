/**
 * v6 rituals: procedural geometry (built once, shared). Triangle counts stay small:
 * black bowl ≈ 5.6 k, water ≈ 0.1 k, twelve pearls ≈ 2.2 k, palm glow 4, moon globe ≈ 4.5 k (only while breathing).
 */
import { BufferAttribute, BufferGeometry, CircleGeometry, IcosahedronGeometry, LatheGeometry, Vector2 } from '@iwsdk/core';
import { WATER_BOWL } from '../logic/release.ts';
import { MAX_PEARLS } from './ritual-materials.ts';

/** Round polished bowl: short foot, softly rounded wall, rolled lip, inner wall down to the floor (bowl-local, foot at y = 0). */
export function createBlackBowlGeometry(): BufferGeometry {
  const O = WATER_BOWL.outer;
  const I = WATER_BOWL.inner;
  const H = WATER_BOWL.height;
  const profile: Vector2[] = [
    // v8: a straight-walled bowl with a tight foot and a thin, flat, softly eased lip (no rolled "tyre").
    new Vector2(O - 0.01, 0.0),
    new Vector2(O - 0.004, 0.0018),
    new Vector2(O - 0.001, 0.0065),
    new Vector2(O, 0.013),
    new Vector2(O, H - 0.003),
    new Vector2(O - 0.0008, H - 0.0008),
    new Vector2(O - 0.0025, H),
    new Vector2(I + 0.0025, H),
    new Vector2(I + 0.0008, H - 0.0008),
  ];
  profile.push(new Vector2(I, H - 0.003));
  profile.push(new Vector2(I - 0.0015, 0.028));
  profile.push(new Vector2(I - 0.006, 0.016));
  profile.push(new Vector2(I - 0.018, WATER_BOWL.floor + 0.002));
  profile.push(new Vector2(0.0001, WATER_BOWL.floor));
  const g = new LatheGeometry(profile, 72);
  g.computeVertexNormals();
  return g;
}

/** Water surface disc (bowl-local, at y = 0; the mesh is placed at the water height). */
export function createWaterGeometry(): BufferGeometry {
  const g = new CircleGeometry(WATER_BOWL.inner - 0.0008, 96);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Twelve unit spheres tagged with their index (the shader lays them out in a row). */
export function createPearlsGeometry(): BufferGeometry {
  const sphere = new IcosahedronGeometry(1, 2).toNonIndexed();
  const pos = sphere.getAttribute('position');
  const nor = sphere.getAttribute('normal');
  const n = pos.count;
  const position = new Float32Array(n * 3 * MAX_PEARLS);
  const normal = new Float32Array(n * 3 * MAX_PEARLS);
  const idx = new Float32Array(n * MAX_PEARLS);
  for (let k = 0; k < MAX_PEARLS; k++) {
    for (let i = 0; i < n; i++) {
      const o = (k * n + i) * 3;
      position[o] = pos.getX(i);
      position[o + 1] = pos.getY(i);
      position[o + 2] = pos.getZ(i);
      normal[o] = nor.getX(i);
      normal[o + 1] = nor.getY(i);
      normal[o + 2] = nor.getZ(i);
      idx[k * n + i] = k;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('normal', new BufferAttribute(normal, 3));
  g.setAttribute('aIdx', new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.boundingSphere!.radius = 0.4;
  return g;
}

/** Two quads (one per hand), placed and billboarded by the shader. */
export function createPalmGlowGeometry(): BufferGeometry {
  const position = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
  const pos = new Float32Array(24);
  const hand = new Float32Array(8);
  for (let h = 0; h < 2; h++) {
    pos.set(position, h * 12);
    hand.fill(h, h * 4, h * 4 + 4);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aHand', new BufferAttribute(hand, 1));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}

/** High-detail opal globe used while the lamp is the (large) breathing moon. */
export function createMoonGeometry(radius: number): BufferGeometry {
  const g = new IcosahedronGeometry(radius, 14);
  g.scale(1, 0.97, 1);
  g.computeBoundingSphere();
  return g;
}
