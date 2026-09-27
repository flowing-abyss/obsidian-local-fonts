"""Generate deterministic fonts for real role-rendering tests.

Run: uv run --with fonttools python scripts/make-role-fixtures.py
"""

from pathlib import Path

from fontTools.colorLib.builder import buildCOLR, buildCPAL
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen


OUT = Path("tests/vaults/minimal/.fonts/roles")
FACES = {
    "text": ("Role Text", 610),
    "interface": ("Role Interface", 710),
    "mono": ("Role Mono", 410),
    "headings": ("Role Headings", 810),
    "baseline": ("Role Baseline", 510),
    "emoji-a": ("Role Emoji A", 1100),
    "emoji-b": ("Role Emoji B", 1300),
}
CHARACTERS = {chr(code): f"ascii_{code}" for code in range(0x20, 0x7F)}
CHARACTERS.update({
    "А": "cyr_a", "Б": "cyr_b", "я": "cyr_ya",
    "😀": "grin", "☀": "sun", "👩": "woman", "💻": "laptop",
    "\ufe0f": "vs16", "\u200d": "zwj",
})


def box(width: int, inset: int = 50):
    pen = TTGlyphPen(None)
    pen.moveTo((inset, 0))
    pen.lineTo((inset, 700))
    pen.lineTo((width - inset, 700))
    pen.lineTo((width - inset, 0))
    pen.closePath()
    return pen.glyph()


def build(family: str, advance: int, color: bool):
    order = [".notdef", *CHARACTERS.values()]
    if color:
        order.append("woman_laptop")
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({ord(char): name for char, name in CHARACTERS.items()})
    empty = TTGlyphPen(None).glyph()
    glyphs = {
        name: empty if name in (".notdef", "vs16", "zwj") else box(advance)
        for name in order
    }
    if color:
        glyphs["woman_laptop"] = box(advance, 110)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({
        name: (0 if name in ("vs16", "zwj") else advance, 0 if name in ("vs16", "zwj") else 50)
        for name in order
    })
    fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({
        "familyName": family,
        "styleName": "Regular",
        "psName": family.replace(" ", "") + "-Regular",
        "licenseDescription": "Fixture font, public domain.",
    })
    fb.setupOS2(usWeightClass=400, sTypoAscender=800, sTypoDescender=-200, fsSelection=0x40)
    fb.setupPost(italicAngle=0)
    font = fb.font
    if color:
        font["CPAL"] = buildCPAL([[(1.0, 0.0, 0.0, 1.0)]])
        font["COLR"] = buildCOLR({name: [(name, 0)] for name in order if name not in (".notdef", "vs16", "zwj")})
        addOpenTypeFeaturesFromString(font, """
languagesystem DFLT dflt;
feature ccmp { sub woman zwj laptop by woman_laptop; } ccmp;
""")
    font["head"].created = 3406620153
    font["head"].modified = 3406620153
    font.recalcTimestamp = False
    return font


OUT.mkdir(parents=True, exist_ok=True)
for stem, (family, advance) in FACES.items():
    path = OUT / f"{stem}.ttf"
    build(family, advance, stem.startswith("emoji-")).save(path)
    print(path, path.stat().st_size, "bytes")
