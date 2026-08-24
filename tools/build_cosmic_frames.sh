#!/usr/bin/env bash
#
# Build the scroll-driven cosmic web frames for the page margins.
#
# Source: IllustrisTNG TNG300, most massive cluster, gas density
#   tng300_most_massive_cluster_gas_1080p.mp4  (1920x1080, 30 fps, 71 s)
#   https://www.tng-project.org/media/
#
# --- Framing -----------------------------------------------------------------
# Only the outer part of each side of each frame is ever visible -- the content
# column covers the middle -- so each output frame packs two source strips side
# by side. The left band draws the left half, the right band the right half.
# They are never mirrored, and never flipped.
#
# The strips are NOT the box's outer edges. They are two windows either side of
# the main cluster, which sits about 40% from the left: the left window carries
# that cluster, the right window carries the second-ranked one. The two windows
# overlap (1070 < 1180), which is fine -- the overlap falls entirely inside the
# region hidden behind the text column, so no structure is ever visible twice.
#
# Choosing the windows this way also crops the movie's own burned-in scale bar
# (x 12..215) and redshift readout (x 1781..1879) clean out of shot. Both are
# redrawn as DOM elements instead; see src/components/CosmicBands.astro.
#
# --- Timing ------------------------------------------------------------------
# Frames are sampled evenly in log10(1+z), not evenly in time.
#
# An earlier version of this script sampled evenly in time on the grounds that
# the clip "plays close to linear in log(1+z)". Measured against the burned-in
# labels, that is wrong: a linear fit through the 19 readings in Z_TABLE leaves
# a residual of 0.094 dex, a factor of 1.24 in (1+z). So the timestamps are
# obtained by inverting Z_TABLE instead, which also pins the endpoints exactly.
#
# Z_TABLE was read off the burned-in redshift label frame by frame. z(9.18) = 6.0
# and z(67.0) = 0.00 were both confirmed directly, as was the clip fading from
# t ~ 68, which is why the sequence stops at 67.
#
# --- Scale -------------------------------------------------------------------
# The camera is a fixed comoving frame. Across all 19 readings,
# label_kpc * (1 + z) / bar_pixels is constant to 2.2%, giving
# COMOVING_KPC_PER_PX below and a frame 22.1 cMpc across. That constant is what
# lets the runtime size a scale bar analytically at any redshift and any zoom.
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
STRIP_W=480          # source pixels per strip, and output pixels per strip: 1:1
STRIP_H=1080
LEFT_X0=700          # main cluster sits ~130 px in from here
RIGHT_X0=1070        # second cluster sits ~100 px in from this window's right edge
QUALITY=56           # avifenc -q; SSIM 0.986 against the source at this setting
Z_START=6.0
Z_END=0.0
T_STATIC=58.0        # static fallback: late enough to be recognisably a cluster
# Comoving scale of the source frame, least-squares over Z_TABLE. See header.
COMOVING_KPC_PER_PX=11.50

# (seconds, redshift) read off the burned-in label. Monotone, and the only
# description of the clip's timing that this script trusts.
#
# Sampled every second from t = 9 to 26 and every two seconds after. A coarser
# table was tried first and was not good enough: across t = 13..16, where the
# curve bends hardest, interpolation put a frame at z = 4.63 whose burned-in
# label read 4.5. At this density every sampled frame agrees with its label.
#
# Stops at 66, not 67: both read z = 0.00, and a repeated value would make the
# reverse lookup ambiguous. 66 is also two seconds clear of the fade at ~68.
Z_TABLE="0:10.0 2:8.5 4:7.4 6:6.8 8:6.3 \
9:6.0 10:5.8 11:5.6 12:5.3 13:4.9 14:4.4 15:4.1 16:3.9 17:3.6 18:3.4 \
19:3.1 20:2.9 21:2.7 22:2.5 23:2.4 24:2.2 25:2.0 26:1.9 \
28:1.7 30:1.6 32:1.5 34:1.3 36:1.2 38:1.1 40:0.98 42:0.88 44:0.78 46:0.69 \
48:0.60 50:0.52 52:0.44 54:0.37 56:0.30 58:0.23 60:0.17 62:0.11 64:0.05 66:0.00"

command -v ffmpeg  >/dev/null || { echo "ffmpeg not found"  >&2; exit 1; }
command -v avifenc >/dev/null || { echo "avifenc not found" >&2; exit 1; }
[ -f "$SRC" ] || { echo "source video not found: $SRC" >&2; exit 1; }

mkdir -p "$OUT"
echo "source : $SRC"
echo "output : $OUT"

