#!/bin/sh
# 29 Oct (solidity) — the long session, accelerated: the whole hands-only evening (tools/solidite-29oct/parcours.mjs,
# parts 1–5, ≈ 3.5 min where a real evening takes 10–15) again and again on ONE page (never reloaded), each loop a new
# day (film.day), until MINUTES (45) have passed; after each evening a memory sample (long-sample.mjs).
# Output: artifacts/solidite-29oct/long.jsonl (one line per evening) + long-parts.jsonl (blocks, errors).
set -u
cd "$(dirname "$0")/../.."
CLI=node_modules/.bin/iwsdk
OUT=artifacts/solidite-29oct
mkdir -p "$OUT"
: > "$OUT/long.jsonl"
: > "$OUT/long-parts.jsonl"
j() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const x=JSON.parse(s.slice(s.indexOf('{')));console.log(JSON.stringify(x.ok?x.data.result:{error:x.error?.message??'failed'}))}catch(e){console.log(JSON.stringify({error:'unparsable'}))}})"; }
sh tools/stage.sh 54 30 >/dev/null 2>&1; sleep 2
INSTALL=1 $CLI browser run tools/solidite-29oct/long-sample.mjs 2>&1 | j > /dev/null
$CLI browser run tools/solidite-29oct/long-sample.mjs 2>&1 | j | sed 's/^/{"evening":0,"sample":/; s/$/}/' >> "$OUT/long.jsonl"
END=$(( $(date +%s) + ${MINUTES:-45} * 60 ))
K=0
while [ "$(date +%s)" -lt "$END" ]; do
  K=$((K + 1))
  WDD_JS="window.__wdd.film.day($K); return 1" $CLI browser run tools/wdd-eval.mjs >/dev/null 2>&1
  if ! $CLI xr status 2>/dev/null | grep -q '"sessionActive": true'; then
    for i in 1 2 3 4 5; do $CLI xr enter >/dev/null 2>&1 || true; sleep 2; if $CLI xr status 2>/dev/null | grep -q '"sessionActive": true'; then break; fi; done
    $CLI xr set-transform --input-json '{"device":"headset","position":{"x":-0.84,"y":1.2,"z":0.2},"orientation":{"pitch":-30,"yaw":90,"roll":0}}' >/dev/null
    $CLI xr set-input-mode --input-json '{"mode":"hand"}' >/dev/null
    sleep 2
    WDD_JS="window.__wdd.film?.fov(54); window.__wdd.recenter(true); return 1" $CLI browser run tools/wdd-eval.mjs >/dev/null 2>&1
    sleep 3
  fi
  for P in 1 2 3 4 5; do
    PART=$P $CLI browser run tools/solidite-29oct/parcours.mjs --timeout 108000 2>&1 | j | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);const blocks=(r.log??[]).filter(l=>String(l.step).startsWith('BLOCKED')).map(l=>l.step);console.log(JSON.stringify({evening:$K,part:$P,seconds:r.seconds,blocks,errors:(r.errors??[]).filter(e=>e.type!=='warning'),misses:r.hands?.pokeMisses?.length??null,fallbacks:(r.log??[]).flatMap(l=>l.streamFallbacks??[]),draws:r.draws,error:r.error}))})" >> "$OUT/long-parts.jsonl"
  done
  $CLI browser run tools/solidite-29oct/long-sample.mjs 2>&1 | j | sed "s/^/{\"evening\":$K,\"sample\":/; s/\$/}/" >> "$OUT/long.jsonl"
  tail -1 "$OUT/long.jsonl" | cut -c1-260
done
