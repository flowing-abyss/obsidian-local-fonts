import { describe, expect, it } from 'vitest';
import { CACHE_VERSION } from './types.js';

describe('CACHE_VERSION', () => {
  it('starts at 1', () => {
    expect(CACHE_VERSION).toBe(1);
  });
});
