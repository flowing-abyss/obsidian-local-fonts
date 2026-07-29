import type { ColorFormat, Script, VariableAxis } from './types.js';

export interface TableEntry {
  offset: number;
  length: number;
}

export interface SfntInfo {
  family: string;
  subfamily: string;
  weight: number;
  italic: boolean;
  colorFormats: ColorFormat[];
  scripts: Script[];
  axes: VariableAxis[];
  license: string | null;
}

const SFNT_VERSIONS = new Set([0x0001_0000, 0x4f54_544f, 0x74727565]);

/**
 * Read the table directory of an uncompressed sfnt (ttf/otf). Tag → offset/length.
 * woff2 has its own directory format — see woff2.ts.
 */
export function readTableDirectory(buf: ArrayBuffer): Map<string, TableEntry> {
  const view = new DataView(buf);
  if (buf.byteLength < 12 || !SFNT_VERSIONS.has(view.getUint32(0))) {
    throw new Error('Not an sfnt font: unrecognised version tag');
  }
  const numTables = view.getUint16(4);
  const dir = new Map<string, TableEntry>();
  for (let i = 0; i < numTables; i++) {
    const base = 12 + i * 16;
    if (base + 16 > buf.byteLength) {
      break;
    }
    const tag = String.fromCharCode(
      view.getUint8(base),
      view.getUint8(base + 1),
      view.getUint8(base + 2),
      view.getUint8(base + 3),
    );
    dir.set(tag, { offset: view.getUint32(base + 8), length: view.getUint32(base + 12) });
  }
  return dir;
}

/**
 * Map table tags to colour formats. COLR is split by version because engine support
 * differs between v0 and v1; reading the version needs the table body, so callers that
 * only have tags (a woff2 directory) get COLR1 assumed — the safer guess, since a v0-only
 * font misreported as v1 still renders on every engine that lists v0.
 */
export function colorFormatsFromTags(
  tags: Iterable<string>,
  buf?: ArrayBuffer,
  dir?: Map<string, TableEntry>,
): ColorFormat[] {
  const present = new Set(tags);
  const formats: ColorFormat[] = [];
  if (present.has('COLR')) {
    const entry = dir?.get('COLR');
    const version =
      buf !== undefined && entry !== undefined ? new DataView(buf).getUint16(entry.offset) : 1;
    formats.push(version >= 1 ? 'COLR1' : 'COLR0');
  }
  if (present.has('CBDT')) {
    formats.push('CBDT');
  }
  if (present.has('sbix')) {
    formats.push('sbix');
  }
  if (present.has('SVG ')) {
    formats.push('SVG');
  }
  return formats;
}

const NAME_FAMILY = 1;
const NAME_SUBFAMILY = 2;
const NAME_LICENSE = 13;
const NAME_TYPOGRAPHIC_FAMILY = 16;
const NAME_TYPOGRAPHIC_SUBFAMILY = 17;

function decodeNameString(
  view: DataView,
  offset: number,
  length: number,
  platformId: number,
): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
  // Platform 3 (Windows) and platform 0 (Unicode) store UTF-16BE; platform 1 (Mac) is
  // MacRoman, which is ASCII-compatible for the Latin names fonts actually use.
  const encoding = platformId === 1 ? 'latin1' : 'utf-16be';
  const decoded = new TextDecoder(encoding).decode(bytes);
  const nul = decoded.indexOf('\0');
  return nul === -1 ? decoded : decoded.slice(0, nul);
}

function readNames(buf: ArrayBuffer, entry: TableEntry): Map<number, string> {
  const view = new DataView(buf, entry.offset, entry.length);
  const count = view.getUint16(2);
  const stringOffset = view.getUint16(4);
  const names = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    if (rec + 12 > view.byteLength) {
      break;
    }
    const platformId = view.getUint16(rec);
    const nameId = view.getUint16(rec + 6);
    const length = view.getUint16(rec + 8);
    const offset = view.getUint16(rec + 10);
    // Prefer the first record seen for a given id; fonts repeat ids per platform.
    if (!names.has(nameId) && stringOffset + offset + length <= view.byteLength) {
      names.set(nameId, decodeNameString(view, stringOffset + offset, length, platformId));
    }
  }
  return names;
}

/** Ranges that identify a writing system. A single codepoint hit is enough to claim support. */
const SCRIPT_PROBES: ReadonlyArray<readonly [Script, readonly number[]]> = [
  ['latin', [0x41, 0x7a]],
  ['cyrillic', [0x410, 0x44f]],
  ['greek', [0x391, 0x3c9]],
  ['vietnamese', [0x1ea0, 0x1ef9]],
  ['emoji', [0x1f600, 0x1f64f, 0x1f300, 0x1f5ff, 0x2600, 0x26ff]],
];

