// Decodes a Basis KTX2 (our place panoramas) to a PNG, with the Basis transcoder already shipped in public/basis
// (Apache-2.0). Used by tools/repair-places.mjs to repair seams on the full-resolution image.
//   node tools/ktx2-decode.cjs <in.ktx2> <out.png>
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
// The package is an ES module: the shipped CommonJS transcoder is evaluated as CommonJS explicitly.
const basisFile = path.join(__dirname, '../public/basis/basis_transcoder.js');
const basisModule = { exports: {} };
new Function('module', 'exports', 'require', '__filename', '__dirname', fs.readFileSync(basisFile, 'utf8'))(basisModule, basisModule.exports, require, basisFile, path.dirname(basisFile));
const BASIS = basisModule.exports;

async function main() {
  const [input, output] = process.argv.slice(2);
  const wasmBinary = fs.readFileSync(path.join(__dirname, '../public/basis/basis_transcoder.wasm'));
  const basis = await BASIS({ wasmBinary });
  basis.initializeBasis();
  const file = new basis.KTX2File(new Uint8Array(fs.readFileSync(input)));
  if (!file.isValid()) throw new Error('invalid KTX2');
  const width = file.getWidth();
  const height = file.getHeight();
  if (!file.startTranscoding()) throw new Error('startTranscoding failed');
  const RGBA32 = 13;
  const size = file.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32);
  const dst = new Uint8Array(size);
  if (!file.transcodeImage(dst, 0, 0, 0, RGBA32, 0, -1, -1)) throw new Error('transcodeImage failed');
  file.close();
  file.delete();
  await sharp(Buffer.from(dst), { raw: { width, height, channels: 4 } }).removeAlpha().png().toFile(output);
  console.log(JSON.stringify({ input, output, width, height }));
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
