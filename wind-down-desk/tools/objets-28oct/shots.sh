#!/bin/sh
# Before / after stills of the glass lamp and the Tripo keepsakes (28 Oct 2026), real emulator captures.
# Start the runtime first (any size; 1600 × 1066 used here):
#   WDD_PORT=8093 npx @iwsdk/cli dev up --headless --ai-mode agent --allow-browser-automation --screenshot-width 1600 --screenshot-height 1066
# Usage: sh tools/objets-28oct/shots.sh <out-dir> <prefix> [shot ...]
#   shots: lamp (close + wide, idle) speak (close, the lamp talking) place (the lake, close + wide) keepsakes sky steam
set -eu
cd "$(dirname "$0")/../.."
OUT="$1"; P="$2"; shift 2
mkdir -p "$OUT"
. tools/film-v8/lib.sh
SHOTS="${*:-lamp speak place keepsakes sky}"
LAMP_CLOSE='{"fov":20,"aim":[0.352,0.035,0.035],"back":-0.18,"up":-0.02}'
LAMP_MACRO='{"fov":8,"aim":[0.352,0.035,0.035],"back":-0.25,"up":-0.02}'
LAMP_WIDE='{"fov":54,"aim":[0.06,0.03,-0.03],"back":0.02,"up":-0.03}'
KEEP_CLOSE='{"fov":22,"aim":[-0.465,0.02,-0.1],"back":-0.12,"up":-0.02}'
# Evening 21 (all three keepsakes), the arrival's sky played out, the lamp home and idle.
settle() { fresh 21; ev 'await new Promise(r=>setTimeout(r,11000)); window.__wdd.lamp("idle"); await new Promise(r=>setTimeout(r,1500)); return 1'; }
for s in $SHOTS; do
  echo "== $s $(date +%T)"
  case "$s" in
  lamp)
    settle
    view "$LAMP_CLOSE"; shot "$OUT/$P-lamp-close.png"
    view "$LAMP_MACRO"; shot "$OUT/$P-lamp-macro.png"
    view "$LAMP_WIDE"; shot "$OUT/$P-lamp-wide.png" ;;
  macro)
    # Quick look at the lamp only (iteration): no reload.
    ev 'window.__wdd.lamp("idle"); return 1'; view "$LAMP_MACRO"; shot "$OUT/$P-lamp-macro.png"; view "$LAMP_CLOSE"; shot "$OUT/$P-lamp-close.png" ;;
  speak)
    settle; ev 'window.__wdd.lamp("speak"); await new Promise(r=>setTimeout(r,1200)); return 1'
    view "$LAMP_CLOSE"; shot "$OUT/$P-lamp-speak.png"
    view "$LAMP_WIDE"; shot "$OUT/$P-lamp-speak-wide.png"; ev 'window.__wdd.lamp(null); return 1' ;;
  place)
    settle
    ev 'await window.__wdd.say("Not now."); await new Promise(r=>setTimeout(r,900)); await window.__wdd.say("Take me to the lake."); await new Promise(r=>setTimeout(r,6000)); window.__wdd.immersion("full"); await new Promise(r=>setTimeout(r,2500)); window.__wdd.lamp("idle"); await new Promise(r=>setTimeout(r,1500)); return 1'
    view "$LAMP_CLOSE"; shot "$OUT/$P-place-lamp-close.png"
    view "$LAMP_WIDE"; shot "$OUT/$P-place-lamp-wide.png"; ev 'window.__wdd.lamp(null); window.__wdd.immersion("table"); return 1' ;;
  keepsakes)
    settle; view "$KEEP_CLOSE"; shot "$OUT/$P-keepsakes-close.png"
    view '{"fov":40,"aim":[-0.3,0.02,-0.08],"back":0.0,"up":-0.02}'; shot "$OUT/$P-keepsakes-wide.png" ;;
  steam)
    # The cup steams on the evening you come back (first seconds after the arrival), then stops.
    ev "window.__wdd.film.history(21); return 1"; sh tools/stage.sh 54 30 >/dev/null
    ev 'window.__wdd.arrive(); await new Promise(r=>setTimeout(r,4000)); return 1'
    view "$KEEP_CLOSE"; shot "$OUT/$P-steam-close.png" ;;
  sky)
    fresh 21; ev 'window.__wdd.sky(true); await new Promise(r=>setTimeout(r,2600)); return 1'
    view '{"fov":50,"aim":[-0.04,0.15,-0.12],"back":0.02}'; shot "$OUT/$P-sky.png"
    view '{"fov":26,"aim":[0.16,0.16,-0.12],"back":-0.1}'; shot "$OUT/$P-sky-close.png" ;;
  esac
done
ls -la "$OUT" | grep "$P-"
