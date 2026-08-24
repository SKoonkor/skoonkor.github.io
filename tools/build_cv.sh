#!/usr/bin/env bash
#
# Compile the LaTeX CV into public/, which is what makes the Download PDF button
# appear on /cv/ -- that page renders the link only if the file exists.
#
# Uses Tectonic: a single binary that fetches the packages it needs on demand,
# so there is no TeX distribution to install and the build is reproducible.
#   brew install tectonic
#
# Usage: tools/build_cv.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/cv/Koonkor_CV.tex"
OUT="$ROOT/public/cv"

command -v tectonic >/dev/null || { echo "tectonic not found: brew install tectonic" >&2; exit 1; }
[ -f "$SRC" ] || { echo "not found: $SRC" >&2; exit 1; }

mkdir -p "$OUT"
tectonic --chatter minimal --outdir "$OUT" "$SRC"

echo
printf 'wrote %s (%s KB)\n' "$OUT/Koonkor_CV.pdf" \
  "$(( $(stat -f%z "$OUT/Koonkor_CV.pdf" 2>/dev/null || stat -c%s "$OUT/Koonkor_CV.pdf") / 1024 ))"
