#!/bin/sh
# Contact sheet for checking takes: sh tools/film-v8/sheet.sh <out.jpg> <cols> <tile-width> <img>...
set -eu
OUT="$1"; COLS="$2"; W="$3"; shift 3
N=$#; IN=""; F=""; i=0
for f in "$@"; do IN="$IN -i $f"; F="$F[$i]scale=$W:-2[v$i];"; i=$((i+1)); done
ROWS=$(( (N + COLS - 1) / COLS )); R=""; r=0
while [ $r -lt $ROWS ]; do
  L=""; c=0
  while [ $c -lt $COLS ]; do k=$((r*COLS+c)); if [ $k -lt $N ]; then L="$L[v$k]"; else L="$L[v$((N-1))]"; fi; c=$((c+1)); done
  F="$F${L}hstack=$COLS[r$r];"; R="$R[r$r]"; r=$((r+1))
done
if [ $ROWS -gt 1 ]; then F="$F${R}vstack=$ROWS"; else F="${F%;}"; F="${F%\[r0\]}"; fi
# shellcheck disable=SC2086
ffmpeg -loglevel error -y $IN -filter_complex "$F" "$OUT"
