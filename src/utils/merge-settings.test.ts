import { describe, expect, it } from 'vitest';
import type { FontCache } from '../fonts/types.js';
import type { PluginSettings } from '../settings.js';
import { DEFAULT_SETTINGS } from '../settings.js';
import { mergeSettings } from './merge-settings.js';

describe('mergeSettings', () => {
  it('returns the defaults when nothing was saved', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, undefined)).toStrictEqual(DEFAULT_SETTINGS);
  });

  it('returns the defaults when saved data is null', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, null)).toStrictEqual(DEFAULT_SETTINGS);
  });

  it('overrides only the top-level keys present in the saved data', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { folder: 'custom-folder' })).toStrictEqual({
      ...DEFAULT_SETTINGS,
      folder: 'custom-folder',
    });
  });

  it('does not mutate the defaults object', () => {
    mergeSettings(DEFAULT_SETTINGS, { folder: 'custom-folder' });
    expect(DEFAULT_SETTINGS.folder).toBe('.fonts');
  });

  it('layers saved role assignments on top of role defaults instead of replacing them wholesale', () => {
    // Simulates an older data.json saved before a new role was added to RoleName: it
    // only has some of the current roles. The result must still carry defaults
    // (null) for whichever roles are missing from the saved data, not lose them.
    const saved: Partial<PluginSettings> = {
      roles: { text: 'Inter' } as PluginSettings['roles'],
    };

    const result = mergeSettings(DEFAULT_SETTINGS, saved);

    expect(result.roles).toStrictEqual({
      ...DEFAULT_SETTINGS.roles,
      text: 'Inter',
    });
  });

  it('replaces cache wholesale rather than merging it, since a FontCache is written atomically', () => {
    const staleCache: FontCache = {
      folder: '.fonts',
      mtimeMs: 1,
      families: [],
    } as unknown as FontCache;

    const result = mergeSettings({ ...DEFAULT_SETTINGS, cache: staleCache }, { cache: null });

    expect(result.cache).toBeNull();
  });
});
