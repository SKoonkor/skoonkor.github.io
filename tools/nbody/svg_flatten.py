"""Replace every <use> in an SVG by an inline copy of what it points at.

pdftocairo and matplotlib draw each glyph and marker as a <use> of a shared <defs> entry. That is
compact on disk, but every <use> is a shadow tree the browser has to style and lay out separately:
one figure with 950 of them cost more style-recalculation time than the whole rest of the page.
Inlined copies are plain <g>/<path> siblings, which svgo (tools/nbody/svg_optimize.mjs) can then
merge into a handful of paths. The picture is identical.

Usage: python3 svg_flatten.py <in.svg> <out.svg>
"""
import copy
import re
import sys
import xml.etree.ElementTree as ET

SVG = "http://www.w3.org/2000/svg"
XLINK = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", XLINK)


def q(tag):
    return f"{{{SVG}}}{tag}"


def main():
    src, dst = sys.argv[1], sys.argv[2]
    text = open(src, encoding="utf-8").read()

    def dedupe(m):
        # an older recolour pass could emit a repeated attribute (e.g. two fill-opacity); browsers keep
        # the first one, XML parsers reject the file, so keep the first here too
        tag, seen = m.group(0), set()

        def once(a):
            name = a.group(1)
            if name in seen:
                return ""
            seen.add(name)
            return a.group(0)

        return re.sub(r'\s([\w:.-]+)="[^"]*"', once, tag)

    text = re.sub(r"<[a-zA-Z][^<>]*>", dedupe, text)
    root = ET.fromstring(text)
    tree = ET.ElementTree(root)
    by_id = {e.get("id"): e for e in root.iter() if e.get("id")}
    parent = {c: p for p in root.iter() for c in p}

    def in_defs(e):
        while e in parent:
            e = parent[e]
            if e.tag == q("defs"):
                return True
        return False

    n = 0
    # innermost-first is unnecessary: targets here are glyph/marker leaves, never other <use>s
    for use in [e for e in root.iter(q("use")) if not in_defs(e)]:
        ref = use.get(f"{{{XLINK}}}href") or use.get("href")
        target = by_id.get(ref[1:]) if ref and ref.startswith("#") else None
        if target is None:
            continue
        x, y = float(use.get("x", 0)), float(use.get("y", 0))
        clone = copy.deepcopy(target)
        for e in clone.iter():
            e.attrib.pop("id", None)
        inner = list(clone) if clone.tag == q("g") and not clone.attrib else [clone]
        skip = (f"{{{XLINK}}}href", "href", "x", "y", "width", "height")
        use_attrs = {k: v for k, v in use.attrib.items() if k not in skip}
        move = (f" translate({x:g} {y:g})" if x or y else "")
        if len(inner) == 1 and inner[0].tag == q("path"):
            # a glyph or marker that is one path: put the use's attributes straight on a copy of the
            # path, so svgo can bake the translation into its data and merge neighbouring copies
            node = inner[0]
            for k, v in use_attrs.items():
                if k == "style" and node.get("style"):
                    node.set("style", node.get("style").rstrip(";") + ";" + v)
                elif k == "transform":
                    continue
                else:
                    node.set(k, v)
            tf = (use_attrs.get("transform", "") + move + " " + node.get("transform", "")).strip()
            if tf:
                node.set("transform", tf)
        else:
            node = ET.Element(q("g"))
            for k, v in use_attrs.items():
                node.set(k, v)
            tf = (node.get("transform", "") + move).strip()
            if tf:
                node.set("transform", tf)
            for c in inner:
                node.append(c)
        g = node
        p = parent[use]
        p[list(p).index(use)] = g
        n += 1
    # Move simple inline style declarations onto attributes, so svgo can bake a shape's translation into its
    # path data and merge neighbours (it will not touch a path that has a style attribute). Only properties
    # that matplotlib's page-wide `<style>*{stroke-linejoin:round;stroke-linecap:butt}</style>` rule cannot
    # override; stroke-linejoin/linecap stay in `style`, where an inline value beats that rule.
    safe = {"fill", "fill-opacity", "opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-miterlimit"}
    for e in root.iter():
        st = e.get("style")
        if not st:
            continue
        keep = []
        for decl in st.split(";"):
            if ":" not in decl:
                continue
            name, val = (x.strip() for x in decl.split(":", 1))
            if name in safe:
                e.set(name, val)
            else:
                keep.append(f"{name}:{val}")
        if keep:
            e.set("style", ";".join(keep))
        else:
            del e.attrib["style"]
    # Stroke-only paths (cell outlines, axes) must not be merged by svgo: neighbouring cells share an
    # edge that is stroked twice, and merging would stroke it once and lighten it. A unique marker
    # attribute keeps them apart; svg_optimize.mjs strips it again.
    k = 0
    for e in root.iter(q("path")):
        if "fill:none" in (e.get("style") or "").replace(" ", "") or e.get("fill") == "none":
            e.set("data-nm", str(k))
            k += 1
    text = ET.tostring(root, encoding="unicode")
    used = set(re.findall(r"url\(#([^)]+)\)", text)) | set(re.findall(r'href="#([^"]+)"', text))
    for e in root.iter():
        if e.get("id") and e.get("id") not in used:
            del e.attrib["id"]
    tree.write(dst, encoding="utf-8", xml_declaration=True)
    print(f"{src}: inlined {n} <use> elements")


if __name__ == "__main__":
    main()
