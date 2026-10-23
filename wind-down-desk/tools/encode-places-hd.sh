#!/bin/sh
# HD places (26 Oct 2026): encodes an 8192 × 2732 equal-area panorama to KTX2 UASTC with the NATIVE basisu 2.50
# (the app's wasm encoder, tools/encode-places.mjs, stops at 12.58 Mpx; 8k is 22.4 Mpx). Nothing is installed in the
# system: basisu is a local copy of the Homebrew bottle, pointed to by $BASISU.
#
#   sh tools/encode-places-hd.sh <in-8192x2732.png> <out.ktx2>
#
# Full procedure, from the shipped 6k panorama to the 8k file (study: ../places-hd/RAPPORT.md):
#   1. basisu 2.50, local only (Apache-2.0), once:
#        brew fetch --force-bottle basis_universal          # downloads the bottle to Homebrew's cache, installs nothing
#        mkdir -p ../places-hd/tools/bin && tar -xzf "$(brew --cache --force-bottle basis_universal)" -C ../places-hd/tools/bin
#      (or build v2_50 from https://github.com/BinomialLLC/basis_universal with cmake; the binary is bin/basisu)
#   2. decode the shipped 6k (it carries the app's fixes: horizon, lake seams, zenith caps):
#        node tools/ktx2-decode.cjs public/environments/<stem>.ktx2 ../places-hd/work/shipped/<stem>-ea.png
#   3. upscale ×4 with DAT2 (4xRealWebPhoto_v4_dat2, CC BY 4.0, local venv in ../places-hd, see its §7):
#        ../places-hd/.venv/bin/python ../places-hd/tools/upscale.py ../places-hd/work/shipped/<stem>-ea.png <stem>-8k.png dat2 8192
#   4. this script → public/environments/<stem>-8k.ktx2, then: node tools/ktx2-info.mjs <out.ktx2> ; npm test
# Settings = the app's UASTC settings (encode-places.mjs): UASTC level 2, RDO 1.5, zstd, sRGB, no mipmaps.
set -eu
IN="$1"
OUT="$2"
BASISU="${BASISU:-$(dirname "$0")/../../places-hd/tools/bin/basis_universal/2.50/bin/basisu}"
if [ ! -x "$BASISU" ]; then
  echo "basisu not found at $BASISU (set BASISU, see step 1 above)" >&2
  exit 1
fi
"$BASISU" -version 2>&1 | grep -q 'v2\.50' || { echo "basisu must be v2.50: $("$BASISU" -version 2>&1 | head -1)" >&2; exit 1; }
SIZE=$(node -e "require('sharp')(process.argv[1]).metadata().then(m=>console.log(m.width+'x'+m.height))" "$IN")
[ "$SIZE" = "8192x2732" ] || { echo "expected 8192x2732, got $SIZE" >&2; exit 1; }
"$BASISU" -ktx2 -srgb -uastc -uastc_level 2 -uastc_rdo_l 1.5 -file "$IN" -output_file "$OUT" > /dev/null
node "$(dirname "$0")/ktx2-info.mjs" "$OUT"
