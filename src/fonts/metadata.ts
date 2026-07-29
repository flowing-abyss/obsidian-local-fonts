import { formatOf, parseFilename } from './filename.js';
import { parseSfnt, type SfntInfo } from './sfnt.js';
import type { ColorFormat, FaceRecord, FontFormat, MetadataSource } from './types.js';
import { buildMinimalSfnt, decodeWoff2, REASSEMBLY_TAGS, woff2ColorFormats } from './woff2.js';

export type FileReader = (path: string) => Promise<ArrayBuffer>;

export interface ExtractInput {
  /** Vault-relative path of the font file. */
  path: string;
  size: number;
  mtime: number;
  /** Other files in the same folder, used by level 4. */
  siblings: readonly string[];
  read: FileReader;
}

function stemOf(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  const dot = file.lastIndexOf('.');
  return dot === -1 ? file : file.slice(0, dot);
}

/** Level 4: a file with the same stem and a different extension, in the same folder. */
function findSibling(input: ExtractInput): string | null {
  const stem = stemOf(input.path);
  for (const candidate of input.siblings) {
    if (candidate === input.path) {
      continue;
    }
    const format = formatOf(candidate);
    if (stemOf(candidate) === stem && (format === 'ttf' || format === 'otf')) {
      return candidate;
    }
  }
  return null;
}

async function tryParseSfnt(path: string, read: FileReader): Promise<SfntInfo | null> {
  try {
    const info = parseSfnt(await read(path));
    return info.family !== '' ? info : null;
  } catch {
    return null;
  }
}

const WOFF1_SIGNATURE = 0x774f_4646; // 'wOFF'
const WOFF1_HEADER_SIZE = 44;
const WOFF1_DIRECTORY_ENTRY_SIZE = 20;

interface Woff1DirectoryEntry {
  tag: string;
  offset: number;
  compLength: number;
  origLength: number;
}

/**
 * Read the WOFF1 table directory (header at 0, one 20-byte entry per table starting
 * at 44: tag, offset, compLength, origLength, origChecksum). Every offset/length is
 * validated against the buffer before use — a directory entry may lie about a table's
 * extent in a truncated or corrupt file, same concern as `tableView` in sfnt.ts.
 * Throws for anything that doesn't even look like a WOFF1 file; callers catch.
 */
function readWoff1Directory(buf: ArrayBuffer): Woff1DirectoryEntry[] {
  const view = new DataView(buf);
  if (buf.byteLength < WOFF1_HEADER_SIZE || view.getUint32(0) !== WOFF1_SIGNATURE) {
    throw new Error('Not a woff font: signature is not wOFF');
  }
  const numTables = view.getUint16(12);
  const entries: Woff1DirectoryEntry[] = [];
  for (let t = 0; t < numTables; t++) {
    const base = WOFF1_HEADER_SIZE + t * WOFF1_DIRECTORY_ENTRY_SIZE;
    if (base + WOFF1_DIRECTORY_ENTRY_SIZE > buf.byteLength) {
      break;
    }
    const tag = String.fromCharCode(
      view.getUint8(base),
      view.getUint8(base + 1),
      view.getUint8(base + 2),
      view.getUint8(base + 3),
    );
    entries.push({
      tag,
      offset: view.getUint32(base + 4),
      compLength: view.getUint32(base + 8),
      origLength: view.getUint32(base + 12),
    });
  }
  return entries;
}

/**
 * Inflate one WOFF1 table body. Stored raw (uncompressed) when compLength ===
 * origLength — common for small tables like `head`/`loca` — otherwise zlib-deflate
 * compressed, which is what DecompressionStream('deflate') expects (the zlib wrapper,
 * not raw deflate). Returns null on any bounds violation or decompression failure;
 * never throws.
 */
async function inflateWoff1Table(
  buf: ArrayBuffer,
  entry: Woff1DirectoryEntry,
): Promise<Uint8Array | null> {
  if (
    entry.offset < 0 ||
    entry.compLength < 0 ||
    entry.origLength < 0 ||
    entry.offset + entry.compLength > buf.byteLength
  ) {
    return null;
  }
  const body = new Uint8Array(buf, entry.offset, entry.compLength);

  if (entry.compLength === entry.origLength) {
    return body;
  }

  try {
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    }).pipeThrough(new DecompressionStream('deflate'));
    const inflated = await new Response(stream).arrayBuffer();
    return new Uint8Array(inflated);
  } catch {
    return null;
  }
}

