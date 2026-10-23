// Repairs the vertical tile seams of the place panoramas at FULL resolution (25 Oct, axe 5). The night places were
// painted in tiles; some show a vertical seam (an exposure step and/or a thin dark line, e.g. the lake at 122° and
// 238°). Steps:
//   1. decode the shipped KTX2 (tools/ktx2-decode.cjs, 6144 × 2048 equal-area)
//   2. detect seams: a log-exposure step (or a thin stripe) with the same sign on most FLAT rows (sky, water); object
//      edges are big and change sign, they are not taken
//   3. review: `detect` writes a before/after crop of each candidate (artifacts/seams/candidates/<id>-<x>.jpg) and stops
//   4. `apply <x,x,…>` repairs only the seams reviewed: the levels of both sides (dark and bright, per channel, per
//      window of rows) meet half-way — exposure AND veil — faded over ±9°; the 13 seam columns (0.76°) become a blend;
//      then the KTX2 is re-encoded (ETC1S q255) and the 2k equirectangular fallback + the menu thumbnail redone.
//      The originals go to archive/environments-night-v1/ (nothing deleted).
//   node tools/repair-places.mjs <file-stem> detect
//   node tools/repair-places.mjs <file-stem> apply 2075,4065
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';

const [stem, mode = 'detect', list = ''] = process.argv.slice(2);
const ENV = 'public/environments';
const SCRATCH = process.env.WDD_SCRATCH ?? '/tmp';
const png = `${SCRATCH}/${stem}-ea.png`;
execFileSync('node', ['tools/ktx2-decode.cjs', `${ENV}/${stem}.ktx2`, png], { stdio: 'ignore' });
const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const lin = new Float32Array(W * H * 3);
for (let i = 0; i < lin.length; i++) lin[i] = Math.pow(data[i] / 255, 2.2);
const L = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) L[i] = 0.2126 * lin[i * 3] + 0.7152 * lin[i * 3 + 1] + 0.0722 * lin[i * 3 + 2];
const EPS = 0.0015;
const col = (x) => ((x % W) + W) % W;
const meanL = (y, x0, n) => {
  let s = 0;
  for (let k = 0; k < n; k++) s += L[y * W + col(x0 + k)];
  return s / n;
};
const spread = (y, x0, n) => {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < n; k++) {
    const v = Math.log(L[y * W + col(x0 + k)] + EPS);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return hi - lo;
};

// ---------------------------------------------------------------- detection (steps and thin stripes)
const S = 12;
const yA = Math.round(H * 0.08), yB = Math.round(H * 0.92);
const stepScore = new Float32Array(W), stepAgree = new Float32Array(W), lineScore = new Float32Array(W), lineAgree = new Float32Array(W), support = new Float32Array(W);
let rows = 0;
for (let y = yA; y < yB; y += 3) rows++;
for (let x = 0; x < W; x++) {
  const st = [], ln = [];
  let sp = 0, sn = 0, lp = 0, lnn = 0;
  for (let y = yA; y < yB; y += 3) {
    if (spread(y, x - S - 4, S) > 0.15 || spread(y, x + 4, S) > 0.15) continue;
    const l = meanL(y, x - S - 4, S), r = meanL(y, x + 4, S);
    if (l + r < 0.0004) continue;
    const a = Math.log((r + EPS) / (l + EPS));
    st.push(a);
    if (a > 0.012) sp++;
    else if (a < -0.012) sn++;
    // A thin stripe: the 3 seam columns against the mean of both sides.
    const mid = meanL(y, x - 1, 3);
    const b = Math.log((mid + EPS) / ((l + r) / 2 + EPS));
    ln.push(b);
    if (b > 0.02) lp++;
    else if (b < -0.02) lnn++;
  }
  const med = (v) => (v.length === 0 ? 0 : v.sort((p, q) => p - q)[v.length >> 1]);
  stepScore[x] = med(st);
  lineScore[x] = med(ln);
  stepAgree[x] = st.length ? Math.max(sp, sn) / st.length : 0;
  lineAgree[x] = ln.length ? Math.max(lp, lnn) / ln.length : 0;
  support[x] = st.length / rows;
}
const candidates = [];
for (let x = 0; x < W; x++) {
  if (support[x] < 0.08) continue;
  const peak = (arr, agreeArr, minM, minAgree) => {
    const m = Math.abs(arr[x]);
    if (m < minM || m > 0.45 || agreeArr[x] < minAgree) return false;
    let base = 0, n = 0;
    for (let k = -120; k <= 120; k++) {
      const o = Math.abs(arr[col(x + k)]);
      if (Math.abs(k) <= 10 && o > m) return false;
      if (Math.abs(k) > 20) {
        base += o;
        n++;
      }
    }
    return m > 4 * (base / n);
  };
  const step = peak(stepScore, stepAgree, 0.02, 0.6);
  const line = peak(lineScore, lineAgree, 0.03, 0.65);
  if (step || line) candidates.push({ x, deg: +((x / W) * 360).toFixed(1), step: +stepScore[x].toFixed(3), line: +lineScore[x].toFixed(3), agree: +Math.max(stepAgree[x], lineAgree[x]).toFixed(2), support: +support[x].toFixed(2) });
}
if (process.env.SEAM_DEBUG != null) { const [a, b] = process.env.SEAM_DEBUG.split(",").map(Number); for (let x = a; x <= b; x += 4) console.log(x, stepScore[x].toFixed(3), stepAgree[x].toFixed(2), lineScore[x].toFixed(3), support[x].toFixed(2)); }
// One candidate per seam (the strongest within ±20 columns).
const seams = [];
for (const c of candidates) {
  const last = seams[seams.length - 1];
  if (last != null && c.x - last.x <= 20) {
    if (Math.abs(c.step) + Math.abs(c.line) > Math.abs(last.step) + Math.abs(last.line)) seams[seams.length - 1] = c;
  } else seams.push(c);
}

