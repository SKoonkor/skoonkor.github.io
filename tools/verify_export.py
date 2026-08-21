#!/usr/bin/env python3
"""
Verify the exported PCA basis by reconstructing from the WRITTEN FILES ONLY.

This is the Python-side half of the contract that assets/js/explore/pca-sed.js
asserts on the browser side. It deliberately re-reads the JSON and the binary
blobs rather than using anything left in memory by the build, so that a bug in
the serialisation cannot pass.

    python3 tools/verify_export.py
"""

import json
import pathlib
import sys

import numpy as np

DATA = pathlib.Path(__file__).resolve().parent.parent / "data" / "pca-sed"


def load():
    basis = json.loads((DATA / "basis.json").read_text())
    ssps = json.loads((DATA / "ssps.json").read_text())
    acc = json.loads((DATA / "accuracy.json").read_text())
    comp = np.frombuffer((DATA / "components.i16").read_bytes(), dtype="<i2")
    coef = np.frombuffer((DATA / "coeffs.f32").read_bytes(), dtype="<f4")
    truth = np.frombuffer((DATA / "truth.i16").read_bytes(), dtype="<i2")
    return basis, ssps, acc, comp, coef, truth


def rebuild_bands(basis, comp):
    """Dequantise the int16 blob back into per-band float eigenvector matrices."""
    out = []
    for b in basis["bands"]:
        k, n = b["k"], b["n_lam"]
        start = b["byte_offset"] // 2
        block = comp[start:start + k * n].reshape(k, n).astype(np.float64)
        V = block / 32767.0 * np.asarray(b["scales"])[:, None]
        out.append({"V": V, "mean": np.asarray(b["mean"], dtype=np.float64),
                    "i0": b["i0"], "n": n, "k": k, "name": b["name"]})
    return out


def reconstruct(basis, bands, coeffs_row, n_total):
    """Mirror of reconstruct() in pca-sed.js."""
    alloc = basis["allocation"][str(n_total)]
    out = np.zeros(basis["grid"]["n"])
    off = 0
    for b, band in enumerate(bands):
        nb = alloc[b]
        c = coeffs_row[off:off + nb]
        seg = band["mean"] + c @ band["V"][:nb]
        out[band["i0"]:band["i0"] + band["n"]] = seg
        off += band["k"]
    return out


