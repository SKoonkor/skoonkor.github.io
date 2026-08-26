#!/usr/bin/env python3
"""
Friends-of-friends halo finding on the SWIFT snapshots.

Written rather than using SWIFT's own FOF because this build has WITH_FOF undef,
and enabling it would mean rebuilding SWIFT *and* patching all 663 snapshots with
synthetic Masses, Velocities and ParticleIDs to make them readable as initial
conditions -- the same four blockers the MUSIC ICs hit, for no gain. The
snapshots carry Coordinates and nothing else, and that is sufficient: every dark
matter particle in a run has the same mass, and that mass is analytic.

    m_p = Omega_m * rho_crit * L^3 / N

which gives 1.985e10 / 3.970e10 / 5.955e10 Msun/h across the Omega_m axis. The
Omega_m = 0.30 value agrees with the mass measured off the initial conditions
(3.9711e10) to 0.02%, so the formula is not being taken on trust.

Halo mass is then simply (particles in the group) x m_p.

Two implementation notes worth keeping:

  * Periodic wrapping comes free from cKDTree's `boxsize`. Verified empirically
    -- `inspect` cannot read a C extension's signature and reports the parameter
    as absent, which is wrong.

  * Grouping uses scipy's connected_components on the pair graph, NOT a Python
    union-find. Measured on snap_0038 of the fiducial run: 3.3 s against 33 s,
    for byte-identical output (3,547 groups of >=32 particles, largest 13,455).
    Over 663 snapshots that is the difference between 36 minutes and six hours.

What is written is a HISTOGRAM of halo masses per epoch, not a halo catalogue.
17 runs x 39 epochs x 23 bins is ~15k integers; the individual halos are millions
of rows and nothing on the website needs them. dn/dlnM, N(>M) and counts above a
threshold are all derivable from binned counts in the browser.

Run:  python3 find_halos.py --grid DIR --out DIR
"""

from __future__ import annotations

import argparse
import json
import pathlib
import time

import h5py
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

# Same directory. The slab depth must come from the renderer rather than being
# retyped here: circles are drawn on frames rendered from that slab, and two
# independent constants would drift.
from render_frames import H as RENDER_H
from render_frames import SLAB_MPC_H

# Msun/h per Mpc^3, with h factors left in: rho_crit,0 = 3H0^2/8piG.
RHO_CRIT = 2.77536627e11
BOX_MPC_H = 100.0
N_SIDE = 128

#: Standard FOF linking length, in units of the mean interparticle separation.
#: b = 0.2 selects roughly the virialised region, giving masses close to M_200m.
LINKING_LENGTH = 0.2

#: Groups below this are not resolved well enough to be called halos. The mass
#: this corresponds to DIFFERS PER RUN, because m_p scales with Omega_m -- see
#: the note in the module docstring for export_web.py.
N_MIN_PARTICLES = 32

#: Only halos above this are worth circling; below it there is nothing to see.
CIRCLE_MIN_MASS = 1e12

#: log10(M / [Msun/h]) bin edges, shared by every run so the browser can compare
#: them directly. The range covers the lowest 32-particle floor on the grid
#: (10^11.80 at Omega_m = 0.15) through the most massive halo seen (~10^14.8).
LOG_M_EDGES = np.round(np.arange(11.0, 15.61, 0.2), 4)


def particle_mass(omega_m: float, n_particles: int) -> float:
    """Mass of one dark matter particle, in Msun/h."""
    return omega_m * RHO_CRIT * BOX_MPC_H**3 / n_particles


def group_sizes(path: pathlib.Path):
    """(sizes, labels, positions, box) for one snapshot."""
    with h5py.File(path) as f:
        box = float(np.atleast_1d(f["Header"].attrs["BoxSize"])[0])
        pos = np.asarray(f["PartType1"]["Coordinates"][:], dtype=np.float64)

    n = len(pos)
    # cKDTree's periodic mode requires every coordinate inside [0, box).
    pos = np.mod(pos, box)
    b = LINKING_LENGTH * box / n ** (1.0 / 3.0)

    pairs = cKDTree(pos, boxsize=box).query_pairs(b, output_type="ndarray")
    if len(pairs) == 0:
        # Early epochs really do have no linked pairs at all; every particle is
        # its own group and there are no halos.
        return np.ones(n, dtype=np.int64), np.arange(n), pos, box

    graph = coo_matrix(
        (np.ones(len(pairs), dtype=np.int8), (pairs[:, 0], pairs[:, 1])),
        shape=(n, n),
    )
    _, labels = connected_components(graph, directed=False)
    return np.bincount(labels), labels, pos, box


