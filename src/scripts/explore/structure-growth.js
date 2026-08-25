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
const VIEWS = [
	{ id: "growth", label: "growth rate" },
	{ id: "amplitude", label: "clumpiness" },
	{ id: "pk", label: "scale by scale" },
];

const fmtOm = (v) => v.toFixed(2);
const w0Label = (v) => W0.find((o) => Math.abs(o.v - v) < 1e-9)?.label ?? v.toFixed(1);
const fmtW0 = (v) => v.toFixed(1);

/* ------------------------------------------------------------------ drawing */

function clear(ctx, W, H) {
	ctx.clearRect(0, 0, W, H);
}

/** One simulation panel: the frame, or an explanation of why there isn't one. */
function drawPanel(canvas, bmp, colours, accent) {
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
}

/** Axis furniture shared by the three chart views. */
function frame(ctx, W, H, colours, pad) {
	ctx.strokeStyle = colours.line;
	ctx.lineWidth = 1;
	ctx.strokeRect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b);
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
function drawHistory(canvas, d, state, colours, which) {
	const [W, H] = fitCanvas(canvas);
	const ctx = canvas.getContext("2d");
	clear(ctx, W, H);
	if (W <= 0 || H <= 0) return;
	const pad = { l: 52, r: 14, t: 14, b: 40 };
	const w = W - pad.l - pad.r;
	const h = H - pad.t - pad.b;
	if (w <= 0 || h <= 0) return;

	const zs = d.epochs.z;
	const xOf = (z) => {
		const lo = Math.log10(1 + zs[zs.length - 1]);
		const hi = Math.log10(1 + zs[0]);
		return pad.l + w * (1 - (Math.log10(1 + z) - lo) / (hi - lo));
	};

	const log = which === "amplitude";
	const yLo = log ? Math.log10(0.02) : 0;
	const yHi = log ? Math.log10(1.1) : 1.05;
	const yOf = (v) => {
		const t = ((log ? Math.log10(Math.max(v, 1e-6)) : v) - yLo) / (yHi - yLo);
		return pad.t + h * (1 - t);
	};

	frame(ctx, W, H, colours, pad);

	// Gridlines at decade-ish redshifts the reader can name.
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
	const ticks = log ? [0.02, 0.05, 0.1, 0.2, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
	for (const t of ticks) {
		const y = yOf(t);
		ctx.fillText(String(t), pad.l - 6, y + 3);
	}

	for (const side of ["a", "b"]) {
		// point.tag, NOT state.tag: state.tag is null for a cosmology that has not
		// been simulated, but its growth history exists regardless -- that is the
		// whole reason growth is exported for all 18 grid points. Reading
		// state.tag here silently skipped the curve for every pending point, which
		// is 14 of 18 today, and contradicted both the page copy and rule 3 above.
		const g = state[side].point && d.growth[state[side].point.tag];
		if (!g) continue;
		const series = which === "amplitude" ? g.sigma8 : g.f;
		ctx.strokeStyle = colours[side];
		ctx.lineWidth = 1.8;
		// A cosmology that has not been simulated still has an exact growth
		// history, so it is drawn -- dashed, to say the pictures are missing but
		// the physics is not.
		ctx.setLineDash(g.simulated ? [] : [4, 3]);
		ctx.beginPath();
		for (let i = 0; i < zs.length; i++) {
			const x = xOf(zs[i]);
			const y = yOf(series[i]);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();
		ctx.setLineDash([]);
		// "You are here" dot, which is what keeps the chart alive during playback.
		ctx.fillStyle = colours[side];
		ctx.beginPath();
		ctx.arc(xOf(zs[state.i]), yOf(series[state.i]), 3.5, 0, Math.PI * 2);
		ctx.fill();
	}

	ctx.strokeStyle = colours.axis;
	ctx.globalAlpha = 0.6;
	ctx.beginPath();
	ctx.moveTo(xOf(zs[state.i]), pad.t);
	ctx.lineTo(xOf(zs[state.i]), H - pad.b);
	ctx.stroke();
	ctx.globalAlpha = 1;

	axisLabels(
		ctx,
		colours,
		"redshift  (earlier to the left)",
		which === "amplitude" ? "clumpiness  σ₈(z)" : "growth rate  f",
		W,
		H,
		pad,
	);
}

/** P(k), truncated honestly at the shot noise. */
function drawPk(canvas, pk, state, colours) {
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

	axisLabels(ctx, colours, "k  [Mpc⁻¹]   larger scales to the left", "P(k)  [Mpc³]", W, H, pad);
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
		view: VIEWS.some((v) => v.id === urlState.v) ? urlState.v : "growth",
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
	let colours = {};

	/* --- rendering -------------------------------------------------------- */

	const announce = debounce((text) => {
		const live = $("[data-live]");
		if (live) live.textContent = text;
	}, 400);

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
		return `${name}: matter ${fmtOm(s.om)}, dark energy ${w0Label(s.w0)}, redshift ${z.toFixed(2)}. ${look}.`;
	}

	let lastIndex = 0;
	let lastDir = 1;
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
			drawPanel(canvas, bmp, colours, colours[side]);
			canvas.setAttribute("aria-label", describe(side));

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
			if (state.view === "pk") drawPk(chart, pk, state, colours);
			else drawHistory(chart, d, state, colours, state.view);
		}

		const z = d.epochs.z[state.i];
		const readout = $("[data-z-readout]");
		if (readout) readout.textContent = z >= 0.005 ? `z = ${z.toFixed(2)}` : "today";

		const caption = $("[data-caption]");
		if (caption) {
			const same = state.a.tag && state.a.tag === state.b.tag;
			const gA = state.a.point && d.growth[state.a.point.tag];
			const gB = state.b.point && d.growth[state.b.point.tag];
			const age = gA?.tGyr ? `${gA.tGyr[state.i].toFixed(2)} billion years after the Big Bang` : "";
			let txt = z >= 0.005 ? `Redshift ${z.toFixed(2)} — ${age}.` : `Today, ${age}.`;
			if (same) txt += " Both panels are showing the same universe.";
			else if (gA && gB) {
				txt += ` Growth rate f = ${gA.f[state.i].toFixed(2)} on the left, ${gB.f[state.i].toFixed(2)} on the right.`;
			}
			if (state.view === "pk" && pk) {
				const run = state.a.tag && pk.runs[state.a.tag];
				if (run) {
					txt += ` At this epoch only ${run.usableBins[state.i]} of ${pk.k.length} scales rise above the shot noise.`;
				}
			}
			caption.textContent = txt;
		}

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
						setTimeout(play, 400);
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
