import { formatOf } from './filename.js';
import { extractMetadata, type FileReader } from './metadata.js';
import type { FaceRecord, FileStamp } from './types.js';

/**
 * The slice of Obsidian's DataAdapter this plugin needs.
 *
 * Deliberately not `Vault`: the vault index cannot see dot-folders, and a hidden fonts
 * folder is a requirement. Keeping this an interface also makes the scanner testable
 * without an Obsidian runtime.
 */
export interface FontAdapter {
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  stat(path: string): Promise<{ size: number; mtime: number } | null>;
  readBinary(path: string): Promise<ArrayBuffer>;
}

/** One file located by a folder walk, before metadata extraction. */
export interface FoundFile {
  path: string;
  size: number;
  mtime: number;
  siblings: string[];
}

/**
 * Caps how many files are read/decoded/parsed at once. Fonts can run tens of megabytes
 * each, and this scan may run on mobile: unbounded `Promise.all` over the whole folder
 * would hold every file's bytes in memory simultaneously. A small fixed pool still lets
 * I/O latency overlap across files without that spike.
 */
const CONCURRENCY_LIMIT = 8;

/**
 * Map over `items` with at most `limit` calls to `fn` in flight at once, preserving
 * output order regardless of which call settles first — a later stage (CSS generation)
 * needs byte-identical, run-to-run-stable output.
 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += limit) {
    const chunk = items.slice(start, start + limit);
    results.push(...(await Promise.all(chunk.map(fn))));
  }
  return results;
}

/**
 * One `extractMetadata` call may ask for the same path's bytes twice (once to decode
 * the font, again for colour formats when the decode didn't already surface them). This
 * memoizes reads for a single file's extraction only — a scan-wide cache would keep
 * every font's bytes alive for the whole scan, which is what CONCURRENCY_LIMIT above is
 * trying to avoid.
 */
function memoizedReader(adapter: FontAdapter): FileReader {
  const inFlight = new Map<string, Promise<ArrayBuffer>>();
  return (path) => {
    const cached = inFlight.get(path);
    if (cached !== undefined) {
      return cached;
    }
    const pending = adapter.readBinary(path);
    inFlight.set(path, pending);
    return pending;
  };
}

interface CollectContext {
  adapter: FontAdapter;
  out: FoundFile[];
  visited: Set<string>;
  onSkip?: (path: string) => void;
}

async function collect(folder: string, ctx: CollectContext): Promise<void> {
  // Guards against a symlinked-cyclic folder tree (e.g. a folder that links back to an
  // ancestor) causing unbounded recursion. Real filesystems can and do have these.
  if (ctx.visited.has(folder)) {
    return;
  }
  ctx.visited.add(folder);

  let listing: { files: string[]; folders: string[] };
  try {
    listing = await ctx.adapter.list(folder);
  } catch {
    return; // Missing or unreadable folder is not an error: there are simply no fonts.
  }

  const fonts = listing.files.filter((file) => formatOf(file) !== null);
  const stamped = await mapLimit(fonts, CONCURRENCY_LIMIT, async (path) => {
    let stat: { size: number; mtime: number } | null;
    try {
      stat = await ctx.adapter.stat(path);
    } catch (error) {
      // One unreadable file (permission oddity, interrupted sync, ...) must not take
      // down the whole scan; the user still gets every other font.
      console.warn(`[local-fonts] failed to stat font file, skipping: ${path}`, error);
      ctx.onSkip?.(path);
      return null;
    }
    return stat === null ? null : { path, size: stat.size, mtime: stat.mtime, siblings: fonts };
  });
  for (const file of stamped) {
    if (file !== null) {
      ctx.out.push(file);
    }
  }

  for (const sub of listing.folders) {
    await collect(sub, ctx);
  }
}

/**
 * Recursively walk the folder and return every font file found, with its identity
 * (path/size/mtime) and its folder's sibling file list, but without parsing any of
 * them. The shared first step behind both `listStamps` (a staleness check) and
 * `scanFolder` (a full parse) — and behind `catalog.buildCache`'s incremental reuse,
 * which needs the walk but only parses what changed.
 */
export async function collectFiles(
  adapter: FontAdapter,
  folder: string,
  onSkip?: (path: string) => void,
): Promise<FoundFile[]> {
  const found: FoundFile[] = [];
  await collect(folder, {
    adapter,
    out: found,
    visited: new Set(),
    ...(onSkip !== undefined && { onSkip }),
  });
  return found;
}

/**
 * Cheap listing: paths, sizes and mtimes only, no font parsing.
 *
 * Safe to run on startup — used to decide whether the cache is stale without paying
 * for a full scan (which decodes and parses every font file).
 */
export async function listStamps(adapter: FontAdapter, folder: string): Promise<FileStamp[]> {
  const found = await collectFiles(adapter, folder);
  return found.map(({ path, size, mtime }) => ({ path, size, mtime }));
}

/**
 * Extract a record for each given file. Split out from `scanFolder` so
 * `catalog.buildCache` can call it with only the subset of files that actually need
 * (re-)parsing, reusing cached records for the rest.
 *
 * `onSkip`, if given, is called once per file that could not be read or parsed — the
 * settings tab uses it to tell the user a file was dropped, rather than the silence of
 * a `console.warn` no one but a developer will ever open.
 */
export async function extractRecords(
  adapter: FontAdapter,
  files: readonly FoundFile[],
  onSkip?: (path: string) => void,
): Promise<FaceRecord[]> {
  const extracted = await mapLimit(files, CONCURRENCY_LIMIT, async (file) => {
    try {
      return await extractMetadata({
        path: file.path,
        size: file.size,
        mtime: file.mtime,
        siblings: file.siblings,
        read: memoizedReader(adapter),
      });
    } catch (error) {
      // extractMetadata is contractually non-throwing, but a single bad file must not
      // be able to take down the whole scan even if that contract regresses later:
      // defence in depth, not trust in a neighbouring module's promise.
      console.warn(`[local-fonts] failed to read font metadata, skipping: ${file.path}`, error);
      onSkip?.(file.path);
      return null;
    }
  });
  return extracted.filter((record): record is FaceRecord => record !== null);
}

/**
 * Walk the folder recursively and extract a record for every font file found.
 *
 * `onSkip`, if given, is called once per file that could not be read or parsed — the
 * settings tab uses it to tell the user a file was dropped, rather than the silence of
 * a `console.warn` no one but a developer will ever open.
 */
export async function scanFolder(
  adapter: FontAdapter,
  folder: string,
  onSkip?: (path: string) => void,
): Promise<FaceRecord[]> {
  const found = await collectFiles(adapter, folder, onSkip);
  return extractRecords(adapter, found, onSkip);
}
