import { formatOf } from './filename.js';
import { extractMetadata } from './metadata.js';
import type { FaceRecord } from './types.js';

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

interface FoundFile {
  path: string;
  size: number;
  mtime: number;
  siblings: string[];
}

async function collect(
  adapter: FontAdapter,
  folder: string,
  out: FoundFile[],
  visited: Set<string>,
): Promise<void> {
  // Guards against a symlinked-cyclic folder tree (e.g. a folder that links back to an
  // ancestor) causing unbounded recursion. Real filesystems can and do have these.
  if (visited.has(folder)) {
    return;
  }
  visited.add(folder);

  let listing: { files: string[]; folders: string[] };
  try {
    listing = await adapter.list(folder);
  } catch {
    return; // Missing or unreadable folder is not an error: there are simply no fonts.
  }

  const fonts = listing.files.filter((file) => formatOf(file) !== null);
  for (const path of fonts) {
    const stat = await adapter.stat(path);
    if (stat !== null) {
      out.push({ path, size: stat.size, mtime: stat.mtime, siblings: fonts });
    }
  }

  for (const sub of listing.folders) {
    await collect(adapter, sub, out, visited);
  }
}

/** Walk the folder recursively and extract a record for every font file found. */
export async function scanFolder(adapter: FontAdapter, folder: string): Promise<FaceRecord[]> {
  const found: FoundFile[] = [];
  await collect(adapter, folder, found, new Set());

  const records: FaceRecord[] = [];
  for (const file of found) {
    records.push(
      await extractMetadata({
        path: file.path,
        size: file.size,
        mtime: file.mtime,
        siblings: file.siblings,
        read: (path) => adapter.readBinary(path),
      }),
    );
  }
  return records;
}
