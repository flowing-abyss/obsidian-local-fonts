import type { FileStamp, FontCache } from './types.js';

interface DeviceStorage {
  load(): unknown;
  save(value: unknown): void;
  onError(error: unknown): void;
}

/** Exact local stamps, bound to the shared snapshot whose metadata they verified.
 * This is an optional device-only optimization, never a replacement for data.json. */
export class DeviceFontCache {
  private current: { shared: string; local: FontCache } | null = null;
  private reportedError = false;

  constructor(private readonly storage: DeviceStorage) {}

  forScan(shared: FontCache | null): FontCache | null {
    if (shared === null) {
      return null;
    }
    const key = JSON.stringify(shared);
    if (this.current?.shared === key) {
      return this.current.local;
    }
    let local = shared;
    try {
      local = restoreStamps(shared, key, this.storage.load()) ?? shared;
    } catch (error) {
      this.report(error);
    }
    this.current = { shared: key, local };
    return local;
  }

  remember(shared: FontCache, local: FontCache): void {
    const key = JSON.stringify(shared);
    this.current = { shared: key, local };
    try {
      this.storage.save({
        shared: key,
        stamps: local.faces.map(({ path, size, mtime }) => ({ path, size, mtime })),
      });
    } catch (error) {
      this.report(error);
    }
  }

  private report(error: unknown): void {
    if (!this.reportedError) {
      this.reportedError = true;
      this.storage.onError(error);
    }
  }
}

function isStamp(value: unknown): value is FileStamp {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const stamp = value as Partial<FileStamp>;
  return (
    typeof stamp.path === 'string' &&
    typeof stamp.size === 'number' &&
    Number.isFinite(stamp.size) &&
    typeof stamp.mtime === 'number' &&
    Number.isFinite(stamp.mtime)
  );
}

function restoreStamps(shared: FontCache, key: string, stored: unknown): FontCache | null {
  if (typeof stored !== 'object' || stored === null) {
    return null;
  }
  const snapshot = stored as { shared?: unknown; stamps?: unknown };
  if (
    snapshot.shared !== key ||
    !Array.isArray(snapshot.stamps) ||
    snapshot.stamps.length !== shared.faces.length ||
    !snapshot.stamps.every(isStamp)
  ) {
    return null;
  }
  const byPath = new Map(snapshot.stamps.map((stamp) => [stamp.path, stamp]));
  if (
    byPath.size !== shared.faces.length ||
    shared.faces.some((face) => byPath.get(face.path)?.size !== face.size)
  ) {
    return null;
  }
  return {
    ...shared,
    faces: shared.faces.map((face) => ({
      ...face,
      mtime: byPath.get(face.path)?.mtime ?? face.mtime,
    })),
  };
}
