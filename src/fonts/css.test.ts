import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings.js';
import { buildCss, resolveEmojiAlias } from './css.js';
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
  it('applies only Emoji without selecting a text role', () => {
    const css = buildCss({
      faces: [face({ family: 'Role Emoji A' })],
      roles: { ...DEFAULT_SETTINGS.roles, emoji: 'Role Emoji A' },
      hardOverride: false,
      resolve,
    });
    expect(css).toContain('html body > *');
    for (const role of ['interface', 'text', 'monospace']) expect(css).toContain(`--font-${role}:`);
    expect(css).not.toContain('!important');
  });
  it('omits Emoji composition when the selected family has no cached face', () => {
    const css = buildCss({
      faces: [face({ family: 'Role Baseline' })],
      roles: { ...DEFAULT_SETTINGS.roles, emoji: 'Role Emoji Missing' },
      hardOverride: true,
      resolve,
    });
    expect(css).not.toContain('__local-fonts-emoji__');
    expect(css).not.toContain('--local-fonts-base-');
    expect(css).not.toContain('Role Emoji Missing');
  });

  it('keeps a valid native fallback when a registered Emoji file later fails to load', () => {
    const css = buildCss({
      faces: [face({ family: 'Role Emoji Missing', path: '.fonts/no-such-file.woff2' })],
      roles: { ...DEFAULT_SETTINGS.roles, emoji: 'Role Emoji Missing' },
      hardOverride: false,
      resolve,
    });
    expect(css).toContain("font-family: '__local-fonts-emoji__'");
    expect(css).toContain(
      "--font-text: '__local-fonts-emoji__', var(--local-fonts-base-font-text);",
    );
    expect(css).toContain("src: url('app://local/vault/.fonts/no-such-file.woff2')");
  });
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

  describe('variable fonts', () => {
    const wght = (min: number, max: number, def = 400): FaceRecord['axes'] => [
      { tag: 'wght', min, default: def, max },
    ];

    it('declares the wght axis as a range, so the browser instantiates it instead of faking bold', () => {
      const css = buildCss({
        faces: [face({ weight: 400, axes: wght(100, 900) })],
        roles: DEFAULT_SETTINGS.roles,
        hardOverride: false,
        resolve,
      });

      expect(css).toContain('font-weight: 100 900;');
      expect(css).not.toContain('font-weight: 400;');
    });

    it('leaves a static face on its single weight', () => {
      const css = buildCss({
        faces: [face({ weight: 700, axes: [{ tag: 'opsz', min: 8, default: 14, max: 144 }] })],
        roles: DEFAULT_SETTINGS.roles,
        hardOverride: false,
        resolve,
      });

      expect(css).toContain('font-weight: 700;');
    });

    it('collapses a degenerate axis whose ends meet to the single weight it can produce', () => {
      const css = buildCss({
        faces: [face({ weight: 400, axes: wght(500, 500) })],
        roles: DEFAULT_SETTINGS.roles,
        hardOverride: false,
        resolve,
      });

      expect(css).toContain('font-weight: 500;');
    });

    // An out-of-range value makes the whole descriptor invalid, and a dropped
    // font-weight descriptor defaults to `normal` — so a malformed fvar would silently
    // cost the face the weight its OS/2 table does state. Clamping keeps the descriptor
    // valid and the range as wide as CSS allows.
    it('clamps a range that runs outside what CSS accepts, rather than emitting invalid CSS', () => {
      const css = buildCss({
        faces: [face({ weight: 400, axes: wght(0, 2000) })],
        roles: DEFAULT_SETTINGS.roles,
        hardOverride: false,
        resolve,
      });

      expect(css).toContain('font-weight: 1 1000;');
    });

    it('falls back to the parsed weight when the axis is nonsense', () => {
      const css = buildCss({
        faces: [face({ weight: 300, axes: wght(900, 100) })],
        roles: DEFAULT_SETTINGS.roles,
        hardOverride: false,
        resolve,
      });

      expect(css).toContain('font-weight: 300;');
    });

    it.each([
      ['a non-finite minimum', Number.NaN, 900],
      ['a non-finite maximum', 100, Number.NaN],
      ['an infinite maximum', 100, Number.POSITIVE_INFINITY],
    ])('falls back to the parsed weight when the axis carries %s', (_label, min, max) => {
      const css = buildCss({
        faces: [face({ weight: 300, axes: wght(min, max) })],
        roles: DEFAULT_SETTINGS.roles,
        hardOverride: false,
        resolve,
      });

      expect(css).toContain('font-weight: 300;');
      expect(css).not.toContain('NaN');
      expect(css).not.toContain('Infinity');
    });

    it('rounds a fixed-point bound instead of spelling out its binary error', () => {
      const css = buildCss({
        faces: [face({ weight: 400, axes: wght(99.99998474121094, 900.0000152587891) })],
        roles: DEFAULT_SETTINGS.roles,
        hardOverride: false,
        resolve,
      });

      expect(css).toContain('font-weight: 100 900;');
    });

    /**
     * A folder holding both `Inter[wght].woff2` and `Inter-Bold.woff2` gives one family
     * two faces that both answer for weight 700 — a range that contains it and a static
     * that states it. `selectFaces` keys on the face's own parsed weight, so it has no
     * reason to drop either, and both are declared.
     *
     * Which one the browser then uses is the browser's decision, and it is a good one.
     * Measured in Obsidian's renderer over two files with unmistakably different metrics
     * (a monospace file declared `100 900` against a proportional file declared `700`),
     * both declaration orders: at 700 the static won, at 500 the range won, identically
     * whichever was written first. An exact weight beats a range containing it, so the
     * static keeps the weight it was built for and the variable file supplies every
     * weight nothing else covers. There is nothing here for this code to arbitrate.
     */
    it('declares both a variable face and a static one that falls inside its range', () => {
      const css = buildCss({
        faces: [
          face({ path: '.fonts/probe/var.woff2', weight: 400, axes: wght(100, 900) }),
          face({ path: '.fonts/probe/bold.woff2', weight: 700 }),
        ],
        roles: DEFAULT_SETTINGS.roles,
        hardOverride: false,
        resolve,
      });

      expect(css).toContain('font-weight: 100 900;');
      expect(css).toContain('font-weight: 700;');
      expect(css.match(/@font-face/g)).toHaveLength(2);
    });
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
  });

  it('writes both the override and theme variable tiers with identical values, for every role that has an Obsidian font variable', () => {
    // -override is the tier Obsidian's own Appearance settings use, and it is what
    // wins inside Obsidian's `--font-X: var(--font-X-override, var(--font-X-theme,
    // ...))` chain, so it must stay. -theme is the tier community themes sometimes
    // read *directly*, bypassing that chain entirely; Obsidian's own default for
    // that tier is the literal placeholder string '??', a font family that does not
    // exist, so a theme reading it directly gets no font at all (including emoji)
    // unless we also write it. Both tiers must therefore carry the same value.
    // Asserted on the parsed CSSOM, not substrings, so a present-but-empty or
    // invalid declaration can't slip through the way the earlier heading bug did.
    const css = buildCss({
      faces: [face({})],
      roles: {
        ...DEFAULT_SETTINGS.roles,
        text: 'Probe Sans',
        interface: 'Probe Sans',
        monospace: 'Probe Sans',
      },
      hardOverride: false,
      resolve,
    });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    const styleRules = Array.from(sheet.cssRules).filter(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule,
    );
    const body = styleRules.find((rule) => rule.selectorText === 'html body');
    expect(body).toBeDefined();

    for (const role of ['text', 'interface', 'monospace']) {
      const overrideValue = body?.style.getPropertyValue(`--font-${role}-override`);
      const themeValue = body?.style.getPropertyValue(`--font-${role}-theme`);
      expect(overrideValue).toBeTruthy();
      expect(themeValue).toBeTruthy();
      expect(themeValue).toBe(overrideValue);
    }
  });

  // Measured in a real vault: Obsidian appends plugin stylesheets before the theme and
  // before every snippet, so with equal specificity theirs would win. The adopted
  // stylesheet this delivery replaced could not lose that way, being ordered after every
  // document stylesheet by definition. Two element names restore it — asserted as "beats
  // a bare `body` rule", not as a literal selector string, so the reason survives a
  // future change of how the extra specificity is spelled.
  it('scopes the role variables above a bare body rule, which a theme or snippet could set later', () => {
    const css = buildCss({
      faces: [face({})],
      roles: { ...DEFAULT_SETTINGS.roles, text: 'Probe Sans' },
      hardOverride: false,
      resolve,
    });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    const rule = Array.from(sheet.cssRules)
      .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule)
      .find((r) => r.style.getPropertyValue('--font-text-override') !== '');
    expect(rule).toBeDefined();

    // No class, id or attribute — those differ between the main window and a pop-out.
    expect(rule?.selectorText).not.toMatch(/[.#[]/);
    // ...but more than one element name, so it outranks `body { ... }`.
    expect(rule?.selectorText.trim().split(/\s+/).length).toBeGreaterThan(1);
  });

  it('never emits the Obsidian placeholder font family "??", which resolves to no font at all', () => {
    const css = buildCss({
      faces: [face({})],
      roles: {
        ...DEFAULT_SETTINGS.roles,
        text: 'Probe Sans',
        interface: 'Probe Sans',
        monospace: 'Probe Sans',
        headings: 'Probe Sans',
      },
      hardOverride: true,
      resolve,
    });

    expect(css).not.toContain('??');
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

    expect(css).toContain("--font-text-override: 'Probe Sans', sans-serif;");
    expect(css).toContain(
      "--font-text: '__local-fonts-emoji__', var(--local-fonts-base-font-text);",
    );
    expect(css).toContain('unicode-range:');
  });

  it('covers the zero width joiner, without which ZWJ sequences render as separate emoji', () => {
    const css = buildCss({
      faces: [face({ family: 'Probe Emoji' })],
      roles: { ...DEFAULT_SETTINGS.roles, emoji: 'Probe Emoji' },
      hardOverride: false,
      resolve,
    });

    expect(css).toMatch(/unicode-range:[^;]*U\+200D/);
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

  it('leaves independently styled icons outside hard role rules', () => {
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

    const hard = styleRules.filter(
      (rule) => rule.style.getPropertyPriority('font-family') === 'important',
    );
    expect(hard).toHaveLength(1);
    expect(hard[0]?.selectorText).toContain('.markdown-preview-view');
    expect(hard[0]?.selectorText).not.toContain('.svg-icon');
    expect(css).not.toContain('font-family: revert');
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

    // 3 @font-face + 2 body/child + 4 hard-override groups = 9 top-level
    // rules. If any block had a syntax error, the parser would drop that rule (or
    // everything after it in a pathological case) and this count would come up short.
    expect(sheet.cssRules).toHaveLength(9);
    const cssText: string = Array.from(sheet.cssRules, (rule: CSSRule) => rule.cssText).join('\n');
    expect(cssText).toContain('@font-face');
    expect(cssText).toContain('!important');
    expect(cssText).toContain("Bob's Emoji");
  });

  it('scopes the monospace hard override to code, not the whole Live Preview editor content area', () => {
    const css = buildCss({
      faces: [face({})],
      roles: { ...DEFAULT_SETTINGS.roles, monospace: 'Probe Sans' },
      hardOverride: true,
      resolve,
    });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    const styleRules = Array.from(sheet.cssRules).filter(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule,
    );
    const monospaceRule = styleRules.find((rule) =>
      rule.style.getPropertyValue('font-family').includes('monospace'),
    );
    expect(monospaceRule).toBeDefined();

    // `.cm-content` is the whole editor content area, not code — matching it forces
    // every paragraph, heading and list item in Live Preview to render monospace.
    expect(monospaceRule?.selectorText).not.toContain('.cm-content');
    expect(monospaceRule?.selectorText).not.toContain('.cm-editor');

    // Reading view uses bare `code`/`pre`; Live Preview marks inline code with
    // `.cm-inline-code` and fenced code-block lines with `.HyperMD-codeblock` on
    // `.cm-line` — those are the selectors that actually scope to code.
    expect(monospaceRule?.selectorText).toContain('code');
    expect(monospaceRule?.selectorText).toContain('pre');
    expect(monospaceRule?.selectorText).toContain('cm-inline-code');
    expect(monospaceRule?.selectorText).toContain('HyperMD-codeblock');
  });

  it('extends the heading hard-override rule to Live Preview classes and the note title, not just h1..h6', () => {
    const css = buildCss({
      faces: [face({})],
      roles: { ...DEFAULT_SETTINGS.roles, headings: 'Probe Sans' },
      hardOverride: true,
      resolve,
    });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    const styleRules = Array.from(sheet.cssRules).filter(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule,
    );
    const headingRule = styleRules.find((rule) =>
      rule.style.getPropertyValue('font-family').includes('Probe Sans'),
    );
    expect(headingRule).toBeDefined();

    const selectors = (headingRule?.selectorText ?? '').split(',').map((s) => s.trim());

    // Reading view: real heading elements.
    for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      expect(selectors).toContain(`.markdown-preview-view ${tag}`);
    }
    // Live Preview never renders headings as h1..h6 — it marks the `.cm-line` div
    // with `.HyperMD-header-N`, and the note title (which Obsidian treats as a
    // heading) is `.inline-title`. Verified against a running app's own app.css.
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(selectors).toContain(`.markdown-source-view .HyperMD-header-${n}`);
    }
    expect(selectors).toContain('.workspace-leaf-content[data-type="markdown"] .inline-title');
  });

  it('never emits a CSS-wide keyword as one item in a font-family list', () => {
    // `font-family: 'X', inherit` is invalid CSS — a CSS-wide keyword is only valid
    // as a property's *entire* value, never as one item in a comma-separated list.
    // Real browsers drop such a declaration entirely at parse time; jsdom's CSSOM
    // (used by this test suite) is too lenient to reject it, which is exactly why a
    // plain string-contains check on the stylesheet text previously missed this —
    // "inherit" was present in the source, just not validly. So this asserts
    // directly on every comma-separated item of every parsed font-family-shaped
    // declaration instead.
    const css = buildCss({
      faces: [face({})],
      roles: { ...DEFAULT_SETTINGS.roles, text: 'Probe Sans', headings: 'Probe Sans' },
      hardOverride: true,
      resolve,
    });

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    const styleRules = Array.from(sheet.cssRules).filter(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule,
    );

    const wideKeywords = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
    const propertiesToCheck = [
      'font-family',
      '--h1-font',
      '--h2-font',
      '--h3-font',
      '--h4-font',
      '--h5-font',
      '--h6-font',
    ];

    let checkedAtLeastOneList = false;
    for (const rule of styleRules) {
      for (const property of propertiesToCheck) {
        const value = rule.style.getPropertyValue(property);
        if (value === '') {
          continue;
        }
        const items = value.split(',').map((item) => item.trim().toLowerCase());
        if (items.length <= 1) {
          continue;
        }
        checkedAtLeastOneList = true;
        for (const item of items) {
          expect(wideKeywords.has(item)).toBe(false);
        }
      }
    }
    // Guards against the assertion above vacuously passing because no multi-item
    // list was ever found (e.g. if buildCss stopped emitting any stack at all).
    expect(checkedAtLeastOneList).toBe(true);
  });
});

