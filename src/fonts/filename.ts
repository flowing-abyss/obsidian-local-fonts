import type { FontFormat } from './types.js';

const FORMATS: Record<string, FontFormat> = {
  woff2: 'woff2',
  woff: 'woff',
  otf: 'otf',
  ttf: 'ttf',
};

/** The container format implied by a path's extension, or null if it is not a font. */
export function formatOf(path: string): FontFormat | null {
  // The extension must come from the final path segment: a folder name containing a
  // dot (e.g. "my.fonts/plain") must not make an extensionless filename look like it
  // has one.
  const file = path.slice(path.lastIndexOf('/') + 1);
  const dot = file.lastIndexOf('.');
  if (dot === -1) {
    return null;
  }
  const ext = file.slice(dot + 1).toLowerCase();
  return FORMATS[ext] ?? null;
}

const NAMED_WEIGHTS: ReadonlyArray<readonly [RegExp, number]> = [
  [/thin|hairline/i, 100],
  [/extralight|ultralight/i, 200],
  [/semibold|demibold/i, 600],
  [/extrabold|ultrabold/i, 800],
  [/black|heavy/i, 900],
  [/light/i, 300],
  [/regular|normal|book/i, 400],
  [/medium/i, 500],
  [/bold/i, 700],
];

/**
 * Last-resort metadata, used only when no level above could read the font itself.
 * Ordering in NAMED_WEIGHTS matters: "semibold" must be tested before "bold", and
 * "extralight" before "light", or the shorter word wins on a longer name.
 */
export function parseFilename(fileName: string): {
  family: string;
  weight: number;
  italic: boolean;
} {
  const dot = fileName.lastIndexOf('.');
  const stem = dot === -1 ? fileName : fileName.slice(0, dot);
  const italic = /italic|oblique/i.test(stem);

  let weight = 400;
  const numeric = /(?:^|[-_ ])([1-9]00)(?:italic|oblique)?$/i.exec(stem);
  if (numeric !== null) {
    weight = Number(numeric[1]);
  } else {
    for (const [pattern, value] of NAMED_WEIGHTS) {
      if (pattern.test(stem)) {
        weight = value;
        break;
      }
    }
  }

  const family = stem
    .replace(/[-_ ]?(?:italic|oblique)$/i, '')
    .replace(/(?:^|[-_ ])[1-9]00$/i, '')
    .replace(
      /[-_ ](?:thin|hairline|extralight|ultralight|light|regular|normal|book|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy)$/i,
      '',
    )
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return { family: family !== '' ? family : stem, weight, italic };
}
