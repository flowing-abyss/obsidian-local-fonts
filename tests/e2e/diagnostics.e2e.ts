import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import {
  closeRoleSettings,
  openRoleNote,
  openRoleSettings,
  setNativeInlineFonts,
  withRoleScenario,
} from './helpers/roles.js';

type Role = 'text' | 'interface' | 'emoji';

async function selectRole(role: Role, family: string, waitForApplication = true): Promise<void> {
  const observed = await browser.executeObsidian(
    ({ app }, target: Role, value: string) => {
      const setting = (
        app as unknown as {
          setting: { tabContentContainer?: HTMLElement; activeTab?: { containerEl: HTMLElement } };
        }
      ).setting;
      const visible = setting.tabContentContainer;
      const root =
        visible !== undefined && visible.getClientRects().length > 0
          ? visible
          : setting.activeTab?.containerEl;
      if (root === undefined) throw new Error('Settings tab is not visible');
      const rows = Array.from(root.querySelectorAll<HTMLElement>('.setting-item'));
      const label: Record<Role, string> = { text: 'Text', interface: 'Interface', emoji: 'Emoji' };
      const row = rows.find(
        (item) => item.querySelector('.setting-item-name')?.textContent.trim() === label[target],
      );
      const control = row?.querySelector<HTMLSelectElement>('select');
      if (control == null) throw new Error(`Missing ${target} dropdown`);
      control.value = value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        html: control.outerHTML,
        values: Array.from(root.querySelectorAll<HTMLSelectElement>('select')).map(
          (item) => item.value,
        ),
      };
    },
    role,
    family,
  );
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(
        ({ app }, target: Role, value: string) => {
          const plugin = (
            app.plugins as unknown as {
              plugins: Record<
                string,
                { settings: { roles: Record<Role, string | null> } } | undefined
              >;
            }
          ).plugins['local-fonts'];
          return plugin?.settings.roles[target] === value;
        },
        role,
        family,
      ),
    {
      timeout: 10_000,
      timeoutMsg: `Role ${role} did not save ${family}: ${JSON.stringify(observed)}`,
    },
  );
  if (waitForApplication)
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(
          ({ app }, target: Role, value: string) => {
            const setting = (
              app as unknown as {
                setting: {
                  tabContentContainer?: HTMLElement;
                  activeTab?: { containerEl: HTMLElement };
                };
              }
            ).setting;
            const visible = setting.tabContentContainer;
            const root =
              visible !== undefined && visible.getClientRects().length > 0
                ? visible
                : setting.activeTab?.containerEl;
            if (root === undefined) return false;
            const style = root.ownerDocument.defaultView?.getComputedStyle(root);
            // Fixture families do not collide with the private Emoji alias.
            const expected = target === 'emoji' ? '__local-fonts-emoji__' : value;
            return (
              style
                ?.getPropertyValue(target === 'interface' ? '--font-interface' : '--font-text')
                .includes(expected) === true
            );
          },
          role,
          family,
        ),
      { timeout: 10_000, timeoutMsg: `Role ${role} CSS did not reach the settings document` },
    );
}

async function check(roles: readonly string[]): Promise<string> {
  await browser.executeObsidian(({ app }) => {
    const setting = (
      app as unknown as {
        setting: { tabContentContainer?: HTMLElement; activeTab?: { containerEl: HTMLElement } };
      }
    ).setting;
    const visible = setting.tabContentContainer;
    const root =
      visible !== undefined && visible.getClientRects().length > 0
        ? visible
        : setting.activeTab?.containerEl;
    const button = Array.from(root?.querySelectorAll('button') ?? []).find(
      (item) => item.textContent === 'Check',
    );
    if (button === undefined) throw new Error('Visible Check button is missing');
    button.click();
  });
  try {
    await browser.waitUntil(
      async () => {
        const result = await resultText();
        return roles.every((role) => result.includes(`${role}:`));
      },
      { timeout: 10_000 },
    );
  } catch (error) {
    throw new Error(`Check did not finish: ${await resultText()}; ${String(error)}`);
  }
  return resultText();
}

