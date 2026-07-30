import { describe, expect, it } from 'vitest';
import { readFixture } from '../../tests/fixtures.js';
import { buildCache, groupIntoFamilies, isCacheStale } from './catalog.js';
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

/** A single-subfolder `list()` implementation shared by the `buildCache` tests below:
 *  `.fonts` contains one subfolder, `.fonts/probe-sans`, which holds `files`. */
function listSingleSubfolder(
  files: readonly string[],
): (path: string) => { files: string[]; folders: string[] } {
  return (path) => {
    if (path === '.fonts') {
      return { files: [], folders: ['.fonts/probe-sans'] };
    }
    if (path === '.fonts/probe-sans') {
      return { files: [...files], folders: [] };
    }
    return { files: [], folders: [] };
  };
}

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

  it('is stale when a file was removed', () => {
    const cached = cache([face({}), face({ path: '.fonts/b-400.woff2' })]);
    const files = [{ path: '.fonts/a-400.woff2', size: 10, mtime: 1 }];

    expect(isCacheStale(cached, '.fonts', files)).toBe(true);
  });

  it('is stale when a file changed size but not mtime', () => {
    const files = [{ path: '.fonts/a-400.woff2', size: 999, mtime: 1 }];

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
    const adapter: FontAdapter = {
      list: (path) => Promise.resolve(listSingleSubfolder(files)(path)),
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

  describe('incremental rescan', () => {
    // probe-sans/ has four real files; every file gets a distinct, stable mtime so a
    // single touched file can be identified unambiguously.
    const files = [
      '.fonts/probe-sans/probe-sans-400.ttf',
      '.fonts/probe-sans/probe-sans-400.woff2',
      '.fonts/probe-sans/probe-sans-400.woff',
      '.fonts/probe-sans/probe-sans-700italic.ttf',
    ];

    function makeAdapter(stats: Map<string, { size: number; mtime: number }>): {
      adapter: FontAdapter;
      reads: string[];
    } {
      const reads: string[] = [];
      const adapter: FontAdapter = {
        list: (path) => Promise.resolve(listSingleSubfolder(files)(path)),
        stat: (path) => Promise.resolve(stats.get(path) ?? null),
        readBinary: (path) => {
          reads.push(path);
          return Promise.resolve(
            readFixture(`probe-sans/${path.slice(path.lastIndexOf('/') + 1)}`),
          );
        },
      };
      return { adapter, reads };
    }

    function baselineStats(): Map<string, { size: number; mtime: number }> {
      return new Map(
        files.map((path, index) => [path, { size: 1000 + index, mtime: 100 + index }]),
      );
    }

    it('reuses every unchanged record and parses only the file that changed', async () => {
      const stats = baselineStats();
      const full = await buildCache(makeAdapter(stats).adapter, '.fonts');

      // Touch exactly one file: same path, different size and mtime.
      const touched = '.fonts/probe-sans/probe-sans-400.woff2';
      stats.set(touched, { size: 9999, mtime: 999 });
      const { adapter: incrementalAdapter, reads } = makeAdapter(stats);

      const incremental = await buildCache(incrementalAdapter, '.fonts', undefined, full);

      // Only the touched file's bytes should have been read for re-parsing.
      expect(reads).toStrictEqual([touched]);

      // Every record but the touched one must be byte-identical (same object even),
      // proving it was reused rather than rebuilt.
      const fullByPath = new Map(full.faces.map((f) => [f.path, f]));
      const incrementalByPath = new Map(incremental.faces.map((f) => [f.path, f]));
      for (const path of files) {
        if (path === touched) {
          continue;
        }
        expect(incrementalByPath.get(path)).toBe(fullByPath.get(path));
      }

      // The touched record differs (it was actually re-parsed) but otherwise the
      // result matches what a full scan of the same (changed) folder would produce.
      const rebuiltFull = await buildCache(makeAdapter(stats).adapter, '.fonts');
      expect(incremental.faces.map((f) => f.path)).toStrictEqual(
        rebuiltFull.faces.map((f) => f.path),
      );
      expect(incremental.faces).toStrictEqual(rebuiltFull.faces);
    });

    it('drops a record whose file no longer exists', async () => {
      const stats = baselineStats();
      const full = await buildCache(makeAdapter(stats).adapter, '.fonts');

      stats.delete('.fonts/probe-sans/probe-sans-700italic.ttf');
      const removedFiles = files.filter((f) => f !== '.fonts/probe-sans/probe-sans-700italic.ttf');
      const adapter: FontAdapter = {
        list: (path) => Promise.resolve(listSingleSubfolder(removedFiles)(path)),
        stat: (path) => Promise.resolve(stats.get(path) ?? null),
        readBinary: (path) =>
          Promise.resolve(readFixture(`probe-sans/${path.slice(path.lastIndexOf('/') + 1)}`)),
      };

      const incremental = await buildCache(adapter, '.fonts', undefined, full);

      expect(
        [...incremental.faces].map((f) => f.path).sort((a, b) => a.localeCompare(b)),
      ).toStrictEqual([...removedFiles].sort((a, b) => a.localeCompare(b)));
    });

    it('does not reuse records from a cache built for a different folder', async () => {
      const stats = baselineStats();
      const { adapter } = makeAdapter(stats);
      const otherFolderCache: FontCache = {
        version: CACHE_VERSION,
        folder: '.other-fonts',
        faces: (await buildCache(adapter, '.fonts')).faces.map((f) => ({ ...f, path: f.path })),
      };
      const { adapter: freshAdapter, reads } = makeAdapter(stats);

      await buildCache(freshAdapter, '.fonts', undefined, otherFolderCache);

      // Every file had to be re-read: nothing from the other folder's cache was reused.
      expect([...reads].sort((a, b) => a.localeCompare(b))).toStrictEqual(
        [...files].sort((a, b) => a.localeCompare(b)),
      );
    });
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
