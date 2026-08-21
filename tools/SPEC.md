# PCA/SED demo — regeneration spec

Taken from the MSc thesis, *Application of Principal Component Analysis to Galaxy Spectral
Energy Distributions* (Koonkor, Durham, 2020), <https://etheses.durham.ac.uk/13823/>.
Section numbers below refer to that document.

## Stellar population model

| Item | Value | Source |
|---|---|---|
| SPS code | **FSPS** (Conroy & Gunn 2010), via `python-fsps` | §2, Fig. 2.2 caption |
| IMF | **Kroupa (2001)** | §2.1 — "Throughout this study we use the Kroupa (2001) form" |
| Ages | **107 ages, 10⁻⁴ to 10^1.3 Gyr, log-spaced** (0.1 Myr → ~19.95 Gyr) | §4.2.1 |
| Wavelength range | **1000 – 30 000 Å** | §4.2.2 |
| Sub-bands | UV 1000–3500, optical 3500–7500, NIR 7500–30 000 Å | §4.2.2 |
| Dust | none — stellar emission only | §1.1 |
| Emission lines | not considered | §1.1 |

## The normalisation — do NOT use log

This is the one place where the obvious choice is the wrong one, and the thesis is explicit
about why.

The SSP flux spans ~5 orders of magnitude between the youngest and oldest ages (§4.1), which
would let outliers dominate the PCA. Three fixes are compared in §4.1.3: L1-norm, L2-norm, and
taking the log of the spectrum. **Log performs best numerically** — Fig. 4.2(d) has visibly the
tightest residuals — **but the thesis rejects it anyway**:

> The normalisation method used in the data preprocessing step therefore needs to be linear
> (i.e. the values of specific flux at all wavelength bins of a spectrum can only be multiplied
> by a scalar). Non-linear normalisation methods (e.g. taking the logarithm of the spectrum)
> will lead to a complexity in calculating the SED that will negate any reduction in
> dimensionality.

The reason is the whole point of the project: a **composite** stellar population is built as a
*linear superposition* of SSPs weighted by the star formation history. If the basis lives in log
space, you cannot add SSPs without exponentiating first, and the compression buys you nothing
downstream in GALFORM.

**So: PCA on L2-normalised linear spectra.**

```
η_i        = ||f_i||₂                    # per-spectrum L2 norm
X'         = diag(η)⁻¹ X − mean          # normalised, mean-subtracted
f_i(λ)     ≈ η_i [ x̄'(λ) + Σ_j α_ij v'_j(λ) ]
```

Note this differs from the design note in the approved plan, which proposed PCA on
log₁₀ of the shape-normalised spectrum. That would have produced a demo whose headline
message ("this is what makes the galaxy-formation model affordable") is not actually
supported by the basis it is built on.

## Number of components — the plan's K = 20 is far too small

Solar-metallicity SSPs, whole wavelength range at once (§4.2.1, Table 4.1):

| PC | Explained variance ratio | Cumulative |
|---|---|---|
| 1 | 83.33 % | 83.33 % |
| 2 | 11.57 % | 94.90 % |
| 3 | 2.876 % | 97.78 % |
| 4 | 1.431 % | 99.21 % |
| 5 | 0.3966 % | 99.61 % |
| 10 | 0.0154 % | 99.96 % |

But the retention criterion in this work is **not** cumulative variance — it is the reconstruction
error at *every* wavelength bin (§3.4, §4.2.1):

| Accuracy target | Whole range | Split into 3 bands |
|---|---|---|
| < 5 % ("typical") | **77 PCs** | 68 (45 UV + 14 optical + 9 NIR) |
| < 1 % ("extreme") | **91 PCs** | 85 (53 UV + 20 optical + 12 NIR) |

Three components reproduce the *shape* around 10 Myr but fail badly in the NIR for young SSPs
and in the UV for old ones (Fig. 4.5). So the demo slider must run to ~100, not 20, or it will
misrepresent the result. The "~50×" compression in the abstract is ~4000 wavelength bins → ~80
components.

## Consequences for the demo

- Slider range **1 – 100 components**, with markers at 77 (<5 %) and 91 (<1 %).
- The payoff line is not "20 numbers" — it is roughly *"4000 numbers → 80"*.
- Reconstruction in the browser is `f = η · (mean + Σ α_j v_j)`, all in linear flux. One
  multiply-add loop, no `Math.pow`.
- Eigenvector payload is 100 × Nλ. Ship as **int16 with a per-component scale factor** rather
  than JSON floats — see `export_pca_sed.py`.
- Every headline number rendered on the page must come from `accuracy.json`, never hard-coded,
  so a regenerated basis can never contradict the copy.
