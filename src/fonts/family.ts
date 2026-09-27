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

export interface ParsedFamily {
  name: string;
  generic: boolean;
}

const GENERICS = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
]);
const SPACE = /[\t\n\f\r ]/;
const HEX = /[\da-f]/i;
const NEWLINE = /[\n\r\f]/;
const UNQUOTED_CHARACTER = /[-_a-zA-Z0-9\u0080-\uffff\t\n\f\r ]/;

function decodedCodepoint(code: number): string {
  const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
  return valid ? String.fromCodePoint(code) : '\ufffd';
}

/** CSS Syntax escape decoding: https://www.w3.org/TR/css-syntax-3/#consume-an-escaped-code-point */
function hexEscapeAt(value: string, start: number): [string, number] {
  let end = start + 1;
  while (end < value.length && end < start + 7 && HEX.test(value[end] ?? '')) end++;
  const code = Number.parseInt(value.slice(start + 1, end), 16);
  if (SPACE.test(value[end] ?? '')) {
    if (value[end] === '\r' && value[end + 1] === '\n') end++;
    end++;
  }
  return [decodedCodepoint(code), end];
}

function escapeAt(value: string, start: number): [string, number] | null {
  const next = value[start + 1];
  if (next === undefined) return null;
  if (next === '\r') return ['', value[start + 2] === '\n' ? start + 3 : start + 2];
  if (next === '\n' || next === '\f') return ['', start + 2];
  return HEX.test(next) ? hexEscapeAt(value, start) : [next, start + 2];
}

function skipSpace(value: string, start: number): number {
  let end = start;
  while (SPACE.test(value[end] ?? '')) end++;
  return end;
}

function quotedFamily(value: string, start: number, mark: string): [string, number] | null {
  let name = '';
  let i = start + 1;
  while (i < value.length) {
    const char = value[i] ?? '';
    if (char === mark) return [name, i + 1];
    if (NEWLINE.test(char)) return null;
    const part: [string, number] | null = char === '\\' ? escapeAt(value, i) : [char, i + 1];
    if (part === null) return null;
    name += part[0];
    i = part[1];
  }
  return null;
}

function unquotedPart(value: string, index: number): [string, number] | null {
  const char = value[index];
  if (char === '\\') return escapeAt(value, index);
  if (char === undefined || !UNQUOTED_CHARACTER.test(char)) return null;
  return [char, index + 1];
}

function unquotedFamily(value: string, start: number): [string, number] | null {
  if (value.slice(start, start + 2) === '??') return ['??', start + 2];
  let name = '';
  let i = start;
  while (i < value.length && value[i] !== ',') {
    const part = unquotedPart(value, i);
    if (part === null) return null;
    name += part[0];
    i = part[1];
  }
  return [name.replace(/[\t\n\f\r ]+/g, ' ').trim(), i];
}

function oneFamily(value: string, start: number): [ParsedFamily, number] | null {
  const mark = value[start];
  const quoted = mark === '"' || mark === "'";
  const result = quoted ? quotedFamily(value, start, mark) : unquotedFamily(value, start);
  if (result === null || result[0] === '') return null;
  const [name, offset] = result;
  const end = quoted ? skipSpace(value, offset) : offset;
  if (end < value.length && value[end] !== ',') return null;
  return [{ name, generic: !quoted && GENERICS.has(name.toLowerCase()) }, end];
}

/** Parse a computed font-family list; a malformed list yields no order claim. */
export function parseFontFamilies(value: string): ParsedFamily[] {
  const families: ParsedFamily[] = [];
  let i = skipSpace(value, 0);
  while (i < value.length) {
    const result = oneFamily(value, i);
    if (result === null) return [];
    families.push(result[0]);
    if (result[1] === value.length) return families;
    i = skipSpace(value, result[1] + 1);
  }
  return [];
}
