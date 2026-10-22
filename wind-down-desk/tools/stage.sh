#!/bin/sh
# Stages a seated evening in the emulator for screenshots / recording:
# reload, seat the headset in front of the synthetic room's table, enter XR,
# hands input, film camera (narrower FOV, like a Quest recording crop).
# Usage: sh tools/stage.sh [fovDegrees=58] [pitch=-30]
set -eu
FOV="${1:-58}"
PITCH="${2:-30}"
CLI="npx @iwsdk/cli"
$CLI xr exit >/dev/null 2>&1 || true
$CLI browser reload >/dev/null
sleep 5
for i in 1 2 3 4 5 6; do
  $CLI xr enter >/dev/null 2>&1 || true
  sleep 2
  if $CLI xr status 2>/dev/null | grep -q '"sessionActive": true'; then break; fi
done
$CLI xr set-transform --input-json "{\"device\":\"headset\",\"position\":{\"x\":-0.84,\"y\":1.2,\"z\":0.2},\"orientation\":{\"pitch\":-$PITCH,\"yaw\":90,\"roll\":0}}" >/dev/null
$CLI xr set-input-mode --input-json '{"mode":"hand"}' >/dev/null
sleep 4
WDD_JS="window.__wdd.film?.fov($FOV); window.__wdd.recenter(true); return window.__wdd.state().placement" $CLI browser run tools/wdd-eval.mjs | grep '"result"'
