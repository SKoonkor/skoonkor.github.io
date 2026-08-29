/*
 * The coverflow under /software/where-did-my-money-go/.
 *
 * A module rather than an inline script, unlike the flat strip it replaces:
 * this has a state machine, two cadences, two intersection observers, a live
 * media query and a transport, and the page should not have to hold all of it.
 *
 * THE STRIP IS STILL A NATIVE SCROLL-SNAP CONTAINER and this never sets
 * scrollLeft except when a button or a key asks it to. All it does is read the
 * scroll position, write two custom properties so the CSS can turn each card,
 * and move one attribute that decides which card is animating. Take this file
 * away and the strip still scrolls, still snaps, and still shows six captioned
 * pictures -- see the note above @property in software.css.
 *
 * Two cadences, and the split is the whole design:
 *
 *   every frame   --d / --a / z-index      purely visual, must follow the finger
 *   on settle     [data-centre], counter   discrete, and expensive to thrash
 *
 * A flick from card one to card six passes four cards on the way. Moving
 * [data-centre] per pass would build and tear down four animations and read
 * four numbers aloud.
 */

/** How long after the last scroll event the strip counts as settled. */
const SETTLE_MS = 180;

/** Decode grace before the first autoplay, so it does not start on a blank. */
const GRACE_MS = 400;

