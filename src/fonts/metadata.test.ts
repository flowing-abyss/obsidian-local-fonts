import { describe, expect, it } from 'vitest';
import { readFixture } from '../../tests/fixtures.js';
import { extractMetadata } from './metadata.js';
import { parseSfnt } from './sfnt.js';

function fixtureReader(map: Record<string, ArrayBuffer>) {
  return async (p: string): Promise<ArrayBuffer> => {
    const found = map[p];
    if (found === undefined) {
      throw new Error(`no such fixture: ${p}`);
    }
    return found;
  };
}

/**
 * The smallest possible valid sfnt: a 12-byte header (recognised version tag, zero
 * tables) and nothing else. parseSfnt accepts it (no throw) but every optional table
 * is missing, so it reports an empty family — a "successfully parsed, but unusable"
 * result distinct from a throw, used to exercise the family-empty branches below.
 */
function emptySfnt(): ArrayBuffer {
  const buf = new ArrayBuffer(12);
  new DataView(buf).setUint32(0, 0x00010000);
  return buf;
}

async function deflate(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  }).pipeThrough(new CompressionStream('deflate'));
  return new Response(stream).arrayBuffer();
}

/**
 * A minimal sfnt `name` table with a single family (nameId 1) record, platform 3
 * (Windows), encoded UTF-16BE per spec. `family` must be ASCII (fixture names are).
 */
function buildNameTable(family: string): Uint8Array {
  const text = new Uint8Array(family.length * 2);
  for (let i = 0; i < family.length; i++) {
    text[i * 2] = 0;
    text[i * 2 + 1] = family.charCodeAt(i);
  }
  const stringOffset = 6 + 12;
  const buf = new Uint8Array(stringOffset + text.byteLength);
  const view = new DataView(buf.buffer);
  view.setUint16(0, 0); // format
  view.setUint16(2, 1); // count
  view.setUint16(4, stringOffset);
  view.setUint16(6, 3); // platformID: Windows
  view.setUint16(8, 1); // encodingID
  view.setUint16(10, 0x0409); // languageID
  view.setUint16(12, 1); // nameID: family
  view.setUint16(14, text.byteLength);
  view.setUint16(16, 0); // offset within string storage
  buf.set(text, stringOffset);
  return buf;
}

interface Woff1TableSpec {
  body: Uint8Array;
  compress?: boolean;
  /** Lie in the directory's compLength field without changing what's actually written — simulates a corrupt/truncated entry. */
  compLengthOverride?: number;
}

/**
 * Build a genuine WOFF1 container (44-byte header + 20-byte-per-table directory) around
 * the given table bodies, used to test decodeWoff1 against the real format rather than
 * the whole-file-deflate shortcut a naive implementation might take. Each table is
 * stored either raw (compLength === origLength, the common case for small tables) or
 * zlib-deflate compressed, exercising both branches the real spec allows.
 * `numTablesOverride` lets a caller claim more tables than are actually written, to
 * simulate a truncated directory.
 */
async function buildWoff1(
  tables: Record<string, Woff1TableSpec>,
  numTablesOverride?: number,
): Promise<ArrayBuffer> {
  const prepared = await Promise.all(
    Object.entries(tables).map(async ([tag, { body, compress, compLengthOverride }]) => {
      const stored = compress === true ? new Uint8Array(await deflate(body.slice().buffer)) : body;
      return { tag, stored, origLength: body.byteLength, compLengthOverride };
    }),
  );

  const headerSize = 44;
  const dirSize = prepared.length * 20;
  let offset = headerSize + dirSize;
  const placed = prepared.map((t) => {
    const entry = { ...t, offset };
    offset += t.stored.byteLength;
    return entry;
  });

  const out = new Uint8Array(offset);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x774f_4646); // 'wOFF'
  view.setUint32(4, 0x0001_0000); // flavor
  view.setUint32(8, offset); // length
  view.setUint16(12, numTablesOverride ?? placed.length); // numTables

  placed.forEach((table, index) => {
    const base = headerSize + index * 20;
    for (let c = 0; c < 4; c++) {
      view.setUint8(base + c, table.tag.charCodeAt(c));
    }
    view.setUint32(base + 4, table.offset);
    view.setUint32(base + 8, table.compLengthOverride ?? table.stored.byteLength); // compLength
    view.setUint32(base + 12, table.origLength);
    view.setUint32(base + 16, 0); // origChecksum, unverified by this codebase's reader
    out.set(table.stored, table.offset);
  });

  return out.buffer;
}

