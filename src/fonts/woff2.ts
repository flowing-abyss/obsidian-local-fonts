import { colorFormatsFromTags } from './sfnt.js';
import type { ColorFormat } from './types.js';

/**
 * Known-tag table from the WOFF2 spec. A flag byte's low 6 bits index into this list;
 * the escape value 63 means a 4-byte tag follows instead.
 */
const KNOWN_TAGS = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
  'prep',
  'CFF ',
  'VORG',
  'EBDT',
  'EBLC',
  'gasp',
  'hdmx',
  'kern',
  'LTSH',
  'PCLT',
  'VDMX',
  'vhea',
  'vmtx',
  'BASE',
  'GDEF',
  'GPOS',
  'GSUB',
  'EBSC',
  'JSTF',
  'MATH',
  'CBDT',
  'CBLC',
  'COLR',
  'CPAL',
  'SVG ',
  'sbix',
  'acnt',
  'avar',
  'bdat',
  'bloc',
  'bsln',
  'cvar',
  'fdsc',
  'feat',
  'fmtx',
  'fvar',
  'gvar',
  'hsty',
  'just',
  'lcar',
  'mort',
  'morx',
  'opbd',
  'prop',
  'trak',
  'Zapf',
  'Silf',
  'Glat',
  'Gloc',
  'Feat',
  'Sill',
] as const;

const WOFF2_SIGNATURE = 0x774f_4632; // 'wOF2'
const DIRECTORY_OFFSET = 48;
const TAG_ESCAPE = 63;

/** UIntBase128: 7 bits per byte, high bit continues. Returns the value and the next index. */
function readUIntBase128(bytes: Uint8Array, start: number): [number, number] {
  let value = 0;
  let i = start;
  for (let read = 0; read < 5; read++) {
    const byte = bytes[i];
    if (byte === undefined) {
      throw new Error('Malformed woff2: truncated UIntBase128');
    }
    i++;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      return [value, i];
    }
  }
  throw new Error('Malformed woff2: overlong UIntBase128');
}

interface Woff2DirectoryEntry {
  tag: string;
  /** Bytes this table occupies in the *decompressed* stream, in directory order. */
  streamLength: number;
}

interface Woff2Directory {
  entries: Woff2DirectoryEntry[];
  /** Byte offset where the table directory ends and the compressed stream begins. */
  directoryEnd: number;
  totalCompressedSize: number;
}

/** Read a big-endian 4-byte tag starting at `start`, throwing if the buffer is short. */
function readLiteralTag(bytes: Uint8Array, start: number): [string, number] {
  const chars: number[] = [];
  for (let c = 0; c < 4; c++) {
    const byte = bytes[start + c];
    if (byte === undefined) {
      throw new Error('Malformed woff2: truncated table directory');
    }
    chars.push(byte);
  }
  return [String.fromCharCode(...chars), start + 4];
}

/** A table carries a transformLength when glyf/loca is untransformed, or any other table is transformed. */
function hasTransformLength(tag: string, transform: number): boolean {
  return tag === 'glyf' || tag === 'loca' ? transform === 0 : transform !== 0;
}

/** Read one table-directory entry (flags byte, tag, origLength, optional transformLength). */
function readDirectoryEntry(bytes: Uint8Array, start: number): [Woff2DirectoryEntry, number] {
  const flags = bytes[start];
  if (flags === undefined) {
    throw new Error('Malformed woff2: truncated table directory');
  }
  let i = start + 1;
  const index = flags & 0x3f;
  const transform = (flags >> 6) & 0x03;

  let tag: string;
  if (index === TAG_ESCAPE) {
    [tag, i] = readLiteralTag(bytes, i);
  } else {
    tag = KNOWN_TAGS[index] ?? `?${String(index)}`;
  }

  let streamLength: number;
  [streamLength, i] = readUIntBase128(bytes, i);

  // glyf/loca carry a transformLength when transform === 0; every other table carries
  // one when transform !== 0. Getting this wrong desynchronises the whole directory.
  if (hasTransformLength(tag, transform)) {
    [streamLength, i] = readUIntBase128(bytes, i);
  }

  return [{ tag, streamLength }, i];
}

