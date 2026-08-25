/*
 * Shared helpers for the /explore/ demos.
 *
 * Deliberately dependency-free and framework-agnostic: each demo exposes a single
 * init(rootEl, opts) and touches nothing outside its own root, so a demo can later
 * be lifted into a component without rewriting it.
 */

/** Cache-busting suffix. Bump when the data under /data/ changes. */
export const DATA_VERSION = "2026-08";

/**
 * Fetch and parse JSON, with the version tag appended.
 *
 * `signal` is optional but matters wherever a control can be operated faster than
 * the network answers: without it two rapid clicks race, and the slower response
 * wins simply by arriving last, painting data the reader did not ask for.
 */
export async function fetchJSON(url, signal) {
	const r = await fetch(`${url}?v=${DATA_VERSION}`, signal ? { signal } : undefined);
	if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
	return r.json();
}

/** Fetch a binary blob as an ArrayBuffer. */
export async function fetchBuffer(url) {
	const r = await fetch(`${url}?v=${DATA_VERSION}`);
	if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
	return r.arrayBuffer();
}

/**
 * Coalesce rapid calls onto animation frames.
 *
 * Throttled, not debounced: dragging a slider should redraw continuously rather
 * than sit still until the user stops moving.
 */
export function rafThrottle(fn) {
	let pending = false;
	let lastArgs = null;
	return function (...args) {
		lastArgs = args;
		if (pending) return;
		pending = true;
		requestAnimationFrame(() => {
			pending = false;
			fn.apply(this, lastArgs);
		});
	};
}

/** Read the page's URL parameters as a plain object. */
export function readState() {
	const out = {};
	new URLSearchParams(location.search).forEach((v, k) => {
		out[k] = v;
	});
	return out;
}

/**
 * Write state into the URL without adding history entries, so a particular
 * configuration of a demo can be linked to directly (in a talk, or a footnote).
 */
export function writeState(state) {
	const p = new URLSearchParams();
	Object.entries(state).forEach(([k, v]) => {
		if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
	});
	const qs = p.toString();
	history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

/** Size a canvas to its CSS box at device pixel ratio. Returns [cssW, cssH]. */
export function fitCanvas(canvas) {
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	const rect = canvas.getBoundingClientRect();
	const w = Math.max(1, Math.round(rect.width));
	const h = Math.max(1, Math.round(rect.height));
	if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
		canvas.width = w * dpr;
		canvas.height = h * dpr;
	}
	const ctx = canvas.getContext("2d");
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	return [w, h];
}

/** Format a number of years as a short human string. */
export function formatAge(gyr) {
	const yr = gyr * 1e9;
	if (yr < 1e6) return `${Math.round(yr / 1e3)} thousand years`;
	if (yr < 1e9)
		return `${(yr / 1e6) < 10 ? (yr / 1e6).toFixed(1) : Math.round(yr / 1e6)} million years`;
	return `${gyr < 10 ? gyr.toFixed(1) : Math.round(gyr)} billion years`;
}

