#!/usr/bin/env python3
"""
Build the galaxy luminosity function data for the /explore/galaxy-lf/ demo.

Source: the tables behind Koonkor et al. (2026), MNRAS 547(3).

    <SRC>/tabulated_tables/LF_<band>_z<zmid>.ecsv   40 files, 5 bands x 8 slices
    <SRC>/completeness_limits_i23.csv               i<23 limits, all bands

Two things about the source worth knowing before changing anything here:

1. All 40 tables share one magnitude grid -- 24 bins, -27.2 to -14.55, step 0.55.
   That is asserted below, not assumed, and the grid ships once.

2. phi = 0 marks an EMPTY BIN, not a measured zero. Roughly a third of the values
   are zeros. They become null, so the runtime can break its lines rather than
   plot log10(0) as -Infinity and draw a spike off the bottom of the panel.

Everything is emitted as log10(phi), because that is the axis the paper plots
and it saves the runtime doing the conversion 24 times per redraw.

Run:  python3 tools/build_lf_data.py [path-to-Correct_tables]
"""

from __future__ import annotations

import datetime as dt
import json
import math
import pathlib
import re
import sys

DEFAULT_SRC = pathlib.Path(
    "~/Documents/Suttikoon/Research_Papers/Suttikoon_PAUS_LF/Revised_tables/Correct_tables"
).expanduser()

BANDS = ["u", "g", "r", "i", "z"]
Z_MIDS = [0.125, 0.300, 0.500, 0.700, 0.900, 1.150, 1.450, 1.800]

OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "public" / "data" / "luminosity-function"

# Source column -> key in the emitted JSON. Only what the demo draws; the
# combined W1+W3 columns are deliberately left out (see the page copy).
SERIES = {
    "true": "phi_lightcone_true",
    "gaussLo": "phi_lightcone_gauss_p16",
    "gaussHi": "phi_lightcone_gauss_p84",
    "bcnzLo": "phi_lightcone_bcnz_p16",
    "bcnzHi": "phi_lightcone_bcnz_p84",
    "w1": "phi_W1",
    "w3": "phi_W3",
}
# Point series that carry a symmetric linear error, converted to log-space
# bounds here so the runtime never has to handle phi - err <= 0.
ERRORS = {"w1": "err_W1", "w3": "err_W3"}


def read_ecsv(path: pathlib.Path) -> tuple[list[str], list[list[float]], dict]:
    """Columns, rows and the few metadata values we need, without astropy."""
    header: list[str] | None = None
    rows: list[list[float]] = []
    meta_lines: list[str] = []
    for line in path.read_text().splitlines():
        if line.startswith("#"):
            meta_lines.append(line[1:].strip())
            continue
        if header is None:
            header = line.split()
            continue
        rows.append([float(x) for x in line.split()])
    if header is None:
        raise SystemExit(f"{path}: no column header found")

    meta_text = "\n".join(meta_lines)
    meta: dict = {}
    for key in ("m_i_limit", "mc_runs", "jackknife"):
        m = re.search(rf"{key}:\s*([0-9.]+)", meta_text)
        if m:
            meta[key] = float(m.group(1)) if "." in m.group(1) else int(m.group(1))
    m = re.search(r"z_hi:\s*([0-9.]+),\s*z_lo:\s*([0-9.]+)", meta_text)
    if m:
        meta["z_hi"], meta["z_lo"] = float(m.group(1)), float(m.group(2))
    return header, rows, meta


def lg(v: float) -> float | None:
    """log10, with empty bins (phi = 0) becoming null rather than -inf."""
    return round(math.log10(v), 3) if v > 0 else None


