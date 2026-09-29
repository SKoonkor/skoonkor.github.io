/**
 * The course hub at /courses/.
 *
 * One entry per course, each pointing at its own landing page. Only "Gravity from Scratch"
 * exists today; this list is where a second course gets added later. Deliberately separate
 * from src/data/course.ts (singular), which is the older, still-unpublished ML course card
 * shown on /explore/ -- that one is left as it is rather than folded in here.
 */
export type CourseSummary = {
	href: string;
	title: string;
	/** One clause, for the card and for anywhere else a course gets a single line. */
	tagline: string;
	/** Long form, for the hub card. */
	blurb: string;
};

export const courses: CourseSummary[] = [
	{
		href: "/courses/nbody/",
		title: "Gravity from Scratch",
		tagline: "building N-body solvers, from direct summation to the fast multipole method",
		blurb:
			"Eleven lectures that build a dark-matter N-body code from nothing: a double loop of " +
			"Newton's law first, then the integrators, data structures and Fourier methods that " +
			"turn it into something a real simulation could use. Every method is written from " +
			"scratch, with homework and a checker for each lecture.",
	},
];
