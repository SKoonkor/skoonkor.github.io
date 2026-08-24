/*
 * The PAUS / GALFORM galaxy luminosity function, one panel at a time.
 *
 * Data and method: /data/luminosity-function/README.md, and the paper it comes
 * from (Koonkor et al. 2026, MNRAS 547(3)).
 *
 * Everything in lf.json is already log10(phi), and empty bins are already null,
 * so this file does no maths on the data at all -- it only maps numbers to
 * pixels. That is deliberate: the conversion happens once in
 * tools/build_lf_data.py, where it can be checked against the source tables.
 *
 * Axis convention follows the paper: x is M - 5 log h REVERSED, so brighter
 * galaxies are on the right, and y is log10(phi) plotted directly rather than a
 * log-scaled linear axis.
 */

import {
	fetchJSON, rafThrottle, readState, writeState, fitCanvas, followTheme, readPalette,
} from './common.js';

const DATA_URL = '/data/luminosity-function/lf.json';

/**
 * Which CSS custom property backs each drawing colour.
 *
 * The five data colours are fixed rather than theme accents -- see explore.css.
 * They are series identities, and the site accent is red in light mode and green
 * in dark, which would collide with the BCNz band and the W1 points.
 */
const PALETTE = {
	text: '--demo-text',
	axis: '--demo-axis',
	truth: '--lf-truth',
	gauss: '--lf-gauss',
	bcnz: '--lf-bcnz',
	w1: '--lf-w1',
	w3: '--lf-w3',
	incomplete: '--lf-incomplete',
};

/** Axis limits, fixed so that switching redshift shows evolution, not rescaling. */
const X_MIN = -14.8;      // faint, left
const X_MAX = -26.4;      // bright, right
const Y_MIN = -6.2;
const Y_MAX = -0.6;

const FONT = (px) => `${px}px ui-monospace, SFMono-Regular, Menlo, monospace`;

const PZ_MODES = [
	{ id: 'both', label: 'both' },
	{ id: 'gauss', label: 'Gaussian' },
	{ id: 'bcnz', label: 'with outliers' },
];

let colours = {};

/* -------------------------------------------------------------------- draw -- */

