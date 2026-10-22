#!/bin/sh
# Devpost gallery v7: eight real emulator stills (3840 × 2160 render), cropped to 3:2 (3240 × 2160) JPEG.
# Usage: sh tools/film-v7/gallery.sh <raw-dir> <out-dir>
set -eu
RAW="$1"; OUT="$2"; mkdir -p "$RAW" "$OUT"
B=node_modules/.bin/iwsdk
ev() { WDD_JS="$1" $B browser run tools/wdd-eval.mjs >/dev/null; }
view() { VIEW="$1" WDD_JS="${2:-}" $B browser run tools/film-v7/view.mjs >/dev/null; }
shot() { $B browser screenshot --output-file "$RAW/$1.png" >/dev/null; }
fresh() { sh tools/stage.sh 54 30 >/dev/null; ev 'window.__wdd.film.history(21); window.__wdd.arrive(); await new Promise(r=>setTimeout(r,2600)); return 1'; }
DUMP='await window.__wdd.say("I still have not replied to the landlord about the heating. And I need to book the dentist."); await new Promise(r=>setTimeout(r,1500)); await window.__wdd.say("The slides for Monday are not done. I keep replaying that awkward comment I made at lunch. Oh, and my passport expires in March."); await new Promise(r=>setTimeout(r,3500)); return 1'
# 1 hero: five stones, the caption, the lamp
fresh; ev "$DUMP"; view '{"fov":44,"aim":[0.03,0.06,-0.03],"back":0.02,"up":-0.03}'; shot 1-unload
# 2 the agent proposes (menu tinted by the lamp)
fresh; view '{"fov":46,"aim":[0.1,0.08,-0.05],"back":0.02,"up":-0.03}'; shot 2-lamp-proposes
# 3 Release: the stone over the water, then sinking
fresh; ev 'await window.__wdd.say("The meeting with Paul tomorrow. I keep replaying it."); await new Promise(r=>setTimeout(r,3000)); await window.__wdd.say("Yes."); await new Promise(r=>setTimeout(r,4800)); return 1'
view '{"fov":42,"aim":[0.1,0.01,0.0],"back":0.0}'; shot 3-release-stone
ev 'await window.__wdd.say("Let it go."); await new Promise(r=>setTimeout(r,2700)); return 1'; shot 4-release-sinks
# 5 Breathe: the moon
fresh; ev 'await window.__wdd.say("Breathe."); await new Promise(r=>setTimeout(r,10500)); return 1'; view '{"fov":44,"aim":[0.0,0.07,-0.02],"back":0.0}'; shot 5-breathe
# 6 the lake (Places)
fresh; ev 'await window.__wdd.say("Not now."); await new Promise(r=>setTimeout(r,900)); await window.__wdd.say("Take me to the lake."); await new Promise(r=>setTimeout(r,4200)); return 1'
view '{"fov":54,"aim":[0.0,0.12,-0.5],"back":0.05}'; sleep 1; shot 6-lake
# 7 the plan for tomorrow
fresh; ev "$DUMP"; ev 'await window.__wdd.say("That is it."); await new Promise(r=>setTimeout(r,800)); for (const s of ["Dentist, tomorrow.","Landlord, tomorrow.","Slides, later.","Passport, later.","Let go of that comment."]) { await window.__wdd.say(s); await new Promise(r=>setTimeout(r,1300)); } await new Promise(r=>setTimeout(r,2500)); return 1'
view '{"fov":50,"aim":[0.0,0.2,-0.2],"back":0.02}'; shot 7-plan
# 8 close-up: real oak, engraved stones
fresh; ev "$DUMP"; view '{"fov":24,"aim":[-0.16,0.0,0.13],"back":-0.24}'; shot 8-oak-stones
for f in "$RAW"/*.png; do n=$(basename "$f" .png); ffmpeg -loglevel error -y -i "$f" -vf "crop=3240:2160:300:0" -q:v 2 "$OUT/$n.jpg"; done
ls -la "$OUT"
