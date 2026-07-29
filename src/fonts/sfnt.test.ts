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
