#!/bin/sh
# 29 Oct (solidity) — `npm run parcours`: the whole evening with hands only in the emulator (real fingertip pokes and
# pinches, never a sentence), on a fresh memory (first evening), then the report.
#   MIC=denied (default: microphone refused) | listening (allowed, the person simply never speaks) | off
# Needs the headless emulator of this folder: npx @iwsdk/cli dev up --headless --ai-mode agent --allow-browser-automation
# Output: artifacts/solidite-29oct/parcours-<mic>.json (+ the summary on stdout, also in parcours-<mic>.txt).
set -u
cd "$(dirname "$0")/../.."
MIC="${MIC:-denied}"
OUT=artifacts/solidite-29oct
mkdir -p "$OUT"
CLI=node_modules/.bin/iwsdk
SINCE=$(node -e 'console.log(Date.now())')
# Fresh memory and the default style (Quiet NOT chosen), then the seated stage.
WDD_JS="localStorage.removeItem('wind-down-desk.memory.v1'); localStorage.removeItem('wdd.style'); localStorage.removeItem('wdd.voice'); localStorage.removeItem('wdd.mix'); return 1" $CLI browser run tools/wdd-eval.mjs >/dev/null 2>&1 || true
sh tools/stage.sh 54 30 >/dev/null 2>&1 || true
sleep 2
JSON="$OUT/parcours-$MIC.json"
echo '[' > "$JSON"
for P in 1 2 3 4 5; do
  [ "$P" -gt 1 ] && echo ',' >> "$JSON"
  PART=$P MIC=$MIC $CLI browser run tools/solidite-29oct/parcours.mjs --timeout 108000 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s.slice(s.indexOf('{')));console.log(JSON.stringify(j.ok?j.data.result:{part:$P,error:j.error?.message??'failed'}))}catch(e){console.log(JSON.stringify({part:$P,error:'unparsable output',raw:s.slice(0,400)}))}})" >> "$JSON"
done
echo ']' >> "$JSON"
# Everything the page logged as an error since the start (the CLI's own console capture, all frames).
$CLI browser logs --input-json "{\"level\":[\"error\"],\"since\":$SINCE}" > "$OUT/parcours-$MIC-console.json" 2>&1 || true
node tools/solidite-29oct/report.mjs "$JSON" "$OUT/parcours-$MIC-console.json" | tee "$OUT/parcours-$MIC.txt"
