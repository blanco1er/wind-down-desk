// KTX2 header check (no decoding): size, Basis format (ETC1S / UASTC), supercompression, levels, colour transfer, and
// the KTXwriter string (which encoder made it). Used to verify the HD place files before shipping (tools/encode-places-hd.sh).
//   node tools/ktx2-info.mjs <file.ktx2> [...]
import { readFileSync, statSync } from 'node:fs';
const SUPER = { 0: 'none', 1: 'BasisLZ (ETC1S)', 2: 'zstd', 3: 'zlib' };
for (const f of process.argv.slice(2)) {
  const b = readFileSync(f);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const magic = b.subarray(0, 12).toString('latin1');
  if (!magic.startsWith('«KTX 20»')) {
    console.log(JSON.stringify({ file: f, error: 'not KTX2' }));
    continue;
  }
  const u32 = (o) => v.getUint32(o, true);
  const width = u32(20), height = u32(24), levels = u32(40), scheme = u32(44);
  const dfdOff = u32(48), kvdOff = u32(56), kvdLen = u32(60);
  // DFD: colorModel byte at dfd+12 (KHR_DF_MODEL: 163 = ETC1S, 166 = UASTC), transfer at dfd+14 (2 = sRGB).
  const colorModel = b[dfdOff + 12];
  const transfer = b[dfdOff + 14];
  const kv = {};
  for (let o = kvdOff; o < kvdOff + kvdLen; ) {
    const len = u32(o);
    const pair = b.subarray(o + 4, o + 4 + len);
    const z = pair.indexOf(0);
    kv[pair.subarray(0, z).toString('utf8')] = pair.subarray(z + 1).toString('utf8').replace(/\0+$/u, '');
    o += 4 + len + ((4 - (len % 4)) % 4);
  }
  console.log(JSON.stringify({
    file: f.split('/').pop(),
    bytes: statSync(f).size,
    width,
    height,
    mpx: +((width * height) / 1e6).toFixed(2),
    basis: colorModel === 163 ? 'ETC1S' : colorModel === 166 ? 'UASTC' : `model ${colorModel}`,
    supercompression: SUPER[scheme] ?? scheme,
    levels: levels || 1,
    srgb: transfer === 2,
    blockAligned: width % 4 === 0 && height % 4 === 0,
    writer: kv.KTXwriter ?? null,
  }));
}
