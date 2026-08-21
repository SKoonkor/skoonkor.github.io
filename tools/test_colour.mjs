/*
 * Check the colour pipeline in assets/js/explore/pca-sed.js.
 *
 * The swatch is the one number on the demo a visitor can check against their own
 * intuition, so it needs to be right. This asserts two things:
 *
 *   1. The Wyman, Sloan & Shirley (2013) fits reproduce the published peaks of
 *      the CIE 1931 colour matching functions.
 *   2. Blackbodies come out the colour everyone knows they are -- 3000 K orange,
 *      5800 K white, 30000 K blue.
 *
 * An earlier version used a hand-written CMF lookup table and rendered every
 * stellar population the same shade of green; this test exists because of it.
 *
 *     node tools/test_colour.mjs
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = await readFile(path.join(here, '..', 'assets', 'js', 'explore', 'pca-sed.js'), 'utf8');

// Lift the pure colour helpers out of the module: they need no DOM and no imports.
const START = 'function pwGauss';
const END = '/* -------------------------------------------------------------------- data';
const body = src.slice(src.indexOf(START), src.indexOf(END));
const m = new Function(`${body}\nreturn { spectrumToCSS, cieX, cieY, cieZ };`)();

let failures = 0;
function check(name, ok, detail = '') {
	console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
	if (!ok) failures++;
}

function peak(f) {
	let at = 0, val = -Infinity;
	for (let nm = 360; nm <= 830; nm += 1) { const v = f(nm); if (v > val) { val = v; at = nm; } }
	return [at, val];
}

console.log('CIE 1931 colour matching function fits');
for (const [name, fn, nm0, v0] of [
	['x-bar', m.cieX, 600, 1.056],
	['y-bar', m.cieY, 555, 1.000],
	['z-bar', m.cieZ, 445, 1.781],
]) {
	const [at, val] = peak(fn);
	check(`${name} peaks near ${nm0} nm at ~${v0}`,
		Math.abs(at - nm0) <= 4 && Math.abs(val - v0) < 0.02,
		`got ${at} nm, ${val.toFixed(3)}`);
}

// Planck function in f_nu, on the demo's wavelength grid.
const N = 1200, LO = 1000, HI = 30000;
const lam = Array.from({ length: N }, (_, i) =>
	10 ** (Math.log10(LO) + (Math.log10(HI) - Math.log10(LO)) * i / (N - 1)));

function blackbody(T) {
	const h = 6.62607015e-34, c = 2.99792458e8, k = 1.380649e-23;
	return lam.map((a) => {
		const nu = c / (a * 1e-10);
		return (2 * h * nu ** 3 / c ** 2) / (Math.exp(h * nu / (k * T)) - 1);
	});
}

const rgb = (css) => css.match(/\d+/g).map(Number);

console.log('\nBlackbody colours');
const results = {};
for (const T of [3000, 4500, 5800, 8000, 15000, 30000]) {
	const c = m.spectrumToCSS(lam, blackbody(T));
	results[T] = rgb(c);
	console.log(`    ${String(T).padStart(5)} K  ->  ${c}`);
}

check('3000 K is warm: red clearly above blue',
	results[3000][0] - results[3000][2] > 80,
	`r-b = ${results[3000][0] - results[3000][2]}`);
check('5800 K is near-white: channels within 30',
	Math.max(...results[5800]) - Math.min(...results[5800]) < 30,
	`spread ${Math.max(...results[5800]) - Math.min(...results[5800])}`);
check('30000 K is cool: blue clearly above red',
	results[30000][2] - results[30000][0] > 50,
	`b-r = ${results[30000][2] - results[30000][0]}`);

const warmth = (T) => results[T][0] - results[T][2];
const temps = [3000, 4500, 5800, 8000, 15000, 30000];
check('colour reddens monotonically as temperature falls',
	temps.every((T, i) => i === 0 || warmth(T) < warmth(temps[i - 1])),
	temps.map((T) => `${T}:${warmth(T)}`).join(' '));

console.log('');
if (failures) {
	console.log(`${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('All checks passed.');