function drawPanel(canvas, d, state) {
	const [W, H] = fitCanvas(canvas);
	const ctx = canvas.getContext('2d');
	const c = colours;
	const padL = 62, padR = 14, padT = 14, padB = 46;
	const w = W - padL - padR, h = H - padT - padB;
	ctx.clearRect(0, 0, W, H);
	if (w <= 0 || h <= 0) return;

	const X = (m) => padL + w * (m - X_MIN) / (X_MAX - X_MIN);
	const Y = (l) => padT + h * (1 - (l - Y_MIN) / (Y_MAX - Y_MIN));

	const bins = d.bins;
	const entry = d.data[state.band][state.z].all;
	const mComplete = d.completeness[state.band][state.z];

	/* --- incomplete region, behind everything ---------------------------- */
	// The survey is complete BRIGHTER than the limit, which on this reversed
	// axis is to the RIGHT. The tint therefore goes on the left.
	const xc = X(mComplete);
	ctx.fillStyle = c.incomplete;
	ctx.fillRect(padL, padT, Math.max(0, Math.min(xc, padL + w) - padL), h);

	/* --- grid ------------------------------------------------------------ */
	ctx.strokeStyle = c.axis;
	ctx.lineWidth = 1;
	ctx.fillStyle = c.text;
	ctx.font = FONT(10);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'top';
	for (let m = -16; m >= -26; m -= 2) {
		const x = X(m);
		if (x < padL - 1 || x > padL + w + 1) continue;
		ctx.globalAlpha = 0.25;
		ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + h); ctx.stroke();
		ctx.globalAlpha = 1;
		ctx.fillText(String(m), x, padT + h + 8);
	}
	ctx.textAlign = 'right';
	ctx.textBaseline = 'middle';
	for (let l = -1; l >= -6; l -= 1) {
		const y = Y(l);
		if (y < padT || y > padT + h) continue;
		ctx.globalAlpha = 0.25;
		ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke();
		ctx.globalAlpha = 1;
		ctx.fillText(String(l), padL - 8, y);
	}
	ctx.globalAlpha = 1;

	/* --- completeness limit ---------------------------------------------- */
	if (xc > padL && xc < padL + w) {
		ctx.save();
		ctx.strokeStyle = c.text;
		ctx.globalAlpha = 0.75;
		ctx.setLineDash([5, 4]);
		ctx.beginPath(); ctx.moveTo(xc, padT); ctx.lineTo(xc, padT + h); ctx.stroke();
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
		ctx.fillStyle = c.text;
		ctx.font = FONT(9);
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		// Label to the right of the line, on the trustworthy side.
		ctx.fillText('complete ▶', xc + 5, padT + 4);
		ctx.restore();
	}

	/* --- lightcone bands -------------------------------------------------- */
	// A band is drawn as one path down its upper edge and back along its lower,
	// broken wherever either edge has an empty bin. Without the break the fill
	// jumps across the gap and invents a shape the data does not have.
	const band = (loKey, hiKey, style) => {
		ctx.fillStyle = style;
		ctx.globalAlpha = 0.5;
		let run = [];
		const flush = () => {
			if (run.length > 1) {
				ctx.beginPath();
				// out along the upper edge ...
				for (let i = 0; i < run.length; i++) {
					const [x, , yHi] = run[i];
					if (i === 0) ctx.moveTo(x, yHi); else ctx.lineTo(x, yHi);
				}
				// ... and back along the lower
				for (let i = run.length - 1; i >= 0; i--) ctx.lineTo(run[i][0], run[i][1]);
				ctx.closePath();
				ctx.fill();
			}
			run = [];
		};
		for (let i = 0; i < bins.length; i++) {
			const lo = entry[loKey][i], hi = entry[hiKey][i];
			if (lo === null || hi === null) { flush(); continue; }
			run.push([X(bins[i]), Y(lo), Y(hi)]);
		}
		flush();
		ctx.globalAlpha = 1;
	};

	if (state.pz === 'both' || state.pz === 'gauss') band('gaussLo', 'gaussHi', c.gauss);
	if (state.pz === 'both' || state.pz === 'bcnz') band('bcnzLo', 'bcnzHi', c.bcnz);

	/* --- lightcone truth -------------------------------------------------- */
	ctx.strokeStyle = c.truth;
	ctx.lineWidth = 1.6;
	ctx.lineJoin = 'round';
	ctx.beginPath();
	let started = false;
	for (let i = 0; i < bins.length; i++) {
		const v = entry.true[i];
		if (v === null) { started = false; continue; }
		const x = X(bins[i]), y = Y(v);
		if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
	}
	ctx.stroke();

	/* --- PAUS points ------------------------------------------------------ */
	const points = (key, style, shape) => {
		ctx.strokeStyle = style;
		ctx.fillStyle = style;
		ctx.lineWidth = 1.1;
		for (let i = 0; i < bins.length; i++) {
			const v = entry[key][i];
			if (v === null) continue;
			const x = X(bins[i]), y = Y(v);
			if (y < padT - 2 || y > padT + h + 2) continue;
			const lo = entry[`${key}Lo`][i], hi = entry[`${key}Hi`][i];
			if (hi !== null) {
				// A null lower bound means phi - err fell to zero or below: draw the
				// bar open downward to the axis rather than pretending to a value.
				const yLo = lo === null ? padT + h : Y(lo);
				ctx.beginPath();
				ctx.moveTo(x, Y(hi));
				ctx.lineTo(x, Math.min(yLo, padT + h));
				ctx.stroke();
			}
			ctx.beginPath();
			if (shape === 'circle') {
				ctx.arc(x, y, 3, 0, Math.PI * 2);
			} else {
				ctx.moveTo(x, y - 3.4); ctx.lineTo(x + 3.4, y); ctx.lineTo(x, y + 3.4);
				ctx.lineTo(x - 3.4, y); ctx.closePath();
			}
			ctx.fill();
		}
	};
	points('w1', c.w1, 'circle');
	points('w3', c.w3, 'diamond');

	/* --- axis titles ------------------------------------------------------ */
	ctx.fillStyle = c.text;
	ctx.font = FONT(11);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'alphabetic';
	// Canvas has no rich text, and Unicode has no subscript g or z, so the band
	// letter is drawn separately, smaller and dropped.
	const head = 'M', tail = ' − 5 log h';
	const wHead = ctx.measureText(head).width;
	const wTail = ctx.measureText(tail).width;
	ctx.font = FONT(8);
	const wSub = ctx.measureText(state.band).width;
	ctx.font = FONT(11);
	const x0 = padL + w / 2 - (wHead + wSub + wTail) / 2;
	ctx.textAlign = 'left';
	ctx.fillText(head, x0, H - 6);
	ctx.font = FONT(8);
	ctx.fillText(state.band, x0 + wHead, H - 4);
	ctx.font = FONT(11);
	ctx.fillText(tail, x0 + wHead + wSub, H - 6);
	ctx.textAlign = 'center';
	ctx.save();
	ctx.translate(13, padT + h / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.textBaseline = 'top';
	ctx.fillText('log₁₀ φ  [h³ Mpc⁻³ mag⁻¹]', 0, 0);
	ctx.restore();
}

/* -------------------------------------------------------------------- init -- */

