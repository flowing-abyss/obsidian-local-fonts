import type { PluginManifest } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExamplePlugin from './main.js';

const manifest: PluginManifest = {
  id: 'your-id-here',
  name: 'Your Title Here',
  author: 'test',
  version: '0.0.0-test',
  minAppVersion: '1.0.3',
  description: 'Test manifest',
};

function createPlugin(): ExamplePlugin {
  const app = App.createConfigured__();
  return new ExamplePlugin(app.asOriginalType__(), manifest);
}

describe('ExamplePlugin', () => {
  let plugin: ExamplePlugin;

  beforeEach(() => {
    plugin = createPlugin();
  });

  it('falls back to the defaults when nothing was saved', async () => {
    await plugin.onload();

    expect(plugin.settings).toStrictEqual({ enabled: true });
  });

  it('merges saved settings over the defaults', async () => {
    vi.spyOn(plugin, 'loadData').mockResolvedValue({ enabled: false });

    await plugin.onload();

    expect(plugin.settings).toStrictEqual({ enabled: false });
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
