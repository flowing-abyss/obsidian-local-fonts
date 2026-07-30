import { describe, expect, it } from 'vitest';
import { readFixture } from './fixtures.js';
import { colorFormatsFromTags, parseSfnt, readTableDirectory } from './sfnt.js';

/**
 * Build a minimal uncompressed sfnt: header + table directory + raw table bodies,
 * back to back with no padding. Checksums are never validated by the parser, so
 * they are left as zero. Used to exercise malformed/edge-case table bodies that
 * the committed fixtures don't (and shouldn't be regenerated to) exhibit.
 */
function buildSfnt(tables: Array<{ tag: string; data: Uint8Array }>): ArrayBuffer {
  const headerSize = 12;
  const dirSize = tables.length * 16;
  let cursor = headerSize + dirSize;
  const entries = tables.map((t) => {
    const entry = { tag: t.tag, offset: cursor, length: t.data.byteLength };
    cursor += t.data.byteLength;
    return entry;
  });
  const buf = new ArrayBuffer(cursor);
  const view = new DataView(buf);
  view.setUint32(0, 0x0001_0000);
  view.setUint16(4, tables.length);
  entries.forEach((e, i) => {
    const base = headerSize + i * 16;
    for (let c = 0; c < 4; c++) {
      view.setUint8(base + c, e.tag.charCodeAt(c));
    }
    view.setUint32(base + 8, e.offset);
    view.setUint32(base + 12, e.length);
  });
  const bytes = new Uint8Array(buf);
  tables.forEach((t, i) => {
    const entry = entries[i];
    if (entry !== undefined) {
      bytes.set(t.data, entry.offset);
    }
  });
  return buf;
}

/** A cmap table with a single format-4 subtable covering exactly the given segments. */
function cmapFormat4(segments: Array<{ start: number; end: number }>): Uint8Array {
  const segCount = segments.length;
  const bodyLen = 14 + segCount * 2 + 2 + segCount * 2;
  const bytes = new Uint8Array(12 + bodyLen);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1); // numTables
  view.setUint16(4, 3); // platformID
  view.setUint16(6, 1); // encodingID
  view.setUint32(8, 12); // subtable offset
  let o = 12;
  view.setUint16(o, 4); // format
  o += 2;
  view.setUint16(o, bodyLen); // length
  o += 2;
  o += 2; // language
  view.setUint16(o, segCount * 2); // segCountX2
  o += 2;
  o += 6; // searchRange, entrySelector, rangeShift
  for (const seg of segments) {
    view.setUint16(o, seg.end);
    o += 2;
  }
  o += 2; // reservedPad
  for (const seg of segments) {
    view.setUint16(o, seg.start);
    o += 2;
  }
  return bytes;
}

/**
 * A `name` table with one record per given (nameId, text) pair, all platform 3
 * (Windows, UTF-16BE) — enough to exercise family/subfamily/typographic-family/
 * typographic-subfamily combinations without needing a real font binary.
 */
function buildNameTable(records: ReadonlyArray<readonly [number, string]>): Uint8Array {
  const encoded = records.map(([id, text]) => {
    const bytes = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      bytes[i * 2] = 0;
      bytes[i * 2 + 1] = text.charCodeAt(i);
    }
    return { id, bytes };
  });
  const headerSize = 6;
  const recordSize = 12;
  const stringOffset = headerSize + recordSize * encoded.length;
  let cursor = 0;
  const placed = encoded.map((e) => {
    const offset = cursor;
    cursor += e.bytes.byteLength;
    return { ...e, offset };
  });
  const buf = new Uint8Array(stringOffset + cursor);
  const view = new DataView(buf.buffer);
  view.setUint16(0, 0); // format
  view.setUint16(2, placed.length); // count
  view.setUint16(4, stringOffset);
  placed.forEach((rec, i) => {
    const base = headerSize + i * recordSize;
    view.setUint16(base, 3); // platformID: Windows
    view.setUint16(base + 2, 1); // encodingID
    view.setUint16(base + 4, 0x0409); // languageID
    view.setUint16(base + 6, rec.id);
    view.setUint16(base + 8, rec.bytes.byteLength);
    view.setUint16(base + 10, rec.offset);
    buf.set(rec.bytes, stringOffset + rec.offset);
  });
  return buf;
}

