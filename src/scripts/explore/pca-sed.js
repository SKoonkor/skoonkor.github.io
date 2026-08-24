/*
 * Interactive PCA reconstruction of simple stellar population spectra.
 *
 * Data and method: /data/pca-sed/README.md and tools/SPEC.md.
 * The reconstruction is linear, per wavelength band:
 *
 *     f(l) = mean_b(l) + sum_{j<n_b} c_j v_bj(l)      for l in band b
 *
 * which is ~1200 multiply-adds per redraw -- about 0.05 ms, against a 16.6 ms
 * frame budget. No workers, no WASM, no charting library.
 */

import {
	fetchJSON, fetchBuffer, rafThrottle, readState, writeState,
	fitCanvas, formatAge, prefersReducedMotion,
} from './common.js';

export const CONFIG = {
	dataDir: '/data/pca-sed',
	// Fallbacks only. The live values are read from CSS custom properties on the
	// demo root by readPalette(), because a canvas cannot inherit CSS and the
	// panel needs to be able to follow a theme.
	colours: {
		recon: '#E27689',
		truth: 'rgba(255, 255, 255, 0.35)',
		axis: 'rgba(255, 255, 255, 0.22)',
		text: 'rgba(255, 255, 255, 0.55)',
		good: '#8ebebc',
		warn: '#d8a657',
	},
};

/** Resolve the canvas palette from CSS custom properties set on `root`. */
function readPalette(root) {
	const cs = getComputedStyle(root);
	const pick = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
	return {
		recon: pick('--demo-recon', CONFIG.colours.recon),
		truth: pick('--demo-truth', CONFIG.colours.truth),
		axis: pick('--demo-axis', CONFIG.colours.axis),
		text: pick('--demo-text', CONFIG.colours.text),
		good: pick('--demo-good', CONFIG.colours.good),
		warn: pick('--demo-warn', CONFIG.colours.warn),
	};
}

/* ------------------------------------------------------------------ colour --
 * Turning the spectrum into the colour a human eye would actually see is the
 * single most effective way to tell a non-astronomer what the x-axis means.
 *
 * The CIE 1931 2-degree colour matching functions are used via the multi-lobe
 * piecewise-Gaussian fit of Wyman, Sloan & Shirley (2013), JCGT 2(2), which is
 * accurate to about 1% and avoids carrying a lookup table.
 */

/** Piecewise Gaussian: sigma1 below the peak, sigma2 above. */
function pwGauss(x, mu, s1, s2) {
	const t = (x - mu) / (x < mu ? s1 : s2);
	return Math.exp(-0.5 * t * t);
}

function cieX(nm) {
	return 1.056 * pwGauss(nm, 599.8, 37.9, 31.0)
		+ 0.362 * pwGauss(nm, 442.0, 16.0, 26.7)
		- 0.065 * pwGauss(nm, 501.1, 20.4, 26.2);
}
function cieY(nm) {
	return 0.821 * pwGauss(nm, 568.8, 46.9, 40.5)
		+ 0.286 * pwGauss(nm, 530.9, 16.3, 31.1);
}
function cieZ(nm) {
	return 1.217 * pwGauss(nm, 437.0, 11.8, 36.0)
		+ 0.681 * pwGauss(nm, 459.0, 26.0, 13.8);
}

/** Spectrum (f_nu on the wavelength grid) to a CSS colour. */
function spectrumToCSS(lam, flux) {
	let X = 0, Y = 0, Z = 0;
	for (let nm = 380; nm <= 780; nm += 5) {
		const f = interpAt(lam, flux, nm * 10);     // nm -> angstrom
		// f_nu -> f_lambda goes as 1/lambda^2; the constant cancels in the ratio.
		const fl = f / (nm * nm);
		X += fl * cieX(nm); Y += fl * cieY(nm); Z += fl * cieZ(nm);
	}
	const s = X + Y + Z;
	if (!(s > 0)) return '#222';
	// Chromaticity, then back to tristimulus at unit luminance. Feeding the
	// chromaticity coordinates straight into the matrix is wrong and turns
	// everything green.
	const cx = X / s, cy = Y / s;
	if (!(cy > 1e-6)) return '#222';
	X = cx / cy; Y = 1; Z = (1 - cx - cy) / cy;
	// XYZ (sRGB primaries, D65) -> linear RGB
	let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
	let g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
	let b = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
	// Desaturate out of gamut rather than clipping, which would shift the hue.
	const m = Math.min(r, g, b);
	if (m < 0) { r -= m; g -= m; b -= m; }
	const mx = Math.max(r, g, b, 1e-9);
	r /= mx; g /= mx; b /= mx;
	const enc = (v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v
		: 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055));
	return `rgb(${enc(r)}, ${enc(g)}, ${enc(b)})`;
}

