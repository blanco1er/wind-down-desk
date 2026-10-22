// Real oak for the tray: a crop of Poly Haven "Oak Veneer 01" (CC0, Jenelle van Heerden; 4K scan of 1.83 × 1.83 m),
// → public/textures/oak-albedo.ktx2  (ETC1S, mipmapped; raw sRGB values, the shader linearises)
// → public/textures/oak-nrm-rough.ktx2 (512 × 1024, UASTC + zstd, mipmapped; R,G = OpenGL normal x,y, B = roughness)
// → public/textures/oak-preview.jpg (512 × 256: shown until the KTX2 pair is ready, and the fallback).
// The crop is 1024 × 2048 px of the 4K scan = 0.457 × 0.915 m at 22 px/cm: the whole tray top without any tiling.
// The grain runs along the image's vertical axis; the shader maps v → the tray's length.
//   node tools/make-oak.mjs <folder with oak_veneer_01_{diff,nor_gl,rough}_4k.jpg>
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';

const src = process.argv[2];
const crop = { left: 1000, top: 1024, width: 1024, height: 2048 };
const raw = async (file) => {
  const { data, info } = await sharp(join(src, file), { limitInputPixels: false }).extract(crop).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
};
const diff = await raw('oak_veneer_01_diff_4k.jpg');
const nor = await raw('oak_veneer_01_nor_gl_4k.jpg');
const rough = await raw('oak_veneer_01_rough_4k.jpg');
const W = crop.width, H = crop.height;
const packed = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  packed[i * 4] = nor.data[i * 3];
  packed[i * 4 + 1] = nor.data[i * 3 + 1];
  packed[i * 4 + 2] = rough.data[i * 3];
  packed[i * 4 + 3] = 255;
}
const albedoPng = await sharp(diff.data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
// Normal + roughness at half resolution (11 px/cm): pores stay visible, 0.7 MB of GPU memory with mips.
const packedPng = await sharp(packed, { raw: { width: W, height: H, channels: 4 } }).resize(W / 2, H / 2, { kernel: 'lanczos3' }).png().toBuffer();
const decoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};
const out = 'public/textures';
const t0 = Date.now();
const albedo = await encodeToKTX2(new Uint8Array(albedoPng), {
  isUASTC: false, qualityLevel: 230, compressionLevel: 3, isPerceptual: true, isSetKTX2SRGBTransferFunc: false,
  generateMipmap: true, isKTX2File: true, imageDecoder: decoder,
});
writeFileSync(join(out, 'oak-albedo.ktx2'), albedo);
const nrm = await encodeToKTX2(new Uint8Array(packedPng), {
  isUASTC: true, qualityLevel: 255, needSupercompression: true, enableRDO: true, rdoQualityLevel: 1.5, uastcLDRQualityLevel: 2,
  isPerceptual: false, isSetKTX2SRGBTransferFunc: false, generateMipmap: true, isKTX2File: true, imageDecoder: decoder,
});
writeFileSync(join(out, 'oak-nrm-rough.ktx2'), nrm);
await sharp(diff.data, { raw: { width: W, height: H, channels: 3 } }).resize(256, 512).jpeg({ quality: 82 }).toFile(join(out, 'oak-preview.jpg'));
console.log(JSON.stringify({ albedo: albedo.byteLength, nrm: nrm.byteLength, seconds: (Date.now() - t0) / 1000 }));
