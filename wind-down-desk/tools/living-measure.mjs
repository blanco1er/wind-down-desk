// Measures where the living effects must sit in a panorama (equirectangular 2k JPG, horizon at mid-height):
//   node tools/living-measure.mjs shore  public/environments/cove-2k.jpg        → shoreline pitch per yaw
//   node tools/living-measure.mjs windows public/environments/snow-cabin-2k.jpg → window openings (yaw, pitch ranges)
//   node tools/living-measure.mjs bright public/environments/snow-cabin-2k.jpg  → warm bright blobs (fireplace)
// Yaw 0 = the panorama's centre column (what you face seated), positive = right; pitch in degrees.
import sharp from 'sharp';

const [mode, file] = process.argv.slice(2);
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const C = info.channels;
const px = (x, y) => {
  const i = (y * W + x) * C;
  return [data[i], data[i + 1], data[i + 2]];
};
const yawOf = (x) => (x / W - 0.5) * 360;
const pitchOf = (y) => (0.5 - y / H) * 180;
const rowOf = (pitch) => Math.round((0.5 - pitch / 180) * H);

if (mode === 'shore') {
  // Last row below the horizon that is still water (blue over red) = the farthest reach of the water in the photo.
  const out = [];
  for (let x = 0; x < W; x += 16) {
    let last = -1;
    for (let y = H / 2 + 4; y < H * 0.85; y++) {
      const [r, , b] = px(x, y);
      if (b > r + 6) last = y;
    }
    out.push({ yaw: +yawOf(x).toFixed(1), pitch: last < 0 ? null : +pitchOf(last).toFixed(1) });
  }
  console.log(JSON.stringify(out));
} else if (mode === 'windows') {
  // Columns where most of the band −10°…+30° is "outside" (cool: blue ≥ red), then the vertical extent per column.
  const cols = [];
  for (let x = 0; x < W; x++) {
    let n = 0;
    const isOut = (y) => {
      const [r, , b] = px(x, y);
      return b >= r - 4;
    };
    for (let y = rowOf(30); y <= rowOf(-10); y++) if (isOut(y)) n++;
    // Contiguous opening around +5° (tolerates 3 px of mullion / reflection noise).
    let top = rowOf(5);
    let bottom = rowOf(5);
    for (let gap = 0; top > 0 && gap < 4; top--) gap = isOut(top - 1) ? 0 : gap + 1;
    for (let gap = 0; bottom < H - 1 && gap < 4; bottom++) gap = isOut(bottom + 1) ? 0 : gap + 1;
    cols.push({ x, frac: n / (rowOf(-10) - rowOf(30)), top, bottom });
  }
  const runs = [];
  let cur = null;
  for (const c of cols) {
    if (c.frac > 0.5) {
      if (cur == null) cur = { x0: c.x, x1: c.x, tops: [], bottoms: [] };
      cur.x1 = c.x;
      cur.tops.push(c.top);
      cur.bottoms.push(c.bottom);
    } else if (cur != null) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur != null) runs.push(cur);
  const med = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];
  for (const r of runs.filter((r) => r.x1 - r.x0 > 4)) {
    const n = r.tops.length;
    const at = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => {
      const i = Math.floor(f * (n - 1));
      return `${yawOf(r.x0 + i).toFixed(0)}°:[${pitchOf(r.bottoms[i]).toFixed(1)},${pitchOf(r.tops[i]).toFixed(1)}]`;
    });
    console.log(`yaw ${yawOf(r.x0).toFixed(1)} … ${yawOf(r.x1).toFixed(1)}  pitch ${pitchOf(med(r.bottoms)).toFixed(1)} … ${pitchOf(med(r.tops)).toFixed(1)}   ${at.join(' ')}`);
  }
} else if (mode === 'bright') {
  // Bounding box of warm, bright pixels (flames).
  // Optional window: yawMin yawMax (degrees).
  const ya = Number(process.argv[4] ?? -180);
  const yb = Number(process.argv[5] ?? 180);
  let x0 = W, x1 = 0, y0 = H, y1 = 0, n = 0;
  for (let y = 0; y < H; y++)
    for (let x = Math.floor(((ya + 180) / 360) * W); x < Math.min(W, ((yb + 180) / 360) * W); x++) {
      const [r, g, b] = px(x, y);
      if (r > 235 && g > 150 && b < 140) {
        n++;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
  console.log(`n=${n} yaw ${yawOf(x0).toFixed(1)} … ${yawOf(x1).toFixed(1)} pitch ${pitchOf(y1).toFixed(1)} … ${pitchOf(y0).toFixed(1)}`);
}
