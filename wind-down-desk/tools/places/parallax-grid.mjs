// 2×2 board of the parallax shots: rows = projection on / off, columns = head at rest / moved. Labels drawn in SVG.
//   node tools/places/parallax-grid.mjs <place> [dir]   (shots in <dir>/raw, board written to <dir>)
import sharp from 'sharp';
const [place, dir = 'artifacts/parallax'] = process.argv.slice(2);
const W = 640, H = 360;
const cells = [['on', 'mid'], ['on', 'side'], ['off', 'mid'], ['off', 'side']];
const parts = await Promise.all(
  cells.map(async ([p, t], i) => {
    const label = `${p === 'on' ? 'ground projected' : 'photo at infinity'} · head ${t === 'mid' ? 'at rest' : 'moved 20 cm'}`;
    const svg = Buffer.from(`<svg width="${W}" height="${H}"><rect x="8" y="8" width="${label.length * 8.6 + 16}" height="28" rx="6" fill="rgba(0,0,0,0.6)"/><text x="16" y="28" font-family="Helvetica" font-size="16" fill="#fff">${label}</text></svg>`);
    const img = await sharp(`${dir}/raw/${place}-${p}-${t}.jpg`).resize(W, H).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
    return { input: img, left: (i % 2) * W, top: Math.floor(i / 2) * H };
  }),
);
await sharp({ create: { width: W * 2, height: H * 2, channels: 3, background: '#000' } }).composite(parts).jpeg({ quality: 85 }).toFile(`${dir}/${place}-board.jpg`);
console.log(`${dir}/${place}-board.jpg`);
