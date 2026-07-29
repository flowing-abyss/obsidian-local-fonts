import type { PluginManifest } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFixture } from './fonts/fixtures.js';
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

  // jsdom's `document` is shared across every `it` in this file (vitest isolates per
  // file, not per test). Without this, a test that injects the style element but never
  // unloads would leave it behind for the next test to trip over.
  afterEach(() => {
    plugin.onunload();
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

  it('injects a style element on load and removes it on unload', async () => {
    await plugin.onload();
    plugin.applyFonts();

    expect(document.getElementById('local-fonts-style')).not.toBeNull();

    plugin.onunload();

    expect(document.getElementById('local-fonts-style')).toBeNull();
  });

  it('does no font I/O during onload, so Obsidian start stays fast', async () => {
    const adapter = plugin.app.vault.adapter as unknown as { list: () => Promise<unknown> };
    const list = vi.fn().mockResolvedValue({ files: [], folders: [] });
    adapter.list = list;

    await plugin.onload();

    expect(list).not.toHaveBeenCalled();
  });

  it('reuses the cached faces without rescanning', async () => {
    vi.spyOn(plugin, 'loadData').mockResolvedValue({
      folder: '.fonts',
      roles: { text: 'Probe Sans', interface: null, monospace: null, headings: null, emoji: null },
      hardOverride: false,
      cache: {
        version: 1,
        folder: '.fonts',
        faces: [
          {
            path: '.fonts/probe-sans/probe-sans-400.woff2',
            format: 'woff2',
            size: 1,
            mtime: 1,
            family: 'Probe Sans',
            weight: 400,
            italic: false,
            colorFormats: [],
            scripts: [],
            axes: [],
            license: null,
            source: 'name-table',
          },
        ],
      },
    });

    await plugin.onload();
    plugin.applyFonts();

    const style = document.getElementById('local-fonts-style');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('Probe Sans');
  });

  it('does not leave a duplicate style element behind when reloaded in place', async () => {
    await plugin.onload();
    await plugin.onload();

    expect(document.querySelectorAll('#local-fonts-style')).toHaveLength(1);
  });

  it('keeps the last-known-good cache when a rescan finds nothing', async () => {
    const goodCache = {
      version: 1,
      folder: '.fonts',
      faces: [
        {
          path: '.fonts/probe-sans/probe-sans-400.woff2',
          format: 'woff2',
          size: 1,
          mtime: 1,
          family: 'Probe Sans',
          weight: 400,
          italic: false,
          colorFormats: [],
          scripts: [],
          axes: [],
          license: null,
          source: 'name-table',
        },
      ],
    } as const;
    vi.spyOn(plugin, 'loadData').mockResolvedValue({
      folder: '.fonts',
      roles: { text: 'Probe Sans', interface: null, monospace: null, headings: null, emoji: null },
      hardOverride: false,
      cache: goodCache,
    });
    const saveData = vi.spyOn(plugin, 'saveData').mockResolvedValue();

    await plugin.onload();
    // The mock adapter has no files under '.fonts', simulating a renamed/moved folder
    // rather than a genuinely emptied one.
    await plugin.rescan();

    expect(plugin.settings.cache).toStrictEqual(goodCache);
    expect(saveData).not.toHaveBeenCalled();
  });

  it('scans real files end-to-end, grouping the result by family', async () => {
    await plugin.app.vault.adapter.writeBinary(
      '.fonts/probe-sans-400.ttf',
      readFixture('probe-sans/probe-sans-400.ttf'),
    );

    await plugin.onload();
    await plugin.rescan();

    expect(plugin.settings.cache?.faces).toHaveLength(1);
    expect(plugin.families().get('Probe Sans')).toHaveLength(1);
  });

  it('rescans automatically once the workspace layout is ready, when the cache is stale', async () => {
    await plugin.app.vault.adapter.writeBinary(
      '.fonts/probe-sans-400.ttf',
      readFixture('probe-sans/probe-sans-400.ttf'),
    );

    await plugin.onload();
    expect(plugin.settings.cache).toBeNull();

    const workspace = plugin.app.workspace as unknown as { setLayoutReady__: () => void };
    workspace.setLayoutReady__();

    await vi.waitFor(() => {
      expect(plugin.settings.cache?.faces).toHaveLength(1);
    });
  });

  it('does not rescan once the workspace layout is ready, when the cache is already fresh', async () => {
    await plugin.app.vault.adapter.writeBinary(
      '.fonts/probe-sans-400.ttf',
      readFixture('probe-sans/probe-sans-400.ttf'),
    );

    await plugin.onload();
    await plugin.rescan();
    const cacheAfterRescan = plugin.settings.cache;
    const saveData = vi.spyOn(plugin, 'saveData').mockResolvedValue();

    const workspace = plugin.app.workspace as unknown as { setLayoutReady__: () => void };
    workspace.setLayoutReady__();
    // Give any (unwanted) async rescan a turn to run before asserting it didn't.
    await Promise.resolve();
    await Promise.resolve();

    expect(plugin.settings.cache).toBe(cacheAfterRescan);
    expect(saveData).not.toHaveBeenCalled();
  });

  describe('when adoptedStyleSheets is supported (Chromium 73+, WebKit 16.4+)', () => {
    beforeEach(() => {
      // jsdom itself doesn't implement the `adoptedStyleSheets` accessor, so stub it as a
      // plain data property to exercise the primary delivery path in tests. `CSSStyleSheet`
      // and `replaceSync` are genuinely implemented by jsdom, so this stub is only
      // standing in for the one thing jsdom is missing.
      Object.defineProperty(document, 'adoptedStyleSheets', {
        configurable: true,
        writable: true,
        value: [],
      });
    });

    afterEach(() => {
      Reflect.deleteProperty(document, 'adoptedStyleSheets');
    });

    it('adopts a constructable stylesheet instead of creating a style element', async () => {
      vi.spyOn(plugin, 'loadData').mockResolvedValue({
        folder: '.fonts',
        roles: {
          text: 'Probe Sans',
          interface: null,
          monospace: null,
          headings: null,
          emoji: null,
        },
        hardOverride: false,
        cache: {
          version: 1,
          folder: '.fonts',
          faces: [
            {
              path: '.fonts/probe-sans/probe-sans-400.woff2',
              format: 'woff2',
              size: 1,
              mtime: 1,
              family: 'Probe Sans',
              weight: 400,
              italic: false,
              colorFormats: [],
              scripts: [],
              axes: [],
              license: null,
              source: 'name-table',
            },
          ],
        },
      });

      await plugin.onload();
      plugin.applyFonts();

      expect(document.getElementById('local-fonts-style')).toBeNull();
      expect(document.adoptedStyleSheets).toHaveLength(1);
      expect(document.adoptedStyleSheets[0]?.cssRules[0]?.cssText).toContain('Probe Sans');
    });

    it('replaces the sheet in place on repeated calls instead of adopting duplicates', async () => {
      await plugin.onload();

      plugin.applyFonts();
      plugin.applyFonts();

      expect(document.adoptedStyleSheets).toHaveLength(1);
    });

    it('un-adopts the sheet on unload', async () => {
      await plugin.onload();
      expect(document.adoptedStyleSheets).toHaveLength(1);

      plugin.onunload();

      expect(document.adoptedStyleSheets).toHaveLength(0);
    });
  });
});
