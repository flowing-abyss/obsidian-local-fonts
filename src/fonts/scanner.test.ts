import { describe, expect, it } from 'vitest';
import { readFixture } from './fixtures.js';
import { scanFolder, type FontAdapter } from './scanner.js';

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
});
