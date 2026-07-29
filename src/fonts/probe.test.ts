import { describe, expect, it, vi } from 'vitest';
import { isFamilyApplied, measureText } from './probe.js';

describe('measureText', () => {
  it('measures in a detached element so nothing flashes on screen', () => {
    const width = measureText('Probe Sans', document);

    expect(typeof width).toBe('number');
    expect(document.body.querySelector('.local-fonts-probe')).toBeNull();
  });

  it('wires the requested family into the probe font-family stack, sentinel as fallback', () => {
    let capturedFontFamily = '';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      capturedFontFamily = this.style.fontFamily;
      return { width: 0 } as DOMRect;
    });

    measureText('Probe Sans', document);

    // The private sentinel value probe.ts falls back to — duplicated here deliberately:
    // this test exists to catch exactly the case where the family is dropped from the
    // stack, or the two are reversed, which a probe measuring the sentinel alone could
    // not detect (every font would report as "not applied").
    const familyIndex = capturedFontFamily.indexOf('Probe Sans');
    const sentinelIndex = capturedFontFamily.indexOf('LocalFontsNoSuchFamily');

    expect(familyIndex).toBeGreaterThanOrEqual(0);
    expect(sentinelIndex).toBeGreaterThan(familyIndex);
  });

  it('removes the probe element even when measurement throws', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => measureText('Probe Sans', document)).toThrow('boom');
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

  it('treats a sub-epsilon difference as no divergence', () => {
    const widths = [100.3, 100];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: widths.shift() ?? 0 }) as DOMRect,
    );

    expect(isFamilyApplied('Probe Sans', document)).toBe(false);
  });

  it('treats a just-over-epsilon difference as real divergence', () => {
    const widths = [100.6, 100];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: widths.shift() ?? 0 }) as DOMRect,
    );

    expect(isFamilyApplied('Probe Sans', document)).toBe(true);
  });
});
