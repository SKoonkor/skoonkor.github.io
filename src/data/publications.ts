/**
 * Publications and theses.
 *
 * Deliberately a typed array rather than a content collection: five items with
 * no bodies, no slugs and no detail pages would otherwise mean five markdown
 * files with empty front matter, to produce one <ol>.
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
	year: number;
	status?: "accepted" | "submitted";
	links: { label: string; href: string }[];
};

export const papers: Publication[] = [
	{
		authors: [{ name: "S. Koonkor", self: true }, { name: "C. M. Baugh" }],
		etAl: true,
		title:
			"The galaxy spectrum synthesis in cosmological simulation using the principal component analyses",
		venue: "In preparation; manuscript available on request",
		year: 2026,
		links: [],
	},
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
		title:
			"The PAU Survey: the i-band galaxy luminosity function from the present-day to z = 2",
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
];

export const theses: Publication[] = [
	{
		authors: [{ name: "S. Koonkor", self: true }],
		title:
			"A New Estimate of the Galaxy Luminosity Function, using Machine Learning and a Mock Catalogue",
		venue: "PhD thesis, Durham University",
		year: 2025,
		links: [
			{ label: "Durham e-Theses", href: "https://etheses.durham.ac.uk/id/eprint/16238/" },
		],
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