/** Approximate sRGB for a single visible wavelength, for the spectrum ribbon. */
function wavelengthToCSS(nm) {
	let r = 0, g = 0, b = 0;
	if (nm < 440) { r = -(nm - 440) / (440 - 380); b = 1; }
	else if (nm < 490) { g = (nm - 440) / (490 - 440); b = 1; }
	else if (nm < 510) { g = 1; b = -(nm - 510) / (510 - 490); }
	else if (nm < 580) { r = (nm - 510) / (580 - 510); g = 1; }
	else if (nm < 645) { r = 1; g = -(nm - 645) / (645 - 580); }
	else { r = 1; }
	let f = 1;
	if (nm < 420) f = 0.3 + 0.7 * (nm - 380) / (420 - 380);
	else if (nm > 700) f = 0.3 + 0.7 * (750 - nm) / (750 - 700);
	const e = (v) => Math.round(255 * Math.pow(Math.max(v, 0) * f, 0.8));
	return `rgb(${e(r)}, ${e(g)}, ${e(b)})`;
}

function interpAt(lam, y, x) {
	if (x <= lam[0]) return y[0];
	const n = lam.length;
	if (x >= lam[n - 1]) return y[n - 1];
	let lo = 0, hi = n - 1;
	while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (lam[mid] > x) hi = mid; else lo = mid; }
	const t = (x - lam[lo]) / (lam[hi] - lam[lo]);
	return y[lo] + t * (y[hi] - y[lo]);
}

/* -------------------------------------------------------------------- data -- */

async function loadData(dir) {
	const [basis, ssps, accuracy, compBuf, coefBuf, truthBuf] = await Promise.all([
		fetchJSON(`${dir}/basis.json`),
		fetchJSON(`${dir}/ssps.json`),
		fetchJSON(`${dir}/accuracy.json`),
		fetchBuffer(`${dir}/components.i16`),
		fetchBuffer(`${dir}/coeffs.f32`),
		fetchBuffer(`${dir}/truth.i16`),
	]);

	const raw = new Int16Array(compBuf);
	const bands = basis.bands.map((b) => {
		const start = b.byte_offset / 2;
		const V = new Float32Array(b.k * b.n_lam);
		const scales = b.scales;
		for (let j = 0; j < b.k; j++) {
			const s = scales[j] / 32767;
			const off = j * b.n_lam, src = start + off;
			for (let i = 0; i < b.n_lam; i++) V[off + i] = raw[src + i] * s;
		}
		return { name: b.name, i0: b.i0, n: b.n_lam, k: b.k, V,
			mean: Float32Array.from(b.mean), evr: b.explained_variance_ratio,
			lamLo: b.lam_lo, lamHi: b.lam_hi };
	});

	const [nSsp, nCoef] = ssps.coeffs_bin.shape;
	const coeffs = new Float32Array(coefBuf);

	const g = basis.grid;
	const lam = new Float64Array(g.n);
	const a = Math.log10(g.lambda_min), bb = Math.log10(g.lambda_max);
	for (let i = 0; i < g.n; i++) lam[i] = Math.pow(10, a + (bb - a) * i / (g.n - 1));

	// True spectra, int16 with a per-spectrum scale.
	const tb = ssps.truth_bin;
	const tRaw = new Int16Array(truthBuf);
	const truth = {};
	tb.ids.forEach((id, j) => {
		const out = new Float32Array(g.n), s = tb.scales[j] / 32767, off = j * g.n;
		for (let i = 0; i < g.n; i++) out[i] = tRaw[off + i] * s;
		truth[id] = out;
	});

	return { basis, ssps, accuracy, bands, coeffs, nSsp, nCoef, lam, truth };
}

/* ----------------------------------------------------------- reconstruction -- */