def periodic_centre(p: np.ndarray, box: float) -> np.ndarray:
    """
    Centre of mass of one group, respecting periodic wrapping.

    Averaging raw coordinates would put a halo straddling the box edge in the
    middle of the box. Unwrapping every member relative to the first fixes that,
    and a FOF group is by construction smaller than half the box so the
    minimum-image convention is safe here.
    """
    ref = p[0]
    d = p - ref
    d -= box * np.round(d / box)
    return np.mod(ref + d.mean(axis=0), box)


def top_in_slab(sizes, labels, pos, box, m_p, keep=2):
    """
    The `keep` most massive halos whose centre falls inside the projected slab.

    Restricted to the slab because the frames only show that slab: a circle on a
    halo behind it would sit on apparently empty sky. Only ~15% of the box is
    rendered, so this is not a small correction -- of the twelve most massive
    halos at z = 0, two are in the slab.
    """
    slab = SLAB_MPC_H / RENDER_H
    out = []
    # Walk from the most massive down, stopping once `keep` are in the slab.
    for gid in np.argsort(sizes)[::-1]:
        m = sizes[gid] * m_p
        if m < CIRCLE_MIN_MASS or len(out) >= keep:
            break
        c = periodic_centre(pos[labels == gid], box)
        if c[2] > slab:
            continue
        out.append({
            "fx": round(float(c[0] / box), 5),
            "fy": round(float(c[1] / box), 5),
            "m": float(f"{m:.4g}"),
        })
    return out


def run_one(run_dir: pathlib.Path, omega_m: float) -> dict:
    """Histogram halo masses for every snapshot of one cosmology."""
    snaps = sorted(run_dir.glob("snap_*.hdf5"))
    if not snaps:
        raise SystemExit(f"no snapshots in {run_dir}")

    counts, biggest, top, n_particles = [], [], [], None
    for snap in snaps:
        t0 = time.time()
        sizes, labels, pos, box = group_sizes(snap)
        if n_particles is None:
            n_particles = int(sizes.sum())
        m_p = particle_mass(omega_m, n_particles)

        # Singletons and pairs are not halos; drop them before binning so the
        # lowest bin is not dominated by unbound particles.
        real = sizes[sizes >= 2]
        log_m = np.log10(np.maximum(real, 1) * m_p)
        hist, _ = np.histogram(log_m, bins=LOG_M_EDGES)
        counts.append([int(c) for c in hist])
        biggest.append(int(sizes.max()))
        top.append(top_in_slab(sizes, labels, pos, box, m_p))
        print(
            f"    {snap.name}  {len(real):7,} groups  largest {sizes.max():6,}p"
            f"  ({time.time() - t0:.1f}s)",
            flush=True,
        )

    return {
        "mParticle": float(particle_mass(omega_m, n_particles)),
        "nParticles": n_particles,
        "counts": counts,
        "largestGroup": biggest,
        "topHalos": top,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grid", type=pathlib.Path, required=True)
    ap.add_argument("--out", type=pathlib.Path, required=True)
    ap.add_argument("--only", help="substring filter on the run tag")
    ap.add_argument("--force", action="store_true", help="recompute runs already done")
    a = ap.parse_args()

    a.out.mkdir(parents=True, exist_ok=True)
    runs = sorted(p for p in a.grid.iterdir() if p.is_dir() and (p / ".rendered").exists())
    if a.only:
        runs = [r for r in runs if a.only in r.name]

    for run in runs:
        dest = a.out / f"{run.name}.json"
        if dest.exists() and not a.force:
            print(f"  {run.name}: already done, skipping", flush=True)
            continue
        # Omega_m is in the tag, and cross-checked against run.yml below.
        omega_m = float(run.name.split("_")[0][2:])
        yml = (run / "run.yml").read_text()
        import re

        ocdm = float(re.search(r"^\s*Omega_cdm:\s*([\d.]+)", yml, re.M).group(1))
        ob = float(re.search(r"^\s*Omega_b:\s*([\d.]+)", yml, re.M).group(1))
        if abs((ocdm + ob) - omega_m) > 1e-6:
            raise SystemExit(f"{run.name}: tag says Om={omega_m} but run.yml says {ocdm + ob}")

        print(f"  {run.name}  (Omega_m = {omega_m})", flush=True)
        t0 = time.time()
        dest.write_text(json.dumps(run_one(run, omega_m)))
        print(f"  {run.name}: done in {(time.time() - t0) / 60:.1f} min\n", flush=True)


if __name__ == "__main__":
    main()
