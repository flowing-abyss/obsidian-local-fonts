import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings.js';

describe('DEFAULT_SETTINGS', () => {
  it('defaults to a hidden fonts folder so the note tree stays clean', () => {
    expect(DEFAULT_SETTINGS.folder).toBe('.fonts');
  });

  it('assigns no family to any role until the user picks one', () => {
    expect(DEFAULT_SETTINGS.roles).toStrictEqual({
      text: null,
      interface: null,
      monospace: null,
      headings: null,
      emoji: null,
    });
  });

  it('leaves hard override off, so themes keep working until asked otherwise', () => {
    expect(DEFAULT_SETTINGS.hardOverride).toBe(false);
  });

  it('starts with an empty cache', () => {
    expect(DEFAULT_SETTINGS.cache).toBeNull();
  });
});
