/*
 * Scroll-driven cosmic web in the page margins.
 *
 * Payload is 90 AVIF frames at ~19 KB each. The binding constraint is not the
 * download but the decode: an ImageBitmap costs width x height x 4 bytes
 * whatever the source format, so decoding all 90 at 960x1080 would be ~356 MB.
 * Enough to get a tab killed on iOS.
 *
 * So two tiers:
 *   0. one proxy atlas, decoded once and kept resident (~11 MB). The bands are
 *      never blank, even mid-fling.
 *   1. a rolling window of sharp frames around the current index, biased in the
 *      direction of travel, with close() on eviction. ~47 MB.
 *
 * Scroll coupling is a passive listener that kicks a self-terminating rAF loop.
 * The loop lerps toward the target and stops once settled, so a reader who is
 * not scrolling costs nothing.
 */

const BASE = "/cosmic-web";
/** Bump when the frames are regenerated. Same idiom as DATA_VERSION. */
const FRAME_VERSION = "2026-08";

/** Below this there is no margin to draw into. Checked before any fetch. */
const MIN_WIDTH = 1100;
const MIN_HEIGHT = 600;

/** Sharp frames kept decoded at once. 12 x ~4 MB ~= 47 MB. */
const WINDOW = 12;
/** Lerp factor per frame toward the scroll target. */
const EASE = 0.18;
/** Above this many frames of travel, snap instead of easing (anchor jumps). */
const SNAP_FRAMES = 12;

interface Manifest {
	frames: number;
	proxyFrames: number;
	packedWidth: number;
	stripHeight: number;
	proxyWidth: number;
	proxyHeight: number;
}

type Band = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; half: 0 | 1 };

/** Whether this visitor should get the animation at all. */
function shouldRun(): boolean {
	if (!window.matchMedia(`(min-width: ${MIN_WIDTH}px)`).matches) return false;
	if (!window.matchMedia(`(min-height: ${MIN_HEIGHT}px)`).matches) return false;
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;

	// Chromium-only, so opportunistic rather than load-bearing.
	const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
		.connection;
	if (conn?.saveData) return false;
	if (conn?.effectiveType && ["slow-2g", "2g"].includes(conn.effectiveType)) return false;
	const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
	if (typeof mem === "number" && mem < 4) return false;

	return true;
}

