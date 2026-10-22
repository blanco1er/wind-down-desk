#!/bin/sh
# Assembles artifacts/frames (CDP screencast, variable frame rate) into an mp4
# with the real timing, using index.json timestamps.
# Usage: sh tools/frames-to-video.sh artifacts/wind-down-evening.mp4 [artifacts/frames-v3]
set -eu
OUT="${1:-artifacts/wind-down-evening.mp4}"
DIR="${2:-artifacts/frames}"
node -e '
const fs = require("fs");
const frames = JSON.parse(fs.readFileSync(process.argv[1] + "/index.json", "utf8"));
let list = "";
frames.forEach((f, i) => {
  const next = frames[i + 1];
  const d = next ? Math.max(0.001, next.t - f.t) : 0.5;
  list += `file ${f.name}\nduration ${d.toFixed(3)}\n`;
});
list += `file ${frames[frames.length - 1].name}\n`;
fs.writeFileSync(process.argv[1] + "/list.txt", list);
' "$DIR"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$DIR/list.txt" -vf "fps=30,format=yuv420p" -c:v libx264 -preset slow -crf "${CRF:-24}" -tune film -movflags +faststart "$OUT"
echo "$OUT"