// ---------------------------------------------------------------- repair
const R = Math.round(W * (9 / 360));
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
function repair(img, xs) {
  const out = new Float32Array(img);
  for (const x0 of xs) {
    // Levels on each side (10th and 90th percentile, per channel) in a window of ±24 rows, every 8 rows, from 48
    // columns each side (outside the seam columns): a tile can differ by exposure (gain) AND by a veil that lifts its
    // blacks (offset), so both levels are matched, each side half-way toward the mean of the two.
    const STEP = 8;
    const nodes = Math.ceil(H / STEP) + 1;
    const maps = [0, 1, 2].map(() => new Float32Array(nodes * 4)); // la, lb, ra, rb : v' = a·v + b
    const pct = (v, p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    for (let ch = 0; ch < 3; ch++) {
      for (let n = 0; n < nodes; n++) {
        const yc = Math.min(H - 1, n * STEP);
        const left = [], right = [];
        for (let y = Math.max(0, yc - 24); y <= Math.min(H - 1, yc + 24); y += 2) {
          for (let k = 5; k < 53; k += 2) {
            left.push(out[(y * W + col(x0 - k)) * 3 + ch]);
            right.push(out[(y * W + col(x0 + k)) * 3 + ch]);
          }
        }
        left.sort((a, b) => a - b);
        right.sort((a, b) => a - b);
        const l10 = pct(left, 0.1), l90 = pct(left, 0.9), r10 = pct(right, 0.1), r90 = pct(right, 0.9);
        const m10 = (l10 + r10) / 2, m90 = (l90 + r90) / 2;
        const fit = (lo, hi) => {
          const span = hi - lo;
          // Too little contrast to fit a gain safely: offset only.
          if (span < 0.004) return [1, m10 - lo];
          const a = Math.max(0.6, Math.min(1.6, (m90 - m10) / span));
          return [a, m10 - a * lo];
        };
        const [la, lb] = fit(l10, l90);
        const [ra, rb] = fit(r10, r90);
        maps[ch].set([la, lb, ra, rb], n * 4);
      }
    }
    for (let y = 0; y < H; y++) {
      const f = y / STEP;
      const n0 = Math.min(nodes - 1, Math.floor(f));
      const n1 = Math.min(nodes - 1, n0 + 1);
      const t = f - n0;
      for (let ch = 0; ch < 3; ch++) {
        const m = maps[ch];
        const p = (i) => m[n0 * 4 + i] * (1 - t) + m[n1 * 4 + i] * t;
        const la = p(0), lb = p(1), ra = p(2), rb = p(3);
        for (let dx = -R; dx <= R; dx++) {
          const ramp = 1 - smooth(Math.abs(dx) / R);
          const i = (y * W + col(x0 + dx)) * 3 + ch;
          const v = out[i];
          const target = dx < 0 ? la * v + lb : ra * v + rb;
          out[i] = Math.max(0, v + (target - v) * ramp);
        }
      }
      // The seam columns become a blend of their two edges.
      for (let ch = 0; ch < 3; ch++) {
        const a = out[(y * W + col(x0 - 7)) * 3 + ch];
        const b = out[(y * W + col(x0 + 7)) * 3 + ch];
        for (let k = -6; k <= 6; k++) out[(y * W + col(x0 + k)) * 3 + ch] = a + ((b - a) * (k + 7)) / 14;
      }
    }
  }
  return out;
}
const toBytes = (img) => {
  const b = Buffer.alloc(W * H * 3);
  for (let i = 0; i < b.length; i++) b[i] = Math.max(0, Math.min(255, Math.round(Math.pow(Math.max(0, img[i]), 1 / 2.2) * 255)));
  return b;
};
async function crop(bytes, x0, y0, w, h) {
  return sharp(bytes, { raw: { width: W, height: H, channels: 3 } }).extract({ left: Math.max(0, Math.min(W - w, x0)), top: y0, width: w, height: h }).modulate({ brightness: 2.6 }).png().toBuffer();
}

mkdirSync('artifacts/seams/candidates', { recursive: true });
if (mode === 'detect') {
  const fixedAll = toBytes(repair(lin, seams.map((s) => s.x)));
  for (const s of seams) {
    const a = await crop(data, s.x - 200, 300, 400, 1100);
    const b = await crop(fixedAll, s.x - 200, 300, 400, 1100);
    await sharp({ create: { width: 820, height: 1100, channels: 3, background: '#f00' } }).composite([{ input: a, top: 0, left: 0 }, { input: b, top: 0, left: 420 }]).jpeg({ quality: 82 }).toFile(`artifacts/seams/candidates/${stem}-${s.x}.jpg`);
  }
  console.log(JSON.stringify({ stem, W, H, seams }));
} else {
  const xs = list.split(',').filter(Boolean).map(Number);
  const fixed = toBytes(repair(lin, xs));
  const outPng = `${SCRATCH}/${stem}-ea-fixed.png`;
  await sharp(fixed, { raw: { width: W, height: H, channels: 3 } }).png().toFile(outPng);
  // Originals kept.
  const arch = 'archive/environments-night-v1';
  mkdirSync(arch, { recursive: true });
  for (const f of [`${stem}.ktx2`, `${stem}-2k.jpg`, `${stem}-thumb.jpg`]) if (!existsSync(`${arch}/${f}`)) copyFileSync(`${ENV}/${f}`, `${arch}/${f}`);
  execFileSync('node', ['tools/encode-places.mjs', outPng, `${ENV}/${stem}.ktx2`, 'etc1s', '255'], { stdio: 'inherit' });
  // Equal-area → equirectangular 2048 × 1024 (fallback) and the 384 × 192 thumbnail.
  const EW = 2048, EH = 1024;
  const eq = Buffer.alloc(EW * EH * 3);
  for (let y = 0; y < EH; y++) {
    const lat = (0.5 - (y + 0.5) / EH) * Math.PI;
    const v = (0.5 - 0.5 * Math.sin(lat)) * H - 0.5;
    const y0 = Math.max(0, Math.min(H - 1, Math.floor(v)));
    const y1 = Math.min(H - 1, y0 + 1);
    const t = Math.max(0, Math.min(1, v - y0));
    for (let x = 0; x < EW; x++) {
      const sx = Math.floor(((x + 0.5) / EW) * W);
      for (let ch = 0; ch < 3; ch++) eq[(y * EW + x) * 3 + ch] = Math.round(fixed[(y0 * W + sx) * 3 + ch] * (1 - t) + fixed[(y1 * W + sx) * 3 + ch] * t);
    }
  }
  const eqImg = sharp(eq, { raw: { width: EW, height: EH, channels: 3 } });
  await eqImg.clone().jpeg({ quality: 90 }).toFile(`${ENV}/${stem}-2k.jpg`);
  await eqImg.clone().resize(384, 192, { kernel: 'lanczos3' }).jpeg({ quality: 86 }).toFile(`${ENV}/${stem}-thumb.jpg`);
  console.log(JSON.stringify({ stem, repaired: xs, archived: arch }));
}
