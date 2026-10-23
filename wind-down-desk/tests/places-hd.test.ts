import { existsSync, readFileSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hdSupport, PLACES, PLACE_IDS } from '../src/logic/places.ts';

const file = (url: string): URL => new URL(`../public/${url.replace(/^\.\//u, '')}`, import.meta.url);

/** Width, height and Basis model (163 ETC1S, 166 UASTC) read from a KTX2 header. */
function header(url: URL): { w: number; h: number; model: number; levels: number } {
  const b = readFileSync(url);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const dfd = v.getUint32(48, true);
  return { w: v.getUint32(20, true), h: v.getUint32(24, true), model: b[dfd + 12], levels: v.getUint32(40, true) || 1 };
}

test('HD places: 8 places have an 8k UASTC panorama, the desert stays 6k (owner to choose), every place keeps its 6k fallback', () => {
  const hd = PLACE_IDS.filter((id) => PLACES[id].photoHd != null);
  assert.equal(hd.length, 8);
  assert.equal(PLACES['desert-stars'].photoHd, undefined);
  for (const id of hd) {
    const p = PLACES[id];
    const url = file(p.photoHd as string);
    assert.ok(existsSync(url), `${id}: ${p.photoHd}`);
    const h = header(url);
    assert.deepEqual([h.w, h.h, h.model, h.levels], [8192, 2732, 166, 1], `${id}: 8192 × 2732 UASTC, no mipmaps`);
    assert.ok(statSync(url).size < 11e6, `${id}: under 11 MB to download`);
    // The 6k ETC1S is still the fast path (chosen before the 8k is ready) and the fallback.
    const six = header(file(p.photo as string));
    assert.deepEqual([six.w, six.h, six.model], [6144, 2048, 163], `${id}: 6k ETC1S kept`);
  }
});

test('HD places: only on a GPU that takes 8192-wide compressed textures, never decoded uncompressed', () => {
  const has = (list: string[]) => (e: string) => list.includes(e);
  assert.equal(hdSupport(16384, has(['WEBGL_compressed_texture_astc'])).ok, true);
  assert.equal(hdSupport(8192, has(['EXT_texture_compression_bptc'])).ok, true);
  assert.equal(hdSupport(8192, has(['WEBGL_compressed_texture_etc'])).ok, true);
  assert.equal(hdSupport(4096, has(['WEBGL_compressed_texture_astc'])).ok, false, 'MAX_TEXTURE_SIZE 4096 → 6k');
  assert.equal(hdSupport(16384, has([])).ok, false, 'no compressed target → 6k (89 MB raw otherwise)');
});