# --- Timestamps and redshifts -------------------------------------------------
# Emits "<timestamp> <redshift>" per line, evenly spaced in log10(1+z).
#
# NB: python inline, via -c and not a heredoc. A <<- heredoc strips leading tabs,
# which silently destroys Python indentation.
schedule() {
	python3 -c '
import sys
n = int(sys.argv[1]); z0, z1 = float(sys.argv[2]), float(sys.argv[3])
from math import log10
pts = sorted((float(a), float(b)) for a, b in
             (p.split(":") for p in sys.argv[4].split()))
ts = [p[0] for p in pts]
ls = [log10(1 + p[1]) for p in pts]
# log10(1+z) falls monotonically with t, so reverse for a rising interpolant.
rl, rt = ls[::-1], ts[::-1]

def t_of(l):
    if l >= rl[-1]: return rt[-1]
    if l <= rl[0]:  return rt[0]
    for i in range(1, len(rl)):
        if l <= rl[i]:
            f = (l - rl[i-1]) / (rl[i] - rl[i-1])
            return rt[i-1] + f * (rt[i] - rt[i-1])
    return rt[-1]

a, b = log10(1 + z0), log10(1 + z1)
for i in range(n):
    l = a + (b - a) * (i / (n - 1))
    print("%.4f %.5f" % (t_of(l), 10 ** l - 1))
' "$1" "$Z_START" "$Z_END" "$Z_TABLE"
}

# --- One packed frame: two strips either side of the cluster, grayscale -------
# NB: -nostdin. Without it ffmpeg consumes the schedule that the surrounding
# `while read` loop is iterating over, and the run dies partway through on a
# truncated value.
extract() { # $1 = timestamp, $2 = width, $3 = height, $4 = output png
	ffmpeg -nostdin -v error -ss "$1" -i "$SRC" -frames:v 1 -filter_complex \
		"[0:v]format=gray,split=2[a][b];\
		 [a]crop=${STRIP_W}:${STRIP_H}:${LEFT_X0}:0[L];\
		 [b]crop=${STRIP_W}:${STRIP_H}:${RIGHT_X0}:0[R];\
		 [L][R]hstack=inputs=2,scale=$2:$3:flags=lanczos" \
		-y "$4"
}

echo
echo "Extracting $N_FRAMES sharp frames at $((STRIP_W * 2))x${STRIP_H} ..."
i=0
ZLIST=""
while read -r t z; do
	idx=$(printf "%03d" "$i")
	extract "$t" $((STRIP_W * 2)) "$STRIP_H" "$WORK/f$idx.png"
	avifenc --yuv 400 --depth 8 -s 4 -q "$QUALITY" "$WORK/f$idx.png" "$OUT/f$idx.avif" >/dev/null
	ZLIST="$ZLIST $z"
	i=$((i + 1))
	printf "\r  %d/%d" "$i" "$N_FRAMES"
done < <(schedule "$N_FRAMES")
echo

# --- Proxy atlas: every frame at 1/3 scale, in one image ---------------------
# Decoded once and kept resident, so the bands are never blank mid-fling even
# when the sharp frame for the current index has not been decoded yet.
echo "Building the $N_PROXY-frame proxy atlas ..."
PW=$((STRIP_W * 2 / 3))
PH=$((STRIP_H / 3))
i=0
while read -r t _z; do
	extract "$t" "$PW" "$PH" "$WORK/p$(printf "%03d" "$i").png"
	i=$((i + 1))
done < <(schedule "$N_PROXY")
ffmpeg -nostdin -v error -i "$WORK/p%03d.png" -filter_complex "tile=1x${N_PROXY}" -y "$WORK/atlas.png"
avifenc --yuv 400 --depth 8 -s 4 -q 40 "$WORK/atlas.png" "$OUT/atlas.avif" >/dev/null

# --- Static fallback ---------------------------------------------------------
# Shown by CSS when JavaScript never runs, when reduced motion is requested, or
# before the first frame decodes.
extract "$T_STATIC" $((STRIP_W * 2)) "$STRIP_H" "$WORK/static.png"
avifenc --yuv 400 --depth 8 -s 4 -q "$QUALITY" "$WORK/static.png" "$OUT/static.avif" >/dev/null

# --- Manifest ----------------------------------------------------------------
# comovingKpcPerPixel is per *output* pixel of the packed frame, so the runtime
# can go straight from a band's cover-fit scale to a physical length. The strips
# are extracted 1:1 here, but the STRIP_W ratio keeps that honest if they ever
# are not.
python3 - "$ZLIST" > "$OUT/manifest.json" <<PY
import json, sys
print(json.dumps({
    "frames": $N_FRAMES,
    "proxyFrames": $N_PROXY,
    "stripWidth": $STRIP_W,
    "stripHeight": $STRIP_H,
    "packedWidth": $((STRIP_W * 2)),
    "proxyWidth": $PW,
    "proxyHeight": $PH,
    "z": [round(float(v), 5) for v in sys.argv[1].split()],
    "comovingKpcPerPixel": $COMOVING_KPC_PER_PX * $STRIP_W / $STRIP_W,
    "sourceWindows": [[$LEFT_X0, $((LEFT_X0 + STRIP_W))], [$RIGHT_X0, $((RIGHT_X0 + STRIP_W))]],
    "source": "IllustrisTNG TNG300, most massive cluster, gas density",
    "sourceUrl": "https://www.tng-project.org/media/",
}, indent="\t"))
PY

echo
echo "Done."
du -sh "$OUT"
python3 -c "
import json, pathlib
d = pathlib.Path('$OUT')
m = json.loads((d / 'manifest.json').read_text())
z = m['z']
print(f'  z: {z[0]:.2f} -> {z[-1]:.2f} over {len(z)} frames')
tot = sum(f.stat().st_size for f in d.iterdir() if f.is_file())
print(f'  TOTAL {tot/1048576:.2f} MB')"
