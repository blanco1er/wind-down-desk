#!/bin/sh
# Art iteration v7: four stills — seated view with five stones, oak close-up (front-left corner), stones
# close-up, Places menu open. Usage: sh tools/film-v7/looks.sh <out-dir> <tag>
set -eu
OUT="$1"; TAG="${2:-x}"
B=node_modules/.bin/iwsdk
sh tools/quick-look.sh "$OUT/$TAG-seated.png" 54 27 >/dev/null
VIEW='{"fov":26,"aim":[-0.36,0.0,0.19],"back":-0.32}' $B browser run tools/film-v7/view.mjs >/dev/null
$B browser screenshot --output-file "$OUT/$TAG-oak.png" >/dev/null
VIEW='{"fov":30,"aim":[0.0,0.01,0.13],"back":-0.18}' $B browser run tools/film-v7/view.mjs >/dev/null
$B browser screenshot --output-file "$OUT/$TAG-stones.png" >/dev/null
VIEW='{"fov":54,"aim":[0.08,0.06,-0.05],"back":0}' WDD_JS='window.__wdd.press("places")' $B browser run tools/film-v7/view.mjs >/dev/null
sleep 1
$B browser screenshot --output-file "$OUT/$TAG-places.png" >/dev/null
for v in seated oak stones places; do ffmpeg -loglevel error -y -i "$OUT/$TAG-$v.png" -vf scale=1600:-2 "$OUT/$TAG-$v.jpg"; done
echo "$OUT/$TAG-*.jpg"