describe('Emoji alias registration', () => {
  it('keeps the ordinary family unrestricted when used by Text and Emoji', () => {
    const css = buildCss({
      faces: [face({})],
      roles: { ...DEFAULT_SETTINGS.roles, text: 'Probe Sans', emoji: 'Probe Sans' },
      hardOverride: false,
      resolve,
    });
    const blocks = css.split('\n\n').filter((block) => block.startsWith('@font-face'));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("font-family: 'Probe Sans'");
    expect(blocks[0]).not.toContain('unicode-range');
    expect(blocks[1]).toContain("font-family: '__local-fonts-emoji__'");
    expect(blocks[1]).toContain('unicode-range:');
  });
  it('avoids mixed-case ordinary-family collisions without persisting an alias', () => {
    const faces = [
      face({}),
      face({ family: '__LOCAL-fonts-EMOJI__' }),
      face({ family: '__local-fonts-emoji__1' }),
    ];
    expect(resolveEmojiAlias(faces, 'Probe Sans')).toBe('__local-fonts-emoji__2');
    expect(resolveEmojiAlias(faces, null)).toBeNull();
    expect(resolveEmojiAlias(faces, 'Missing')).toBeNull();
  });
  it('resolves each hidden path once and preserves every alias weight and style', () => {
    const resolver = vi.fn((path: string) => `app://vault/${path}?n=${resolver.mock.calls.length}`);
    const faces = [
      face({ path: '.fonts/a.ttf', weight: 400 }),
      face({ path: '.fonts/b.ttf', weight: 700, italic: true }),
      face({ path: '.fonts/a.ttf', axes: [{ tag: 'wght', min: 100, max: 900, default: 400 }] }),
    ];
    const css = buildCss({
      faces,
      roles: { ...DEFAULT_SETTINGS.roles, emoji: 'Probe Sans' },
      hardOverride: false,
      resolve: resolver,
    });
    expect(resolver).toHaveBeenCalledTimes(2);
    const blocks = css.split('\n\n').filter((block) => block.startsWith('@font-face'));
    expect(blocks).toHaveLength(6);
    for (let i = 0; i < 3; i++)
      expect(
        blocks[i + 3]
          ?.replace("'__local-fonts-emoji__'", "'Probe Sans'")
          .replace(/\n {2}unicode-range:[^;]+;/, ''),
      ).toBe(blocks[i]);
    expect(blocks[4]).toContain('font-style: italic;');
    expect(blocks[5]).toContain('font-weight: 100 900;');
  });
});
