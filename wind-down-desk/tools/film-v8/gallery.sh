#!/bin/sh
# Devpost gallery v8 (28 Oct 2026): real emulator stills of the CURRENT app (3840 × 2160 render), cropped to 3:2
# (3240 × 2160) JPEG. Since v7: the living lamp, places shown inside the lamp's globe, the sky in the globe and the
# 3 / 7 / 21 keepsakes on the table, HD places with rain in the garden, real hands with a rim.
# Start the runtime in 4K first:
#   npx @iwsdk/cli dev up --headless --ai-mode agent --allow-browser-automation --screenshot-width 3840 --screenshot-height 2160
# Usage: sh tools/film-v8/gallery.sh <raw-dir> <out-dir> [shot ...]     (no shot = all ten)
#   shots: unload lamp release breathe globe garden lake plan sky oak
set -eu
cd "$(dirname "$0")/../.."
RAW="$1"; OUT="$2"; shift 2
mkdir -p "$RAW" "$OUT"
. tools/film-v8/lib.sh
SHOTS="${*:-unload lamp release breathe globe garden plan sky oak}"
# crop <name> [x-offset=300]: 3840 × 2160 → 3:2, JPEG q2 (≈ 1.5–3 MB)
crop() { ffmpeg -loglevel error -y -i "$RAW/$1.png" -vf "crop=3240:2160:${2:-300}:0" -q:v 2 "$OUT/$1.jpg"; }
for s in $SHOTS; do
  echo "== $s $(date +%T)"
  case "$s" in
  unload)
    # Hero: a full head became five engraved stones; the lamp on the right. Shot at once (before the ghost hand).
    fresh; ev "$DUMP"; view '{"fov":50,"aim":[0.03,0.03,-0.03],"back":0.02,"up":-0.03}'; shot "$RAW/01-unload.png"; crop 01-unload ;;
  lamp)
    # The agent proposes tonight's ritual (the hour, past evenings); Yes / Not now; the ritual menu by the lamp.
    fresh; view '{"fov":56,"aim":[0.14,0.19,-0.08],"back":0.02}'; shot "$RAW/02-lamp-proposes.png"; crop 02-lamp-proposes 60 ;;
  release)
    # The lamp hears a heavy thing, proposes Release; the words go into a basalt stone; then it sinks.
    fresh
    ev 'await window.__wdd.say("The meeting with Paul tomorrow. I keep replaying it."); await new Promise(r=>setTimeout(r,3000)); await window.__wdd.say("Yes."); await new Promise(r=>setTimeout(r,4800)); return 1'
    view '{"fov":48,"aim":[0.06,0.06,-0.03],"back":0.0}'; shot "$RAW/03-release-stone.png"; crop 03-release-stone
    ev 'await window.__wdd.say("Let it go."); await new Promise(r=>setTimeout(r,1800)); return 1'; shot "$RAW/04-release-sinks.png"; crop 04-release-sinks ;;
  breathe)
    fresh; ev 'await window.__wdd.say("Breathe."); await new Promise(r=>setTimeout(r,10500)); return 1'
    view '{"fov":44,"aim":[0.0,0.14,-0.05],"back":0.0,"up":0.05}'; shot "$RAW/05-breathe.png"; crop 05-breathe ;;
  globe)
    # Places open inside the lamp: the globe floats up and becomes a window on a place (the lake first).
    fresh; ev 'await window.__wdd.say("Not now."); await new Promise(r=>setTimeout(r,900)); await window.__wdd.say("Places."); await new Promise(r=>setTimeout(r,3500)); return 1'
    view '{"fov":44,"aim":[0.16,0.16,-0.12],"back":0.0}'; shot "$RAW/06-place-in-globe.png"; crop 06-place-in-globe ;;
  garden)
    fresh; ev 'await window.__wdd.say("Not now."); await new Promise(r=>setTimeout(r,900)); await window.__wdd.say("Go to the garden."); await new Promise(r=>setTimeout(r,5000)); window.__wdd.immersion("full"); await new Promise(r=>setTimeout(r,2500)); return 1'
    view '{"fov":58,"aim":[-0.62,0.3,-0.62],"back":0.0}'; sleep 2; shot "$RAW/07-garden-rain.png"; crop 07-garden-rain 0; ev 'window.__wdd.immersion("table"); return 1' ;;
  lake)
    fresh; ev 'await window.__wdd.say("Not now."); await new Promise(r=>setTimeout(r,900)); await window.__wdd.say("Take me to the lake."); await new Promise(r=>setTimeout(r,5000)); window.__wdd.immersion("full"); await new Promise(r=>setTimeout(r,2500)); return 1'
    view '{"fov":58,"aim":[-0.62,0.3,-0.62],"back":0.0}'; sleep 2; shot "$RAW/07-lake.png"; crop 07-lake 0; ev 'window.__wdd.immersion("table"); return 1' ;;
  plan)
    fresh; ev "$DUMP"
    ev 'await window.__wdd.say("That is it."); await new Promise(r=>setTimeout(r,800)); for (const s of ["Dentist, tomorrow.","Landlord, tomorrow.","Slides, later.","Passport, later.","Let go of that comment."]) { await window.__wdd.say(s); await new Promise(r=>setTimeout(r,1300)); } await new Promise(r=>setTimeout(r,2500)); return 1'
    view '{"fov":50,"aim":[0.0,0.2,-0.2],"back":0.02}'; shot "$RAW/08-plan.png"; crop 08-plan ;;
  sky)
    # Evening 21: the lamp floats up and shows your sky (a star per thing let go, a point per evening, the spiral
    # complete); the pebble (3), the candle (7) and the plant (21) stand on the table. History seeded (film only).
    fresh 21; ev 'window.__wdd.sky(true); await new Promise(r=>setTimeout(r,2600)); return 1'
    view '{"fov":50,"aim":[-0.04,0.15,-0.12],"back":0.02}'; shot "$RAW/09-sky-keepsakes.png"; crop 09-sky-keepsakes 200 ;;
  oak)
    fresh; ev "$DUMP"; view '{"fov":24,"aim":[-0.16,0.0,0.13],"back":-0.24}'; shot "$RAW/10-oak-stones.png"; crop 10-oak-stones ;;
  esac
done
ls -la "$OUT"
