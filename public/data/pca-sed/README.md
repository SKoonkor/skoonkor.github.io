# PCA basis for simple stellar population spectra

Derived data for the interactive SED reconstructor at `/explore/pca-sed.html`.
Reproduces the method of **Koonkor (2020), MSc thesis, Durham University** —
*Application of Principal Component Analysis to Galaxy Spectral Energy
Distributions*, <https://etheses.durham.ac.uk/13823/>.

## What this is

Simple stellar population (SSP) spectra are compressed with PCA, so that a
spectrum of 1200 wavelength bins is reproduced from ~90 numbers. The point is
not the compression itself but what it enables: a galaxy formation model such as
GALFORM has to compute a spectrum for every one of millions of galaxies, and a
~13x reduction is the difference between a calculation that is affordable and
one that is not.

## Model

| | |
|---|---|
| SPS code | FSPS (Conroy & Gunn 2010), via `python-fsps` |
| IMF | Kroupa (2001) |
| Metallicity | solar (`logzsol = 0.0`) |
| Ages | 106, log-spaced, 0.1 Myr – 20 Gyr |
| Wavelength | 1000 – 30 000 Å, 1200 log-spaced bins |
| Dust | none — stellar emission only |
| Nebular emission | none |

## Method

PCA is applied to **L2-normalised linear** spectra, not to their logarithm. Log
normalisation reconstructs more accurately, and the thesis says so, but it is
rejected because a composite stellar population is a *linear* superposition of
SSPs; a log-space basis cannot be summed, and the compression would buy nothing
downstream.

```
eta_i   = ||f_i||_2
f_i(l) ~= eta_i * ( mean(l) + sum_j alpha_ij v_j(l) )
```

The PCA runs separately on three bands — UV 1000–3500 Å, optical 3500–7500 Å,
NIR 7500–30 000 Å (thesis §4.2.2). A single whole-range basis reproduces the
optical essentially perfectly but fails in the far-UV, where an old population
emits ~10⁻⁴ of its peak flux.

Error statistics exclude bins carrying less than 10⁻⁴ of an SSP's peak flux.
Below the Lyman break there is effectively no emission, so a *fractional* error
there is arbitrarily large and physically meaningless.

## Result, and agreement with the thesis

| Accuracy target (95th pct) | This basis | Thesis §4.2.2 |
|---|---|---|
| < 5 % | **58** components | 68 |
| < 1 % | **87** components | 85 |

The <1 % figure agrees to within ~2 %. The per-band split differs (this basis
puts more into the UV, fewer into the optical and NIR) because the grid here is
decimated to 1200 bins from the FSPS native ~4842, and the error metric applies
the flux floor above.

## Files

| File | Contents |
|---|---|
| `basis.json` | grid, per-band means, int16 scales, component allocation per N, provenance, golden test |
| `components.i16` | eigenvectors, int16 with a per-component scale, row-major per band |
| `coeffs.f32` | per-SSP coefficients, float32, `[n_ssp, n_coeff]` |
| `ssps.json` | SSP metadata: age, metallicity, L2 norm `eta` |
| `truth.f32` | four true spectra for the residual panel (the ages of thesis Fig. 4.5) |
| `accuracy.json` | error vs number of components, global and per band |

Every number the page displays is read from `accuracy.json` at runtime, so a
regenerated basis can never contradict the text on the page.

## Regenerating

Needs FSPS with `SPS_HOME` set, plus numpy:

```
python3 tools/build_pca_sed.py    # writes this directory
python3 tools/verify_export.py    # reconstructs from the written files only
```

`verify_export.py` deliberately re-reads the serialised files rather than
trusting anything in memory, and asserts the same golden value that
`assets/js/explore/pca-sed.js` checks in the browser.

## Scope

Solar metallicity only. Thesis §4.3 extends to a 2-D age–metallicity grid; with
seven metallicities the UV needs well over 120 components, which is more than a
public demo should ship. Adding dust, emission lines or non-solar metallicity is
out of scope for this dataset.

## Licence and citation

Derived basis: CC-BY-4.0. Cite FSPS (Conroy, Gunn & White 2009; Conroy & Gunn
2010) for the underlying models, and the thesis above for the method.
