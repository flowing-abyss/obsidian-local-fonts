import { scanFolder, type FontAdapter } from './scanner.js';
import { CACHE_VERSION, type FaceRecord, type FileStamp, type FontCache } from './types.js';

/**
 * Decide whether the cached scan still describes the folder.
 *
 * Compares path, size and mtime for every file. Cheap enough to run on every start,
 * which is what keeps a rescan off the startup path in the common case.
 */
export function isCacheStale(
  cache: FontCache | null,
  folder: string,
  files: readonly FileStamp[],
): boolean {
  if (cache === null || (cache.version as number) !== CACHE_VERSION || cache.folder !== folder) {
    return true;
  }
  if (cache.faces.length !== files.length) {
    return true;
  }
  const cached = new Map(cache.faces.map((face) => [face.path, face]));
  return files.some((file) => {
    const match = cached.get(file.path);
    return match?.size !== file.size || match.mtime !== file.mtime;
  });
}

/**
 * Build a fresh cache. Platform-neutral by construction: it stores every face with its
 * full colour-format set and never chooses between competing files. `data.json` syncs
 * across devices, so a cached choice would corrupt other platforms silently.
 */
export async function buildCache(adapter: FontAdapter, folder: string): Promise<FontCache> {
  return {
    version: CACHE_VERSION,
    folder,
    faces: await scanFolder(adapter, folder),
  };
}

/** Group faces by real family name, each family's faces sorted by weight then style. */
export function groupIntoFamilies(faces: readonly FaceRecord[]): Map<string, FaceRecord[]> {
  const families = new Map<string, FaceRecord[]>();
  for (const face of faces) {
    const bucket = families.get(face.family);
    if (bucket !== undefined) {
      bucket.push(face);
    } else {
      families.set(face.family, [face]);
    }
  }
  for (const bucket of families.values()) {
    bucket.sort((a, b) => {
      const byWeight = a.weight - b.weight;
      return byWeight !== 0 ? byWeight : Number(a.italic) - Number(b.italic);
    });
  }
  return families;
}