async function resultText(): Promise<string> {
  return browser.executeObsidian(({ app }) => {
    const setting = (
      app as unknown as {
        setting: { tabContentContainer?: HTMLElement; activeTab?: { containerEl: HTMLElement } };
      }
    ).setting;
    const visible = setting.tabContentContainer;
    const root =
      visible !== undefined && visible.getClientRects().length > 0
        ? visible
        : setting.activeTab?.containerEl;
    return root?.querySelector('.local-fonts-check-results')?.textContent ?? '';
  });
}

async function waitForSettingsRefresh(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(({ app }) => {
        const tab = (app as unknown as { setting: { activeTab?: { refreshInFlight?: boolean } } })
          .setting.activeTab;
        return tab?.refreshInFlight === false;
      }),
    { timeout: 10_000, timeoutMsg: 'Local Fonts settings refresh did not settle' },
  );
}

async function settingsSharesNoteDocument(): Promise<boolean> {
  return browser.executeObsidian(({ app }) => {
    const setting = (
      app as unknown as {
        setting: { tabContentContainer?: HTMLElement; activeTab?: { containerEl: HTMLElement } };
      }
    ).setting;
    const visible = setting.tabContentContainer;
    const root =
      visible !== undefined && visible.getClientRects().length > 0
        ? visible
        : setting.activeTab?.containerEl;
    if (root === undefined) throw new Error('Settings tab is not visible');
    return root.ownerDocument === document;
  });
}

async function assertReadableFallback(): Promise<void> {
  await closeRoleSettings();
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(() => {
        const paragraph = document.querySelector<HTMLElement>('.markdown-preview-view p');
        if (paragraph === null || paragraph.getClientRects().length === 0) return false;
        const stack = window.getComputedStyle(paragraph).fontFamily;
        if (!stack.includes('sans-serif')) return false;
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node !== null && !(node.nodeValue?.includes('ABCАБя0123') ?? false)) {
          node = walker.nextNode();
        }
        if (node?.nodeValue == null) return false;
        const start = node.nodeValue.indexOf('ABCАБя0123');
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + 'ABCАБя0123'.length);
        return range.getBoundingClientRect().width > 0;
      }),
    { timeout: 10_000, timeoutMsg: 'Broken local font left no readable fallback text' },
  );
}

interface DeferredRoleSave {
  plugin: { saveSettings(): Promise<void> };
  descriptor: PropertyDescriptor | undefined;
  original(): Promise<void>;
  pending: Array<() => void>;
}

