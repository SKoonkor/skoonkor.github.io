#!/bin/bash
# Run one cosmology of the structure-formation grid, or resume the whole grid.
#
#   ./run_grid.sh 0.30 -1.0 today       # one run
#   ./run_grid.sh --all                 # every point, skipping finished ones
#
# Two normalisation conventions, both shipped as a toggle on the page:
#
#   today  every run has sigma_8 = 0.80 at z=0. Identical clustering now,
#          different histories. This is what MUSIC does by default.
#   start  every run has the same amplitude at z=50, so sigma_8 today differs.
#          MUSIC is handed sigma_8 x D_ref(a_ini)/D_i(a_ini) instead.
#
# The fiducial (Om=0.30, w0=-1.0) is the same run under both, so the grid is
# 9 + 8 = 17 runs, not 18.
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
SIGMA8_REF=0.80
FRAMES="$HOME/Documents/Suttikoon/Research_Projects/SWIFT_sim/frames"
RENDER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/render_frames.py"
STRETCH_LO=-0.9          # fixed for the whole grid -- see render_frames.py
STRETCH_HI=1.8
MIN_FREE_GB=4            # refuse to start a run with less headroom than this

a_begin=0.019607843      # z = 50, and it must equal the IC's own a

run_one () {
  local om=$1 w0=$2 norm=$3 s8

  # Under "start" the amplitude is matched at a_begin, so MUSIC gets a different
  # sigma_8 per cosmology. The tag carries the sigma_8 that was actually
  # simulated rather than the convention name, because that is the thing that
  # distinguishes the runs -- and it means the fiducial, where the two
  # conventions coincide, is stored once and listed under both.
  if [ "$norm" = "start" ]; then
    s8=$("$PY" -c "
import sys; sys.path.insert(0,'$(dirname "$MAKE_ICS")')
from growth import sigma8_for
print(f'{sigma8_for($SIGMA8_REF, $om, $w0, $a_begin):.3f}')")
  else
    s8=$(printf "%.3f" "$SIGMA8_REF")
  fi

  local tag; tag=$(printf "Om%.2f_s%.3f_w%+.1f" "$om" "$s8" "$w0")
  local dir="$GRID/$tag"

  if [ -f "$dir/.rendered" ]; then echo "  $tag: already rendered, skipping"; return; fi

  local free_gb; free_gb=$(df -g / | tail -1 | awk '{print $4}')
  if [ "$free_gb" -lt "$MIN_FREE_GB" ]; then
    echo "  STOP: ${free_gb} GB free, need ${MIN_FREE_GB}." >&2
    echo "  Snapshots of already-rendered runs are safe to delete:" >&2
    for d in "$GRID"/*/.rendered; do echo "    ${d%/.rendered}/snap_*.hdf5" >&2; done
    return 1
  fi
  mkdir -p "$dir"

  read -r ob ocdm ol <<< "$($PY -c "
om=$om; ob=($F_BARYON)*om
print(f'{ob:.6f} {om-ob:.6f} {1-om:.6f}')")"

  local ic="ic_${tag}.hdf5"
  if [ ! -f "$dir/$ic" ]; then
    "$PY" "$MAKE_ICS" --omega-m "$om" --sigma8 "$s8" --w0 "$w0" \
        --tag "$tag" --out "$dir"
  fi

  cp "$GRID/output_list.txt" "$GRID/select_output.yml" "$dir/"
  sed -e "s|@OMEGA_CDM@|$ocdm|" -e "s|@OMEGA_LAMBDA@|$ol|" -e "s|@OMEGA_B@|$ob|" \
      -e "s|@W0@|$w0|" -e "s|@IC@|$ic|" -e "s|@TAG@|$tag|" -e "s|@A_BEGIN@|$a_begin|" \
      "$GRID/run.yml.in" > "$dir/run.yml"

  echo "  $tag: Omega_cdm=$ocdm Omega_b=$ob Omega_lambda=$ol w_0=$w0 sigma8=$s8 ($norm) -- starting"
  # --power IS passed, and SWIFT may segfault in FFTW plan teardown at exit
  # because of it. That happens AFTER the last snapshot and the last spectrum
  # are on disk, so it costs nothing -- but it means the exit code cannot tell
  # "crashed at teardown, fine" from "crashed mid-run, lost". Run A exited 0 and
  # run B segfaulted from identical settings, so it is not even reproducible.
  #
  # Completion is therefore judged on the output: the expected number of
  # snapshots, and a final one actually at a = 1. `|| true` keeps set -e from
  # killing the whole grid over a teardown crash.
  ( cd "$dir" && caffeinate -dimsu "$SWIFT" --cosmology --self-gravity --power \
      --threads=$THREADS run.yml > run.log 2>&1 ) || true

  local want got
  want=$(grep -cvE '^\s*(#|$)' "$GRID/output_list.txt")
  got=$(ls "$dir"/snap_*.hdf5 2>/dev/null | wc -l | tr -d ' ')
  if ! "$PY" - "$dir" "$got" "$want" <<'PYEOF'
import sys, glob, h5py
d, got, want = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
snaps = sorted(glob.glob(f"{d}/snap_*.hdf5"))
if not snaps:
    sys.exit(f"no snapshots in {d}")
with h5py.File(snaps[-1]) as f:
    z = float(f["Header"].attrs["Redshift"][0])
# SWIFT skips an output_list entry that coincides with a_begin, hence want-1.
if got < want - 1:
    sys.exit(f"only {got} snapshots, expected {want - 1}")
if abs(z) > 1e-6:
    sys.exit(f"last snapshot is z={z:.4f}, not 0 -- run did not reach a=1")
PYEOF
  then
    echo "  $tag: INCOMPLETE -- not marking done, will retry on the next pass" >&2
    return 1
  fi
  touch "$dir/.done"

  echo "  $tag: finished. $(ls "$dir"/snap_*.hdf5 | wc -l | tr -d ' ') snapshots, $(du -sh "$dir" | cut -f1)"

  # Render straight away. 17 runs x 1.45 GB of snapshots is 24.7 GB and does not
  # fit on this disk, so snapshots have to become disposable within minutes of
  # being written rather than being kept for the whole grid. The frames are
  # 0.4 MB per run, so what survives is ~7 MB for the entire grid.
  "$PY" "$RENDER" "$dir" --out "$FRAMES/$tag" --lo "$STRETCH_LO" --hi "$STRETCH_HI" >/dev/null
  touch "$dir/.rendered"
  echo "  $tag: rendered to $FRAMES/$tag"
  echo "  SAFE TO DELETE: $dir/snap_*.hdf5  ($(du -ch "$dir"/snap_*.hdf5 | tail -1 | cut -f1))"
  echo "  free disk: $(df -h / | tail -1 | awk '{print $4}')"
}

if [ "${1:-}" = "--all" ]; then
  for norm in today start; do
    for om in 0.15 0.30 0.45; do
      for w0 in -0.7 -1.0 -1.3; do
        # The fiducial is identical under both conventions; run_one skips it the
        # second time round because the tag, and so the directory, is the same.
        run_one "$om" "$w0" "$norm" || exit 1
      done
    done
  done
else
  run_one "$1" "$2" "${3:-today}"
fi
