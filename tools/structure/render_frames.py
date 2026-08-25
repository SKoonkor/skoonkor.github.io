#!/usr/bin/env python3
"""
SWIFT snapshot -> one 512^2 greyscale frame of a thin slab.

Design notes worth keeping, because each was a wrong turn first:

  * The snapshots carry `Coordinates` and nothing else (select_output.yml), so
    `project=None` cannot be used -- it reaches for `particle_ids`. A unit-mass
    array is attached instead, which makes the image a surface NUMBER density.
    Every DM particle in a run has the same mass, so that is the same picture as
    surface mass density up to a constant, and the constant divides out of the
    stretch.

  * DM gparts carry no smoothing lengths at all. `generate_smoothing_lengths`
    is mandatory, not optional; without it the projection is a shot-noise mess.
    NEIGHBOURS is 64, not swiftsimio's usual 24: at 24 the median hsml is 1.09
    Mpc, which at 512 pixels across a 142 Mpc box is 3.9 px -- the same as the
    128^3 Lagrangian grid spacing. Each kernel then covers barely its own cell
    and the initial particle lattice prints straight through the image as a
    visible square grid, worst at high z where the particles have hardly moved.
    Measured on snap_0005 (z=27), power at the 4-px grid frequency relative to
    the mean: 2.69x at 24 neighbours, 0.08x at 64, 0.02x at 128. 64 removes it;
    128 only blurs real structure further.

  * The stretch MUST be shared by every frame and every cosmology, or the panels
    are not comparable and the growth is invisible (each frame would self-
    normalise to look equally clumpy). It is taken from a reference frame -- in
    practice the z=0 frame of the densest cosmology -- and passed in.

  * swiftsimio reports the box in physical Mpc, not Mpc/h: 100 Mpc/h with
    h=0.703 comes back as 142.25. The slab thickness is converted the same way.

  * Quality 80, not 60. Measured against the lossless frame at z=0: q60 is
    16.1 KB with RMS error 1.86/255 and a worst pixel 27 off; q80 is 24.4 KB,
    RMS 1.16, worst 10; q90 is 33.5 KB for RMS 0.79. All four are visually
    indistinguishable, but a whole 9-run grid is only ~3.9 MB at q80, so there
    is no reason to accept the q60 error on halo cores. Size was never the
    binding constraint here -- the plan budgeted 13-16 MB and the real figure
    is a quarter of that.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess

import numpy as np
import unyt
from PIL import Image

H = 0.703
SLAB_MPC_H = 15.0
NEIGHBOURS = 64
RESOLUTION = 512


def project(path: pathlib.Path, resolution: int = RESOLUTION,
            slab_mpc_h: float = SLAB_MPC_H) -> tuple[np.ndarray, float, float]:
    """Return (image, a, z). Image is a raw surface density, not yet stretched."""
    import swiftsimio as sw
    from swiftsimio.objects import cosmo_array
    from swiftsimio.visualisation.projection import project_pixel_grid
    from swiftsimio.visualisation.smoothing_length import generate_smoothing_lengths

    data = sw.load(path)
    dm = data.dark_matter
    box = data.metadata.boxsize
    a, z = float(data.metadata.a), float(data.metadata.z)

    dm.smoothing_length = generate_smoothing_lengths(
        dm.coordinates, box, kernel_gamma=1.8, neighbours=NEIGHBOURS
    )
    n = dm.coordinates.shape[0]
    dm.masses = cosmo_array(
        np.ones(n, dtype=np.float32), units=unyt.Msun,
        comoving=True, scale_factor=a, scale_exponent=0,
    )

    side = float(box[0].value)
    slab = slab_mpc_h / H
    region = cosmo_array(
        [0.0, side, 0.0, side, 0.0, slab], units=box.units,
        comoving=True, scale_factor=a, scale_exponent=1,
    )
    img = np.asarray(
        project_pixel_grid(dm, resolution=resolution, project="masses",
                           region=region, periodic=True, backend="fast")
    )
    return img, a, z


def stretch(img: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """
    log10 of the density contrast, clipped to a shared [lo, hi], to 8-bit.

    Log, because the contrast spans 1.3x at z=50 and ~1e3 at z=0; a linear
    stretch that shows the cosmic web makes every early frame pure black.
    """
    d = img / img.mean()  # 1 + delta; mean-normalising removes the a-dependence
    v = np.log10(np.maximum(d, 1e-6))
    v = (v - lo) / (hi - lo)
    return (np.clip(v, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def encode(arr: np.ndarray, out: pathlib.Path, quality: int = 80) -> int:
    """Greyscale AVIF via avifenc --yuv 400; Pillow's AVIF writer has no 400."""
    tmp = out.with_suffix(".png")
    Image.fromarray(arr, mode="L").save(tmp)
    subprocess.run(
        ["avifenc", "--yuv", "400", "-q", str(quality), "-s", "4",
         str(tmp), str(out)],
        check=True, capture_output=True,
    )
    tmp.unlink()
    return out.stat().st_size


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run", type=pathlib.Path, help="run directory with snap_*.hdf5")
    ap.add_argument("--out", type=pathlib.Path)  # not needed with --probe
    ap.add_argument("--lo", type=float, help="log10 density contrast at black")
    ap.add_argument("--hi", type=float, help="log10 density contrast at white")
    ap.add_argument("--resolution", type=int, default=RESOLUTION)
    ap.add_argument("--quality", type=int, default=80)
    ap.add_argument("--probe", action="store_true",
                    help="print percentiles of the last frame and exit")
    a = ap.parse_args()

    snaps = sorted(a.run.glob("snap_*.hdf5"))
    if not snaps:
        raise SystemExit(f"no snapshots in {a.run}")

    if a.probe:
        img, sa, z = project(snaps[-1], a.resolution)
        d = np.log10(np.maximum(img / img.mean(), 1e-6))
        pct = np.percentile(d, [0.1, 1, 50, 99, 99.9, 100])
        print(f"  {snaps[-1].name}  a={sa:.5f} z={z:.3f}")
        print("  log10(1+delta) at 0.1/1/50/99/99.9/max:",
              " ".join(f"{x:+.3f}" for x in pct))
        return

    if a.out is None:
        raise SystemExit("--out is required")
    if a.lo is None or a.hi is None:
        raise SystemExit("--lo and --hi are required (run --probe first)")

    a.out.mkdir(parents=True, exist_ok=True)
    meta, total = [], 0
    for i, s in enumerate(snaps):
        img, sa, z = project(s, a.resolution)
        f = a.out / f"frame_{i:03d}.avif"
        total += encode(stretch(img, a.lo, a.hi), f, a.quality)
        meta.append({"i": i, "a": round(sa, 6), "z": round(z, 4), "file": f.name})
        print(f"  {f.name}  a={sa:.5f}  z={z:7.3f}  {f.stat().st_size/1024:5.1f} KB")

    (a.out / "frames.json").write_text(json.dumps(
        {"resolution": a.resolution, "slabMpcH": SLAB_MPC_H,
         "boxMpcH": 100.0, "stretch": [a.lo, a.hi], "frames": meta}, indent=1))
    print(f"\n  {len(meta)} frames, {total/2**20:.2f} MB total")


if __name__ == "__main__":
    main()
