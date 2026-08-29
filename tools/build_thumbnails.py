#!/usr/bin/env python3
"""
Thumbnails for the three cards on /explore/.

Each is built from data already in the repo rather than drawn by hand, so the
pictures are of the thing they advertise:

  pca-sed          16 real SSP spectra from public/data/pca-sed/truth.i16
  galaxy-lf        the 8 redshift slices in public/data/luminosity-function
  structure-growth 4 rendered SWIFT frames

They render at about 90 px, which is the constraint that shapes all three: a
thumbnail here has room for a silhouette and nothing else, so everything is
smoothed hard and stripped of axes, ticks and labels.

Two are SVG and one is AVIF, on purpose. The line drawings have to stay crisp at
any device pixel ratio AND follow the page's light/dark theme, which needs them
inlined -- an <img src="...svg"> is an isolated document that the page's CSS
cannot reach, so its strokes could not use currentColor. The stitched simulation
frame is photographic and would be absurd as SVG; it gets the light-mode
inversion that CosmicBands already applies to the same imagery.

Run:  python3 tools/build_thumbnails.py
"""

from __future__ import annotations

import json
import pathlib
import subprocess

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
SVG_OUT = ROOT / "src/assets/thumbs"
IMG_OUT = ROOT / "public/images/thumbs"
FRAMES = pathlib.Path(
    "~/Documents/Suttikoon/Research_Projects/SWIFT_sim/frames/Om0.30_s0.800_w-1.0"
).expanduser()

#: Everything is drawn in a 100 x 100 user-space box and scaled by CSS.
VB = 100.0


def smooth(y: np.ndarray, n: int) -> np.ndarray:
    """Boxcar smoothing. Real spectra are far too spiky to read at 90 px."""
    if n < 2:
        return y
    k = np.ones(n) / n
    return np.convolve(y, k, mode="same")


def path_from(xs: np.ndarray, ys: np.ndarray) -> str:
    """An SVG path through the points, rounded to keep the file small."""
    pts = [f"{x:.2f},{y:.2f}" for x, y in zip(xs, ys)]
    return "M" + " L".join(pts)


def fit_box(y: np.ndarray, y0: float, y1: float) -> np.ndarray:
    """Map a curve into a band of the drawing, y0 at the top."""
    lo, hi = float(np.min(y)), float(np.max(y))
    if hi - lo < 1e-12:
        return np.full_like(y, (y0 + y1) / 2)
    return y1 - (y - lo) / (hi - lo) * (y1 - y0)


# ----------------------------------------------------------------- pca-sed --


