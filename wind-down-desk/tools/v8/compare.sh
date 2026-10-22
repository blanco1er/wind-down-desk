#!/bin/sh
# v8: side by side, reference image (left) | the app in the emulator (right), one JPEG per scene.
# Usage: sh tools/v8/compare.sh <refs dir with ref-NN.png> <shots dir with v8-NN-*.png> <out dir> [suffix]
set -eu
REFS="$1"; SHOTS="$2"; OUT="$3"; SUF="${4:-}"
mkdir -p "$OUT"
for s in "$SHOTS"/v8-*.png; do
  b=$(basename "$s" .png); n=$(echo "$b" | cut -d- -f2)
  r="$REFS/ref-$n.png"
  [ -f "$r" ] || continue
  ffmpeg -loglevel error -y -i "$r" -i "$s" -filter_complex "[0]scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2[a];[1]scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2[b];[a][b]hstack" -q:v 3 "$OUT/compare-$b$SUF.jpg"
done
ls "$OUT"
