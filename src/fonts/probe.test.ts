import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectStack, loadLocalFont } from './probe.js';

afterEach(() => Reflect.deleteProperty(document, 'fonts'));

describe('loadLocalFont', () => {
  it('loads the named face with explicit ordinary text', async () => {
    const load = vi.fn().mockResolvedValue([{}]);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
    await expect(loadLocalFont(document, "Role 'Text'", 'ABCАБя0123')).resolves.toBe('loaded');
    expect(load).toHaveBeenCalledWith("64px 'Role \\'Text\\''", 'ABCАБя0123');
  });

  it('uses the supplied emoji sample', async () => {
    const load = vi.fn().mockResolvedValue([{}]);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
    await loadLocalFont(document, '__local-fonts-emoji__', '😀');
    expect(load).toHaveBeenCalledWith("64px '__local-fonts-emoji__'", '😀');
  });

  it('reports failure on rejection', async () => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: vi.fn().mockRejectedValue(new Error('bad')) },
    });
    await expect(loadLocalFont(document, 'Role Text', 'ABC')).resolves.toBe('failed');
  });

  it('reports unverified for no matching faces or no API', async () => {
    await expect(loadLocalFont(document, 'Role Text', 'ABC')).resolves.toBe('unverified');
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: vi.fn().mockResolvedValue([]) },
    });
    await expect(loadLocalFont(document, 'Role Text', 'ABC')).resolves.toBe('unverified');
  });
});

describe('inspectStack', () => {
  it('ignores the managed emoji alias for ordinary roles', () => {
    expect(
      inspectStack('"__local-fonts-emoji__", "Role Text", sans-serif', 'Role Text', [
        '__local-fonts-emoji__',
      ]),
    ).toBe('first');
    expect(inspectStack('"__local-fonts-emoji__", "Role Text"', '__local-fonts-emoji__')).toBe(
      'first',
    );
  });
  it('reports competing and absent families without guessing installation', () => {
    expect(inspectStack('"??", "Role Baseline", "Role Text"', 'Role Text')).toBe('preceded');
    expect(inspectStack('??, "Role Text"', 'Role Text')).toBe('first');
    expect(inspectStack('"Role Baseline", sans-serif', 'Role Text')).toBe('absent');
    expect(inspectStack('serif, "Role Text"', 'Role Text')).toBe('preceded');
    expect(inspectStack('"role text", sans-serif', 'Role Text')).toBe('first');
    expect(inspectStack('serif', 'serif')).toBe('absent');
    expect(inspectStack('"serif"', 'serif')).toBe('first');
  });
  it('does not assert an order for malformed input', () => {
    expect(inspectStack('"Role Text', 'Role Text')).toBe('absent');
    expect(inspectStack('"Role Text",', 'Role Text')).toBe('absent');
  });
});
