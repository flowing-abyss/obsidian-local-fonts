import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings.js';

describe('DEFAULT_SETTINGS', () => {
  it('starts the plugin enabled', () => {
    expect(DEFAULT_SETTINGS).toStrictEqual({ enabled: true });
  });
});
