#!/bin/sh
# 22 Oct: a new evening in the emulator WITHOUT recentering: reload, enter XR, seat the headset (x z yaw [pitch]),
# hands, then wait for the desk to place itself (restore / surfaces). Usage: sh tools/enter-seat.sh -0.84 0.2 90 [-27]
# WDD_PRE_JS: JS run in the app frame after the reload, before entering XR (emulate a slow restore, an empty room…).
set -eu
X="${1:--0.84}"; Z="${2:-0.2}"; YAW="${3:-90}"; PITCH="${4:--27}"
CLI="node_modules/.bin/iwsdk"
$CLI xr exit >/dev/null 2>&1 || true
$CLI browser reload >/dev/null
sleep 5
if [ -n "${WDD_PRE_JS:-}" ]; then WDD_JS="$WDD_PRE_JS" $CLI browser run tools/wdd-eval.mjs >/dev/null; fi
# Seat the headset BEFORE entering, so the arrival logic sees this pose from the first frame.
for i in 1 2 3 4 5 6; do
  $CLI xr enter >/dev/null 2>&1 || true
  $CLI xr set-transform --input-json "{\"device\":\"headset\",\"position\":{\"x\":$X,\"y\":1.2,\"z\":$Z},\"orientation\":{\"pitch\":$PITCH,\"yaw\":$YAW,\"roll\":0}}" >/dev/null 2>&1 || true
  sleep 1
  if $CLI xr status 2>/dev/null | grep -q '"sessionActive": true'; then break; fi
done
$CLI xr set-input-mode --input-json '{"mode":"hand"}' >/dev/null
sleep 5
$CLI browser run tools/anchor-state.mjs | sed -n '/"result"/,/"script"/p'
