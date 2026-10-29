#!/bin/sh
# 29 Oct: one scene, staged fresh (reload, seated, a fortnight of evenings in memory), then the stills.
# Usage: sh tools/finition-29oct/run.sh <avant|apres> <scene>
set -eu
cd "$(dirname "$0")/../.."
sh tools/stage.sh 54 30 >/dev/null
WDD_JS="const r = window.__wdd.film.history(14); window.__wdd.arrive(); return r" npx @iwsdk/cli browser run tools/wdd-eval.mjs | grep '"result"' || true
sleep 4
PHASE="$1" SCENE="$2" npx @iwsdk/cli browser run tools/finition-29oct/shots.mjs --timeout 108000 | grep -v '^\s*$' | tail -40
