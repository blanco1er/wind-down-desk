#!/bin/sh
# One cold first minute in the emulator: forget everything (memory, style, anchors), reload, play a scenario, make a video.
# Usage: sh tools/onboarding/cold-run.sh <silent-talk|silent-quiet|judge> <outDir> [hour]
set -eu
SCEN="${1:-silent-talk}"; OUT="${2:-artifacts/onboarding/before}"; HOUR="${3:-}"
CLI="node_modules/.bin/iwsdk"
$CLI xr exit >/dev/null 2>&1 || true
WDD_JS='for (const k of Object.keys(localStorage)) if (/^(wind-down-desk|wdd\.|iwsdk_|@immersive-web)/.test(k) && k !== "wdd.internal") localStorage.removeItem(k); return 1' $CLI browser run tools/wdd-eval.mjs >/dev/null
$CLI browser reload >/dev/null
sleep 7
mkdir -p "$OUT"
WDD_SCENARIO="$SCEN" WDD_OUT="$OUT/frames-$SCEN" WDD_HOUR="$HOUR" $CLI browser run tools/onboarding/cold-minute.mjs --timeout 108000 > "$OUT/$SCEN.json"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const d=r.data?.result ?? r; console.log(JSON.stringify({firstSortAt:d.firstSortAt, frames:d.frames, error:r.error?.message}))' "$OUT/$SCEN.json"
CRF=26 sh tools/frames-to-video.sh "$OUT/$SCEN.mp4" "$OUT/frames-$SCEN" >/dev/null
echo "$OUT/$SCEN.mp4"
