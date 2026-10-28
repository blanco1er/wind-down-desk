#!/bin/sh
# Shoots several v8 takes one after the other. Each take: reload + enter XR + seat (tools/stage.sh), then the take;
# except `return`, which needs the real arrival: seeded history, reload, and the take itself enters XR from the
# landing page. Never run a Blender render (or another heavy job) at the same time: the 4K screencast drops frames.
#   sh tools/film-v8/run-takes.sh unload open release breathe globe return quiet raw
cd "$(dirname "$0")/../.."
B=node_modules/.bin/iwsdk
for shot in "$@"; do
  echo "== $shot $(date +%T) load $(uptime | sed 's/.*averages: //')"
  if [ "$shot" = return ]; then
    $B xr exit >/dev/null 2>&1 || true
    $B browser reload >/dev/null
    sleep 6
  else
    sh tools/stage.sh 54 30 >/dev/null 2>&1
  fi
  SHOT=$shot $B browser run tools/film-v8/shoot.mjs --timeout 108000 2>&1 | tr -s ' \n' ' ' | grep -o '"shot.*"mode": "[a-z]*"' || echo "!! $shot failed"
done
echo "== all done $(date +%T)"
