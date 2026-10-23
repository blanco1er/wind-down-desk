// Board of the in-app before / after (tools/places/hd-shots.mjs): one row per place, 6k ETC1S | 8k UASTC, the same
// centre crop at 1:1 (≈ 24 px/°, the headset's density), brightness ×2 for reading only.
//   node tools/places/hd-board.mjs moon-lake,moon-beach,... [out.jpg]
import sharp from 'sharp';
const places = (process.argv[2] ?? 'moon-lake,moon-beach,ember-fire,northern-lights').split(',');
const out = process.argv[3] ?? 'artifacts/places-hd/in-app-before-after.jpg';
const W = 620, H = 300, GAP = 8, HEAD = 34;
const parts = [];
let y = 0;
for (const id of places) {
  for (const [i, pass] of ['6k', 'hd'].entries()) {
    const src = sharp(`artifacts/places-hd/raw/${id}-${pass}.png`);
    const m = await src.metadata();
    const crop = await sharp(`artifacts/places-hd/raw/${id}-${pass}.png`)
      .extract({ left: Math.round((m.width - W) / 2), top: Math.round((m.height - H) / 2) - 60, width: W, height: H })
      .linear(2, 0)
      .png()
      .toBuffer();
    const label = `${id} · ${pass === 'hd' ? '8k UASTC (DAT2)' : '6k ETC1S (before)'}`;
    const svg = Buffer.from(`<svg width="${W}" height="${HEAD}"><text x="4" y="23" font-family="Helvetica" font-size="17" fill="#eee">${label}</text></svg>`);
    parts.push({ input: svg, left: i * (W + GAP), top: y }, { input: crop, left: i * (W + GAP), top: y + HEAD });
  }
  y += HEAD + H + GAP;
}
await sharp({ create: { width: 2 * W + GAP, height: y, channels: 3, background: '#111' } }).composite(parts).jpeg({ quality: 90 }).toFile(out);
console.log(out);
