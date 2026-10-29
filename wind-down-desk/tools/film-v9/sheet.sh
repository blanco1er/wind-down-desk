#!/bin/sh
# Contact sheet of a v9 take: N frames evenly spaced (default 12), 4 per row, with their time.
#   sh tools/film-v9/sheet.sh <shot> [n] [out.jpg]
cd "$(dirname "$0")/../.."
D=artifacts/frames-v9-$1; N=${2:-12}; OUT=${3:-artifacts/sheet-v9-$1.jpg}
python3 - "$D" "$N" "$OUT" <<'PY'
import json, sys, subprocess, os
d, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
fr = json.load(open(os.path.join(d, 'index.json')))
t0 = fr[0]['t']
picks = [fr[round(i * (len(fr) - 1) / (n - 1))] for i in range(n)]
args = ['ffmpeg', '-loglevel', 'error', '-y']
for p in picks: args += ['-i', os.path.join(d, p['name'])]
parts = []
for i, p in enumerate(picks):
    parts.append(f"[{i}]scale=640:360[v{i}]")
cols = 4; rows = (n + cols - 1) // cols
lay = '|'.join(f"{(i % cols) * 640}_{(i // cols) * 360}" for i in range(n))
parts.append(''.join(f'[v{i}]' for i in range(n)) + f'xstack=inputs={n}:layout={lay}')
subprocess.run(args + ['-filter_complex', ';'.join(parts), out], check=True)
print(out, ' '.join(f"{p['t']-t0:.1f}" for p in picks))
PY