def thumb_pca() -> str:
    """
    Three rows with arrows: SSP spectra -> PCA -> a galaxy spectrum.

    The bottom row is a weighted sum of the same SSPs drawn in the top row, which
    is how a composite population is actually built -- so the picture assembles
    its own conclusion, which is what the demo is about.
    """
    meta = json.loads((ROOT / "public/data/pca-sed/ssps.json").read_text())
    tb = meta["truth_bin"]
    arr = np.fromfile(ROOT / "public/data/pca-sed" / tb["file"], dtype=tb["dtype"])
    arr = arr.reshape(tb["shape"]).astype(float) * np.asarray(tb["scales"])[:, None]

    ages = np.array([s["age_gyr"] for s in meta["ssps"] if s.get("has_truth")])
    # Two, not three. Three normalised into one 22-unit band overlapped into a
    # single tangle at the size this actually renders; a young and an old
    # population are immediately different shapes.
    picks = [int(np.argmin(np.abs(ages - a))) for a in (0.0112, 12.6)]

    # Log wavelength: a spectrum spanning 1000 to 30000 A is unreadable linearly.
    n = arr.shape[1]
    lam = np.logspace(np.log10(1000.0), np.log10(30000.0), n)
    # Plotted as nu*f_nu, not the stored f_nu. In f_nu every population peaks in
    # the near-infrared -- a 0.01 Gyr and a 12.6 Gyr SSP came out nearly the same
    # shape, which defeats the point of showing two ages. In nu*f_nu they peak at
    # 1186 A and 9895 A respectively: young is blue, old is red, visibly.
    arr = arr / lam
    keep = np.linspace(0, n - 1, 60).astype(int)
    xs = 8 + (np.log10(lam[keep]) - 3) / (np.log10(30000.0) - 3) * (VB - 16)

    parts: list[str] = []

    # Row 1: a young and an old population, the old one drawn stronger.
    for idx, op in zip(picks, (0.5, 1.0)):
        y = fit_box(smooth(arr[idx], 90)[keep], 6, 28)
        parts.append(
            f'<path d="{path_from(xs, y)}" fill="none" stroke="currentColor"'
            f' stroke-width="1.6" opacity="{op}"/>'
        )

    # Row 3: the composite. The factor of `ages` is the bin width -- the 16 SSPs
    # are spaced logarithmically in age, so summing them unweighted counts the
    # numerous young bins far too heavily and the composite came out peaking in
    # the far UV at 1182 A. With the bin width and an exponentially declining
    # star formation history it peaks at 9218 A, which is where a galaxy does.
    w = ages * np.exp(-ages / 5.0)
    comp = (arr * w[:, None]).sum(axis=0)
    ycomp = fit_box(smooth(comp, 90)[keep], 68, 94)

    arrow = (
        '<path d="M50 {a} L50 {b}" stroke="currentColor" stroke-width="1.4"'
        ' opacity="0.55" fill="none"/>'
        '<path d="M47 {c} L50 {b} L53 {c}" stroke="currentColor" stroke-width="1.4"'
        ' opacity="0.55" fill="none" stroke-linejoin="round"/>'
    )
    parts.append(arrow.format(a=32, b=39, c=36))
    parts.append(
        '<rect x="33" y="43" width="34" height="16" rx="3" fill="none"'
        ' stroke="currentColor" stroke-width="1.4" opacity="0.8"/>'
        '<text x="50" y="54.5" text-anchor="middle" font-size="10"'
        ' font-family="ui-monospace, SFMono-Regular, Menlo, monospace"'
        ' fill="currentColor">PCA</text>'
    )
    parts.append(arrow.format(a=62, b=69, c=66))
    parts.append(
        f'<path d="{path_from(xs, ycomp)}" fill="none" stroke="currentColor"'
        f' stroke-width="1.8"/>'
    )
    return wrap(parts)


# --------------------------------------------------------------- galaxy-lf --


def schechter_log(mag: np.ndarray, log_phi: float, mstar: float, alpha: float) -> np.ndarray:
    """log10 of a Schechter function in magnitudes."""
    x = -0.4 * (mag - mstar)
    return log_phi + (alpha + 1.0) * x - (10.0**x) / np.log(10.0)


