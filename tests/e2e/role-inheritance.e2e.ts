import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import {
  applyRoles,
  EMPTY_ROLES,
  measureSurface,
  openRoleNote,
  openRoleSuggestion,
  setNativeInlineFonts,
  setNativeTestCss,
  withRoleScenario,
} from './helpers/roles.js';

const ordinary = 'ABCАБя0123';
const paragraph = '.markdown-preview-view p';
async function matches(selector: string, family: string, sample = ordinary): Promise<void> {
  await browser.waitUntil(
    async () => {
      const result = await measureSurface(selector, sample, family);
      return Math.abs(result.width - result.referenceWidth) <= 0.5;
    },
    { timeout: 5000, timeoutMsg: `${selector}: expected ${family} for ${sample}` },
  );
}
async function pluginText(): Promise<string> {
  return browser.executeObsidian(
    () =>
      Array.from(document.head.querySelectorAll('style')).find((style) =>
        style.textContent.includes('--local-fonts-sheet: 1'),
      )?.textContent ?? '',
  );
}

describe('native role inheritance and live changes', () => {
  it('decorates independent Appearance and direct-theme readers, including Hard Text inheritance', async () => {
    await withRoleScenario('Appearance and theme readers', async () => {
      await openRoleNote('reading');
      await browser.executeObsidian((_, sample: string) => {
        const root = document.querySelector('.markdown-preview-view');
        if (root === null) throw new Error('Missing reading view');
        root.createDiv({ cls: 'role-theme-reader', text: sample });
      }, `${ordinary} 😀`);
      await setNativeTestCss(
        "body {--font-text-theme:'Role Mono';--font-interface-theme:'Role Baseline';--h2-font:'Role Headings';} .role-theme-reader {font-family:var(--font-text-theme);}",
      );
      await setNativeInlineFonts({ '--font-text-override': '"Role Baseline"' });
      await applyRoles({ ...EMPTY_ROLES, emoji: 'Role Emoji A' }, false);
      await matches(paragraph, 'Role Baseline');
      await matches('.role-theme-reader', 'Role Mono');
      await matches('.role-theme-reader', 'Role Emoji A', '😀');
      await applyRoles({ ...EMPTY_ROLES, text: 'Role Text', emoji: 'Role Emoji A' }, false);
      await matches(paragraph, 'Role Baseline');
      await matches(paragraph, 'Role Emoji A', '😀');
      await matches('.role-theme-reader', 'Role Text');
      await applyRoles({ ...EMPTY_ROLES, text: 'Role Text', emoji: 'Role Emoji A' }, true);
      await matches(paragraph, 'Role Text');
      await matches('.markdown-preview-view h1', 'Role Text');
      await matches('.markdown-preview-view h2', 'Role Headings');
    });
  });

  it('preserves the app native Text-to-Interface fallback while explicit Text stays independent', async () => {
    await withRoleScenario('native interface dependency', async () => {
      await openRoleNote('reading');
      await setNativeInlineFonts({
        '--font-text-override': "'??'",
        '--font-text-theme': "'??'",
        '--font-interface-override': "'Role Interface'",
      });
      const native = await measureSurface(paragraph, ordinary, 'Role Interface');
      const floor = await browser.executeObsidian(
        ({ obsidian }) => !obsidian.requireApiVersion('1.1.0'),
      );
      if (floor) expect(Math.abs(native.width - native.referenceWidth)).toBeLessThanOrEqual(0.5);
      await setNativeInlineFonts({ '--font-interface-override': null });
      await applyRoles(
        { ...EMPTY_ROLES, interface: 'Role Interface', emoji: 'Role Emoji A' },
        false,
      );
      const assigned = await measureSurface(paragraph, ordinary, 'Role Interface');
      expect(Math.abs(assigned.width - native.width)).toBeLessThanOrEqual(0.5);
      await matches(paragraph, 'Role Emoji A', '😀');
      await setNativeInlineFonts({ '--font-text-override': null, '--font-text-theme': null });
      await applyRoles(
        { ...EMPTY_ROLES, text: 'Role Text', interface: 'Role Interface', emoji: 'Role Emoji A' },
        false,
      );
      await matches(paragraph, 'Role Text');
    });
  });

  it('follows theme specificity, theme class, snippets and Appearance without regenerating plugin CSS', async () => {
    await withRoleScenario('live native mutations', async () => {
      await openRoleNote('reading');
      await openRoleSuggestion();
      await applyRoles({ ...EMPTY_ROLES, emoji: 'Role Emoji A' }, false);
      const before = await pluginText();
      await matches(paragraph, 'Role Baseline');
      await matches('.suggestion-item', 'Role Baseline');
      await setNativeTestCss(
        "body {--font-text-theme:'Role Text';--font-interface-theme:'Role Interface';}",
      );
      await matches(paragraph, 'Role Text');
      await matches('.suggestion-item', 'Role Interface');
      await setNativeTestCss(
        "body {--font-text-theme:'Role Mono';} body.theme-dark {--font-text-theme:'Role Text';--font-interface-theme:'Role Interface';} body.theme-light {--font-text-theme:'Role Baseline';--font-interface-theme:'Role Baseline';}",
      );
      for (const [theme, family] of [
        ['theme-dark', 'Role Text'],
        ['theme-light', 'Role Baseline'],
      ] as const) {
        await browser.executeObsidian((_, cls: string) => {
          document.body.classList.remove('theme-light', 'theme-dark');
          document.body.classList.add(cls);
        }, theme);
        await matches(paragraph, family);
        await matches(
          '.suggestion-item',
          theme === 'theme-dark' ? 'Role Interface' : 'Role Baseline',
        );
        await matches('.suggestion-item', 'Role Emoji A', '😀');
        await matches(paragraph, 'Role Emoji A', '😀');
      }
      await browser.executeObsidian(() => {
        const sheet = new DOMParser()
          .parseFromString('<style></style>', 'text/html')
          .querySelector('style');
        if (sheet === null) throw new Error('Cannot create snippet fixture');
        sheet.dataset['roleSnippet'] = 'true';
        sheet.textContent = "body.theme-light {--font-text-theme:'Role Headings';}";
        document.head.append(sheet);
      });
      try {
        await matches(paragraph, 'Role Headings');
      } finally {
        await browser.executeObsidian(() => {
          document.querySelector('style[data-role-snippet]')?.remove();
        });
      }
      await matches(paragraph, 'Role Baseline');
      await setNativeInlineFonts({
        '--font-text-override': "'Role Mono'",
        '--font-interface-override': "'Role Headings'",
      });
      await matches(paragraph, 'Role Mono');
      await matches('.suggestion-item', 'Role Headings');
      await setNativeInlineFonts({
        '--font-text-override': null,
        '--font-interface-override': null,
      });
      await matches('.suggestion-item', 'Role Baseline');
      await matches(paragraph, 'Role Baseline');
      expect(await pluginText()).toBe(before);
    });
  });

  it('preserves six distinct native heading values then resumes inherited Text live', async () => {
    await withRoleScenario('six native heading values', async () => {
      await openRoleNote('reading');
      await applyRoles({ ...EMPTY_ROLES, emoji: 'Role Emoji A' }, false);
      const before = await pluginText();
      const families = [
        'Role Text',
        'Role Interface',
        'Role Mono',
        'Role Headings',
        'Role Emoji A',
        'Role Baseline',
      ];
      const headings = families
        .map((family, index) => `--h${index + 1}-font:'${family}';`)
        .join('');
      await setNativeTestCss(`body {--font-text-theme:'Role Baseline';${headings}}`);
      for (const [index, family] of families.entries()) {
        await matches(`.markdown-preview-view h${index + 1}`, family);
        await matches(`.markdown-preview-view h${index + 1}`, 'Role Emoji A', '😀');
      }
      await setNativeTestCss("body {--font-text-theme:'Role Text';}");
      for (let level = 1; level <= 6; level++)
        await matches(`.markdown-preview-view h${level}`, 'Role Text');
      expect(await pluginText()).toBe(before);
    });
  });

  it('keeps a shared Appearance and Emoji family unrestricted for ordinary glyphs', async () => {
    await withRoleScenario('shared Appearance family', async () => {
      await openRoleNote('reading');
      await setNativeInlineFonts({ '--font-text-override': "'Role Emoji B'" });
      await applyRoles({ ...EMPTY_ROLES, emoji: 'Role Emoji B' }, false);
      await matches(paragraph, 'Role Emoji B');
      await matches(paragraph, '__local-fonts-emoji__', '😀');
      const wrong = await measureSurface(paragraph, ordinary, 'Role Baseline');
      expect(Math.abs(wrong.width - wrong.referenceWidth)).toBeGreaterThan(2);
    });
  });

  it('decorates an actual Bases direct-theme reader where the built-in view exists', async function () {
    const available = await browser.executeObsidian(({ app }) =>
      Boolean(
        (app as unknown as { internalPlugins: { plugins: Record<string, unknown> } })
          .internalPlugins.plugins['bases'],
      ),
    );
    if (!available) {
      console.info('Capability skip: this app has no built-in Bases view');
      this.skip();
    }
    await withRoleScenario('Bases direct theme', async () => {
      const file = 'Role test.base';
      await browser.executeObsidian(async ({ app }, name: string) => {
        await app.vault.adapter.write(
          name,
          'filters:\n  and:\n    - file.ext == "md"\nviews:\n  - type: table\n    name: Role fonts\n',
        );
        await app.workspace.openLinkText(name, '', true);
      }, file);
      try {
        await browser.waitUntil(
          async () => browser.executeObsidian(() => document.querySelector('.bases-view') !== null),
          { timeout: 10000 },
        );
        await setNativeTestCss(
          "body {--font-text-theme:'Role Baseline';--font-interface-theme:'Role Baseline';} .bases-view {font-family:var(--font-text-theme);}",
        );
        await setNativeInlineFonts({ '--font-text-override': "'Role Interface'" });
        await applyRoles({ ...EMPTY_ROLES, emoji: 'Role Emoji A' }, false);
        await matches('.bases-view', 'Role Baseline');
        await matches('.bases-view', 'Role Emoji A', '😀');
      } finally {
        await browser.executeObsidian(async ({ app }, name: string) => {
          await app.vault.adapter.remove(name);
        }, file);
      }
    });
  });
});
