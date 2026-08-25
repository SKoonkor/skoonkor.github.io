/*
 * A bounded cache of decoded animation frames.
 *
 * Modelled on the one inside src/scripts/cosmic-bands.ts, deliberately NOT shared
 * with it. The overlap is about forty lines and the requirements diverge: the
 * bands need a proxy atlas, fractional-position crossfades, a packed two-halves-
 * per-file layout and a scroll-driven clock, while this needs per-tag cache sets,
 * eager byte prefetch and integer positions. A shared module would grow a flag per
 * difference and end up worse than two clear files. See also: cosmic-bands.ts.
 *
 * The asymmetry the design turns on: BYTES ARE CHEAP, DECODES ARE NOT. One frame
 * is ~24 KB compressed and 1 MB decoded (512 x 512 x 4). So compressed blobs are
 * fetched eagerly and kept for the life of the page -- 39 of them is under a
 * megabyte -- while decoded ImageBitmaps are held in a small sliding window.
 *
 * bmp.close() on eviction is mandatory, not tidiness. Dropping the reference does
 * not promptly release the backing store, and an unbounded set of these is what
 * gets a tab killed on iOS.
 */

/** Frames kept decoded per cache. 12 x 1 MB = 12 MB; two panels is 24 MB. */
const WINDOW = 12;
/** Halved when the device admits to being small. */
const WINDOW_SMALL = 8;
/** Parallel fetches during the eager blob sweep. */
const FETCH_CONCURRENCY = 6;

/** Frames version, independent of DATA_VERSION: images and JSON change apart. */
export const FRAME_VERSION = "2026-08";

function defaultWindow() {
	const mem = navigator.deviceMemory;
	return typeof mem === "number" && mem < 4 ? WINDOW_SMALL : WINDOW;
}

/**
 * @param count  number of frames
 * @param url    (i) => string
 * @param onReady called when a frame decodes, so the caller can repaint
 */
export function createFrameCache({ count, url, window: win, onReady }) {
	const size = win ?? defaultWindow();
	// Every fetch this cache issues is cancellable. Without it, clicking through
	// six cosmologies leaves six live 39-frame sweeps queued against a ~6-per-host
	// browser cap, and the frames for the panel actually on screen go to the BACK
	// of that queue -- the panels stay blank while runs nobody is looking at
	// download.
	const ac = new AbortController();
	/** Compressed bytes. Dense, never evicted. */
	const blobs = new Array(count);
	/** Decoded frames. This is the memory that matters. */
	const sharp = new Map();
	/** In-flight guard, so a frame is never fetched or decoded twice. */
	const pending = new Set();
	let dead = false;
	/** Latched on the first failure: a missing run should not retry 39 times. */
	let broken = false;

	async function ensure(i) {
		if (dead || broken || i < 0 || i >= count || sharp.has(i) || pending.has(i)) return;
		pending.add(i);
		try {
			let blob = blobs[i];
			if (!blob) {
				const res = await fetch(url(i), { signal: ac.signal });
				if (!res.ok) {
					// One 404 means the whole run is unpublished, not this one frame.
					if (res.status === 404) broken = true;
					return;
				}
				blob = await res.blob();
				blobs[i] = blob;
			}
			const bmp = await createImageBitmap(blob);
			// Between the await above and here another call may have won the race.
			// Two ImageBitmaps for one index would leak the loser.
			if (dead || sharp.has(i)) {
				bmp.close();
			} else {
				sharp.set(i, bmp);
				onReady?.(i);
			}
		} catch {
			broken = true;
		} finally {
			pending.delete(i);
		}
	}

	/**
	 * Keep a window around `centre`, biased toward travel, and close the rest.
	 *
	 * Forward playback keeps 9 ahead and 3 behind, which at 9 fps is a full second
	 * of decode buffer in the direction the reader is actually going.
	 */
	function reconcile(centre, dir = 1) {
		if (dead) return;
		const ahead = dir >= 0 ? size - 3 : 3;
		const lo = Math.max(0, centre - (size - ahead));
		const hi = Math.min(count - 1, centre + ahead);
		for (const [i, bmp] of sharp) {
			if (i < lo || i > hi) {
				bmp.close();
				sharp.delete(i);
			}
		}
		for (let i = centre; i <= hi; i++) void ensure(i);
		for (let i = centre - 1; i >= lo; i--) void ensure(i);
	}

	/**
	 * Fetch every frame's bytes, a few at a time.
	 *
	 * Once this finishes, scrubbing and playback never touch the network again and
	 * memory stays bounded by the decode window alone.
	 */
	async function prefetchAll() {
		let next = 0;
		const worker = async () => {
			while (!dead && !broken) {
				const i = next++;
				if (i >= count) return;
				if (blobs[i]) continue;
				try {
					const res = await fetch(url(i), { signal: ac.signal });
					if (!res.ok) {
						if (res.status === 404) broken = true;
						return;
					}
					blobs[i] = await res.blob();
				} catch {
					return;
				}
			}
		};
		await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
	}

	/**
	 * The decoded frame at `i`, or the nearest one that is decoded, or null.
	 *
	 * Dragging the slider quickly outruns the decoder. Showing a neighbour is far
	 * better than blanking: at 39 frames the nearest decoded one is visually close,
	 * and the panel keeps moving instead of flickering to empty.
	 */
	function get(i) {
		const exact = sharp.get(i);
		if (exact) return exact;
		for (let d = 1; d < count; d++) {
			const lo = sharp.get(i - d);
			if (lo) return lo;
			const hi = sharp.get(i + d);
			if (hi) return hi;
		}
		return null;
	}

	function destroy() {
		dead = true;
		ac.abort();
		for (const bmp of sharp.values()) bmp.close();
		sharp.clear();
		blobs.length = 0;
	}

	return {
		get,
		ensure,
		reconcile,
		prefetchAll,
		destroy,
		/** True once a fetch has 404'd: the caller shows "not published yet". */
		get failed() {
			return broken;
		},
		/** For the memory assertions in the verification pass. */
		get decoded() {
			return sharp.size;
		},
	};
}
