import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFixture } from '../../tests/fixtures.js';
import type * as MetadataModule from './metadata.js';
import { listStamps, scanFolder, type FontAdapter } from './scanner.js';

function fakeAdapter(tree: Record<string, { files: string[]; folders: string[] }>): FontAdapter {
  return {
    list: async (path) => tree[path] ?? { files: [], folders: [] },
    stat: async () => ({ size: 1234, mtime: 42 }),
    readBinary: async (path) =>
      path.endsWith('.ttf')
        ? readFixture('probe-sans/probe-sans-400.ttf')
        : readFixture('probe-sans/probe-sans-400.woff2'),
  };
}

describe('scanFolder', () => {
  it('descends into subfolders, which is how families are usually organised', async () => {
    const adapter = fakeAdapter({
      '.fonts': { files: [], folders: ['.fonts/probe-sans'] },
      '.fonts/probe-sans': { files: ['.fonts/probe-sans/probe-sans-400.ttf'], folders: [] },
    });

    const faces = await scanFolder(adapter, '.fonts');

    expect(faces).toHaveLength(1);
    expect(faces[0]?.family).toBe('Probe Sans');
  });

  it('ignores files that are not fonts', async () => {
    const adapter = fakeAdapter({
      '.fonts': { files: ['.fonts/readme.md', '.fonts/probe-sans-400.ttf'], folders: [] },
    });

    const faces = await scanFolder(adapter, '.fonts');

    expect(faces).toHaveLength(1);
  });

  it('returns nothing when the folder does not exist, rather than throwing', async () => {
    const adapter: FontAdapter = {
      list: async () => {
        throw new Error('ENOENT');
      },
      stat: async () => null,
      readBinary: async () => new ArrayBuffer(0),
    };

    await expect(scanFolder(adapter, '.missing')).resolves.toStrictEqual([]);
  });

  it('skips a file whose stat is unavailable', async () => {
    const adapter = fakeAdapter({
      '.fonts': { files: ['.fonts/probe-sans-400.ttf'], folders: [] },
    });
    adapter.stat = async () => null;

    await expect(scanFolder(adapter, '.fonts')).resolves.toStrictEqual([]);
  });

  it('does not hang on a symlinked-cyclic folder tree', async () => {
    const adapter = fakeAdapter({
      '.fonts': { files: ['.fonts/probe-sans-400.ttf'], folders: ['.fonts/loop'] },
      '.fonts/loop': { files: [], folders: ['.fonts'] },
    });

    await expect(scanFolder(adapter, '.fonts')).resolves.toHaveLength(1);
  });

  it('reads a woff2 file only once even though metadata extraction asks for its bytes twice', async () => {
    let readCount = 0;
    const adapter: FontAdapter = {
      list: async (path) =>
        path === '.fonts'
          ? { files: ['.fonts/probe-sans-400.woff2'], folders: [] }
          : { files: [], folders: [] },
      stat: async () => ({ size: 1234, mtime: 42 }),
      readBinary: async () => {
        readCount++;
        return readFixture('probe-sans/probe-sans-400.woff2');
      },
    };

    await scanFolder(adapter, '.fonts');

    expect(readCount).toBe(1);
  });

  it('preserves deterministic ordering regardless of which file resolves first', async () => {
    const delays: Record<string, number> = {
      '.fonts/a-400.ttf': 20,
      '.fonts/b-400.ttf': 0,
    };
    const adapter: FontAdapter = {
      list: async (path) =>
        path === '.fonts'
          ? { files: ['.fonts/a-400.ttf', '.fonts/b-400.ttf'], folders: [] }
          : { files: [], folders: [] },
      stat: async () => ({ size: 1234, mtime: 42 }),
      readBinary: async (path) => {
        const delay = delays[path] ?? 0;
        await new Promise((resolve) => window.setTimeout(resolve, delay));
        return readFixture('probe-sans/probe-sans-400.ttf');
      },
    };

    const faces = await scanFolder(adapter, '.fonts');

    expect(faces.map((face) => face.path)).toStrictEqual(['.fonts/a-400.ttf', '.fonts/b-400.ttf']);
  });

  it('skips a file whose stat rejects, keeping the rest in input order', async () => {
    const adapter: FontAdapter = {
      list: async (path) =>
        path === '.fonts'
          ? { files: ['.fonts/a-400.ttf', '.fonts/bad-400.ttf', '.fonts/c-400.ttf'], folders: [] }
          : { files: [], folders: [] },
      stat: async (path) => {
        if (path === '.fonts/bad-400.ttf') {
          throw new Error('EPERM');
        }
        return { size: 1234, mtime: 42 };
      },
      readBinary: async () => readFixture('probe-sans/probe-sans-400.ttf'),
    };

    const faces = await scanFolder(adapter, '.fonts');

    expect(faces.map((face) => face.path)).toStrictEqual(['.fonts/a-400.ttf', '.fonts/c-400.ttf']);
  });

  describe('when a per-file extraction rejects (defence in depth)', () => {
    // extractMetadata is contractually non-throwing (Task 6), and empirically a
    // rejecting readBinary doesn't make it throw either — every I/O path inside it is
    // already wrapped, so a failed read degrades to a filename-based record rather than
    // propagating. scanner.ts's own try/catch around extractMetadata therefore has no
    // way to be exercised through a real adapter today; it exists as insurance against
    // a future regression of that contract. To actually exercise it, the module itself
    // is mocked to reject for one path, isolated to this test via vi.doMock/resetModules
    // so the rest of the suite keeps using the real, non-throwing extractMetadata.
    afterEach(() => {
      vi.doUnmock('./metadata.js');
      vi.resetModules();
    });

    it('resolves with the other files, in input order, rather than rejecting the batch', async () => {
      vi.resetModules();
      vi.doMock('./metadata.js', async (importOriginal) => {
        const actual = await importOriginal<typeof MetadataModule>();
        return {
          ...actual,
          extractMetadata: (input: MetadataModule.ExtractInput) =>
            input.path === '.fonts/bad-400.ttf'
              ? Promise.reject(new Error('simulated extraction failure'))
              : actual.extractMetadata(input),
        };
      });
      const { scanFolder: scanFolderUnderMock } = await import('./scanner.js');

      const adapter: FontAdapter = {
        list: async (path) =>
          path === '.fonts'
            ? { files: ['.fonts/a-400.ttf', '.fonts/bad-400.ttf', '.fonts/c-400.ttf'], folders: [] }
            : { files: [], folders: [] },
        stat: async () => ({ size: 1234, mtime: 42 }),
        readBinary: async () => readFixture('probe-sans/probe-sans-400.ttf'),
      };

      const faces = await scanFolderUnderMock(adapter, '.fonts');

      expect(faces.map((face) => face.path)).toStrictEqual([
        '.fonts/a-400.ttf',
        '.fonts/c-400.ttf',
      ]);
    });
  });
});

describe('listStamps', () => {
  it('returns paths, sizes and mtimes without reading any font bytes', async () => {
    const adapter = fakeAdapter({
      '.fonts': { files: ['.fonts/probe-sans-400.ttf'], folders: [] },
    });
    let reads = 0;
    adapter.readBinary = async (_path) => {
      reads++;
      return readFixture('probe-sans/probe-sans-400.ttf');
    };

    const stamps = await listStamps(adapter, '.fonts');

    expect(stamps).toStrictEqual([{ path: '.fonts/probe-sans-400.ttf', size: 1234, mtime: 42 }]);
    expect(reads).toBe(0);
  });
});
