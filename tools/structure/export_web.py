#!/usr/bin/env python3
"""
Assemble what the /explore/structure-growth/ page actually fetches.

Writes two JSON files and copies the rendered frames:

  public/data/structure-growth/structure.json   grid, epochs, growth histories
  public/data/structure-growth/pk.json          matter power spectra
  public/structure-frames/<tag>/frame_NNN.avif  39 frames per cosmology

Split into two files on purpose. `structure.json` is small and is needed before
anything can be drawn; `pk.json` is an order of magnitude larger and is only
needed if the reader opens the quantitative panel, so the page lazy-loads it.

Two invariants are asserted rather than assumed, because the whole design leans
on them and both are cheap to check:

  * every run lands on the SAME scale-factor grid, so the time slider is shared
    and `z[]` ships once instead of nine times;
  * every run's P(k) lands on the SAME k bins, so `k[]` ships once too.

Both are exactly true today (max difference 0.0 on the pilot pair) because box,
particle count and P(k) grid are fixed across the grid -- but a future change to
any of those would break them silently, and a wrong-by-one-epoch slider is the
kind of bug that looks like physics.
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import pathlib
import re
import shutil
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from compute_pk import read_swift_ps  # noqa: E402
from growth import age_gyr, growth_and_f, sigma8_for  # noqa: E402

H = 0.703
BOX_MPC_H = 100.0
SIG_FIGS = 5
SIGMA8_REF = 0.80
A_BEGIN = 1.0 / 51.0

# The grid the campaign intends to produce, which is NOT the same as the grid
# that exists at any given moment -- the runs land over about nineteen hours.
# The page renders its controls from this, marking what has not arrived yet, so
# that a run completing needs an export and nothing else.
GRID_OMEGA_M = (0.15, 0.30, 0.45)
GRID_W0 = (-0.7, -1.0, -1.3)
GRID_NORM = ("today", "start")


def sig(x: float, n: int = SIG_FIGS) -> float:
    """Round to n significant figures. P(k) spans 5 decades; %.5g halves the file."""
    return float(f"%.{n}g" % x)


def grid_tag(omega_m: float, w0: float, norm: str) -> tuple[str, float]:
    """
    (tag, sigma8) for one intended grid point.

    Must agree exactly with run_grid.sh, which names directories the same way --
    if the two drift, the page asks for frames under a path the renderer never
    wrote. Both derive sigma_8 for the 'start' convention from the same
    growth.sigma8_for().
    """
    s8 = SIGMA8_REF if norm == "today" else sigma8_for(SIGMA8_REF, omega_m, w0, A_BEGIN)
    return f"Om{omega_m:.2f}_s{s8:.3f}_w{w0:+.1f}", round(float(s8), 3)


def intended_grid(available: set[str]) -> dict:
    """Every point the campaign will produce, flagged with whether it is here yet."""
    points, seen = [], {}
    for norm in GRID_NORM:
        for om in GRID_OMEGA_M:
            for w0 in GRID_W0:
                tag, s8 = grid_tag(om, w0, norm)
                # The fiducial has the same sigma_8 under both conventions and so
                # the same tag; it is one run that serves two points.
                key = (tag, norm)
                if key in seen:
                    continue
                seen[key] = True
                points.append({
                    "omegaM": om, "w0": w0, "normalisation": norm,
                    "tag": tag, "sigma8": s8, "available": tag in available,
                })
    tags = {p["tag"] for p in points}
    return {
        "omegaM": list(GRID_OMEGA_M), "w0": list(GRID_W0),
        "normalisation": list(GRID_NORM), "points": points,
        "nAvailable": len(tags & available), "nTotal": len(tags),
    }


def parse_run_yml(path: pathlib.Path) -> dict:
    """Read the cosmology back out of the .yml the driver generated."""
    txt = path.read_text()

    def grab(key: str) -> float:
        m = re.search(rf"^\s*{key}:\s*([-\d.eE+]+)", txt, re.M)
        if not m:
            raise SystemExit(f"{path}: no {key}")
        return float(m.group(1))

    ocdm, ob = grab("Omega_cdm"), grab("Omega_b")
    return {
        "omegaM": round(ocdm + ob, 6),
        "omegaB": ob,
        "omegaLambda": grab("Omega_lambda"),
        "w0": grab("w_0"),
        "h": grab("h"),
    }


def read_spectra(run_dir: pathlib.Path):
    """(z[n_epoch], k[n_k], P[n_epoch, n_k], shot_noise) from SWIFT's estimator."""
    files = sorted(glob.glob(str(run_dir / "power_spectra" / "power_matter_*.txt")))
    z, k, rows, shot = [], None, [], None
    for f in files:
        p = pathlib.Path(f)
        body = [l for l in p.read_text().splitlines() if l.strip() and not l.startswith("#")]
        z.append(float(body[0].split()[0]))
        shot = float(body[0].split()[3])
        ki, pi = read_swift_ps(p)
        if k is None:
            k = ki
        elif not np.array_equal(k, ki):
            raise SystemExit(f"{p.name}: k bins differ within a single run")
        rows.append(pi)
    return np.array(z), k, np.array(rows), shot


