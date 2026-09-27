import { expect, it } from 'vitest';
import { quote } from './family.js';
it('quotes punctuation and escapes controls without terminating the CSS string', () => {
  expect(quote("A,B'\\C\n\r\f\x01F")).toBe("'A,B\\'\\\\C\\a \\d \\c \\1 F'");
});
