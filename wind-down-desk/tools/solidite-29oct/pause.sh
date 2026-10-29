#!/bin/sh
# 29 Oct (solidity) — pause / resume in the emulator: the Meta button, a hidden page, hands lost, leaving XR and
# coming back mid-evening. Results: artifacts/solidite-29oct/pause.json
set -u
cd "$(dirname "$0")/../.."
CLI=node_modules/.bin/iwsdk
run() { PHASE=$1 $CLI browser run tools/solidite-29oct/pause.mjs --timeout 108000 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s.slice(s.indexOf('{')));console.log(JSON.stringify(j.ok?j.data.result:{error:j.error}))}catch(e){console.log(JSON.stringify({error:s.slice(0,400)}))}})"; }
sh tools/stage.sh 54 30 >/dev/null 2>&1; sleep 2
A=$(run a)
sh tools/stage.sh 54 30 >/dev/null 2>&1; sleep 2
B1=$(run b1)
$CLI xr exit >/dev/null 2>&1; sleep 4
EXITED=$(WDD_JS="return { placement: window.__wdd.state().placement, clock: window.__wdd.clock() }" $CLI browser run tools/wdd-eval.mjs 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.stringify(JSON.parse(s.slice(s.indexOf('{'))).data.result))}catch{console.log('null')}})")
for i in 1 2 3 4 5; do $CLI xr enter >/dev/null 2>&1 || true; sleep 2; if $CLI xr status 2>/dev/null | grep -q '"sessionActive": true'; then break; fi; done
$CLI xr set-transform --input-json '{"device":"headset","position":{"x":-0.84,"y":1.2,"z":0.2},"orientation":{"pitch":-30,"yaw":90,"roll":0}}' >/dev/null
$CLI xr set-input-mode --input-json '{"mode":"hand"}' >/dev/null
sleep 2
B2=$(run b2)
mkdir -p artifacts/solidite-29oct
printf '{"a":%s,"b1":%s,"exited":%s,"b2":%s}\n' "$A" "$B1" "$EXITED" "$B2" | tee artifacts/solidite-29oct/pause.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s),null,1)))"
