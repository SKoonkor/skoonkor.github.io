#!/usr/bin/env python3
"""
Build the PCA basis for the interactive SED reconstructor.

Follows the method of the MSc thesis (Koonkor 2020, Durham) -- see tools/SPEC.md.

Two choices matter and are easy to get wrong:

1. The PCA runs on L2-normalised *linear* spectra, not on the log. A log
   normalisation is numerically better but destroys the linear superposition of
   SSPs that makes the compression useful to a galaxy formation model at all.

       eta_i   = ||f_i||_2
       X'      = diag(eta)^-1 X - mean
       f_i(l) ~= eta_i * ( mean(l) + sum_j alpha_ij v_j(l) )

2. The PCA is run separately on three wavelength bands (thesis 4.2.2). A single
   whole-range basis reconstructs the optical essentially perfectly but fails in
   the far-UV, where old populations emit 10^-4 of their peak flux and the
   fractional error blows up. Splitting the range fixes that for fewer total
   components than the single basis needs.

Requires FSPS (SPS_HOME set) and numpy. Run:

    python3 tools/build_pca_sed.py
"""

import json
import os
import pathlib
import sys

import numpy as np

# --- Grid, from tools/SPEC.md ------------------------------------------------

LAM_MIN, LAM_MAX = 1000.0, 30000.0   # thesis 4.2.2
N_LAM = 1200                         # decimated from the FSPS native ~4842 bins
BANDS = [("uv", 1000.0, 3500.0), ("optical", 3500.0, 7500.0),
         ("nir", 7500.0, 30000.0)]   # thesis 4.2.2
K_MAX = 130                          # per-band ceiling; allocation caps total
N_TOTAL_MAX = 130                    # top of the slider
#: Solar metallicity only -- this is the sample of thesis 4.2, and reproducing its
#: published component counts matters more than adding a metallicity control.
#: Thesis 4.3 extends to a 2D age-metallicity grid, which needs far more
#: components than a public demo can usefully ship; see tools/SPEC.md.
LOGZSOL = [0.0]
IMF_TYPE = 2                         # Kroupa (2001) -- thesis 2.1
AGE_STRIDE = 1                       # ship every age; the sample is small enough

#: True spectra are shipped for every age the age slider can reach, so the demo
#: can always draw the real curve behind the reconstruction -- without it the
#: visitor has nothing to judge the rebuild against. Quantised to int16 with a
#: per-spectrum scale, this costs ~2 KB each rather than ~5 KB as float32.
TRUTH_N_AGES = 16
#: The PCA is fitted over the thesis's full age range (up to 10^1.3 = 20 Gyr), but
#: the demo only offers ages up to the age of the Universe. The 17.8 Gyr SSP sits
#: at the edge of the FSPS grid and reconstructs an order of magnitude worse than
#: any other; it is also not a population that exists.
AGE_SHIP_MAX_GYR = 13.8

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data" / "pca-sed"


def log_grid():
    return np.logspace(np.log10(LAM_MIN), np.log10(LAM_MAX), N_LAM)


def band_masks(lam):
    """Partition the grid into the BANDS by index.

    Comparing floats against the band edges is not safe here: np.logspace returns
    30000.00000000001 for the final point, so `lam <= LAM_MAX` silently dropped a
    wavelength bin from every basis. Splitting on searchsorted indices guarantees
    the bands tile the grid exactly.
    """
    edges = [0] + [int(np.searchsorted(lam, hi, side="left")) for _, _, hi in BANDS]
    edges[-1] = len(lam)
    out = []
    for i in range(len(BANDS)):
        m = np.zeros(len(lam), dtype=bool)
        m[edges[i]:edges[i + 1]] = True
        out.append(m)
    return out


def rebin(lam_src, flux_src, lam_dst):
    safe = np.maximum(flux_src, 1e-300)
    return 10.0 ** np.interp(np.log10(lam_dst), np.log10(lam_src), np.log10(safe))


