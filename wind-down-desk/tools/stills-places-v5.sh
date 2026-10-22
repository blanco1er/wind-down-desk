#!/bin/sh
# Crisp PNG stills of the Places (menu, garden, hilltop) with stones on the desk: sh tools/stills-places-v5.sh
set -eu
CLI="npx @iwsdk/cli"
pose() { $CLI xr set-transform --input-json "{\"device\":\"headset\",\"position\":{\"x\":-0.84,\"y\":1.2,\"z\":0.2},\"orientation\":{\"pitch\":$1,\"yaw\":90,\"roll\":0}}" >/dev/null; sleep 1.5; }
js() { WDD_JS="$1" $CLI browser run tools/wdd-eval.mjs >/dev/null 2>&1; }
sh tools/stage.sh 50 25 >/dev/null 2>&1
js "await window.__wdd.say(\"I still haven't replied to the landlord about the heating. And I need to book the dentist, it's been a year.\"); await new Promise(r=>setTimeout(r,1500)); await window.__wdd.say(\"The slides for Monday aren't done. Oh, and my passport expires in March.\"); await new Promise(r=>setTimeout(r,3000)); await window.__wdd.say('Places'); await new Promise(r=>setTimeout(r,2500)); return 1"
$CLI browser screenshot --output-file artifacts/71-places-menu-v5.png >/dev/null
js "await window.__wdd.say('Places'); await window.__wdd.place('garden'); await new Promise(r=>setTimeout(r,2600)); return 1"
pose -21
$CLI browser screenshot --output-file artifacts/72-garden-rain-v5.png >/dev/null
js "await window.__wdd.place('hilltop'); await new Promise(r=>setTimeout(r,4800)); return 1"
pose 2
$CLI browser screenshot --output-file artifacts/73-starry-hilltop-v5.png >/dev/null
js "await window.__wdd.place('room'); return 1"