const OS2_LENGTH = 64;

/** A full-length OS/2 table carrying just usWeightClass and the italic fsSelection bit. */
function buildOs2Full(weight: number, italic: boolean): Uint8Array {
  const os2 = new Uint8Array(OS2_LENGTH);
  const view = new DataView(os2.buffer);
  view.setUint16(4, weight);
  view.setUint16(62, italic ? 0x01 : 0x00);
  return os2;
}

describe('readTableDirectory', () => {
  it('finds the tables of a real ttf', () => {
    const dir = readTableDirectory(readFixture('probe-sans/probe-sans-400.ttf'));

    expect(dir.has('name')).toBe(true);
    expect(dir.has('OS/2')).toBe(true);
    expect(dir.has('cmap')).toBe(true);
    expect(dir.get('name')?.length).toBeGreaterThan(0);
  });

  it('rejects a buffer that is not an sfnt', () => {
    expect(() => readTableDirectory(new ArrayBuffer(64))).toThrow(/not an sfnt/i);
  });

  it('stops scanning the directory at a truncated table record instead of throwing', () => {
    // Header claims 2 tables but the buffer only has room for one 16-byte record.
    const buf = new ArrayBuffer(12 + 16);
    const view = new DataView(buf);
    view.setUint32(0, 0x0001_0000);
    view.setUint16(4, 2);
    const tag = 'name';
    for (let c = 0; c < 4; c++) {
      view.setUint8(12 + c, tag.charCodeAt(c));
    }
    view.setUint32(20, 100);
    view.setUint32(24, 4);

    const dir = readTableDirectory(buf);

    expect(dir.size).toBe(1);
    expect(dir.has('name')).toBe(true);
  });
});

describe('colorFormatsFromTags', () => {
  it('reports CBDT and sbix as colour formats given only tags, no buffer', () => {
    expect(colorFormatsFromTags(['CBDT', 'sbix'])).toStrictEqual(['CBDT', 'sbix']);
  });

  it('reports nothing for a tag set with no colour tables', () => {
    expect(colorFormatsFromTags(['glyf', 'loca'])).toStrictEqual([]);
  });

  it('reports COLR1 when the table body says version 1', () => {
    const colr = new Uint8Array(2);
    new DataView(colr.buffer).setUint16(0, 1); // version 1
    const buf = buildSfnt([{ tag: 'COLR', data: colr }]);
    const dir = readTableDirectory(buf);

    expect(colorFormatsFromTags(dir.keys(), buf, dir)).toStrictEqual(['COLR1']);
  });

  it('assumes COLRv1 when called with tags alone, as a woff2 directory yields no table bodies', () => {
    // This is the exact call shape Task 5 uses: a woff2 table directory has tags but
    // never table contents, so there is no COLR version byte to read.
    expect(colorFormatsFromTags(['COLR'])).toStrictEqual(['COLR1']);
  });
});

