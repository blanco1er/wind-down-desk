// Pre-renders the lamp's voice lines with Kokoro-82M (Apache-2.0), locally, then checks each line with
// Whisper (transformers.js, local). No paid call; no network at runtime (files ship in public/voice/).
//   KOKORO_DIR=<folder with node_modules/kokoro-js> node tools/make-voice.mjs [voice=af_heart] [speed=0.9]
// Output: public/voice/<fnv>.mp3 (mono, 24 kHz, 48 kb/s) + public/voice/lines.json (file, seconds, loudness envelope at 30 Hz).
// WDD_VOICE_ONLY_NEW=1: keeps every clip already in lines.json and renders only the new lines (v6 rituals).
// Needs ffmpeg on PATH (mp3 encode). First run downloads the models from Hugging Face (≈ 330 MB fp32 + 290 MB Whisper base.en).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lampLines, lineFile, lineKey, speakable, ENVELOPE_HZ } from '../src/logic/lamp-lines.ts';

const voice = process.argv[2] ?? 'af_heart';
const speed = Number(process.argv[3] ?? 0.9);
const dir = process.env.KOKORO_DIR;
if (!dir) {
  console.error('Set KOKORO_DIR to a folder where `npm i kokoro-js` was run.');
  process.exit(1);
}
const require = createRequire(join(dir, 'package.json'));
const pick = (m, name) => m[name] ?? m.default?.[name];
const KokoroTTS = pick(await import(require.resolve('kokoro-js')), 'KokoroTTS');
const pipeline = pick(await import(require.resolve('@huggingface/transformers')), 'pipeline');

const out = join(process.cwd(), 'public', 'voice');
mkdirSync(out, { recursive: true });
const tmp = join(tmpdir(), `wdd-voice-${process.pid}`);
mkdirSync(tmp, { recursive: true });

const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'fp32', device: 'cpu' });
const asr = process.env.WDD_SKIP_ASR === '1' ? null : await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base.en', { dtype: 'fp32' });

function trim(samples, rate) {
  const win = Math.round(rate * 0.01);
  const thr = 0.008;
  let a = 0;
  let b = samples.length;
  const loud = (i) => {
    let s = 0;
    for (let k = i; k < Math.min(samples.length, i + win); k++) s += samples[k] * samples[k];
    return Math.sqrt(s / win) > thr;
  };
  while (a < b && !loud(a)) a += win;
  while (b > a && !loud(Math.max(0, b - win))) b -= win;
  a = Math.max(0, a - Math.round(rate * 0.04));
  b = Math.min(samples.length, b + Math.round(rate * 0.12));
  const outS = samples.slice(a, b);
  const fade = Math.round(rate * 0.012);
  for (let i = 0; i < fade && i < outS.length; i++) {
    outS[i] *= i / fade;
    outS[outS.length - 1 - i] *= i / fade;
  }
  return outS;
}

function normalize(samples) {
  // RMS of the voiced part to ≈ −20 dBFS, peaks kept under −1.5 dBFS.
  let s = 0;
  let n = 0;
  let peak = 0;
  for (const v of samples) {
    const a = Math.abs(v);
    peak = Math.max(peak, a);
    if (a > 0.01) {
      s += v * v;
      n++;
    }
  }
  const rms = Math.sqrt(s / Math.max(1, n));
  const gain = Math.min(0.1 / Math.max(rms, 1e-4), 0.84 / Math.max(peak, 1e-4));
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}

function envelope(samples, rate) {
  const hop = rate / ENVELOPE_HZ;
  const env = [];
  for (let i = 0; i < samples.length; i += hop) {
    let s = 0;
    const end = Math.min(samples.length, Math.round(i + hop));
    for (let k = Math.round(i); k < end; k++) s += samples[k] * samples[k];
    env.push(Math.sqrt(s / Math.max(1, end - Math.round(i))));
  }
  const peak = Math.max(...env, 1e-6);
  return env.map((v) => Math.round(Math.min(1, (v / peak) ** 0.8) * 100) / 100);
}

function wav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}

function resample16k(samples, rate) {
  const ratio = rate / 16000;
  const outS = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < outS.length; i++) {
    const x = i * ratio;
    const k = Math.floor(x);
    outS[i] = samples[k] + ((samples[k + 1] ?? 0) - samples[k]) * (x - k);
  }
  return outS;
}

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
// Digits and words count the same ("2 left" = "two left"); "two"/"to" is a Whisper ambiguity, not the voice.
const words = (t) => lineKey(t).split(' ').filter(Boolean).map((w) => (/^\d$/u.test(w) ? DIGITS[Number(w)] : w === 'to' || w === 'too' ? 'two' : w));
const onlyNew = process.env.WDD_VOICE_ONLY_NEW === '1';
const previous = onlyNew && existsSync(join(out, 'lines.json')) ? JSON.parse(readFileSync(join(out, 'lines.json'), 'utf8')).lines : {};
const previousReport = onlyNew && existsSync(join(process.cwd(), 'artifacts', 'voice-check.json')) ? JSON.parse(readFileSync(join(process.cwd(), 'artifacts', 'voice-check.json'), 'utf8')) : [];
const manifest = { ...previous };
const report = previousReport.filter((r) => previous[lineKey(r.line)] != null && lampLines().some((l) => lineKey(l) === lineKey(r.line)));
const lines = lampLines().filter((l) => previous[lineKey(l)] == null);
console.log(`${lines.length} line(s) to render${onlyNew ? ' (only new)' : ''}`);
for (const line of lines) {
  const audio = await tts.generate(speakable(line), { voice, speed });
  const rate = audio.sampling_rate;
  const samples = normalize(trim(Float32Array.from(audio.audio), rate));
  const file = lineFile(line);
  const w = join(tmp, file.replace('.mp3', '.wav'));
  writeFileSync(w, wav(samples, rate));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', w, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '48k', join(out, file)]);
  manifest[lineKey(line)] = { file, seconds: Math.round((samples.length / rate) * 1000) / 1000, envelope: envelope(samples, rate) };
  let heard = '';
  let score = 1;
  if (asr != null) {
    const r = await asr(resample16k(samples, rate));
    heard = r.text.trim();
    const want = words(line);
    const got = new Set(words(heard));
    score = want.filter((x) => got.has(x)).length / Math.max(1, want.length);
  }
  report.push({ line, file, seconds: manifest[lineKey(line)].seconds, heard, score: Math.round(score * 100) / 100 });
  process.stdout.write(`${score < 0.8 ? '!!' : 'ok'} ${Math.round(score * 100)}% ${line}  →  ${heard}\n`);
}
writeFileSync(join(out, 'lines.json'), JSON.stringify({ voice, speed, model: 'Kokoro-82M v1.0 (Apache-2.0)', lines: manifest }));
writeFileSync(join(process.cwd(), 'artifacts', 'voice-check.json'), JSON.stringify(report, null, 1));
rmSync(tmp, { recursive: true, force: true });
const weak = report.filter((r) => r.score < 0.8);
console.log(JSON.stringify({ lines: report.length, weak: weak.length, seconds: report.reduce((s, r) => s + r.seconds, 0) }));
