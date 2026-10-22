#!/bin/sh
# Legibility check of the bowl names at the seated viewing distance, in your room and in each place.
# Film camera 54° vertical on 1080 px ≈ 20 px/degree, close to a Quest 3 eye buffer (≈ 20–25 px/degree),
# so a 1:1 crop is roughly what the headset shows. Output: $OUT/<place>.png (full) and $OUT/<place>-bowls.png (crop).
# Usage: OUT=artifacts/labels-v5 sh tools/label-check.sh
set -eu
OUT="${OUT:-/tmp/wdd-labels}"
mkdir -p "$OUT"
CLI="npx @iwsdk/cli"
sh tools/stage.sh 54 26 >/dev/null
WDD_JS="await window.__wdd.say(\"I still haven't replied to the landlord about the heating. And I need to book the dentist, it's been a year.\"); await new Promise(r=>setTimeout(r,1500)); await window.__wdd.say(\"The slides for Monday aren't done. Oh, and my passport expires in March.\"); await new Promise(r=>setTimeout(r,3200)); return 1" $CLI browser run tools/wdd-eval.mjs >/dev/null
for P in room lake garden hilltop; do
  WDD_JS="await window.__wdd.place('$P'); await new Promise(r=>setTimeout(r,2600)); return 1" $CLI browser run tools/wdd-eval.mjs >/dev/null
  $CLI browser screenshot --output-file "$OUT/$P.png" >/dev/null
  ffmpeg -v error -y -i "$OUT/$P.png" -vf "crop=${CROP:-1120:250:420:560}" "$OUT/$P-bowls.png"
done
WDD_JS="await window.__wdd.place('room'); return 1" $CLI browser run tools/wdd-eval.mjs >/dev/null
echo "$OUT"
