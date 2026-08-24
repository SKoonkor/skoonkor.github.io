/**
 * The CV, as structured data rather than a content collection: entries with no
 * bodies and no detail pages. Keeping it typed also makes the print stylesheet
 * and the LaTeX build straightforward.
 *
 * Source of truth is Design_materials/Koonkor_CV_main.tex. Deliberately omitted
 * from the public page: the personal phone number, and referees' emails, office
 * numbers and direct lines. Referees appear by name and institution only.
 */

export type CVEntry = {
	role: string;
	org?: string;
	/** Extra lines under the role: thesis titles, duties, award citations. */
	detail?: string[];
	/** Makes the role a link, e.g. to a thesis record. */
	href?: string;
	period: string;
	badge?: "Award" | "Scholarship" | "Talk" | "Poster" | "Attendee";
};

export const contact = {
	institution: "National Astronomical Research Institute of Thailand (NARIT)",
	address: "260 Moo 4, Don Kaew, Mae Rim, Chiang Mai 50180, Thailand",
	email: "suttikoon@narit.or.th",
	github: "https://github.com/SKoonkor",
	orcid: "https://orcid.org/0009-0009-9864-4691",
};

export const cv: { group: string; entries: CVEntry[] }[] = [
	{
		group: "Work Experience",
		entries: [
			{
				role: "Postdoctoral Researcher",
				org: "National Astronomical Research Institute of Thailand (NARIT)",
				period: "Oct 2025 – Present",
			},
			{
				role: "Research Assistant",
				org: "National Astronomical Research Institute of Thailand (NARIT)",
				period: "Jul – Sep 2025",
			},
		],
	},
	{
		group: "Education",
		entries: [
			{
				role: "PhD in Astrophysics",
				org: "Durham University, UK",
				detail: [
					"Thesis: A New Estimate of the Galaxy Luminosity Function, using Machine Learning and a Mock Catalogue",
				],
				href: "https://etheses.durham.ac.uk/id/eprint/16238/",
				period: "2021 – 2025",
			},
			{
				role: "MSc by Research in Physics",
				org: "Durham University, UK",
				detail: [
					"Thesis: Application of Principal Component Analysis to Galaxy Spectral Energy Distributions",
				],
				href: "https://etheses.durham.ac.uk/13823/",
				period: "2019 – 2020",
			},
			{
				role: "BSc in Physics",
				org: "Khon Kaen University, Thailand",
				detail: ["Thesis: Halo Mass Function in Dark Energy Models"],
				period: "2014 – 2018",
			},
		],
	},
	{
		group: "Scholarships & Awards",
		entries: [
			{
				role: "Ogden Outreach Award",
				badge: "Award",
				detail: ["A postgraduate ambassador, for contributing to physics outreach."],
				period: "2023",
			},
			{
				role: "The Civil Service Commission of Thailand Postgraduate Scholarship",
				badge: "Scholarship",
				detail: ["Full financial support for postgraduate study."],
				period: "2018 – 2024",
			},
			{
				role: "The Development and Promotion of Science and Technology Talents Project",
				badge: "Scholarship",
				detail: ["A fully-funded scholarship for a bachelor's degree in science."],
				period: "2014 – 2018",
			},
			{
				role: "The 13th Conference on Science and Technology for Youths",
				badge: "Award",
				detail: [
					"Best Oral Presentation in Astrophysics and High Energy Physics research.",
				],
				period: "2018",
			},
		],
	},
	{
		group: "Conferences & Workshops",
		entries: [
			{ role: "Deep Learning for Physics (DELPHYS2025)", badge: "Attendee", period: "Dec 2025" },
			{ role: "Space Astronomy Science Platforms Focus Week", badge: "Attendee", period: "Dec 2025" },
			{
				role: "WE-Heraeus and NARIT Cosmology School 2025 — Galaxies and Beyond",
				badge: "Talk",
				period: "Oct 2025",
			},
			{
				role: "HSC Medium-band Survey Science Community Workshop",
				badge: "Poster",
				period: "Aug 2025",
			},
			{
				role: "Durham-Edinburgh eXtragalactic (DEX) Workshop XX",
				badge: "Talk",
				period: "Jan 2024",
			},
			{ role: "Building Galaxies from Scratch 2024", badge: "Poster", period: "Feb 2024" },
			{
				role: "Carl-Zeiss-Stiftung Summer School on Scientific ML for Astrophysics 2023",
				badge: "Attendee",
				period: "Aug 2023",
			},
			{
				role: "First Thai-CTA Workshop on Astroparticle Physics",
				badge: "Attendee",
				period: "Feb 2019",
			},
		],
	},
	{
		group: "Teaching & Mentoring",
		entries: [
			{
				role: "Research-based Outreach",
				org: "NARIT",
				detail: [
					"Mentored high school students (projects: simple ML image classification and N-body simulations).",
				],
				period: "Nov 2025 – Jun 2026",
			},
			{
				role: "Master's Research",
				org: "Durham University",
				detail: [
					"Mentored a Master's student (A. Kumar) on his research using the mock galaxy catalogue.",
				],
				period: "Feb – Dec 2024",
			},
			{
				role: "Level 1 Introduction to Astronomy",
				org: "Durham University",
				detail: ["Undergraduate Teaching Assistant"],
				period: "Sep 2021 – Mar 2022, Sep 2023 – Mar 2024",
			},
			{
				role: "Level 1 and Level 2 Scientific Computing Workshop",
				org: "Durham University",
				detail: ["Undergraduate Teaching Assistant"],
				period: "Sep 2022 – Mar 2023",
			},
			{
				role: "Introduction to Scientific and High-Performance Computing",
				org: "Durham University",
				detail: ["Postgraduate Teaching Assistant"],
				period: "Sep – Nov 2022",
			},
		],
	},
];

