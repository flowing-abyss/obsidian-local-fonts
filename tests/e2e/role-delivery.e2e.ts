import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import type { PluginSettings } from '../../src/settings.js';
import {
  applyRoles,
  EMPTY_ROLES,
  measureSurface,
  openRoleNote,
  withRoleScenario,
} from './helpers/roles.js';

const ordinary = 'ABCАБя0123';
const emoji = '😀';

async function matches(selector: string, sample: string, family: string): Promise<void> {
  const result = await measureSurface(selector, sample, family);
  expect(Math.abs(result.width - result.referenceWidth)).toBeLessThanOrEqual(0.5);
}

describe('role delivery and file arrival', () => {
  it('finds an Emoji file added after an ordinary-role scan of a disposable font folder', async () => {
    await withRoleScenario('Emoji file arrival', async () => {
      await openRoleNote('reading');
      const folder = '.role-arrival-test';
      const ordinaryRoles = {
        ...EMPTY_ROLES,
        text: 'Role Text',
        interface: 'Role Interface',
        monospace: 'Role Mono',
        headings: 'Role Headings',
        emoji: 'Role Emoji B',
      };
      const snapshot = await browser.executeObsidian(({ app }) => {
        const plugin = (
          app.plugins as unknown as {
            plugins: Record<string, { settings: PluginSettings } | undefined>;
          }
        ).plugins['local-fonts'];
        if (plugin === undefined) throw new Error('Local Fonts is not enabled');
        return JSON.parse(JSON.stringify(plugin.settings)) as PluginSettings;
      });
      const alreadyExists = await browser.executeObsidian(
        ({ app }, temporaryFolder: string) => app.vault.adapter.exists(temporaryFolder),
        folder,
      );
      if (alreadyExists) throw new Error(`Disposable test folder already exists: ${folder}`);
      try {
        await browser.executeObsidian(
          async ({ app }, temporaryFolder: string, selected: PluginSettings['roles']) => {
            const plugin = (
              app.plugins as unknown as {
                plugins: Record<
                  string,
                  | {
                      settings: PluginSettings;
                      rescan(options: { force: boolean }): Promise<void>;
                    }
                  | undefined
                >;
              }
            ).plugins['local-fonts'];
            if (plugin?.settings.cache === null || plugin === undefined)
              throw new Error('Missing scanned role cache');
            const adapter = app.vault.adapter;
            const families = new Set([
              'Role Baseline',
              'Role Text',
              'Role Interface',
              'Role Mono',
              'Role Headings',
            ]);
            const ordinaryFaces = plugin.settings.cache.faces.filter((face) =>
              families.has(face.family),
            );
            if (ordinaryFaces.length !== families.size)
              throw new Error(
                `Expected ${families.size} ordinary fixture faces; found ${ordinaryFaces.length}`,
              );
            await adapter.mkdir(temporaryFolder);
            for (const face of ordinaryFaces) {
              const name = face.path.split('/').pop();
              if (name === undefined) throw new Error(`Invalid fixture path ${face.path}`);
              await adapter.writeBinary(
                `${temporaryFolder}/${name}`,
                await adapter.readBinary(face.path),
              );
            }
            plugin.settings.folder = temporaryFolder;
            plugin.settings.roles = selected;
            await plugin.rescan({ force: true });
            if (plugin.settings.cache.faces.some((face) => face.family === 'Role Emoji B'))
              throw new Error('Emoji B appeared before its file arrived');
          },
          folder,
          ordinaryRoles,
        );
        await matches('.markdown-preview-view p', ordinary, 'Role Text');
        await matches('.markdown-preview-view p code', ordinary, 'Role Mono');
        await matches('.markdown-preview-view h3', ordinary, 'Role Headings');
        const absent = await browser.executeObsidian(
          () =>
            Array.from(document.head.querySelectorAll('style'))
              .find((style) => style.textContent.includes('--local-fonts-sheet: 1'))
              ?.textContent.includes('__local-fonts-emoji__') === true,
        );
        expect(absent).toBe(false);
        await browser.executeObsidian(
          async ({ app }, temporaryFolder: string, old: PluginSettings) => {
            const plugin = (
              app.plugins as unknown as {
                plugins: Record<
                  string,
                  | {
                      settings: PluginSettings;
                      rescan(options: { force: boolean }): Promise<void>;
                    }
                  | undefined
                >;
              }
            ).plugins['local-fonts'];
            const face = old.cache?.faces.find((item) => item.family === 'Role Emoji B');
            if (plugin === undefined || face === undefined)
              throw new Error('Missing Emoji B source face');
            const name = face.path.split('/').pop();
            if (name === undefined) throw new Error(`Invalid Emoji fixture path ${face.path}`);
            const adapter = app.vault.adapter;
            await adapter.writeBinary(
              `${temporaryFolder}/${name}`,
              await adapter.readBinary(face.path),
            );
            await plugin.rescan({ force: true });
            if (
              plugin.settings.cache?.faces.some((item) => item.family === 'Role Emoji B') !== true
            )
              throw new Error('New Emoji file was absent after rescan');
          },
          folder,
          snapshot,
        );
        await matches('.markdown-preview-view p', ordinary, 'Role Text');
        await matches('.markdown-preview-view p code', ordinary, 'Role Mono');
        await matches('.markdown-preview-view h3', ordinary, 'Role Headings');
        await matches('.markdown-preview-view p', emoji, 'Role Emoji B');
      } finally {
        await browser.executeObsidian(
          async ({ app }, temporaryFolder: string, old: PluginSettings) => {
            const plugin = (
              app.plugins as unknown as {
                plugins: Record<
                  string,
                  | {
                      settings: PluginSettings;
                      saveSettings(): Promise<void>;
                      applyFonts(): void;
                    }
                  | undefined
                >;
              }
            ).plugins['local-fonts'];
            if (plugin !== undefined) {
              plugin.settings = old;
              await plugin.saveSettings();
              plugin.applyFonts();
            }
            const adapter = app.vault.adapter;
            if (await adapter.exists(temporaryFolder)) {
              const entries = await adapter.list(temporaryFolder);
              for (const path of entries.files) await adapter.remove(path);
              await adapter.rmdir(temporaryFolder, true);
            }
          },
          folder,
          snapshot,
        );
      }
    });
  });

  it('replaces its marked style, repeats application, and restores saved roles after disable', async () => {
    await withRoleScenario('delivery and re-enable', async () => {
      await openRoleNote('reading');
      await applyRoles({ ...EMPTY_ROLES, text: 'Role Text', emoji: 'Role Emoji A' }, true);
      await matches('.markdown-preview-view p', ordinary, 'Role Text');
      await matches('.markdown-preview-view p', emoji, 'Role Emoji A');
      const initial = await browser.executeObsidian(({ app }) => {
        const plugin = (
          app.plugins as unknown as {
            plugins: Record<
              string,
              { settings: { cache: unknown }; applyFonts(): void } | undefined
            >;
          }
        ).plugins['local-fonts'];
        if (plugin === undefined) throw new Error('Local Fonts is not enabled');
        const found = Array.from(document.head.querySelectorAll('style')).find(
          (el) =>
            el.textContent.includes('--local-fonts-sheet: 1') &&
            el.textContent.includes('__local-fonts-emoji__'),
        );
        if (found === undefined) throw new Error('Missing generated role stylesheet');
        const style = found;
        if (style.sheet === null) throw new Error('Generated role stylesheet has no CSSOM');
        const applicationRules = () =>
          Array.from(style.sheet?.cssRules ?? [])
            .filter(
              (rule): rule is CSSStyleRule =>
                rule instanceof CSSStyleRule &&
                (rule.selectorText.startsWith('html body') ||
                  rule.style.getPropertyPriority('font-family') === 'important'),
            )
            .map((rule) => rule.cssText)
            .join('\n');
        const first = applicationRules();
        const faces = (style.textContent.match(/@font-face/g) ?? []).length;
        for (let repeat = 0; repeat < 10; repeat++) plugin.applyFonts();
        if (applicationRules() !== first)
          throw new Error('Repeated application changed role rules');
        if ((style.textContent.match(/@font-face/g) ?? []).length !== faces)
          throw new Error('Repeated application duplicated face rules');
        const clone = style.cloneNode(true) as HTMLStyleElement;
        clone.dataset['roleTestReplacement'] = '1';
        const text = style.textContent;
        const generated = text.indexOf('\n\n@font-face');
        if (generated < 0) throw new Error('Could not separate base CSS from generated faces');
        clone.textContent = text.slice(0, generated);
        style.replaceWith(clone);
        return { faces, first };
      });
      await browser.waitUntil(
        async () =>
          browser.executeObsidian(() =>
            Array.from(document.head.querySelectorAll('style')).some(
              (style) =>
                style.textContent.includes('--local-fonts-sheet: 1') &&
                style.textContent.includes('__local-fonts-emoji__'),
            ),
          ),
        { timeout: 10_000, timeoutMsg: 'Replacement style did not recover' },
      );
      await matches('.markdown-preview-view p', emoji, 'Role Emoji A');
      const recovered = await browser.executeObsidian(() => {
        const style = Array.from(document.head.querySelectorAll('style')).find(
          (el) =>
            el.textContent.includes('--local-fonts-sheet: 1') &&
            el.textContent.includes('__local-fonts-emoji__'),
        );
        if (style?.sheet === null || style === undefined)
          throw new Error('Missing recovered sheet');
        return {
          faces: (style.textContent.match(/@font-face/g) ?? []).length,
          rules: Array.from(style.sheet.cssRules)
            .filter(
              (rule): rule is CSSStyleRule =>
                rule instanceof CSSStyleRule &&
                (rule.selectorText.startsWith('html body') ||
                  rule.style.getPropertyPriority('font-family') === 'important'),
            )
            .map((rule) => rule.cssText)
            .join('\n'),
        };
      });
      expect(recovered).toEqual({ faces: initial.faces, rules: initial.first });
      await browser.executeObsidian(async ({ app }) => {
        const manager = app.plugins as unknown as {
          plugins: Record<string, { saveSettings(): Promise<void> } | undefined>;
          disablePlugin(id: string): Promise<void>;
          enablePlugin(id: string): Promise<void>;
        };
        const plugin = manager.plugins['local-fonts'];
        if (plugin === undefined) throw new Error('Missing plugin before disable');
        await plugin.saveSettings();
        await manager.disablePlugin('local-fonts');
        if (
          Array.from(document.head.querySelectorAll('style')).some((style) =>
            style.textContent.includes('__local-fonts-emoji__'),
          )
        )
          throw new Error('Generated Emoji CSS survived disable');
        document.head.querySelector('style[data-role-test-replacement="1"]')?.remove();
        await manager.enablePlugin('local-fonts');
      });
      await browser.waitUntil(
        async () =>
          browser.executeObsidian(({ app }) => {
            const plugin = (
              app.plugins as unknown as {
                plugins: Record<
                  string,
                  { settings: { roles: { emoji: string | null } } } | undefined
                >;
              }
            ).plugins['local-fonts'];
            return (
              plugin?.settings.roles.emoji === 'Role Emoji A' &&
              Array.from(document.head.querySelectorAll('style')).some((style) =>
                style.textContent.includes('__local-fonts-emoji__'),
              )
            );
          }),
        { timeout: 10_000, timeoutMsg: 'Saved Emoji role did not return after re-enable' },
      );
      await matches('.markdown-preview-view p', ordinary, 'Role Text');
      await matches('.markdown-preview-view p', emoji, 'Role Emoji A');
    });
  });

  it('keeps ordinary glyphs readable when a selected Emoji face cannot load', async () => {
    await withRoleScenario('missing Emoji file', async () => {
      await openRoleNote('reading');
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
        plugin.settings.cache.faces.push({
          ...source,
          family: 'Role Emoji Missing File',
          path: '.fonts/no-such-emoji-file.woff2',
        });
        plugin.applyFonts();
      });
      await applyRoles({ ...EMPTY_ROLES, emoji: 'Role Emoji Missing File' }, false);
      await matches('.markdown-preview-view p', ordinary, 'Role Baseline');
      const css = await browser.executeObsidian(
        () =>
          Array.from(document.head.querySelectorAll('style')).find((style) =>
            style.textContent.includes('--local-fonts-sheet: 1'),
          )?.textContent ?? '',
      );
      expect(css).toContain("'__local-fonts-emoji__', var(--local-fonts-base-font-text)");
    });
  });
});