describe('parseSfnt', () => {
  it('reads the real family name rather than anything from the filename', () => {
    const info = parseSfnt(readFixture('probe-sans/probe-sans-400.ttf'));

    expect(info.family).toBe('Probe Sans');
    expect(info.weight).toBe(400);
    expect(info.italic).toBe(false);
  });

  it('reads weight and italic from OS/2 for a bold italic face', () => {
    const info = parseSfnt(readFixture('probe-sans/probe-sans-700italic.ttf'));

    expect(info.weight).toBe(700);
    expect(info.italic).toBe(true);
  });

  it('reports script coverage from the cmap', () => {
    const info = parseSfnt(readFixture('probe-sans/probe-sans-400.ttf'));

    expect(info.scripts).toContain('latin');
    expect(info.scripts).toContain('cyrillic');
    expect(info.scripts).toContain('emoji');
  });

  it('detects COLR as a colour format', () => {
    const info = parseSfnt(readFixture('probe-emoji/probe-emoji-colr.ttf'));

    expect(info.colorFormats).toContain('COLR0');
  });

  it('detects OT-SVG as a colour format', () => {
    const info = parseSfnt(readFixture('probe-emoji/probe-emoji-svg.ttf'));

    expect(info.colorFormats).toStrictEqual(['SVG']);
  });

  it('reports no colour formats for a plain text font', () => {
    const info = parseSfnt(readFixture('probe-sans/probe-sans-400.ttf'));

    expect(info.colorFormats).toStrictEqual([]);
  });

  it('reports no variable axes for a static font', () => {
    const info = parseSfnt(readFixture('probe-sans/probe-sans-400.ttf'));

    expect(info.axes).toStrictEqual([]);
  });

  it('reads the licence string when the font carries one', () => {
    const info = parseSfnt(readFixture('probe-sans/probe-sans-400.ttf'));

    expect(info.license).toContain('public domain');
  });

  it('falls back to an empty family when the name table is truncated mid-record', () => {
    // format 0, count claims 2 records but the buffer only has room for the first
    // (18 bytes in) plus its 2-byte UTF-16BE string 'A'.
    const name = new Uint8Array(20);
    const nameView = new DataView(name.buffer);
    nameView.setUint16(2, 2); // count
    nameView.setUint16(4, 18); // stringOffset
    nameView.setUint16(6, 3); // platformID (Windows)
    nameView.setUint16(8, 1); // encodingID
    nameView.setUint16(12, 1); // nameID = family
    nameView.setUint16(14, 2); // length
    nameView.setUint16(18, 0x0041); // 'A'

    const info = parseSfnt(buildSfnt([{ tag: 'name', data: name }]));

    expect(info.family).toBe('A');
    expect(info.subfamily).toBe('');
  });

  it('truncates a name string at an embedded NUL rather than keeping trailing garbage', () => {
    const name = new Uint8Array(26);
    const nameView = new DataView(name.buffer);
    nameView.setUint16(2, 1); // count
    nameView.setUint16(4, 18); // stringOffset
    nameView.setUint16(6, 3); // platformID (Windows)
    nameView.setUint16(8, 1); // encodingID
    nameView.setUint16(12, 1); // nameID = family
    nameView.setUint16(14, 8); // length: 4 UTF-16BE code units
    nameView.setUint16(18, 0x0041); // 'A'
    nameView.setUint16(20, 0x0042); // 'B'
    nameView.setUint16(22, 0x0000); // embedded NUL
    nameView.setUint16(24, 0x0058); // 'X' — must not survive into the result

    const info = parseSfnt(buildSfnt([{ tag: 'name', data: name }]));

    expect(info.family).toBe('AB');
  });

  it('falls back to an empty family when the name entry points past the end of the buffer', () => {
    // A truncated or corrupt file: the directory advertises a `name` table that
    // extends beyond the actual file. Must fall back gracefully, not throw.
    const buf = new ArrayBuffer(12 + 16);
    const view = new DataView(buf);
    view.setUint32(0, 0x0001_0000);
    view.setUint16(4, 1);
    const tag = 'name';
    for (let c = 0; c < 4; c++) {
      view.setUint8(12 + c, tag.charCodeAt(c));
    }
    view.setUint32(20, 1000); // offset far past the buffer
    view.setUint32(24, 4); // length

    const info = parseSfnt(buf);

    expect(info.family).toBe('');
  });

  it('falls back to default weight and upright style when OS/2 is shorter than fsSelection', () => {
    // A directory entry can claim a length too short to reach the fsSelection field
    // (offset 62) that italic detection reads.
    const os2 = new Uint8Array(8);

    const info = parseSfnt(buildSfnt([{ tag: 'OS/2', data: os2 }]));

    expect(info.weight).toBe(400);
    expect(info.italic).toBe(false);
  });

  it('reports no scripts when the cmap entry points past the end of the buffer', () => {
    const buf = new ArrayBuffer(12 + 16);
    const view = new DataView(buf);
    view.setUint32(0, 0x0001_0000);
    view.setUint16(4, 1);
    const tag = 'cmap';
    for (let c = 0; c < 4; c++) {
      view.setUint8(12 + c, tag.charCodeAt(c));
    }
    view.setUint32(20, 1000); // offset far past the buffer
    view.setUint32(24, 4); // length

    const info = parseSfnt(buf);

    expect(info.scripts).toStrictEqual([]);
  });

  it('reports no variable axes when the fvar entry points past the end of the buffer', () => {
    const buf = new ArrayBuffer(12 + 16);
    const view = new DataView(buf);
    view.setUint32(0, 0x0001_0000);
    view.setUint16(4, 1);
    const tag = 'fvar';
    for (let c = 0; c < 4; c++) {
      view.setUint8(12 + c, tag.charCodeAt(c));
    }
    view.setUint32(20, 1000); // offset far past the buffer
    view.setUint32(24, 4); // length

    const info = parseSfnt(buf);

    expect(info.axes).toStrictEqual([]);
  });

  it('does not report a script whose cmap ranges are entirely absent', () => {
    const info = parseSfnt(
      buildSfnt([{ tag: 'cmap', data: cmapFormat4([{ start: 0x41, end: 0x5a }]) }]),
    );

    expect(info.scripts).toStrictEqual(['latin']);
  });

  it('skips a cmap subtable whose offset points outside the table', () => {
    const cmap = new Uint8Array(12);
    const view = new DataView(cmap.buffer);
    view.setUint16(2, 1); // numTables
    view.setUint32(8, 1000); // subtable offset, far past byteLength

    const info = parseSfnt(buildSfnt([{ tag: 'cmap', data: cmap }]));

    expect(info.scripts).toStrictEqual([]);
  });

  it('stops scanning cmap subtable records when the record list is truncated', () => {
    // numTables claims 2 records but the buffer only has room for one.
    const cmap = new Uint8Array(12);
    const view = new DataView(cmap.buffer);
    view.setUint16(2, 2); // numTables
    view.setUint32(8, 1000); // out-of-range offset, so it's skipped rather than read

    const info = parseSfnt(buildSfnt([{ tag: 'cmap', data: cmap }]));

    expect(info.scripts).toStrictEqual([]);
  });

  it('ignores a cmap subtable whose format is neither 4 nor 12', () => {
    const cmap = new Uint8Array(16);
    const view = new DataView(cmap.buffer);
    view.setUint16(2, 1); // numTables
    view.setUint32(8, 12); // subtable offset
    view.setUint16(12, 6); // format 6, unsupported

    const info = parseSfnt(buildSfnt([{ tag: 'cmap', data: cmap }]));

    expect(info.scripts).toStrictEqual([]);
  });

  it('stops scanning format-12 groups when the group list is truncated', () => {
    // cmap header(4) + one subtable record(8) + format-12 subtable(16 header + 1 group of 12).
    const cmap = new Uint8Array(40);
    const view = new DataView(cmap.buffer);
    view.setUint16(2, 1); // numTables
    view.setUint32(8, 12); // subtable offset
    view.setUint16(12, 12); // format 12
    view.setUint32(24, 2); // numGroups claims 2, but only one fits before byteLength(40)
    view.setUint32(28, 0x41); // group0 startCharCode
    view.setUint32(32, 0x41); // group0 endCharCode
    view.setUint32(36, 0); // group0 startGlyphID

    const info = parseSfnt(buildSfnt([{ tag: 'cmap', data: cmap }]));

    expect(info.scripts).toStrictEqual(['latin']);
  });

  it('reads variable axes from a real fvar table layout', () => {
    const fvar = new Uint8Array(36);
    const view = new DataView(fvar.buffer);
    view.setUint16(0, 1); // majorVersion
    view.setUint16(4, 16); // axesArrayOffset
    view.setUint16(8, 1); // axisCount
    view.setUint16(10, 20); // axisSize
    const tag = 'wght';
    for (let c = 0; c < 4; c++) {
      view.setUint8(16 + c, tag.charCodeAt(c));
    }
    view.setInt32(20, 100 * 65536); // minValue
    view.setInt32(24, 400 * 65536); // defaultValue
    view.setInt32(28, 900 * 65536); // maxValue

    const info = parseSfnt(buildSfnt([{ tag: 'fvar', data: fvar }]));

    expect(info.axes).toStrictEqual([{ tag: 'wght', min: 100, default: 400, max: 900 }]);
  });

  it('stops reading fvar axes when the second axis record is truncated', () => {
    // axisCount claims 2 but the buffer only has room for one 20-byte axis record.
    const fvar = new Uint8Array(36);
    const view = new DataView(fvar.buffer);
    view.setUint16(4, 16); // axesArrayOffset
    view.setUint16(8, 2); // axisCount claims 2
    view.setUint16(10, 20); // axisSize
    const tag = 'wght';
    for (let c = 0; c < 4; c++) {
      view.setUint8(16 + c, tag.charCodeAt(c));
    }
    view.setInt32(20, 100 * 65536);
    view.setInt32(24, 400 * 65536);
    view.setInt32(28, 900 * 65536);

    const info = parseSfnt(buildSfnt([{ tag: 'fvar', data: fvar }]));

    expect(info.axes).toStrictEqual([{ tag: 'wght', min: 100, default: 400, max: 900 }]);
  });
});

