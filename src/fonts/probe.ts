import { parseFontFamilies, quote } from './family.js';

export type FontLoadStatus = 'loaded' | 'failed' | 'unverified';
export type StackStatus = 'first' | 'preceded' | 'absent';

/** FontFaceSet.load resolves with the matching loaded faces, or rejects on load failure.
 * Source: https://www.w3.org/TR/css-font-loading-3/#dom-fontfaceset-load */
export async function loadLocalFont(
  doc: Document,
  family: string,
  sample: string,
): Promise<FontLoadStatus> {
  const fonts = (doc as unknown as { fonts?: FontFaceSet }).fonts;
  if (fonts === undefined) return 'unverified';
  try {
    return (await fonts.load(`64px ${quote(family)}`, sample)).length > 0 ? 'loaded' : 'unverified';
  } catch {
    return 'failed';
  }
}

/** Compare only the requested CSS stack. This cannot establish which glyph was drawn. */
export function inspectStack(
  value: string,
  family: string,
  ignoredFamilies: readonly string[] = [],
): StackStatus {
  const parsed = parseFontFamilies(value);
  const ignored = new Set(ignoredFamilies.map((name) => name.toLowerCase()));
  const stack = parsed.filter(
    (entry) => entry.name !== '??' && !ignored.has(entry.name.toLowerCase()),
  );
  const index = stack.findIndex(
    (entry) => !entry.generic && entry.name.toLowerCase() === family.toLowerCase(),
  );
  if (index < 0) return 'absent';
  return index === 0 ? 'first' : 'preceded';
}
