#!/bin/sh
# 29 Oct (solidity) — perf at CPU ×4 and ×6 in the key moments, ONLY on a quiet Mac (1-min load < 3, as asked:
# other agents share this machine and double the CPU times). The load is written with the results.
# Output: artifacts/solidite-29oct/perf.json
set -u
cd "$(dirname "$0")/../.."
CLI=node_modules/.bin/iwsdk
LOAD=$(uptime | sed 's/.*load averages*: *//; s/,/ /g' | awk '{print $1}')
if [ "$(echo "$LOAD < 3" | bc)" != "1" ]; then echo "{\"refused\":\"load $LOAD >= 3\"}"; exit 2; fi
sh tools/stage.sh 54 30 >/dev/null 2>&1; sleep 3
j() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const x=JSON.parse(s.slice(s.indexOf('{')));console.log(JSON.stringify(x.ok?x.data.result:{error:x.error?.message}))}catch(e){console.log('{\"error\":\"unparsable\"}')}})"; }
A=$(STATES=arrival,unload,place,breathe $CLI browser run tools/solidite-29oct/perf.mjs --timeout 108000 2>&1 | j)
LOAD2=$(uptime | sed 's/.*load averages*: *//; s/,/ /g' | awk '{print $1}')
B=$(STATES=squeeze,keep,journal,night $CLI browser run tools/solidite-29oct/perf.mjs --timeout 108000 2>&1 | j)
LOAD3=$(uptime | sed 's/.*load averages*: *//; s/,/ /g' | awk '{print $1}')
mkdir -p artifacts/solidite-29oct
printf '{"loadBefore":%s,"loadMiddle":%s,"loadAfter":%s,"at":"%s","first":%s,"second":%s}\n' "$LOAD" "$LOAD2" "$LOAD3" "$(date '+%Y-%m-%d %H:%M')" "$A" "$B" > artifacts/solidite-29oct/perf.json
node -e "const r=require('./artifacts/solidite-29oct/perf.json');console.log('load',r.loadBefore,r.loadMiddle,r.loadAfter,r.at);for(const x of [...(Array.isArray(r.first)?r.first:[r.first]),...(Array.isArray(r.second)?r.second:[r.second])])console.log(JSON.stringify(x))"
