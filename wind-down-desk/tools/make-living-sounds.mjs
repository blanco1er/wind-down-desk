#!/usr/bin/env node
/**
 * Builds the living places' sounds from real CC0 / public-domain / CC BY recordings (credits: CREDITS.md, "Living
 * places"). Sources are not committed (≈ 70 MB): download them from the pages listed in CREDITS.md into one folder:
 *   SRC/feu/Campfire_sound_ambience.ogg      Commons, "Glaneur de sons", CC BY 3.0      → 6 crackles
 *   SRC/feu/OGA_AntumDeluge_fire-1.wav        OpenGameArt, AntumDeluge, CC0              → 2 crackles
 *   SRC/feu/OGA_PagDev_fireplace_loop.wav     OpenGameArt, PagDev, CC0                   → ember bed loop
 *   SRC/vagues/Waves.ogg                      Commons, Dsw4, public domain               → 4 surf one-shots
 *   SRC/vagues/OGA_RandomMind_VistulaShort.mp3 OpenGameArt, RandomMind, CC0              → far sea loop
 *   SRC/vent/Vento_fisterra.ogg               Commons, Escoitar.org, public domain       → soft muffled wind loop
 *   node tools/make-living-sounds.mjs SRC
 * Output: public/audio/living/*.ogg (Ogg Opus mono 48 kHz: loops without a gap) + a JSON report of what was cut.
 * Crackles are found automatically (local peaks ≥ 30 dB over the bed, ≥ 1.4 s apart), surf waves likewise (RMS
 * envelope maxima ≥ 5 s apart); loops are crossfaded on themselves (equal power) so they never click.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SRC = process.argv[2];
if (!SRC) {
  console.error('usage: node tools/make-living-sounds.mjs <sources folder>');
  process.exit(1);
}
const SR = 48000;
const OUT = fileURLToPath(new URL('../public/audio/living/', import.meta.url));
const TMP = join(tmpdir(), `wdd-living-${process.pid}`);
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

function decode(file, from = 0, dur = null, filters = null) {
  const args = ['-loglevel', 'error', '-ss', String(from)];
  if (dur != null) args.push('-t', String(dur));
  args.push('-i', file, '-ac', '1', '-ar', String(SR));
  if (filters) args.push('-af', filters);
  args.push('-f', 'f32le', '-');
  const buf = execFileSync('ffmpeg', args, { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice();
}

function encode(samples, name, bitrate = '48k') {
  // Never clip: at most −2 dBFS.
  const pk = peak(samples);
  if (pk > 0.79) scale(samples, 0.79 / pk);
  const raw = join(TMP, `${name}.f32`);
  writeFileSync(raw, Buffer.from(samples.buffer));
  const out = join(OUT, `${name}.ogg`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', raw, '-c:a', 'libopus', '-b:a', bitrate, out]);
  return out;
}

const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
const rms = (a, i0 = 0, i1 = a.length) => {
  let s = 0;
  for (let i = i0; i < i1; i++) s += a[i] * a[i];
  return Math.sqrt(s / Math.max(1, i1 - i0));
};
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
function scale(a, k) {
  for (let i = 0; i < a.length; i++) a[i] *= k;
  return a;
}
function fades(a, fin, fout) {
  const ni = Math.round(fin * SR);
  const no = Math.round(fout * SR);
  for (let i = 0; i < ni && i < a.length; i++) a[i] *= Math.sin((i / ni) * Math.PI * 0.5);
  for (let i = 0; i < no && i < a.length; i++) a[a.length - 1 - i] *= Math.sin((i / no) * Math.PI * 0.5);
  return a;
}
/** Seamless loop: the tail crossfades (equal power) into the head. */
function loop(a, cross) {
  const c = Math.round(cross * SR);
  const out = a.slice(0, a.length - c);
  for (let i = 0; i < c; i++) {
    const w = i / c;
    out[i] = a[a.length - c + i] * Math.cos(w * Math.PI * 0.5) + a[i] * Math.sin(w * Math.PI * 0.5);
  }
  return out;
}
/** Envelope: peak per window (s). */
function envelope(a, win, fn = 'peak') {
  const n = Math.round(win * SR);
  const out = [];
  for (let i = 0; i + n <= a.length; i += n) out.push(fn === 'peak' ? peak(a.subarray(i, i + n)) : rms(a, i, i + n));
  return out;
}
function median(v) {
  const s = [...v].sort((p, q) => p - q);
  return s[s.length >> 1];
}

const report = {};