describe('visible font diagnostics', () => {
  it('follows Emoji-only, Text plus Emoji, precedence, and no open text surface', async () => {
    await withRoleScenario('diagnostics roles', async () => {
      await openRoleNote('reading');
      await openRoleSettings();
      await selectRole('emoji', 'Role Emoji A');
      expect(await check(['Emoji'])).toContain('Emoji: Role Emoji A — Local font loaded');
      await selectRole('text', 'Role Text');
      const combined = await check(['Text', 'Emoji']);
      expect(combined).toContain('Text: Role Text — Local font loaded');
      // 1.0.3 shares the note document; 1.13 uses a separate settings document.
      if (await settingsSharesNoteDocument()) {
        expect(combined).toContain('Reading text: Selected font is first in the checked stack');
      } else {
        expect(combined).toContain('No matching open surface to check');
        expect(combined).not.toContain('Reading text:');
      }
      expect(combined).toContain('Settings label: Selected font is first in the checked stack');
      await selectRole('interface', 'Role Interface');
      await setNativeInlineFonts({ '--font-interface-override': 'Role Baseline' });
      const overridden = await check(['Text', 'Interface', 'Emoji']);
      expect(overridden).toContain('Interface: Role Interface — Local font loaded');
      expect(overridden).toContain('Settings label: Another font is listed first here');
      await closeRoleSettings();
      await openRoleSettings();
      const reopened = await check(['Text', 'Interface', 'Emoji']);
      expect(reopened).toContain('Interface: Role Interface — Local font loaded');
      expect(reopened).toContain('Settings label: Another font is listed first here');
      await closeRoleSettings();
      await browser.executeObsidian(({ app }) => {
        app.workspace.detachLeavesOfType('markdown');
      });
      // Reopen after closing the notes; phone modal closure has already completed.
      await openRoleSettings();
      expect(await check(['Text', 'Interface', 'Emoji'])).toContain(
        'No matching open surface to check',
      );
    });
  });

  it('checks the applied Emoji selection while its settings write is pending', async () => {
    await withRoleScenario('diagnostics during settings write', async () => {
      await openRoleNote('reading');
      await openRoleSettings();
      await waitForSettingsRefresh();
      await browser.executeObsidian(({ app }) => {
        const plugin = (
          app.plugins as unknown as {
            plugins: Record<string, DeferredRoleSave['plugin']>;
          }
        ).plugins['local-fonts'];
        if (plugin === undefined) throw new Error('Local Fonts is missing');
        const deferred: DeferredRoleSave = {
          plugin,
          descriptor: Object.getOwnPropertyDescriptor(plugin, 'saveSettings'),
          original: plugin.saveSettings.bind(plugin),
          pending: [],
        };
        (window as Window & { __deferredRoleSave?: DeferredRoleSave }).__deferredRoleSave =
          deferred;
        plugin.saveSettings = () =>
          new Promise<void>((resolve) => {
            deferred.pending.push(resolve);
          });
      });
      try {
        // Use the actual dropdown and Check button while the save cannot finish.
        await selectRole('emoji', 'Role Emoji A', false);
        const result = await check(['Emoji']);
        expect(result).toContain('Emoji: Role Emoji A — Local font loaded');
        expect(result).not.toContain('Selected font is absent from the checked stack');
        expect(
          await browser.executeObsidian(
            () =>
              (window as Window & { __deferredRoleSave?: DeferredRoleSave }).__deferredRoleSave
                ?.pending.length ?? 0,
          ),
        ).toBeGreaterThan(0);
      } finally {
        await browser.executeObsidian(async () => {
          const owner = window as Window & { __deferredRoleSave?: DeferredRoleSave };
          const deferred = owner.__deferredRoleSave;
          if (deferred === undefined) return;
          if (deferred.descriptor === undefined)
            Reflect.deleteProperty(deferred.plugin, 'saveSettings');
          else Object.defineProperty(deferred.plugin, 'saveSettings', deferred.descriptor);
          try {
            await deferred.original();
          } finally {
            for (const finish of deferred.pending) finish();
            delete owner.__deferredRoleSave;
          }
        });
      }
    });
  });

  it('reports a missing font resource as a load failure', async () => {
    await withRoleScenario('broken resource', async () => {
      await openRoleNote('reading');
      await openRoleSettings();
      await waitForSettingsRefresh();
      await browser.executeObsidian(({ app }) => {
        const plugin = (
          app.plugins as unknown as {
            plugins: Record<
              string,
              | {
                  settings: {
                    cache: { faces: Array<{ family: string; path: string }> };
                    roles: { text: string | null };
                  };
                  applyFonts(): void;
                }
              | undefined
            >;
          }
        ).plugins['local-fonts'];
        if (plugin === undefined) throw new Error('Local Fonts is missing');
        const face = plugin.settings.cache.faces.find((item) => item.family === 'Role Text');
        if (face === undefined) throw new Error('Role Text face is missing');
        face.family = 'Role Broken';
        face.path = 'fonts/missing-diagnostic-resource.woff2';
        plugin.settings.roles.text = 'Role Broken';
        plugin.applyFonts();
      });
      const result = await check(['Text']);
      expect(result).toContain('Text: Role Broken — Local font could not be loaded');
      if (await settingsSharesNoteDocument()) {
        expect(result).toContain('Reading text: Selected font is first in the checked stack');
      } else {
        expect(result).toContain('No matching open surface to check');
        expect(result).not.toContain('Reading text:');
      }
      await assertReadableFallback();
    });
  });
});
