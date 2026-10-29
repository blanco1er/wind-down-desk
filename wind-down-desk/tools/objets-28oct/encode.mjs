// Tripo objects → app files (28 Oct 2026): KTX2 textures (shared basis transcoder, raw values: shaders decode sRGB)
// and the prepared GLBs. node tools/objets-28oct/encode.mjs <assets-tripo dir>
import { copyFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';

const A = process.argv[2];
const decoder = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};
const colour = (png) => encodeToKTX2(new Uint8Array(png), {
  isUASTC: false, qualityLevel: 230, compressionLevel: 3, isPerceptual: true, isSetKTX2SRGBTransferFunc: false,
  generateMipmap: true, isKTX2File: true, imageDecoder: decoder,
});
const data = (png) => encodeToKTX2(new Uint8Array(png), {
  isUASTC: true, qualityLevel: 255, needSupercompression: true, enableRDO: true, rdoQualityLevel: 1.5, uastcLDRQualityLevel: 2,
  isPerceptual: false, isSetKTX2SRGBTransferFunc: false, generateMipmap: true, isKTX2File: true, imageDecoder: decoder,
});
mkdirSync('public/models', { recursive: true });
const jobs = [
  ['souvenirs/cuit/keepsakes-albedo.png', 'public/textures/keepsakes-albedo.ktx2', colour],
  ['souvenirs/cuit/keepsakes-nrm-rough.png', 'public/textures/keepsakes-nrm-rough.ktx2', data],
  ['socle-lampe/cuit/lamp-foot-albedo.png', 'public/textures/lamp-foot-albedo.ktx2', colour],
  ['socle-lampe/cuit/lamp-foot-nrm-rough-metal.png', 'public/textures/lamp-foot-nrm-rough-metal.ktx2', data],
];
for (const [src, dst, enc] of jobs) {
  const png = await sharp(join(A, src)).png().toBuffer();
  writeFileSync(dst, await enc(png));
  console.log(dst, Math.round(statSync(dst).size / 1024), 'KB');
}
for (const [src, dst] of [['souvenirs/cuit/keepsakes.glb', 'public/models/keepsakes.glb'], ['socle-lampe/cuit/lamp-foot.glb', 'public/models/lamp-foot.glb']]) {
  copyFileSync(join(A, src), dst);
  console.log(dst, Math.round(statSync(dst).size / 1024), 'KB');
}
