#!/bin/sh
# 29 Oct (solidity) — rooms the developer never tested, in the emulator. One scenario per run (fresh page each time,
# remembered desk anchor forgotten), then tools/solidite-29oct/rooms.mjs plays it by hand and takes the stills:
#   blind   no table, no wall, no ceiling (scene understanding sees nothing)
#   denied  every permission refused: microphone, planes, meshes, anchors, hit test (+ nothing seen)
#   low     seated on the couch in front of the coffee table (45 cm high, 65 cm under the eyes)
#   high    a low seat at the desk table: the table only 24 cm under the eyes
#   tooHigh the seat lower still (19 cm): the table is refused, the desk floats at a comfortable height
# Stills: ../video/solidite-29oct/<scenario>-*.jpg ; results: artifacts/solidite-29oct/rooms-<scenario>.json
set -u
cd "$(dirname "$0")/../.."
CLI=node_modules/.bin/iwsdk
S="${1:-blind}"
mkdir -p artifacts/solidite-29oct
$CLI xr exit >/dev/null 2>&1 || true
WDD_JS="localStorage.removeItem('wdd.desk-anchor.v1'); localStorage.removeItem('iwsdk_scene_anchor_uuid'); localStorage.removeItem('wdd.voice'); return 1" $CLI browser run tools/wdd-eval.mjs >/dev/null 2>&1 || true
$CLI browser reload >/dev/null 2>&1
sleep 5
# Every run records what the session really granted; "denied" asks it without planes, meshes, anchors or hit test,
# as when the person refuses spatial data.
DENY=false; [ "$S" = "denied" ] && DENY=true
WDD_JS="const xr = navigator.xr; const orig = xr.requestSession.bind(xr); const deny = $DENY; const strip = (l) => (l ?? []).filter((f) => !deny || !['plane-detection','mesh-detection','anchors','hit-test'].includes(f)); xr.requestSession = (mode, o) => orig(mode, { ...o, requiredFeatures: strip(o?.requiredFeatures), optionalFeatures: strip(o?.optionalFeatures) }).then((s) => { window.__xrFeatures = Array.from(s.enabledFeatures ?? []); return s; }); window.__deniedPatch = deny; return 1" $CLI browser run tools/wdd-eval.mjs >/dev/null 2>&1
for i in 1 2 3 4 5 6; do
  $CLI xr enter >/dev/null 2>&1 || true
  sleep 2
  if $CLI xr status 2>/dev/null | grep -q '"sessionActive": true'; then break; fi
done
case "$S" in
  low) POS='{"x":2.12,"y":1.1,"z":-0.4}'; PITCH=-38 ;;
  high) POS='{"x":-0.84,"y":1.03,"z":0.2}'; PITCH=-12 ;;
  tooHigh) POS='{"x":-0.84,"y":0.98,"z":0.2}'; PITCH=-30 ;;
  *) POS='{"x":-0.84,"y":1.2,"z":0.2}'; PITCH=-30 ;;
esac
$CLI xr set-transform --input-json "{\"device\":\"headset\",\"position\":$POS,\"orientation\":{\"pitch\":$PITCH,\"yaw\":90,\"roll\":0}}" >/dev/null
$CLI xr set-input-mode --input-json '{"mode":"hand"}' >/dev/null
sleep 3
SCENE=$S $CLI browser run tools/solidite-29oct/rooms.mjs --timeout 108000 2>&1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s.slice(s.indexOf('{')));console.log(JSON.stringify(j.ok?j.data.result:j.error,null,1))}catch(e){console.log(s.slice(0,1500))}})" | tee "artifacts/solidite-29oct/rooms-$S.json"
