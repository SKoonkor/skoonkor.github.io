---
title: "Application of Principal Component Analysis to Galaxy Spectral Energy Distributions"
shortTitle: "Compressing galaxy spectra with PCA"
hook: "A galaxy's spectrum is a list of thousands of numbers. It turns out that around ninety of them will do. Squeezing a spectrum down this far is what makes it possible to predict the light of every galaxy in a simulated universe."
order: 2
publishDate: "2020-09-01"
kind: "msc-thesis"
venue: "MSc thesis, Durham University, 2020"
demo: "/explore/pca-sed/"
links:
  - label: "Read the thesis"
    href: "https://etheses.durham.ac.uk/13823/"
figure:
  src: "./figure.webp"
  alt: "Principal component analysis of simple stellar population spectra: reconstructed spectral energy distributions compared with the originals, showing the small residuals left after a large reduction in dimensionality."
  caption: "Reconstructed spectra (red) against the originals (blue) at four stellar ages, with the residuals below each panel."
tags: ["pca", "stellar populations", "galform", "spectra"]
---

In this work, we aim to reduce the computational expense when calculating galaxy spectra by
applying PCA to the SEDs of simple stellar populations (SSPs). We consider different star
formation histories and different metallicities.

As a result, we find that the dimensionality of the SSP spectra can be reduced by a factor of
~50 whilst there is only a small loss in accuracy (~1&ndash;5%) of the reconstructed spectra.
Moreover, we find that this loss in accuracy is negligible when computing broadband magnitudes
(&lt;&lt;1%).

Our results suggest that this calculation method may be a plausible way to predict spectra for
all the galaxies in the output of a semi-analytical model covering a cosmological volume
(e.g. GALFORM; Cole et al. 2000).
