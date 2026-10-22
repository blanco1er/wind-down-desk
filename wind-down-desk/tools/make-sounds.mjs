#!/usr/bin/env node
/**
 * Synthesizes every sound of Wind-Down Desk (no samples, no downloads), then
 * compresses them to mono mp3 with ffmpeg. Deterministic (seeded noise).
 *   node tools/make-sounds.mjs [names…]   (names: only these files are written, e.g. the v6 ones)
 * Output: public/audio/*.mp3
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const OUT = fileURLToPath(new URL('../public/audio/', import.meta.url));
const TMP = join(tmpdir(), `wdd-sounds-${process.pid}`);
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

let seed = 1234567;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const buffer = (seconds) => new Float32Array(Math.round(seconds * SR));

/** Adds a sine partial with attack / exponential decay and optional vibrato. */
function partial(out, { freq, amp, start = 0, attack = 0.005, decay = 1, vibrato = 0, vibRate = 5, glideTo = null, glideTime = 0.1 }) {
  const s0 = Math.round(start * SR);
  let phase = 0;
  for (let i = s0; i < out.length; i++) {
    const t = (i - s0) / SR;
    const env = (t < attack ? t / attack : 1) * Math.exp(-(t - Math.min(t, attack)) / decay);
    if (env < 1e-5 && t > attack) break;
    let f = freq;
    if (glideTo != null) f = freq + (glideTo - freq) * Math.min(1, t / glideTime);
    f *= 1 + vibrato * Math.sin(2 * Math.PI * vibRate * t);
    phase += (2 * Math.PI * f) / SR;
    out[i] += Math.sin(phase) * amp * env;
  }
}

/** Filtered noise burst (one-pole low/high pass), envelope function of t. */
function noise(out, { amp, start = 0, length, lowpass = 0.2, highpass = 0.0, env }) {
  const s0 = Math.round(start * SR);
  const n = Math.round(length * SR);
  let lp = 0;
  let hpPrev = 0;
  let hpOut = 0;
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const t = i / SR;
    const x = rand() * 2 - 1;
    const a = typeof lowpass === 'function' ? lowpass(t) : lowpass;
    lp += a * (x - lp);
    hpOut = highpass > 0 ? (1 - highpass) * (hpOut + lp - hpPrev) : lp;
    hpPrev = lp;
    out[s0 + i] += hpOut * amp * env(t / length, t);
  }
}

/** Small Schroeder reverb (4 combs + 2 allpasses), mixed in. */
function reverb(input, { mix = 0.25, room = 0.82, damp = 0.3, tail = 1.5 }) {
  const out = new Float32Array(input.length + Math.round(tail * SR));
  out.set(input);
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ buf: new Float32Array(d), i: 0, store: 0 }));
  const allps = [556, 441].map((d) => ({ buf: new Float32Array(d), i: 0 }));
  for (let n = 0; n < out.length; n++) {
    const x = n < input.length ? input[n] : 0;
    let acc = 0;
    for (const c of combs) {
      const y = c.buf[c.i];
      c.store = y * (1 - damp) + c.store * damp;
      c.buf[c.i] = x + c.store * room;
      c.i = (c.i + 1) % c.buf.length;
      acc += y;
    }
    acc *= 0.25;
    for (const a of allps) {
      const y = a.buf[a.i];
      a.buf[a.i] = acc + y * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      acc = y - acc * 0.5;
    }
    out[n] = out[n] * (1 - mix * 0.5) + acc * mix;
  }
  return out;
}

function fadeOut(buf, seconds) {
  const n = Math.round(seconds * SR);
  for (let i = 0; i < n; i++) buf[buf.length - 1 - i] *= i / n;
  return buf;
}

/** Drops the inaudible end of a reverb tail (below -54 dBFS), with a short fade. */
function trimTail(buf, threshold = 0.002) {
  let end = buf.length - 1;
  while (end > 0 && Math.abs(buf[end]) < threshold) end--;
  return fadeOut(buf.slice(0, Math.min(buf.length, end + Math.round(0.05 * SR))), 0.05);
}

function normalize(buf, peak = 0.89) {
  let m = 0;
  for (const v of buf) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m;
  return buf;
}

function writeMp3(name, buf, bitrate = '96k') {
  const wav = join(TMP, `${name}.wav`);
  const data = Buffer.alloc(44 + buf.length * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + buf.length * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(SR, 24);
  data.writeUInt32LE(SR * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i] * 32767))), 44 + i * 2);
  writeFileSync(wav, data);
  const mp3 = join(OUT, `${name}.mp3`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', bitrate, mp3]);
  return statSync(mp3).size;
}

