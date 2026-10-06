import { describe, expect, it, vi } from 'vitest';
import { DeviceFontCache } from './device-cache.js';
import { CACHE_VERSION, type FontCache } from './types.js';

const shared: FontCache = {
  version: CACHE_VERSION,
  folder: '.fonts',
  faces: [
    {
      path: '.fonts/a.ttf',
      format: 'ttf',
      size: 10,
      mtime: 100,
      family: 'A',
      weight: 400,
      italic: false,
      colorFormats: [],
      scripts: [],
      axes: [],
      license: null,
      source: 'name-table',
    },
  ],
};
const local: FontCache = {
  ...shared,
  faces: shared.faces.map((face) => ({ ...face, mtime: 107 })),
};

describe('DeviceFontCache', () => {
  it('reuses exact verified timestamps after restart without changing shared metadata', () => {
    let stored: unknown = null;
    const storage = {
      load: () => stored,
      save: (value: unknown) => {
        stored = value;
      },
      onError: vi.fn(),
    };
    new DeviceFontCache(storage).remember(shared, local);

    const restarted = new DeviceFontCache(storage);
    expect(restarted.forScan(shared)).toStrictEqual(local);
    expect(shared.faces[0]?.mtime).toBe(100);
    expect(storage.onError).not.toHaveBeenCalled();
  });

  it('invalidates local observations when the synced snapshot changes', () => {
    let stored: unknown = null;
    const cache = new DeviceFontCache({
      load: () => stored,
      save: (value) => {
        stored = value;
      },
      onError: vi.fn(),
    });
    cache.remember(shared, local);
    const changed = { ...shared, faces: shared.faces.map((face) => ({ ...face, family: 'B' })) };

    expect(cache.forScan(changed)).toBe(changed);
    expect(cache.forScan(null)).toBeNull();
  });

  it.each([
    null,
    5,
    {},
    { shared: JSON.stringify(shared), stamps: null },
    { shared: JSON.stringify(shared), stamps: [] },
    { shared: JSON.stringify(shared), stamps: [null] },
    { shared: JSON.stringify(shared), stamps: [{ path: '.fonts/a.ttf', size: 10, mtime: '107' }] },
    { shared: JSON.stringify(shared), stamps: [{ path: '.fonts/a.ttf', size: 11, mtime: 107 }] },
    {
      shared: JSON.stringify(shared),
      stamps: [{ path: '.fonts/other.ttf', size: 10, mtime: 107 }],
    },
    {
      shared: JSON.stringify(shared),
      stamps: [{ path: '.fonts/a.ttf', size: 10, mtime: Infinity }],
    },
  ])('discards unusable local data: %j', (stored) => {
    const cache = new DeviceFontCache({ load: () => stored, save: vi.fn(), onError: vi.fn() });
    expect(cache.forScan(shared)).toBe(shared);
  });

  it('rejects duplicate stamps instead of masking a missing file', () => {
    const two = {
      ...shared,
      faces: [...shared.faces, ...shared.faces.map((face) => ({ ...face, path: '.fonts/b.ttf' }))],
    };
    const stamp = { path: '.fonts/a.ttf', size: 10, mtime: 107 };
    const cache = new DeviceFontCache({
      load: () => ({ shared: JSON.stringify(two), stamps: [stamp, stamp] }),
      save: vi.fn(),
      onError: vi.fn(),
    });
    expect(cache.forScan(two)).toBe(two);
  });

  it('keeps the optimization in memory and reports storage failures only once', () => {
    const onError = vi.fn();
    const error = new Error('storage unavailable');
    const cache = new DeviceFontCache({
      load: () => {
        throw error;
      },
      save: () => {
        throw error;
      },
      onError,
    });
    expect(cache.forScan(shared)).toBe(shared);
    cache.remember(shared, local);
    expect(cache.forScan(shared)).toBe(local);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('reports a write failure even when loading succeeded', () => {
    const onError = vi.fn();
    const error = new Error('quota exceeded');
    const cache = new DeviceFontCache({
      load: () => null,
      save: () => {
        throw error;
      },
      onError,
    });
    cache.remember(shared, local);
    expect(cache.forScan(shared)).toBe(local);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });
});