export async function initCosmicBands(): Promise<void> {
	const leftEl = document.querySelector<HTMLCanvasElement>("[data-cw-left]");
	const rightEl = document.querySelector<HTMLCanvasElement>("[data-cw-right]");
	if (!leftEl || !rightEl) return;
	if (!shouldRun()) return;

	let manifest: Manifest;
	try {
		const res = await fetch(`${BASE}/manifest.json?v=${FRAME_VERSION}`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		manifest = (await res.json()) as Manifest;
	} catch {
		// The CSS static frame is already showing. Nothing more to do.
		return;
	}

	const bands: Band[] = [
		{ canvas: leftEl, ctx: leftEl.getContext("2d")!, half: 0 },
		{ canvas: rightEl, ctx: rightEl.getContext("2d")!, half: 1 },
	];
	// Once the canvas has something in it, drop the CSS fallback so the two are
	// not composited on top of each other at differing opacities.
	let painted = false;

	const N = manifest.frames;
	const blobs: (Blob | undefined)[] = new Array(N);
	const sharp = new Map<number, ImageBitmap>();
	const pending = new Set<number>();
	let proxy: ImageBitmap | null = null;

	/* ---------------------------------------------------------------- assets */

	const frameUrl = (i: number) =>
		`${BASE}/f${String(i).padStart(3, "0")}.avif?v=${FRAME_VERSION}`;

	async function loadProxy() {
		try {
			const res = await fetch(`${BASE}/atlas.avif?v=${FRAME_VERSION}`);
			if (!res.ok) return;
			proxy = await createImageBitmap(await res.blob());
			schedule();
		} catch {
			/* the static CSS frame remains */
		}
	}

	async function ensureSharp(i: number) {
		if (i < 0 || i >= N || sharp.has(i) || pending.has(i)) return;
		pending.add(i);
		try {
			let blob = blobs[i];
			if (!blob) {
				const res = await fetch(frameUrl(i));
				if (!res.ok) return;
				blob = await res.blob();
				blobs[i] = blob;
			}
			const bmp = await createImageBitmap(blob);
			if (sharp.has(i)) {
				bmp.close();
			} else {
				sharp.set(i, bmp);
				schedule();
			}
		} catch {
			/* fall back to the proxy for this index */
		} finally {
			pending.delete(i);
		}
	}

	/** Keep a window around `centre`, biased toward the direction of travel. */
	function reconcileWindow(centre: number, dir: number) {
		const ahead = dir >= 0 ? WINDOW - 3 : 3;
		const lo = Math.max(0, Math.round(centre) - (WINDOW - ahead));
		const hi = Math.min(N - 1, Math.round(centre) + ahead);

		for (const [i, bmp] of sharp) {
			if (i < lo || i > hi) {
				// close() is not optional: dropping the reference does not promptly
				// release the backing memory.
				bmp.close();
				sharp.delete(i);
			}
		}
		for (let i = Math.round(centre); i <= hi; i++) void ensureSharp(i);
		for (let i = Math.round(centre) - 1; i >= lo; i--) void ensureSharp(i);
	}

	/* ---------------------------------------------------------------- render */

	function fit(band: Band) {
		const r = band.canvas.getBoundingClientRect();
		const w = Math.max(1, Math.round(r.width));
		const h = Math.max(1, Math.round(r.height));
		// Backing store at CSS size x 1, not devicePixelRatio. The source is
		// already being upscaled; 2x would quadruple fill cost for no visible gain.
		if (band.canvas.width !== w || band.canvas.height !== h) {
			band.canvas.width = w;
			band.canvas.height = h;
		}
		return { w, h };
	}

	/** Draw one half of a packed frame so it covers the band, centre-cropped. */
	function drawHalf(
		band: Band,
		src: CanvasImageSource,
		srcW: number,
		srcH: number,
		w: number,
		h: number,
		alpha: number,
	) {
		const halfW = srcW / 2;
		const sx0 = band.half === 0 ? 0 : halfW;
		// cover: scale so the band is filled, then centre the overflow.
		const scale = Math.max(w / halfW, h / srcH);
		const dw = halfW * scale;
		const dh = srcH * scale;
		// Anchor the outer edge, so the fade toward the text never reveals a gap.
		const dx = band.half === 0 ? 0 : w - dw;
		const dy = (h - dh) / 2;
		band.ctx.globalAlpha = alpha;
		band.ctx.drawImage(src, sx0, 0, halfW, srcH, dx, dy, dw, dh);
		band.ctx.globalAlpha = 1;
	}

	function drawProxyFrame(band: Band, idx: number, w: number, h: number, alpha: number) {
		if (!proxy) return;
		const { proxyWidth: pw, proxyHeight: ph, proxyFrames: pn } = manifest;
		const row = Math.min(pn - 1, Math.max(0, Math.round((idx / (N - 1)) * (pn - 1))));
		const halfW = pw / 2;
		const sx0 = band.half === 0 ? 0 : halfW;
		const scale = Math.max(w / halfW, h / ph);
		const dw = halfW * scale;
		const dh = ph * scale;
		const dx = band.half === 0 ? 0 : w - dw;
		const dy = (h - dh) / 2;
		band.ctx.globalAlpha = alpha;
		band.ctx.drawImage(proxy, sx0, row * ph, halfW, ph, dx, dy, dw, dh);
		band.ctx.globalAlpha = 1;
	}

	function render(pos: number) {
		const i0 = Math.floor(pos);
		const i1 = Math.min(N - 1, i0 + 1);
		const t = pos - i0;
		const a = sharp.get(i0);
		const b = sharp.get(i1);

		for (const band of bands) {
			const { w, h } = fit(band);
			band.ctx.clearRect(0, 0, w, h);

			// Proxy underneath, always. Sharp frames overdraw it when ready, so a
			// missing decode degrades in resolution rather than going blank.
			drawProxyFrame(band, pos, w, h, 1);

			const sw = manifest.packedWidth;
			const sh = manifest.stripHeight;
			if (a) drawHalf(band, a, sw, sh, w, h, 1);
			// Crossfade into the next frame. With 90 frames over a long page this is
			// what stops ~45px of scroll per frame reading as a stutter.
			if (b && t > 0.001 && b !== a) drawHalf(band, b, sw, sh, w, h, t);
		}

		if (!painted && (a || proxy)) {
			painted = true;
			for (const band of bands) band.canvas.style.backgroundImage = "none";
		}
	}

	/* ------------------------------------------------------------ scrolling */

	function progress(): number {
		const range = document.documentElement.scrollHeight - window.innerHeight;
		// A page shorter than the viewport has no scroll range. Show the present
		// day rather than dividing by zero and rendering NaN.
		if (range <= 1) return 1;
		return Math.min(1, Math.max(0, window.scrollY / range));
	}

	let target = progress() * (N - 1);
	let current = target;
	let running = false;
	let lastDir = 1;

	function tick() {
		const next = progress() * (N - 1);
		lastDir = Math.sign(next - target) || lastDir;
		target = next;

		const d = target - current;
		current = Math.abs(d) > SNAP_FRAMES ? target : current + d * EASE;

		reconcileWindow(current, lastDir);
		render(current);

		if (Math.abs(target - current) > 0.01) {
			requestAnimationFrame(tick);
		} else {
			running = false;
		}
	}

	function schedule() {
		if (running) return;
		running = true;
		requestAnimationFrame(tick);
	}

	/* ------------------------------------------------------------- lifecycle */

	let resizeRaf = 0;
	const onResize = () => {
		if (resizeRaf) return;
		resizeRaf = requestAnimationFrame(() => {
			resizeRaf = 0;
			// Crossing the breakpoint means tearing down rather than redrawing.
			if (!window.matchMedia(`(min-width: ${MIN_WIDTH}px)`).matches) {
				teardown();
				return;
			}
			schedule();
		});
	};

	function teardown() {
		for (const bmp of sharp.values()) bmp.close();
		sharp.clear();
		proxy?.close();
		proxy = null;
		window.removeEventListener("scroll", schedule);
		window.removeEventListener("resize", onResize);
		document.removeEventListener("visibilitychange", onVisibility);
	}

	const onVisibility = () => {
		if (!document.hidden) schedule();
	};

	window.addEventListener("scroll", schedule, { passive: true });
	window.addEventListener("resize", onResize, { passive: true });
	document.addEventListener("visibilitychange", onVisibility);
	// scrollY is restored *after* listeners re-attach on a back-navigation.
	window.addEventListener("pageshow", schedule);

	await loadProxy();
	reconcileWindow(current, 1);
	schedule();
}
