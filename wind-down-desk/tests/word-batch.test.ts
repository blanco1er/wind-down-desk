// 29 Oct (draw budget): the word chips are drawn by one instanced draw. Its shader is the card shader rewritten
// (opacity and hover per instance, the UV rectangle of the chip's atlas row), so the chips look exactly the same
// (checked in the emulator: tools/solidite-29oct/probe-words.mjs, PSNR 44 dB, words identical) for 6 draws less.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Texture } from '@iwsdk/core';
import { createCardMaterial } from '../src/desk/materials.ts';
import { instancedCardShaders } from '../src/desk/word-batch-shader.ts';

test('the card shader rewrites to an instanced one: no per-chip uniform left, the same maths', () => {
  const m = createCardMaterial(new Texture());
  const s = instancedCardShaders(m.vertexShader, m.fragmentShader);
  assert.ok(s != null, 'the rewrite applies to the current card shader');
  assert.doesNotMatch(s.fragmentShader, /uniform float uOpacity;/u);
  assert.doesNotMatch(s.fragmentShader, /uniform float uHighlight;/u);
  assert.match(s.fragmentShader, /#define uOpacity vFade\.x/u);
  assert.match(s.fragmentShader, /#define uHighlight vFade\.y/u);
  assert.match(s.vertexShader, /attribute vec4 iRect;/u);
  assert.match(s.vertexShader, /vUv = mix\(iRect\.xy, iRect\.zw, uv\);/u);
  assert.match(s.vertexShader, /mat4 iModel = modelMatrix \* instanceMatrix;/u);
  assert.doesNotMatch(s.vertexShader.slice(s.vertexShader.indexOf('iModel =') + 30), /\bmodelMatrix\b/u, 'every model transform goes through the instance');
  // The rest of the fragment (sheen, hover, high contrast) is untouched.
  const tail = (src: string) => src.slice(src.indexOf('void main() {'));
  assert.equal(tail(s.fragmentShader), tail(m.fragmentShader));
  assert.match(s.fragmentShader, /uniform float uContrast;/u, 'high contrast stays shared');
});

test('a card shader that changed shape is not rewritten (the chips then draw themselves)', () => {
  assert.equal(instancedCardShaders('void main() { gl_Position = vec4(0.0); }', 'void main() {}'), null);
  const m = createCardMaterial(new Texture());
  assert.equal(instancedCardShaders(m.vertexShader, m.fragmentShader.replace('uniform float uHighlight;', '')), null);
});
