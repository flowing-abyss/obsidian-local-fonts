import { describe, expect, it } from 'vitest';
import { isHiddenPath } from './hidden-path.js';

describe('isHiddenPath', () => {
  it('accepts a plain folder', () => {
    expect(isHiddenPath('fonts')).toBe(false);
  });

  it('accepts a nested folder with no dot in it', () => {
    expect(isHiddenPath('assets/fonts')).toBe(false);
  });

  it('flags a leading dot', () => {
    expect(isHiddenPath('.fonts')).toBe(true);
  });

  it('flags a dot on a segment other than the first, which startsWith could not see', () => {
    expect(isHiddenPath('assets/.fonts')).toBe(true);
  });

  it('flags a hidden folder anywhere in a deep path', () => {
    expect(isHiddenPath('a/b/.hidden/c/fonts')).toBe(true);
  });

  it('does not treat a dot inside a name as hidden', () => {
    expect(isHiddenPath('my.fonts')).toBe(false);
  });

  it('does not treat the relative-path segments as hidden folders', () => {
    // "./fonts" and "../fonts" name visible folders; only a dot that starts an
    // actual folder name makes Sync skip it.
    expect(isHiddenPath('./fonts')).toBe(false);
    expect(isHiddenPath('../fonts')).toBe(false);
  });

  it('treats the vault root as visible', () => {
    expect(isHiddenPath('')).toBe(false);
  });
});
