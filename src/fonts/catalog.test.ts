import { describe, expect, it } from 'vitest';
import { buildCache, groupIntoFamilies, isCacheStale } from './catalog.js';
import { readFixture } from './fixtures.js';
import type { FontAdapter } from './scanner.js';
import { CACHE_VERSION, type FaceRecord, type FontCache } from './types.js';

function face(overrides: Partial<FaceRecord>): FaceRecord {
  return {
    path: '.fonts/a-400.woff2',
    format: 'woff2',
    size: 10,
    mtime: 1,
    family: 'A',
    weight: 400,
    italic: false,
    colorFormats: [],
    scripts: [],
    axes: [],
    license: null,
    source: 'name-table',
    ...overrides,
  };
}

const cache = (faces: FaceRecord[]): FontCache => ({
  version: CACHE_VERSION,
  folder: '.fonts',
  faces,
});

describe('isCacheStale', () => {
  it('is stale when there is no cache at all', () => {
    expect(isCacheStale(null, '.fonts', [])).toBe(true);
  });

  it('is stale when the folder setting changed', () => {
    expect(isCacheStale(cache([]), '.other', [])).toBe(true);
  });

  it('is stale when the cache version predates the current record shape', () => {
    const old = { ...cache([]), version: 0 } as unknown as FontCache;

    expect(isCacheStale(old, '.fonts', [])).toBe(true);
  });

  it('is fresh when every path, size and mtime still match', () => {
    const files = [{ path: '.fonts/a-400.woff2', size: 10, mtime: 1 }];

    expect(isCacheStale(cache([face({})]), '.fonts', files)).toBe(false);
  });

  it('is stale when a file was modified', () => {
    const files = [{ path: '.fonts/a-400.woff2', size: 10, mtime: 2 }];

    expect(isCacheStale(cache([face({})]), '.fonts', files)).toBe(true);
  });

  it('is stale when a file was added', () => {
    const files = [
      { path: '.fonts/a-400.woff2', size: 10, mtime: 1 },
      { path: '.fonts/b-400.woff2', size: 10, mtime: 1 },
    ];

    expect(isCacheStale(cache([face({})]), '.fonts', files)).toBe(true);
  });
});

describe('buildCache', () => {
  it('keeps every competing format for the same family and weight, choosing none of them', async () => {
    // probe-sans/ has four real files: 400 as ttf, woff2 and woff, plus 700italic.ttf.
    // Picking a "best" format per weight is exactly the platform-dependent decision this
    // cache must never make - that choice belongs to css.ts, on the rendering device.
    // If buildCache (or something it calls) ever started filtering to one format per
    // family+weight, this would collapse to 2 faces and fail.
    const files = [
      '.fonts/probe-sans/probe-sans-400.ttf',
      '.fonts/probe-sans/probe-sans-400.woff2',
      '.fonts/probe-sans/probe-sans-400.woff',
      '.fonts/probe-sans/probe-sans-700italic.ttf',
    ];
    function list(path: string): { files: string[]; folders: string[] } {
      if (path === '.fonts') {
        return { files: [], folders: ['.fonts/probe-sans'] };
      }
      if (path === '.fonts/probe-sans') {
        return { files, folders: [] };
      }
      return { files: [], folders: [] };
    }
    const adapter: FontAdapter = {
      list: (path) => Promise.resolve(list(path)),
      stat: () => Promise.resolve({ size: 1234, mtime: 42 }),
      readBinary: (path) =>
        Promise.resolve(readFixture(`probe-sans/${path.slice(path.lastIndexOf('/') + 1)}`)),
    };

    const result = await buildCache(adapter, '.fonts');

    expect(result.faces).toHaveLength(4);
    const formatsAt400 = result.faces.filter((f) => f.weight === 400).map((f) => f.format);
    const sortedFormats = [...formatsAt400].sort((a, b) => a.localeCompare(b));
    expect(sortedFormats).toStrictEqual(['ttf', 'woff', 'woff2']);
  });
});

describe('groupIntoFamilies', () => {
  it('groups faces by their real family name, not by folder', () => {
    const grouped = groupIntoFamilies([
      face({ path: '.fonts/x/one.woff2', family: 'Probe Sans' }),
      face({ path: '.fonts/y/two.woff2', family: 'Probe Sans', weight: 700 }),
      face({ path: '.fonts/z/three.woff2', family: 'Probe Mono' }),
    ]);

    const sortedKeys = [...grouped.keys()].sort((a, b) => a.localeCompare(b));
    expect(sortedKeys).toStrictEqual(['Probe Mono', 'Probe Sans']);
    expect(grouped.get('Probe Sans')).toHaveLength(2);
  });

  it('orders faces by weight then style, so diagnostics read predictably', () => {
    const grouped = groupIntoFamilies([
      face({ path: '.fonts/c.woff2', weight: 700 }),
      face({ path: '.fonts/b.woff2', weight: 400, italic: true }),
      face({ path: '.fonts/a.woff2', weight: 400 }),
    ]);

    expect(grouped.get('A')?.map((f) => [f.weight, f.italic])).toStrictEqual([
      [400, false],
      [400, true],
      [700, false],
    ]);
  });
});
