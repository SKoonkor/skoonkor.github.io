/**
 * The full lecture roster for "Gravity from Scratch", L00-L10.
 *
 * Taken from the course-order table in Lecture 0. This list exists independently of the
 * `nbody` content collection so that /courses/nbody/ can show all eleven lectures --
 * including the ones with no page yet -- rather than only the ones that happen to have an
 * .mdx file. The index page cross-references this against the collection by `slug` to decide
 * which rows are clickable.
 */
export type NbodyLectureSummary = {
	n: number;
	slug: string;
	title: string;
	/** "What you build", one line. */
	blurb: string;
};

export const nbodyLectures: NbodyLectureSummary[] = [
	{
		n: 0,
		slug: "l00-roadmap",
		title: "Roadmap",
		blurb: "Why gravity is the hard part, the two families of solver, and the order of the course.",
	},
	{
		n: 1,
		slug: "l01-direct-summation",
		title: "Direct summation with loops",
		blurb:
			"Softened force by nested loops, energy and momentum checks, explicit Euler; the two-body and figure-8 orbits.",
	},
	{
		n: 2,
		slug: "l02-time-integration",
		title: "Time integration",
		blurb: "Euler vs. leapfrog; energy error and order of accuracy.",
	},
	{
		n: 3,
		slug: "l03-vectorising-numpy",
		title: "Vectorising with NumPy",
		blurb: "The same force as array operations; the Plummer sphere; a cold collapse.",
	},
	{
		n: 4,
		slug: "l04-barnes-hut-tree",
		title: "Barnes–Hut tree",
		blurb: "Quadtree/octree, the opening angle θ, the tree walk; error and timing against direct summation.",
	},
	{
		n: 5,
		slug: "l05-multipoles-better-trees",
		title: "Multipoles & better trees",
		blurb: "Quadrupole terms; opening criteria; periodic forces and the Ewald sum.",
	},
	{
		n: 6,
		slug: "l06-particle-mesh",
		title: "Particle–Mesh",
		blurb:
			"Mass assignment (NGP/CIC/TSC), an FFT Poisson solver, gradient and interpolation, momentum conservation.",
	},
	{
		n: 7,
		slug: "l07-cosmological-nbody",
		title: "Cosmological N-body",
		blurb:
			"An expanding background, the growth factor, Gaussian initial conditions and P(k), the Zel'dovich pancake, the cosmic web, friends-of-friends halos.",
	},
	{
		n: 8,
		slug: "l08-p3m-treepm",
		title: "P³M and TreePM",
		blurb:
			"The Gaussian force split, mesh force with window deconvolution, a chaining-mesh short-range sum, a tree with a cutoff.",
	},
	{
		n: 9,
		slug: "l09-fast-multipole-method",
		title: "Fast Multipole Method",
		blurb: "2D complex-variable FMM: P2M, M2M, M2L, L2L, L2P, interaction lists; comparison with Barnes–Hut.",
	},
	{
		n: 10,
		slug: "l10-production-codes",
		title: "Production codes",
		blurb:
			"Morton keys and key-sorted trees, domain decomposition, block time steps; multigrid/AMR and a pipeline overview.",
	},
];
