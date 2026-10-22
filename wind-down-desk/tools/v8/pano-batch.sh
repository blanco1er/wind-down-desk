#!/bin/sh
# v8: stage the seated evening once, then check each place on the sphere (6 views + seated) and build a sheet.
# Usage: sh tools/v8/pano-batch.sh <out-dir> <place> [place…]
set -eu
OUT="$1"; shift
B=node_modules/.bin/iwsdk
sh tools/stage.sh 64 10 >/dev/null 2>&1
for P in "$@"; do
  PLACE=$P OUT=$OUT $B browser run tools/v8/pano-check.mjs --timeout 100000 >/dev/null
  (cd "$OUT" && ffmpeg -loglevel error -y -i $P-ahead.png -i $P-left.png -i $P-right.png -i $P-behind.png -i $P-up.png -i $P-down.png \
    -filter_complex "[0]scale=640:-1[a];[1]scale=640:-1[b];[2]scale=640:-1[c];[3]scale=640:-1[d];[4]scale=640:-1[e];[5]scale=640:-1[f];[a][b][c]hstack=3[r1];[d][e][f]hstack=3[r2];[r1][r2]vstack" sheet-$P.jpg)
  echo "$OUT/sheet-$P.jpg"
done
