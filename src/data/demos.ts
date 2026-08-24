/**
 * The interactive demos under /explore/.
 *
 * One list, read by both the hub at /explore/ and the Explore section on Home.
 * They used to be written out separately in each page, which is the same trap
 * the publications list fell into: two hand-kept copies that drift.
 *
 * A demo with no `href` is not built yet. It shows on the hub as "coming soon"
 * and does not appear on Home at all -- see `liveDemos`.
 */

export type Demo = {
	/** Absent until the demo exists. */
	href?: string;
	title: string;
	/** Long form, for the hub card. */
	blurb: string;
	/** One clause, for the single line Home gives each demo. */
	tagline?: string;
};

export const demos: Demo[] = [
	{
		href: "/explore/pca-sed/",
		title: "Rebuilding starlight",
		blurb:
			"The spectrum of a billion stars takes over a thousand numbers to write down. Find out how few you really need — and why that matters for simulating a universe.",
		tagline: "how few numbers does a galaxy's spectrum really need?",
	},
	{
		href: "/explore/galaxy-lf/",
		title: "Counting galaxies",
		blurb:
			"How many galaxies of each brightness does the Universe contain, and how has that changed over the last three quarters of cosmic time?",
		tagline: "how many galaxies of each brightness are out there?",
	},
	{
		title: "Weighing dark matter",
		blurb:
			"Dark matter clumps into halos. Counting how many of each mass exist is a way to test what dark energy is doing.",
	},
];

/**
 * What Home lists. Only demos that exist: a front page should not advertise a
 * link a reader cannot follow.
 */
export const liveDemos = demos.filter((d) => d.href);
