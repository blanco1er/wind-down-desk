#!/bin/sh
# Shared helpers for the v8 gallery and takes (sourced). Run from wind-down-desk/.
B=node_modules/.bin/iwsdk
# ev '<async JS body>' : evaluate in the app frame
ev() { WDD_JS="$1" $B browser run tools/wdd-eval.mjs >/dev/null; }
# view '<json>' ['<js>'] : film camera from the seat (see tools/film-v7/view.mjs)
view() { VIEW="$1" WDD_JS="${2:-}" $B browser run tools/film-v7/view.mjs >/dev/null; }
# shot <file.png> : native 3840 x 2160 runtime screenshot
shot() { $B browser screenshot --output-file "$1" >/dev/null; }
# fresh [evenings=21] : seeded history BEFORE the reload, so the real arrival (sky, keepsakes) plays; then the
# film camera; then the arrival is replayed from darkness so the lamp wakes in frame.
fresh() {
  ev "window.__wdd.film.history(${1:-21}); return 1"
  sh tools/stage.sh 54 30 >/dev/null
  ev 'window.__wdd.arrive(); await new Promise(r=>setTimeout(r,2600)); return 1'
}
DUMP='await window.__wdd.say("I still have not replied to the landlord about the heating. And I need to book the dentist."); await new Promise(r=>setTimeout(r,1500)); await window.__wdd.say("The slides for Monday are not done. I keep replaying that awkward comment I made at lunch. Oh, and my passport expires in March."); await new Promise(r=>setTimeout(r,3500)); return 1'
