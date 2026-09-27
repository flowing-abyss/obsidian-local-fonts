import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import { navigateRoleEditor } from './helpers/editor.js';
import {
  applyRoles,
  closeRoleSuggestion,
  EMPTY_ROLES,
  measureSurface,
  openRoleNote,
  openRoleSettings,
  openRoleSuggestion,
  setNativeInlineFonts,
  setNativeTestCss,
  withRoleScenario,
} from './helpers/roles.js';

describe('independent role composition', () => {
  it('renders emoji-only without changing ordinary text', async () => {
    await withRoleScenario('emoji-only', async () => {
      await openRoleNote('reading');
      const before = await measureSurface(
        '.markdown-preview-view p',
        'ABCАБя0123',
        'Role Baseline',
      );
      await applyRoles({ ...EMPTY_ROLES, emoji: 'Role Emoji A' }, false);
      const after = await measureSurface('.markdown-preview-view p', 'ABCАБя0123', 'Role Baseline');
      expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(0.5);
      for (const sample of ['😀', '☀️', '👩‍💻']) {
        const result = await measureSurface('.markdown-preview-view p', sample, 'Role Emoji A');
        expect(Math.abs(result.width - result.referenceWidth)).toBeLessThanOrEqual(0.5);
      }
    });
  });
});

const ordinary = 'ABCАБя0123';
const emojiSamples = ['😀', '☀️', '👩‍💻'];
const families = {
  text: 'Role Text',
  interface: 'Role Interface',
  monospace: 'Role Mono',
  headings: 'Role Headings',
  emoji: 'Role Emoji A',
};
const cases = [
  ...Object.keys(families).map((key) => [key]),
  ...['text', 'interface', 'monospace', 'headings'].map((key) => [key, 'emoji']),
  ['text', 'interface', 'monospace', 'headings'],
  Object.keys(families),
];

type Role = keyof typeof families;
async function assertSurface(
  selector: string,
  family: string,
  emoji: boolean,
  target: 'main' | 'settings' = 'main',
): Promise<void> {
  const text = await measureSurface(selector, ordinary, family, target);
  if (Math.abs(text.width - text.referenceWidth) > 0.5)
    throw new Error(
      `${selector}: ${text.stack}, width ${text.width}, expected ${text.referenceWidth}`,
    );
  if (emoji)
    for (const sample of emojiSamples) {
      const glyph = await measureSurface(selector, sample, 'Role Emoji A', target);
      if (Math.abs(glyph.width - glyph.referenceWidth) > 0.5)
        throw new Error(
          `${selector} ${sample}: ${glyph.stack}, width ${glyph.width}, expected ${glyph.referenceWidth}`,
        );
    }
}

describe('real consumers of independent roles', () => {
  for (const selected of cases)
    for (const hard of [false, true]) {
      it(`${selected.join('+')} on real consumers, hard ${hard}`, async () => {
        // eslint-disable-next-line complexity -- One scenario verifies each independently assigned consumer.
        await withRoleScenario('role consumers', async () => {
          const roles = { ...EMPTY_ROLES };
          for (const key of selected as Role[]) roles[key] = families[key];
          await applyRoles(roles, hard);
          const emoji = roles.emoji !== null;
          const text = roles.text ?? 'Role Baseline';
          const mono = roles.monospace ?? 'Role Baseline';
          const ui = roles.interface ?? 'Role Baseline';
          await openRoleNote('reading');
          await assertSurface('.markdown-preview-view p', text, emoji);
          await assertSurface('.markdown-preview-view p code', mono, emoji);
          await assertSurface('.markdown-preview-view pre code', mono, emoji);
          // Native headings inherit Text unless they have an explicit family.
          for (const level of [1, 2, 3, 4, 5, 6])
            await assertSurface(`.markdown-preview-view h${level}`, roles.headings ?? text, emoji);
          // A title's native role differs between Obsidian versions; only assert explicit ownership.
          if (roles.headings !== null) await assertSurface('.inline-title', roles.headings, emoji);
          for (const mode of ['live', 'source'] as const) {
            await openRoleNote(mode);
            await navigateRoleEditor(ordinary);
            await assertSurface('.workspace-leaf.mod-active .cm-line.cm-active', text, emoji);
            await navigateRoleEditor('Inline');
            await assertSurface('.workspace-leaf.mod-active .cm-inline-code', mono, emoji);
            await navigateRoleEditor('```');
            await assertSurface(
              '.workspace-leaf.mod-active .cm-line.HyperMD-codeblock',
              mono,
              emoji,
            );
            for (const level of [1, 2, 3, 4, 5, 6]) {
              await navigateRoleEditor(`${'#'.repeat(level)} `);
              await assertSurface(
                `.workspace-leaf.mod-active .HyperMD-header-${level}`,
                roles.headings ?? text,
                emoji,
              );
            }
          }
          await openRoleSuggestion();
          await assertSurface('.suggestion-item', ui, emoji);
          await closeRoleSuggestion();
          await openRoleSettings();
          await assertSurface('.role-test-setting .setting-item-name', ui, emoji, 'settings');
          const label = await measureSurface('.setting-item-name', 'Emoji', ui, 'settings');
          expect(Math.abs(label.width - label.referenceWidth)).toBeLessThanOrEqual(0.5);
        });
      });
    }
});