/** True when the visitor has asked for reduced motion. */
export function prefersReducedMotion() {
	return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Clamp a URL-supplied value to something the data actually contains.
 *
 * Every demo reads its opening state from the query string, which means every
 * demo can be handed a band, a redshift or a cosmology that does not exist.
 */
export function pick(value, allowed, fallback) {
	return allowed.includes(value) ? value : fallback;
}

/**
 * Fill a `[data-chips="<name>"]` host with a keyboard-navigable radio group.
 *
 * NOT the `aria-pressed` toggle-button convention the other two demos use. A
 * radiogroup whose children are `aria-pressed` buttons is invalid ARIA -- a
 * radiogroup's children must be `role="radio"` with `aria-checked` -- and only
 * the real thing gives roving tabindex, where arrow keys move selection and
 * focus together. That behaviour is not a nicety here: it is what turns the
 * mobile A/B switch into a blink comparator, which is a better instrument for
 * spotting differences between two aligned images than showing them side by
 * side. The older convention is left alone; this is additive.
 *
 * `items` are `{ id, label, available? }`. An item with `available: false` still
 * renders, still takes focus and is still selectable -- it is only marked, via
 * `data-avail="no"`. Disabling it would be worse: a disabled control cannot be
 * focused to discover why it is dead, and on a grid that fills in over hours the
 * set of dead controls keeps changing under the reader.
 *
 * Returns `sync()`, which refreshes checked state and availability marking
 * without rebuilding the DOM (and so without destroying focus).
 */
export function buildRadioChips(root, name, items, get, set, onChange) {
	const host = root.querySelector(`[data-chips="${name}"]`);
	if (!host) return () => {};
	host.setAttribute("role", "radiogroup");
	host.replaceChildren();

	const buttons = items.map((item) => {
		const b = document.createElement("button");
		b.type = "button";
		b.className = "demo-chip";
		b.setAttribute("role", "radio");
		b.textContent = item.label;
		b.dataset.value = item.id;
		b.addEventListener("click", () => choose(item.id));
		b.addEventListener("keydown", (ev) => onKey(ev, item.id));
		host.appendChild(b);
		return b;
	});

	function choose(id) {
		if (get() === id) return;
		set(id);
		sync();
		onChange();
	}

	function onKey(ev, id) {
		const ids = items.map((it) => it.id);
		const at = ids.indexOf(id);
		let next = -1;
		if (ev.key === "ArrowRight" || ev.key === "ArrowDown") next = (at + 1) % ids.length;
		else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp")
			next = (at - 1 + ids.length) % ids.length;
		else if (ev.key === "Home") next = 0;
		else if (ev.key === "End") next = ids.length - 1;
		else return;
		ev.preventDefault();
		choose(ids[next]);
		buttons[next].focus();
	}

	function sync(nextItems) {
		const list = nextItems ?? items;
		const current = get();
		list.forEach((item, i) => {
			const b = buttons[i];
			if (!b) return;
			const on = item.id === current;
			b.setAttribute("aria-checked", String(on));
			// Exactly one chip is tabbable, so the group is one tab stop and the
			// arrow keys move within it -- the standard radio contract.
			b.tabIndex = on ? 0 : -1;
			const pending = item.available === false;
			b.dataset.avail = pending ? "no" : "yes";
			// The dashed border is presentation only, so on its own it fails WCAG
			// 1.3.1. Without this a screen-reader user cannot tell which options
			// exist and only finds out by picking one.
			if (pending) b.setAttribute("aria-label", `${item.label}, not computed yet`);
			else b.removeAttribute("aria-label");
		});
	}

	sync();
	return sync;
}

/** Trailing-edge debounce. Used for the live region and the canvas aria-labels. */
export function debounce(fn, ms) {
	let t = 0;
	return (...args) => {
		clearTimeout(t);
		t = setTimeout(() => fn(...args), ms);
	};
}

/* ------------------------------------------------------------------- theme --
 * A canvas cannot inherit CSS, so the drawing colours are handed to it through
 * --demo-* custom properties on the demo root and re-read whenever the theme
 * changes. Shared rather than copied into each demo, because the timing below is
 * subtle enough that a second copy would be a second place to get it wrong.
 */

/**
 * Read a palette from CSS custom properties on `root`.
 *
 * `names` maps the keys you want onto property names, e.g.
 * `{ recon: '--demo-recon' }`. Values are the computed (already var()-resolved)
 * colours, so they follow the active theme.
 */
export function readPalette(root, names, fallbacks = {}) {
	const cs = getComputedStyle(root);
	const out = {};
	for (const [key, prop] of Object.entries(names)) {
		out[key] = cs.getPropertyValue(prop).trim() || fallbacks[key] || "#888";
	}
	return out;
}

/**
 * Keep a canvas in step with the site theme.
 *
 * Returns a teardown function. `apply(palette)` should store the palette and
 * redraw.
 *
 * Sampling once when data-theme flips is NOT enough, and fails in a way that
 * looks like nothing is wrong: the theme tokens are @property-registered colours
 * with a transition on <html>, so at the instant the attribute changes their
 * computed value is still the OLD colour. The canvas repaints in the palette it
 * already had and then never repaints again -- a red plot left on a dark page.
 *
 * A fixed window is not enough either. Measured in headless Chrome, a 360ms loop
 * gave up when the transition had moved about 10 per cent: neither when the
 * transition starts nor how often rAF fires is ours to decide. So watch the
 * resolved colour and stop once it has actually stopped moving. Self-correcting
 * whatever the timing, and with transitions disabled it settles in three frames.
 */
export function followTheme(root, names, apply, fallbacks = {}) {
	let raf = 0;

	const settle = () => {
		cancelAnimationFrame(raf);
		const t0 = performance.now();
		let last = "";
		let stable = 0;
		const step = () => {
			const palette = readPalette(root, names, fallbacks);
			apply(palette);
			const now = Object.values(palette).join("|");
			stable = now === last ? stable + 1 : 0;
			last = now;
			if (stable < 3 && performance.now() - t0 < 2000) {
				raf = requestAnimationFrame(step);
			}
		};
		raf = requestAnimationFrame(step);
	};

	// Both paths matter: the site's toggle stamps data-theme on <html>, and a
	// visitor who has never used it follows the OS setting instead.
	const mo = new MutationObserver(settle);
	mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
	const mq = window.matchMedia("(prefers-color-scheme: dark)");
	mq.addEventListener("change", settle);

	return () => {
		cancelAnimationFrame(raf);
		mo.disconnect();
		mq.removeEventListener("change", settle);
	};
}