/** f = mean + sum_j c_j v_j, per band. Writes into `out` and returns it. */
function reconstruct(d, sspIndex, nTotal, out) {
	const alloc = d.basis.allocation[String(nTotal)];
	const base = sspIndex * d.nCoef;
	let coefOff = 0;
	for (let b = 0; b < d.bands.length; b++) {
		const band = d.bands[b], nb = alloc[b], n = band.n, i0 = band.i0;
		for (let i = 0; i < n; i++) out[i0 + i] = band.mean[i];
		for (let j = 0; j < nb; j++) {
			const c = d.coeffs[base + coefOff + j];
			if (c === 0) continue;
			const vo = j * n;
			for (let i = 0; i < n; i++) out[i0 + i] += c * band.V[vo + i];
		}
		coefOff += band.k;
	}
	return out;
}

/** Assert the shipped golden value, so a data/code mismatch fails loudly. */
function checkGolden(d) {
	const g = d.basis.golden_test;
	const out = new Float64Array(d.basis.grid.n);
	reconstruct(d, g.ssp_index, g.n_total, out);
	let sum = 0;
	for (let i = 0; i < out.length; i++) sum += out[i];
	const relSum = Math.abs(sum / g.expected_sum - 1);
	const rel5 = Math.max(...g.expected_first5.map((e, i) => Math.abs(out[i] / e - 1)));
	const ok = relSum < 1e-4 && rel5 < 1e-2;
	if (!ok) {
		console.error('[pca-sed] golden test FAILED', { relSum, rel5, expected: g });
	}
	return ok;
}

/* ------------------------------------------------------------------ render -- */

/**
 * Human-facing names for the bands, keyed on the names in basis.json. Kept here
 * rather than in the data because they are presentation, and because "nir" is
 * the right identifier but the wrong thing to show a reader.
 */
const BAND_LABELS = { uv: 'UV', optical: 'optical', nir: 'near-IR' };
export const bandLabel = (name) => BAND_LABELS[name] || name;

const FONT = (px) => `${px}px ui-monospace, SFMono-Regular, Menlo, monospace`;

/**
 * Horizontal padding of the plot area, in CSS pixels, shared by the spectrum
 * panel, the residual panel and the brace header above them. The left pad
 * carries the 1e-n labels and the rotated axis title.
 *
 * These live here rather than inside each draw function because the header is a
 * separate SVG element: if it computed its own mapping, its braces would drift
 * away from the dashed dividers on the canvas, by an amount too small to notice
 * and large enough to be wrong.
 */
const PAD_L = 64;
const PAD_R = 12;

/** The chart's log-wavelength mapping, as a function of the drawable width. */
function xScale(d, plotW) {
	const lam = d.lam;
	const lx0 = Math.log10(lam[0]);
	const lx1 = Math.log10(lam[lam.length - 1]);
	return (l) => PAD_L + plotW * (Math.log10(l) - lx0) / (lx1 - lx0);
}

/**
 * An over-brace spanning x0..x1, tip pointing up, drawn as four quarter-arcs:
 * out of each end, then two meeting at a point in the middle. Depth is 2r, so
 * the whole thing occupies y from yTop to yTop + 2r.
 */
function bracePath(x0, x1, yTop, r) {
	const cx = (x0 + x1) / 2;
	const yBot = yTop + 2 * r;
	r = Math.max(1, Math.min(r, (x1 - x0) / 4));
	return [
		`M${x0.toFixed(2)},${yBot.toFixed(2)}`,
		`a${r},${r} 0 0 1 ${r},${-r}`,
		`L${(cx - r).toFixed(2)},${(yTop + r).toFixed(2)}`,
		`a${r},${r} 0 0 0 ${r},${-r}`,
		`a${r},${r} 0 0 0 ${r},${r}`,
		`L${(x1 - r).toFixed(2)},${(yTop + r).toFixed(2)}`,
		`a${r},${r} 0 0 1 ${r},${r}`,
	].join(' ');
}

/** SVG geometry for the header, in CSS pixels. */
const HDR = { h: 54, countY: 20, nameY: 36, braceY: 42, r: 6 };

/** Å, formatted the way the axis ticks are: 1000, 2000 ... 30 000. */
function formatAngstrom(a) {
	return a >= 10000 ? `${Math.round(a / 1000)} 000` : String(Math.round(a));
}

/**
 * The dashed dividers between the three PCA bands. The single most load-bearing
 * annotation on the figure: the whole point of the method is that the analysis
 * is done per band, and without them the reader cannot see where one basis stops
 * and the next begins. The names sit above them, on the brace header.
 */
