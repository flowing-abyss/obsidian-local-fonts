import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings.js';
import { buildCss } from './css.js';
import type { FaceRecord } from './types.js';

function face(overrides: Partial<FaceRecord>): FaceRecord {
  return {
    path: '.fonts/probe-sans/probe-sans-400.woff2',
    format: 'woff2',
    size: 1000,
    mtime: 1,
    family: 'Probe Sans',
    weight: 400,
    italic: false,
    colorFormats: [],
    scripts: [],
    axes: [],
    license: null,
    source: 'name-table',
    ...overrides,
  };
}

const resolve = (path: string): string => `app://local/vault/${path}`;

describe('buildCss', () => {
  it('emits a @font-face per selected file, using a resource URL rather than base64', () => {
    const css = buildCss({
      faces: [face({})],
      roles: DEFAULT_SETTINGS.roles,
      hardOverride: false,
      resolve,
    });

    expect(css).toContain('@font-face');
    expect(css).toContain("src: url('app://local/vault/.fonts/probe-sans/probe-sans-400.woff2')");
    expect(css).toContain("format('woff2')");
    expect(css).not.toContain('base64');
  });

  it('declares weight and style so the browser can pick the right file', () => {
    const css = buildCss({
      faces: [face({ weight: 700, italic: true })],
      roles: DEFAULT_SETTINGS.roles,
      hardOverride: false,
      resolve,
    });

    expect(css).toContain('font-weight: 700;');
    expect(css).toContain('font-style: italic;');
  });

  it('sets font-display: swap so text is never invisible while a font loads', () => {
    const css = buildCss({
      faces: [face({})],
      roles: DEFAULT_SETTINGS.roles,
      hardOverride: false,
      resolve,
    });

    expect(css).toContain('font-display: swap;');
  });

  it('writes the override tier, which is the tier Appearance settings use', () => {
    const css = buildCss({
      faces: [face({})],
      roles: { ...DEFAULT_SETTINGS.roles, text: 'Probe Sans' },
      hardOverride: false,
      resolve,
    });

    expect(css).toContain('--font-text-override');
    expect(css).not.toContain('--font-text-theme');
  });

  it('assigns headings to the h1..h6 variables', () => {
    const css = buildCss({
      faces: [face({})],
      roles: { ...DEFAULT_SETTINGS.roles, headings: 'Probe Sans' },
      hardOverride: false,
      resolve,
    });

    expect(css).toContain('--h1-font');
    expect(css).toContain('--h6-font');
  });

  it('puts the emoji family first with a unicode-range, so system emoji cannot win', () => {
    const css = buildCss({
      faces: [face({ family: 'Probe Emoji' })],
      roles: { ...DEFAULT_SETTINGS.roles, text: 'Probe Sans', emoji: 'Probe Emoji' },
      hardOverride: false,
      resolve,
    });

    expect(css).toMatch(/--font-text-override:\s*'Probe Emoji',\s*'Probe Sans'/);
    expect(css).toContain('unicode-range:');
  });

  it('emits no !important rules unless hard override is on', () => {
    const css = buildCss({
      faces: [face({})],
      roles: { ...DEFAULT_SETTINGS.roles, text: 'Probe Sans' },
      hardOverride: false,
      resolve,
    });

    expect(css).not.toContain('!important');
  });

  it('emits !important rules when hard override is on', () => {
    const css = buildCss({
      faces: [face({})],
      roles: { ...DEFAULT_SETTINGS.roles, text: 'Probe Sans' },
      hardOverride: true,
      resolve,
    });

    expect(css).toContain('!important');
  });

  it('never applies hard override to icon elements, which would replace the icon font', () => {
    const css = buildCss({
      faces: [face({})],
      roles: { ...DEFAULT_SETTINGS.roles, text: 'Probe Sans' },
      hardOverride: true,
      resolve,
    });

    expect(css).toContain(':not(.svg-icon)');
  });

  it('escapes a family name containing a quote, so one bad font cannot break the sheet', () => {
    const css = buildCss({
      faces: [face({ family: "Bob's Font" })],
      roles: DEFAULT_SETTINGS.roles,
      hardOverride: false,
      resolve,
    });

    expect(css).toContain("Bob\\'s Font");
  });

  it('produces no rules at all when no role is assigned', () => {
    const css = buildCss({
      faces: [],
      roles: DEFAULT_SETTINGS.roles,
      hardOverride: false,
      resolve,
    });

    expect(css.trim()).toBe('');
  });

  it('emits no hard-override block when hard override is on but no role is assigned', () => {
    const css = buildCss({
      faces: [],
      roles: DEFAULT_SETTINGS.roles,
      hardOverride: true,
      resolve,
    });

    expect(css.trim()).toBe('');
  });

  it('produces a stylesheet that parses without dropping rules, including hard overrides and an escaped family', () => {
    const faces = [
      face({}),
      face({
        path: '.fonts/probe-emoji/probe-emoji-400.woff2',
        family: "Bob's Emoji",
      }),
    ];
    const css = buildCss({
      faces,
      roles: {
        ...DEFAULT_SETTINGS.roles,
        text: 'Probe Sans',
        interface: 'Probe Sans',
        monospace: 'Probe Sans',
        headings: 'Probe Sans',
        emoji: "Bob's Emoji",
      },
      hardOverride: true,
      resolve,
    });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);

    // 2 @font-face + 1 body + 4 hard-override groups = 7 top-level rules. If any block
    // had a syntax error, the parser would drop that rule (or everything after it in a
    // pathological case) and this count would come up short.
    expect(sheet.cssRules).toHaveLength(7);
    const cssText: string = Array.from(sheet.cssRules, (rule: CSSRule) => rule.cssText).join('\n');
    expect(cssText).toContain('@font-face');
    expect(cssText).toContain('!important');
    expect(cssText).toContain("Bob's Emoji");
  });
});
