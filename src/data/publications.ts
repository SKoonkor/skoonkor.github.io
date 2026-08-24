/**
 * Publications and theses.
 *
 * Deliberately a typed array rather than a content collection: a handful of items
 * with no bodies, no slugs and no detail pages would otherwise mean a markdown
 * file each with empty front matter, to produce one <ol>.
 *
 * Order matters. Citable work leads and anything still in preparation goes last,
 * because Research renders this array as-is and Home takes the first entry that
 * has reached at least "submitted" -- see latestPaper below.
 *
 * Authors are objects rather than a pre-formatted string so that the component
 * renders the emphasis on `self` and this data never needs `set:html`.
 */

export type Author = { name: string; self?: true };

export type Publication = {
	authors: Author[];
	/** Renders a trailing ", et al." after the listed authors. */
	etAl?: boolean;
	title: string;
	venue: string;
	/** Absent while a paper is still in preparation and has no year yet. */
	year?: number;
	/** Omitted once a paper is out. Drives both the label and what Home may feature. */
	status?: "accepted" | "submitted" | "in-preparation";
	links: { label: string; href: string }[];
};

export const papers: Publication[] = [
	{
		authors: [
			{ name: "S. Koonkor", self: true },
			{ name: "C. M. Baugh" },
			{ name: "G. Manzoni" },
			{ name: "D. Navarro-Gironés" },
			{ name: "P. Renard" },
			{ name: "H. Hoekstra" },
			{ name: "H. Hildebrandt" },
			{ name: "E. Gaztañaga" },
			{ name: "J. García-Bellido" },
		],
		etAl: true,
		title: "The PAU Survey: the i-band galaxy luminosity function from the present-day to z = 2",
		venue: "Monthly Notices of the Royal Astronomical Society, 547(3), 1\u201324",
		year: 2026,
		links: [
			{ label: "Journal", href: "https://doi.org/10.1093/mnras/stag362" },
			{ label: "arXiv:2511.16042", href: "https://arxiv.org/abs/2511.16042" },
		],
	},
	{
		authors: [
			{ name: "A. Kumar" },
			{ name: "C. M. Baugh" },
			{ name: "S. Koonkor", self: true },
			{ name: "G. Manzoni" },
			{ name: "S. Panda" },
			{ name: "D. Navarro-Gironés" },
		],
		etAl: true,
		title:
			"The PAU Survey: uncovering the connection between intrinsic and observed galaxy properties using symbolic regression",
		venue: "Monthly Notices of the Royal Astronomical Society",
		year: 2026,
		status: "accepted",
		links: [{ label: "arXiv:2512.13389", href: "https://arxiv.org/abs/2512.13389" }],
	},
	{
		authors: [
			{ name: "G. Manzoni" },
			{ name: "C. M. Baugh" },
			{ name: "P. Norberg" },
			{ name: "L. Cabayol" },
			{ name: "J. L. van den Busch" },
			{ name: "A. Wittje" },
			{ name: "…" },
			{ name: "S. Koonkor", self: true },
		],
		etAl: true,
		title:
			"The PAU Survey: a new constraint on galaxy formation models using the observed colour–redshift relation",
		venue: "Monthly Notices of the Royal Astronomical Society, 530, 1394–1413",
		year: 2024,
		links: [
			{ label: "Journal", href: "https://doi.org/10.1093/mnras/stae659" },
			{ label: "arXiv:2311.10469", href: "https://arxiv.org/abs/2311.10469" },
		],
	},
	{
		authors: [{ name: "S. Koonkor", self: true }, { name: "C. M. Baugh" }],
		etAl: true,
		title:
			"The galaxy spectrum synthesis in cosmological simulation using the principal component analyses",
		venue: "manuscript available on request",
		status: "in-preparation",
		links: [],
	},
];

/**
 * What Home features.
 *
 * `papers[0]` used to be read directly by the page, which meant the front page
 * headlined whatever sat first in the array -- for a while, a paper still in
 * preparation. Deriving it here instead keeps the rule with the data: lead with
 * work that exists, not work that is coming.
 */
export const latestPaper: Publication | undefined = papers.find(
	(p) => p.status !== "in-preparation",
);

export const theses: Publication[] = [
	{
		authors: [{ name: "S. Koonkor", self: true }],
		title:
			"A New Estimate of the Galaxy Luminosity Function, using Machine Learning and a Mock Catalogue",
		venue: "PhD thesis, Durham University",
		year: 2025,
		links: [{ label: "Durham e-Theses", href: "https://etheses.durham.ac.uk/id/eprint/16238/" }],
	},
	{
		authors: [{ name: "S. Koonkor", self: true }],
		title: "Application of Principal Component Analysis to Galaxy Spectral Energy Distributions",
		venue: "MSc by Research thesis, Durham University",
		year: 2020,
		links: [{ label: "Durham e-Theses", href: "https://etheses.durham.ac.uk/13823/" }],
	},
];

/** Where the complete, always-current lists live. */
export const publicationProfiles: { label: string; href: string }[] = [
	{
		label: "NASA ADS",
		href: 'https://ui.adsabs.harvard.edu/search/q=author%3A"Koonkor%2C%20S."',
	},
	{ label: "arXiv", href: "https://arxiv.org/a/koonkor_s_1" },
	{ label: "ORCID", href: "https://orcid.org/0009-0009-9864-4691" },
];
