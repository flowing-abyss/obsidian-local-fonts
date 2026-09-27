import { describe, expect, it } from 'vitest';
import type { RoleAssignments } from '../settings.js';
import { DEFAULT_SETTINGS } from '../settings.js';
import { buildCss } from './css.js';
import { buildRoleCss } from './roles.js';
import type { FaceRecord } from './types.js';

const keys = ['text', 'interface', 'monospace', 'headings', 'emoji'] as const;
const faces: FaceRecord[] = keys.map((key) => ({
  path: `.fonts/${key}.ttf`,
  format: 'ttf',
  size: 1,
  mtime: 1,
  family: `Fixture ${key}`,
  weight: 400,
  italic: false,
  colorFormats: [],
  scripts: [],
  axes: [],
  license: null,
  source: 'name-table',
}));
describe('independent role ownership', () => {
  for (let mask = 0; mask < 32; mask++)
    for (const hardOverride of [false, true]) {
      // eslint-disable-next-line complexity -- Exhaustive role ownership assertions share one mask.
      it(`owns only selected roles: mask ${mask}, hard ${hardOverride}`, () => {
        const roles = Object.fromEntries(
          keys.map((key, index) => [key, (mask & (1 << index)) !== 0 ? `Fixture ${key}` : null]),
        ) as unknown as RoleAssignments;
        const input = {
          faces,
          roles,
          hardOverride,
          resolve: (path: string) => `app://vault/${path}`,
        };
        const css = buildCss(input);
        const rules = css.split('\n\n').filter((block) => !block.startsWith('@font-face'));
        const body = rules.filter((block) => block.startsWith('html body {')).join('\n');
        const child = rules.filter((block) => block.startsWith('html body > * {')).join('\n');
        for (const role of ['text', 'interface', 'monospace'] as const)
          for (const tier of ['override', 'theme']) {
            expect(body.includes(`  --font-${role}-${tier}:`)).toBe(roles[role] !== null);
            if (roles[role] !== null)
              expect(body).toContain(
                `--font-${role}-${tier}: 'Fixture ${role}', ${role === 'monospace' ? 'monospace' : 'sans-serif'};`,
              );
          }
        for (const level of [1, 2, 3, 4, 5, 6])
          expect(body.includes(`  --h${level}-font:`)).toBe(roles.headings !== null);
        expect(child.includes('--font-interface:')).toBe(roles.emoji !== null);
        for (const line of child.split('\n').filter((line) => line.trim().startsWith('--')))
          expect(line).toMatch(/: '__local-fonts-emoji__', var\(--local-fonts-base-[a-z0-9-]+\);$/);
        expect(css).not.toMatch(/,\s*(?:inherit|initial|unset)\s*;/);
        expect(css).not.toMatch(/,\s*,/);
        for (const line of css.split('\n')) {
          const property = line.trim().split(':')[0];
          if (property?.startsWith('--') === true) expect(line).not.toContain(`var(${property})`);
        }
        expect(buildCss(input)).toBe(css);
        if (mask === 0) expect(rules).toEqual([]);
      });
    }
  it('does not compose an absent Emoji face or invent an ordinary assignment', () => {
    const roles = {
      text: 'Fixture text',
      interface: 'Fixture interface',
      monospace: 'Fixture monospace',
      headings: 'Fixture headings',
      emoji: 'Missing',
    };
    const css = buildCss({ faces, roles, hardOverride: true, resolve: (path) => path });
    expect(css).not.toContain('--local-fonts-base-');
    expect(css).not.toContain("'Missing'");
    expect(buildRoleCss({ roles, hardOverride: false, emojiAlias: null })).toContain(
      "--font-text-override: 'Fixture text', sans-serif;",
    );
  });
});

it('captures every native tier and derivative on the ancestor with no invented fallback', () => {
  const css = buildRoleCss({
    roles: { text: null, interface: null, monospace: null, headings: null, emoji: 'Fixture emoji' },
    hardOverride: true,
    emojiAlias: 'private emoji',
  });
  const properties = [
    '--font-text',
    '--font-text-override',
    '--font-text-theme',
    '--font-interface',
    '--font-interface-override',
    '--font-interface-theme',
    '--font-monospace',
    '--font-monospace-override',
    '--font-monospace-theme',
    '--h1-font',
    '--h2-font',
    '--h3-font',
    '--h4-font',
    '--h5-font',
    '--h6-font',
    '--inline-title-font',
    '--table-header-font',
    '--file-header-font',
    '--metadata-label-font',
    '--metadata-input-font',
  ];
  const [body, child] = css.split('\n\n');
  for (const property of properties) {
    const baseline = `--local-fonts-base-${property.slice(2)}`;
    expect(body).toContain(`${baseline}: var(${property});`);
    expect(child).toContain(`${property}: 'private emoji', var(${baseline});`);
  }
  expect(child?.split('\n').filter((line) => line.trim().startsWith('--'))).toHaveLength(20);
  expect(css).not.toContain('!important');
});

describe('hard role boundaries', () => {
  it('does not reset independently styled icons', () => {
    const css = buildRoleCss({
      roles: { ...DEFAULT_SETTINGS.roles, text: 'Role Text' },
      hardOverride: true,
      emojiAlias: null,
    });
    expect(css).not.toContain('.svg-icon');
    expect(css).not.toContain('font-family: revert');
  });

  it('limits heading rules to note headings and the markdown title', () => {
    const css = buildRoleCss({
      roles: { ...DEFAULT_SETTINGS.roles, headings: 'Role Headings' },
      hardOverride: true,
      emojiAlias: null,
    });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    const hard = Array.from(sheet.cssRules).filter(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule &&
        rule.style.getPropertyPriority('font-family') === 'important',
    );
    expect(hard).toHaveLength(1);
    const headingRule = hard[0];
    if (headingRule === undefined) throw new Error('Missing hard heading rule');
    const selectors = headingRule.selectorText.split(',').map((selector) => selector.trim());
    expect(selectors).toContain('.markdown-preview-view h1');
    expect(selectors).toContain('.markdown-source-view .HyperMD-header-1');
    expect(selectors).toContain('.workspace-leaf-content[data-type="markdown"] .inline-title');
    expect(selectors).not.toContain('h1');
    expect(selectors).not.toContain('.inline-title');
  });
});
