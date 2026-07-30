import { describe, expect, it } from 'vitest';
import {
  canRender,
  capabilitiesFor,
  detectEngine,
  OS_ENGINES,
  SUPPORTED_OSES,
} from './platform.js';

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const MACOS_ELECTRON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) obsidian/1.8.10 Chrome/126.0.6478.183 Electron/31.3.1 Safari/537.36';

describe('detectEngine', () => {
  it('treats iOS as WebKit even though its UA contains AppleWebKit like Chrome does', () => {
    expect(detectEngine(IOS_UA)).toBe('webkit');
  });

  it('detects Chromium on Android', () => {
    expect(detectEngine(ANDROID_UA)).toBe('chromium');
  });

  it('detects Chromium in desktop Electron, whose UA also says Safari', () => {
    expect(detectEngine(MACOS_ELECTRON_UA)).toBe('chromium');
  });

  it('falls back to chromium for an unrecognised UA, matching every desktop platform', () => {
    expect(detectEngine('something else entirely')).toBe('chromium');
  });

  it('detects WebKit on iPadOS, whose default UA carries no iPad token at all', () => {
    const IPADOS_DESKTOP_UA =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

    expect(detectEngine(IPADOS_DESKTOP_UA)).toBe('webkit');
  });

  it('checks Chromium before WebKit — the Electron UA contains AppleWebKit too', () => {
    // Guards the branch order: inverting the two checks makes this return 'webkit'.
    expect(MACOS_ELECTRON_UA).toContain('AppleWebKit/');
    expect(detectEngine(MACOS_ELECTRON_UA)).toBe('chromium');
  });
});

describe('capabilitiesFor', () => {
  it('excludes OT-SVG on Chromium, which has never shipped it', () => {
    expect(capabilitiesFor('chromium').has('SVG')).toBe(false);
  });

  it('includes OT-SVG on WebKit', () => {
    expect(capabilitiesFor('webkit').has('SVG')).toBe(true);
  });

  it('includes COLRv1 on Chromium', () => {
    expect(capabilitiesFor('chromium').has('COLR1')).toBe(true);
  });
});

describe('canRender', () => {
  it('accepts a plain font, which carries no colour tables at all', () => {
    expect(canRender('chromium', [])).toBe(true);
    expect(canRender('webkit', [])).toBe(true);
  });

  it('rejects an SVG-only font on Chromium', () => {
    expect(canRender('chromium', ['SVG'])).toBe(false);
  });

  it('accepts a font that also carries COLRv1 on Chromium', () => {
    expect(canRender('chromium', ['SVG', 'COLR1'])).toBe(true);
  });

  it('accepts an SVG-only font on WebKit', () => {
    expect(canRender('webkit', ['SVG'])).toBe(true);
  });
});

describe('OS_ENGINES', () => {
  it('maps macOS, Windows, Linux and Android to Chromium', () => {
    expect(OS_ENGINES.macos).toBe('chromium');
    expect(OS_ENGINES.windows).toBe('chromium');
    expect(OS_ENGINES.linux).toBe('chromium');
    expect(OS_ENGINES.android).toBe('chromium');
  });

  it('maps iOS to WebKit', () => {
    expect(OS_ENGINES.ios).toBe('webkit');
  });

  it('covers every OS in SUPPORTED_OSES, no more and no fewer', () => {
    expect(Object.keys(OS_ENGINES).sort((a, b) => a.localeCompare(b))).toStrictEqual(
      [...SUPPORTED_OSES].sort((a, b) => a.localeCompare(b)),
    );
  });
});