const sounds = {};

// Stone appears: airy glass pluck.
{
  const b = buffer(1.0);
  partial(b, { freq: 1046.5, amp: 0.5, decay: 0.28 });
  partial(b, { freq: 1568, amp: 0.22, decay: 0.2, start: 0.012 });
  partial(b, { freq: 2093, amp: 0.08, decay: 0.12 });
  noise(b, { amp: 0.05, length: 0.08, lowpass: 0.35, highpass: 0.9, env: (k) => 1 - k });
  sounds.appear = fadeOut(normalize(reverb(b, { mix: 0.3, tail: 0.6 }), 0.7), 0.2);
}

// Stone back on the glass: soft ceramic tock.
{
  const b = buffer(0.5);
  partial(b, { freq: 2350, amp: 0.25, decay: 0.025, attack: 0.001 });
  partial(b, { freq: 690, amp: 0.6, decay: 0.07, attack: 0.002 });
  partial(b, { freq: 1180, amp: 0.2, decay: 0.05, attack: 0.002 });
  noise(b, { amp: 0.25, length: 0.012, lowpass: 0.5, env: (k) => 1 - k });
  sounds.tock = fadeOut(normalize(reverb(b, { mix: 0.18, tail: 0.3 }), 0.7), 0.1);
}

// Tomorrow: warm amber bell (E5 + B5 + soft inharmonic).
{
  const b = buffer(2.0);
  partial(b, { freq: 659.3, amp: 0.55, decay: 0.7 });
  partial(b, { freq: 987.8, amp: 0.3, decay: 0.55, start: 0.04 });
  partial(b, { freq: 659.3 * 2.76, amp: 0.06, decay: 0.2 });
  partial(b, { freq: 329.6, amp: 0.18, decay: 0.9 });
  sounds['snap-tomorrow'] = fadeOut(normalize(reverb(b, { mix: 0.32, tail: 1.2 }), 0.75), 0.4);
}

// Later: cooler, lower moon bell (A4 + E5).
{
  const b = buffer(2.2);
  partial(b, { freq: 440, amp: 0.55, decay: 0.85, attack: 0.012 });
  partial(b, { freq: 659.3, amp: 0.28, decay: 0.7, start: 0.05, attack: 0.012 });
  partial(b, { freq: 440 * 2.76, amp: 0.05, decay: 0.25 });
  sounds['snap-later'] = fadeOut(normalize(reverb(b, { mix: 0.36, tail: 1.4 }), 0.7), 0.4);
}

// Let go: a breath that rises into a shimmer of glass, over a warm low note.
{
  const b = buffer(3.4);
  noise(b, {
    amp: 0.35,
    length: 2.6,
    lowpass: (t) => 0.02 + Math.min(0.25, t * 0.12),
    highpass: 0.6,
    env: (k) => Math.sin(Math.PI * Math.min(1, k * 1.6)) ** 2 * (1 - k),
  });
  const notes = [1318.5, 1568, 1760, 2093, 2637, 3136];
  notes.forEach((f, i) => partial(b, { freq: f, amp: 0.16 - i * 0.012, start: 0.25 + i * 0.11, attack: 0.03, decay: 0.9 - i * 0.06, vibrato: 0.002, vibRate: 4 + i }));
  partial(b, { freq: 220, amp: 0.3, start: 0.1, attack: 0.2, decay: 1.2 });
  partial(b, { freq: 330, amp: 0.12, start: 0.15, attack: 0.25, decay: 1.0 });
  sounds.release = fadeOut(normalize(reverb(b, { mix: 0.45, room: 0.86, tail: 1.8 }), 0.85), 0.6);
}

// Orb on / off: soft two-note glide.
{
  const on = buffer(0.6);
  partial(on, { freq: 660, amp: 0.4, decay: 0.12, glideTo: 990, glideTime: 0.09 });
  sounds['orb-on'] = fadeOut(normalize(reverb(on, { mix: 0.25, tail: 0.4 }), 0.6), 0.15);
  const off = buffer(0.6);
  partial(off, { freq: 990, amp: 0.4, decay: 0.12, glideTo: 620, glideTime: 0.1 });
  sounds['orb-off'] = fadeOut(normalize(reverb(off, { mix: 0.25, tail: 0.4 }), 0.55), 0.15);
}

