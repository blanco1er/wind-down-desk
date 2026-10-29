#!/bin/sh
# 29 Oct (solidity) — N evenings with NO instrumentation (no listener counter, no CDP network, no parcours scripts):
# an in-page autopilot plays them; the shell only re-enters XR and keeps the render loop running. Heap (after GC)
# at the start and at the end; the few `browser run` calls are counted (each injects a JS context: ≈ 0.3 MB).
set -u
cd "$(dirname "$0")/../.."
CLI=node_modules/.bin/iwsdk
N="${1:-3}"
RUNS=0
j() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const x=JSON.parse(s.slice(s.indexOf('{')));console.log(JSON.stringify(x.ok?x.data.result:{error:x.error?.message}))}catch(e){console.log('{\"error\":\"unparsable\"}')}})"; }
sh tools/stage.sh 54 30 >/dev/null 2>&1; sleep 3
$CLI xr exit >/dev/null 2>&1; sleep 2
START=$(MODE=install $CLI browser run tools/solidite-29oct/autopilot.mjs --timeout 108000 2>&1 | j); RUNS=$((RUNS+1))
WDD_N=$N
while :; do
  if ! $CLI xr status 2>/dev/null | grep -q '"sessionActive": true'; then
    for i in 1 2 3 4 5; do $CLI xr enter >/dev/null 2>&1 || true; sleep 2; if $CLI xr status 2>/dev/null | grep -q '"sessionActive": true'; then break; fi; done
    $CLI xr set-transform --input-json '{"device":"headset","position":{"x":-0.84,"y":1.2,"z":0.2},"orientation":{"pitch":-30,"yaw":90,"roll":0}}' >/dev/null
    $CLI xr set-input-mode --input-json '{"mode":"hand"}' >/dev/null
  fi
  ST=$(MODE=keep $CLI browser run tools/solidite-29oct/autopilot.mjs --timeout 108000 2>&1 | j); RUNS=$((RUNS+1))
  echo "$ST"
  DONE=$(echo "$ST" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).done??0)}catch{console.log(0)}})")
  [ "$DONE" -ge "$WDD_N" ] && break
done
END=$(MODE=read $CLI browser run tools/solidite-29oct/autopilot.mjs --timeout 108000 2>&1 | j); RUNS=$((RUNS+1))
printf '{"start":%s,"end":%s,"browserRuns":%s}\n' "$START" "$END" "$RUNS" | tee artifacts/solidite-29oct/sans-instrument.json
