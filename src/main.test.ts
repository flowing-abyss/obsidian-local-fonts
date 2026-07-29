import type { PluginManifest } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LocalFontsPlugin from './main.js';
import { DEFAULT_SETTINGS } from './settings.js';

const manifest: PluginManifest = {
  id: 'local-fonts',
  name: 'Local Fonts',
  author: 'test',
  version: '0.0.0-test',
  minAppVersion: '1.0.3',
  description: 'Test manifest',
};

function createPlugin(): LocalFontsPlugin {
  const app = App.createConfigured__();
  return new LocalFontsPlugin(app.asOriginalType__(), manifest);
}

describe('LocalFontsPlugin', () => {
  let plugin: LocalFontsPlugin;

  beforeEach(() => {
    plugin = createPlugin();
  });

  it('falls back to the defaults when nothing was saved', async () => {
    await plugin.onload();

    expect(plugin.settings).toStrictEqual(DEFAULT_SETTINGS);
  });

  it('merges saved settings over the defaults', async () => {
    vi.spyOn(plugin, 'loadData').mockResolvedValue({ hardOverride: true });

    await plugin.onload();

    expect(plugin.settings.hardOverride).toBe(true);
    expect(plugin.settings.folder).toBe('.fonts');
  });

  it('persists the current settings via saveSettings', async () => {
    const saveData = vi.spyOn(plugin, 'saveData').mockResolvedValue();
    await plugin.onload();

    await plugin.saveSettings();

    expect(saveData).toHaveBeenCalledWith(plugin.settings);
  });

  it('does not throw on unload', async () => {
    await plugin.onload();

    expect(() => {
      plugin.onunload();
    }).not.toThrow();
  });
});
