#!/bin/sh
# 29 Oct (solidity): N more hands-only evenings on the CURRENT page (no reload), for heap snapshot diffs.
set -u
cd "$(dirname "$0")/../.."
CLI=node_modules/.bin/iwsdk
N="${1:-2}"; D0="${2:-100}"
for K in $(seq 1 "$N"); do
  WDD_JS="window.__wdd.film.day($((D0 + K))); return 1" $CLI browser run tools/wdd-eval.mjs >/dev/null 2>&1
  for i in 1 2 3 4 5; do $CLI xr enter >/dev/null 2>&1 || true; sleep 2; if $CLI xr status 2>/dev/null | grep -q '"sessionActive": true'; then break; fi; done
  $CLI xr set-transform --input-json '{"device":"headset","position":{"x":-0.84,"y":1.2,"z":0.2},"orientation":{"pitch":-30,"yaw":90,"roll":0}}' >/dev/null
  $CLI xr set-input-mode --input-json '{"mode":"hand"}' >/dev/null
  sleep 2
  WDD_JS="window.__wdd.film?.fov(54); window.__wdd.recenter(true); return 1" $CLI browser run tools/wdd-eval.mjs >/dev/null 2>&1
  sleep 3
  for P in 1 2 3 4 5; do NO_NET="${NO_NET:-0}" PART=$P $CLI browser run tools/solidite-29oct/parcours.mjs --timeout 108000 >/dev/null 2>&1; done
  echo "evening $K done"
done
