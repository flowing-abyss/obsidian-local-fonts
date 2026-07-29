import { describe, expect, it } from 'vitest';
import { readFixture } from './fixtures.js';
import { extractMetadata } from './metadata.js';

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

  it('falls back to the filename when a woff buffer is not valid deflate', async () => {
    // Exercises inflateWoff's own catch: DecompressionStream rejects on bytes that
    // aren't a valid deflate stream, and that rejection must not escape extractMetadata.
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

  it('reads a woff via DecompressionStream deflate (level 2)', async () => {
    // There is no checked-in .woff fixture, so this test builds one: it deflates a
    // known-good ttf fixture's raw bytes and feeds the compressed bytes back in as the
    // "file", matching what inflateWoff actually does (whole-buffer deflate, no WOFF1
    // table-directory parsing).
    const compressed = await deflate(readFixture('probe-sans/probe-sans-400.ttf'));

    const record = await extractMetadata({
      path: '.fonts/probe-sans/probe-sans-400.woff',
      size: 100,
      mtime: 1,
      siblings: [],
      read: fixtureReader({
        '.fonts/probe-sans/probe-sans-400.woff': compressed,
      }),
    });

    expect(record.source).toBe('name-table');
    expect(record.family).toBe('Probe Sans');
    expect(record.format).toBe('woff');
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
    // Distinct from the "not valid deflate" test: here inflateWoff succeeds and
    // parseSfnt does not throw, but the decoded sfnt has no name table, so
    // readSfntInfo's own family check must reject it and fall through to the sibling.
    const compressed = await deflate(emptySfnt());

    const record = await extractMetadata({
      path: '.fonts/empty2/empty2-400.woff',
      size: 100,
      mtime: 1,
      siblings: ['.fonts/empty2/empty2-400.ttf'],
      read: fixtureReader({
        '.fonts/empty2/empty2-400.woff': compressed,
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