export async function init(root) {
	const $ = (sel) => root.querySelector(sel);
	const status = document.querySelector('[data-status]');

	let d;
	try {
		d = await fetchJSON(DATA_URL);
	} catch (err) {
		if (status) {
			status.textContent = `Could not load the luminosity function data. ${err.message}`;
			status.hidden = false;
		}
		console.error('[galaxy-lf]', err);
		return;
	}

	// Prove the data that arrived is the data that was exported. Cheap, and it
	// turns a silent column mix-up into a visible complaint.
	for (const g of d.golden) {
		const got = d.data[g.band][g.z].all;
		if (got.w1[g.bin] !== g.w1 || got.true[g.bin] !== g.true) {
			console.error('[galaxy-lf] golden check FAILED', g);
			if (status) {
				status.textContent =
					'The luminosity function data failed its self-check, so the plot below may be wrong.';
				status.hidden = false;
			}
			break;
		}
	}

	const canvas = $('[data-canvas]');
	const zKeys = d.slices.map((s) => `${s.zMid.toFixed(3)}`);

	const urlState = readState();
	const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
	const state = {
		band: pick(urlState.band, d.bands, 'i'),
		z: pick(urlState.z, zKeys, zKeys[0]),
		pz: pick(urlState.pz, PZ_MODES.map((m) => m.id), 'both'),
	};

	const sliceOf = (key) => d.slices.find((s) => s.zMid.toFixed(3) === key);

	/* --- chips ------------------------------------------------------------ */

	function buildChips(name, items, get, set) {
		const host = root.querySelector(`[data-chips="${name}"]`);
		if (!host) return;
		host.replaceChildren();
		for (const item of items) {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'demo-chip';
			b.textContent = item.label;
			b.dataset.value = item.id;
			b.setAttribute('aria-pressed', String(get() === item.id));
			b.addEventListener('click', () => {
				set(item.id);
				for (const other of host.querySelectorAll('.demo-chip')) {
					other.setAttribute('aria-pressed', String(other.dataset.value === get()));
				}
				render();
			});
			host.appendChild(b);
		}
	}

	buildChips(
		'band',
		d.bands.map((b) => ({ id: b, label: b })),
		() => state.band,
		(v) => { state.band = v; },
	);
	buildChips(
		'z',
		zKeys.map((k) => {
			const s = sliceOf(k);
			return { id: k, label: `${s.zLo}–${s.zHi}` };
		}),
		() => state.z,
		(v) => { state.z = v; },
	);
	buildChips('pz', PZ_MODES, () => state.pz, (v) => { state.pz = v; });

	/* --- legend ----------------------------------------------------------- */

	const legend = $('[data-legend]');
	function renderLegend() {
		if (!legend) return;
		const rows = [
			['k-truth', 'GALFORM lightcone'],
			...(state.pz === 'both' || state.pz === 'gauss' ? [['k-gauss', 'Gaussian photo-z']] : []),
			...(state.pz === 'both' || state.pz === 'bcnz' ? [['k-bcnz', 'photo-z with outliers']] : []),
			['k-w1', 'PAUS W1'],
			['k-w3', 'PAUS W3'],
		];
		legend.replaceChildren();
		for (const [cls, label] of rows) {
			const span = document.createElement('span');
			span.className = cls;
			span.textContent = label;
			legend.appendChild(span);
		}
	}

	/* --- render ----------------------------------------------------------- */

	const render = rafThrottle(() => {
		drawPanel(canvas, d, state);
		renderLegend();

		const s = sliceOf(state.z);
		const mc = d.completeness[state.band][state.z];
		const caption = $('[data-caption]');
		if (caption) {
			// At the lowest slice the limit falls off the faint end of the axis, so
			// nothing is shaded and promising a shaded region would be a lie.
			const onPanel = mc > X_MAX && mc < X_MIN;
			caption.textContent =
				`${state.band}-band luminosity function for ${s.zLo} < z < ${s.zHi}. `
				+ (onPanel
					? `PAUS sees no galaxies fainter than M = ${mc.toFixed(1)} at this redshift, `
						+ 'so the shaded part of the panel is a lower limit rather than a census.'
					: `The i ≤ 23 selection reaches M = ${mc.toFixed(1)} here, fainter than the `
						+ 'axis shows, so everything plotted is complete.');
		}
		const live = $('[data-live]');
		if (live) {
			live.textContent =
				`${state.band} band, redshift ${s.zLo} to ${s.zHi}, `
				+ `${PZ_MODES.find((m) => m.id === state.pz).label} photo-z errors. `
				+ `Completeness limit ${mc.toFixed(1)}.`;
		}

		writeState({ band: state.band, z: state.z, pz: state.pz });
	});

	root.querySelectorAll('[data-fill]').forEach((el) => {
		const map = { mc: d.config.mc_runs, jk: d.config.jackknife, ilim: d.config.m_i_limit };
		const v = map[el.dataset.fill];
		if (v !== undefined) el.textContent = v;
	});

	window.addEventListener('resize', render);
	colours = readPalette(root, PALETTE);
	followTheme(root, PALETTE, (palette) => {
		colours = palette;
		render();
	});

	root.classList.add('is-ready');
	render();
}
