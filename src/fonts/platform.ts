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
const CAPABILITIES: Record<Engine, ReadonlySet<ColorFormat>> = {
  chromium: new Set(['COLR0', 'COLR1', 'CBDT', 'sbix']),
  webkit: new Set(['COLR0', 'COLR1', 'CBDT', 'sbix', 'SVG']),
};

export function detectEngine(userAgent: string): Engine {
  // Chromium's UA also contains "AppleWebKit" and "Safari", so this branch MUST come
  // first — inverting these two returns 'webkit' for every desktop and Android install.
  if (/Chrome\/|Chromium\/|Electron\//.test(userAgent)) {
    return 'chromium';
  }
  // Catches iOS and iPadOS, including the desktop-site UA that iPadOS 13+ sends by
  // default, which carries no iPad token at all.
  if (/AppleWebKit\//.test(userAgent)) {
    return 'webkit';
  }
  return 'chromium';
}

export function capabilitiesFor(engine: Engine): ReadonlySet<ColorFormat> {
  return CAPABILITIES[engine];
}

/** Every OS the plugin ships to, in the order diagnostics should display them. */
export const SUPPORTED_OSES = ['macos', 'windows', 'linux', 'android', 'ios'] as const;

export type OS = (typeof SUPPORTED_OSES)[number];

/**
 * Which rendering engine each OS runs, for the diagnostics UI's per-OS support badges.
 * macOS, Windows, Linux and Android all run Chromium (Electron on desktop, the
 * Android WebView on mobile); iOS and iPadOS both run WebKit (WKWebView) — there is
 * no separate iPadOS entry because it shares iOS's engine and therefore its support
 * outcome. The single place to correct if a real device ever contradicts this.
 */
export const OS_ENGINES: Record<OS, Engine> = {
  macos: 'chromium',
  windows: 'chromium',
  linux: 'chromium',
  android: 'chromium',
  ios: 'webkit',
};

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