/**
 * Reconstruct just enough of the sfnt inside a WOFF1 so `parseSfnt` can read `name`,
 * `OS/2`, `cmap` and `fvar` — mirrors `decodeWoff2` in woff2.ts, including reuse of its
 * `buildMinimalSfnt` (same reassembly target, different container format). A table is
 * skipped (not fatal) if it fails to bounds-check or inflate; the font is only
 * abandoned (returns null) if none of the tables worth reassembling came through.
 */
async function decodeWoff1(buf: ArrayBuffer): Promise<ArrayBuffer | null> {
  try {
    const entries = readWoff1Directory(buf).filter((entry) => REASSEMBLY_TAGS.has(entry.tag));
    const tables = new Map<string, Uint8Array>();
    for (const entry of entries) {
      const table = await inflateWoff1Table(buf, entry);
      if (table !== null) {
        tables.set(entry.tag, table);
      }
    }
    if (tables.size === 0) {
      return null;
    }
    return buildMinimalSfnt(tables);
  } catch {
    return null;
  }
}

async function readSfntInfo(input: ExtractInput, format: FontFormat): Promise<SfntInfo | null> {
  if (format === 'ttf' || format === 'otf') {
    return tryParseSfnt(input.path, input.read);
  }

  let decoded: ArrayBuffer | null = null;
  try {
    const raw = await input.read(input.path);
    decoded = format === 'woff2' ? await decodeWoff2(raw) : await decodeWoff1(raw);
  } catch {
    decoded = null;
  }

  if (decoded !== null) {
    try {
      const info = parseSfnt(decoded);
      if (info.family !== '') {
        return info;
      }
    } catch {
      // fall through to the sibling level
    }
  }
  return null;
}

/**
 * A woff2 directory is readable without brotli, so colour formats are always available
 * even when full metadata is not. Only called for woff2 paths — see the call site.
 */
async function readColorFormats(input: ExtractInput): Promise<ColorFormat[]> {
  try {
    return woff2ColorFormats(await input.read(input.path));
  } catch {
    return [];
  }
}

/** Levels 1 and 3: parse the file itself, falling back to level 4 (a sibling) on failure. */
async function readInfoWithSibling(
  input: ExtractInput,
  format: FontFormat,
): Promise<{ info: SfntInfo | null; source: MetadataSource }> {
  const info = await readSfntInfo(input, format);
  if (info !== null) {
    return { info, source: 'name-table' };
  }

  const sibling = findSibling(input);
  if (sibling === null) {
    return { info: null, source: 'name-table' };
  }

  const siblingInfo = await tryParseSfnt(sibling, input.read);
  return siblingInfo === null
    ? { info: null, source: 'name-table' }
    : { info: siblingInfo, source: 'sibling' };
}

/** Level 5: the filename says nothing came before it. */
function filenameRecord(
  input: ExtractInput,
  format: FontFormat,
  colorFormats: ColorFormat[],
): FaceRecord {
  const guess = parseFilename(input.path.slice(input.path.lastIndexOf('/') + 1));
  return {
    path: input.path,
    format,
    size: input.size,
    mtime: input.mtime,
    family: guess.family,
    weight: guess.weight,
    italic: guess.italic,
    colorFormats,
    scripts: [],
    axes: [],
    license: null,
    source: 'filename',
  };
}

/** Run the extraction chain over one file and produce a platform-neutral record. */
export async function extractMetadata(input: ExtractInput): Promise<FaceRecord> {
  const format = formatOf(input.path) ?? 'ttf';

  const { info, source } = await readInfoWithSibling(input, format);

  let colorFormats = info?.colorFormats ?? [];
  if (format === 'woff2' && colorFormats.length === 0) {
    colorFormats = await readColorFormats(input);
  }

  if (info === null) {
    return filenameRecord(input, format, colorFormats);
  }

  return {
    path: input.path,
    format,
    size: input.size,
    mtime: input.mtime,
    family: info.family,
    weight: info.weight,
    italic: info.italic,
    colorFormats: colorFormats.length > 0 ? colorFormats : info.colorFormats,
    scripts: info.scripts,
    axes: info.axes,
    license: info.license,
    source,
  };
}
