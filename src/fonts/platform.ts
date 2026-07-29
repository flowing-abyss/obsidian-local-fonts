import type { ColorFormat } from './types.js';

/** The two rendering engines Obsidian runs on. Everything desktop is Chromium via Electron. */
export type Engine = 'chromium' | 'webkit';

/**
 * Which colour-glyph formats each engine can actually draw.
 *
 * These values are load-bearing: selection rule 1 rejects a face the engine cannot render,
 * and without correct values it silently picks an unrenderable file. Verified claims:
 * Chromium has never shipped OT-SVG; WebKit has supported it for years. WebKit's COLRv1
 * support arrived late and may be version-dependent on older iOS — treated as supported
 * here, and correctable in this one place if a device says otherwise.
 */
const MATRIX: Record<Engine, readonly ColorFormat[]> = {
  chromium: ['COLR0', 'COLR1', 'CBDT', 'sbix'],
  webkit: ['COLR0', 'COLR1', 'CBDT', 'sbix', 'SVG'],
};

const CAPABILITIES: Record<Engine, ReadonlySet<ColorFormat>> = {
  chromium: new Set(MATRIX.chromium),
  webkit: new Set(MATRIX.webkit),
};

/**
 * Chromium's UA also contains "AppleWebKit" and "Safari", so those cannot be the test.
 * Anything that announces Chrome/Chromium/Electron is Chromium; iOS is the WebKit case.
 * Unknown UAs fall back to Chromium, which is every desktop platform.
 */
export function detectEngine(userAgent: string): Engine {
  if (/Chrome\/|Chromium\/|Electron\//.test(userAgent)) {
    return 'chromium';
  }
  if (/iPhone|iPad|iPod/.test(userAgent)) {
    return 'webkit';
  }
  return 'chromium';
}

export function capabilitiesFor(engine: Engine): ReadonlySet<ColorFormat> {
  return CAPABILITIES[engine];
}

/**
 * A font with no colour tables renders everywhere. A colour font renders only if the
 * engine supports at least one of the formats it carries.
 */
export function canRender(engine: Engine, formats: readonly ColorFormat[]): boolean {
  if (formats.length === 0) {
    return true;
  }
  const caps = capabilitiesFor(engine);
  return formats.some((format) => caps.has(format));
}
