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

/** A directory entry may lie about a table's extent in a truncated or corrupt file. */
function tableView(buf: ArrayBuffer, entry: TableEntry): DataView | null {
  if (entry.offset < 0 || entry.length < 0 || entry.offset + entry.length > buf.byteLength) {
    return null;
  }
  return new DataView(buf, entry.offset, entry.length);
}

/**
 * COLR is split by version because engine support differs between v0 and v1; reading
 * the version needs the table body, so callers that only have tags (a woff2 directory,
 * which yields tags but never table bodies) get COLR1 assumed — the safer guess, since a
 * v0-only font misreported as v1 still renders on every engine that lists v0.
 */
function colrFormat(buf: ArrayBuffer | undefined, entry: TableEntry | undefined): ColorFormat {
  const view = buf !== undefined && entry !== undefined ? tableView(buf, entry) : null;
  const version = view !== null && view.byteLength >= 2 ? view.getUint16(0) : 1;
  return version >= 1 ? 'COLR1' : 'COLR0';
}

/** Map table tags to colour formats. See {@link colrFormat} for the COLR version rule. */
export function colorFormatsFromTags(
  tags: Iterable<string>,
  buf?: ArrayBuffer,
  dir?: Map<string, TableEntry>,
): ColorFormat[] {
  const present = new Set(tags);
  const formats: ColorFormat[] = [];
  if (present.has('COLR')) {
    formats.push(colrFormat(buf, dir?.get('COLR')));
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

/**
 * Canonical weight for a normalised (lowercase, no spaces/hyphens) style word — a
 * lookup table rather than a chain of conditionals, so adding a synonym never adds
 * branching complexity. "extralight"/"ultralight" and "light" are distinct keys, so
 * one can never be mistaken for the other.
 */
const STYLE_WORD_WEIGHT: Readonly<Record<string, number>> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

function weightOfStyleWord(normalised: string): number | null {
  return STYLE_WORD_WEIGHT[normalised] ?? null;
}

/** Trailing "Italic"/"Oblique", with its leading separator (if any). */
const TRAILING_ITALIC = /[\s-]?(?:italic|oblique)$/i;

/** Splits on the separators a style token may be written with: space or hyphen. */
const WORD_SEPARATOR = /[\s-]+/;

function stripTrailingItalic(text: string): string {
  const match = TRAILING_ITALIC.exec(text);
  return match === null ? text : text.slice(0, match.index);
}

interface TrailingStyleToken {
  /** ID1 with the trailing style token (and any Italic/Oblique suffix) removed. */
  strippedFamily: string;
  weight: number;
}

/**
 * Finds a trailing weight word in a legacy-named ID1 family, e.g. "IBM Plex Serif
 * Thin" or "Bodoni Moda Semi Bold" — with or without the internal space, a compound
 * token like "SemiBold"/"Semi Bold" is tried as its last *two* words before falling
 * back to its last word alone, so "Semi Bold" is recognised as one token rather than
 * "Bold" alone. A trailing Italic/Oblique suffix, if present, is stripped first.
 */
function findTrailingStyleToken(id1: string): TrailingStyleToken | null {
  const words = stripTrailingItalic(id1)
    .split(WORD_SEPARATOR)
    .filter((word) => word !== '');
  if (words.length === 0) {
    return null;
  }

  const lastWord = words[words.length - 1] ?? '';
  const lastTwoWords = words.length >= 2 ? words.slice(-2).join('') : null;
  const compoundWeight =
    lastTwoWords === null ? null : weightOfStyleWord(lastTwoWords.toLowerCase());
  const wordsConsumed = compoundWeight !== null ? 2 : 1;
  const weight = compoundWeight ?? weightOfStyleWord(lastWord.toLowerCase());
  if (weight === null) {
    return null;
  }

  return { strippedFamily: words.slice(0, -wordsConsumed).join(' '), weight };
}

/**
 * Weight implied by a style-only string such as ID17 ("Thin", "ExtraLight Italic") —
 * the whole string (minus an Italic/Oblique suffix, and internal separators) must
 * resolve to a single style word, unlike {@link findTrailingStyleToken} which only
 * needs to match a suffix of a longer family name.
 */
function weightOfStyleString(text: string): number | null {
  const normalised = stripTrailingItalic(text).replace(/[\s-]/g, '').toLowerCase();
  return weightOfStyleWord(normalised);
}

interface FamilyAndWeight {
  family: string;
  weight: number;
}

/**
 * Resolves the family and weight `parseSfnt` reports, folding together Bug 1 (legacy
 * family names bake a weight word into ID1 when there is no ID16) and Bug 2
 * (usWeightClass can collide across genuinely distinct faces) — both read from the
 * same trailing-token recovery, so it is done once here rather than twice inline.
 *
 * - family: ID16 if present; otherwise ID1, with a trailing style token stripped
 *   only when that token's weight matches `os2Weight` (a made-up name like "Black
 *   Ops One" at weight 400 must not lose "Ops One").
 * - weight: a style token naming the weight — ID17 if present, otherwise the same
 *   token stripped from ID1 above — takes priority over `os2Weight`, which is the
 *   value known to be unreliable in the wild. Falls back to `os2Weight` when no
 *   such token exists, the common case for well-formed fonts.
 */
function resolveFamilyAndWeight(
  names: ReadonlyMap<number, string>,
  os2Weight: number,
): FamilyAndWeight {
  const typographicFamily = names.get(NAME_TYPOGRAPHIC_FAMILY);
  const id1 = names.get(NAME_FAMILY) ?? '';
  const legacyToken = typographicFamily === undefined ? findTrailingStyleToken(id1) : null;
  const family =
    typographicFamily ??
    (legacyToken !== null && legacyToken.weight === os2Weight ? legacyToken.strippedFamily : id1);

  const typographicSubfamily = names.get(NAME_TYPOGRAPHIC_SUBFAMILY);
  const subfamilyTokenWeight =
    typographicSubfamily === undefined ? null : weightOfStyleString(typographicSubfamily);
  const weight = subfamilyTokenWeight ?? legacyToken?.weight ?? os2Weight;

  return { family, weight };
}

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
  const view = tableView(buf, entry);
  if (view === null) {
    return new Map<number, string>();
  }
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
  const codepoints = new Set<number>();
  const view = tableView(buf, entry);
  if (view === null) {
    return codepoints;
  }
  const numSubtables = view.getUint16(2);
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

/**
 * Enumerates the codepoints a format-4 subtable's [start, end] segments claim to map.
 * This approximates script coverage for detection purposes; a codepoint being mapped
 * does not guarantee the glyph it points to is non-empty or renders — good enough for
 * "does this font claim Cyrillic" but not for glyph-exact presence checks.
 */
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

/** Same approximation as {@link readCmapFormat4}, for format-12 [start, end] groups. */
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
  const view = tableView(buf, entry);
  if (view === null) {
    return [];
  }
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

const OS2_FS_SELECTION_OFFSET = 62;
const OS2_MIN_LENGTH = OS2_FS_SELECTION_OFFSET + 2;

function readOs2(buf: ArrayBuffer, entry: TableEntry | undefined): Os2Info {
  const defaults: Os2Info = { weight: OS2_DEFAULT_WEIGHT, italic: false };
  if (entry === undefined) {
    return defaults;
  }
  const view = tableView(buf, entry);
  if (view === null || view.byteLength < OS2_MIN_LENGTH) {
    return defaults;
  }
  return {
    weight: view.getUint16(4),
    italic: (view.getUint16(OS2_FS_SELECTION_OFFSET) & OS2_ITALIC_BIT) !== 0,
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

  // Bugs 1 & 2: see resolveFamilyAndWeight's own doc comment.
  const resolved = resolveFamilyAndWeight(names, weight);

  return {
    family: resolved.family,
    subfamily: names.get(NAME_TYPOGRAPHIC_SUBFAMILY) ?? names.get(NAME_SUBFAMILY) ?? '',
    weight: resolved.weight,
    italic,
    colorFormats: colorFormatsFromTags(dir.keys(), buf, dir),
    scripts,
    axes: readAxes(buf, dir.get('fvar')),
    license: names.get(NAME_LICENSE) ?? null,
  };
}
