import { describe, expect, it, vi } from 'vitest';
import { isFamilyApplied, measureText } from './probe.js';

describe('measureText', () => {
  it('measures in a detached element so nothing flashes on screen', () => {
    const width = measureText('Probe Sans', document);

    expect(typeof width).toBe('number');
    expect(document.body.querySelector('.local-fonts-probe')).toBeNull();
  });
});

describe('isFamilyApplied', () => {
  it('reports false when the family measures the same as a nonexistent one', () => {
    // jsdom has no real font engine, so every family measures identically —
    // which is exactly the "font did not apply" signal.
    expect(isFamilyApplied('Probe Sans', document)).toBe(false);
  });

  it('reports true when the family measures differently from the sentinel', () => {
    const widths = [120, 80];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: widths.shift() ?? 0 }) as DOMRect,
    );

    expect(isFamilyApplied('Probe Sans', document)).toBe(true);
  });
});
