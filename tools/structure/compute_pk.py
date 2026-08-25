#!/usr/bin/env python3
"""
Matter power spectrum from a SWIFT snapshot.

Done in post-processing rather than with SWIFT's `--power` because that flag
makes SWIFT segfault in FFTW plan teardown at exit (see SPEC.md); it also gives
control over the binning. It is cross-validated against SWIFT's own estimator on
one run -- see `--compare`.

Standard CIC estimator:
  * assign mass to a grid with cloud-in-cell,
  * FFT, take |delta_k|^2,
  * divide out the CIC window (assignment smooths the field, so leaving it in
    biases P(k) low, increasingly so toward the Nyquist frequency),
  * subtract shot noise V/N, which is white and dominates the small-scale end
    for a 128^3 particle load,
  * average in spherical k shells.
"""

from __future__ import annotations

import argparse
import pathlib

import h5py
import numpy as np


def cic(pos: np.ndarray, box: float, ngrid: int) -> np.ndarray:
    """Cloud-in-cell mass assignment onto a periodic ngrid^3 lattice."""
    g = pos * (ngrid / box)
    i0 = np.floor(g).astype(np.int64)
    d = g - i0
    field = np.zeros((ngrid, ngrid, ngrid), dtype=np.float64)
    for dx in (0, 1):
        wx = d[:, 0] if dx else 1.0 - d[:, 0]
        ix = (i0[:, 0] + dx) % ngrid
        for dy in (0, 1):
            wy = d[:, 1] if dy else 1.0 - d[:, 1]
            iy = (i0[:, 1] + dy) % ngrid
            for dz in (0, 1):
                wz = d[:, 2] if dz else 1.0 - d[:, 2]
                iz = (i0[:, 2] + dz) % ngrid
                np.add.at(field, (ix, iy, iz), wx * wy * wz)
    return field


def power_spectrum(path: pathlib.Path, ngrid: int = 128, nbins: int = 40):
    with h5py.File(path) as f:
        box = float(np.atleast_1d(f["Header"].attrs["BoxSize"])[0])
        pos = np.asarray(f["PartType1"]["Coordinates"][:], dtype=np.float64)
        a = float(np.atleast_1d(f["Header"].attrs["Time"])[0])
        z = float(np.atleast_1d(f["Header"].attrs["Redshift"])[0])
    n = len(pos)
    pos = np.mod(pos, box)

    rho = cic(pos, box, ngrid)
    delta = rho / rho.mean() - 1.0
    dk = np.fft.rfftn(delta) / ngrid**3

    kf = 2.0 * np.pi / box
    kx = np.fft.fftfreq(ngrid, d=1.0 / ngrid) * kf
    kz = np.fft.rfftfreq(ngrid, d=1.0 / ngrid) * kf
    KX, KY, KZ = np.meshgrid(kx, kx, kz, indexing="ij")
    kmag = np.sqrt(KX**2 + KY**2 + KZ**2)

    # CIC window: sinc^2 per axis, squared again because P ~ |delta_k|^2.
    ny = np.pi * ngrid / box
    w = np.ones_like(kmag)
    for K in (KX, KY, KZ):
        w *= np.sinc(K / (2.0 * ny))
    pk3d = np.abs(dk) ** 2 * box**3 / w**4

    # rfftn double-counts nothing at kz=0 and kz=Nyquist; weight the rest by 2.
    weight = np.full(kmag.shape, 2.0)
    weight[..., 0] = 1.0
    if ngrid % 2 == 0:
        weight[..., -1] = 1.0

    kmax = ny
    edges = np.logspace(np.log10(kf), np.log10(kmax), nbins + 1)
    idx = np.digitize(kmag.ravel(), edges) - 1
    ok = (idx >= 0) & (idx < nbins) & (kmag.ravel() > 0)
    wv, pv, kv, iv = weight.ravel()[ok], pk3d.ravel()[ok], kmag.ravel()[ok], idx[ok]
    wsum = np.bincount(iv, weights=wv, minlength=nbins)
    kbin = np.bincount(iv, weights=wv * kv, minlength=nbins) / np.maximum(wsum, 1e-30)
    pbin = np.bincount(iv, weights=wv * pv, minlength=nbins) / np.maximum(wsum, 1e-30)

    shot = box**3 / n
    good = wsum > 0
    return dict(k=kbin[good], p=pbin[good] - shot, p_raw=pbin[good],
                shot=shot, a=a, z=z, box=box, n=n, nmodes=wsum[good])


def read_swift_ps(path: pathlib.Path):
    """SWIFT's own power_spectra/power_matter_*.txt, for cross-validation."""
    rows = [l.split() for l in path.read_text().splitlines()
            if l.strip() and not l.startswith("#")]
    arr = np.array([[float(x) for x in r] for r in rows])
    # Columns are (0) z, (1) k, (2) shot-noise-SUBTRACTED P(k), (3) P_noise.
    # Column 0 is not k -- it is the redshift, constant down the whole file.
    return arr[:, 1], arr[:, 2]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("snapshot", type=pathlib.Path)
    ap.add_argument("--grid", type=int, default=128)
    ap.add_argument("--compare", type=pathlib.Path, help="SWIFT power_matter_*.txt")
    a = ap.parse_args()
    r = power_spectrum(a.snapshot, a.grid)
    print(f"  {a.snapshot.name}: z={r['z']:.3f}  box={r['box']:.2f}  N={r['n']:,}"
          f"  shot noise={r['shot']:.4g}")
    for i in range(0, len(r["k"]), max(1, len(r["k"]) // 10)):
        print(f"    k={r['k'][i]:9.4f}  P={r['p'][i]:12.4g}  ({int(r['nmodes'][i])} modes)")
    if a.compare and a.compare.exists():
        ks, ps = read_swift_ps(a.compare)
        mine = np.interp(ks, r["k"], r["p"])
        m = (ks > r["k"][0]) & (ks < r["k"][-1]) & (ps > 0) & (mine > 0)
        rel = np.abs(mine[m] / ps[m] - 1.0)
        print(f"\n  vs SWIFT's own estimator over {m.sum()} shared k bins:")
        print(f"    median |ratio-1| = {np.median(rel):.3%}   max = {rel.max():.3%}")


if __name__ == "__main__":
    main()
