#!/bin/sh
# Converts the stills noted during a recording (stills.json: name → screencast frame) to PNG in artifacts/.
# Usage: sh tools/stills-from-frames.sh artifacts/frames-v5
set -eu
DIR="${1:-artifacts/frames-v5}"
node -e '
const fs = require("fs"); const { execFileSync } = require("child_process");
const dir = process.argv[1];
for (const s of JSON.parse(fs.readFileSync(dir + "/stills.json", "utf8"))) {
  if (!s.frame) continue;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", dir + "/" + s.frame, "artifacts/" + s.name + ".png"]);
  console.log("artifacts/" + s.name + ".png");
}' "$DIR"