def usable_bins(P: np.ndarray, shot: float) -> list[int]:
    """
    Per epoch, the number of leading k bins the page may plot.

    SWIFT reports P(k) with the shot noise already subtracted. At high redshift
    the field is still nearly uniform, so the true power falls BELOW the shot
    noise and the subtraction goes negative -- 28% of the (epoch, k) grid at
    128^3, everywhere above z = 6.5. Those entries are not wrong, they are
    measurements of nothing, and a log axis cannot draw them at all.

    The cut is the first bin where the signal drops below the shot noise, i.e.
    signal-to-noise per bin < 1. Everything at or beyond it is discarded by the
    page rather than silently clipped, so an early-time P(k) curve simply stops
    where the simulation stops being able to say anything.
    """
    out = []
    for row in P:
        bad = np.where(row <= shot)[0]
        out.append(int(bad[0]) if len(bad) else int(len(row)))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grid", type=pathlib.Path, required=True, help="SWIFT run dirs")
    ap.add_argument("--frames", type=pathlib.Path, required=True, help="rendered AVIFs")
    ap.add_argument("--halos", type=pathlib.Path,
                    help="directory of per-run JSON written by find_halos.py")
    ap.add_argument("--public", type=pathlib.Path, default=pathlib.Path("public"))
    ap.add_argument("--no-copy", action="store_true", help="JSON only, leave frames")
    a = ap.parse_args()

    tags = sorted(p.name for p in a.frames.iterdir()
                  if p.is_dir() and (p / "frames.json").exists())
    if not tags:
        raise SystemExit(f"no rendered runs under {a.frames}")

    epochs_a = epochs_z = None
    k_ref = None
    runs, growth_out, pk_out = [], {}, {}

    for tag in tags:
        fmeta = json.loads((a.frames / tag / "frames.json").read_text())
        frames = fmeta["frames"]
        av = np.array([f["a"] for f in frames])
        zv = np.array([f["z"] for f in frames])

        if epochs_a is None:
            epochs_a, epochs_z = av, zv
        elif len(av) != len(epochs_a) or not np.allclose(av, epochs_a, atol=1e-9):
            raise SystemExit(
                f"{tag}: scale-factor grid differs from {tags[0]}. Every run must "
                "share one grid -- the time slider and the side-by-side both "
                "depend on it. Check output_list.txt was copied unmodified."
            )

        run_dir = a.grid / tag
        cos = parse_run_yml(run_dir / "run.yml")
        m = re.search(r"_s([\d.]+)_", tag)
        cos["sigma8"] = float(m.group(1)) if m else None
        cos["tag"] = tag
        cos["nframes"] = len(frames)
        # MUSIC normalises sigma_8 at z=0, so every run on this grid has the same
        # clustering today by construction. The alternative convention -- matching
        # the amplitude at a_begin instead, which is what makes the w0 axis show
        # anything -- needs its own IC and its own run, so it is recorded per run
        # rather than derived here.
        # A run belongs to a convention if its simulated sigma_8 matches what
        # that convention asks for. The fiducial satisfies both, so it is stored
        # once on disk and listed twice here -- which is the whole reason the tag
        # carries sigma_8 rather than the convention's name.
        conv = []
        if abs(cos["sigma8"] - SIGMA8_REF) < 5e-4:
            conv.append("today")
        if abs(cos["sigma8"] - sigma8_for(SIGMA8_REF, cos["omegaM"], cos["w0"],
                                          A_BEGIN)) < 5e-4:
            conv.append("start")
        if not conv:
            raise SystemExit(f"{tag}: sigma8={cos['sigma8']} matches neither convention")
        cos["normalisation"] = conv
        D, f = growth_and_f(av, cos["omegaM"], cos["w0"])
        growth_out[tag] = {
            "D": [sig(x) for x in D],
            "f": [sig(x) for x in f],
            "sigma8": [sig(cos["sigma8"] * x) for x in D],
            "tGyr": [sig(x, 4) for x in age_gyr(av, cos["omegaM"], cos["w0"], h=cos["h"])],
            "simulated": True,
        }
        runs.append(cos)

        with __import__("h5py").File(next(run_dir.glob("snap_*.hdf5"))) as hf:
            n_particles = int(hf["PartType1"]["Coordinates"].shape[0])

        zs, k, P, shot = read_spectra(run_dir)
        if len(zs) != len(av):
            raise SystemExit(f"{tag}: {len(zs)} spectra but {len(av)} frames")
        if k_ref is None:
            k_ref = k
        elif not np.allclose(k, k_ref, atol=1e-12):
            raise SystemExit(f"{tag}: k bins differ from {tags[0]}")
        pk_out[tag] = {"P": [[sig(x) for x in row] for row in P],
                       "shotNoise": sig(shot),
                       "usableBins": usable_bins(P, shot)}

    stretch = fmeta["stretch"]
    structure_z = [round(x, 4) for x in epochs_z]
    now = dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    intended = intended_grid(set(tags))
    # Growth for EVERY intended point, simulated or not (see above).
    for pt in intended["points"]:
        if pt["tag"] in growth_out:
            continue
        D, f = growth_and_f(epochs_a, pt["omegaM"], pt["w0"])
        growth_out[pt["tag"]] = {
            "D": [sig(x) for x in D],
            "f": [sig(x) for x in f],
            "sigma8": [sig(pt["sigma8"] * x) for x in D],
            "tGyr": [sig(x, 4) for x in age_gyr(epochs_a, pt["omegaM"], pt["w0"], h=H)],
            "simulated": pt["available"],
        }

    structure = {
        "schema": "structure-growth/1",
        "box": {
            "sizeMpcH": fmeta["boxMpcH"], "slabMpcH": fmeta["slabMpcH"],
            "resolution": fmeta["resolution"], "particles": n_particles, "seed": 20260825,
        },
        "stretch": stretch,
        "epochs": {"a": [round(x, 6) for x in epochs_a], "z": structure_z},
        "runs": runs,
        "growth": growth_out,
        "intendedGrid": intended,
        "axes": {
            "omegaM": sorted({r["omegaM"] for r in runs}),
            "w0": sorted({r["w0"] for r in runs}),
            "sigma8": sorted({r["sigma8"] for r in runs}),
            "normalisation": ["today", "start"],
        },
        "units": {
            "D": "linear growth factor, normalised to 1 at a=1",
            "f": "dlnD/dlna, the linear growth rate",
            "sigma8": "sigma_8 at that epoch, = sigma_8(z=0) x D(a)",
            "normalisation": "which amplitude conventions this run serves. "
                             "'today' = sigma_8 is 0.80 at z=0; 'start' = the "
                             "amplitude at z=50 equals the fiducial's. The "
                             "fiducial serves both.",
            "stretch": "log10(1+delta) mapped to black and to white",
            "slabMpcH": "projection depth along z, in Mpc/h",
        },
        # A handful of exact values, so a future change to the binning, the units
        # or the rounding is caught by comparison rather than by eye. Same idea
        # as lf.json's `golden`.
        "golden": [
            {"tag": t, "epochIndex": i, "z": structure_z[i],
             "D": growth_out[t]["D"][i], "kIndex": j,
             "k": sig(float(k_ref[j])), "P": pk_out[t]["P"][i][j]}
            for t in (tags[0], tags[-1])
            for i, j in ((0, 5), (len(epochs_a) // 2, 12), (len(epochs_a) - 1, 20))
        ],
        "provenance": {
            "code": "SWIFT 2026.04, --cosmology --self-gravity --power",
            "ics": "MUSIC, Eisenstein-Hu transfer, 2LPT, one seed for the whole grid",
            "note": "Omega_b scales with Omega_m at fixed f_b = 0.151667. This keeps the "
                    "baryon feature in the transfer function from tracking the matter "
                    "density; it does not make the off-fiducial points observationally "
                    "allowed -- only the fiducial has a BBN-consistent Omega_b h^2.",
            "generated_utc": now,
        },
    }

    pk = {
        "schema": "structure-growth-pk/1",
        "k": [sig(x) for x in k_ref],
        "epochs": structure["epochs"]["z"],
        "units": {"k": "1/Mpc (h-free)", "P": "Mpc^3, shot noise subtracted",
                  "shotNoise": "Mpc^3, the V/N white noise already removed from P",
                  "usableBins": "per epoch, how many leading k bins have S/N > 1; "
                                "plot only these -- the rest are negative or noise"},
        "runs": pk_out,
    }

    # The browser caches /data/*.json under ?v=DATA_VERSION. That constant lived
    # in common.js as a hand-bumped "2026-08", which meant a reader who visited
    # while the grid was part-finished kept a stale structure.json and never saw
    # the runs that landed afterwards -- exactly what this page exists to show.
    # Stamping it from the exporter ties the cache key to the data it describes.
    ver = pathlib.Path("src/scripts/explore/data-version.js")
    if ver.parent.exists():
        ver.write_text(
            "// Generated by tools/structure/export_web.py -- do not edit by hand.\n"
            "// Cache key for everything under /data/. Regenerated whenever the\n"
            "// simulation data is re-exported, so a stale copy is never served.\n"
            f'export const DATA_VERSION = "{now.replace(":", "").replace("-", "")}";\n'
        )
        print(f"  data-version.js: {now}")

    # --- halos ---------------------------------------------------------------
    # Kept in its own file and lazy-loaded, like pk.json: it is only needed if
    # the reader opens one of the halo views.
    halos = None
    if a.halos and a.halos.exists():
        runs_h = {}
        for tag in tags:
            f = a.halos / f"{tag}.json"
            if not f.exists():
                continue
            blk = json.loads(f.read_text())
            if len(blk["counts"]) != len(epochs_a):
                raise SystemExit(
                    f"{tag}: {len(blk['counts'])} halo epochs but {len(epochs_a)} frames"
                )
            runs_h[tag] = {
                "mParticle": sig(blk["mParticle"]),
                "counts": blk["counts"],
                "largestGroup": blk["largestGroup"],
                # Up to two per epoch: the most massive halos whose centre lies
                # inside the projected slab, as fractions of the box. Only those
                # can be circled on a frame -- a halo behind the slab is not in
                # the picture at all.
                "topHalos": blk.get("topHalos", []),
            }
        if runs_h:
            halos = {
                "schema": "structure-growth-halos/1",
                # log10(M / [Msun/h]) bin edges, shared by every run.
                "logMassEdges": [round(11.0 + 0.2 * i, 4) for i in range(24)],
                "boxVolume": BOX_MPC_H**3,
                "linkingLength": 0.2,
                "nMinParticles": 32,
                "epochs": structure_z,
                "units": {
                    "logMassEdges": "log10(M / [Msun/h]); halo mass is FOF group "
                                    "size x mParticle, close to M_200m at b = 0.2",
                    "counts": "[epoch][bin] raw halo counts in the box. Raw, so the "
                              "page can draw sqrt(N) Poisson bars -- the massive end "
                              "has tens of objects, not thousands",
                    "boxVolume": "(Mpc/h)^3, for turning counts into number densities",
                    "topHalos": "[epoch] -> up to two {fx, fy, m}: box-fraction "
                                "position and mass of the most massive halos inside "
                                "the 15 Mpc/h slab the frames show. fx maps to the "
                                "image ROW and fy to the column.",
                    "mParticle": "Msun/h. DIFFERS PER RUN because it scales with "
                                 "Omega_m, so each run's resolution floor "
                                 "(nMinParticles x mParticle) sits at a different "
                                 "mass. Truncate every curve at its own floor.",
                },
                "runs": runs_h,
            }

    out = a.public / "data" / "structure-growth"
    out.mkdir(parents=True, exist_ok=True)
    (out / "structure.json").write_text(json.dumps(structure, indent=1))
    (out / "pk.json").write_text(json.dumps(pk, separators=(",", ":")))
    if halos:
        (out / "halos.json").write_text(json.dumps(halos, separators=(",", ":")))

    if not a.no_copy:
        for tag in tags:
            dst = a.public / "structure-frames" / tag
            dst.mkdir(parents=True, exist_ok=True)
            for f in sorted((a.frames / tag).glob("frame_*.avif")):
                shutil.copy2(f, dst / f.name)

    for name in ("structure.json", "pk.json", "halos.json"):
        if not (out / name).exists():
            continue
        print(f"  {name}: {(out / name).stat().st_size / 1024:.1f} KB")
    print(f"  runs: {', '.join(tags)}")
    print(f"  epochs: {len(epochs_a)}  z {epochs_z[0]:.2f} -> {epochs_z[-1]:.2f}"
          f"   k bins: {len(k_ref)}")


if __name__ == "__main__":
    main()
