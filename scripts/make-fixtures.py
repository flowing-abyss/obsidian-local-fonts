"""Generate the font fixtures used by unit and e2e tests.

Run with:  uv run --with fonttools --with brotli python scripts/make-fixtures.py
Outputs are committed; this script exists so they can be regenerated deterministically.
"""

import os
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

OUT = os.path.join("tests", "vaults", "minimal", ".fonts")

# Every glyph is a filled box. Only the advance width differs between families,
# which is what probe.ts measures to tell "my font rendered" from "fallback rendered".
GLYPHS = [chr(c) for c in range(0x20, 0x7F)] + ["А", "Б", "я", "α", "ế", "😀"]


def build(family, style, weight, italic, advance, extra_tables=None):
    upem = 1000
    order = [".notdef"] + ["g%d" % i for i in range(len(GLYPHS))]
    cmap = {ord(ch): "g%d" % i for i, ch in enumerate(GLYPHS)}

    fb = FontBuilder(upem, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)

    pen = TTGlyphPen(None)
    pen.moveTo((50, 0))
    pen.lineTo((50, 700))
    pen.lineTo((advance - 50, 700))
    pen.lineTo((advance - 50, 0))
    pen.closePath()
    box = pen.glyph()

    empty = TTGlyphPen(None).glyph()
    fb.setupGlyf({name: (empty if name == ".notdef" else box) for name in order})
    fb.setupHorizontalMetrics({name: (advance, 50) for name in order})
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable(
        {
            "familyName": family,
            "styleName": style,
            "psName": (family + "-" + style).replace(" ", ""),
            "licenseDescription": "Fixture font, public domain.",
        }
    )
    fb.setupOS2(usWeightClass=weight, sTypoAscender=800, sTypoDescender=-200,
                fsSelection=0x01 if italic else 0x40)
    fb.setupPost(italicAngle=-12.0 if italic else 0.0)
    if italic:
        fb.font["head"].macStyle = 0x02

    if extra_tables:
        extra_tables(fb.font)
    return fb


def add_colr(font):
    from fontTools.colorLib.builder import buildCOLR, buildCPAL
    names = [n for n in font.getGlyphOrder() if n != ".notdef"]
    font["CPAL"] = buildCPAL([[(1.0, 0.0, 0.0, 1.0), (0.0, 0.0, 1.0, 1.0)]])
    font["COLR"] = buildCOLR({n: [(n, 0)] for n in names})


def add_svg(font):
    from fontTools.ttLib.tables.S_V_G_ import table_S_V_G_, SVGDocument
    gid = 1
    doc = ('<svg xmlns="http://www.w3.org/2000/svg">'
           '<rect id="glyph%d" x="0" y="0" width="500" height="500" fill="red"/></svg>' % gid)
    svg = table_S_V_G_()
    svg.docList = [SVGDocument(data=doc, startGlyphID=gid, endGlyphID=gid, compressed=False)]
    font["SVG "] = svg


def save(fb, path, flavor=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if flavor:
        fb.font.flavor = flavor
    fb.font.save(path)
    print(path, os.path.getsize(path), "bytes")


# Wide boxes — 600 units of advance.
save(build("Probe Sans", "Regular", 400, False, 600), os.path.join(OUT, "probe-sans", "probe-sans-400.ttf"))
save(build("Probe Sans", "Regular", 400, False, 600), os.path.join(OUT, "probe-sans", "probe-sans-400.woff2"), "woff2")
save(build("Probe Sans", "Bold Italic", 700, True, 600), os.path.join(OUT, "probe-sans", "probe-sans-700italic.ttf"))

# Narrow boxes — 300 units. Measurably different from Probe Sans at the same size.
save(build("Probe Mono", "Regular", 400, False, 300), os.path.join(OUT, "probe-mono", "probe-mono-400.woff2"), "woff2")

save(build("Probe Emoji COLR", "Regular", 400, False, 600, add_colr), os.path.join(OUT, "probe-emoji", "probe-emoji-colr.ttf"))
save(build("Probe Emoji SVG", "Regular", 400, False, 600, add_svg), os.path.join(OUT, "probe-emoji", "probe-emoji-svg.ttf"))