// Plan card: gentle arpeggio C5 E5 G5.
{
  const b = buffer(2.0);
  [523.3, 659.3, 784].forEach((f, i) => partial(b, { freq: f, amp: 0.35, start: i * 0.12, decay: 0.6, attack: 0.01 }));
  sounds.plan = fadeOut(normalize(reverb(b, { mix: 0.35, tail: 1.2 }), 0.7), 0.4);
}

// Night: low, slow chord settling (A3 C#4 E4).
{
  const b = buffer(4.0);
  [220, 277.2, 329.6, 440].forEach((f, i) => partial(b, { freq: f, amp: 0.28 - i * 0.04, start: i * 0.18, attack: 0.5, decay: 1.6, vibrato: 0.0015, vibRate: 0.6 + i * 0.2 }));
  sounds.night = fadeOut(normalize(reverb(b, { mix: 0.45, room: 0.88, tail: 2 }), 0.7), 1.2);
}

// Morning: bright, rising G5 B5 D6.
{
  const b = buffer(2.2);
  [784, 987.8, 1174.7].forEach((f, i) => partial(b, { freq: f, amp: 0.33, start: i * 0.1, decay: 0.7 }));
  sounds.morning = fadeOut(normalize(reverb(b, { mix: 0.32, tail: 1.2 }), 0.7), 0.4);
}

// Ambient: 16 s seamless warm pad + faint room air.
{
  const L = 16;
  const XF = 2;
  const b = buffer(L + XF);
  const chord = [110, 164.8, 220, 277.2, 329.6];
  chord.forEach((f, i) => {
    let phase = 0;
    for (let n = 0; n < b.length; n++) {
      const t = n / SR;
      const lfo = 1 + 0.002 * Math.sin(2 * Math.PI * (0.07 + i * 0.013) * t);
      phase += (2 * Math.PI * f * lfo) / SR;
      const swell = 0.6 + 0.4 * Math.sin(2 * Math.PI * (1 / 8) * t + i);
      b[n] += Math.sin(phase) * (0.16 - i * 0.02) * swell;
    }
  });
  noise(b, { amp: 0.06, length: L + XF, lowpass: 0.015, env: () => 1 });
  const loop = new Float32Array(L * SR);
  for (let n = 0; n < loop.length; n++) {
    const tail = n < XF * SR ? b[L * SR + n] : 0;
    const k = n < XF * SR ? n / (XF * SR) : 1;
    loop[n] = b[n] * k + tail * (1 - k);
  }
  sounds.ambient = normalize(loop, 0.6);
}

// ------------------------------------------------------------------ v6 rituals (Breathe, Release)

// Sink: a stone meets still water (a short pitched plop, a soft splash, a deep "thoom"), then quiet.
{
  const b = buffer(3.0);
  partial(b, { freq: 820, amp: 0.45, decay: 0.05, attack: 0.002, glideTo: 260, glideTime: 0.07 });
  partial(b, { freq: 1500, amp: 0.12, decay: 0.03, attack: 0.001, glideTo: 600, glideTime: 0.05 });
  noise(b, { amp: 0.22, length: 0.35, lowpass: 0.3, highpass: 0.4, env: (k) => (1 - k) ** 3 });
  partial(b, { freq: 72, amp: 0.55, decay: 0.55, attack: 0.01, start: 0.01 });
  partial(b, { freq: 108, amp: 0.2, decay: 0.4, attack: 0.01, start: 0.01 });
  // A slower, lower water note as it goes down.
  partial(b, { freq: 196, amp: 0.12, decay: 1.2, attack: 0.25, start: 0.3, vibrato: 0.004, vibRate: 3 });
  sounds.sink = fadeOut(normalize(reverb(b, { mix: 0.4, room: 0.84, tail: 1.6 }), 0.8), 0.6);
}

// Bubbles: a few small rising blips, far apart.
{
  const b = buffer(1.8);
  [0.05, 0.38, 0.62, 1.05, 1.32].forEach((t, i) => {
    partial(b, { freq: 520 + i * 90, amp: 0.3 - i * 0.03, decay: 0.035, attack: 0.002, start: t, glideTo: 1300 + i * 140, glideTime: 0.03 });
  });
  sounds.bubbles = fadeOut(normalize(reverb(b, { mix: 0.3, tail: 0.6 }), 0.5), 0.3);
}