export function init(root) {
	const track = root.querySelector("[data-track]");
	const nav = root.querySelector("[data-nav]");
	const count = root.querySelector("[data-count]");
	const playBtn = root.querySelector("[data-play]");
	const hint = root.querySelector("[data-motion-hint]");
	const slides = [...(track?.querySelectorAll(".demo-slides__slide") ?? [])];
	if (!track || !nav || slides.length === 0) return;

	// Held live and read PER USE, never latched: a reader who turns the OS
	// setting on mid-visit should be obeyed from the next click, not the next
	// reload.
	const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

	const state = { i: -1, playing: false };
	const lastZ = new Array(slides.length).fill(null);
	let raf = 0;
	let settleTimer = 0;
	let graceTimer = 0;

	nav.hidden = false;

	/* ------------------------------------------------- geometry, per frame -- */

	/**
	 * Write each slide's signed distance from the middle, and return the nearest.
	 *
	 * Read/write is strictly two-pass -- every rect first, then every style --
	 * because interleaving them makes each write invalidate the next read and
	 * turns six slides into six forced layouts.
	 *
	 * The rects are of the <li>, which is never transformed; the transform lives
	 * on .demo-slides__card inside it. Measuring the transformed element would
	 * feed its own translate back into its own input.
	 *
	 * `stride` comes from the gap between the first two slides rather than from a
	 * slide's width, so it carries the flex gap without reading computed style,
	 * and --d is therefore in the same unit as the CSS pull.
	 */
	function measure() {
		const box = track.getBoundingClientRect();
		const mid = box.left + box.width / 2;
		const rects = slides.map((el) => el.getBoundingClientRect());
		const stride = rects.length > 1 ? rects[1].left - rects[0].left : rects[0].width;
		let best = 0;
		let bestGap = Number.POSITIVE_INFINITY;

		for (let k = 0; k < slides.length; k++) {
			const gap = rects[k].left + rects[k].width / 2 - mid;
			const d = Math.max(-3, Math.min(3, gap / (stride || 1)));
			const a = Math.min(Math.abs(d), 2);
			slides[k].style.setProperty("--d", d.toFixed(3));
			slides[k].style.setProperty("--a", a.toFixed(3));
			// z-index cannot interpolate, and rewriting it every frame is a style
			// recalc for nothing, so it only moves when the rung changes.
			const z = 10 - Math.min(Math.round(a), 9);
			if (lastZ[k] !== z) {
				slides[k].style.zIndex = String(z);
				lastZ[k] = z;
			}
			if (Math.abs(gap) < bestGap) {
				bestGap = Math.abs(gap);
				best = k;
			}
		}
		return best;
	}

	function paint() {
		const near = measure();
		clearTimeout(settleTimer);
		settleTimer = setTimeout(() => setCentre(near), SETTLE_MS);
	}

	function schedule() {
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(paint);
	}

	/* --------------------------------------------------- the middle, on settle -- */

	/**
	 * Move the animation switch and say the number, once, on a real change.
	 *
	 * Guarding on the INDEX rather than on the counter string is the stronger
	 * form of an earlier fix: assigning textContent is a mutation inside an
	 * aria-live region even when the string is identical, and one smooth scroll
	 * fires 20-40 scroll events, which a screen reader reads back as "3 of 6,
	 * 3 of 6, 3 of 6". Gating the whole branch also means a scroll that ends
	 * where it started neither re-announces nor restarts the card.
	 */
	function setCentre(i) {
		if (i === state.i) return;
		slides[state.i]?.removeAttribute("data-centre");
		state.i = i;
		slides[i]?.setAttribute("data-centre", "");
		if (count) count.textContent = `${i + 1} of ${slides.length}`;
	}

	/* ------------------------------------------------------------ transport -- */

	function setPlaying(on) {
		state.playing = on;
		root.toggleAttribute("data-playing", on);
		// The label changes, so there is deliberately no aria-pressed: "Pause,
		// pressed" is ambiguous about what is currently happening. And no live
		// announcement -- the button's own accessible name changing is the
		// announcement, and the only live region here belongs to the counter.
		if (playBtn) playBtn.textContent = on ? "Pause" : "Play";
	}

	const play = () => setPlaying(true);

	function stop() {
		// Cancel a pending autoplay too: a reader touching the transport is an
		// explicit statement about what they want to happen.
		clearTimeout(graceTimer);
		graceTimer = 0;
		setPlaying(false);
	}

	/**
	 * Moving between cards does NOT stop playback, unlike the transport in
	 * structure-growth.js -- and it does not need to, because this strip never
	 * advances on its own. Choosing a card is not taking the clock; it is
	 * choosing which card the clock runs.
	 */
	function go(i) {
		slides[Math.max(0, Math.min(slides.length - 1, i))]?.scrollIntoView({
			behavior: reduce.matches ? "auto" : "smooth",
			inline: "center",
			block: "nearest",
		});
	}

	/* --------------------------------------------------------------- wiring -- */

	track.addEventListener("scroll", schedule, { passive: true });
	// The end spacers are half the container wide, so a resize moves every card's
	// distance from the middle without a single scroll event firing.
	new ResizeObserver(schedule).observe(track);

	nav.querySelector("[data-prev]")?.addEventListener("click", () => go(state.i - 1));
	nav.querySelector("[data-next]")?.addEventListener("click", () => go(state.i + 1));
	playBtn?.addEventListener("click", () => (state.playing ? stop() : play()));

	// Chrome gives a scroll container keyboard scrolling for free; Safari does
	// not, so the arrow keys are handled rather than assumed.
	track.addEventListener("keydown", (ev) => {
		if (ev.key === "ArrowRight") go(state.i + 1);
		else if (ev.key === "ArrowLeft") go(state.i - 1);
		else if (ev.key === "Home") go(0);
		else if (ev.key === "End") go(slides.length - 1);
		else return;
		ev.preventDefault();
	});

	document.addEventListener("visibilitychange", () => {
		// Pause when hidden; do NOT auto-resume, which would be motion the reader
		// did not ask for on a tab they have just returned to.
		if (document.hidden) stop();
	});

	reduce.addEventListener("change", () => {
		// Turning it on stops everything immediately. Turning it off does not
		// start anything: the same rule, in the same direction, both ways.
		if (reduce.matches) {
			stop();
			if (hint) hint.hidden = false;
		} else if (hint) {
			hint.hidden = true;
		}
	});

	/* -------------------------------------------------------------- opening -- */

	// Synchronously, before anything scrolls: without this the first card has no
	// [data-centre], and switching [data-playing] on would run nothing.
	setCentre(measure());

	if (reduce.matches) {
		// Reduced motion means "nothing moves unbidden", not "no strip": the Play
		// button stays fully functional, it just is not pressed for the reader.
		if (hint) hint.hidden = false;
		return;
	}

	const seen = new IntersectionObserver(
		(entries) => {
			for (const e of entries) {
				if (e.intersectionRatio >= 0.35) {
					seen.disconnect();
					graceTimer = setTimeout(play, GRACE_MS);
				}
			}
		},
		{ threshold: [0.35] },
	);
	seen.observe(track);

	// Stop once the strip is essentially gone, so nothing animates on a screen
	// nobody is looking at. Resuming on return is fine here and not the thing
	// visibilitychange guards against: the reader scrolled it back into view.
	const watch = new IntersectionObserver(
		(entries) => {
			for (const e of entries) {
				if (e.intersectionRatio < 0.15 && state.playing) setPlaying(false);
			}
		},
		{ threshold: [0.15] },
	);
	watch.observe(track);
}
