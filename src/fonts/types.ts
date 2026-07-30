/** Colour-glyph technologies a font may carry. Engine support differs; see platform.ts. */
export type ColorFormat = 'COLR0' | 'COLR1' | 'CBDT' | 'sbix' | 'SVG';

/** Container formats the plugin can read. */
export type FontFormat = 'woff2' | 'woff' | 'otf' | 'ttf';

/** Which level of the extraction chain produced a record. Surfaced in diagnostics. */
export type MetadataSource = 'name-table' | 'sibling' | 'filename';

/** Writing systems reported from the cmap. */
export type Script = 'latin' | 'cyrillic' | 'greek' | 'vietnamese' | 'emoji';

export interface VariableAxis {
  tag: string;
  min: number;
  max: number;
  default: number;
}

/** One font file. Platform-neutral: carries every colour format it has, chooses nothing. */
export interface FaceRecord {
  /** Vault-relative path, e.g. `.fonts/ibm-plex-sans/ibm-plex-sans-400.woff2`. */
  path: string;
  format: FontFormat;
  size: number;
  mtime: number;
  family: string;
  weight: number;
  italic: boolean;
  colorFormats: ColorFormat[];
  scripts: Script[];
  axes: VariableAxis[];
  license: string | null;
  source: MetadataSource;
}

/**
 * Cache format version. Bump when FaceRecord changes shape, or when the meaning of
 * an existing field changes enough that a stale cache would serve wrong data — a
 * mismatch forces a rescan. Bumped to 2: parseSfnt now recovers the typographic
 * family and weight for legacy-named fonts (see sfnt.ts), so a cache built by the
 * old parser holds `family`/`weight` values computed the old, buggy way.
 */
export const CACHE_VERSION = 2;

export interface FontCache {
  version: typeof CACHE_VERSION;
  /** Folder the cache was built from. A change invalidates it. */
  folder: string;
  faces: FaceRecord[];
}

/** A file's identity for staleness checks: path plus the size/mtime pair that changes when it does. */
export interface FileStamp {
  path: string;
  size: number;
  mtime: number;
}
