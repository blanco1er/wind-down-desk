/**
 * One shared KTX2 / Basis loader (one transcoder worker) for the tray's oak and the Places panoramas.
 * The transcoder ships in public/basis (no CDN). Textures keep raw values (NoColorSpace): every shader
 * decodes sRGB itself, so the GPU format stays linear and identical on Quest and in the emulator.
 */
import { NoColorSpace, type Texture, type WebGLRenderer } from '@iwsdk/core';
// Already in the main bundle through IWSDK's glTF loader (no extra bytes); the transcoder is fetched on first use.
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

interface Ktx2 {
  setTranscoderPath(path: string): Ktx2;
  setWorkerLimit(n: number): Ktx2;
  detectSupport(renderer: WebGLRenderer): Ktx2;
  loadAsync(url: string): Promise<Texture>;
}

let shared: Ktx2 | null = null;

export function ktx2Loader(renderer: WebGLRenderer): Ktx2 | null {
  if (shared == null) {
    try {
      shared = (new KTX2Loader() as unknown as Ktx2).setTranscoderPath('./basis/').setWorkerLimit(1).detectSupport(renderer);
    } catch {
      return null;
    }
  }
  return shared;
}

/** Loads a KTX2 texture (raw values), or null on any failure (the caller keeps its fallback). */
export async function loadKtx2(renderer: WebGLRenderer | null, url: string): Promise<Texture | null> {
  if (renderer == null) return null;
  const loader = ktx2Loader(renderer);
  if (loader == null) return null;
  try {
    const texture = await loader.loadAsync(url);
    texture.colorSpace = NoColorSpace;
    return texture;
  } catch {
    return null;
  }
}

/** GPU bytes of a compressed texture (all mip levels). */
export function ktx2Bytes(texture: Texture): number {
  const levels = (texture as Texture & { mipmaps?: Array<{ data: ArrayBufferView }> }).mipmaps ?? [];
  return levels.reduce((n, l) => n + l.data.byteLength, 0);
}
