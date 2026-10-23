/**
 * Place previews for the lamp's globe (26 Oct, "the lamp shows the places").
 *
 * The globe is a 14–16 cm lens at arm's length: ≈ 15° of your view showing ≈ 110° of a place, so it needs ≈ 4 px per
 * degree of panorama — and mipmaps, or the place shimmers as you move. The 6k / 8k panoramas have no mipmaps (they
 * are magnified on the backdrop), so the globe reads the place's 2k JPG (already shipped as the KTX2 fallback),
 * decoded off the main thread by createImageBitmap at 1024 × 512 (2.7 MiB with mipmaps). At most 3 are kept (the
 * shown place and its two neighbours in the carousel); one read per pixel, no second render of the scene.
 */
import { LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, ClampToEdgeWrapping, Texture } from '@iwsdk/core';
import { PLACES, type PlaceId } from '../logic/places.ts';

const KEEP = 3;

/** Mean linear luminance of an image, from a 64 × 32 copy (≈ 0.1 ms). 0.1 if the canvas is unavailable. */
function meanLuminance(bitmap: ImageBitmap): number {
  try {
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(64, 32) : null;
    const ctx = canvas?.getContext('2d');
    if (ctx == null) return 0.1;
    ctx.drawImage(bitmap, 0, 0, 64, 32);
    const d = ctx.getImageData(0, 0, 64, 32).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lin = (c: number): number => Math.pow(c / 255, 2.2);
      sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    }
    return sum / (64 * 32);
  } catch {
    return 0.1;
  }
}

export class PlacePreviews {
  private readonly textures = new Map<PlaceId, Texture>();
  /** Mean linear luminance of each preview (64 × 32 average), to show bright and dark places equally readable. */
  private readonly means = new Map<PlaceId, number>();
  private readonly loading = new Map<PlaceId, Promise<Texture | null>>();
  private readonly order: PlaceId[] = [];
  /** The places wanted NOW (the latest call wins: a slow decode never evicts what the globe shows since). */
  private wanted: readonly PlaceId[] = [];

  /** The preview if it is already decoded (null otherwise: the globe stays opal until it is). */
  get(id: PlaceId): Texture | null {
    return this.textures.get(id) ?? null;
  }

  /** Mean linear luminance of the place's preview (0..1), or null before it is decoded. */
  mean(id: PlaceId): number | null {
    return this.means.get(id) ?? null;
  }

  /** Decodes a place's preview (once); `keep` lists the places to keep, the others are released. */
  load(id: PlaceId, keep: readonly PlaceId[] = []): Promise<Texture | null> {
    this.wanted = keep.includes(id) ? keep : [id, ...keep];
    const have = this.textures.get(id);
    if (have != null) return Promise.resolve(have);
    const pending = this.loading.get(id);
    if (pending != null) return pending;
    const url = PLACES[id].fallback;
    if (url == null || typeof createImageBitmap !== 'function') return Promise.resolve(null);
    const promise = (async (): Promise<Texture | null> => {
      try {
        const blob = await (await fetch(url)).blob();
        const bitmap = await createImageBitmap(blob, { resizeWidth: 1024, resizeHeight: 512, resizeQuality: 'high' });
        this.means.set(id, meanLuminance(bitmap));
        const texture = new Texture(bitmap as unknown as HTMLImageElement);
        texture.colorSpace = NoColorSpace;
        texture.flipY = false;
        texture.wrapS = RepeatWrapping;
        texture.wrapT = ClampToEdgeWrapping;
        texture.generateMipmaps = true;
        texture.minFilter = LinearMipmapLinearFilter;
        texture.magFilter = LinearFilter;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        this.textures.set(id, texture);
        this.order.push(id);
        this.trim();
        return texture;
      } catch {
        return null;
      } finally {
        this.loading.delete(id);
      }
    })();
    this.loading.set(id, promise);
    return promise;
  }

  private trim(): void {
    while (this.order.length > KEEP) {
      const i = this.order.findIndex((id) => !this.wanted.includes(id));
      if (i < 0) return;
      const [old] = this.order.splice(i, 1);
      this.textures.get(old)?.dispose();
      this.textures.delete(old);
      this.means.delete(old);
    }
  }

  /** Everything released (the menu closed for good, or the evening ends). */
  clear(): void {
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.order.length = 0;
  }

  get count(): number {
    return this.textures.size;
  }
}