def main():
    basis, ssps, acc, comp, coef, truth = load()
    bands = rebuild_bands(basis, comp)
    n_ssp, n_coef = ssps["coeffs_bin"]["shape"]
    coeffs = coef.reshape(n_ssp, n_coef).astype(np.float64)
    n_lam = basis["grid"]["n"]
    fails = []

    def check(name, ok, detail=""):
        print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")
        if not ok:
            fails.append(name)

    print("Shapes and self-consistency")
    check("coeffs rows match ssps list", n_ssp == len(ssps["ssps"]),
          f"{n_ssp} vs {len(ssps['ssps'])}")
    check("coeff width matches sum of band k",
          n_coef == sum(b["k"] for b in bands), f"{n_coef}")
    check("components blob fully consumed",
          comp.size == sum(b["k"] * b["n"] for b in bands),
          f"{comp.size} int16")
    check("bands tile the grid without gaps",
          sum(b["n"] for b in bands) == n_lam,
          f"{sum(b['n'] for b in bands)} vs {n_lam}")
    check("band offsets are contiguous",
          [b["i0"] for b in bands] == list(np.cumsum([0] + [b["n"] for b in bands])[:-1]))

    print("\nEigenvector sanity")
    for b in bands:
        norms = np.linalg.norm(b["V"], axis=1)
        check(f"{b['name']}: rows unit-norm after dequantisation",
              np.allclose(norms, 1.0, atol=2e-3),
              f"min {norms.min():.5f} max {norms.max():.5f}")

    print("\nGolden test (the value pca-sed.js asserts)")
    g = basis["golden_test"]
    rec = reconstruct(basis, bands, coeffs[g["ssp_index"]], g["n_total"])
    exp5 = np.asarray(g["expected_first5"], dtype=np.float64)
    got5 = rec[:5]
    rel = np.abs(got5 / exp5 - 1.0).max()
    # 1% tolerance: these are the bluest bins (1000 A), where the eigenvector
    # values sit far below their row's peak and so carry the worst relative
    # int16 quantisation error. Any structural bug -- wrong band offset, wrong
    # allocation, wrong dequantisation scale -- moves these by order unity.
    check("first 5 bins match", rel < 1e-2, f"max rel dev {rel:.2e}")
    rel_sum = abs(rec.sum() / g["expected_sum"] - 1.0)
    check("sum matches", rel_sum < 1e-4, f"rel dev {rel_sum:.2e}")

    print("\nReconstruction accuracy against shipped truth spectra")
    # The four shipped spectra are the extremes of thesis Fig. 4.5 (0.2 Myr and
    # 13 Gyr among them), deliberately the hardest in the sample. The published
    # targets are a p95 over ALL 106 SSPs, so these four sit above it by
    # construction; assert they stay in the same ballpark rather than under it.
    t_ids = ssps["truth_bin"]["ids"]
    t = (truth.reshape(len(t_ids), n_lam).astype(np.float64)
         * np.asarray(ssps["truth_bin"]["scales"])[:, None] / 32767.0)
    id_to_row = {s["id"]: i for i, s in enumerate(ssps["ssps"])}
    floor = 1e-4
    for target in ("5.0", "1.0"):
        n = acc["n_for_target_pct"][target]
        if n is None:
            check(f"target {target}% reachable", False, "not reached at max N")
            continue
        worst, per = 0.0, []
        for j, tid in enumerate(t_ids):
            true = t[j]
            r = reconstruct(basis, bands, coeffs[id_to_row[tid]], n)
            m = true > floor * true.max()
            e = np.percentile(np.abs(r[m] / true[m] - 1.0) * 100, 95)
            per.append(f"{tid.split('_')[-1]}:{e:.2f}%")
            worst = max(worst, e)
        check(f"N={n} (global p95 {target}%) holds shipped spectra under {float(target)*5:.0f}%",
              worst <= float(target) * 5, "  ".join(per[:6]) + (" ..." if len(per) > 6 else ""))

    print("\nGlobal accuracy curve in accuracy.json")
    p95 = np.asarray(acc["frac_err_pct"]["p95"])
    ns_a = np.asarray(acc["n_values"])
    for target in ("5.0", "1.0"):
        n = acc["n_for_target_pct"][target]
        if n is None:
            continue
        got = p95[ns_a == n][0]
        check(f"curve confirms N={n} reaches {target}%", got <= float(target),
              f"p95 {got:.3f}%")
    # The greedy allocator optimises each band's own p95, so pooling the bands can
    # tick the global p95 up fractionally when a component moves between them.
    d = np.diff(p95)
    worst_rise = float((d / p95[:-1]).max()) if len(d) else 0.0
    check("p95 curve effectively non-increasing", worst_rise < 0.01,
          f"largest rise {worst_rise*100:.3f}% relative")
    check("p95 falls by orders of magnitude overall", p95[0] / p95[-1] > 100,
          f"{p95[0]:.4g}% -> {p95[-1]:.4g}%")

    print("\nMonotonicity (guards against significant-figure rounding killing PCs)")
    row = coeffs[g["ssp_index"]]
    true = t[t_ids.index(basis["golden_test"]["ssp_id"])] if basis["golden_test"]["ssp_id"] in t_ids else None
    if true is not None:
        m = true > floor * true.max()
        errs = []
        for n in (10, 30, 60, acc["n_for_target_pct"]["1.0"] or 87):
            r = reconstruct(basis, bands, row, n)
            errs.append(np.percentile(np.abs(r[m] / true[m] - 1.0) * 100, 95))
        check("error decreases with N", all(np.diff(errs) < 1e-9),
              " -> ".join(f"{e:.3g}%" for e in errs))
    else:
        print("  SKIP  golden SSP has no shipped truth spectrum")

    print("\nPayload")
    total = sum(p.stat().st_size for p in DATA.iterdir() if p.is_file())
    check("total under 400 KB", total < 400 * 1024, f"{total/1024:.0f} KB")

    print()
    if fails:
        print(f"{len(fails)} check(s) FAILED: {', '.join(fails)}")
        sys.exit(1)
    print("All checks passed.")


if __name__ == "__main__":
    main()
