#!/bin/bash
# Run one cosmology of the structure-formation grid, or resume the whole grid.
#
#   ./run_grid.sh 0.30 0.80 -1.0        # one run
#   ./run_grid.sh --all                 # every point, skipping finished ones
#
# Resumable: a run whose directory already holds a snapshot at a=1 is skipped,
# so the script can be re-entered after a laptop sleep or a Ctrl-C. Nothing is
# ever deleted -- free disk is reported between runs and the decision is yours.
#
# Measured on run A (Om=0.30): 67 min, 1894 steps, 1.4 GB, 39 snapshots.
# The 46 min / 512 step figure from the 100-step timing run was an underestimate:
# that run only sampled high z, where dt_max binds and every particle updates.
# Past z~2 the accuracy criterion takes over -- many more steps, most of them
# partial. Budget ~10 h and ~12.6 GB for all nine.
set -euo pipefail

GRID="$HOME/Documents/Suttikoon/Research_Projects/SWIFT_sim/grid"
SWIFT="$HOME/Documents/Suttikoon/Research_Projects/SWIFT_sim/SWIFT/swift"
MAKE_ICS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/make_ics.py"
PY="$HOME/swift-venv/bin/python"
THREADS=8
F_BARYON="0.0455/0.30"   # fixed baryon FRACTION -- see make_ics.py

a_begin=0.019607843      # z = 50, and it must equal the IC's own a

run_one () {
  local om=$1 s8=$2 w0=$3
  local tag; tag=$(printf "Om%.2f_s%.2f_w%+.1f" "$om" "$s8" "$w0")
  local dir="$GRID/$tag"

  if [ -f "$dir/.done" ]; then echo "  $tag: already finished, skipping"; return; fi
  mkdir -p "$dir"

  read -r ob ocdm ol <<< "$($PY -c "
om=$om; ob=($F_BARYON)*om
print(f'{ob:.6f} {om-ob:.6f} {1-om:.6f}')")"

  local ic="ic_${tag}.hdf5"
  if [ ! -f "$dir/$ic" ]; then
    "$PY" "$MAKE_ICS" --omega-m "$om" --sigma8 "$s8" --w0 "$w0" --out "$dir"
  fi

  cp "$GRID/output_list.txt" "$GRID/select_output.yml" "$dir/"
  sed -e "s|@OMEGA_CDM@|$ocdm|" -e "s|@OMEGA_LAMBDA@|$ol|" -e "s|@OMEGA_B@|$ob|" \
      -e "s|@W0@|$w0|" -e "s|@IC@|$ic|" -e "s|@TAG@|$tag|" -e "s|@A_BEGIN@|$a_begin|" \
      "$GRID/run.yml.in" > "$dir/run.yml"

  echo "  $tag: Omega_cdm=$ocdm Omega_b=$ob Omega_lambda=$ol w_0=$w0 -- starting"
  # --power IS passed. The plan expected a segfault in FFTW plan teardown at
  # exit and budgeted for post-processed P(k) instead; run A exited cleanly with
  # 39 spectra written, so SWIFT's own estimator is used and compute_pk.py is
  # kept as the independent cross-check rather than the primary.
  ( cd "$dir" && caffeinate -dimsu "$SWIFT" --cosmology --self-gravity --power \
      --threads=$THREADS run.yml > run.log 2>&1 )
  touch "$dir/.done"

  echo "  $tag: finished. $(ls "$dir"/snap_*.hdf5 | wc -l | tr -d ' ') snapshots, $(du -sh "$dir" | cut -f1)"
  echo "  free disk: $(df -h / | tail -1 | awk '{print $4}')"
}

if [ "${1:-}" = "--all" ]; then
  for om in 0.15 0.30 0.45; do
    for w0 in -0.7 -1.0 -1.3; do run_one "$om" 0.80 "$w0"; done
  done
else
  run_one "$1" "$2" "$3"
fi
