/*
 * Watching a universe grow -- /explore/structure-growth/
 *
 * Two SWIFT dark-matter simulations played side by side from z = 45 to today.
 * Both start from the SAME random phases, so everything that differs later is
 * the cosmology and nothing else. That identity at the start is the whole
 * argument, which is why the page opens at z = 45 rather than at z = 0.
 *
 * Data: /data/structure-growth/{structure.json,pk.json}, written by
 * tools/structure/export_web.py. See public/data/structure-growth/README.md.
 *
 * Three rules the data imposes, each of which looks like a bug if broken:
 *
 *   1. Plot only the first `usableBins[i]` k bins of epoch i. Beyond that the
 *      true power is under the shot noise and the subtraction goes negative --
 *      28% of the grid, everywhere above z ~ 6.5. A log axis cannot draw them.
 *
 *   2. Never rescale an axis per epoch, and never restretch a frame per epoch.
 *      Growth is only visible against fixed limits; self-normalising would make
 *      every epoch look equally clumpy, which is the opposite of the point.
 *
 *   3. `growth` exists for every intended cosmology, simulated or not, because
 *      it is an ODE solve rather than a simulation product. A grid point that
 *      has not run yet still has a complete, correct growth history -- so the
 *      chart is never empty, only the pictures are.
 *
 * Playback steps the index at a constant rate rather than easing. The 39 epochs
 * are uniform in log a, so a constant index rate spends equal time per e-fold of
 * expansion, which is the natural clock for gravitational growth. Do not "fix"
 * this with an ease curve: it would second-guess a grid that is already spaced
 * correctly.
 */

import {
	buildRadioChips,
	debounce,
	fetchJSON,
	fitCanvas,
	followTheme,
	prefersReducedMotion,
	rafThrottle,
	readPalette,
	readState,
	writeState,
} from "./common.js";
import { createFrameCache, FRAME_VERSION } from "./frame-cache.js";

const STRUCTURE_URL = "/data/structure-growth/structure.json";
const PK_URL = "/data/structure-growth/pk.json";
const HALOS_URL = "/data/structure-growth/halos.json";
const FRAMES_BASE = "/structure-frames";

/** Playback rate on the frame index. ~4.3 s for the 39 epochs. */
const FPS = 9;

const FONT = (px) => `${px}px ui-monospace, SFMono-Regular, Menlo, monospace`;

const PALETTE = {
	text: "--demo-text",
	axis: "--demo-axis",
	line: "--demo-line",
	surface: "--demo-surface",
	a: "--sg-a",
	b: "--sg-b",
	shot: "--sg-shot",
	ring: "--sg-ring",
};

/*
 * Human labels. Neither existing demo puts a Greek letter in a control, and the
 * w0 labels are doing real work: rho_DE ~ a^(-3(1+w)), so w0 = -1.3 gives
 * a^(+0.9) and dark energy GROWS. "More negative means weaker" is the intuitive
 * reading and it is backwards, so the control never shows the number.
 */
const OM = [
	{ v: 0.15, label: "0.15 sparse" },
	{ v: 0.3, label: "0.30 ours" },
	{ v: 0.45, label: "0.45 heavy" },
];
const W0 = [
	{ v: -0.7, label: "fading" },
	{ v: -1.0, label: "constant" },
	{ v: -1.3, label: "growing" },
];
const NORM = [
	{ id: "today", label: "today" },
	{ id: "start", label: "at the start" },
];
/*
 * Ordered so the halo counts come first: they are the sharpest statement the
 * grid makes -- 157 halos above 1e13 at Omega_m = 0.15 against 832 at 0.45 --
 * on an axis where the two picture panels look nearly identical.
 */
const VIEWS = [
	{ id: "halotime", label: "over time" },
	{ id: "halogrowth", label: "halo growth" },
	{ id: "hmf", label: "mass function" },
	{ id: "pk", label: "scale by scale" },
	{ id: "growth", label: "growth & clumpiness" },
];
const HALO_VIEWS = new Set(["hmf", "halotime", "halogrowth"]);

/*
 * "how many" and "mass function" used to be separate charts, as did "clumpiness"
 * and "growth rate". Each pair is two readings of one dataset, so they now share
 * a frame with independent left and right axes. Links saved against the old view
 * names still work.
 */
const VIEW_ALIASES = { cumulative: "hmf", amplitude: "growth" };

/*
 * Every number the caption prints is formatted to a fixed decimal count AND a
 * fixed total width. Fixed decimals alone are not enough -- "45.11" and "0.00"
 * are different lengths -- and a caption that changes length reflows and jumps
 * about as the reader drags the time slider.
 *
 * The padding character is a FIGURE SPACE (U+2007), not an ordinary space: it
 * has the width of a digit and browsers do not collapse it.
 */
const FIGSP = "\u2007";
const padNum = (v, dp, width) => v.toFixed(dp).padStart(width, FIGSP);
/** Redshift, always 5 characters: "45.11" ... "\u20070.00". */
const fmtZ = (z) => padNum(z, 2, 5);
/** Age in Gyr, always 5 characters. */
const fmtAge = (t) => padNum(t, 2, 5);
/** Growth rate, always 4 characters. */
const fmtF = (f) => padNum(f, 2, 4);
/** A mass as "1.2\u00d710^14", always the same length. */
const fmtMass = (m) => {
	const e = Math.floor(Math.log10(m));
	return `${(m / 10 ** e).toFixed(1)}\u00d710^${String(e).padStart(2, FIGSP)}`;
};

const fmtOm = (v) => v.toFixed(2);
const w0Label = (v) => W0.find((o) => Math.abs(o.v - v) < 1e-9)?.label ?? v.toFixed(1);
const fmtW0 = (v) => v.toFixed(1);

/* ------------------------------------------------------------------ drawing */

function clear(ctx, W, H) {
	ctx.clearRect(0, 0, W, H);
}

/** Msun/h per (Mpc/h)^3. Same constant the halo pipeline uses. */
const RHO_CRIT = 2.77536627e11;
const BOX_MPC_H = 100.0;

/**
 * Ring radius in source-image pixels for a halo of mass `m`.
 *
 * 2 x R_200m, with a small floor so it does not vanish. R_200m alone is 1.2 px
 * at 1e12 Msun/h and 9.9 px for the most massive halo in the box. With a 4 px
 * floor the ring tracks 2 x R_200m over almost the whole mass range and only
 * holds steady at the very faint end, so it stays close to a real size -- but the
 * label beside it is what actually makes it findable.
 */
function ringRadius512(m, omegaM) {
	const rhoM = omegaM * RHO_CRIT;
	const r = ((3 * m) / (4 * Math.PI * 200 * rhoM)) ** (1 / 3); // Mpc/h
	return Math.max(2 * (r / BOX_MPC_H) * 512, 4);
}