def generate_ssps():
    """Return (lam, X, meta): X is (n_ssp, N_LAM) of linear flux."""
    import fsps

    lam = log_grid()
    rows, meta = [], []
    age_cap = 10.0 ** 1.3      # Gyr, thesis 4.2.1

    for lz in LOGZSOL:
        sp = fsps.StellarPopulation(
            zcontinuous=1, logzsol=lz, imf_type=IMF_TYPE,
            sfh=0, add_neb_emission=False, dust_type=0,
        )
        wave, spec = sp.get_spectrum()          # (n_age, n_lam), all SSP ages
        ages_gyr = 10.0 ** sp.log_age / 1e9
        print(f"  logzsol={lz:+.2f}: {spec.shape[0]} ages", flush=True)

        for i, age in enumerate(ages_gyr):
            if age > age_cap:
                continue
            f = rebin(wave, spec[i], lam)
            if not np.isfinite(f).all() or f.max() <= 0:
                continue
            rows.append(f)
            meta.append({"id": f"z{lz:+.2f}_t{np.log10(age):.3f}",
                         "age_gyr": float(age), "logzsol": float(lz)})

    return lam, np.asarray(rows), meta


def band_pca(Xn, mask, k_max):
    """PCA restricted to the wavelength bins in `mask`."""
    Xb = Xn[:, mask]
    mean = Xb.mean(axis=0)
    U, S, Vt = np.linalg.svd(Xb - mean, full_matrices=False)
    k = min(k_max, Vt.shape[0])
    V = Vt[:k]
    C = (Xb - mean) @ V.T
    evr = (S ** 2 / (S ** 2).sum())[:k]
    return mean, V, C, evr, Xb


#: Bins carrying less than this fraction of an SSP's peak flux are excluded from
#: the error statistics. Below the Lyman break an old population emits ~1e-7 of
#: its peak; a fractional error there is arbitrarily large and physically
#: meaningless, and no linear basis can or should chase it. Roughly 2% of bins.
FLUX_FLOOR = 1e-4


def flux_mask(Xb):
    return Xb > FLUX_FLOOR * Xb.max(axis=1, keepdims=True)


def band_error_curve(Xb, mean, V, C, k):
    """p95 of |reconstructed/true - 1| in %, over bins above FLUX_FLOOR."""
    m = flux_mask(Xb)
    out = np.empty(k)
    for n in range(1, k + 1):
        rec = mean + C[:, :n] @ V[:n]
        e = np.abs(rec[m] / Xb[m] - 1.0) * 100.0
        out[n - 1] = np.percentile(e, 95)
    return out


def allocate(curves, n_total_max):
    """Greedy: give each next component to whichever band is currently worst.

    Returns allocations[n] = (n_uv, n_opt, n_nir) for n = 1..n_total_max, and
    the resulting worst-band p95 error.
    """
    nb = len(curves)
    cur = [1] * nb
    allocs, errs = {}, {}
    for total in range(nb, n_total_max + 1):
        allocs[total] = tuple(cur)
        errs[total] = max(curves[b][cur[b] - 1] for b in range(nb))
        worst = max(range(nb), key=lambda b: curves[b][cur[b] - 1])
        if cur[worst] < len(curves[worst]):
            cur[worst] += 1
        else:
            others = [b for b in range(nb) if cur[b] < len(curves[b])]
            if not others:
                break
            cur[max(others, key=lambda b: curves[b][cur[b] - 1])] += 1
    return allocs, errs


def quantise_i16(V):
    """Rows to int16 with a per-row scale. ~4.5 significant digits vs the row peak."""
    scales = np.abs(V).max(axis=1)
    scales[scales == 0] = 1.0
    q = np.rint(V / scales[:, None] * 32767.0).astype("<i2")
    return q, scales


