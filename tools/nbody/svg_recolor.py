"""Recolour a pdftocairo (TikZ) or matplotlib SVG for the site's light/dark themes.

Usage: python3 svg_recolor.py <in.svg> <out.svg> <id-prefix> [--plot]

- black ink -> currentColor; mid grays -> currentColor at reduced opacity
- LaTeX accent colours -> the site's fixed accent hex (blue #2b7fd6, red #c0392b, green #2e8b57)
- pale tinted fills (blue!8, cheavy!20, green!12 ...) -> the accent at low opacity, so they blend
  into whatever background is behind the figure
- every id (and href/url() reference to it) gets "<prefix>-", so several SVGs can be inlined on one page
- --plot (matplotlib output): add fill="currentColor" on the root so text glyphs, which matplotlib
  writes without an explicit fill, follow the theme
"""
import re
import sys

BLUE, RED, GREEN, ORANGE = "#2b7fd6", "#c0392b", "#2e8b57", "#e08a3c"


def pct(s):
    return tuple(float(x) / 100 for x in re.findall(r"[\d.]+", s))


def classify(rgb):
    """Return (colour, opacity multiplier) for an (r, g, b) triple in 0..1."""
    r, g, b = rgb
    if max(rgb) - min(rgb) < 0.02:                      # gray / black / white
        if r < 0.02:
            return "currentColor", 1.0
        if r > 0.98:
            return "none-white", 1.0
        return "currentColor", max(0.15, 1.0 - r)         # gray ink: darker gray -> more opaque
    # tinted colours: classify by dominant channel
    if r > g and r > b:
        # red and orange are both red-dominant: tell them apart by how far green sits above blue
        q = (g - b) / max(1e-9, r - b)
        if q > 0.25:
            base, hue = ORANGE, (0.88, 0.54, 0.24)
        else:
            base, hue = RED, (0.75, 0.22, 0.17)
    elif g >= r and g > b:
        base, hue = GREEN, (0.18, 0.55, 0.34)
    else:
        base, hue = BLUE, (0.12, 0.44, 0.70)
    # how far from white? fully saturated hue -> 1.0, pale tint -> small
    dist = sum(1 - c for c in rgb) / max(1e-9, sum(1 - c for c in hue))
    return base, min(1.0, max(0.06, dist))


def recolor_tag(tag):
    def fix(kind):
        nonlocal tag
        m = re.search(rf'\b{kind}="(rgb\([^)]*\))"', tag)
        if not m:
            return
        colour, mult = classify(pct(m.group(1)))
        if colour == "none-white":
            tag = tag.replace(m.group(0), f'{kind}="none"')
            return
        tag = tag.replace(m.group(0), f'{kind}="{colour}"')
        if mult < 0.999:
            om = re.search(rf'{kind}-opacity="([\d.]+)"', tag)
            cur = float(om.group(1)) if om else 1.0
            new = f'{kind}-opacity="{cur * mult:.3f}"'
            tag = tag.replace(om.group(0), new) if om else tag[:-1].rstrip("/ ") + f' {new}' + ("/>" if tag.endswith("/>") else ">")
    fix("fill")
    fix("stroke")
    return tag


def main():
    src, dst, prefix = sys.argv[1], sys.argv[2], sys.argv[3]
    plot = "--plot" in sys.argv
    text = open(src, encoding="utf-8").read()

    text = re.sub(r"<[^<>]*rgb\([^<>]*>", lambda m: recolor_tag(m.group(0)), text)
    text = re.sub(r"#000000\b", "currentColor", text)
    text = re.sub(r'(fill|stroke)="rgb\(0%,\s*0%,\s*0%\)"', r'\1="currentColor"', text)

    ids = set(re.findall(r'\bid="([^"]+)"', text))
    for i in sorted(ids, key=len, reverse=True):
        text = re.sub(rf'\bid="{re.escape(i)}"', f'id="{prefix}-{i}"', text)
        text = re.sub(rf'(xlink:href|href)="#{re.escape(i)}"', rf'\1="#{prefix}-{i}"', text)
        text = re.sub(rf"url\(#{re.escape(i)}\)", f"url(#{prefix}-{i})", text)

    if plot:
        text = re.sub(r"<svg\b", '<svg fill="currentColor"', text, count=1)

    open(dst, "w", encoding="utf-8").write(text)
    print(f"wrote {dst} ({len(ids)} ids namespaced with '{prefix}-')")


if __name__ == "__main__":
    main()