/**
 * Public engagement. Rendered on both /cv/ and /outreach/ from this one array,
 * so the two pages cannot drift apart.
 */
export const outreach: CVEntry[] = [
	{
		role: "Astronomy for All",
		org: "NARIT & Lopburi School for the Blind",
		period: "Feb 2026",
	},
	{
		role: "Research-based Outreach",
		org: "Mentoring two high school students",
		period: "Nov 2025 – Present",
	},
	{
		role: "MOrning Coffee Hurried ArXiv (MOCHA)",
		org: "Founder of a weekly astrophysics journal club",
		period: "Oct 2025 – Present",
	},
	{
		role: "The Space Investigators",
		org: "Led the main interactive software development",
		period: "Mar – Sep 2024",
	},
	{ role: "Durham University Open Days", period: "Sep 2024" },
	{ role: "The Royal Society Exhibition at Jodrell Bank Observatory", period: "Aug 2024" },
	{ role: "The Ukrainian Summer School", period: "Aug 2024" },
	{ role: "Annual Schools' Physicist of the Year", period: "Jul 2022, Jun 2023, Jun 2024" },
	{ role: "STEAM Live Primary Career Fair", period: "Jun 2024" },
	{ role: "The Durham Schools' Science Festival", period: "Mar 2024" },
	{ role: "Celebrate Science", period: "Oct 2022, Nov 2023" },
	{ role: "Summer Science Exhibition Lates at the Royal Society", period: "Jul 2023" },
	{ role: "Post-Offer Visit Days", period: "Mar 2023" },
	{ role: "Astronomy Camps and Activities", org: "300+ hours", period: "2014 – 2017" },
];

export const skills: { label: string; items: string }[] = [
	{ label: "Computing", items: "Python, Fortran, LaTeX, SQL, HTML, SAOImageDS9" },
	{
		label: "Soft skills",
		items: "International collaboration, public speaking, technical writing, adaptability",
	},
	{ label: "Languages", items: "Thai (native), English (proficient), German (basic)" },
	{
		label: "Research areas",
		items: "Galaxy formation and evolution, large scale structure, machine learning in astrophysics",
	},
];

/** Names and institutions only. Contact details are on the PDF, on request. */
export const referees: { name: string; role: string; org: string }[] = [
	{
		name: "Prof. Carlton Baugh",
		role: "PhD supervisor",
		org: "Institute for Computational Cosmology, Durham University",
	},
	{
		name: "Asst. Prof. Wiphu Rujopakarn",
		role: "Postdoctoral supervisor",
		org: "National Astronomical Research Institute of Thailand",
	},
];

/**
 * Drop a PDF at this path in public/ and the download button appears
 * automatically. Built by tools/build_cv.sh from cv/Koonkor_CV.tex.
 */
export const cvPdfPath = "/cv/Koonkor_CV.pdf";