def main():
    if not os.environ.get("SPS_HOME"):
        sys.exit("SPS_HOME is not set; FSPS cannot run. See tools/SPEC.md.")

    OUT.mkdir(parents=True, exist_ok=True)
    print("Generating SSP spectra with FSPS...", flush=True)
    lam, X, meta = generate_ssps()
    print(f"  -> {X.shape[0]} SSPs x {X.shape[1]} bins", flush=True)

    eta = np.linalg.norm(X, axis=1)
    Xn = X / eta[:, None]

    # --- Per-band PCA -------------------------------------------------------
    masks, band_data, curves = [], [], []
    all_masks = band_masks(lam)
    for bi, (name, lo, hi) in enumerate(BANDS):
        m = all_masks[bi]
        mean_b, V_b, C_b, evr_b, Xb = band_pca(Xn, m, K_MAX)
        curve = band_error_curve(Xb, mean_b, V_b, C_b, V_b.shape[0])
        masks.append(m)
        band_data.append((name, mean_b, V_b, C_b, evr_b))
        curves.append(curve)
        print(f"  {name:8s} {int(m.sum()):5d} bins, {V_b.shape[0]:3d} PCs, "
              f"PC1 {evr_b[0]*100:5.2f}%, p95 err at max n = {curve[-1]:.3g}%",
              flush=True)

    allocs, errs = allocate(curves, N_TOTAL_MAX)
    n_for = {}
    for target in (5.0, 1.0):
        hit = [n for n in sorted(errs) if errs[n] <= target]
        n_for[str(target)] = int(hit[0]) if hit else None
    print(f"  allocation: p95 <5% at N={n_for['5.0']}, <1% at N={n_for['1.0']}",
          flush=True)

    # --- Combined error curve over the allocation ---------------------------
    ns = sorted(allocs)
    gmask = flux_mask(Xn)
    med, p68, p95 = [], [], []
    for n in ns:
        rec_n = np.empty_like(Xn)
        for b, (name, mean_b, V_b, C_b, _) in enumerate(band_data):
            nb = allocs[n][b]
            rec_n[:, masks[b]] = mean_b + C_b[:, :nb] @ V_b[:nb]
        e = np.abs(rec_n[gmask] / Xn[gmask] - 1.0) * 100.0
        med.append(np.median(e)); p68.append(np.percentile(e, 68))
        p95.append(np.percentile(e, 95))

    # Only ship the components the allocation can actually reach.
    k_used = [max(allocs[n][b] for n in ns) for b in range(len(BANDS))]
    print(f"  components shipped per band: {dict(zip([b[0] for b in BANDS], k_used))}",
          flush=True)

    prov = {
        "sps_model": "FSPS (Conroy & Gunn 2010) via python-fsps",
        "imf": "Kroupa (2001)",
        "dust": "none (stellar emission only)",
        "nebular_emission": False,
        "source_thesis": "https://etheses.durham.ac.uk/13823/",
        "generator": "tools/build_pca_sed.py",
        "method": "per-band PCA on L2-normalised linear spectra (tools/SPEC.md)",
        "licence": "CC-BY-4.0 for the derived basis; cite FSPS for the models",
    }

    # --- Binary payloads ----------------------------------------------------
    comp_blobs, band_meta = [], []
    offset = 0
    for b, (name, mean_b, V_b, C_b, evr_b) in enumerate(band_data):
        V_b = V_b[:k_used[b]]
        q, scales = quantise_i16(V_b)
        comp_blobs.append(q.tobytes())
        band_meta.append({
            "name": name,
            "lam_lo": float(BANDS[b][1]), "lam_hi": float(BANDS[b][2]),
            "i0": int(np.argmax(masks[b])), "n_lam": int(masks[b].sum()),
            "k": int(V_b.shape[0]),
            "byte_offset": offset,
            "scales": [float(f"{s:.7g}") for s in scales],
            "mean": [float(f"{v:.8g}") for v in mean_b],
            "explained_variance_ratio": [float(f"{v:.5g}") for v in evr_b[:20]],
            "k_shipped": int(k_used[b]),
        })
        offset += len(comp_blobs[-1])
    (OUT / "components.i16").write_bytes(b"".join(comp_blobs))

    # Shipped SSP subset (PCA used every age; the sliders step through these).
    keep = sorted({i for i, m in enumerate(meta)
                   if i % AGE_STRIDE == 0 and m["age_gyr"] <= AGE_SHIP_MAX_GYR})
    # Evenly spaced in log age across the shipped set.
    sel = np.unique(np.linspace(0, len(keep) - 1, TRUTH_N_AGES).round().astype(int))
    t_idx = [keep[j] for j in sel]
    truth_ids = {meta[i]["id"] for i in t_idx}
    t_arr = np.asarray([Xn[i] for i in t_idx])
    t_scales = t_arr.max(axis=1)
    t_q = np.rint(t_arr / t_scales[:, None] * 32767.0).astype("<i2")
    (OUT / "truth.i16").write_bytes(t_q.tobytes())

    coeff_rows = []
    for i in keep:
        row = np.concatenate([band_data[b][3][i][:k_used[b]] for b in range(len(BANDS))])
        coeff_rows.append(row.astype("<f4"))
    (OUT / "coeffs.f32").write_bytes(np.asarray(coeff_rows).tobytes())

    # --- JSON ---------------------------------------------------------------
    ref = min(t_idx, key=lambda i: abs(np.log10(meta[i]["age_gyr"])))
    gn = 12
    g_rec = np.empty(N_LAM)
    for b, (name, mean_b, V_b, C_b, _) in enumerate(band_data):
        nb = allocs[gn][b]
        # Dequantise exactly as the browser will, so the golden value tests the
        # shipped int16 blob and not the full-precision matrix.
        q_b, sc_b = quantise_i16(V_b[:k_used[b]])
        V_deq = q_b.astype(np.float64) / 32767.0 * sc_b[:, None]
        g_rec[masks[b]] = mean_b + C_b[ref, :nb] @ V_deq[:nb]

    basis = {
        "schema": "pca-sed/basis/3",
        "provenance": prov,
        "grid": {"unit": "angstrom", "spacing": "log10",
                 "lambda_min": LAM_MIN, "lambda_max": LAM_MAX, "n": N_LAM},
        "transform": {"type": "linear", "flux_unit": "Lsun/Hz per Msun"},
        "normalisation": {"type": "l2"},
        "bands": band_meta,
        "components_bin": {"file": "components.i16", "dtype": "int16",
                           "layout": "row-major per band, concatenated"},
        "allocation": {str(n): list(allocs[n]) for n in ns},
        "n_total_min": int(min(ns)), "n_total_max": int(max(ns)),
        "golden_test": {
            "ssp_index": keep.index(ref), "ssp_id": meta[ref]["id"], "n_total": gn,
            "expected_first5": [float(f"{v:.8g}") for v in g_rec[:5]],
            "expected_sum": float(f"{g_rec.sum():.8g}"),
        },
    }
    (OUT / "basis.json").write_text(json.dumps(basis, separators=(",", ":")))

    ssps = {
        "schema": "pca-sed/ssps/3",
        "logzsol_values": LOGZSOL,
        "n_coeffs_per_ssp": int(sum(k_used)),
        "coeffs_bin": {"file": "coeffs.f32", "dtype": "float32",
                       "shape": [len(keep), int(sum(k_used))],
                       "band_order": [b[0] for b in BANDS]},
        "truth_bin": {"file": "truth.i16", "dtype": "int16",
                      "shape": [len(t_idx), N_LAM],
                      "scales": [float(f"{v:.8g}") for v in t_scales],
                      "ids": [meta[i]["id"] for i in t_idx]},
        "ssps": [{"id": meta[i]["id"], "age_gyr": float(f"{meta[i]['age_gyr']:.6g}"),
                  "logzsol": meta[i]["logzsol"], "eta": float(f"{eta[i]:.7g}"),
                  "has_truth": meta[i]["id"] in truth_ids} for i in keep],
    }
    (OUT / "ssps.json").write_text(json.dumps(ssps, separators=(",", ":")))

    acc = {
        "schema": "pca-sed/accuracy/3",
        "n_values": ns,
        "frac_err_pct": {
            "median": [float(f"{v:.4g}") for v in med],
            "p68": [float(f"{v:.4g}") for v in p68],
            "p95": [float(f"{v:.4g}") for v in p95],
        },
        "per_band_p95": {BANDS[b][0]: [float(f"{curves[b][allocs[n][b]-1]:.4g}") for n in ns]
                         for b in range(len(BANDS))},
        "n_for_target_pct": n_for,
        "allocation_at_target": {k: (list(allocs[v]) if v else None)
                                 for k, v in n_for.items()},
        "compression": {"n_lambda": N_LAM, "n_lambda_native": 4842},
        "n_ssps_fitted": int(X.shape[0]), "n_ssps_shipped": len(keep),
    }
    (OUT / "accuracy.json").write_text(json.dumps(acc, separators=(",", ":")))

    total = sum(p.stat().st_size for p in OUT.iterdir() if p.is_file())
    print(f"\nWrote {OUT} -- {total/1024:.0f} KB total")
    for p in sorted(OUT.iterdir()):
        if p.is_file():
            print(f"  {p.name:20s} {p.stat().st_size/1024:8.1f} KB")


if __name__ == "__main__":
    main()
