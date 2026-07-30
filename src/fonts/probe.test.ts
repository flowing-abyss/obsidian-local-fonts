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
  it('reports false when the family measures the same as a nonexistent one', async () => {
    // jsdom has no real font engine, so every family measures identically —
    // which is exactly the "font did not apply" signal.
    expect(await isFamilyApplied('Probe Sans', document)).toBe(false);
  });

  it('reports true when the family measures differently from the sentinel', async () => {
    const widths = [120, 80];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: widths.shift() ?? 0 }) as DOMRect,
    );

    expect(await isFamilyApplied('Probe Sans', document)).toBe(true);
  });

  it('treats a sub-epsilon difference as no divergence', async () => {
    const widths = [100.3, 100];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: widths.shift() ?? 0 }) as DOMRect,
    );

    expect(await isFamilyApplied('Probe Sans', document)).toBe(false);
  });

  it('treats a just-over-epsilon difference as real divergence', async () => {
    const widths = [100.6, 100];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: widths.shift() ?? 0 }) as DOMRect,
    );

    expect(await isFamilyApplied('Probe Sans', document)).toBe(true);
  });

  it('awaits document.fonts.load before measuring, so a not-yet-used face is not reported as absent', async () => {
    // font-display: swap means a face nothing on screen has used yet is not fetched,
    // so measuring it immediately would see only the fallback width — indistinguishable
    // from "not applying". Simulate that: the font "arrives" only once `fonts.load`
    // resolves, and the measurement must happen after that, not before.
    let loaded = false;
    const load = vi.fn().mockImplementation(async (spec: string) => {
      expect(spec).toContain('Probe Sans');
      await Promise.resolve();
      loaded = true;
      return [];
    });
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load },
    });

    try {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        // Only diverges from the sentinel once the (simulated) font has actually
        // loaded — if isFamilyApplied measured before awaiting `load`, this would see
        // `loaded === false` for the family measurement too, and the assertion below
        // would fail.
        const isSentinelOnly = !this.style.fontFamily.includes('Probe Sans');
        const width = isSentinelOnly || !loaded ? 100 : 140;
        return { width } as DOMRect;
      });

      const applied = await isFamilyApplied('Probe Sans', document);

      expect(load).toHaveBeenCalled();
      expect(applied).toBe(true);
    } finally {
      Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('measures anyway when document.fonts is unavailable (e.g. this test environment)', async () => {
    // jsdom itself has no FontFaceSet — this is the common case in the test suite,
    // not a hypothetical, so isFamilyApplied must degrade gracefully rather than throw.
    expect('fonts' in document).toBe(false);

    await expect(isFamilyApplied('Probe Sans', document)).resolves.toBe(false);
  });
});
