---
title: "The i-band galaxy luminosity function in the W1 and W3 fields of the PAU Survey"
shortTitle: "The i-band galaxy luminosity function"
hook: "How many galaxies of each brightness does the Universe contain, and how has that changed over the last three quarters of cosmic time? I measured it for 1.1 million galaxies, and compared the answer to what our best model of galaxy formation predicts."
order: 1
publishDate: "2026-01-15"
kind: "paper"
venue: "Koonkor et al., MNRAS, 2026"
demo: "/explore/galaxy-lf/"
links:
  - label: "Journal"
    href: "https://doi.org/10.1093/mnras/stag362"
  - label: "arXiv:2511.16042"
    href: "https://arxiv.org/abs/2511.16042"
figure:
  src: "./figure.webp"
  alt: "Galaxy luminosity function measured from the PAU Survey: number density of galaxies plotted against absolute i-band magnitude, in eight panels covering redshift 0.05 to 2, with the GALFORM lightcone prediction overlaid in each."
  caption: "The i-band luminosity function in eight redshift slices, from the present day out to z = 2. Green and dark red points are the two PAUS fields, W1 and W3; the black line is the GALFORM lightcone and the shaded bands are that lightcone seen through two models of the photometric-redshift errors. [Try it interactively](/explore/galaxy-lf/)."
tags: ["paus", "luminosity function", "galaxy formation", "machine learning"]
---

We present a measurement of the i-band galaxy luminosity function from the present-day to
z = 2, corresponding to three quarters of cosmic history, using over 1.1 million galaxies
from the Physics of the Accelerating Universe Survey (PAUS). PAUS combines broad-band imaging
from the Canada-France-Hawaii Telescope Lensing Survey with narrow-band photometry from
PAUCam, enabling high-precision photometric redshifts with an accuracy of
σ(Δz)/(1+z) = 0.019 down to i_AB &lt; 23.

A synthetic lightcone mock catalogue built using the GALFORM semi-analytic model is used to
simulate PAUS selection effects and photometric uncertainties, and to derive a
machine-learning based estimate of the k-correction. We recover rest-frame i-band
luminosities using a random forest regressor trained on simulated ugriz photometry and
redshifts. Luminosity functions are estimated using the Vmax method, accounting for
photometric redshift and magnitude errors, and validated against mock data.

We find good agreement between observations and models at z &lt; 1, with increasing
discrepancies at higher redshifts due to photometric redshift outliers. The faint end of the
luminosity function becomes more incomplete with increasing redshift, but is still useful for
constraining models. We analyse the red and blue galaxy populations separately, observing
distinct evolutionary trends. The model overpredicts the number of both faint red and blue
galaxies.

Our study highlights the importance of accurate redshift estimation and selection modelling
for robust luminosity function recovery, and demonstrates that PAUS can characterise the
galaxy population with photometric redshifts across a wide redshift baseline.
