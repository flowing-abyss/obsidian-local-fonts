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

/** Cache format version. Bump when FaceRecord changes shape; a mismatch forces a rescan. */
export const CACHE_VERSION = 1;

export interface FontCache {
  version: typeof CACHE_VERSION;
  /** Folder the cache was built from. A change invalidates it. */
  folder: string;
  faces: FaceRecord[];
}
