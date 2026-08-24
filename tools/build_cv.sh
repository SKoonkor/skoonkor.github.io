#!/usr/bin/env bash
# Compile cv/Koonkor_CV.tex to public/cv/Koonkor_CV.pdf.
#
# The PDF is committed, so this only needs running when the .tex changes.
# Dropping the PDF into public/cv/ is what makes the "Download PDF" button
# appear on /cv/ -- src/pages/cv.astro renders it only when the file exists.
#
# Needs pdflatex. On macOS: brew install texlive (or the full MacTeX).
# Tectonic would be lighter, but its package bundle host was unreachable.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/cv/Koonkor_CV.tex"
out="$root/public/cv"

# Homebrew's texlive and MacTeX both install outside the default PATH.
export PATH="/opt/homebrew/opt/texlive/bin:/usr/local/opt/texlive/bin:/Library/TeX/texbin:$PATH"

command -v pdflatex >/dev/null || {
	echo "pdflatex not found. brew install texlive" >&2
	exit 1
}

mkdir -p "$out"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Twice: the second pass resolves the hyperref anchors written by the first.
for _ in 1 2; do
	pdflatex -interaction=nonstopmode -halt-on-error \
		-output-directory "$work" "$src" >"$work/log" 2>&1 ||
		{ tail -40 "$work/log" >&2; exit 1; }
done

cp "$work/Koonkor_CV.pdf" "$out/Koonkor_CV.pdf"
echo "wrote $out/Koonkor_CV.pdf ($(du -h "$out/Koonkor_CV.pdf" | cut -f1))"
