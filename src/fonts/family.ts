/**
 * Escape a family name for use inside a single-quoted CSS string. Exported so the
 * settings tab can quote a family the same way when setting a preview element's
 * `font-family` inline (family names are arbitrary text read out of a font binary,
 * not something that can be hardcoded in styles.css).
 */
export function quote(family: string): string {
  const escaped = family
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    // CSS strings cannot contain literal line breaks or control characters.
    // eslint-disable-next-line no-control-regex -- Font metadata can contain arbitrary controls.
    .replace(/[\x00-\x1f\x7f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `);
  return `'${escaped}'`;
}