function readCmapCodepoints(buf: ArrayBuffer, entry: TableEntry): Set<number> {
  const view = new DataView(buf, entry.offset, entry.length);
  const numSubtables = view.getUint16(2);
  const codepoints = new Set<number>();
  for (let i = 0; i < numSubtables; i++) {
    const rec = 4 + i * 8;
    if (rec + 8 > view.byteLength) {
      break;
    }
    const subtableOffset = view.getUint32(rec + 4);
    if (subtableOffset + 4 > view.byteLength) {
      continue;
    }
    const format = view.getUint16(subtableOffset);
    if (format === 4) {
      readCmapFormat4(view, subtableOffset, codepoints);
    } else if (format === 12) {
      readCmapFormat12(view, subtableOffset, codepoints);
    }
  }
  return codepoints;
}

function readCmapFormat4(view: DataView, base: number, out: Set<number>): void {
  const segCountX2 = view.getUint16(base + 6);
  const endBase = base + 14;
  const startBase = endBase + segCountX2 + 2;
  for (let s = 0; s < segCountX2; s += 2) {
    const end = view.getUint16(endBase + s);
    const start = view.getUint16(startBase + s);
    if (start === 0xffff) {
      continue;
    }
    for (let cp = start; cp <= end && cp - start < 0x1000; cp++) {
      out.add(cp);
    }
  }
}

function readCmapFormat12(view: DataView, base: number, out: Set<number>): void {
  const numGroups = view.getUint32(base + 12);
  for (let g = 0; g < numGroups; g++) {
    const rec = base + 16 + g * 12;
    if (rec + 12 > view.byteLength) {
      break;
    }
    const start = view.getUint32(rec);
    const end = view.getUint32(rec + 4);
    for (let cp = start; cp <= end && cp - start < 0x1000; cp++) {
      out.add(cp);
    }
  }
}

function scriptsFrom(codepoints: Set<number>): Script[] {
  const found: Script[] = [];
  for (const [script, probes] of SCRIPT_PROBES) {
    let hit = false;
    for (const cp of codepoints) {
      if (inAnyRange(cp, probes)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      found.push(script);
    }
  }
  return found;
}

function inAnyRange(cp: number, probes: readonly number[]): boolean {
  for (let i = 0; i + 1 < probes.length; i += 2) {
    const start = probes[i];
    const end = probes[i + 1];
    if (start !== undefined && end !== undefined && cp >= start && cp <= end) {
      return true;
    }
  }
  return false;
}

function readAxes(buf: ArrayBuffer, entry: TableEntry | undefined): VariableAxis[] {
  if (entry === undefined) {
    return [];
  }
  const view = new DataView(buf, entry.offset, entry.length);
  const axesArrayOffset = view.getUint16(4);
  const axisCount = view.getUint16(8);
  const axisSize = view.getUint16(10);
  const axes: VariableAxis[] = [];
  for (let i = 0; i < axisCount; i++) {
    const rec = axesArrayOffset + i * axisSize;
    if (rec + 20 > view.byteLength) {
      break;
    }
    axes.push({
      tag: String.fromCharCode(
        view.getUint8(rec),
        view.getUint8(rec + 1),
        view.getUint8(rec + 2),
        view.getUint8(rec + 3),
      ),
      min: view.getInt32(rec + 4) / 65536,
      default: view.getInt32(rec + 8) / 65536,
      max: view.getInt32(rec + 12) / 65536,
    });
  }
  return axes;
}

const OS2_ITALIC_BIT = 0x01;
const OS2_DEFAULT_WEIGHT = 400;

interface Os2Info {
  weight: number;
  italic: boolean;
}

function readOs2(buf: ArrayBuffer, entry: TableEntry | undefined): Os2Info {
  if (entry === undefined) {
    return { weight: OS2_DEFAULT_WEIGHT, italic: false };
  }
  const view = new DataView(buf, entry.offset, entry.length);
  return {
    weight: view.getUint16(4),
    italic: (view.getUint16(62) & OS2_ITALIC_BIT) !== 0,
  };
}

/** Parse everything the plugin needs from an uncompressed sfnt. */
export function parseSfnt(buf: ArrayBuffer): SfntInfo {
  const dir = readTableDirectory(buf);
  const nameEntry = dir.get('name');
  const names = nameEntry === undefined ? new Map<number, string>() : readNames(buf, nameEntry);

  const { weight, italic } = readOs2(buf, dir.get('OS/2'));

  const cmap = dir.get('cmap');
  const scripts = cmap === undefined ? [] : scriptsFrom(readCmapCodepoints(buf, cmap));

  return {
    family: names.get(NAME_TYPOGRAPHIC_FAMILY) ?? names.get(NAME_FAMILY) ?? '',
    subfamily: names.get(NAME_TYPOGRAPHIC_SUBFAMILY) ?? names.get(NAME_SUBFAMILY) ?? '',
    weight,
    italic,
    colorFormats: colorFormatsFromTags(dir.keys(), buf, dir),
    scripts,
    axes: readAxes(buf, dir.get('fvar')),
    license: names.get(NAME_LICENSE) ?? null,
  };
}