// Pearl: one glass chime when a breath completes (soft, high, long).
{
  const b = buffer(2.6);
  partial(b, { freq: 1567.98, amp: 0.4, decay: 0.9, attack: 0.004 });
  partial(b, { freq: 2349.3, amp: 0.16, decay: 0.6, attack: 0.004, start: 0.006 });
  partial(b, { freq: 1567.98 * 2.76, amp: 0.05, decay: 0.25 });
  partial(b, { freq: 783.99, amp: 0.12, decay: 1.2, attack: 0.02 });
  sounds.pearl = fadeOut(normalize(reverb(b, { mix: 0.4, room: 0.85, tail: 1.4 }), 0.55), 0.5);
}

// Swell (4 s): air that opens and a warm fifth that rises with the inhale.
{
  const L = 4.0;
  const b = buffer(L + 0.4);
  noise(b, { amp: 0.25, length: L, lowpass: (t) => 0.01 + (t / L) * 0.07, highpass: 0.5, env: (k) => Math.sin(Math.PI * 0.5 * k) ** 2 * (1 - Math.max(0, k - 0.88) / 0.12) });
  for (const [f, a] of [[220, 0.2], [329.63, 0.13], [440, 0.06]]) {
    let phase = 0;
    for (let n = 0; n < Math.round(L * SR); n++) {
      const t = n / SR;
      const k = t / L;
      const env = Math.sin(Math.PI * 0.5 * Math.min(1, k * 1.05)) ** 2 * (k > 0.9 ? (1 - k) / 0.1 : 1);
      phase += (2 * Math.PI * f * (1 + 0.004 * k)) / SR;
      b[n] += Math.sin(phase) * a * env;
    }
  }
  sounds.swell = fadeOut(normalize(reverb(b, { mix: 0.35, room: 0.86, tail: 1.0 }), 0.42), 0.4);
}

// Ebb (6 s): the same air closing, the fifth settling down a tone.
{
  const L = 6.0;
  const b = buffer(L + 0.4);
  noise(b, { amp: 0.25, length: L, lowpass: (t) => 0.08 - (t / L) * 0.07, highpass: 0.5, env: (k) => (1 - k) ** 1.6 * Math.min(1, k * 12) });
  for (const [f, a] of [[220, 0.2], [329.63, 0.12], [196, 0.08]]) {
    let phase = 0;
    for (let n = 0; n < Math.round(L * SR); n++) {
      const t = n / SR;
      const k = t / L;
      const env = (1 - k) ** 1.4 * Math.min(1, k * 10);
      phase += (2 * Math.PI * f * (1 - 0.006 * k)) / SR;
      b[n] += Math.sin(phase) * a * env;
    }
  }
  sounds.ebb = fadeOut(normalize(reverb(b, { mix: 0.35, room: 0.86, tail: 1.2 }), 0.42), 0.5);
}

// Rise: the black bowl comes up out of the tray (a low stone resonance and a shimmer of water).
{
  const b = buffer(2.6);
  partial(b, { freq: 98, amp: 0.4, decay: 1.1, attack: 0.5 });
  partial(b, { freq: 147, amp: 0.2, decay: 0.9, attack: 0.6 });
  noise(b, { amp: 0.08, length: 1.6, lowpass: 0.06, highpass: 0.3, env: (k) => Math.sin(Math.PI * k) });
  [1174.7, 1568, 1760].forEach((f, i) => partial(b, { freq: f, amp: 0.05, start: 0.9 + i * 0.12, decay: 0.5, attack: 0.02 }));
  sounds.rise = fadeOut(normalize(reverb(b, { mix: 0.4, tail: 1.2 }), 0.55), 0.5);
}

// Moon: the lamp floats up and opens into the moon (a soft rising shimmer over a warm low note).
{
  const b = buffer(3.0);
  partial(b, { freq: 164.8, amp: 0.25, start: 0.05, attack: 0.6, decay: 1.4 });
  partial(b, { freq: 246.9, amp: 0.12, start: 0.2, attack: 0.6, decay: 1.2 });
  [987.8, 1318.5, 1480, 1975.5].forEach((f, i) => partial(b, { freq: f, amp: 0.07, start: 0.5 + i * 0.16, attack: 0.05, decay: 0.8, vibrato: 0.002, vibRate: 4 + i }));
  sounds.moon = fadeOut(normalize(reverb(b, { mix: 0.45, room: 0.86, tail: 1.6 }), 0.55), 0.6);
}

