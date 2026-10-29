// 29 Oct (solidity): the hands-only run's report — every step with its time, blocks, real touches vs misses,
// console errors, draw calls per eye at each key moment (budget 25).
import { readFileSync } from 'node:fs';
const parts = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let consoleErrors = [];
try {
  const c = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const entries = c?.data?.logs ?? c?.data?.entries ?? c?.data?.result ?? c?.data ?? [];
  consoleErrors = (Array.isArray(entries) ? entries : []).map((e) => e.text ?? e.message ?? JSON.stringify(e)).filter((t) => t != null);
} catch {}
const lines = [];
let blocked = 0, pokes = 0, misses = [], grabs = 0, grabMisses = [], slides = 0, seconds = 0, errs = [];
const draws = {};
for (const p of parts) {
  if (p.error) { lines.push(`PART ${p.part}: SCRIPT ERROR ${p.error}`); blocked++; continue; }
  seconds += p.seconds;
  lines.push(`— Part ${p.part} (${p.seconds} s)`);
  for (const l of p.log) {
    if (String(l.step).startsWith('BLOCKED')) blocked++;
    const extra = Object.entries(l).filter(([k]) => !['s', 'step', 'mode', 'phase'].includes(k)).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
    lines.push(`  ${String(l.s).padStart(5)} s  ${l.step}  [${l.mode}/${l.phase}]${extra ? `  ${extra.slice(0, 220)}` : ''}`);
  }
  pokes += p.hands.pokes; misses.push(...p.hands.pokeMisses); grabs += p.hands.grabs; grabMisses.push(...p.hands.grabMisses); slides += p.hands.slides;
  errs.push(...p.errors);
  Object.assign(draws, p.draws);
}
lines.unshift(`Hands-only run: ${blocked === 0 ? 'NO BLOCK' : `${blocked} BLOCK(S)`}, ${seconds.toFixed(0)} s of scripts`);
lines.push('');
lines.push(`Real fingertip pokes: ${pokes}; misses: ${misses.length}${misses.length ? ` ${JSON.stringify(misses)}` : ''}`);
lines.push(`Pinches into a bowl: ${grabs}; misses: ${grabMisses.length}${grabMisses.length ? ` ${JSON.stringify(grabMisses)}` : ''}; fingertip slides on a rail: ${slides}`);
const errOnly = errs.filter((e) => e.type !== 'warning' && e.type !== 'requestfailed');
const failedReq = errs.filter((e) => e.type === 'requestfailed');
lines.push(`Failed requests (page network): ${failedReq.length}${failedReq.length ? `\n  ${failedReq.map((e) => `${e.s}s after "${e.after}": ${e.text}`).join('\n  ')}` : ''}`);
lines.push(`Console errors (page listener): ${errOnly.length}${errOnly.length ? `\n  ${errOnly.map((e) => `${e.s}s ${e.text}`).join('\n  ')}` : ''}; warnings: ${errs.filter((e) => e.type === 'warning').length}`);
lines.push(`Console errors (CLI capture since start): ${consoleErrors.length}${consoleErrors.length ? `\n  ${consoleErrors.slice(0, 12).join('\n  ')}` : ''}`);
lines.push('Draw calls per eye — emulator p50 / max, then on the headset (without the emulator-only room photo and table); budget 25:');
for (const [k, v] of Object.entries(draws)) {
  lines.push(`  ${v.device > 25 ? 'OVER ' : '     '}${k.padEnd(34)} ${v.perEyeP50} / ${v.perEyeMax}  → headset ${v.device}   triangles ${v.triangles}${v.xr ? '' : '  (not in XR!)'}`);
  if (v.who) for (const w of v.who) lines.push(`         ${w}`);
}
console.log(lines.join('\n'));