describe('extractMetadata', () => {
  it('reads the name table directly for a ttf (level 1)', async () => {
    const record = await extractMetadata({
      path: '.fonts/probe-sans/probe-sans-400.ttf',
      size: 100,
      mtime: 1,
      siblings: [],
      read: fixtureReader({
        '.fonts/probe-sans/probe-sans-400.ttf': readFixture('probe-sans/probe-sans-400.ttf'),
      }),
    });

    expect(record.family).toBe('Probe Sans');
    expect(record.weight).toBe(400);
    expect(record.source).toBe('name-table');
    expect(record.format).toBe('ttf');
  });

  it('falls back to the sibling ttf when the woff2 cannot be decoded (level 4)', async () => {
    const record = await extractMetadata({
      path: '.fonts/probe-mono/probe-mono-400.woff2',
      size: 100,
      mtime: 1,
      siblings: ['.fonts/probe-mono/probe-mono-400.ttf'],
      read: fixtureReader({
        '.fonts/probe-mono/probe-mono-400.woff2': readFixture('probe-mono/probe-mono-400.woff2'),
        // A ttf whose name table says Probe Sans, so a level-4 hit is distinguishable
        // from a level-1 or level-5 result.
        '.fonts/probe-mono/probe-mono-400.ttf': readFixture('probe-sans/probe-sans-400.ttf'),
      }),
    });

    expect(['name-table', 'sibling']).toContain(record.source);
    if (record.source === 'sibling') {
      expect(record.family).toBe('Probe Sans');
    }
  });

  it('falls back to the sibling ttf when the woff2 buffer is not decodable at all (level 4, forced)', async () => {
    // decodeWoff2 in src/fonts/woff2.ts is a genuine decoder and successfully reassembles
    // enough of the fixture woff2s in this repo to read their name table directly (level 1).
    // To exercise the sibling level for real, feed it a buffer that is not a woff2 at all,
    // so decodeWoff2 is guaranteed to return null and extractMetadata must fall through.
    const garbage = new ArrayBuffer(16);

    const record = await extractMetadata({
      path: '.fonts/probe-broken/probe-broken-400.woff2',
      size: 100,
      mtime: 1,
      siblings: ['.fonts/probe-broken/probe-broken-400.ttf'],
      read: fixtureReader({
        '.fonts/probe-broken/probe-broken-400.woff2': garbage,
        '.fonts/probe-broken/probe-broken-400.ttf': readFixture('probe-sans/probe-sans-400.ttf'),
      }),
    });

    expect(record.source).toBe('sibling');
    expect(record.family).toBe('Probe Sans');
    expect(record.format).toBe('woff2');
  });

  it('falls back to the filename when nothing can be read (level 5)', async () => {
    const record = await extractMetadata({
      path: '.fonts/weird/some-font-600italic.woff2',
      size: 100,
      mtime: 1,
      siblings: [],
      read: async () => new ArrayBuffer(8),
    });

    expect(record.source).toBe('filename');
    expect(record.weight).toBe(600);
    expect(record.italic).toBe(true);
    expect(record.family).toBe('Some Font');
  });

  it('reads the name table from a real woff2 with no sibling available (level 3, pinned)', async () => {
    // With siblings: [], a passing 'source: name-table' result can ONLY come from a
    // genuine decodeWoff2 -> parseSfnt round trip: there is no fallback path that could
    // produce this family. This is the test that would fail if the wiring between
    // metadata.ts and decodeWoff2 broke, which neither of the other woff2 tests would
    // catch (one tolerates a sibling fallback, the other only checks colorFormats).
    const ttfInfo = parseSfnt(readFixture('probe-sans/probe-sans-400.ttf'));

    const record = await extractMetadata({
      path: '.fonts/probe-sans/probe-sans-400.woff2',
      size: 100,
      mtime: 1,
      siblings: [],
      read: fixtureReader({
        '.fonts/probe-sans/probe-sans-400.woff2': readFixture('probe-sans/probe-sans-400.woff2'),
      }),
    });

    expect(record.source).toBe('name-table');
    expect(record.family).toBe('Probe Sans');
    expect(record.scripts.length).toBeGreaterThan(0);
    expect(record.scripts).toStrictEqual(ttfInfo.scripts);
  });

  it('always reports colour formats for a woff2, even without a decoder', async () => {
    const record = await extractMetadata({
      path: '.fonts/probe-sans/probe-sans-400.woff2',
      size: 100,
      mtime: 1,
      siblings: [],
      read: fixtureReader({
        '.fonts/probe-sans/probe-sans-400.woff2': readFixture('probe-sans/probe-sans-400.woff2'),
      }),
    });

    expect(record.colorFormats).toStrictEqual([]);
  });

  it('preserves the path, size and mtime it was given', async () => {
    const record = await extractMetadata({
      path: '.fonts/x/y-400.ttf',
      size: 4242,
      mtime: 99,
      siblings: [],
      read: async () => new ArrayBuffer(8),
    });

    expect(record).toMatchObject({ path: '.fonts/x/y-400.ttf', size: 4242, mtime: 99 });
  });

  it('never throws when the read callback rejects', async () => {
    const record = await extractMetadata({
      path: '.fonts/y/z-400.ttf',
      size: 1,
      mtime: 1,
      siblings: [],
      read: async () => {
        throw new Error('boom');
      },
    });

    expect(record.source).toBe('filename');
    expect(record.family).toBe('Z');
  });

  it('never throws when the read callback rejects for a woff2', async () => {
    // Exercises the outer try/catch around the raw read in readSfntInfo for the
    // woff2/woff branch, distinct from the ttf/otf path covered by the previous test.
    const record = await extractMetadata({
      path: '.fonts/y/z-400.woff2',
      size: 1,
      mtime: 1,
      siblings: [],
      read: async () => {
        throw new Error('boom');
      },
    });

    expect(record.source).toBe('filename');
    expect(record.family).toBe('Z');
    expect(record.colorFormats).toStrictEqual([]);
  });

  it('falls back to the filename when a woff buffer has no wOFF signature', async () => {
    // Exercises decodeWoff1's own catch: a buffer that is too short/wrong-signature to
    // even be a WOFF1 header must not escape extractMetadata as a thrown error.
    const record = await extractMetadata({
      path: '.fonts/y/z-400.woff',
      size: 1,
      mtime: 1,
      siblings: [],
      read: fixtureReader({
        '.fonts/y/z-400.woff': new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer,
      }),
    });

    expect(record.source).toBe('filename');
    expect(record.family).toBe('Z');
  });

  it('falls back to the filename when a WOFF1 directory is truncated', async () => {
    // The header claims 5 tables but the buffer ends right after the header, with no
    // room for even one directory entry. readWoff1Directory must stop at the buffer's
    // edge instead of reading past it, yielding no usable tables.
    const truncated = await buildWoff1({}, 5);

    const record = await extractMetadata({
      path: '.fonts/truncated/truncated-400.woff',
      size: 100,
      mtime: 1,
      siblings: [],
      read: fixtureReader({ '.fonts/truncated/truncated-400.woff': truncated }),
    });

    expect(record.source).toBe('filename');
    expect(record.family).toBe('Truncated');
  });

  it('skips a WOFF1 table entry whose recorded length runs past the end of the buffer', async () => {
    // A corrupt or malicious directory entry can claim a compLength that would read
    // past the file's actual size; inflateWoff1Table must bounds-check this the same
    // way sfnt.ts's tableView does, and decodeWoff1 must treat it as "no usable table"
    // rather than throwing on an out-of-range read.
    const corrupt = await buildWoff1({
      name: { body: new Uint8Array(8), compLengthOverride: 999_999 },
    });

    const record = await extractMetadata({
      path: '.fonts/corrupt/corrupt-400.woff',
      size: 100,
      mtime: 1,
      siblings: [],
      read: fixtureReader({ '.fonts/corrupt/corrupt-400.woff': corrupt }),
    });

    expect(record.source).toBe('filename');
    expect(record.family).toBe('Corrupt');
  });

  it('skips a WOFF1 table entry whose compressed bytes are not valid deflate', async () => {
    // Distinct from the bounds-violation test above: this entry is fully in-bounds and
    // genuinely marked as compressed (compLength !== origLength), but the bytes it
    // points at are not a valid deflate stream. DecompressionStream rejects, and that
    // per-table failure must not propagate past decodeWoff1.
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const badDeflate = await buildWoff1({
      name: { body: garbage, compLengthOverride: garbage.byteLength - 1 },
    });

    const record = await extractMetadata({
      path: '.fonts/bad-deflate/bad-deflate-400.woff',
      size: 100,
      mtime: 1,
      siblings: [],
      read: fixtureReader({ '.fonts/bad-deflate/bad-deflate-400.woff': badDeflate }),
    });

    expect(record.source).toBe('filename');
    expect(record.family).toBe('Bad Deflate');
  });

  it('ignores the file itself when scanning for a sibling', async () => {
    // siblings may legitimately include the path being processed (e.g. a folder
    // listing that was not pre-filtered); findSibling must skip it rather than
    // treating the file as its own sibling.
    const record = await extractMetadata({
      path: '.fonts/probe-broken/probe-broken-400.woff2',
      size: 100,
      mtime: 1,
      siblings: [
        '.fonts/probe-broken/probe-broken-400.woff2',
        '.fonts/probe-broken/probe-broken-400.ttf',
      ],
      read: fixtureReader({
        '.fonts/probe-broken/probe-broken-400.woff2': new ArrayBuffer(16),
        '.fonts/probe-broken/probe-broken-400.ttf': readFixture('probe-sans/probe-sans-400.ttf'),
      }),
    });

    expect(record.source).toBe('sibling');
    expect(record.family).toBe('Probe Sans');
  });

  it('reads a real WOFF1 fixture end to end (level 2)', async () => {
    // probe-sans-400.woff is a genuine WOFF1 file built by fontTools from the same
    // source as probe-sans-400.ttf (see scripts/make-fixtures.py): 44-byte header, a
    // real table directory, and a mix of zlib-deflated tables (OS/2, cmap, name are
    // all compressed in this fixture) and raw-stored ones (head, loca). Ground truth
    // comes from parsing the sibling ttf directly, not from a hardcoded expectation.
    const ttfInfo = parseSfnt(readFixture('probe-sans/probe-sans-400.ttf'));

    const record = await extractMetadata({
      path: '.fonts/probe-sans/probe-sans-400.woff',
      size: 100,
      mtime: 1,
      siblings: [],
      read: fixtureReader({
        '.fonts/probe-sans/probe-sans-400.woff': readFixture('probe-sans/probe-sans-400.woff'),
      }),
    });

    expect(record.source).toBe('name-table');
    expect(record.format).toBe('woff');
    expect(record.family).toBe(ttfInfo.family);
    expect(record.weight).toBe(ttfInfo.weight);
    expect(record.scripts.length).toBeGreaterThan(0);
    expect(record.scripts).toStrictEqual(ttfInfo.scripts);
  });

  it('reads a raw-stored (uncompressed) table from a synthetic WOFF1', async () => {
    // The real fixture above happens to store all four reassembly-worthy tables
    // (OS/2/cmap/fvar/name) compressed; WOFF1 also allows storing a table raw when
    // compLength === origLength, which is common for small tables. This pins that
    // branch down directly with a hand-built container.
    const nameTable = buildNameTable('Synthetic Family');
    const woff1 = await buildWoff1({ name: { body: nameTable } });

    const record = await extractMetadata({
      path: '.fonts/synthetic/synthetic-400.woff',
      size: 100,
      mtime: 1,
      siblings: [],
      read: fixtureReader({ '.fonts/synthetic/synthetic-400.woff': woff1 }),
    });

    expect(record.source).toBe('name-table');
    expect(record.family).toBe('Synthetic Family');
  });

  it('skips a non-matching sibling candidate instead of stopping at it', async () => {
    // A folder listing can contain unrelated files (different stem, no extension at
    // all, or a stem match with a non-font extension); findSibling must walk past
    // them to find the real sibling, and stemOf must tolerate a candidate with no
    // extension along the way.
    const record = await extractMetadata({
      path: '.fonts/probe-broken/probe-broken-400.woff2',
      size: 100,
      mtime: 1,
      siblings: [
        'README',
        '.fonts/probe-broken/other-font-400.ttf',
        '.fonts/probe-broken/probe-broken-400.ttf',
      ],
      read: fixtureReader({
        '.fonts/probe-broken/probe-broken-400.woff2': new ArrayBuffer(16),
        '.fonts/probe-broken/other-font-400.ttf': new ArrayBuffer(16),
        '.fonts/probe-broken/probe-broken-400.ttf': readFixture('probe-sans/probe-sans-400.ttf'),
      }),
    });

    expect(record.source).toBe('sibling');
    expect(record.family).toBe('Probe Sans');
  });

  it('recognises an otf sibling with the same stem', async () => {
    // formatOf identifies the container by extension only; parseSfnt doesn't care
    // that the bytes originated from a .ttf fixture, so this genuinely exercises the
    // 'otf' arm of findSibling's format check.
    const record = await extractMetadata({
      path: '.fonts/probe-broken/probe-broken-400.woff2',
      size: 100,
      mtime: 1,
      siblings: ['.fonts/probe-broken/probe-broken-400.otf'],
      read: fixtureReader({
        '.fonts/probe-broken/probe-broken-400.woff2': new ArrayBuffer(16),
        '.fonts/probe-broken/probe-broken-400.otf': readFixture('probe-sans/probe-sans-400.ttf'),
      }),
    });

    expect(record.source).toBe('sibling');
    expect(record.family).toBe('Probe Sans');
  });

  it('rejects a sibling that parses but carries no usable family', async () => {
    // The sibling file is a structurally valid sfnt (recognised version tag) but has
    // no name table at all, so parseSfnt returns successfully with an empty family.
    // tryParseSfnt must treat that the same as "no sibling", not accept it.
    const record = await extractMetadata({
      path: '.fonts/empty/empty-400.woff2',
      size: 100,
      mtime: 1,
      siblings: ['.fonts/empty/empty-400.ttf'],
      read: fixtureReader({
        '.fonts/empty/empty-400.woff2': new ArrayBuffer(16),
        '.fonts/empty/empty-400.ttf': emptySfnt(),
      }),
    });

    expect(record.source).toBe('filename');
    expect(record.family).toBe('Empty');
  });

  it('falls through level 2 when a woff decodes but carries no usable family', async () => {
    // Distinct from the "no wOFF signature" test: here decodeWoff1 succeeds (a
    // genuine WOFF1 container, reassembled to a valid sfnt) and parseSfnt does not
    // throw, but the only table present is OS/2 — no `name` table at all — so
    // readSfntInfo's own family check must reject it and fall through to the sibling.
    const woff1 = await buildWoff1({ 'OS/2': { body: new Uint8Array(4) } });

    const record = await extractMetadata({
      path: '.fonts/empty2/empty2-400.woff',
      size: 100,
      mtime: 1,
      siblings: ['.fonts/empty2/empty2-400.ttf'],
      read: fixtureReader({
        '.fonts/empty2/empty2-400.woff': woff1,
        '.fonts/empty2/empty2-400.ttf': readFixture('probe-sans/probe-sans-400.ttf'),
      }),
    });

    expect(record.source).toBe('sibling');
    expect(record.family).toBe('Probe Sans');
  });

  it('defaults to ttf when the path has no recognisable extension', async () => {
    const record = await extractMetadata({
      path: '.fonts/mystery/probe-sans-400',
      size: 100,
      mtime: 1,
      siblings: [],
      read: fixtureReader({
        '.fonts/mystery/probe-sans-400': readFixture('probe-sans/probe-sans-400.ttf'),
      }),
    });

    expect(record.format).toBe('ttf');
    expect(record.family).toBe('Probe Sans');
    expect(record.source).toBe('name-table');
  });

  it('keeps the parsed colour formats for a non-woff2 face that has them', async () => {
    // probe-emoji-colr.ttf carries a real COLR table; format is 'ttf', so the woff2
    // colour-format override never runs and the final ternary's "already populated"
    // branch must be the one that wins.
    const record = await extractMetadata({
      path: '.fonts/probe-emoji/probe-emoji-colr.ttf',
      size: 100,
      mtime: 1,
      siblings: [],
      read: fixtureReader({
        '.fonts/probe-emoji/probe-emoji-colr.ttf': readFixture('probe-emoji/probe-emoji-colr.ttf'),
      }),
    });

    expect(record.colorFormats).toContain('COLR0');
  });
});
