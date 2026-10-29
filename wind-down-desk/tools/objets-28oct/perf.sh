#!/bin/sh
# Perf probe of the evening with stones on the desk, keepsakes and the glass lamp (CPU ×1 / ×6), with the load noted.
# Usage: sh tools/objets-28oct/perf.sh <out.json>
set -eu
cd "$(dirname "$0")/../.."
. tools/film-v8/lib.sh
fresh 21
ev 'await new Promise(r=>setTimeout(r,9000)); return 1'
ev "$DUMP"
view '{"fov":54,"aim":[0.06,0.03,-0.03],"back":0.02,"up":-0.03}'
LOAD="$(uptime | sed 's/.*load averages*: //')"
WDD_RATES='[1,6]' WDD_WINDOW_MS=8000 $B browser run tools/perf-probe.mjs --timeout 100000 > "$1.raw"
node -e '
const fs=require("fs");const raw=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const r=raw.data?.result??raw.result??raw;
fs.writeFileSync(process.argv[2],JSON.stringify({load:process.argv[3],...r},null,1));
for(const x of r.results) console.log(JSON.stringify(x).slice(0,600));' "$1.raw" "$1" "$LOAD"
echo "load: $LOAD"