/** One simulation panel: the frame, or an explanation of why there isn't one. */
function drawPanel(canvas, bmp, colours, accent, rings) {
	const [W, H] = fitCanvas(canvas);
	const ctx = canvas.getContext("2d");
	clear(ctx, W, H);
	if (W <= 0 || H <= 0) return;

	if (bmp) {
		// Frames are square; the panel may not be. Cover, centred.
		const s = Math.max(W / bmp.width, H / bmp.height);
		const w = bmp.width * s;
		const h = bmp.height * s;
		ctx.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
	} else {
		ctx.fillStyle = colours.surface;
		ctx.fillRect(0, 0, W, H);
	}
	// Identity ring, so the panel and its curve in the chart below are obviously
	// the same universe. Never tint the image itself: pixel value IS log10(1+delta)
	// on a fixed stretch, and a colour multiply would make brightness ambiguous.
	ctx.strokeStyle = accent;
	ctx.lineWidth = 2;
	ctx.strokeRect(1, 1, W - 2, H - 2);

	// Mark the most massive halos. The frame is drawn cover-fit above, so the
	// rings go through the same transform. fx maps to the image ROW and fy to the
	// column: swiftsimio returns the projection indexed [x][y] and PIL writes the
	// first index as the row, so on screen the vertical axis is x. Verified by
	// sampling the frame at each candidate mapping -- the right one lands on
	// 250+/255, the others on 6 to 97.
	if (bmp && rings?.length) {
		const s = Math.max(W / bmp.width, H / bmp.height);
		const ox = (W - bmp.width * s) / 2;
		const oy = (H - bmp.height * s) / 2;
		// One colour for both panels, not the panel identity: the rings point at
		// the same structure in each universe, so colouring them per panel implied
		// a difference that is not there.
		ctx.strokeStyle = colours.ring;
		ctx.fillStyle = colours.ring;
		ctx.lineWidth = 1.5;
		ctx.font = FONT(11);
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		for (const ring of rings) {
			const cx = ox + ring.fy * bmp.width * s;
			const cy = oy + ring.fx * bmp.height * s;
			const rr = ring.r * s;
			ctx.beginPath();
			ctx.arc(cx, cy, rr, 0, Math.PI * 2);
			ctx.stroke();
			// The name travels with the circle, so a ring can be matched to its
			// curve on the growth chart without counting panels.
			ctx.fillText(ring.label, cx + rr + 3, cy);
		}
		ctx.textBaseline = "alphabetic";
	}
}

/**
 * The two cosmologies, drawn inside every chart.
 *
 * Without it the reader has to look back up at the chips to know what the two
 * colours mean, and on a phone the chips for the hidden panel are not even on
 * screen. `corner` differs per view because the curves occupy different parts of
 * the frame -- a key over the data is worse than no key.
 */
function drawCosmoKey(ctx, colours, W, H, pad, rows, corner = "tr") {
	if (!rows.length) return;
	ctx.font = FONT(10);
	ctx.textBaseline = "middle";
	const lh = 13;
	const right = corner.endsWith("r");
	const x = right ? W - pad.r - 8 : pad.l + 8;
	const top = corner.startsWith("t");
	const y0 = top ? pad.t + 10 : H - pad.b - 10 - lh * (rows.length - 1);
	ctx.textAlign = right ? "right" : "left";
	rows.forEach((row, i) => {
		ctx.fillStyle = colours[row.side];
		ctx.fillText(row.text, x, y0 + i * lh);
	});
	ctx.textBaseline = "alphabetic";
	ctx.textAlign = "left";
}

/** Axis furniture shared by the three chart views. */
function frame(ctx, W, H, colours, pad) {
	ctx.strokeStyle = colours.line;
	ctx.lineWidth = 1;
	ctx.strokeRect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b);
}

/**
 * Label for a second, right-hand y axis.
 *
 * Two quantities share one frame on the combined charts, so each needs its own
 * scale. Solid curves read against the left axis and dashed against the right;
 * the axis captions say so, because a twin-axis plot with no such cue is a trap.
 */
function rightAxisLabel(ctx, colours, label, W, H, pad) {
	ctx.fillStyle = colours.axis;
	ctx.font = FONT(11);
	ctx.save();
	ctx.translate(W - 12, pad.t + (H - pad.t - pad.b) / 2);
	ctx.rotate(Math.PI / 2);
	ctx.textAlign = "center";
	ctx.fillText(label, 0, 0);
	ctx.restore();
}

