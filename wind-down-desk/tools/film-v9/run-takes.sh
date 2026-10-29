#!/bin/sh
# Shoots v9 takes one after the other: each starts from a fresh stage (reload, seated, XR, hands), except `unload`,
# which continues `arrive` on the same page. Never run a heavy job at the same time (the screencast drops frames).
#   sh tools/film-v9/run-takes.sh seed arrive unload open release breathe keep journal places night busstop raw
cd "$(dirname "$0")/../.."
B=node_modules/.bin/iwsdk
for shot in "$@"; do
  echo "== $shot $(date +%T) load $(uptime | sed 's/.*averages: //')"
  if [ "$shot" != unload ]; then sh tools/stage.sh 54 30 >/dev/null 2>&1; fi
  SHOT=$shot $B browser run tools/film-v9/shoot.mjs --timeout 108000 2>&1 | tr -s ' \n' ' ' | grep -o '"shot.*' | cut -c1-900 || echo "!! $shot failed"
done
echo "== all done $(date +%T)"
