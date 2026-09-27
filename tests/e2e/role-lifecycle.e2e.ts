import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import {
  applyRoles,
  closeRoleSuggestion,
  EMPTY_ROLES,
  measureSurface,
  openRoleNote,
  openRoleSettings,
  openRoleSuggestion,
  ROLE_FAMILIES,
  setNativeInlineFonts,
  setNativeTestCss,
  withRoleScenario,
} from './helpers/roles.js';

const ordinary = 'ABCАБя0123';
const emoji = '😀';

async function matches(selector: string, sample: string, family: string): Promise<void> {
  const result = await measureSurface(selector, sample, family);
  expect(Math.abs(result.width - result.referenceWidth)).toBeLessThanOrEqual(0.5);
}

describe('role assignment lifecycle', () => {
  it('moves every role A to B to null without changing independent consumers', async () => {
    // eslint-disable-next-line complexity -- Every transition checks the role and independent controls.
    await withRoleScenario('A B null', async () => {
      await openRoleNote('reading');
      await openRoleSuggestion();
      for (const role of ['text', 'interface', 'monospace', 'headings', 'emoji'] as const) {
        const familyA = ROLE_FAMILIES[role];
        if (familyA === null) throw new Error(`Missing fixture family for ${role}`);
        const familyB = role === 'emoji' ? 'Role Emoji B' : 'Role Baseline';
        for (const value of [familyA, familyB, null]) {
          await applyRoles({ ...EMPTY_ROLES, [role]: value }, false);
          await matches(
            '.markdown-preview-view p',
            ordinary,
            role === 'text' ? (value ?? 'Role Baseline') : 'Role Baseline',
          );
          await matches(
            '.markdown-preview-view p code',
            ordinary,
            role === 'monospace' ? (value ?? 'Role Baseline') : 'Role Baseline',
          );
          await matches(
            '.markdown-preview-view h3',
            ordinary,
            role === 'headings' || role === 'text' ? (value ?? 'Role Baseline') : 'Role Baseline',
          );
          await matches(
            '.suggestion-item',
            ordinary,
            role === 'interface' ? (value ?? 'Role Baseline') : 'Role Baseline',
          );
          if (role === 'emoji')
            await matches('.markdown-preview-view p', emoji, value ?? 'Role Baseline');
        }
      }
    });
  });

  it('preserves multiple ordinary assignments as an initially absent Emoji family is registered, selected, and cleared', async () => {
    await withRoleScenario('later Emoji', async () => {
      await openRoleNote('reading');
      const ordinaryRoles = {
        ...EMPTY_ROLES,
        text: 'Role Text',
        interface: 'Role Interface',
        monospace: 'Role Mono',
        headings: 'Role Headings',
      };
      await applyRoles({ ...ordinaryRoles, emoji: 'Role Emoji Later' }, false);
      await matches('.markdown-preview-view p', ordinary, 'Role Text');
      await matches('.markdown-preview-view p code', ordinary, 'Role Mono');
      await matches('.markdown-preview-view h3', ordinary, 'Role Headings');
      const before = await measureSurface('.markdown-preview-view p', emoji, 'Role Emoji A');
      expect(Math.abs(before.width - before.referenceWidth)).toBeGreaterThan(0.5);
      await browser.executeObsidian(({ app }) => {
        const plugin = (
          app.plugins as unknown as {
            plugins: Record<
              string,
              | {
                  settings: { cache: { faces: Array<{ family: string; path: string }> } };
                  applyFonts(): void;
                }
              | undefined
            >;
          }
        ).plugins['local-fonts'];
        if (plugin?.settings.cache === undefined) throw new Error('Missing role cache');
        const source = plugin.settings.cache.faces.find((face) => face.family === 'Role Emoji B');
        if (source === undefined) throw new Error('Missing Emoji B fixture');
        plugin.settings.cache.faces.push({ ...source, family: 'Role Emoji Later' });
        plugin.applyFonts();
      });
      await matches('.markdown-preview-view p', emoji, 'Role Emoji Later');
      await matches('.markdown-preview-view p', ordinary, 'Role Text');
      await applyRoles({ ...ordinaryRoles, emoji: null }, false);
      await matches('.markdown-preview-view p', ordinary, 'Role Text');
      await matches('.markdown-preview-view p code', ordinary, 'Role Mono');
      await applyRoles({ ...EMPTY_ROLES, emoji: 'Role Emoji Later' }, false);
      await matches('.markdown-preview-view p', ordinary, 'Role Baseline');
      await matches('.markdown-preview-view p', emoji, 'Role Emoji Later');
    });
  });

  it('keeps hard assignments within note and native UI boundaries', async () => {
    await withRoleScenario('hard boundaries', async () => {
      await openRoleNote('reading');
      await setNativeTestCss(
        "body { --font-text-theme:'Role Baseline'; --font-interface-theme:'Role Baseline'; --font-monospace-theme:'Role Baseline'; } .markdown-preview-view, .markdown-source-view, .suggestion-container { font-family:'Role Baseline'; } .role-test-icon { font-family:'Role Mono'; } .markdown-preview-view h2.role-explicit-note-heading { font-family:'Role Headings'; } .role-dialog-heading { font-family:'Role Baseline'; }",
      );
      await browser.executeObsidian((_, sample: string) => {
        const p = document.querySelector('.markdown-preview-view p');
        if (p === null) throw new Error('Missing role paragraph');
        const icon = p.createSpan({ cls: 'svg-icon role-test-icon' });
        icon.textContent = sample;
        const heading = document.querySelector('.markdown-preview-view h2');
        if (heading === null) throw new Error('Missing note heading');
        heading.classList.add('role-explicit-note-heading');
      }, ordinary);
      await matches(
        '.markdown-preview-view h2.role-explicit-note-heading',
        ordinary,
        'Role Headings',
      );
      await applyRoles({ ...EMPTY_ROLES, text: 'Role Text' }, true);
      await matches('.markdown-preview-view p', ordinary, 'Role Text');
      await matches('.markdown-preview-view p code', ordinary, 'Role Baseline');
      await matches(
        '.markdown-preview-view h2.role-explicit-note-heading',
        ordinary,
        'Role Headings',
      );
      await matches('.role-test-icon', ordinary, 'Role Mono');
      for (const hard of [false, true]) {
        await applyRoles({ ...EMPTY_ROLES, emoji: 'Role Emoji A' }, hard);
        await matches('.markdown-preview-view p', ordinary, 'Role Baseline');
        await matches('.role-test-icon', ordinary, 'Role Mono');
      }
      await openRoleSuggestion();
      await applyRoles({ ...EMPTY_ROLES, interface: 'Role Interface' }, true);
      await matches('.suggestion-item', ordinary, 'Role Interface');
      await closeRoleSuggestion();
      await openRoleSettings();
      await browser.executeObsidian(({ app }, sample: string) => {
        const setting = (
          app as unknown as {
            setting: {
              tabContentContainer?: HTMLElement;
              activeTab?: { containerEl: HTMLElement };
            };
          }
        ).setting;
        const root = setting.tabContentContainer ?? setting.activeTab?.containerEl;
        if (root === undefined) throw new Error('Missing settings content');
        const heading = root.createEl('h1', { cls: 'role-dialog-heading' });
        heading.textContent = sample;
        const sheet = new DOMParser()
          .parseFromString('<style data-role-dialog-font></style>', 'text/html')
          .querySelector('style');
        if (sheet === null) throw new Error('Could not create dialog font fixture');
        sheet.textContent = ".role-dialog-heading { font-family: 'Role Baseline'; }";
        root.ownerDocument.head.append(root.ownerDocument.adoptNode(sheet));
      }, ordinary);
      try {
        await applyRoles({ ...EMPTY_ROLES, headings: 'Role Headings' }, true);
        const heading = await measureSurface(
          '.role-dialog-heading',
          ordinary,
          'Role Baseline',
          'settings',
        );
        expect(Math.abs(heading.width - heading.referenceWidth)).toBeLessThanOrEqual(0.5);
        await matches('.markdown-preview-view h3', ordinary, 'Role Headings');
        await matches('.role-test-icon', ordinary, 'Role Mono');
      } finally {
        await browser.executeObsidian(({ app }) => {
          const setting = (
            app as unknown as {
              setting: {
                tabContentContainer?: HTMLElement;
                activeTab?: { containerEl: HTMLElement };
              };
            }
          ).setting;
          const root = setting.tabContentContainer ?? setting.activeTab?.containerEl;
          root?.ownerDocument.querySelector('style[data-role-dialog-font]')?.remove();
        });
      }
    });
  });

  it('resolves code inside headings independently for both Hard settings', async () => {
    await withRoleScenario('code within heading', async () => {
      await openRoleNote('reading');
      for (const hard of [false, true]) {
        for (const [headings, monospace] of [
          ['Role Headings', null],
          [null, 'Role Mono'],
          ['Role Headings', 'Role Mono'],
        ] as const) {
          await applyRoles({ ...EMPTY_ROLES, headings, monospace }, hard);
          await matches('.markdown-preview-view h3 code', ordinary, monospace ?? 'Role Baseline');
          await matches('.markdown-preview-view h3', 'Heading with', headings ?? 'Role Baseline');
        }
      }
      await setNativeInlineFonts({ '--font-text-override': "'Role Interface'" });
      await applyRoles({ ...EMPTY_ROLES, text: 'Role Text' }, true);
      await matches('.markdown-preview-view h3', 'Heading with', 'Role Text');
    });
  });

  it('uses one family for ordinary Text and Emoji without changing native face weights', async () => {
    await withRoleScenario('same family and weights', async () => {
      await openRoleNote('reading');
      for (const hard of [false, true]) {
        await applyRoles({ ...EMPTY_ROLES, text: 'Role Emoji A', emoji: 'Role Emoji A' }, hard);
        await matches('.markdown-preview-view p', ordinary, 'Role Emoji A');
        await matches('.markdown-preview-view p', emoji, 'Role Emoji A');
        const descriptors = await browser.executeObsidian(() => {
          const style = Array.from(document.head.querySelectorAll('style')).find(
            (el) =>
              el.textContent.includes('--local-fonts-sheet: 1') &&
              el.textContent.includes('__local-fonts-emoji__'),
          );
          if (style?.sheet === null || style === undefined)
            throw new Error('Missing generated role sheet');
          return Array.from(style.sheet.cssRules)
            .filter(
              (rule): rule is CSSFontFaceRule =>
                rule instanceof CSSFontFaceRule &&
                rule.style.getPropertyValue('font-family').replace(/["']/g, '') === 'Probe Sans',
            )
            .map((rule) => ({
              weight: rule.style.getPropertyValue('font-weight'),
              style: rule.style.getPropertyValue('font-style'),
            }));
        });
        expect(descriptors).toContainEqual({ weight: '400', style: 'normal' });
        expect(descriptors).toContainEqual({ weight: '700', style: 'italic' });
      }
    });
  });
});
