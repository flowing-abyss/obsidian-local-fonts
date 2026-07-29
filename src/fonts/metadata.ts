import { formatOf, parseFilename } from './filename.js';
import { parseSfnt, type SfntInfo } from './sfnt.js';
import type { ColorFormat, FaceRecord, FontFormat, MetadataSource } from './types.js';
import { decodeWoff2, woff2ColorFormats } from './woff2.js';

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

/**
 * Decode a woff via DecompressionStream('deflate'), which every target engine has.
 * There is deliberately no 'br' branch: DecompressionStream supports only deflate,
 * deflate-raw and gzip. Brotli lives in woff2.ts.
 *
 * Built from a ReadableStream directly rather than `new Blob([buf]).stream()`: jsdom's
 * Blob polyfill (used by the test environment) has no `.stream()` method, even though
 * real engines do. Constructing the stream by hand works identically everywhere.
 */
async function inflateWoff(buf: ArrayBuffer): Promise<ArrayBuffer | null> {
  try {
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(new Uint8Array(buf));
        controller.close();
      },
    }).pipeThrough(new DecompressionStream('deflate'));
    return await new Response(stream).arrayBuffer();
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
    decoded = format === 'woff2' ? await decodeWoff2(raw) : await inflateWoff(raw);
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
