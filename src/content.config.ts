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
					.array(z.object({ label: z.string(), href: z.string().url() }))
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

const tag = defineCollection({
	loader: glob({ base: "./content/tags", pattern: "**/*.{md,mdx}" }),
	schema: z.object({
		title: shortTitleSchema.optional(),
		description: z.string().optional(),
	}),
});

export const collections = { post, research, tag };