function drawBandDividers(ctx, d, X, padT, h, c) {
	ctx.save();
	ctx.strokeStyle = c.axis;
	ctx.globalAlpha = 0.85;
	ctx.lineWidth = 1;
	ctx.setLineDash([5, 4]);
	for (let b = 1; b < d.bands.length; b++) {
		const x = X(d.bands[b].lamLo);
		ctx.beginPath();
		ctx.moveTo(x, padT);
		ctx.lineTo(x, padT + h);
		ctx.stroke();
	}
	ctx.restore();
}

function drawSpectrum(canvas, d, recon, truth) {
	const [W, H] = fitCanvas(canvas);
	const ctx = canvas.getContext('2d');
	const c = CONFIG.colours;
	// The bottom pad carries the ribbon, the tick labels and the axis title, in
	// that order.
	const padL = PAD_L, padR = PAD_R, padT = 12, padB = 52;
	const w = W - padL - padR, h = H - padT - padB;
	ctx.clearRect(0, 0, W, H);
	if (w <= 0 || h <= 0) return;

	const lam = d.lam, n = lam.length;
	const lx0 = Math.log10(lam[0]), lx1 = Math.log10(lam[n - 1]);
	const X = (l) => padL + w * (Math.log10(l) - lx0) / (lx1 - lx0);

	// Fixed y-range from the truth spectrum, so the curve does not jump around
	// as the slider moves.
	let ymax = -Infinity, ymin = Infinity;
	const src = truth || recon;
	for (let i = 0; i < n; i++) {
		const v = src[i];
		if (v > ymax) ymax = v;
		if (v > 0 && v < ymin) ymin = v;
	}
	const top = Math.log10(ymax * 2.2);
	const bot = Math.log10(Math.max(ymin, ymax * 1e-6));
	const Y = (v) => padT + h * (1 - (Math.log10(Math.max(v, 1e-300)) - bot) / (top - bot));

	// Grid
	ctx.strokeStyle = c.axis; ctx.lineWidth = 1;
	ctx.fillStyle = c.text;
	ctx.font = FONT(10);
	ctx.textAlign = 'center'; ctx.textBaseline = 'top';
	for (const t of [1000, 2000, 5000, 10000, 20000]) {
		const x = X(t);
		if (x < padL - 1 || x > W - padR + 1) continue;
		ctx.globalAlpha = 0.35;
		ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + h); ctx.stroke();
		ctx.globalAlpha = 1;
		ctx.fillText(formatAngstrom(t), x, padT + h + 16);
	}
	ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
	for (let e = Math.ceil(bot); e <= Math.floor(top); e++) {
		const y = Y(Math.pow(10, e));
		if (y < padT || y > padT + h) continue;
		ctx.globalAlpha = 0.25;
		ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke();
		ctx.globalAlpha = 1;
		ctx.fillText(`1e${e}`, padL - 8, y);
	}
	ctx.globalAlpha = 1;

	drawBandDividers(ctx, d, X, padT, h, c);

	// Visible-spectrum ribbon along the axis: tells a lay visitor, without a
	// word of text, which part of the range their eye can actually see.
	const ry = padT + h + 4, rh = 6;
	for (let nm = 380; nm <= 750; nm += 2) {
		const xa = X(nm * 10), xb = X((nm + 2) * 10);
		ctx.fillStyle = wavelengthToCSS(nm);
		ctx.fillRect(xa, ry, Math.max(1, xb - xa + 0.5), rh);
	}

	// Axis titles.
	ctx.fillStyle = c.text;
	ctx.font = FONT(11);
	ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
	ctx.fillText('wavelength (Å)', padL + w / 2, H - 6);
	ctx.save();
	ctx.translate(14, padT + h / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.textBaseline = 'top';
	// The plotted spectrum is L2-normalised, not physical: ||f||_2 = 1. Saying
	// just "flux" here would be a quiet lie about the units.
	ctx.fillText('normalised flux density', 0, 0);
	ctx.restore();

	const line = (arr, style, width, dash) => {
		ctx.save();
		ctx.beginPath();
		ctx.setLineDash(dash || []);
		ctx.strokeStyle = style; ctx.lineWidth = width;
		ctx.lineJoin = 'round';
		let started = false;
		for (let i = 0; i < n; i++) {
			const v = arr[i];
			if (!(v > 0)) { started = false; continue; }
			const x = X(lam[i]), y = Y(v);
			if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
		}
		ctx.stroke();
		ctx.restore();
	};

	if (truth) line(truth, c.truth, 3.5, [6, 4]);
	line(recon, c.recon, 1.8);
}

