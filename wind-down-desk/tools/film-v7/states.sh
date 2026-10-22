#!/bin/sh
# Art iteration v7: the other states — Release (stone over the water), Breathe (the moon), the lake, the plan card.
# Usage: sh tools/film-v7/states.sh <out-dir> <tag>
set -eu
OUT="$1"; TAG="${2:-x}"
B=node_modules/.bin/iwsdk
shot() { $B browser screenshot --output-file "$OUT/$TAG-$1.png" >/dev/null; ffmpeg -loglevel error -y -i "$OUT/$TAG-$1.png" -vf scale=1600:-2 "$OUT/$TAG-$1.jpg"; }
ev() { WDD_JS="$1" $B browser run tools/wdd-eval.mjs >/dev/null; }
sh tools/stage.sh 54 30 >/dev/null
ev 'window.__wdd.film.history(21); window.__wdd.arrive(); await new Promise(r=>setTimeout(r,2500)); await window.__wdd.say("The meeting with Paul tomorrow. I keep replaying it."); await new Promise(r=>setTimeout(r,3000)); await window.__wdd.say("Yes."); await new Promise(r=>setTimeout(r,4500)); return 1'
shot release
ev 'await window.__wdd.say("Let it go."); await new Promise(r=>setTimeout(r,2600)); return 1'
shot release-sink
sh tools/stage.sh 54 30 >/dev/null
ev 'window.__wdd.film.history(21); window.__wdd.arrive(); await new Promise(r=>setTimeout(r,2500)); await window.__wdd.say("Breathe."); await new Promise(r=>setTimeout(r,11000)); return 1'
shot breathe
sh tools/stage.sh 54 30 >/dev/null
ev 'window.__wdd.film.history(21); window.__wdd.arrive(); await new Promise(r=>setTimeout(r,2500)); await window.__wdd.say("Not now."); await new Promise(r=>setTimeout(r,800)); await window.__wdd.say("Take me to the lake."); await new Promise(r=>setTimeout(r,4500)); return 1'
shot lake
sh tools/stage.sh 54 30 >/dev/null
ev 'window.__wdd.film.history(21); window.__wdd.arrive(); await new Promise(r=>setTimeout(r,2500)); await window.__wdd.say("I need to book the dentist and reply to the landlord. The slides for Monday are not done."); await new Promise(r=>setTimeout(r,3500)); await window.__wdd.say("Sort them for me."); await new Promise(r=>setTimeout(r,5000)); window.IWER_DEVICE.quaternion.set(-0.12,0.7,0.12,0.69); await new Promise(r=>setTimeout(r,600)); return 1'
shot plan
echo done
