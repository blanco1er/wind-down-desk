#!/bin/sh
# Tune the ghost hand's base orientation (dev only): sh tools/onboarding/ghost-shot.sh "[x,y,z]" /abs/out.jpg
set -eu
CLI="node_modules/.bin/iwsdk"
D=/tmp/wdd-ghost
WDD_JS="localStorage.setItem('tune.ghost', '$1'); return 1" $CLI browser run tools/wdd-eval.mjs >/dev/null
WDD_SECONDS=17 sh tools/onboarding/cold-run.sh silent-talk "$D" 0 >/dev/null 2>&1
P=$(node -e 'const d=process.argv[1]; const f=JSON.parse(require("fs").readFileSync(d+"/frames-silent-talk/index.json","utf8")); const pick=t=>f.reduce((a,b)=>Math.abs(b.t-t)<Math.abs(a.t-t)?b:a); console.log([13.0,13.5,14.2,14.9].map(t=>d+"/frames-silent-talk/"+pick(t).name).join(" "))' "$D")
set -- $P "$2"
ffmpeg -y -loglevel error -i "$1" -i "$2" -i "$3" -i "$4" -filter_complex "[0:v]crop=640:300:320:200[a];[1:v]crop=640:300:320:200[b];[2:v]crop=640:300:320:200[c];[3:v]crop=640:300:320:200[d];[a][b][c][d]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[out]" -map "[out]" "$5"
