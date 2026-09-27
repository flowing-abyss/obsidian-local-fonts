import { expect, it } from 'vitest';
import { parseFontFamilies, quote } from './family.js';
it('quotes punctuation and escapes controls without terminating the CSS string', () => {
  expect(quote("A,B'\\C\n\r\f\x01F")).toBe("'A,B\\'\\\\C\\a \\d \\c \\1 F'");
});

it('parses quoted commas, escaped quotes, and generics', () => {
  expect(parseFontFamilies('"Name, With Comma", "Quoted\\"Name", sans-serif')).toEqual([
    { name: 'Name, With Comma', generic: false },
    { name: 'Quoted"Name', generic: false },
    { name: 'sans-serif', generic: true },
  ]);
});

it('parses single quotes, backslashes, hex escapes, and unquoted multiword names', () => {
  expect(parseFontFamilies("'A\\\\B', Role\\20 Text, Role     Headings, '\\41  B'")).toEqual([
    { name: 'A\\B', generic: false },
    { name: 'Role Text', generic: false },
    { name: 'Role Headings', generic: false },
    { name: 'A B', generic: false },
  ]);
});

it('rejects empty or malformed lists rather than claiming a first family', () => {
  for (const input of [
    '',
    '""',
    ', A',
    'A,',
    'A,,B',
    '"A',
    'A\\',
    '"A"B',
    '"A\\',
    '"A\nB"',
    '"A\rB"',
    '"A\fB"',
    'Role Text;',
    'Role Text, var(--other)',
    '?Role Text',
  ]) {
    expect(parseFontFamilies(input)).toEqual([]);
  }
});

it('decodes CSS escaped code points and consumes only the optional whitespace terminator', () => {
  expect(parseFontFamilies("'\\1f600  ', '\\41 B', '\\0 ', '\\d800 ', '\\110000 '")).toEqual([
    { name: '😀 ', generic: false },
    { name: 'AB', generic: false },
    { name: '\ufffd', generic: false },
    { name: '\ufffd', generic: false },
    { name: '\ufffd', generic: false },
  ]);
  expect(parseFontFamilies("'A\\\nB', 'A\\\r\nB', 'A\\\fB'")).toEqual([
    { name: 'AB', generic: false },
    { name: 'AB', generic: false },
    { name: 'AB', generic: false },
  ]);
});
