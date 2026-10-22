// Encodes the Places panoramas (tools/make-places.py output) to KTX2 / Basis Universal.
// No system install: ktx2-encoder (MIT, BinomialLLC basis_universal compiled to wasm), sharp to decode.
//   node tools/encode-places.mjs <in.png> <out.ktx2> [etc1s|uastc] [quality 1–255]
// ETC1S → transcoded to ETC2 RGB on Quest (4 bits/px: 8192 × 2048 = 8 MiB of GPU memory),
// UASTC → ASTC 4×4 (8 bits/px). No mipmaps: the panorama is magnified or ~1:1 on screen,
// and the equirectangular u wrap would draw a seam through a mip chain.
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';

const [input, output, mode = 'etc1s', quality = '255'] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node tools/encode-places.mjs <in.png> <out.ktx2> [etc1s|uastc] [quality]');
  process.exit(1);
}
const imageDecoder = async (buffer) => {
  const { data, info } = await sharp(buffer, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};
const t0 = Date.now();
const uastc = mode === 'uastc';
const ktx2 = await encodeToKTX2(new Uint8Array(readFileSync(input)), {
  isUASTC: uastc,
  qualityLevel: Number(quality),
  compressionLevel: 3,
  needSupercompression: uastc,
  enableRDO: uastc,
  rdoQualityLevel: 1.5,
  uastcLDRQualityLevel: 2,
  isPerceptual: true,
  isSetKTX2SRGBTransferFunc: true,
  generateMipmap: false,
  isKTX2File: true,
  imageDecoder,
});
writeFileSync(output, ktx2);
console.log(JSON.stringify({ output, mode, bytes: ktx2.byteLength, seconds: (Date.now() - t0) / 1000 }));
