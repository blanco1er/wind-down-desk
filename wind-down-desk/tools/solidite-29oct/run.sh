#!/bin/sh
# 29 Oct (solidity): runs one browser script on a fresh stage and prints its result as compact JSON lines.
# Usage: sh tools/solidite-29oct/run.sh <script.mjs> [--no-stage]   (env passes through: MIC=denied, etc.)
set -eu
cd "$(dirname "$0")/../.."
if [ "${2:-}" != "--no-stage" ]; then sh tools/stage.sh 54 30 >/dev/null 2>&1 || true; sleep 2; fi
node_modules/.bin/iwsdk browser run "$1" --timeout 108000 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s.slice(s.indexOf('{')));const r=j.data?.result;if(r==null){console.log(JSON.stringify(j.error??j).slice(0,3000));process.exit(1)}console.log(JSON.stringify(r))}catch(e){console.log(s.slice(0,3000));process.exit(1)}})"