def main() -> None:
    src = pathlib.Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else DEFAULT_SRC
    tables = src / "tabulated_tables"
    if not tables.is_dir():
        raise SystemExit(f"source tables not found: {tables}")

    grid: list[float] | None = None
    config: dict = {}
    slices: list[dict] = []
    data: dict = {}

    for band in BANDS:
        data[band] = {}
        for z in Z_MIDS:
            path = tables / f"LF_{band}_z{z:.3f}.ecsv"
            header, rows, meta = read_ecsv(path)
            col = {name: idx for idx, name in enumerate(header)}

            centres = [round(r[col["bin_center"]], 4) for r in rows]
            if grid is None:
                grid = centres
            elif centres != grid:
                # The whole file format depends on one shared grid. If this ever
                # trips, the JSON needs per-table bins, not a silent mismatch.
                raise SystemExit(f"{path.name}: magnitude grid differs from the others")

            config = config or {k: meta[k] for k in ("m_i_limit", "mc_runs", "jackknife") if k in meta}
            if band == BANDS[0]:
                # Rounded: the ECSV metadata carries accumulated float noise from
                # z_lo = z_mid - dz/2, so the raw values read 0.19999999999999998
                # and would be shown to the reader that way. Cross-checked against
                # the completeness CSV below, which has the clean edges.
                slices.append(
                    {"zMid": z, "zLo": round(meta["z_lo"], 3), "zHi": round(meta["z_hi"], 3)}
                )

            entry = {key: [lg(r[col[src_col]]) for r in rows] for key, src_col in SERIES.items()}
            # Linear phi +/- err -> log-space bounds. A bin whose lower edge falls
            # to zero or below gets a null low bound: the error bar is drawn open.
            for key, err_col in ERRORS.items():
                phi_col = SERIES[key]
                lo, hi = [], []
                for r in rows:
                    phi, err = r[col[phi_col]], r[col[err_col]]
                    lo.append(lg(phi - err) if phi > 0 else None)
                    hi.append(lg(phi + err) if phi > 0 else None)
                entry[key + "Lo"], entry[key + "Hi"] = lo, hi
            # "all" is the only sample that exists. The level is here so a
            # red/blue split can be added without reshaping the file.
            data[band][f"{z:.3f}"] = {"all": entry}

    # --- completeness limits -------------------------------------------------
    comp_path = src / "completeness_limits_i23.csv"
    comp: dict[str, dict[str, float]] = {b: {} for b in BANDS}
    comp_header: list[str] | None = None
    for line in comp_path.read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        parts = line.split(",")
        if comp_header is None:
            comp_header = parts
            continue
        row = dict(zip(comp_header, parts))
        z_mid = float(row["z_mid"])
        for b in BANDS:
            comp[b][f"{z_mid:.3f}"] = float(row[f"M_complete_{b}"])

    for b in BANDS:
        missing = [f"{z:.3f}" for z in Z_MIDS if f"{z:.3f}" not in comp[b]]
        if missing:
            raise SystemExit(f"completeness limits missing for band {b}: {missing}")

    # The two source files describe the same slices. Assert they agree rather than
    # trusting whichever was read last.
    edges = {}
    comp_header2 = None
    for line in comp_path.read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        parts = line.split(",")
        if comp_header2 is None:
            comp_header2 = parts
            continue
        row = dict(zip(comp_header2, parts))
        edges[f'{float(row["z_mid"]):.3f}'] = (float(row["z_low"]), float(row["z_high"]))
    for sl in slices:
        key = f'{sl["zMid"]:.3f}'
        want = edges.get(key)
        if want is None or (sl["zLo"], sl["zHi"]) != want:
            raise SystemExit(
                f"slice {key}: tables say {(sl['zLo'], sl['zHi'])}, "
                f"completeness CSV says {want}"
            )

    # --- golden values -------------------------------------------------------
    # A handful of triples with their exact source numbers, so the runtime can
    # prove the data it fetched is the data that was exported.
    golden = []
    for band, z, idx in (("i", 0.500, 12), ("u", 1.150, 10), ("z", 0.125, 15)):
        key = f"{z:.3f}"
        golden.append(
            {
                "band": band,
                "z": key,
                "bin": idx,
                "binCenter": grid[idx],
                "w1": data[band][key]["all"]["w1"][idx],
                "true": data[band][key]["all"]["true"][idx],
            }
        )

    out = {
        "schema": "paus-lf/1",
        "bins": grid,
        "binWidth": 0.55,
        "bands": BANDS,
        "slices": slices,
        "series": sorted({*SERIES, *(k + "Lo" for k in ERRORS), *(k + "Hi" for k in ERRORS)}),
        "units": {
            "bins": "M - 5 log10 h (AB absolute magnitude)",
            "phi": "log10(phi / [h3 Mpc-3 mag-1])",
        },
        "completeness": comp,
        "config": config,
        "golden": golden,
        "provenance": {
            "paper": "Koonkor et al. 2026, MNRAS 547(3), 1-24",
            "doi": "10.1093/mnras/stag362",
            "source": str(src),
            "generated_utc": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "note": "null marks an empty bin (phi = 0 in the source), not a measured zero.",
        },
        "data": data,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dest = OUT_DIR / "lf.json"
    dest.write_text(json.dumps(out, separators=(",", ":")))

    n_null = sum(
        1
        for b in data.values()
        for z in b.values()
        for s in z.values()
        for arr in s.values()
        for v in arr
        if v is None
    )
    n_all = sum(
        len(arr) for b in data.values() for z in b.values() for s in z.values() for arr in s.values()
    )
    print(f"wrote {dest.relative_to(OUT_DIR.parent.parent.parent)}  {dest.stat().st_size / 1024:.0f} KB")
    print(f"  {len(BANDS)} bands x {len(Z_MIDS)} slices x {len(grid)} bins")
    print(f"  empty bins: {n_null}/{n_all} ({100 * n_null / n_all:.0f}%)")
    print(f"  config: {config}")


if __name__ == "__main__":
    main()