function drawResidual(canvas, d, recon, truth) {
	const [W, H] = fitCanvas(canvas);
	const ctx = canvas.getContext('2d');
	const c = CONFIG.colours;
	const padL = PAD_L, padR = PAD_R, padT = 10, padB = 26;
	const w = W - padL - padR, h = H - padT - padB;
	ctx.clearRect(0, 0, W, H);
	if (w <= 0 || h <= 0 || !truth) return;

	const lam = d.lam, n = lam.length;
	const lx0 = Math.log10(lam[0]), lx1 = Math.log10(lam[n - 1]);
	const X = (l) => padL + w * (Math.log10(l) - lx0) / (lx1 - lx0);
	const LIM = 10;                                   // +/- per cent
	const Y = (p) => padT + h * (0.5 - Math.max(-LIM, Math.min(LIM, p)) / (2 * LIM));

	// +/-1% and +/-5% guide bands. The inner one is only a tenth of the panel
	// height, so it needs a real step in alpha to be distinguishable at all --
	// 0.10 against 0.16 read as a single flat block.
	ctx.fillStyle = c.good;
	ctx.globalAlpha = 0.07;
	ctx.fillRect(padL, Y(5), w, Y(-5) - Y(5));
	ctx.globalAlpha = 0.22;
	ctx.fillRect(padL, Y(1), w, Y(-1) - Y(1));
	ctx.globalAlpha = 1;

	ctx.strokeStyle = c.axis; ctx.lineWidth = 1;
	ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(padL + w, Y(0)); ctx.stroke();

	// The same band dividers as the panel above, so the two read as one figure.
	drawBandDividers(ctx, d, X, padT, h, c);

	ctx.fillStyle = c.text;
	ctx.font = FONT(10);
	ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
	for (const p of [10, 5, 0, -5, -10]) {
		ctx.fillText(`${p > 0 ? '+' : ''}${p}%`, padL - 8, Y(p));
	}

	ctx.save();
	ctx.translate(14, padT + h / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.font = FONT(11);
	ctx.textAlign = 'center'; ctx.textBaseline = 'top';
	ctx.fillText('error', 0, 0);
	ctx.restore();

	// The far-UV floor below the Lyman break carries essentially no flux, so its
	// fractional error is meaningless; grey it out rather than drawing garbage.
	let peak = 0;
	for (let i = 0; i < n; i++) if (truth[i] > peak) peak = truth[i];
	const floor = 1e-4 * peak;

	ctx.beginPath();
	ctx.strokeStyle = c.recon; ctx.lineWidth = 1.2;
	let started = false;
	for (let i = 0; i < n; i++) {
		if (!(truth[i] > floor)) { started = false; continue; }
		const p = (recon[i] / truth[i] - 1) * 100;
		const x = X(lam[i]), y = Y(p);
		if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
	}
	ctx.stroke();
}

/**
 * The brace header: a count and a band name over a brace spanning the stretch of
 * the plot that band covers.
 *
 * Sized from `chartEl` rather than from the SVG's own width so the two cannot
 * disagree -- they are the same width in the layout, but only one of them is the
 * thing the braces have to line up with.
 */
function drawBandHeader(svg, chartEl, d, alloc) {
	const w = Math.round(chartEl.getBoundingClientRect().width);
	if (!(w > PAD_L + PAD_R)) return;
	const X = xScale(d, w - PAD_L - PAD_R);

	svg.setAttribute('viewBox', `0 0 ${w} ${HDR.h}`);
	svg.setAttribute('width', String(w));
	svg.setAttribute('height', String(HDR.h));

	const ns = 'http://www.w3.org/2000/svg';
	const parts = [];
	svg.replaceChildren();
	d.bands.forEach((band, i) => {
		const x0 = X(band.lamLo);
		const x1 = X(band.lamHi);
		const cx = (x0 + x1) / 2;

		const brace = document.createElementNS(ns, 'path');
		brace.setAttribute('d', bracePath(x0, x1, HDR.braceY, HDR.r));
		brace.setAttribute('class', 'demo-bands__brace');
		svg.appendChild(brace);

		const count = document.createElementNS(ns, 'text');
		count.setAttribute('x', cx.toFixed(1));
		count.setAttribute('y', String(HDR.countY));
		count.setAttribute('class', 'demo-bands__n');
		count.textContent = alloc[i];
		svg.appendChild(count);

		const name = document.createElementNS(ns, 'text');
		name.setAttribute('x', cx.toFixed(1));
		name.setAttribute('y', String(HDR.nameY));
		name.setAttribute('class', 'demo-bands__name');
		name.textContent = bandLabel(band.name);
		svg.appendChild(name);

		parts.push(`${alloc[i]} for ${bandLabel(band.name)}`);
	});
	svg.setAttribute('aria-label', `Components in use: ${parts.join(', ')}.`);
}

/* -------------------------------------------------------------------- init -- */

export async function init(root) {
	const $ = (sel) => root.querySelector(sel);
	// The banner sits outside [data-demo] in the page markup, so it has to be
	// looked up from the document rather than from the demo root.
	const status = $('[data-status]') || document.querySelector('[data-status]');

	CONFIG.colours = readPalette(root);

	let d;
	try {
		d = await loadData(CONFIG.dataDir);
	} catch (err) {
		if (status) {
			status.textContent = 'Could not load the spectral data. ' + err.message;
			status.hidden = false;
		}
		console.error('[pca-sed]', err);
		return;
	}

	const golden = checkGolden(d);
	if (!golden) {
		if (status) {
			status.textContent = 'The spectral basis failed its self-check, so the numbers '
				+ 'below may be wrong. Please let me know if you see this.';
			status.hidden = false;
		}
	}

	const n = d.basis.grid.n;
	const recon = new Float64Array(n);
	const reconEl = $('[data-canvas]');
	const residEl = $('[data-residual]');
	const bandsSvg = $('[data-bands-svg]');
	const chartEl = $('.demo-chart');

	// Ages, ascending. Only ages with a shipped true spectrum are reachable, so
	// the reconstruction always has something to be judged against.
	const ssps = d.ssps.ssps.map((s, i) => ({ ...s, index: i }))
		.filter((s) => s.has_truth)
		.sort((a, b) => a.age_gyr - b.age_gyr);

	const nMin = d.basis.n_total_min, nMax = d.basis.n_total_max;
	const acc = d.accuracy;
	const nFor1 = acc.n_for_target_pct['1.0'];
	const nFor5 = acc.n_for_target_pct['5.0'];

	const urlState = readState();
	// `parseInt(x, 10) || fallback` would discard a legitimate 0, which is the
	// first (youngest) age.
	const intOr = (v, fallback) => {
		const p = parseInt(v, 10);
		return Number.isFinite(p) ? p : fallback;
	};
	// There used to be a plain mode and an "astronomer mode" behind a toggle.
	// Only the latter survives, so there is no view state left -- just the two
	// sliders.
	const state = {
		n: clamp(intOr(urlState.n, 12), nMin, nMax),
		age: clamp(intOr(urlState.age, Math.round(ssps.length * 0.72)), 0, ssps.length - 1),
	};

	function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

	function currentSSP() { return ssps[state.age]; }

	function p95At(nTotal) {
		const i = acc.n_values.indexOf(nTotal);
		return i >= 0 ? acc.frac_err_pct.p95[i] : null;
	}

	function truthFor(ssp) { return d.truth[ssp.id] || null; }

	const render = rafThrottle(() => {
		const ssp = currentSSP();
		reconstruct(d, ssp.index, state.n, recon);
		const t = truthFor(ssp);

		drawSpectrum(reconEl, d, recon, t);
		if (residEl) drawResidual(residEl, d, recon, t);

		// Readouts. Every number here comes from accuracy.json.
		const err = p95At(state.n);
		$('[data-n]').textContent = state.n;
		$('[data-accuracy]').textContent = err === null ? '--'
			: `${(100 - Math.min(err, 100)).toFixed(err < 1 ? 2 : 1)}%`;
		const bar = $('[data-bar]');
		if (bar) {
			const frac = err === null ? 0 : Math.max(0, Math.min(1, 1 - Math.log10(Math.max(err, 0.05)) / 2.5));
			bar.style.width = `${(frac * 100).toFixed(1)}%`;
			bar.style.background = err !== null && err <= 1 ? CONFIG.colours.good : CONFIG.colours.warn;
		}
		$('[data-age-label]').textContent = formatAge(ssp.age_gyr);
		const sw = $('[data-swatch]');
		if (sw) sw.style.background = spectrumToCSS(d.lam, recon);

		// The brace header, above the chart. It moves with the slider: the
		// allocation across the three bands is not proportional, and watching the
		// UV take the lion's share is the point.
		if (bandsSvg && chartEl) {
			drawBandHeader(bandsSvg, chartEl, d, d.basis.allocation[String(state.n)]);
		}

		const live = $('[data-live]');
		if (live) {
			live.textContent = `Reconstruction using ${state.n} of ${nMax} components. `
				+ `95th-percentile error ${err === null ? 'unknown' : err.toFixed(2) + ' per cent'}.`;
		}

		const pb = $('[data-perband]');
		if (pb) {
			const i = acc.n_values.indexOf(state.n);
			pb.textContent = Object.entries(acc.per_band_p95)
				.map(([k, v]) => `${bandLabel(k)} ${v[i].toFixed(2)}%`).join('  ·  ');
		}

		writeState({ n: state.n, age: state.age });
	});

	/* --- controls --- */

	const nSlider = $('[data-slider-n]');
	nSlider.min = nMin; nSlider.max = nMax; nSlider.value = state.n;
	nSlider.addEventListener('input', () => { state.n = +nSlider.value; render(); });

	const ageSlider = $('[data-slider-age]');
	ageSlider.min = 0; ageSlider.max = ssps.length - 1; ageSlider.value = state.age;
	ageSlider.addEventListener('input', () => { state.age = +ageSlider.value; render(); });

	// Fill in the copy that depends on the data, so the page can never state a
	// number the basis does not support.
	root.querySelectorAll('[data-fill]').forEach((el) => {
		const map = {
			nlam: d.basis.grid.n,
			nlamNative: acc.compression.n_lambda_native,
			nFor1, nFor5, nMax,
			nSsps: acc.n_ssps_fitted,
			ratio: Math.round(d.basis.grid.n / (nFor1 || 1)),
			pc1: (d.bands[1].evr[0] * 100).toFixed(0),
		};
		const v = map[el.dataset.fill];
		if (v !== undefined) el.textContent = v;
	});

	window.addEventListener('resize', render);

	// The canvas cannot inherit CSS, so a theme change has to be pushed into it.
	// Both paths matter: the site's toggle stamps data-theme on <html>, and a
	// visitor who has never used it follows the OS setting instead.
	//
	// Sampling once when data-theme flips is not enough, and fails in a way that
	// looks like nothing is wrong. The theme tokens are @property-registered
	// colours with a 300ms transition on <html>, so at the moment the attribute
	// changes their computed value is still the OLD colour: the plot repaints in
	// the palette it already had and then never repaints again. That is the bug
	// where a red spectrum sits on a dark page.
	//
	// Nor is a fixed 300ms window enough. Measured in headless Chrome, the
	// transition had moved only ~10% by the time a 360ms loop gave up -- when the
	// transition starts, and how often rAF fires, are both outside our control.
	// So watch the resolved colour instead and stop once it has actually stopped
	// moving. Self-correcting whatever the timing, and with transitions disabled
	// it settles in three frames.
	let settleRaf = 0;
	function refollowTheme() {
		cancelAnimationFrame(settleRaf);
		const t0 = performance.now();
		let last = '';
		let stable = 0;
		const step = () => {
			CONFIG.colours = readPalette(root);
			render();
			const now = CONFIG.colours.recon + CONFIG.colours.text;
			stable = now === last ? stable + 1 : 0;
			last = now;
			// Three identical frames, or two seconds, whichever comes first.
			if (stable < 3 && performance.now() - t0 < 2000) {
				settleRaf = requestAnimationFrame(step);
			}
		};
		settleRaf = requestAnimationFrame(step);
	}

	new MutationObserver(refollowTheme)
		.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
	window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refollowTheme);

	root.classList.add('is-ready');

	// The opening move: sweep the component count up so a visitor sees a
	// featureless curve acquire real spectral structure before touching anything.
	if (!urlState.n && !prefersReducedMotion()) {
		await sweep(nMin, state.n, 1600, (v) => { state.n = v; nSlider.value = v; render(); });
	} else {
		render();
	}
}

function sweep(from, to, ms, apply) {
	return new Promise((resolve) => {
		const t0 = performance.now();
		function step(t) {
			const u = Math.min(1, (t - t0) / ms);
			const e = 1 - Math.pow(1 - u, 3);          // ease out
			apply(Math.max(from, Math.round(from + (to - from) * e)));
			if (u < 1) requestAnimationFrame(step); else resolve();
		}
		requestAnimationFrame(step);
	});
}
