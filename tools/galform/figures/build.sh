#!/bin/bash
# Build one figure frame into src/assets/courses/galform/<lecture>/<name>.svg
# Usage: tools/galform/figures/build.sh <tex-name> <frame> <lecture-dir> <svg-name>
#   e.g. tools/galform/figures/build.sh cycle 2 L00 cycle-2
# Same pipeline as the N-body figures: pdflatex -> pdftocairo -> svg_recolor -> svg_flatten -> svgo.
# svgo is not a site dependency: SVGO=/path/to/svgo/lib/svgo-node.js (see tools/nbody/svg_optimize.mjs).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
name="$1"; fr="$2"; lec="$3"; out="$4"
work="$(mktemp -d)"
cp "$here"/*.tex "$work"/
( cd "$work" && pdflatex -interaction=nonstopmode -halt-on-error "\\def\\fr{$fr}\\input{$name}" >/dev/null && pdftocairo -svg "$name.pdf" raw.svg )
dest="$root/src/assets/courses/galform/$lec"
mkdir -p "$dest"
python3 "$root/tools/nbody/svg_recolor.py" "$work/raw.svg" "$work/rc.svg" "galform-$out"
python3 "$root/tools/nbody/svg_flatten.py" "$work/rc.svg" "$work/fl.svg"
node "$root/tools/nbody/svg_optimize.mjs" "$work/fl.svg" "$dest/$out.svg"
rm -rf "$work"
