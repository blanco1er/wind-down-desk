// Instanced stones (26 Oct): one draw call for every stone and the Release weight. The shader is the stone shader
// rewritten (per-stone uniforms → per-instance data), the pebbles share one topology, and the batch copies exactly
// the visible stones each frame.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Group, Matrix4, Mesh, Scene, Texture, Vector2 } from '@iwsdk/core';
import { createPebbleGeometry } from '../src/desk/geometry.ts';
import { createStoneMaterial } from '../src/desk/materials.ts';
import { HIDDEN_LAYER, instancedStoneShaders, PER_STONE, StoneBatch } from '../src/desk/stone-batch.ts';

const shapes = () => [
  ...[1, 2, 3, 4, 5, 6, 7].map((seed) => createPebbleGeometry(0.045 * 1.08, 0.045 * 0.9, 0.012 * 1.5, 0.02, seed, -0.006).geometry),
  createPebbleGeometry(0.06, 0.042, 0.026, 0.025, 11, -0.013).geometry,
];
const material = () => createStoneMaterial(new Texture(), new Vector2(1024, 1024));

test('every per-stone uniform of the stone shader becomes per-instance data', () => {
  const src = readFileSync(new URL('../src/desk/materials.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export interface StoneUniforms {'));
  const names = [...body.slice(0, body.indexOf('\n}')).matchAll(/^\s+(u[A-Z]\w*):/gmu)].map((m) => m[1]);
  assert.deepEqual([...names].sort(), [...PER_STONE].sort(), 'StoneUniforms and the instanced mapping list the same uniforms');
});

test('the instanced shader is the stone shader rewritten, with no per-stone uniform left', () => {
  const m = material();
  const s = instancedStoneShaders(m.vertexShader, m.fragmentShader);
  assert.ok(s != null, 'the rewrite applies to the current stone shader');
  for (const name of PER_STONE) {
    assert.ok(!new RegExp(`uniform\\s+\\w+\\s+${name};`, 'u').test(s.vertexShader + s.fragmentShader), `${name} is no longer a uniform`);
    assert.ok(new RegExp(`#define ${name} `, 'u').test(s.fragmentShader), `${name} is defined in the fragment shader`);
  }
  assert.match(s.vertexShader, /texelFetch\(uShapes, ivec2\(gl_VertexID/u);
  assert.match(s.vertexShader, /sModel = modelMatrix \* instanceMatrix/u);
  assert.match(s.fragmentShader, /textureGrad\(uMap/u, 'the engraving is sampled with explicit gradients (same mip on and off)');
  assert.doesNotMatch(s.fragmentShader, /texture2D\(uMap/u);
  // Any uniform still declared is one the batch material provides.
  const batch = new StoneBatch(shapes(), m);
  const mat = batch.mesh.material as unknown as { uniforms: Record<string, unknown> };
  for (const [, name] of (s.vertexShader + s.fragmentShader).matchAll(/uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+(\w+)\s*;/gu)) {
    assert.ok(name in mat.uniforms, `${name} has a value in the batch material`);
  }
});

test('all pebble shapes and the Release weight share one topology (one instanced mesh draws them all)', () => {
  const batch = new StoneBatch(shapes(), material());
  for (const g of shapes()) assert.equal(g.getAttribute('position').count, 926);
  const own = shapes();
  const b2 = new StoneBatch(own, material());
  for (const g of own) assert.equal(b2.add(new Mesh(g), material().uniforms), true);
  assert.equal(b2.size, own.length);
  // A shape with another topology is not batched: that stone keeps drawing itself.
  const other = createPebbleGeometry(0.05, 0.04, 0.02, 0.02, 3, -0.01).geometry.toNonIndexed();
  const proxy = new Mesh(other);
  assert.equal(batch.add(proxy, material().uniforms), false);
  assert.equal(proxy.layers.mask, 1);
});

test('the batch draws exactly the visible stones, with their own look, and A/B restores the old path', () => {
  const own = shapes();
  const batch = new StoneBatch(own, material());
  const scene = new Scene();
  batch.attach(scene);
  const desk = new Group();
  scene.add(desk);
  const stones = [0, 1, 2, 7].map((i) => {
    const m = material();
    const mesh = new Mesh(own[i], m);
    mesh.position.set(i * 0.1, 0.7, -0.4);
    desk.add(mesh);
    assert.ok(batch.add(mesh, m.uniforms));
    return { mesh, u: m.uniforms };
  });
  for (const s of stones) assert.equal(s.mesh.layers.mask, 1 << HIDDEN_LAYER, 'cameras never draw the proxy itself');
  stones[1].u.uGlow.value = 1;
  stones[2].u.uDissolve.value = 0.5;
  scene.updateMatrixWorld(true);
  scene.onBeforeRender(null as never, scene, null as never, null as never, null as never, null as never);
  assert.equal(batch.drawn, 4);
  assert.equal(batch.mesh.count, 4);
  assert.equal(batch.mesh.visible, true);
  const a = batch.mesh.geometry.getAttribute('iA');
  assert.equal(a.getX(1), 1, 'glow of the second stone');
  assert.equal(a.getY(2), 0.5, 'dissolve of the third stone');
  assert.equal(batch.mesh.geometry.getAttribute('iShape').getX(3), 7, 'the weight uses its own shape');
  const m = new Matrix4();
  batch.mesh.getMatrixAt(0, m);
  // Instance matrices are float32 on the GPU: equal to the stone's world matrix within float precision.
  m.elements.forEach((e, i) => assert.ok(Math.abs(e - stones[0].mesh.matrixWorld.elements[i]) < 1e-6, 'world matrix copied'));
  // Hidden (or under a hidden parent) and disposed stones are not drawn.
  stones[0].mesh.visible = false;
  desk.remove(stones[3].mesh);
  batch.remove(stones[2].mesh);
  batch.sync();
  assert.equal(batch.drawn, 1);
  desk.visible = false;
  batch.sync();
  assert.equal(batch.drawn, 0);
  assert.equal(batch.mesh.visible, false);
  // A/B: off, each stone draws itself again.
  batch.setEnabled(false);
  assert.equal(stones[1].mesh.layers.mask, 1);
  desk.visible = true;
  batch.sync();
  assert.equal(batch.mesh.count, 0);
  batch.setEnabled(true);
  assert.equal(stones[1].mesh.layers.mask, 1 << HIDDEN_LAYER);
});
