/**
 * The CV, as structured data rather than a content collection: thirteen rows
 * with no bodies and no detail pages. Keeping it typed also makes the print
 * stylesheet and any future PDF generation straightforward.
 */

export type CVEntry = {
	role: string;
	org?: string;
	/** Extra lines under the role: thesis titles, duties, award citations. */
	detail?: string[];
	/** Makes the role a link, e.g. to a thesis record. */
	href?: string;
	period: string;
	badge?: "Award" | "Scholarship";
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
				period: "Jul 2025 – Sep 2025",
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
				role: "MSc by Research in Astrophysics",
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
		group: "Teaching Experience",
		entries: [
			{
				role: "Level 1 Introduction to Astronomy",
				org: "Undergraduate Teaching Assistant, Durham University, UK",
				detail: ["Graded assignments"],
				period: "2021 – 2024",
			},
			{
				role: "Level 1 and Level 2 Scientific Computing Workshop",
				org: "Undergraduate Teaching Assistant, Durham University, UK",
				detail: ["Guided weekly assignments and graded assignments"],
				period: "2022 – 2023",
			},
			{
				role: "Introduction to Scientific and High-Performance Computing",
				org: "Postgraduate Teaching Assistant, Durham University, UK",
				detail: ["Guided weekly assignments and graded assignments"],
				period: "2022",
			},
		],
	},
	{
		group: "Scholarships & Awards",
		entries: [
			{
				role: "Ogden Outreach Award",
				badge: "Award",
				detail: [
					"Postgraduate ambassador award, for my contribution to physics outreach.",
				],
				period: "2023",
			},
			{
				role: "OCSC Scholarship",
				badge: "Scholarship",
				detail: [
					"Full financial support for postgraduate study, from the Office of the Civil Service Commission of Thailand.",
				],
				period: "2017 – 2024",
			},
			{
				role: "DPST Scholarship",
				badge: "Scholarship",
				detail: [
					"Fully-funded scholarship for a bachelor's degree in science, from the Development and Promotion of Science and Technology Talents Project.",
				],
				period: "2014 – 2018",
			},
			{
				role: "The 13th Conference on Science and Technology for Youths",
				badge: "Award",
				detail: ["Best Oral Presentation, for the research project presentation."],
				period: "2018",
			},
			{
				role: "Young Thai Science Ambassador",
				org: "National Science Museum, Thailand",
				badge: "Award",
				detail: ["Excellent science ambassador award, as part of a two-person team."],
				period: "2015",
			},
		],
	},
];

/**
 * Drop a PDF at this path in public/ and the download button appears
 * automatically. Absent for now.
 */
export const cvPdfPath = "/cv/Koonkor_CV.pdf";
