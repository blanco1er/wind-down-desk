#!/bin/sh
# Quick still for art iteration: stage (FOV, pitch), brain dump, screenshot to $1.
# Usage: sh tools/quick-look.sh out.png [fov=54] [pitch=27] [extraJs]
set -eu
OUT="$1"; FOV="${2:-54}"; PITCH="${3:-27}"; EXTRA="${4:-}"
CLI="npx @iwsdk/cli"
sh tools/stage.sh "$FOV" "$PITCH" >/dev/null
WDD_JS="await window.__wdd.say(\"I still haven't replied to the landlord about the heating. And I need to book the dentist, it's been a year.\"); await new Promise(r=>setTimeout(r,1500)); await window.__wdd.say(\"The slides for Monday aren't done. I keep replaying that awkward comment I made in the meeting. Oh, and my passport expires in March.\"); await new Promise(r=>setTimeout(r,3200)); $EXTRA; return 1" $CLI browser run tools/wdd-eval.mjs >/dev/null
$CLI browser screenshot --output-file "$OUT" >/dev/null
echo "$OUT"