describe('parseSfnt legacy family name recovery (no ID16)', () => {
  it('strips a trailing weight token from ID1 when it matches the actual weight', () => {
    // Real IBM Plex Serif data: ID1 = 'IBM Plex Serif Thin', ID2 = 'Regular',
    // no ID16/ID17, usWeightClass = 100. Without recovery this becomes its own
    // "family", fragmenting one typeface into six in the settings dropdown.
    const name = buildNameTable([
      [1, 'IBM Plex Serif Thin'],
      [2, 'Regular'],
    ]);
    const info = parseSfnt(
      buildSfnt([
        { tag: 'name', data: name },
        { tag: 'OS/2', data: buildOs2Full(100, false) },
      ]),
    );

    expect(info.family).toBe('IBM Plex Serif');
  });

  it('recognises a two-word style token (SemiBold written with a space)', () => {
    const name = buildNameTable([
      [1, 'Bodoni Moda Semi Bold'],
      [2, 'Regular'],
    ]);
    const info = parseSfnt(
      buildSfnt([
        { tag: 'name', data: name },
        { tag: 'OS/2', data: buildOs2Full(600, false) },
      ]),
    );

    expect(info.family).toBe('Bodoni Moda');
  });

  it('does not strip a trailing word that only looks like a weight token', () => {
    // "Black Ops One" at weight 400: "Black" maps to 900, which does not match
    // the face's actual weight, so it must not be treated as a style token.
    const name = buildNameTable([
      [1, 'Black Ops One'],
      [2, 'Regular'],
    ]);
    const info = parseSfnt(
      buildSfnt([
        { tag: 'name', data: name },
        { tag: 'OS/2', data: buildOs2Full(400, false) },
      ]),
    );

    expect(info.family).toBe('Black Ops One');
  });

  it('leaves the family alone (uses ID16) when the typographic family is present', () => {
    const name = buildNameTable([
      [1, 'IBM Plex Sans Thin'],
      [2, 'Regular'],
      [16, 'IBM Plex Sans'],
      [17, 'Thin'],
    ]);
    const info = parseSfnt(
      buildSfnt([
        { tag: 'name', data: name },
        { tag: 'OS/2', data: buildOs2Full(250, false) },
      ]),
    );

    expect(info.family).toBe('IBM Plex Sans');
  });
});

