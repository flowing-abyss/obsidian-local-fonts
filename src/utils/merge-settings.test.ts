import { describe, expect, it } from 'vitest';
import { mergeSettings } from './merge-settings.js';

interface ExampleSettings {
  enabled: boolean;
  label: string;
}

const defaults: ExampleSettings = { enabled: true, label: 'default' };

describe('mergeSettings', () => {
  it('returns the defaults when nothing was saved', () => {
    expect(mergeSettings(defaults, undefined)).toStrictEqual(defaults);
  });

  it('returns the defaults when saved data is null', () => {
    expect(mergeSettings(defaults, null)).toStrictEqual(defaults);
  });

  it('overrides only the keys present in the saved data', () => {
    expect(mergeSettings(defaults, { enabled: false })).toStrictEqual({
      enabled: false,
      label: 'default',
    });
  });

  it('does not mutate the defaults object', () => {
    mergeSettings(defaults, { label: 'custom' });
    expect(defaults).toStrictEqual({ enabled: true, label: 'default' });
  });
});