/**
 * Parse the uncompressed woff2 table directory at offset 48. Shared by
 * {@link readWoff2TableTags} (tags only) and {@link decodeWoff2} (which also needs each
 * table's length within the decompressed stream, to locate `name`/`OS/2` without
 * decompressing anything it doesn't need).
 */
function parseWoff2Directory(buf: ArrayBuffer): Woff2Directory {
  const view = new DataView(buf);
  if (buf.byteLength < DIRECTORY_OFFSET || view.getUint32(0) !== WOFF2_SIGNATURE) {
    throw new Error('Not a woff2 font: signature is not wOF2');
  }
  const numTables = view.getUint16(12);
  const totalCompressedSize = view.getUint32(20);
  const bytes = new Uint8Array(buf);
  const entries: Woff2DirectoryEntry[] = [];
  let i = DIRECTORY_OFFSET;

  for (let t = 0; t < numTables; t++) {
    let entry: Woff2DirectoryEntry;
    [entry, i] = readDirectoryEntry(bytes, i);
    entries.push(entry);
  }

  return { entries, directoryEnd: i, totalCompressedSize };
}

/**
 * List the table tags in a woff2 without brotli. The directory is stored uncompressed at
 * offset 48, so this is cheap and works on every platform — which is what makes
 * colour-format detection possible even when the full decoder is unavailable.
 *
 * It deliberately does NOT yield family/weight/style: those live in the *contents* of
 * `name` and `OS/2`, which are inside the compressed stream.
 */
export function readWoff2TableTags(buf: ArrayBuffer): string[] {
  return parseWoff2Directory(buf).entries.map((entry) => entry.tag);
}

/** Colour formats of a woff2, from its directory alone. COLR version is assumed v1. */
export function woff2ColorFormats(buf: ArrayBuffer): ColorFormat[] {
  return colorFormatsFromTags(readWoff2TableTags(buf));
}

const SFNT_HEADER_SIZE = 12;
const SFNT_DIRECTORY_ENTRY_SIZE = 16;

/** Round up to the next 4-byte boundary, as sfnt table data must be padded. */
function align4(n: number): number {
  return (n + 3) & ~3;
}

/**
 * Tables this codebase's sfnt reader (`parseSfnt` in sfnt.ts) actually needs: family,
 * subfamily, weight, italic and license come from `name`/`OS/2`; writing-system
 * coverage comes from `cmap`; variable-font axes come from `fvar`. WOFF2 only defines
 * transforms for `glyf`, `loca` and `hmtx` — `cmap`, `fvar`, `name` and `OS/2` are
 * always stored untransformed, so all four reassemble through the same
 * copy-the-decompressed-bytes path. In ASCII byte order this list is already
 * tag-sorted (`'OS/2'` < `'cmap'` < `'fvar'` < `'name'`) — sfnt table directories must
 * be tag-sorted, and since this list is fixed, that order needs no runtime sort.
 */
const REASSEMBLY_TAG_ORDER = ['OS/2', 'cmap', 'fvar', 'name'] as const;

/**
 * Tables worth reassembling out of a compressed container — see the docstring above
 * {@link REASSEMBLY_TAG_ORDER}. Exported so metadata.ts's WOFF1 decoder reassembles the
 * same four tables as WOFF2 does here, rather than picking its own (possibly
 * inconsistent) set.
 */
export const REASSEMBLY_TAGS: ReadonlySet<string> = new Set<string>(REASSEMBLY_TAG_ORDER);

/**
 * Build a minimal, valid sfnt containing only the reassembled tables present
 * (already-decompressed bytes). Checksums are left as 0 — nothing in this codebase's
 * sfnt reader verifies them (see `readTableDirectory` in sfnt.ts).
 *
 * Exported so metadata.ts can reuse it for WOFF1 reassembly (`decodeWoff1`) rather than
 * duplicating this sfnt-building logic — WOFF1 and WOFF2 both reduce to "here are some
 * decompressed table bodies, wrap them in a valid sfnt directory".
 */