// ------------------------------------------------------------ crackles
{
  const crackles = [];
  const camp = decode(join(SRC, 'feu/Campfire_sound_ambience.ogg'), 0, 49, 'highpass=f=70');
  const win = 0.005;
  const env = envelope(camp, win);
  const bed = median(env);
  const cands = [];
  for (let i = 2; i < env.length - 2; i++) {
    if (env[i] >= env[i - 1] && env[i] >= env[i + 1] && db(env[i]) - db(bed) >= 30) cands.push({ t: i * win, e: env[i] });
  }
  cands.sort((p, q) => q.e - p.e);
  const picked = [];
  for (const c of cands) {
    if (picked.every((p) => Math.abs(p.t - c.t) >= 1.4) && c.t > 0.1) picked.push(c);
    if (picked.length === 6) break;
  }
  picked.sort((p, q) => p.t - q.t);
  for (const p of picked) {
    const i0 = Math.max(0, Math.round((p.t - 0.03) * SR));
    crackles.push({ from: 'Campfire_sound_ambience', t: +p.t.toFixed(3), emergence: +(db(p.e) - db(bed)).toFixed(1), clip: fades(camp.slice(i0, i0 + Math.round(0.95 * SR)), 0.004, 0.45) });
  }
  const antum = decode(join(SRC, 'feu/OGA_AntumDeluge_fire-1.wav'), 0, null, 'highpass=f=70');
  const env2 = envelope(antum, win);
  const bed2 = median(env2);
  const c2 = [];
  for (let i = 2; i < env2.length - 2; i++) if (env2[i] >= env2[i - 1] && env2[i] >= env2[i + 1] && db(env2[i]) - db(bed2) >= 20) c2.push({ t: i * win, e: env2[i] });
  c2.sort((p, q) => q.e - p.e);
  const p2 = [];
  for (const c of c2) {
    if (p2.every((p) => Math.abs(p.t - c.t) >= 0.5)) p2.push(c);
    if (p2.length === 2) break;
  }
  for (const p of p2) {
    const i0 = Math.max(0, Math.round((p.t - 0.03) * SR));
    crackles.push({ from: 'OGA_AntumDeluge_fire-1', t: +p.t.toFixed(3), emergence: +(db(p.e) - db(bed2)).toFixed(1), clip: fades(antum.slice(i0, i0 + Math.round(0.7 * SR)), 0.004, 0.35) });
  }
  report.crackles = crackles.map((c, i) => {
    // Same peak for every crackle (−6 dBFS): loudness is decided at run time, under a ceiling.
    scale(c.clip, 0.5 / Math.max(1e-6, peak(c.clip)));
    encode(c.clip, `crackle-${i + 1}`, '40k');
    return { file: `crackle-${i + 1}.ogg`, from: c.from, t: c.t, emergenceDb: c.emergence, rmsDb: +db(rms(c.clip)).toFixed(1) };
  });
}

// ------------------------------------------------------------ ember bed loop
{
  const fire = decode(join(SRC, 'feu/OGA_PagDev_fireplace_loop.wav'), 0, 24, 'highpass=f=40,lowpass=f=9000');
  const l = loop(fire, 2.5);
  scale(l, 0.1 / rms(l));
  encode(l, 'embers', '48k');
  report.embers = { seconds: +(l.length / SR).toFixed(2), rmsDb: +db(rms(l)).toFixed(1), peakDb: +db(peak(l)).toFixed(1) };
}

// ------------------------------------------------------------ surf one-shots
{
  const from = 110;
  const waves = decode(join(SRC, 'vagues/Waves.ogg'), from, 60, 'highpass=f=45');
  const env = envelope(waves, 0.05, 'rms');
  // Smooth (0.5 s) and find maxima ≥ 5 s apart.
  const sm = env.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = -5; k <= 5; k++) if (env[i + k] != null) {
      s += env[i + k];
      n++;
    }
    return s / n;
  });
  const cands = [];
  for (let i = 30; i < sm.length - 120; i++) if (sm[i] >= sm[i - 1] && sm[i] >= sm[i + 1]) cands.push({ i, e: sm[i], t: i * 0.05 });
  cands.sort((p, q) => q.e - p.e);
  const picked = [];
  for (const c of cands) {
    if (picked.every((p) => Math.abs(p.t - c.t) >= 5.5)) picked.push(c);
    if (picked.length === 4) break;
  }
  picked.sort((p, q) => p.t - q.t);
  report.surf = picked.map((p, k) => {
    const i0 = Math.max(0, Math.round((p.t - 1.4) * SR));
    const clip = fades(waves.slice(i0, i0 + Math.round(7.2 * SR)), 0.7, 2.6);
    scale(clip, 0.08 / rms(clip));
    if (peak(clip) > 0.7) scale(clip, 0.7 / peak(clip));
    encode(clip, `surf-${k + 1}`, '48k');
    return { file: `surf-${k + 1}.ogg`, sourceSecond: +(from + p.t).toFixed(2), rmsDb: +db(rms(clip)).toFixed(1), peakDb: +db(peak(clip)).toFixed(1) };
  });
}

// ------------------------------------------------------------ far sea bed (distant: low-passed)
{
  const sea = decode(join(SRC, 'vagues/OGA_RandomMind_VistulaShort.mp3'), 30, 26, 'highpass=f=40,lowpass=f=1100');
  const l = loop(sea, 3);
  scale(l, 0.08 / rms(l));
  encode(l, 'sea', '40k');
  report.sea = { seconds: +(l.length / SR).toFixed(2), rmsDb: +db(rms(l)).toFixed(1) };
}

// ------------------------------------------------------------ soft wind, heard through the glass (muffled)
{
  const wind = decode(join(SRC, 'vent/Vento_fisterra.ogg'), 10, 40, 'highpass=f=60,lowpass=f=850,lowpass=f=850');
  const l = loop(wind, 4);
  scale(l, 0.08 / rms(l));
  encode(l, 'wind', '40k');
  report.wind = { seconds: +(l.length / SR).toFixed(2), rmsDb: +db(rms(l)).toFixed(1) };
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
rmSync(TMP, { recursive: true, force: true });
console.log(JSON.stringify(report, null, 2));
