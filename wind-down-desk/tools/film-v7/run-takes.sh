#!/bin/sh
# Shoots several v7 takes one after the other (each: reload + enter XR + seat, then the take).
#   sh tools/film-v7/run-takes.sh open release breathe places voice raw sky
cd "$(dirname "$0")/../.."
for shot in "$@"; do
  echo "== $shot $(date +%T) load $(uptime | sed 's/.*averages: //')"
  sh tools/stage.sh 54 30 >/dev/null 2>&1
  SHOT=$shot node_modules/.bin/iwsdk browser run tools/film-v7/shoot.mjs --timeout 108000 2>&1 | tr -s ' \n' ' ' | grep -o '"shot.*"mode": "[a-z]*"' || echo "!! $shot failed"
done
echo "== all done $(date +%T)"
