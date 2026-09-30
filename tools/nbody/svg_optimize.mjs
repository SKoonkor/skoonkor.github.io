// Usage: node svg_optimize.mjs <in.svg> <out.svg>
// Merge and simplify a flattened SVG (see svg_flatten.py). Precision 3 keeps figures pixel-identical
// at any size the page shows them; ids that are still referenced (clip paths) are kept as they are,
// so the per-file prefixes added by svg_recolor.py stay unique across a page.
import { readFileSync, writeFileSync } from "node:fs";
// svgo is a build-time tool, not a site dependency: `pnpm add svgo` in a scratch dir and point SVGO at it,
// e.g. SVGO=/tmp/x/node_modules/svgo/lib/svgo-node.js node svg_optimize.mjs in.svg out.svg
const { optimize } = await import(process.env.SVGO ?? "svgo");

const [src, dst] = process.argv.slice(2);
const before = readFileSync(src, "utf8");
const out = optimize(before, {
	path: src,
	floatPrecision: 3,
	plugins: [
		{
			name: "preset-default",
			// FORCE_MERGE=1: merge same-coloured shapes even where they overlap. Only correct for OPAQUE fills with
			// no stroke (a dense scatter of same-colour dots): overlapping translucent or stroked shapes would
			// composite differently once merged, so leave it off for those.
			params: { overrides: { cleanupIds: { minify: false, remove: true }, ...(process.env.FORCE_MERGE ? { mergePaths: { force: true } } : {}) } },
		},
	],
});
const data = out.data.replace(/ data-nm="\d+"/g, "");
writeFileSync(dst, data);
console.log(`${src}: ${before.length} -> ${data.length} bytes, ${(before.match(/<[a-zA-Z]/g) || []).length} -> ${(data.match(/<[a-zA-Z]/g) || []).length} elements`);