// v8 — Rain on the tea garden (a seamless 12 s loop): soft broadband hiss, thousands of tiny drops on
// leaves and stone, a few heavier ones on wood, a low wet rumble. Played from three spatial sources.
{
  const L = 12;
  const XF = 1.5;
  const b = buffer(L + XF);
  noise(b, { amp: 0.16, length: L + XF, lowpass: 0.35, highpass: 0.55, env: () => 1 });
  noise(b, { amp: 0.1, length: L + XF, lowpass: 0.08, highpass: 0.2, env: (k, t) => 0.8 + 0.2 * Math.sin(2 * Math.PI * t / 6.5) });
  noise(b, { amp: 0.05, length: L + XF, lowpass: 0.01, env: () => 1 });
  for (let i = 0; i < 2600; i++) {
    const start = rand() * (L + XF - 0.05);
    const heavy = rand() < 0.06;
    const f = heavy ? 900 + rand() * 900 : 2400 + rand() * 4200;
    partial(b, { freq: f, amp: (heavy ? 0.05 : 0.018) * (0.4 + rand()), start, attack: 0.0008, decay: heavy ? 0.018 : 0.006, glideTo: f * (heavy ? 1.6 : 1.25), glideTime: 0.01 });
  }
  const loop = new Float32Array(L * SR);
  for (let n = 0; n < loop.length; n++) {
    const tail = n < XF * SR ? b[L * SR + n] : 0;
    const k = n < XF * SR ? n / (XF * SR) : 1;
    loop[n] = b[n] * k + tail * (1 - k);
  }
  sounds.rain = normalize(loop, 0.7);
}

// v8 — Drips from the veranda eave (seamless 8 s loop): irregular drops into a puddle, a thin trickle.
{
  const L = 8;
  const XF = 1;
  const b = buffer(L + XF);
  noise(b, { amp: 0.035, length: L + XF, lowpass: 0.25, highpass: 0.6, env: (k, t) => 0.6 + 0.4 * Math.sin(2 * Math.PI * t / 4) ** 2 });
  let t = 0.1;
  while (t < L + XF - 0.3) {
    const f = 700 + rand() * 900;
    partial(b, { freq: f, amp: 0.28 * (0.5 + rand() * 0.5), start: t, attack: 0.001, decay: 0.05, glideTo: f * 1.9, glideTime: 0.03 });
    partial(b, { freq: f * 2.7, amp: 0.06, start: t + 0.002, attack: 0.001, decay: 0.02 });
    noise(b, { amp: 0.08, start: t, length: 0.04, lowpass: 0.5, highpass: 0.4, env: (k) => (1 - k) ** 3 });
    t += 0.35 + rand() * 0.9;
  }
  const wet = reverb(b, { mix: 0.3, room: 0.7, tail: 0.1 });
  const loop = new Float32Array(L * SR);
  for (let n = 0; n < loop.length; n++) {
    const tail = n < XF * SR ? wet[L * SR + n] : 0;
    const k = n < XF * SR ? n / (XF * SR) : 1;
    loop[n] = wet[n] * k + tail * (1 - k);
  }
  sounds.drip = normalize(loop, 0.6);
}

/** Loops ship as Ogg Opus: gapless in Chromium (the Quest browser), unlike mp3's encoder padding. */
function writeOgg(name, buf, bitrate = '40k') {
  const wav = join(TMP, `${name}.wav`);
  writeMp3(name, buf, '32k');
  rmSync(join(OUT, `${name}.mp3`), { force: true });
  const ogg = join(OUT, `${name}.ogg`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', '48000', '-codec:a', 'libopus', '-b:a', bitrate, ogg]);
  return statSync(ogg).size;
}
const OGG_LOOPS = ['rain', 'drip'];

const only = process.argv.slice(2);
let total = 0;
for (const [name, buf] of Object.entries(sounds)) {
  if (only.length > 0 && !only.includes(name)) continue;
  const clip = name === 'ambient' ? buf : trimTail(buf);
  const size = OGG_LOOPS.includes(name) ? writeOgg(name, buf) : writeMp3(name, clip, name === 'ambient' ? '48k' : '64k');
  total += size;
  console.log(`${name.padEnd(14)} ${(clip.length / SR).toFixed(2)} s  ${(size / 1024).toFixed(1)} KB`);
}
console.log(`total          ${(total / 1024).toFixed(1)} KB`);
rmSync(TMP, { recursive: true, force: true });
