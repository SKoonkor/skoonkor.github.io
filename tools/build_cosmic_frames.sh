#!/usr/bin/env bash
#
# Build the scroll-driven cosmic web frames for the page margins.
#
# Source: IllustrisTNG TNG300, most massive cluster, gas density
#   tng300_most_massive_cluster_gas_1080p.mp4  (1920x1080, 30 fps, 71 s)
#   https://www.tng-project.org/media/
#
# Only the outer ~25% of each side of each frame is ever visible -- the content
# column covers the middle -- so each output frame packs the two edge strips side
# by side. The left band draws the left half, the right band the right half, so
# the two bands plus the column read as one continuous image. They are never
# mirrored: the burned-in scale bar and redshift readout would come out
# backwards.
#
# Frames are sampled evenly in time. That is not a shortcut: reading the burned-in
# labels off the clip gives z = 10.0, 2.3, 0.69, 0.07 at t = 0, 23, 47, 67, i.e.
# log(1+z) = 1.04, 0.52, 0.23, 0.03 -- so the source already plays close to linear
# in log(1+z), and an even sample in time is very nearly an even sample in cosmic
# structure growth. Resample here if that ever stops being true.
#
# Usage:  tools/build_cosmic_frames.sh [path-to-mp4]

set -euo pipefail

SRC="${1:-$HOME/Documents/Suttikoon/Website/tng300_most_massive_cluster_gas_1080p.mp4}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/cosmic-web"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- Parameters --------------------------------------------------------------
N_FRAMES=90          # sharp frames
N_PROXY=24           # low-res frames packed into one always-resident atlas
STRIP_W=480          # 25% of 1920, per side
STRIP_H=1080
QUALITY=56           # avifenc -q; SSIM 0.986 against the source at this setting
# The clip fades to black after ~67.5 s, so the usable span is 0 .. 67.
T_START=0.0
T_END=67.0
# Redshift at the ends, read off the burned-in labels.
Z_START=10.0
Z_END=0.07

command -v ffmpeg  >/dev/null || { echo "ffmpeg not found"  >&2; exit 1; }
command -v avifenc >/dev/null || { echo "avifenc not found" >&2; exit 1; }
[ -f "$SRC" ] || { echo "source video not found: $SRC" >&2; exit 1; }

mkdir -p "$OUT"
echo "source : $SRC"
echo "output : $OUT"

# --- Timestamps --------------------------------------------------------------
# NB: python inline, via -c and not a heredoc. A <<- heredoc strips leading tabs,
# which silently destroys Python indentation.
timestamps() {
	python3 -c '
import sys, math
n = int(sys.argv[1]); t0, t1 = float(sys.argv[2]), float(sys.argv[3])
z0, z1 = float(sys.argv[4]), float(sys.argv[5])
a0, a1 = math.log10(1 + z0), math.log10(1 + z1)
for i in range(n):
    f = i / (n - 1)
    # Even steps in time; see the note at the top on why that tracks log(1+z).
    print("%.4f" % (t0 + (t1 - t0) * f))
' "$1" "$T_START" "$T_END" "$Z_START" "$Z_END"
}

# --- One packed frame: two edge strips, grayscale -----------------------------
# NB: -nostdin. Without it ffmpeg consumes the timestamp list that the
# surrounding `while read` loop is iterating over, and the run dies partway
# through on a truncated value.
extract() { # $1 = timestamp, $2 = width, $3 = height, $4 = output png
	ffmpeg -nostdin -v error -ss "$1" -i "$SRC" -frames:v 1 -filter_complex \
		"[0:v]format=gray,split=2[a][b];\
		 [a]crop=${STRIP_W}:${STRIP_H}:0:0[L];\
		 [b]crop=${STRIP_W}:${STRIP_H}:$((1920 - STRIP_W)):0[R];\
		 [L][R]hstack=inputs=2,scale=$2:$3:flags=lanczos" \
		-y "$4"
}

echo
echo "Extracting $N_FRAMES sharp frames at $((STRIP_W * 2))x${STRIP_H} ..."
i=0
while read -r t; do
	idx=$(printf "%03d" "$i")
	extract "$t" $((STRIP_W * 2)) "$STRIP_H" "$WORK/f$idx.png"
	avifenc --yuv 400 --depth 8 -s 4 -q "$QUALITY" "$WORK/f$idx.png" "$OUT/f$idx.avif" >/dev/null
	i=$((i + 1))
	printf "\r  %d/%d" "$i" "$N_FRAMES"
done < <(timestamps "$N_FRAMES")
echo

# --- Proxy atlas: every frame at 1/3 scale, in one image ---------------------
# Decoded once and kept resident, so the bands are never blank mid-fling even
# when the sharp frame for the current index has not been decoded yet.
echo "Building the $N_PROXY-frame proxy atlas ..."
PW=$((STRIP_W * 2 / 3))
PH=$((STRIP_H / 3))
i=0
while read -r t; do
	extract "$t" "$PW" "$PH" "$WORK/p$(printf "%03d" "$i").png"
	i=$((i + 1))
done < <(timestamps "$N_PROXY")
ffmpeg -nostdin -v error -i "$WORK/p%03d.png" -filter_complex "tile=1x${N_PROXY}" -y "$WORK/atlas.png"
avifenc --yuv 400 --depth 8 -s 4 -q 40 "$WORK/atlas.png" "$OUT/atlas.avif" >/dev/null

# --- Static fallback ---------------------------------------------------------
# Shown by CSS when JavaScript never runs, when reduced motion is requested, or
# before the first frame decodes. Taken from late in the sequence, where the
# cosmic web is most recognisable.
extract 60.0 $((STRIP_W * 2)) "$STRIP_H" "$WORK/static.png"
avifenc --yuv 400 --depth 8 -s 4 -q "$QUALITY" "$WORK/static.png" "$OUT/static.avif" >/dev/null

# --- Manifest ----------------------------------------------------------------
python3 - > "$OUT/manifest.json" <<PY
import json
print(json.dumps({
    "frames": $N_FRAMES,
    "proxyFrames": $N_PROXY,
    "stripWidth": $STRIP_W,
    "stripHeight": $STRIP_H,
    "packedWidth": $((STRIP_W * 2)),
    "proxyWidth": $PW,
    "proxyHeight": $PH,
    "zStart": $Z_START,
    "zEnd": $Z_END,
    "source": "IllustrisTNG TNG300, most massive cluster, gas density",
    "sourceUrl": "https://www.tng-project.org/media/",
}, indent="\t"))
PY

echo
echo "Done."
du -sh "$OUT"
ls -la "$OUT" | awk 'NR>3 {printf "  %-16s %8.1f KB\n", $NF, $5/1024}' | head -6
echo "  ..."
python3 -c "
import pathlib
d = pathlib.Path('$OUT')
tot = sum(f.stat().st_size for f in d.iterdir() if f.is_file())
print(f'  TOTAL            {tot/1048576:8.2f} MB')"
