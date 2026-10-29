#!/bin/sh
# Before/after captures of the hands (28 Oct). Run from wind-down-desk/ with the headless emulator up.
# Usage: sh tools/hands-28oct/shots.sh <outdir> [prefix]
set -eu
OUT="$1"; P="${2:-}"
mkdir -p "$OUT"
B=node_modules/.bin/iwsdk
ev() { WDD_JS="$1" $B browser run tools/wdd-eval.mjs >/dev/null; }
sc() { SCENE="$1" $B browser run tools/hands-28oct/scene.mjs | grep -o '"result".*' | head -c 200; echo; }
shot() { $B browser screenshot --output-file "$1" >/dev/null; sleep 0.4; $B browser screenshot --output-file "$1" >/dev/null; }
sh tools/stage.sh 54 30 >/dev/null
sc setup
sc rest;    shot "$OUT/${P}1-main-posee.png"
sc pinch;   shot "$OUT/${P}2-pincement.png"
ev 'void window.__wdd.say("breathe"); await new Promise(r=>setTimeout(r,5000)); return 1'
sc breathe; shot "$OUT/${P}3-breathe-mains-ouvertes.png"
ev 'void window.__wdd.say("enough"); await new Promise(r=>setTimeout(r,2500)); void window.__wdd.say("take me to the lake"); await new Promise(r=>setTimeout(r,6000)); void window.__wdd.say("full immersion"); await new Promise(r=>setTimeout(r,5000)); return 1'
sc full;    shot "$OUT/${P}4-lieu-full.png"
# The onboarding guide hand (posed directly on the first stone): open, half pinched, pinched.
sh tools/stage.sh 54 30 >/dev/null
sc setup
for k in 0 0.6 1; do sc "ghost$k"; shot "$OUT/${P}5-main-guide-$k.png"; done
