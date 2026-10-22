#!/bin/sh
# Still of one place with the head raised (horizon in frame): sh tools/look-place.sh <place> <out.png> [pitch=6] [yaw=90]
set -eu
P="$1"; OUT="$2"; PITCH="${3:-6}"; YAW="${4:-90}"
CLI="npx @iwsdk/cli"
WDD_JS="await window.__wdd.place('$P'); await new Promise(r=>setTimeout(r,2400)); return window.__wdd.placeMemory()" $CLI browser run tools/wdd-eval.mjs | grep -o '"result".*' || true
$CLI xr set-transform --input-json "{\"device\":\"headset\",\"position\":{\"x\":-0.84,\"y\":1.2,\"z\":0.2},\"orientation\":{\"pitch\":$PITCH,\"yaw\":$YAW,\"roll\":0}}" >/dev/null
sleep 1.2
$CLI browser screenshot --output-file "$OUT" >/dev/null
echo "$OUT"