describe('parseSfnt weight recovery from style tokens (broken usWeightClass)', () => {
  it('prefers the weight implied by ID17 over a colliding usWeightClass', () => {
    // Real IBM Plex Sans data: both the Thin and ExtraLight faces report
    // usWeightClass = 250, which collapses two distinct faces onto one selection
    // key downstream. ID17 ('Thin' / 'ExtraLight') disambiguates them.
    const thin = buildNameTable([
      [1, 'IBM Plex Sans Thin'],
      [2, 'Regular'],
      [16, 'IBM Plex Sans'],
      [17, 'Thin'],
    ]);
    const extraLight = buildNameTable([
      [1, 'IBM Plex Sans ExtraLight'],
      [2, 'Regular'],
      [16, 'IBM Plex Sans'],
      [17, 'ExtraLight'],
    ]);

    const thinInfo = parseSfnt(
      buildSfnt([
        { tag: 'name', data: thin },
        { tag: 'OS/2', data: buildOs2Full(250, false) },
      ]),
    );
    const extraLightInfo = parseSfnt(
      buildSfnt([
        { tag: 'name', data: extraLight },
        { tag: 'OS/2', data: buildOs2Full(250, false) },
      ]),
    );

    expect(thinInfo.weight).toBe(100);
    expect(extraLightInfo.weight).toBe(200);
    expect(thinInfo.weight).not.toBe(extraLightInfo.weight);
  });

  it('derives the weight from the token stripped out of ID1 when there is no ID16/ID17', () => {
    const name = buildNameTable([
      [1, 'IBM Plex Serif Light'],
      [2, 'Regular'],
    ]);
    const info = parseSfnt(
      buildSfnt([
        { tag: 'name', data: name },
        { tag: 'OS/2', data: buildOs2Full(300, false) },
      ]),
    );

    expect(info.weight).toBe(300);
    expect(info.family).toBe('IBM Plex Serif');
  });

  it.each([
    ['Regular', 400],
    ['Medium', 500],
    ['Bold', 700],
    ['ExtraBold', 800],
    ['UltraBold', 800],
    ['Black', 900],
    ['Heavy', 900],
  ])('recovers weight %s -> %d from ID1 when there is no ID16/ID17', (token, weight) => {
    const name = buildNameTable([
      [1, `Some Family ${token}`],
      [2, 'Regular'],
    ]);
    const info = parseSfnt(
      buildSfnt([
        { tag: 'name', data: name },
        { tag: 'OS/2', data: buildOs2Full(weight, false) },
      ]),
    );

    expect(info.weight).toBe(weight);
    expect(info.family).toBe('Some Family');
  });

  it('falls back to usWeightClass when ID17 is present but not a recognisable style word', () => {
    const name = buildNameTable([
      [1, 'IBM Plex Sans Condensed'],
      [2, 'Regular'],
      [16, 'IBM Plex Sans Condensed'],
      [17, 'Condensed'],
    ]);
    const info = parseSfnt(
      buildSfnt([
        { tag: 'name', data: name },
        { tag: 'OS/2', data: buildOs2Full(400, false) },
      ]),
    );

    expect(info.weight).toBe(400);
  });

  it('falls back to usWeightClass when neither ID17 nor a recognisable ID1 token exists', () => {
    const name = buildNameTable([
      [1, 'Some Condensed Face'],
      [2, 'Regular'],
    ]);
    const info = parseSfnt(
      buildSfnt([
        { tag: 'name', data: name },
        { tag: 'OS/2', data: buildOs2Full(650, false) },
      ]),
    );

    expect(info.weight).toBe(650);
    expect(info.family).toBe('Some Condensed Face');
  });

  it('keeps two same-weight faces of Noto Color Emoji colliding as before (not a bug)', () => {
    // COLRv1 and OT-SVG builds of the same face: no ID17, ID1 carries no style
    // token, usWeightClass is a genuine 400 for both — must still collide, that
    // collision is what lets per-platform selection choose between them.
    const name = buildNameTable([
      [1, 'Noto Color Emoji'],
      [2, 'Regular'],
    ]);
    const info = parseSfnt(
      buildSfnt([
        { tag: 'name', data: name },
        { tag: 'OS/2', data: buildOs2Full(400, false) },
      ]),
    );

    expect(info.weight).toBe(400);
  });
});
