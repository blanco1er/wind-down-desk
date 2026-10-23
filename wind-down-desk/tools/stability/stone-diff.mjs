// Pixel difference between the batch ON and OFF captures (tools/stability/stone-parity.mjs): mean and max per
// channel over the whole frame, the share of pixels that differ by more than 2 levels, and a ×8 difference image.
//   node tools/stability/stone-diff.mjs [dir]            the four stone looks, on / off
//   node tools/stability/stone-diff.mjs dir name-a name-b  any two captures (e.g. strays-shown strays-hidden)
import sharp from 'sharp';
const dir = process.argv[2] ?? 'artifacts/stones';
const pairs = process.argv[4] != null ? [[process.argv[3], process.argv[4], `${process.argv[3]}-vs-${process.argv[4]}`]] : ['engraved', 'dissolving', 'done', 'basalt'].map((l) => [`${l}-on`, `${l}-off`, l]);
for (const [na, nb, look] of pairs) {
  const a = await sharp(`${dir}/${na}.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(`${dir}/${nb}.png`).removeAlpha().raw().toBuffer();
  let sum = 0, max = 0, over = 0;
  const diff = Buffer.alloc(a.data.length);
  for (let i = 0; i < a.data.length; i += 3) {
    let px = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c] - b[i + c]);
      sum += d;
      if (d > max) max = d;
      if (d > px) px = d;
      diff[i + c] = Math.min(255, d * 8);
    }
    if (px > 2) over++;
  }
  const n = a.data.length / 3;
  await sharp(diff, { raw: { width: a.info.width, height: a.info.height, channels: 3 } }).png().toFile(`${dir}/${look}-diff-x8.png`);
  console.log(JSON.stringify({ look, meanAbs: +(sum / a.data.length).toFixed(4), maxAbs: max, pixelsOver2: over, share: +((100 * over) / n).toFixed(4) }));
}
