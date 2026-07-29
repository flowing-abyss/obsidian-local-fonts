import { describe, expect, it } from 'vitest';
import { formatOf, parseFilename } from './filename.js';

describe('formatOf', () => {
  it.each([
    ['a/b/x.woff2', 'woff2'],
    ['x.WOFF', 'woff'],
    ['x.otf', 'otf'],
    ['x.ttf', 'ttf'],
  ])('recognises %s', (path, expected) => {
    expect(formatOf(path)).toBe(expected);
  });

  it('returns null for a file that is not a font', () => {
    expect(formatOf('.fonts/readme.md')).toBeNull();
  });
});

describe('parseFilename', () => {
  it('reads a numeric weight suffix', () => {
    expect(parseFilename('ibm-plex-sans-600.woff2')).toStrictEqual({
      family: 'Ibm Plex Sans',
      weight: 600,
      italic: false,
    });
  });

  it('reads a numeric weight with italic', () => {
    expect(parseFilename('ibm-plex-sans-600italic.woff2')).toStrictEqual({
      family: 'Ibm Plex Sans',
      weight: 600,
      italic: true,
    });
  });

  it('maps the word "regular" to 400', () => {
    expect(parseFilename('probe-sans-regular.ttf').weight).toBe(400);
  });

  it('maps named weights', () => {
    expect(parseFilename('Roboto-Bold.ttf').weight).toBe(700);
    expect(parseFilename('Roboto-Light.ttf').weight).toBe(300);
    expect(parseFilename('Roboto-SemiBold.ttf').weight).toBe(600);
  });

  it('defaults to 400 upright when the name says nothing', () => {
    expect(parseFilename('mystery.woff2')).toStrictEqual({
      family: 'Mystery',
      weight: 400,
      italic: false,
    });
  });

  it('treats a filename with no extension as its own stem', () => {
    expect(parseFilename('mystery')).toStrictEqual({
      family: 'Mystery',
      weight: 400,
      italic: false,
    });
  });

  it('falls back to the raw stem when every character is consumed by the weight suffix', () => {
    // The whole stem is the numeric weight suffix itself, so stripping it leaves an
    // empty family; parseFilename must fall back to the original stem rather than
    // returning an empty string.
    expect(parseFilename('600.ttf')).toStrictEqual({
      family: '600',
      weight: 600,
      italic: false,
    });
  });
});
