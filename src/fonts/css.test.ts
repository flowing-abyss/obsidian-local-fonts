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

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    // Only CSSStyleRule (not the @font-face rule also present) has `selectorText`.
    const styleRules = Array.from(sheet.cssRules).filter(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule,
    );

    // The container rule (`body { font-family: ... !important }`) must carry no
    // `:not(.svg-icon)` compound: a compound `:not()` on the container itself never
    // excludes anything (`body` is never `.svg-icon`), so keeping it would look like
    // protection while doing nothing — worse than no exclusion at all.
    const container = styleRules.find((rule) => rule.selectorText === 'body');
    expect(container).toBeDefined();
    expect(container?.selectorText).not.toContain(':not(.svg-icon)');

    // What actually protects icons is a dedicated reset rule that runs last in source
    // order and hands `font-family` back to whatever the icon's own rule declares.
    const reset = styleRules.find((rule) => rule.selectorText.includes('.svg-icon'));
    expect(reset).toBeDefined();
    expect(reset?.style.getPropertyValue('font-family')).toBe('revert');
    expect(reset?.style.getPropertyPriority('font-family')).toBe('important');
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

  it('escapes a family name containing both a backslash and a quote, so a broken escape order cannot corrupt the sheet', () => {
    // Order matters here in a way a string-matching test cannot catch: escaping the
    // quote *before* the backslash (the wrong order) doubles the very backslash that
    // guards the escaped quote, which un-escapes it and closes the CSS string early —
    // a real syntax break, not just a cosmetic difference. Escaping backslash first
    // (the correct order) leaves the quote's escape intact. Assert on the parsed
    // CSSOM rule count: a broken escape here corrupts the source enough that the rule
    // fails to parse, rather than merely rendering a different string.
    const family = String.raw`Ba\ck's Font`;
    const css = buildCss({
      faces: [face({ family })],
      roles: DEFAULT_SETTINGS.roles,
      hardOverride: false,
      resolve,
    });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);

    expect(sheet.cssRules).toHaveLength(1);
    expect(sheet.cssRules[0]?.cssText).toContain('@font-face');
  });

  it('does not duplicate the emoji family in the stack when a role is assigned the same family as emoji', () => {
    const css = buildCss({
      faces: [face({})],
      roles: { ...DEFAULT_SETTINGS.roles, text: 'Probe Sans', emoji: 'Probe Sans' },
      hardOverride: false,
      resolve,
    });

    expect(css).toMatch(/--font-text-override:\s*'Probe Sans',\s*sans-serif;/);
    expect(css).not.toMatch(/'Probe Sans',\s*'Probe Sans'/);
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

    // 2 @font-face + 1 body + 4 hard-override groups + 1 icon reset = 8 top-level
    // rules. If any block had a syntax error, the parser would drop that rule (or
    // everything after it in a pathological case) and this count would come up short.
    expect(sheet.cssRules).toHaveLength(8);
    const cssText: string = Array.from(sheet.cssRules, (rule: CSSRule) => rule.cssText).join('\n');
    expect(cssText).toContain('@font-face');
    expect(cssText).toContain('!important');
    expect(cssText).toContain("Bob's Emoji");
  });
});
