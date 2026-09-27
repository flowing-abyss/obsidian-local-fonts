import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import type { DataAdapter } from 'obsidian';
import type { PluginSettings } from '../../src/settings.js';
import { withRoleScenario } from './helpers/roles.js';

interface PersistenceProbe {
  original: DataAdapter['write'];
  descriptor: PropertyDescriptor | undefined;
  writes: number;
  path: string;
  pending?: Promise<void>;
}
interface TestPlugin {
  settings: PluginSettings;
  saveSettings(): Promise<void>;
  applyFonts(): void;
  scanQueue: Promise<void>;
  rescan(options: { force: boolean }): Promise<void>;
}

async function installProbe(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const plugin = (app.plugins as unknown as { plugins: Record<string, TestPlugin> }).plugins[
      'local-fonts'
    ];
    if (plugin === undefined) throw new Error('Missing fixture plugin');
    await plugin.scanQueue;
    const adapter = app.vault.adapter;
    const probe: PersistenceProbe = {
      original: adapter.write.bind(adapter),
      descriptor: Object.getOwnPropertyDescriptor(adapter, 'write'),
      writes: 0,
      path: `${app.vault.configDir}/plugins/local-fonts/data.json`,
    };
    (window as Window & { __persistenceProbe?: PersistenceProbe }).__persistenceProbe = probe;
    adapter.write = function (path, data, options) {
      if (path === probe.path) probe.writes++;
      return probe.original.call(this, path, data, options);
    };
  });
}
async function restoreProbe(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const owner = window as Window & { __persistenceProbe?: PersistenceProbe };
    const probe = owner.__persistenceProbe;
    if (probe === undefined) return;
    await probe.pending;
    if (probe.descriptor === undefined) Reflect.deleteProperty(app.vault.adapter, 'write');
    else Object.defineProperty(app.vault.adapter, 'write', probe.descriptor);
    delete owner.__persistenceProbe;
  });
}

async function snapshotSettings(): Promise<PluginSettings> {
  return browser.executeObsidian(({ app }) => {
    const plugin = (app.plugins as unknown as { plugins: Record<string, TestPlugin> }).plugins[
      'local-fonts'
    ];
    if (plugin === undefined) throw new Error('Missing fixture plugin');
    return JSON.parse(JSON.stringify(plugin.settings)) as PluginSettings;
  });
}
async function savedSettings(): Promise<PluginSettings> {
  return browser.executeObsidian(async ({ app }) => {
    const probe = (window as unknown as Window & { __persistenceProbe: PersistenceProbe })
      .__persistenceProbe;
    await probe.pending;
    return JSON.parse(await app.vault.adapter.read(probe.path)) as PluginSettings;
  });
}

describe('role scenario persistence rollback', () => {
  it('does not write plugin data for a rendering-only scenario', async () => {
    await installProbe();
    try {
      await withRoleScenario('no persistence', async () => {
        await browser.executeObsidian(({ app }) => {
          const plugin = (app.plugins as unknown as { plugins: Record<string, TestPlugin> })
            .plugins['local-fonts'];
          if (plugin === undefined) throw new Error('Missing fixture plugin');
          plugin.settings.roles.text = 'Role Text';
          plugin.applyFonts();
        });
      });
      expect(
        await browser.executeObsidian(
          () =>
            (window as unknown as Window & { __persistenceProbe: PersistenceProbe })
              .__persistenceProbe.writes,
        ),
      ).toBe(0);
    } finally {
      await restoreProbe();
    }
  });

  for (const reload of [false, true])
    it(`restores data persisted by ${reload ? 'a fresh' : 'the current'} plugin instance`, async () => {
      const before = await snapshotSettings();
      await installProbe();
      try {
        await withRoleScenario('persisted rollback', async () => {
          await browser.executeObsidian(async ({ app }, restart: boolean) => {
            const manager = app.plugins as unknown as {
              plugins: Record<string, TestPlugin>;
              disablePlugin(id: string): Promise<void>;
              enablePlugin(id: string): Promise<void>;
            };
            if (restart) {
              await manager.disablePlugin('local-fonts');
              await manager.enablePlugin('local-fonts');
            }
            const plugin = manager.plugins['local-fonts'];
            if (plugin === undefined) throw new Error('Missing fixture plugin');
            plugin.settings.roles.emoji = 'Role Emoji B';
            await plugin.saveSettings();
          }, reload);
          expect((await savedSettings()).roles.emoji).toBe('Role Emoji B');
        });
        expect(await snapshotSettings()).toEqual(before);
        expect(await savedSettings()).toEqual(before);
      } finally {
        await restoreProbe();
      }
    });

  for (const operation of ['rejected save', 'pending rescan'] as const)
    it(`restores settings after a ${operation}`, async () => {
      const before = await snapshotSettings();
      await installProbe();
      try {
        await withRoleScenario(operation, async () => {
          await browser.executeObsidian(async ({ app }, action: string) => {
            const probe = (window as unknown as Window & { __persistenceProbe: PersistenceProbe })
              .__persistenceProbe;
            const plugin = (app.plugins as unknown as { plugins: Record<string, TestPlugin> })
              .plugins['local-fonts'];
            if (plugin === undefined) throw new Error('Missing fixture plugin');
            plugin.settings.roles.text = 'Role Text';
            if (action === 'pending rescan') {
              probe.pending = plugin.rescan({ force: true });
            } else {
              const original = probe.original;
              probe.original = () => {
                probe.original = original;
                return Promise.reject(new Error('Deliberate scenario save failure'));
              };
              // Obsidian versions differ in whether saveData propagates adapter
              // errors. Either outcome must still trigger conservative rollback.
              await plugin.saveSettings().catch(() => undefined);
            }
          }, operation);
        });
        expect(await savedSettings()).toEqual(before);
        expect(await snapshotSettings()).toEqual(before);
        expect(
          await browser.executeObsidian(
            () =>
              (window as unknown as Window & { __persistenceProbe: PersistenceProbe })
                .__persistenceProbe.writes,
          ),
        ).toBeGreaterThanOrEqual(2);
      } finally {
        await restoreProbe();
      }
    });

  it('drains a save still in flight before restoring persisted settings', async () => {
    const before = await snapshotSettings();
    await installProbe();
    try {
      await withRoleScenario('pending persistence rollback', async () => {
        await browser.executeObsidian(({ app }) => {
          const probe = (window as unknown as Window & { __persistenceProbe: PersistenceProbe })
            .__persistenceProbe;
          const original = probe.original;
          // Fault injection: the first real adapter write is held briefly while
          // cleanup starts. Its eventual disk result, not elapsed time, is asserted.
          probe.original = function (path, data, options) {
            probe.original = original;
            return new Promise<void>((resolve, reject) => {
              // eslint-disable-next-line sonarjs/no-nested-functions -- Self-contained renderer fault injection retains the real adapter operation.
              window.setTimeout(() => {
                original.call(this, path, data, options).then(resolve, reject);
              }, 500);
            });
          };
          const plugin = (app.plugins as unknown as { plugins: Record<string, TestPlugin> })
            .plugins['local-fonts'];
          if (plugin === undefined) throw new Error('Missing fixture plugin');
          plugin.settings.roles.headings = 'Role Headings';
          probe.pending = plugin.saveSettings();
        });
      });
      expect(await savedSettings()).toEqual(before);
      expect(await snapshotSettings()).toEqual(before);
    } finally {
      await restoreProbe();
    }
  });
});
