import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

function removeDupsAndLowerCase(array: string[]) {
	return [...new Set(array.map((str) => str.toLowerCase()))];
}

/**
 * 60 characters is the limit the OG image generator and the sticky page title
 * can render without clipping. It is a *presentational* limit, so it applies to
 * `shortTitle`, never to the real academic title.
 */
const shortTitleSchema = z.string().max(60);

const baseSchema = z.object({
	title: shortTitleSchema,
});

/**
 * Written notes. Keeps the collection key `post` so that src/data/post.ts, the
 * RSS route, TOC.astro and the OG image route all keep working untouched; only
 * the directory it loads from has moved.
 */
const post = defineCollection({
	loader: glob({ base: "./content/notes", pattern: "**/*.{md,mdx}" }),
	schema: ({ image }) =>
		baseSchema.extend({
			description: z.string(),
			coverImage: z
				.object({
					alt: z.string(),
					src: image(),
				})
				.optional(),
			draft: z.boolean().default(false),
			ogImage: z.string().optional(),
			tags: z.array(z.string()).default([]).transform(removeDupsAndLowerCase),
			publishDate: z
				.string()
				.or(z.date())
				.transform((val) => new Date(val)),
			updatedDate: z
				.string()
				.optional()
				.transform((str) => (str ? new Date(str) : undefined)),
			pinned: z.boolean().default(false),
		}),
});

/**
 * Research projects. Four entries, but a real listing/detail split: a card on
 * /research/ and a full page at /research/<slug>/.
 */
const research = defineCollection({
	loader: glob({ base: "./content/research", pattern: "**/*.{md,mdx}" }),
	schema: ({ image }) =>
		z
			.object({
				// The full academic title. Deliberately uncapped -- this is the <h1>
				// and the <title>. The PAUS paper's title is 79 characters.
				title: z.string(),
				// What the card, the sticky title bar and the OG image use instead.
				shortTitle: shortTitleSchema.optional(),
				// One or two sentences of plain language, for a reader who is not an
				// astronomer. This is the thing that makes the page approachable.
				hook: z.string().max(400),
				// Controls display order on /research/; lower is first.
				order: z.number(),
				publishDate: z
					.string()
					.or(z.date())
					.transform((val) => new Date(val)),
				updatedDate: z
					.string()
					.optional()
					.transform((str) => (str ? new Date(str) : undefined)),
				kind: z.enum(["paper", "phd-thesis", "msc-thesis", "bsc-thesis", "project"]),
				// Human citation line, e.g. "Koonkor et al., MNRAS, 2026".
				venue: z.string(),
				links: z
					.array(z.object({ label: z.string(), href: z.url() }))
					.default([]),
				// Path to an interactive version, if one exists.
				demo: z.string().optional(),
				figure: z.object({
					src: image(),
					// Long enough to be a real description rather than a label. The old
					// site shipped alt="Research Topic 1" for a year.
					alt: z.string().min(20),
					caption: z.string().optional(),
				}),
				tags: z.array(z.string()).default([]).transform(removeDupsAndLowerCase),
				draft: z.boolean().default(false),
			})
			.refine((d) => d.shortTitle !== undefined || d.title.length <= 60, {
				message:
					"shortTitle is required when title is longer than 60 characters, " +
					"because the OG image and the sticky page title cannot render more.",
				path: ["shortTitle"],
			}),
});

/**
 * The illustrated ML course at /explore/ml/.
 *
 * A series, not a stream. Entries are ordered by `part`, and every part gets a page
 * including the ones that are not written -- a course with holes in its numbering reads as
 * broken, whereas a page that says plainly "built, lesson not written" reads as in progress.
 *
 * `figures` is checked against the real figure registry by tests in the VisualisingML repo,
 * which is where those pictures are rendered from.
 */
const lesson = defineCollection({
	loader: glob({ base: "./content/ml", pattern: "**/*.{md,mdx}" }),
	schema: z
		.object({
			title: shortTitleSchema,
			description: z.string(),
			/** 0-7, matching docs/CURRICULUM.md in the engine repo. Also the display order. */
			part: z.number().int().min(0).max(7),
			/**
			 *  published  prose written, figures embedded
			 *  unwritten  the code and figures exist in vizml; the lesson is not written
			 *  planned    nothing exists yet
			 */
			status: z.enum(["published", "unwritten", "planned"]),
			/** What the reader can do afterwards. One sentence. */
			goal: z.string().max(240),
			/** Figure slugs, in the order they appear on the page. */
			figures: z.array(z.string()).default([]),
			/** Where the code lives, for the "built in" line. */
			source: z.string().optional(),
			publishDate: z
				.string()
				.or(z.date())
				.transform((val) => new Date(val)),
			updatedDate: z
				.string()
				.optional()
				.transform((str) => (str ? new Date(str) : undefined)),
			tags: z.array(z.string()).default([]).transform(removeDupsAndLowerCase),
			draft: z.boolean().default(false),
		})
		.refine((d) => d.status !== "published" || d.figures.length > 0, {
			message: "A published lesson must list the figures it embeds.",
			path: ["figures"],
		})
		.refine((d) => d.status !== "planned" || d.figures.length === 0, {
			message: "A planned part cannot reference figures that do not exist yet.",
			path: ["figures"],
		}),
});

/**
 * "Gravity from Scratch", the N-body gravity-solver course at /courses/nbody/.
 *
 * One entry per lecture, L00-L10. Modelled on the `lesson` collection (see above), but with
 * `draft` doing real work here rather than being always-false: each lecture is written and
 * reviewed with `draft: true`, previewable only in `pnpm dev` (see
 * src/pages/courses/nbody/[...slug].astro), and flipped to `false` only once its owner has
 * checked it against the lecture PDF and is happy to publish it. That is a deliberate
 * difference from `lesson`, where a draft is simply unfinished -- here a draft can be
 * complete and still deliberately unpublished.
 */
const nbody = defineCollection({
	loader: glob({ base: "./content/courses/nbody", pattern: "**/*.{md,mdx}" }),
	schema: z.object({
		title: shortTitleSchema,
		description: z.string(),
		/** 0-10: L00 (roadmap) through L10. Also the display and prev/next order. */
		lecture: z.number().int().min(0).max(10),
		/** What the reader can do afterwards. One or two sentences. */
		goal: z.string().max(320),
		publishDate: z
			.string()
			.or(z.date())
			.transform((val) => new Date(val)),
		updatedDate: z
			.string()
			.optional()
			.transform((str) => (str ? new Date(str) : undefined)),
		tags: z.array(z.string()).default([]).transform(removeDupsAndLowerCase),
		/** Hidden from every listing and unbuilt in production until set to false. */
		draft: z.boolean().default(true),
		/** Public zip paths under /public/, added only once the lecture is published. */
		downloads: z
			.object({
				hints: z.string().optional(),
				solutions: z.string().optional(),
			})
			.optional(),
	}),
});

const tag = defineCollection({
	loader: glob({ base: "./content/tags", pattern: "**/*.{md,mdx}" }),
	schema: z.object({
		title: shortTitleSchema.optional(),
		description: z.string().optional(),
	}),
});

export const collections = { lesson, nbody, post, research, tag };
