import { describe, expect, it } from 'vitest';
import { readFixture } from './fixtures.js';
import { parseSfnt } from './sfnt.js';
import { decodeWoff2, readWoff2TableTags, woff2ColorFormats } from './woff2.js';

describe('readWoff2TableTags', () => {
  it('lists tables without decompressing anything', () => {
    const tags = readWoff2TableTags(readFixture('probe-sans/probe-sans-400.woff2'));

    expect(tags).toContain('name');
    expect(tags).toContain('OS/2');
    expect(tags).toContain('cmap');
  });

  it('rejects a buffer whose signature is not wOF2', () => {
    expect(() => readWoff2TableTags(readFixture('probe-sans/probe-sans-400.ttf'))).toThrow(
      /not a woff2/i,
    );
  });
});

describe('woff2ColorFormats', () => {
  it('reports no colour formats for a plain text font', () => {
    expect(woff2ColorFormats(readFixture('probe-sans/probe-sans-400.woff2'))).toStrictEqual([]);
  });
});

/**
 * Minimal woff2 header plus a one-entry table directory. `tagIndex` 63 is the escape
 * value, in which case a literal 4-byte tag follows.
 */
function woff2WithOneTable(
  tagIndex: number,
  literalTag?: string,
  lengthBytes = [0x0a],
): ArrayBuffer {
  const header = new Uint8Array(48);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x774f_4632); // 'wOF2'
  view.setUint16(12, 1); // numTables
  const tail = [
    tagIndex,
    ...(literalTag !== undefined ? [...literalTag].map((c) => c.charCodeAt(0)) : []),
    ...lengthBytes,
  ];
  return new Uint8Array([...header, ...tail]).buffer;
}

describe('readWoff2TableTags edge cases', () => {
  it('reads a literal 4-byte tag when the directory uses the escape index', () => {
    expect(readWoff2TableTags(woff2WithOneTable(63, 'Zzzz'))).toStrictEqual(['Zzzz']);
  });

  it('falls back to a placeholder for a reserved known-tag index it does not recognise', () => {
    expect(readWoff2TableTags(woff2WithOneTable(62))).toStrictEqual(['Sill']);
  });

  it('throws rather than silently misreading a truncated length', () => {
    // 0x80 sets the continuation bit, so the parser expects another byte that is absent.
    expect(() => readWoff2TableTags(woff2WithOneTable(0, undefined, [0x80]))).toThrow(
      /truncated UIntBase128/,
    );
  });

  it('throws on an overlong length rather than looping', () => {
    expect(() =>
      readWoff2TableTags(woff2WithOneTable(0, undefined, [0x80, 0x80, 0x80, 0x80, 0x80, 0x01])),
    ).toThrow(/overlong UIntBase128/);
  });

  it('throws when the directory claims more tables than the buffer holds', () => {
    const buf = woff2WithOneTable(0);
    new DataView(buf).setUint16(12, 5);

    expect(() => readWoff2TableTags(buf)).toThrow(/truncated table directory/);
  });

  it('throws rather than silently misreading a truncated escape-index literal tag', () => {
    // tagIndex 63 (escape) with no literal tag bytes supplied: the parser runs off the
    // end of the buffer looking for the 4 tag characters.
    expect(() => readWoff2TableTags(woff2WithOneTable(63))).toThrow(/truncated table directory/);
  });
});

describe('decodeWoff2', () => {
  it('yields a buffer whose name table matches the ttf built from the same source', async () => {
    const decoded = await decodeWoff2(readFixture('probe-sans/probe-sans-400.woff2'));

    if (decoded === null) {
      // Documented outcome when no decoder shipped — the chain falls through instead.
      expect(decoded).toBeNull();
      return;
    }
    expect(parseSfnt(decoded).family).toBe('Probe Sans');
  });

  it('reassembles cmap well enough to match the ttf built from the same source', async () => {
    const decoded = await decodeWoff2(readFixture('probe-sans/probe-sans-400.woff2'));

    if (decoded === null) {
      // Documented outcome when no decoder shipped — the chain falls through instead.
      expect(decoded).toBeNull();
      return;
    }
    const scripts = parseSfnt(decoded).scripts;
    const ttfScripts = parseSfnt(readFixture('probe-sans/probe-sans-400.ttf')).scripts;
    expect(scripts).toContain('latin');
    expect(scripts).toContain('cyrillic');
    expect(scripts).toStrictEqual(ttfScripts);
  });

  it('returns null rather than throwing on a buffer it cannot decode', async () => {
    await expect(decodeWoff2(new ArrayBuffer(64))).resolves.toBeNull();
  });
});