def thumb_lf() -> str:
    """
    Eight luminosity functions, z = 2 down to 0.

    Fitted rather than plotted raw: the measured curves carry only 9 to 17
    non-null bins each and a mean second difference of 0.06 dex, so at 90 px they
    read as stubby uneven segments -- the high-redshift ones visibly shorter.
    Fitting keeps the parameters grounded in the data while giving curves of
    equal extent that can be compared by eye.
    """
    from scipy.optimize import curve_fit

    d = json.loads((ROOT / "public/data/luminosity-function/lf.json").read_text())
    bins = np.asarray(d["bins"], dtype=float)
    slices = list(d["data"]["i"].keys())

    # Wide enough on the bright side to show the exponential cut-off, which is
    # the shape that makes a Schechter function recognisable.
    mag = np.linspace(-24.5, -18.0, 90)
    xs = 8 + (mag - mag[0]) / (mag[-1] - mag[0]) * (VB - 16)

    curves: list[tuple[float, np.ndarray]] = []
    for key in slices:
        y = np.array(
            [v if v is not None else np.nan for v in d["data"]["i"][key]["all"]["true"]],
            dtype=float,
        )
        ok = ~np.isnan(y)
        if ok.sum() < 5:
            continue
        try:
            # alpha is bounded to a physical range. Unbounded, the four highest
            # redshift slices fit +0.46 to +2.58 -- they only have data from
            # -23.9 to -20.1, so the faint-end slope is unconstrained and runs
            # away, and the curves then plunge at the FAINT end, which is both
            # wrong and the opposite of what the picture is meant to show.
            p, _ = curve_fit(
                schechter_log, bins[ok], y[ok], p0=(-2.5, -21.5, -1.3),
                bounds=([-6.0, -24.0, -1.8], [0.0, -19.0, -0.8]), maxfev=40000,
            )
        except RuntimeError:
            continue
        curves.append((float(key), schechter_log(mag, *p)))

    # One shared vertical scale, or the curves would not be comparable. Points
    # outside it are DROPPED rather than clipped: clipping flattened the steep
    # bright end onto the bottom edge, hiding the very cut-off this is meant to
    # show.
    lo, hi = -6.0, -1.2
    parts: list[str] = []
    for i, (_, c) in enumerate(curves):
        inside = (c >= lo) & (c <= hi)
        if inside.sum() < 2:
            continue
        y = 8 + (hi - c[inside]) / (hi - lo) * (VB - 16)
        # Nearby is solid, distant is faint: the fade IS the time axis.
        op = 1.0 - 0.72 * (i / max(1, len(curves) - 1))
        parts.append(
            f'<path d="{path_from(xs[inside], y)}" fill="none" stroke="currentColor"'
            f' stroke-width="1.5" opacity="{op:.2f}"/>'
        )
    return wrap(parts)


def wrap(parts: list[str]) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
        'aria-hidden="true" focusable="false">' + "".join(parts) + "</svg>\n"
    )


# -------------------------------------------------------- structure-growth --


def thumb_structure(size: int = 256) -> None:
    """
    One square that morphs from a smooth early universe to today's cosmic web.

    Not four tiles butted together: every output column is a blend of two
    neighbouring epochs, with the blend weight sliding continuously across the
    width. The same spatial region is used from each frame -- the runs share a
    seed, so structure stays put and only its contrast grows -- which is what
    makes the morph read as time passing rather than as a pan across the sky.
    """
    from PIL import Image

    meta = json.loads((FRAMES / "frames.json").read_text())["frames"]
    zs = [m["z"] for m in meta]
    picks = [int(np.argmin(np.abs(np.array(zs) - t))) for t in (15, 10, 3, 0)]
    stack = [
        np.asarray(
            Image.open(FRAMES / meta[i]["file"]).convert("L").resize((size, size), Image.LANCZOS),
            dtype=float,
        )
        for i in picks
    ]

    out = np.zeros((size, size))
    for x in range(size):
        u = (len(stack) - 1) * x / (size - 1)
        i = min(int(u), len(stack) - 2)
        f = u - i
        out[:, x] = (1 - f) * stack[i][:, x] + f * stack[i + 1][:, x]

    IMG_OUT.mkdir(parents=True, exist_ok=True)
    png = IMG_OUT / "structure-growth.png"
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), mode="L").save(png)
    subprocess.run(
        ["avifenc", "--yuv", "400", "-q", "80", "-s", "4",
         str(png), str(IMG_OUT / "structure-growth.avif")],
        check=True, capture_output=True,
    )
    png.unlink()
    print(f"  structure-growth.avif  z = {', '.join(f'{zs[i]:.2f}' for i in picks)}")


# -------------------------------------------------- where-did-my-money-go --


