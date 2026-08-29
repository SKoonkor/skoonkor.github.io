/**
 * The software projects under /software/.
 *
 * Same shape and the same reasons as src/data/demos.ts: one list, read by the
 * hub and by anything else that wants to name a project, so a title or a
 * tagline exists in exactly one place rather than in two that drift.
 *
 * A project with no `href` has no page yet. It shows on the hub as "coming
 * soon" and is excluded from `liveProjects`.
 *
 * Kept separate from demos.ts rather than merged with a `kind` field. The two
 * lists answer different questions -- "which bit of my research can you play
 * with" and "what have I built" -- and the pages that read them share no
 * markup, only stylesheet.
 */

export type SoftwareProject = {
	/** Absent until the project has a page here. */
	href?: string;
	title: string;
	/** Long form, for the hub card. Trimmed to clear the 5.25rem thumbnail. */
	blurb: string;
	/** One clause, for anywhere a project gets a single line. */
	tagline?: string;
	/**
	 * Slug of the card thumbnail, built by tools/build_thumbnails.py. Absent
	 * means no picture -- the card still works, it just has no square.
	 */
	thumb?: string;
	/** What it is written in. One line on the card, not a badge cloud. */
	stack?: string;
	/** Source. External, opens in a new tab. */
	repo?: string;
	/** A running copy of the thing itself, where one exists. */
	live?: string;
};

export const software: SoftwareProject[] = [
	{
		href: "/software/where-did-my-money-go/",
		thumb: "where-did-my-money-go",
		title: "Where did my money go?",
		blurb:
			"A running balance instead of a pie chart, and a projection forty years long. Six of its screens.",
		tagline: "a running balance, and a projection forty years long",
		stack: "React 19 · TypeScript · Dexie · offline PWA",
		repo: "https://github.com/SKoonkor/WhereDidMyMoneyGo",
		live: "https://skoonkor.github.io/WhereDidMyMoneyGo/",
	},
];

/**
 * What a listing outside /software/ should show. Only projects that exist: no
 * page should advertise a link a reader cannot follow.
 */
export const liveProjects = software.filter((p) => p.href);
