// Lays the app's real audio under the silent screencast video: every voice line and sound cue the app
// played (logged by the app, see capture-evening-v5.mjs → audio.json), at the moment it played, plus the
// ambient bed, then loudness-normalised (−16 LUFS). Nothing is added that the app did not play.
//   node tools/mix-audio.mjs <frames-dir> <video-in.mp4> <video-out.mp4>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, input, output] = process.argv.slice(2);
const frames = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
const { events } = JSON.parse(readFileSync(join(dir, 'audio.json'), 'utf8'));
const first = frames[0].t;
const duration = frames.at(-1).t - first + 0.5;
const pub = join(process.cwd(), 'public');
const args = ['-v', 'error', '-y', '-i', input, '-stream_loop', '-1', '-i', join(pub, 'audio', 'ambient.mp3')];
const parts = ['[1:a]volume=0.16,atrim=0:' + duration.toFixed(2) + '[bed]'];
const labels = ['[bed]'];
let n = 2;
for (const e of events) {
  const at = e.at - first;
  if (at < -0.2 || at > duration) continue;
  args.push('-i', join(pub, e.src));
  const ms = Math.max(0, Math.round(at * 1000));
  parts.push(`[${n}:a]aresample=48000,adelay=${ms}|${ms},volume=${e.volume}[a${n}]`);
  labels.push(`[a${n}]`);
  n++;
}
parts.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5:LRA=11[mix]`);
args.push('-filter_complex', parts.join(';'), '-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-shortest', '-movflags', '+faststart', output);
execFileSync('ffmpeg', args, { stdio: 'inherit' });
console.log(JSON.stringify({ output, events: n - 2, seconds: Math.round(duration * 10) / 10 }));
