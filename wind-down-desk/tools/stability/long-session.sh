#!/bin/sh
# 45 minutes of lived evening on one page, a memory sample every cycle (≈ 100 s): artifacts/stability/long-session.jsonl
cd "$(dirname "$0")/../.." || exit 1
OUT=artifacts/stability/long-session.jsonl
: > "$OUT"
END=$(( $(date +%s) + ${MINUTES:-45} * 60 ))
while [ "$(date +%s)" -lt "$END" ]; do
  node_modules/.bin/iwsdk browser run tools/stability/long-session.mjs --timeout 108000 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s.slice(s.indexOf('{')));console.log(JSON.stringify(j.ok?j.data.result:{error:j.error?.message}))}catch(e){console.log(JSON.stringify({error:'parse'}))}})" >> "$OUT"
done