function axisLabels(ctx, colours, xLabel, yLabel, W, H, pad) {
	ctx.fillStyle = colours.axis;
	ctx.font = FONT(11);
	ctx.textAlign = "center";
	ctx.fillText(xLabel, pad.l + (W - pad.l - pad.r) / 2, H - 6);
	ctx.save();
	ctx.translate(12, pad.t + (H - pad.t - pad.b) / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.fillText(yLabel, 0, 0);
	ctx.restore();
}

/**
 * f(z) or sigma8(z) against 1+z.
 *
 * f, not D. Three D curves all converge on 1.0 by construction and read as a
 * single line; f runs 0.345 / 0.513 / 0.644 across the matter axis at z = 0,
 * a factor of 1.86 from end to end.
 */
function drawHistory(canvas, d, state, colours, keyRows) {
	const [W, H] = fitCanvas(canvas);
	const ctx = canvas.getContext("2d");
	clear(ctx, W, H);
	if (W <= 0 || H <= 0) return;
	const pad = { l: 52, r: 54, t: 14, b: 40 };
	const w = W - pad.l - pad.r;
	const h = H - pad.t - pad.b;
	if (w <= 0 || h <= 0) return;

	const zs = d.epochs.z;
	const lo = Math.log10(1 + zs[zs.length - 1]);
	const hi = Math.log10(1 + zs[0]);
	const xOf = (z) => pad.l + w * (1 - (Math.log10(1 + z) - lo) / (hi - lo));

	// Left: growth rate f, linear and bounded. Right: sigma_8, which spans nearly
	// two decades and needs a log scale. Sharing one frame only works because the
	// two axes are independent.
	const fOf = (v) => pad.t + h * (1 - v / 1.05);
	const sLo = Math.log10(0.02);
	const sHi = Math.log10(1.1);
	const sOf = (v) => pad.t + h * (1 - (Math.log10(Math.max(v, 1e-6)) - sLo) / (sHi - sLo));

	frame(ctx, W, H, colours, pad);
	ctx.strokeStyle = colours.line;
	ctx.fillStyle = colours.axis;
	ctx.font = FONT(10);
	ctx.textAlign = "center";
	for (const z of [45, 20, 10, 5, 2, 1, 0]) {
		const x = xOf(z);
		if (x < pad.l - 1 || x > W - pad.r + 1) continue;
		ctx.globalAlpha = 0.5;
		ctx.beginPath();
		ctx.moveTo(x, pad.t);
		ctx.lineTo(x, H - pad.b);
		ctx.stroke();
		ctx.globalAlpha = 1;
		ctx.fillText(z === 0 ? "now" : String(z), x, H - pad.b + 14);
	}
	ctx.textAlign = "right";
	for (const t of [0, 0.25, 0.5, 0.75, 1]) ctx.fillText(t.toFixed(2), pad.l - 6, fOf(t) + 3);
	ctx.textAlign = "left";
	for (const t of [0.02, 0.05, 0.1, 0.2, 0.5, 1])
		ctx.fillText(String(t), W - pad.r + 6, sOf(t) + 3);

	for (const side of ["a", "b"]) {
		const g = state[side].point && d.growth[state[side].point.tag];
		if (!g) continue;
		ctx.strokeStyle = colours[side];
		ctx.lineWidth = 1.8;
		for (const [series, yFn, dash] of [
			[g.f, fOf, []],
			[g.sigma8, sOf, [5, 3]],
		]) {
			// Dashed for the quantity on the right axis, matching the captions.
			ctx.setLineDash(g.simulated ? dash : [2, 2]);
			ctx.beginPath();
			for (let i = 0; i < zs.length; i++) {
				const x = xOf(zs[i]);
				const y = yFn(series[i]);
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.fillStyle = colours[side];
			ctx.beginPath();
			ctx.arc(xOf(zs[state.i]), yFn(series[state.i]), 3.5, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	ctx.strokeStyle = colours.axis;
	ctx.globalAlpha = 0.6;
	ctx.beginPath();
	ctx.moveTo(xOf(zs[state.i]), pad.t);
	ctx.lineTo(xOf(zs[state.i]), H - pad.b);
	ctx.stroke();
	ctx.globalAlpha = 1;

	drawCosmoKey(ctx, colours, W, H, pad, keyRows, "bl");
	rightAxisLabel(ctx, colours, "clumpiness \u03c3\u2088   (dashed)", W, H, pad);
	axisLabels(
		ctx,
		colours,
		"redshift  (earlier to the left)",
		"growth rate  f   (solid)",
		W,
		H,
		pad,
	);
}

/** P(k), truncated honestly at the shot noise. */
function drawPk(canvas, pk, state, colours, keyRows) {
	const [W, H] = fitCanvas(canvas);
	const ctx = canvas.getContext("2d");
	clear(ctx, W, H);
	if (W <= 0 || H <= 0) return;
	const pad = { l: 56, r: 14, t: 14, b: 40 };
	const w = W - pad.l - pad.r;
	const h = H - pad.t - pad.b;
	if (w <= 0 || h <= 0) return;

	// Fixed across every epoch and every run: rescaling per epoch would hide the
	// growth, which is the same mistake as restretching the frames.
	const kLo = Math.log10(0.05);
	const kHi = Math.log10(1.7);
	const pLo = Math.log10(1e-2);
	const pHi = Math.log10(1e5);
	const xOf = (k) => pad.l + (w * (Math.log10(k) - kLo)) / (kHi - kLo);
	const yOf = (p) => pad.t + h * (1 - (Math.log10(p) - pLo) / (pHi - pLo));

	frame(ctx, W, H, colours, pad);

	ctx.fillStyle = colours.axis;
	ctx.font = FONT(10);
	ctx.textAlign = "center";
	for (const k of [0.05, 0.1, 0.2, 0.5, 1]) ctx.fillText(String(k), xOf(k), H - pad.b + 14);
	ctx.textAlign = "right";
	for (const e of [-2, 0, 2, 4]) ctx.fillText(`1e${e}`, pad.l - 6, yOf(10 ** e) + 3);

	if (!pk) {
		ctx.fillStyle = colours.axis;
		ctx.font = FONT(12);
		ctx.textAlign = "center";
		ctx.fillText("loading…", pad.l + w / 2, pad.t + h / 2);
		return;
	}

	// The shot-noise floor, drawn so a curve visibly TERMINATES on it rather than
	// mysteriously stopping. Without this the truncation reads as a broken plot.
	const anyTag = state.a.tag ?? state.b.tag;
	const shot = anyTag && pk.runs[anyTag] ? pk.runs[anyTag].shotNoise : null;
	if (shot) {
		const y = yOf(shot);
		ctx.strokeStyle = colours.shot;
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(pad.l, y);
		ctx.lineTo(W - pad.r, y);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.fillStyle = colours.axis;
		ctx.font = FONT(9);
		ctx.textAlign = "left";
		ctx.fillText("shot noise", pad.l + 4, y - 4);
	}

	for (const side of ["a", "b"]) {
		const tag = state[side].tag;
		const run = tag && pk.runs[tag];
		if (!run) continue;
		const n = run.usableBins[state.i];

		// Every earlier epoch at low alpha: playback then leaves a visible fan
		// sweeping upward, which is what makes the chart worth watching.
		ctx.strokeStyle = colours[side];
		ctx.globalAlpha = 0.09;
		ctx.lineWidth = 1;
		for (let e = 0; e < state.i; e++) {
			const m = run.usableBins[e];
			if (m < 2) continue;
			ctx.beginPath();
			for (let j = 0; j < m; j++) {
				const x = xOf(pk.k[j]);
				const y = yOf(run.P[e][j]);
				if (j === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.stroke();
		}
		ctx.globalAlpha = 1;

		if (n < 1) continue;
		ctx.lineWidth = 1.8;
		ctx.beginPath();
		for (let j = 0; j < n; j++) {
			const x = xOf(pk.k[j]);
			const y = yOf(run.P[state.i][j]);
			if (j === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();
		// At z = 45 only three bins survive; three points joined by a line read as
		// an artefact unless the points themselves are drawn.
		if (n <= 6) {
			ctx.fillStyle = colours[side];
			for (let j = 0; j < n; j++) {
				ctx.beginPath();
				ctx.arc(xOf(pk.k[j]), yOf(run.P[state.i][j]), 2.5, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}

	// P(k) falls from the top left, so the top right is the empty corner.
	drawCosmoKey(ctx, colours, W, H, pad, keyRows, "tr");
	axisLabels(ctx, colours, "k  [Mpc⁻¹]   larger scales to the left", "P(k)  [Mpc³]", W, H, pad);
}

/**
 * Mass growth of the two hand-picked halos, in both universes.
 *
 * Four curves: universe by colour, halo by solid or dashed. Each begins at the
 * epoch its halo is first resolved, which is itself the point -- the object does
 * not exist before then. Mass here is total FOF mass, so it grows by mergers AND
 * by smooth accretion; separating the two would need a particle-matched merger
 * tree, which these snapshots cannot support.
 */
function drawHaloGrowth(canvas, d, halos, state, colours, keyRows) {
	const [W, H] = fitCanvas(canvas);
	const ctx = canvas.getContext("2d");
	clear(ctx, W, H);
	if (W <= 0 || H <= 0) return;
	const pad = { l: 56, r: 14, t: 14, b: 40 };
	const w = W - pad.l - pad.r;
	const h = H - pad.t - pad.b;
	if (w <= 0 || h <= 0) return;

	const zs = d.epochs.z;
	const lo = Math.log10(1 + zs[zs.length - 1]);
	const hi = Math.log10(1 + zs[0]);
	const xOf = (z) => pad.l + w * (1 - (Math.log10(1 + z) - lo) / (hi - lo));
	// Fixed, like every other axis here: rescaling would hide the growth.
	const yLo = 11;
	const yHi = 15;
	const yOf = (lm) => pad.t + h * (1 - (lm - yLo) / (yHi - yLo));

	frame(ctx, W, H, colours, pad);
	ctx.fillStyle = colours.axis;
	ctx.font = FONT(10);
	ctx.textAlign = "center";
	for (const z of [45, 20, 10, 5, 2, 1, 0]) {
		const x = xOf(z);
		if (x < pad.l - 1 || x > W - pad.r + 1) continue;
		ctx.fillText(z === 0 ? "now" : String(z), x, H - pad.b + 14);
	}
	ctx.textAlign = "right";
	for (let e = yLo; e <= yHi; e++) ctx.fillText(`1e${e}`, pad.l - 6, yOf(e) + 3);

	if (halos) {
		for (const side of ["a", "b"]) {
			const tracked = state[side].tag && halos.runs[state[side].tag]?.tracked;
			if (!tracked) continue;
			for (const mark of ["1", "2"]) {
				const series = tracked[mark];
				if (!series) continue;
				ctx.strokeStyle = colours[side];
				ctx.lineWidth = 1.8;
				ctx.setLineDash(mark === "2" ? [5, 3] : []);
				ctx.beginPath();
				let started = false;
				for (let i = 0; i < series.length; i++) {
					if (!series[i]) continue;
					const x = xOf(zs[i]);
					const y = yOf(Math.log10(series[i].m));
					if (started) ctx.lineTo(x, y);
					else {
						ctx.moveTo(x, y);
						started = true;
					}
				}
				ctx.stroke();
				ctx.setLineDash([]);
				const at = series[state.i];
				if (at) {
					ctx.fillStyle = colours[side];
					ctx.beginPath();
					ctx.arc(xOf(zs[state.i]), yOf(Math.log10(at.m)), 3.5, 0, Math.PI * 2);
					ctx.fill();
				}
			}
		}
	}

	ctx.strokeStyle = colours.axis;
	ctx.globalAlpha = 0.6;
	ctx.beginPath();
	ctx.moveTo(xOf(zs[state.i]), pad.t);
	ctx.lineTo(xOf(zs[state.i]), H - pad.b);
	ctx.stroke();
	ctx.globalAlpha = 1;

	drawCosmoKey(ctx, colours, W, H, pad, keyRows, "tl");
	axisLabels(
		ctx,
		colours,
		"redshift  (earlier to the left)  \u2014  solid: Halo 1, dashed: Halo 2",
		"halo mass  [M\u2609/h]",
		W,
		H,
		pad,
	);
}

/* ---------------------------------------------------------------- halo views */

/**
 * Per-run halo series derived from the binned counts.
 *
 * Everything the three halo views draw comes from `counts[epoch][bin]`, so the
 * data file ships ~15k integers instead of millions of individual halos.
 *
 * `floorBin` is the important one. The particle mass scales with Omega_m, so a
 * 32-particle halo is 6.4e11 Msun/h at Omega_m = 0.15 but 1.9e12 at 0.45 -- a
 * factor of three. Drawing below a run's own floor would compare a resolved
 * measurement against an unresolved one, so every curve stops there. Same
 * discipline as usableBins on the P(k) view.
 */
function haloSeries(halos, tag) {
	const run = halos.runs[tag];
	if (!run) return null;
	const edges = halos.logMassEdges;
	const floor = Math.log10(halos.nMinParticles * run.mParticle);
	const floorBin = edges.findIndex((e, i) => i < edges.length - 1 && e >= floor);
	return { run, edges, floor, floorBin: floorBin < 0 ? edges.length - 1 : floorBin };
}

/** Number of halos above 1e13 Msun/h, per epoch. Used by the "over time" view. */
function countAbove(halos, tag, logM) {
	const s = haloSeries(halos, tag);
	if (!s) return null;
	const first = Math.max(
		s.floorBin,
		s.edges.findIndex((e) => e >= logM),
	);
	return s.run.counts.map((row) => {
		let n = 0;
		for (let i = Math.max(0, first); i < row.length; i++) n += row[i];
		return n;
	});
}

/** dn/dlnM, or the cumulative N(>M), at the selected epoch. */
function drawHalos(canvas, halos, state, colours, keyRows) {
	const [W, H] = fitCanvas(canvas);
	const ctx = canvas.getContext("2d");
	clear(ctx, W, H);
	if (W <= 0 || H <= 0) return;
	const pad = { l: 50, r: 56, t: 14, b: 40 };
	const w = W - pad.l - pad.r;
	const h = H - pad.t - pad.b;
	if (w <= 0 || h <= 0) return;

	// Fixed across every epoch and run. Checked against all 17 runs at all 39
	// epochs: nothing falls outside these limits.
	const xLo = 12.0;
	const xHi = 15.0;
	const xOf = (lm) => pad.l + (w * (lm - xLo)) / (xHi - xLo);
	// Left: how many halos exceed a mass. Right: how many per unit log mass.
	// Same data, two conventional readings; sharing the frame lets one be read
	// off the other.
	const nOf = (ly) => pad.t + h * (1 - ly / 4);
	const dOf = (ly) => pad.t + h * (1 - (ly + 7) / 5);

	frame(ctx, W, H, colours, pad);
	ctx.fillStyle = colours.axis;
	ctx.font = FONT(10);
	ctx.textAlign = "center";
	for (let lm = 12; lm <= 15; lm++) ctx.fillText(`1e${lm}`, xOf(lm), H - pad.b + 14);
	ctx.textAlign = "right";
	for (let e = 0; e <= 4; e++) ctx.fillText(String(10 ** e), pad.l - 6, nOf(e) + 3);
	ctx.textAlign = "left";
	for (let e = -7; e <= -2; e++) ctx.fillText(`1e${e}`, W - pad.r + 6, dOf(e) + 3);

	if (!halos) {
		ctx.fillStyle = colours.axis;
		ctx.font = FONT(12);
		ctx.textAlign = "center";
		ctx.fillText("loading\u2026", pad.l + w / 2, pad.t + h / 2);
		return;
	}

	const dlnM = Math.LN10 * (halos.logMassEdges[1] - halos.logMassEdges[0]);
	for (const side of ["a", "b"]) {
		const tag = state[side].tag;
		const ser = tag && haloSeries(halos, tag);
		if (!ser) continue;
		const row = ser.run.counts[state.i];

		const cum = [];
		const dif = [];
		let running = 0;
		for (let i = row.length - 1; i >= ser.floorBin; i--) {
			running += row[i];
			const lm = (ser.edges[i] + ser.edges[i + 1]) / 2;
			if (running > 0) cum.push([lm, Math.log10(running)]);
			const dn = row[i] / (halos.boxVolume * dlnM);
			if (dn > 0) dif.push([lm, Math.log10(dn), row[i]]);
		}
		cum.reverse();
		dif.reverse();

		ctx.strokeStyle = colours[side];
		ctx.lineWidth = 1.8;
		for (const [pts, yFn, dash] of [
			[cum, nOf, []],
			[dif, dOf, [5, 3]],
		]) {
			if (!pts.length) continue;
			ctx.setLineDash(dash);
			ctx.beginPath();
			for (let j = 0; j < pts.length; j++) {
				const [lm, ly] = pts[j];
				if (j === 0) ctx.moveTo(xOf(lm), yFn(ly));
				else ctx.lineTo(xOf(lm), yFn(ly));
			}
			ctx.stroke();
			ctx.setLineDash([]);
		}

		// sqrt(N) bars, on the differential only: cumulative bins share objects,
		// so error bars there would imply an independence they do not have.
		ctx.globalAlpha = 0.5;
		for (const [lm, ly, n] of dif) {
			if (n < 1 || n > 60) continue;
			const rel = Math.sqrt(n) / n;
			ctx.beginPath();
			ctx.moveTo(xOf(lm), dOf(Math.log10(10 ** ly * (1 + rel))));
			ctx.lineTo(xOf(lm), dOf(Math.log10(Math.max(1e-30, 10 ** ly * (1 - rel)))));
			ctx.stroke();
		}
		ctx.globalAlpha = 1;

		// Where this run stops resolving halos. Skipped when off the left of the
		// axis -- at Omega_m = 0.15 the floor is 10^11.80, below the plotted range.
		if (ser.floor < xLo) continue;
		ctx.setLineDash([2, 3]);
		ctx.globalAlpha = 0.55;
		ctx.beginPath();
		ctx.moveTo(xOf(ser.floor), pad.t);
		ctx.lineTo(xOf(ser.floor), H - pad.b);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
	}

	drawCosmoKey(ctx, colours, W, H, pad, keyRows, "tr");
	rightAxisLabel(ctx, colours, "dn/dlnM  [(Mpc/h)\u207b\u00b3]   (dashed)", W, H, pad);
	axisLabels(
		ctx,
		colours,
		"halo mass  [M\u2609/h]   dotted = 32-particle limit",
		"halos above M   (solid)",
		W,
		H,
		pad,
	);
}

/** Halos above 1e13 Msun/h against redshift -- structure assembling. */
function drawHaloTime(canvas, d, halos, state, colours, yMax, keyRows) {
	const [W, H] = fitCanvas(canvas);
	const ctx = canvas.getContext("2d");
	clear(ctx, W, H);
	if (W <= 0 || H <= 0) return;
	const pad = { l: 56, r: 14, t: 14, b: 40 };
	const w = W - pad.l - pad.r;
	const h = H - pad.t - pad.b;
	if (w <= 0 || h <= 0) return;

	const zs = d.epochs.z;
	const lo = Math.log10(1 + zs[zs.length - 1]);
	const hi = Math.log10(1 + zs[0]);
	const xOf = (z) => pad.l + w * (1 - (Math.log10(1 + z) - lo) / (hi - lo));
	const yOf = (n) => pad.t + h * (1 - n / yMax);

	frame(ctx, W, H, colours, pad);
	ctx.fillStyle = colours.axis;
	ctx.font = FONT(10);
	ctx.textAlign = "center";
	for (const z of [45, 20, 10, 5, 2, 1, 0]) {
		const x = xOf(z);
		if (x < pad.l - 1 || x > W - pad.r + 1) continue;
		ctx.fillText(z === 0 ? "now" : String(z), x, H - pad.b + 14);
	}
	ctx.textAlign = "right";
	for (let k = 0; k <= 4; k++) {
		const v = Math.round((yMax * k) / 4);
		ctx.fillText(String(v), pad.l - 6, yOf(v) + 3);
	}

	if (halos) {
		for (const side of ["a", "b"]) {
			const tag = state[side].tag;
			const series = tag && countAbove(halos, tag, 13);
			if (!series) continue;
			ctx.strokeStyle = colours[side];
			ctx.lineWidth = 1.8;
			ctx.beginPath();
			for (let i = 0; i < series.length; i++) {
				if (i === 0) ctx.moveTo(xOf(zs[i]), yOf(series[i]));
				else ctx.lineTo(xOf(zs[i]), yOf(series[i]));
			}
			ctx.stroke();
			ctx.fillStyle = colours[side];
			ctx.beginPath();
			ctx.arc(xOf(zs[state.i]), yOf(series[state.i]), 3.5, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	// This view does not depend on the epoch, so the "you are here" rule is what
	// keeps the time slider visibly connected to it.
	ctx.strokeStyle = colours.axis;
	ctx.globalAlpha = 0.6;
	ctx.beginPath();
	ctx.moveTo(xOf(zs[state.i]), pad.t);
	ctx.lineTo(xOf(zs[state.i]), H - pad.b);
	ctx.stroke();
	ctx.globalAlpha = 1;

	// The count rises to the right, leaving the top left clear.
	drawCosmoKey(ctx, colours, W, H, pad, keyRows, "tl");
	axisLabels(ctx, colours, "redshift  (earlier to the left)", "halos above 10¹³ M☉/h", W, H, pad);
}

/* --------------------------------------------------------------------- init */

export async function init(root) {
	const $ = (sel) => root.querySelector(sel);
	const status = document.querySelector("[data-status]");
	const fail = (msg, err) => {
		if (status) {
			status.textContent = msg;
			status.hidden = false;
		}
		// Reveal regardless: the prose below the demo is perfectly readable, and
		// data-pagefind-body has already indexed it into site search. Leaving the
		// root hidden on failure would point search results at an invisible page.
		root.classList.add("is-ready");
		if (err) console.error("[structure-growth]", err);
	};

	let d;
	try {
		d = await fetchJSON(STRUCTURE_URL);
	} catch (err) {
		fail("The simulation data could not be loaded, so this demo cannot run.", err);
		return;
	}

	/* --- grid ------------------------------------------------------------- */

	// intendedGrid names every cosmology the campaign will produce, so the
	// controls are complete from the first run onward and a finished run needs an
	// export and no code change. Older exports lack it; derive a one-point-per-run
	// grid so the page still works against them.
	const grid = d.intendedGrid ?? {
		omegaM: d.axes.omegaM,
		w0: d.axes.w0,
		normalisation: d.axes.normalisation ?? ["today"],
		points: d.runs.flatMap((r) =>
			(r.normalisation ?? ["today"]).map((n) => ({
				omegaM: r.omegaM,
				w0: r.w0,
				normalisation: n,
				tag: r.tag,
				sigma8: r.sigma8,
				available: true,
			})),
		),
		nAvailable: d.runs.length,
		nTotal: d.runs.length,
	};

	const pointAt = (om, w0, norm) =>
		grid.points.find(
			(p) =>
				Math.abs(p.omegaM - om) < 1e-9 && Math.abs(p.w0 - w0) < 1e-9 && p.normalisation === norm,
		);

	/* --- state ------------------------------------------------------------ */

	const urlState = readState();
	const num = (v, allowed, fallback) => {
		const x = Number.parseFloat(v);
		return Number.isFinite(x) && allowed.some((a) => Math.abs(a - x) < 1e-9) ? x : fallback;
	};
	const state = {
		a: { om: num(urlState.aom, grid.omegaM, 0.3), w0: num(urlState.aw, grid.w0, -1.0), tag: null },
		b: { om: num(urlState.bom, grid.omegaM, 0.15), w0: num(urlState.bw, grid.w0, -1.0), tag: null },
		norm: grid.normalisation.includes(urlState.n) ? urlState.n : "today",
		i: Number.isFinite(+urlState.i) ? Math.min(38, Math.max(0, +urlState.i | 0)) : 0,
		view: (() => {
			const v = VIEW_ALIASES[urlState.v] ?? urlState.v;
			return VIEWS.some((x) => x.id === v) ? v : "halotime";
		})(),
		panel: "a",
		playing: false,
	};

	/** Decoded-frame caches, keyed by cosmology tag. Declared above resolveTags
	 *  because that function evicts from it and runs before this line otherwise. */
	const caches = new Map();

	function resolveTags() {
		for (const side of ["a", "b"]) {
			const p = pointAt(state[side].om, state[side].w0, state.norm);
			state[side].tag = p?.available ? p.tag : null;
			state[side].point = p ?? null;
		}
		// Drop caches for cosmologies no longer displayed. Without this the Map
		// only ever grows: reconcile() runs for the two selected tags, so a
		// deselected one freezes holding up to WINDOW decoded bitmaps forever.
		// At 17 tags x 12 x 1 MB that is ~204 MB, which is exactly the tab-kill
		// the frame-cache header warns about. Two kept beyond the current pair,
		// so flicking A/B between a few cosmologies stays instant.
		const keep = new Set([state.a.tag, state.b.tag].filter(Boolean));
		const spare = [...caches.keys()].filter((t) => !keep.has(t));
		for (const t of spare.slice(0, Math.max(0, spare.length - 2))) {
			caches.get(t).destroy();
			caches.delete(t);
		}
	}
	resolveTags();

	/* --- frame caches ----------------------------------------------------- */

	function cacheFor(tag) {
		if (!tag) return null;
		let c = caches.get(tag);
		if (!c) {
			c = createFrameCache({
				count: d.epochs.z.length,
				url: (i) =>
					`${FRAMES_BASE}/${tag}/frame_${String(i).padStart(3, "0")}.avif?v=${FRAME_VERSION}`,
				onReady: () => render(),
			});
			caches.set(tag, c);
			void c.prefetchAll();
		}
		return c;
	}

	const canvasA = $("[data-canvas-a]");
	const canvasB = $("[data-canvas-b]");
	const chart = $("[data-chart]");
	let pk = null;
	let pkLoading = false;
	let halos = null;
	let halosLoading = false;
	/** Fixed y-limit for the "over time" view, derived once from the whole grid
	 *  rather than per epoch, so the curve growing means something. */
	let haloYMax = 100;
	let colours = {};

	/* --- rendering -------------------------------------------------------- */

	// Assigning identical text still replaces the text node, and NVDA and JAWS
	// re-announce on that mutation -- so a mobile address-bar collapse (which
	// fires resize -> render) would read the whole description out again.
	let lastAnnounced = "";
	const announce = debounce((text) => {
		const live = $("[data-live]");
		if (!live || text === lastAnnounced) return;
		lastAnnounced = text;
		live.textContent = text;
	}, 400);

	// The canvas names change with every epoch; at 9 fps that is 18 accessibility
	// tree mutations a second. common.js already documents debounce as being for
	// exactly this.
	const setPanelLabels = debounce(() => {
		for (const [side, canvas] of [
			["a", canvasA],
			["b", canvasB],
		]) {
			if (canvas) canvas.setAttribute("aria-label", describe(side));
		}
	}, 250);

	function describe(side) {
		const s = state[side];
		const g = s.tag ? d.growth[s.tag] : s.point && d.growth[s.point.tag];
		const z = d.epochs.z[state.i];
		const name = side === "a" ? "Universe A" : "Universe B";
		if (!s.tag) {
			return `${name}: matter ${fmtOm(s.om)}, dark energy ${w0Label(s.w0)}. Not simulated yet.`;
		}
		const s8 = g ? g.sigma8[state.i] : null;
		let look = "Nearly smooth";
		if (s8 > 0.6) look = "Clusters have formed at the nodes";
		else if (s8 > 0.35) look = "A web of filaments";
		else if (s8 > 0.15) look = "The first filaments are appearing";
		const letter = side.toUpperCase();
		const m1 = trackedMass(side, "1");
		const m2 = trackedMass(side, "2");
		const circled =
			m1 || m2
				? ` Halo 1${letter} at ${fmtMassOr(m1)} and Halo 2${letter} at ${fmtMassOr(m2)} solar masses are circled.`
				: "";
		return `${name}: matter ${fmtOm(s.om)}, dark energy ${w0Label(s.w0)}, redshift ${fmtZ(z)}. ${look}.${circled}`;
	}

	let lastIndex = 0;
	let lastDir = 1;
	/**
	 * Fetch the halo data.
	 *
	 * Called during init rather than only on a chip click, because "over time" is
	 * now the default view -- lazily waiting for an event that never fires would
	 * leave the opening chart empty. drawHaloTime tolerates a null `halos`, so the
	 * axes render while this is in flight.
	 */
	function loadHalos() {
		if (halos || halosLoading) return;
		halosLoading = true;
		fetchJSON(HALOS_URL)
			.then((j) => {
				halos = j;
				// One fixed maximum for the whole grid, taken across every run and
				// epoch, so the curve rising is a real statement and not an axis
				// rescaling under the reader.
				let m = 1;
				for (const tag of Object.keys(j.runs)) {
					const series = countAbove(j, tag, 13);
					if (series) m = Math.max(m, ...series);
				}
				haloYMax = Math.ceil(m / 50) * 50;
				render();
			})
			.catch((err) => {
				halosLoading = false;
				fail("The halo counts could not be loaded; showing the growth history instead.", err);
				state.view = "growth";
				refresh();
			});
	}

	/**
	 * The two hand-picked halos for one panel, as rings.
	 *
	 * These replaced an automatic "two most massive in the slab" pick, which
	 * jumped from object to object between epochs and so said nothing about
	 * growth. These two are chosen once at z=0 inside the marks on slide 9 of the
	 * design deck and followed backwards, so a ring stays on the same halo and
	 * ties to its curve on the mass-growth chart.
	 */
	function ringsFor(side) {
		const tag = state[side].tag;
		const tracked = tag && halos?.runs[tag]?.tracked;
		if (!tracked) return [];
		const om = state[side].om;
		const out = [];
		for (const mark of ["1", "2"]) {
			const h = tracked[mark]?.[state.i];
			if (h) {
				out.push({
					fx: h.fx,
					fy: h.fy,
					r: ringRadius512(h.m, om),
					label: mark + side.toUpperCase(),
				});
			}
		}
		return out;
	}

	/** A count padded to three digits, so the caption cannot change length. */
	const fmtCount = (n) => String(n).padStart(3, FIGSP);
	/** A mass, or a same-width dash when the halo has not formed yet. */
	const fmtMassOr = (m) => (m ? fmtMass(m) : "\u2014".padStart(9, FIGSP));

	/** Halos above 1e13 in one panel at the current epoch, or null. */
	function nAbove13(side) {
		const tag = state[side].tag;
		if (!halos || !tag || !halos.runs[tag]) return null;
		const series = countAbove(halos, tag, 13);
		return series ? series[state.i] : null;
	}

	/** Mass of a tracked halo in one panel now, or null before it forms. */
	function trackedMass(side, mark) {
		const tag = state[side].tag;
		const t = halos?.runs[tag]?.tracked?.[mark]?.[state.i];
		return t ? t.m : null;
	}

	/*
	 * The caption describes the chart that is actually on screen, and names the
	 * universes rather than "left" and "right" -- below 40em only one panel is
	 * shown, so sides are meaningless there.
	 *
	 * Every number is fixed-width (see FIGSP above). The opening clause is
	 * uniform rather than special-casing "Today", because that would change the
	 * length at exactly the moment the reader reaches the end of the slider.
	 */
	function captionText() {
		const z = d.epochs.z[state.i];
		const gA = state.a.point && d.growth[state.a.point.tag];
		const gB = state.b.point && d.growth[state.b.point.tag];
		const age = gA?.tGyr ? gA.tGyr[state.i] : 0;
		let txt = `Redshift ${fmtZ(z)} \u2014 ${fmtAge(age)} billion years after the Big Bang.`;

		switch (state.view) {
			case "growth":
				if (gA && gB) {
					txt +=
						` Universe A grows at ${fmtF(gA.f[state.i])} with clumpiness ${fmtF(gA.sigma8[state.i])};` +
						` Universe B at ${fmtF(gB.f[state.i])} with ${fmtF(gB.sigma8[state.i])}.`;
				}
				break;
			case "pk": {
				const rA = state.a.tag && pk?.runs[state.a.tag];
				const rB = state.b.tag && pk?.runs[state.b.tag];
				if (rA && rB) {
					txt += ` Of ${pk.k.length} scales, ${fmtCount(rA.usableBins[state.i])} rise above the shot noise in Universe A and ${fmtCount(rB.usableBins[state.i])} in Universe B.`;
				}
				break;
			}
			case "hmf":
			case "halotime": {
				const nA = nAbove13("a");
				const nB = nAbove13("b");
				if (nA !== null && nB !== null) {
					txt += ` Universe A holds ${fmtCount(nA)} halos above 10^13 solar masses, Universe B ${fmtCount(nB)}.`;
				}
				break;
			}
			case "halogrowth":
				txt += ` Halo 1A is ${fmtMassOr(trackedMass("a", "1"))} solar masses and Halo 2A ${fmtMassOr(trackedMass("a", "2"))}; Halo 1B ${fmtMassOr(trackedMass("b", "1"))} and Halo 2B ${fmtMassOr(trackedMass("b", "2"))}.`;
				break;
			default:
				break;
		}
		return txt;
	}

	/** The two cosmologies, as the key each chart draws in a free corner. */
	function cosmoKeyRows() {
		const rows = [];
		for (const side of ["a", "b"]) {
			const p = state[side].point;
			if (!p) continue;
			rows.push({
				side,
				text: `${side.toUpperCase()}  \u03a9m ${fmtOm(p.omegaM)}  w\u2080 ${fmtW0(p.w0)}  \u03c3\u2088 ${p.sigma8.toFixed(2)}`,
			});
		}
		return rows;
	}

	function chartLabel() {
		const v = VIEWS.find((x) => x.id === state.view);
		const z = d.epochs.z[state.i];
		const at = state.view === "halotime" ? "over cosmic time" : `at redshift ${z.toFixed(2)}`;
		return `Chart: ${v ? v.label : state.view}, comparing Universe A and Universe B ${at}.`;
	}

	const render = rafThrottle(() => {
		// Bias the decode window toward travel. Hardcoding forward made every
		// backward step evict the frame about to be needed and re-decode it.
		const dir = state.i === lastIndex ? lastDir : Math.sign(state.i - lastIndex);
		lastDir = dir || lastDir;
		lastIndex = state.i;
		for (const [side, canvas] of [
			["a", canvasA],
			["b", canvasB],
		]) {
			if (!canvas) continue;
			const tag = state[side].tag;
			const c = cacheFor(tag);
			if (c) c.reconcile(state.i, dir);
			const bmp = c ? c.get(state.i) : null;
			drawPanel(canvas, bmp, colours, colours[side], ringsFor(side));

			const host = canvas.closest("[data-frame]");
			const tile = host?.querySelector("[data-placeholder]");
			if (tile) {
				const missing = !tag || (c?.failed && !bmp);
				tile.hidden = !missing;
				if (missing) {
					const p = state[side].point;
					const why = !tag
						? `Still running — ${grid.nAvailable} of ${grid.nTotal} universes finished.`
						: "The pictures for this run have not been published yet.";
					tile.innerHTML = "";
					const h = document.createElement("strong");
					h.textContent = `matter ${fmtOm(state[side].om)} · dark energy ${w0Label(state[side].w0)}`;
					const q = document.createElement("span");
					q.textContent = p ? `${why} Its clumpiness today would be σ₈ = ${p.sigma8}.` : why;
					const r = document.createElement("span");
					r.className = "demo-panel__hint";
					r.textContent = "Its growth history is still drawn below.";
					tile.append(h, q, r);
				}
			}
		}

		if (chart) {
			const keyRows = cosmoKeyRows();
			if (state.view === "pk") drawPk(chart, pk, state, colours, keyRows);
			else if (state.view === "halotime") {
				drawHaloTime(chart, d, halos, state, colours, haloYMax, keyRows);
			} else if (state.view === "halogrowth") {
				drawHaloGrowth(chart, d, halos, state, colours, keyRows);
			} else if (state.view === "hmf") {
				drawHalos(chart, halos, state, colours, keyRows);
			} else drawHistory(chart, d, state, colours, keyRows);
			// The chart's accessible name has to say what is currently plotted;
			// naming the control's options instead tells a screen reader nothing.
			chart.setAttribute("aria-label", chartLabel());
		}

		const z = d.epochs.z[state.i];
		const readout = $("[data-z-readout]");
		if (readout) readout.textContent = z >= 0.005 ? `z = ${z.toFixed(2)}` : "today";

		const caption = $("[data-caption]");
		if (caption) caption.textContent = captionText();

		setPanelLabels();
		if (!state.playing) announce(`${describe("a")} ${describe("b")}`);

		saveState();
	});

	// history.replaceState is rate-limited -- Safari throws SecurityError after
	// 100 calls in 30 s. render() runs on every playback frame (9/s), every
	// resize and every frame of the theme settle loop, which clears that in two
	// playthroughs. The URL only needs to be right when the reader stops moving.
	const saveState = debounce(() => {
		writeState({
			aom: fmtOm(state.a.om),
			aw: fmtW0(state.a.w0),
			bom: fmtOm(state.b.om),
			bw: fmtW0(state.b.w0),
			n: state.norm,
			i: String(state.i),
			v: state.view,
		});
	}, 500);

	/* --- controls --------------------------------------------------------- */

	const syncs = [];
	function chipItems(axis, side) {
		const list = axis === "om" ? OM : W0;
		return list.map((o) => {
			const om = axis === "om" ? o.v : state[side].om;
			const w0 = axis === "om" ? state[side].w0 : o.v;
			const p = pointAt(om, w0, state.norm);
			return { id: String(o.v), label: o.label, available: !!p?.available };
		});
	}

	function refresh() {
		resolveTags();
		for (const s of syncs) s();
		drawGridMap();
		render();
	}

	for (const side of ["a", "b"]) {
		syncs.push(
			buildRadioChips(
				root,
				`${side}-om`,
				chipItems("om", side),
				() => String(state[side].om),
				(v) => {
					state[side].om = Number.parseFloat(v);
				},
				refresh,
			),
		);
		syncs.push(
			buildRadioChips(
				root,
				`${side}-w0`,
				chipItems("w0", side),
				() => String(state[side].w0),
				(v) => {
					state[side].w0 = Number.parseFloat(v);
				},
				refresh,
			),
		);
	}
	// Availability depends on the other axes, so the item lists must be rebuilt,
	// not merely re-checked. sync() takes a fresh list for exactly this.
	const rawSyncs = syncs.slice();
	syncs.length = 0;
	let si = 0;
	for (const side of ["a", "b"]) {
		for (const axis of ["om", "w0"]) {
			const s = rawSyncs[si++];
			syncs.push(() => s(chipItems(axis, side)));
		}
	}

	syncs.push(
		buildRadioChips(
			root,
			"norm",
			NORM,
			() => state.norm,
			(v) => {
				state.norm = v;
			},
			refresh,
		),
	);
	syncs.push(
		buildRadioChips(
			root,
			"view",
			VIEWS,
			() => state.view,
			(v) => {
				state.view = v;
				if (HALO_VIEWS.has(v)) loadHalos();
				if (v === "pk" && !pk && !pkLoading) {
					pkLoading = true;
					fetchJSON(PK_URL)
						.then((j) => {
							pk = j;
							checkGoldenPk();
							render();
						})
						.catch((err) => {
							// Reset the guard, or the retry is never attempted and the
							// chart shows "loading..." forever with no error banner.
							pkLoading = false;
							fail("The power spectra could not be loaded; showing growth instead.", err);
							state.view = "growth";
							refresh();
						});
				}
			},
			refresh,
		),
	);
	syncs.push(
		buildRadioChips(
			root,
			"panel",
			[
				{ id: "a", label: "A" },
				{ id: "b", label: "B" },
			],
			() => state.panel,
			(v) => {
				state.panel = v;
			},
			() => {
				applyBreakpoint();
				render();
			},
		),
	);

	/* --- golden self-checks ----------------------------------------------- */

	// Split, because d.golden mixes values from the two files. The P entries must
	// be compared exactly: one of them is negative, and any "skip non-positive"
	// guard would quietly turn this check into a no-op.
	for (const g of d.golden ?? []) {
		const blk = d.growth[g.tag];
		if (!blk) continue;
		if (blk.D[g.epochIndex] !== g.D || d.epochs.z[g.epochIndex] !== g.z) {
			fail("The growth values in this page's data did not match their own checksums.");
			break;
		}
	}
	function checkGoldenPk() {
		for (const g of d.golden ?? []) {
			const run = pk.runs[g.tag];
			if (!run) continue;
			if (pk.k[g.kIndex] !== g.k || run.P[g.epochIndex][g.kIndex] !== g.P) {
				fail("The power spectra in this page's data did not match their own checksums.");
				break;
			}
		}
	}

	/* --- grid map --------------------------------------------------------- */

	function drawGridMap() {
		const host = $("[data-gridmap]");
		if (!host) return;
		host.replaceChildren();
		for (const om of grid.omegaM) {
			for (const w0 of grid.w0) {
				const p = pointAt(om, w0, state.norm);
				const dot = document.createElement("i");
				dot.className = "demo-gridmap__dot";
				if (p?.available) dot.dataset.on = "";
				if (Math.abs(state.a.om - om) < 1e-9 && Math.abs(state.a.w0 - w0) < 1e-9)
					dot.dataset.ring = "a";
				if (Math.abs(state.b.om - om) < 1e-9 && Math.abs(state.b.w0 - w0) < 1e-9)
					dot.dataset.ring = "b";
				host.appendChild(dot);
			}
		}
	}

	/* --- prose fill ------------------------------------------------------- */

	const fills = {
		box: d.box.sizeMpcH,
		slab: d.box.slabMpcH,
		particles: d.box.particles.toLocaleString("en"),
		res: d.box.resolution,
		seed: d.box.seed,
		frames: d.epochs.z.length,
		nAvail: grid.nAvailable,
		nTotal: grid.nTotal,
		stretchLo: d.stretch[0],
		stretchHi: d.stretch[1],
		exported: (d.provenance?.generated_utc ?? "").replace("T", " ").replace("Z", " UTC"),
	};
	for (const el of root.querySelectorAll("[data-fill]")) {
		const v = fills[el.dataset.fill];
		if (v !== undefined) el.textContent = String(v);
	}
	const progress = $("[data-progress]");
	if (progress && grid.nAvailable >= grid.nTotal) {
		progress.textContent = `All ${grid.nTotal} universes are finished.`;
	}

	/* --- transport (must come after `render`: it calls it synchronously) --- */

	const slider = $("[data-time]");
	const playBtn = $("[data-play]");

	/** What the slider announces. Never the index -- the index means nothing. */
	function valueText() {
		const z = d.epochs.z[state.i];
		const g = state.a.point && d.growth[state.a.point.tag];
		const age = g?.tGyr ? `, universe A ${g.tGyr[state.i].toFixed(2)} billion years old` : "";
		return `redshift ${z.toFixed(2)}${age}`;
	}
	let timer = 0;
	let autoplayTimer = 0;

	function setIndex(i) {
		state.i = Math.min(d.epochs.z.length - 1, Math.max(0, i));
		if (slider) {
			slider.value = String(state.i);
			// Set here rather than inside the rAF-throttled render: assistive tech
			// reads the value on the change event, which fires ~16 ms before the
			// next frame, so a deferred update announces the PREVIOUS epoch.
			slider.setAttribute("aria-valuetext", valueText());
		}
		render();
	}
	function stop() {
		state.playing = false;
		// Cancel a pending autoplay too: the reader touching the transport is an
		// explicit statement about what they want the clock to do.
		clearTimeout(autoplayTimer);
		autoplayTimer = 0;
		clearInterval(timer);
		timer = 0;
		if (playBtn) {
			playBtn.textContent = state.i >= d.epochs.z.length - 1 ? "Play again" : "Play";
			playBtn.removeAttribute("aria-label");
		}
	}
	function play() {
		if (state.playing) return;
		if (state.i >= d.epochs.z.length - 1) setIndex(0);
		state.playing = true;
		if (playBtn) {
			// The label changes, so there is deliberately no aria-pressed: "Pause,
			// pressed" is ambiguous about what is currently happening.
			playBtn.textContent = "Pause";
			playBtn.removeAttribute("aria-label");
		}
		announce("Playing forward from redshift 45.");
		timer = setInterval(() => {
			if (state.i >= d.epochs.z.length - 1) {
				stop();
				const gA = state.a.tag && d.growth[state.a.tag];
				const gB = state.b.tag && d.growth[state.b.tag];
				if (gA && gB) {
					announce(
						`Finished at redshift 0. Universe A grows at ${gA.f.at(-1).toFixed(2)}, Universe B at ${gB.f.at(-1).toFixed(2)}.`,
					);
				}
				return;
			}
			setIndex(state.i + 1);
		}, 1000 / FPS);
	}

	if (slider) {
		slider.max = String(d.epochs.z.length - 1);
		slider.value = String(state.i);
		// The reader's first touch wins the clock, permanently for that gesture.
		slider.addEventListener("input", () => {
			stop();
			setIndex(Number(slider.value));
		});
	}
	playBtn?.addEventListener("click", () => (state.playing ? stop() : play()));
	$("[data-step-back]")?.addEventListener("click", () => {
		stop();
		setIndex(state.i - 1);
	});
	$("[data-step-fwd]")?.addEventListener("click", () => {
		stop();
		setIndex(state.i + 1);
	});
	$("[data-reset]")?.addEventListener("click", () => {
		stop();
		setIndex(0);
	});
	document.addEventListener("visibilitychange", () => {
		// Pause when hidden; do NOT auto-resume, which would be motion the reader
		// did not ask for on a tab they have just returned to.
		if (document.hidden) stop();
	});

	/* --- responsive ------------------------------------------------------- */

	const wide = window.matchMedia("(min-width: 40em)");
	function applyBreakpoint() {
		const pair = $("[data-pair]");
		const sw = $("[data-panel-switch]");
		if (sw) sw.hidden = wide.matches;
		if (!pair) return;
		for (const side of ["a", "b"]) {
			const el = pair.querySelector(`[data-panel="${side}"]`);
			if (el) el.hidden = !wide.matches && state.panel !== side;
		}
		// A hidden canvas measures 0x0, so fitCanvas would size it 1x1. Redraw
		// after layout has settled rather than in the same tick.
		requestAnimationFrame(() => render());
	}
	wide.addEventListener("change", applyBreakpoint);
	applyBreakpoint();
	window.addEventListener("resize", render);

	/* --- theme ------------------------------------------------------------ */

	colours = readPalette(root, PALETTE);
	followTheme(root, PALETTE, (p) => {
		colours = p;
		render();
	});

	loadHalos();
	drawGridMap();
	root.classList.add("is-ready");
	render();

	/* --- opening --------------------------------------------------------- */

	// Reduced motion means "nothing moves unbidden", not "no page": the play
	// button stays fully functional, it just is not pressed for the reader.
	if (!prefersReducedMotion()) {
		const stage = $("[data-stage]");
		const startWhenSeen = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.intersectionRatio >= 0.35) {
						startWhenSeen.disconnect();
						// Autoplaying into an undecoded panel wastes the opening; give
						// the first frames a moment to land.
						autoplayTimer = setTimeout(play, 400);
					}
				}
			},
			{ threshold: [0.35] },
		);
		if (stage) startWhenSeen.observe(stage);
	} else {
		const hint = $("[data-motion-hint]");
		if (hint) hint.hidden = false;
	}
}