describe('native derived font policies', () => {
  for (const hard of [false, true])
    it(`preserves inherited and explicit title/table fonts, hard ${hard}`, async () => {
      await withRoleScenario('derived native fonts', async () => {
        await openRoleNote('reading');
        const baselineCss =
          "body { --font-text-theme:'Role Text'; --font-interface-theme:'Role Interface'; --font-monospace-theme:'Role Mono'; }";
        for (const explicit of [false, true]) {
          await setNativeTestCss(
            baselineCss +
              (explicit
                ? "body { --inline-title-font:'Role Headings'; --table-header-font:'Role Mono'; }"
                : 'body { --inline-title-font:inherit; --table-header-font:inherit; }'),
          );
          await applyRoles(EMPTY_ROLES, hard);
          const titleBefore = await measureSurface('.inline-title', ordinary, 'Role Headings');
          const tableBefore = await measureSurface(
            '.markdown-preview-view th',
            ordinary,
            'Role Mono',
          );
          await applyRoles({ ...EMPTY_ROLES, emoji: 'Role Emoji A' }, hard);
          const titleAfter = await measureSurface('.inline-title', ordinary, 'Role Headings');
          const tableAfter = await measureSurface(
            '.markdown-preview-view th',
            ordinary,
            'Role Mono',
          );
          expect(Math.abs(titleAfter.width - titleBefore.width)).toBeLessThanOrEqual(0.5);
          expect(Math.abs(tableAfter.width - tableBefore.width)).toBeLessThanOrEqual(0.5);
          if (explicit) {
            expect(Math.abs(titleAfter.width - titleAfter.referenceWidth)).toBeLessThanOrEqual(0.5);
            expect(Math.abs(tableAfter.width - tableAfter.referenceWidth)).toBeLessThanOrEqual(0.5);
          }
          for (const selector of ['.inline-title', '.markdown-preview-view th'])
            for (const sample of emojiSamples) {
              const glyph = await measureSurface(selector, sample, 'Role Emoji A');
              expect(Math.abs(glyph.width - glyph.referenceWidth)).toBeLessThanOrEqual(0.5);
            }
        }
      });
    });

  it('keeps the Appearance override and theme tiers independent when Emoji is added', async () => {
    await withRoleScenario('native priority', async () => {
      await openRoleNote('reading');
      await setNativeTestCss(
        "body { --font-text-theme:'Role Text'; --font-interface-theme:'Role Baseline'; --font-monospace-theme:'Role Mono'; } .markdown-preview-view th {font-family:var(--font-text-theme);}",
      );
      await setNativeInlineFonts({ '--font-text-override': "'Role Interface'" });
      await applyRoles({ ...EMPTY_ROLES, text: 'Role Headings', emoji: 'Role Emoji A' }, false);
      await assertSurface('.markdown-preview-view p', 'Role Interface', true);
      // Plugin's ordinary Text assignment still owns the theme tier, independently of Appearance.
      await assertSurface('.markdown-preview-view th', 'Role Headings', true);
    });
  });
});

describe('native interface derivatives', () => {
  for (const hard of [false, true])
    it(`composes current file/property consumers and UI headings, hard ${hard}`, async function () {
      const current = await browser.executeObsidian(({ obsidian }) =>
        obsidian.requireApiVersion('1.4.0'),
      );
      if (!current) this.skip();
      await withRoleScenario('current derivatives', async () => {
        await openRoleNote('reading');
        await setNativeTestCss(
          "body { --font-text-theme:'Role Text'; --font-interface-theme:'Role Interface'; --font-monospace-theme:'Role Mono'; --file-header-font:'Role Headings'; --metadata-input-font:'Role Mono'; }",
        );
        await applyRoles(
          { ...EMPTY_ROLES, interface: 'Role Interface', emoji: 'Role Emoji A' },
          hard,
        );
        // Obsidian hides phone file headers while inline titles are shown. Exercise its
        // native alternate title presentation without changing any font rules.
        const inlineTitle = await browser.executeObsidian(() => {
          const shown = document.body.hasClass('show-inline-title');
          document.body.removeClass('show-inline-title');
          return shown;
        });
        try {
          await assertSurface(
            '.workspace-leaf.mod-active .view-header-title',
            'Role Headings',
            true,
          );
        } finally {
          await browser.executeObsidian((_, shown: boolean) => {
            document.body.toggleClass('show-inline-title', shown);
          }, inlineTitle);
        }
        await assertSurface('.metadata-input-longtext', 'Role Mono', true);
        await openRoleSettings();
        await browser.executeObsidian(
          ({ app }, sample: string) => {
            const setting = (
              app as unknown as {
                setting: {
                  tabContentContainer?: HTMLElement;
                  activeTab: { containerEl: HTMLElement };
                };
              }
            ).setting;
            const root = setting.tabContentContainer ?? setting.activeTab.containerEl;
            const row = root.querySelector('.role-test-setting');
            if (row === null) throw new Error('Missing visible test settings row');
            row.createEl('h1', { text: sample, cls: 'role-ui-heading' });
          },
          `${ordinary} ${emojiSamples.join(' ')}`,
        );
        await assertSurface('.role-ui-heading', 'Role Interface', true, 'settings');
      });
    });
});
