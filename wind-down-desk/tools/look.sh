#!/bin/sh
# Quick look: stage, brain dump, sort three stones, capture key moments to $OUT (dir).
set -eu
OUT="${1:-/tmp/wdd-look}"
mkdir -p "$OUT"
CLI="npx @iwsdk/cli"
shot() { $CLI browser screenshot --output-file "$OUT/$1.png" >/dev/null; }
sh tools/stage.sh "${FOV:-54}" "${PITCH:-30}" >/dev/null
sleep 1
shot a-empty
WDD_JS="await window.__wdd.say(\"I still haven't replied to the landlord about the heating. And I need to book the dentist, it's been a year.\"); await new Promise(r=>setTimeout(r,1500)); await window.__wdd.say(\"The slides for Monday aren't done. I keep replaying that awkward comment I made in the meeting. Oh, and my passport expires in March.\"); await new Promise(r=>setTimeout(r,2500)); return 1" $CLI browser run tools/wdd-eval.mjs >/dev/null
shot b-stones
WDD_GRAB='{"id":"t1","bin":"tomorrow"}' $CLI browser run tools/emu-grab.mjs >/dev/null
sleep 1
WDD_GRAB='{"id":"t5","bin":"later"}' $CLI browser run tools/emu-grab.mjs >/dev/null
sleep 1
shot c-sorted
WDD_GRAB='{"id":"t4","bin":"let-go"}' $CLI browser run tools/emu-grab.mjs >/dev/null
sleep 0.6
shot d-letgo1
sleep 0.7
shot d-letgo2
sleep 1.2
shot d-letgo3
say() { WDD_JS="await window.__wdd.say(\"$1\"); return 1" $CLI browser run tools/wdd-eval.mjs >/dev/null; }
sleep 1
say "Dentist, tomorrow."
sleep 1.5
say "Slides for Monday, tomorrow too."
sleep 3
shot e-plan
say "Keep it."
sleep 4
shot f-night