def thumb_money() -> str:
    """
    The running-balance staircase from the demo's own ledger.

    Everything the Money Flow chart draws, minus everything that cannot survive
    at 90 px: no axes, no month bands, no labels. Bars are merged to one a day,
    because 245 of them across 84 pixels is a grey smear -- but the DAILY
    silhouette is the shape the demo is about, so it is the shape that is kept.

    Direction is carried without colour. A thumbnail inherits currentColor and
    has exactly one of them, so income is drawn solid and spending at 0.5, and
    the salary day gets the same up-arrow the chart itself puts on income bars.
    """
    seed = json.loads((ROOT / "public/data/money-flow/seed.json").read_text())
    sign = seed["sign"]

    # One net movement per day, in date order, standing on the running balance.
    days: dict[str, float] = {}
    for t in seed["txns"]:
        days[t["period"]] = days.get(t["period"], 0.0) + sign[t["type"]] * t["amount"]
    keys = sorted(days)

    opening = sum(a["opening"] for a in seed["accounts"])
    bases, tops = [], []
    cum = opening
    for k in keys:
        bases.append(cum)
        cum += days[k]
        tops.append(cum)

    lo = min(min(bases), min(tops))
    hi = max(max(bases), max(tops))
    span = max(hi - lo, 1e-9)

    def y_of(v: float) -> float:
        """Money to user space, 15 at the top and 92 at the bottom.

        The top of the box is 15 rather than 8 so the payday arrow, which is
        drawn five units above the bar it marks, has somewhere to go. At 8 the
        taller of the two months had its arrow clipped by the viewBox.
        """
        return 92 - (v - lo) / span * 77

    n = len(keys)
    step = (VB - 12) / n
    parts: list[str] = []

    # Payday is any day that rises by more than half the biggest rise -- there
    # are two months here and both should carry the marker, so this is not
    # `max()`. The arrow is the same one the chart itself puts on income bars,
    # and it is what tells direction apart without colour.
    rises = [t - b for b, t in zip(bases, tops)]
    big = max(rises) * 0.5

    for i, (b, t) in enumerate(zip(bases, tops)):
        x = 6 + i * step
        # Bars touch. Sixty days across 84 rendered pixels is 1.4 px each, and
        # with a gap that reads as a picket fence; butted together the run of
        # them reads as one staircase silhouette, which is the shape wanted.
        w = step
        y0, y1 = y_of(b), y_of(t)
        up = y1 < y0
        top, height = (y1, y0 - y1) if up else (y0, y1 - y0)
        if height < 0.6:
            # A day that nets to nothing still has to carry the balance across,
            # or the staircase gets a hole in it. The connector below does that,
            # so the bar is simply dropped.
            continue
        parts.append(
            f'<rect x="{x:.2f}" y="{top:.2f}" width="{w:.2f}" height="{height:.2f}"'
            f' fill="currentColor" opacity="{0.85 if up else 0.35:.2f}"/>'
        )
        if up and rises[i] >= big:
            cx = x + w / 2
            parts.append(
                f'<path d="M{cx - 2.6:.2f} {top - 1.4:.2f} L{cx:.2f} {top - 5.2:.2f}'
                f' L{cx + 2.6:.2f} {top - 1.4:.2f} Z" fill="currentColor"/>'
            )

    # The running balance itself, drawn solid and on top. It is the subject --
    # the chart is called Money Flow and this line is the flow -- and it was
    # tried the other way round first, faint and dashed behind the bars, which
    # left the thumbnail looking like two spikes and some noise. The daily bars
    # are the texture underneath it.
    #
    # Stepped rather than smoothed: the balance holds flat through a day and
    # then moves, and a diagonal between two days claims a continuity that a
    # ledger does not have.
    pts = [f"M{6:.2f},{y_of(opening):.2f}"]
    for i, t in enumerate(tops):
        x0 = 6 + i * step
        pts.append(f"L{x0:.2f},{y_of(bases[i]):.2f} L{x0 + step:.2f},{y_of(t):.2f}")
    parts.append(
        f'<path d="{" ".join(pts)}" fill="none" stroke="currentColor"'
        f' stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>'
    )
    return wrap(parts)


def main() -> None:
    SVG_OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in (
        ("pca-sed", thumb_pca),
        ("galaxy-lf", thumb_lf),
        ("where-did-my-money-go", thumb_money),
    ):
        svg = fn()
        (SVG_OUT / f"{name}.svg").write_text(svg)
        print(f"  {name}.svg  {len(svg)} bytes")
    thumb_structure()


if __name__ == "__main__":
    main()
