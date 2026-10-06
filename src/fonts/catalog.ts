import { collectFiles, extractRecords, type FontAdapter, type FoundFile } from './scanner.js';
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

/** Compare the shared catalog after parsing, ignoring device-local file times and
 * adapter traversal order. Never use this to decide whether bytes need re-reading:
 * that still requires the exact path/size/mtime comparison in `isCacheStale`. */
export function sameCacheMetadata(previous: FontCache | null, next: FontCache): boolean {
  if (
    previous?.version !== (next.version as number) ||
    previous.folder !== next.folder ||
    previous.faces.length !== next.faces.length
  ) {
    return false;
  }
  const byPath = new Map(previous.faces.map((face) => [face.path, metadataKey(face)]));
  return next.faces.every((face) => byPath.get(face.path) === metadataKey(face));
}

function metadataKey(face: FaceRecord): string {
  return JSON.stringify([
    face.path,
    face.format,
    face.size,
    face.family,
    face.weight,
    face.italic,
    face.colorFormats,
    face.scripts,
    face.axes.map((axis) => [axis.tag, axis.min, axis.max, axis.default]),
    face.license,
    face.source,
  ]);
}

/**
 * Index `previous`'s faces by path, but only when it describes the same folder —
 * reusing a record from a different folder's cache would be reusing bytes for a
 * path that may not even exist there, or (worse) one that coincidentally does and
 * means something else.
 */
function indexPrevious(
  previous: FontCache | null | undefined,
  folder: string,
): Map<string, FaceRecord> {
  if (previous?.folder !== folder) {
    return new Map();
  }
  return new Map(previous.faces.map((face) => [face.path, face]));
}

/**
 * Build a cache for `folder`, reusing records from `previous` whose path, size and
 * mtime are unchanged and parsing only what is new or modified.
 *
 * A full rescan re-decodes and re-parses every font file, which is the expensive part
 * (measured live: ~500ms and tens of MB of heap across 44 files) — most of that cost
 * is unnecessary when only one file actually changed. This still walks the whole
 * folder (cheap: paths/sizes/mtimes only) so the result's file set and order match
 * what a full scan would produce; it just skips parsing for files whose cached record
 * already matches.
 *
 * Platform-neutral, like the cache itself: reuse is decided purely from path/size/
 * mtime, never from anything engine- or OS-dependent, so a record built on one device
 * and synced to another stays valid to reuse there too.
 */
export async function buildCache(
  adapter: FontAdapter,
  folder: string,
  onSkip?: (path: string) => void,
  previous?: FontCache | null,
): Promise<FontCache> {
  const files = await collectFiles(adapter, folder, onSkip);
  const previousByPath = indexPrevious(previous, folder);

  const toParse: FoundFile[] = [];
  const byPath = new Map<string, FaceRecord>();
  for (const file of files) {
    const cached = previousByPath.get(file.path);
    if (cached?.size === file.size && cached.mtime === file.mtime) {
      byPath.set(file.path, cached);
    } else {
      toParse.push(file);
    }
  }

  for (const record of await extractRecords(adapter, toParse, onSkip)) {
    byPath.set(record.path, record);
  }

  // Filesystem traversal order differs across devices. Use code-unit path order,
  // independent of locale, so a real catalog change is serialized consistently.
  const faces = files
    .map((file) => byPath.get(file.path))
    .filter((record): record is FaceRecord => record !== undefined)
    .sort((a, b) => {
      if (a.path === b.path) {
        return 0;
      }
      return a.path < b.path ? -1 : 1;
    });

  return { version: CACHE_VERSION, folder, faces };
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