export function buildMinimalSfnt(tables: Map<string, Uint8Array>): ArrayBuffer {
  const ordered = REASSEMBLY_TAG_ORDER.flatMap((tag) => {
    const bytes = tables.get(tag);
    return bytes === undefined ? [] : [{ tag, bytes }];
  });
  const directorySize = SFNT_HEADER_SIZE + ordered.length * SFNT_DIRECTORY_ENTRY_SIZE;
  let offset = directorySize;
  const placed = ordered.map((table) => {
    const entry = { tag: table.tag, bytes: table.bytes, offset };
    offset += align4(table.bytes.byteLength);
    return entry;
  });

  const out = new Uint8Array(offset);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x0001_0000); // sfnt version 1.0
  view.setUint16(4, placed.length);
  view.setUint16(6, 0); // searchRange — unused by this codebase's reader
  view.setUint16(8, 0); // entrySelector
  view.setUint16(10, 0); // rangeShift

  placed.forEach((table, index) => {
    const entryBase = SFNT_HEADER_SIZE + index * SFNT_DIRECTORY_ENTRY_SIZE;
    for (let c = 0; c < 4; c++) {
      view.setUint8(entryBase + c, table.tag.charCodeAt(c));
    }
    view.setUint32(entryBase + 4, 0); // checksum
    view.setUint32(entryBase + 8, table.offset);
    view.setUint32(entryBase + 12, table.bytes.byteLength);
    out.set(table.bytes, table.offset);
  });

  return out.buffer;
}

/**
 * Reconstruct just enough of the sfnt inside a woff2 so `parseSfnt` can read `name`,
 * `OS/2`, `cmap` and `fvar` — family, subfamily, weight, italic, license, script
 * coverage and variable-font axes, whichever of those four tables the font actually
 * has. A full sfnt (every table, glyf/loca/hmtx detransformed) is out of scope: those
 * three are the only tables WOFF2 defines transforms for, so this function only
 * handles the tables that are always stored untransformed, where copying the
 * decompressed bytes behind a freshly built directory is enough. `glyf`/`loca`/`hmtx`
 * and hinting/layout tables (`GPOS`/`GSUB`/`kern`/…) are never reassembled — callers
 * get metadata, not a renderable font. TTC/`ttcf`-flavoured collections are also out of
 * scope; `parseWoff2Directory` assumes a single-font woff2.
 *
 * Returns null when no decoder is available or the font cannot be reassembled, which is
 * a supported outcome: the metadata chain falls through to the sibling-file and
 * filename levels. Never throws for a merely-unsupported font — callers treat null as
 * "try the next level".
 */
export async function decodeWoff2(buf: ArrayBuffer): Promise<ArrayBuffer | null> {
  try {
    const directory = parseWoff2Directory(buf);
    const { default: decompress } = await import('brotli/decompress.js');
    const bytes = new Uint8Array(buf);
    const compressed = bytes.subarray(
      directory.directoryEnd,
      directory.directoryEnd + directory.totalCompressedSize,
    );
    // Throws (caught below) rather than returning null for input it can't decompress —
    // see the ambient declaration in brotli.d.ts.
    const decompressed = decompress(compressed);

    // name/OS/2 bodies sit at the cumulative offset of every table before them in
    // directory order — the decompressed stream is a plain concatenation of table
    // bodies, uncompressed table directory aside.
    const tables = new Map<string, Uint8Array>();
    let streamOffset = 0;
    for (const entry of directory.entries) {
      if (REASSEMBLY_TAGS.has(entry.tag)) {
        if (streamOffset + entry.streamLength > decompressed.byteLength) {
          return null;
        }
        tables.set(
          entry.tag,
          decompressed.subarray(streamOffset, streamOffset + entry.streamLength),
        );
      }
      streamOffset += entry.streamLength;
    }

    if (tables.size === 0) {
      return null;
    }
    return buildMinimalSfnt(tables);
  } catch {
    return null;
  }
}
