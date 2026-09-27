import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import {
  openRoleNote,
  openRoleSettings,
  setNativeInlineFonts,
  withRoleScenario,
} from './helpers/roles.js';

type Role = 'text' | 'interface' | 'emoji';

async function selectRole(role: Role, family: string): Promise<void> {
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
      // 1.0.3 keeps the note visible behind settings; 1.13 opens settings in a
      // separate document. Check describes only surfaces in its own document.
      expect(combined).toMatch(
        /Reading text: Selected font is first in the checked stack|No matching open surface to check/,
      );
      expect(combined).toContain('Settings label: Selected font is first in the checked stack');
      await selectRole('interface', 'Role Interface');
      await setNativeInlineFonts({ '--font-interface-override': 'Role Baseline' });
      const overridden = await check(['Text', 'Interface', 'Emoji']);
      expect(overridden).toContain('Interface: Role Interface — Local font loaded');
      expect(overridden).toContain('Settings label: Another font is listed first here');
      await browser.executeObsidian(({ app }) => {
        (app as unknown as { setting: { close(): void } }).setting.close();
      });
      await openRoleSettings();
      const reopened = await check(['Text', 'Interface', 'Emoji']);
      expect(reopened).toContain('Interface: Role Interface — Local font loaded');
      expect(reopened).toContain('Settings label: Another font is listed first here');
      await browser.executeObsidian(({ app }) => {
        app.workspace.detachLeavesOfType('markdown');
      });
      expect(await check(['Text', 'Interface', 'Emoji'])).toContain(
        'No matching open surface to check',
      );
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
      expect(result).toMatch(
        /Reading text: Selected font is first in the checked stack|No matching open surface to check/,
      );
    });
  });
});
