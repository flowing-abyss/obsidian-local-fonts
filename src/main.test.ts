import type { PluginManifest } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFixture } from '../tests/fixtures.js';
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

/**
 * Stands in for what Obsidian itself does before the plugin ever runs: load
 * styles.css as a real stylesheet, marker rule and all. A constructable
 * `CSSStyleSheet` (not a `<style>` element — this repo's own no-forbidden-elements
 * rule applies here too, and main.ts must never be the thing creating one) stubbed
 * directly into `document.styleSheets`, standing in for infrastructure the plugin
 * never creates itself; main.ts only ever *finds* this sheet.
 */
function markerStyleSheet(): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(':root { --local-fonts-sheet: 1; }');
  return sheet;
}

describe('LocalFontsPlugin', () => {
  let plugin: LocalFontsPlugin;
  /** The stylesheet main.ts's fallback path is expected to find and write into. */
  let pluginStyleSheet: CSSStyleSheet;
  /** Backs the `document.styleSheets` stub below; tests may add or remove entries. */
  let styleSheets: CSSStyleSheet[];

  beforeEach(() => {
    plugin = createPlugin();
    pluginStyleSheet = markerStyleSheet();
    styleSheets = [pluginStyleSheet];
    // jsdom's `document.styleSheets` only reflects real `<style>`/`<link>` elements,
    // which main.ts's fallback path must never create — stubbed as a plain getter
    // instead, the same technique this file already uses for `adoptedStyleSheets`.
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      get: () => styleSheets,
    });
  });

  // jsdom's `document` is shared across every `it` in this file (vitest isolates per
  // file, not per test). Without this, a test that injects rules into the fallback
  // sheet but never unloads would leave them behind for the next test to trip over.
  afterEach(() => {
    plugin.onunload();
    Reflect.deleteProperty(document, 'styleSheets');
  });

  it('falls back to the defaults when nothing was saved', async () => {
    await plugin.onload();

    expect(plugin.settings).toStrictEqual(DEFAULT_SETTINGS);
  });

  it('merges saved settings over the defaults', async () => {
    vi.spyOn(plugin, 'loadData').mockResolvedValue({ hardOverride: true });

    await plugin.onload();

    expect(plugin.settings.hardOverride).toBe(true);
    expect(plugin.settings.folder).toBe('fonts');
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

  it('inserts generated rules into the plugin stylesheet and clears them on unload', async () => {
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

    const rulesAfterLoad = Array.from(pluginStyleSheet.cssRules);
    expect(rulesAfterLoad.some((rule) => rule.cssText.includes('Probe Sans'))).toBe(true);

    plugin.onunload();

    const rulesAfterUnload = Array.from(pluginStyleSheet.cssRules);
    expect(rulesAfterUnload.some((rule) => rule.cssText.includes('Probe Sans'))).toBe(false);
    // The marker rule from styles.css itself must survive — only this plugin's own
    // rules are removed.
    expect(
      rulesAfterUnload.some(
        (rule) =>
          rule instanceof CSSStyleRule &&
          rule.style.getPropertyValue('--local-fonts-sheet').trim() !== '',
      ),
    ).toBe(true);
  });

  it('does no font I/O during onload, so Obsidian start stays fast', async () => {
    const io = {
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
      stat: vi.fn().mockResolvedValue({ size: 0, mtime: 0 }),
      readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    };
    Object.assign(plugin.app.vault.adapter, io);

    await plugin.onload();

    // Scanning is deferred behind onLayoutReady; nothing here may touch the filesystem.
    expect(io.list).not.toHaveBeenCalled();
    expect(io.stat).not.toHaveBeenCalled();
    expect(io.readBinary).not.toHaveBeenCalled();
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

    const rules = Array.from(pluginStyleSheet.cssRules);
    expect(rules.some((rule) => rule.cssText.includes('Probe Sans'))).toBe(true);
  });

  it('does not accumulate duplicate rules in the plugin stylesheet when reloaded in place', async () => {
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
    const countAfterFirstLoad = pluginStyleSheet.cssRules.length;

    await plugin.onload();
    const countAfterSecondLoad = pluginStyleSheet.cssRules.length;

    expect(countAfterSecondLoad).toBe(countAfterFirstLoad);
  });

  it('logs rather than throws when the plugin stylesheet cannot be found', async () => {
    styleSheets = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(plugin.onload()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('could not find'));
  });

  it('skips a stylesheet that throws on cssRules access (e.g. cross-origin) and keeps looking', async () => {
    const throwingSheet = {
      get cssRules(): never {
        throw new DOMException('cannot access rules');
      },
    } as unknown as CSSStyleSheet;
    styleSheets = [throwingSheet, pluginStyleSheet];

    await plugin.onload();
    plugin.applyFonts();

    expect(pluginStyleSheet.cssRules.length).toBeGreaterThanOrEqual(1);
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

  it('says so when it kept a cache it could not verify against the folder', async () => {
    // Obsidian Sync copies data.json, which lives under .obsidian, but never a folder
    // whose name starts with a dot. A second device therefore receives the cache without
    // the fonts, and the tab would otherwise list families that are not there at all.
    vi.spyOn(plugin, 'loadData').mockResolvedValue({
      folder: '.fonts',
      roles: { text: 'Probe Sans', interface: null, monospace: null, headings: null, emoji: null },
      hardOverride: false,
      cache: {
        version: 2,
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
    vi.spyOn(plugin, 'saveData').mockResolvedValue();

    await plugin.onload();
    await plugin.rescan();

    const warning = plugin.unverifiedCache();
    expect(warning).toContain('.fonts');
    expect(warning).toContain('Sync');
  });

  it('clears the unverified-cache warning once the folder can be read again', async () => {
    await plugin.app.vault.adapter.writeBinary(
      'fonts/probe-sans-400.ttf',
      readFixture('probe-sans/probe-sans-400.ttf'),
    );
    await plugin.onload();

    await plugin.rescan();

    expect(plugin.unverifiedCache()).toBeNull();
  });

  it('scans real files end-to-end, grouping the result by family', async () => {
    await plugin.app.vault.adapter.writeBinary(
      'fonts/probe-sans-400.ttf',
      readFixture('probe-sans/probe-sans-400.ttf'),
    );

    await plugin.onload();
    await plugin.rescan();

    expect(plugin.settings.cache?.faces).toHaveLength(1);
    expect(plugin.families().get('Probe Sans')).toHaveLength(1);
  });

  it('rescans automatically once the workspace layout is ready, when the cache is stale', async () => {
    await plugin.app.vault.adapter.writeBinary(
      'fonts/probe-sans-400.ttf',
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
      'fonts/probe-sans-400.ttf',
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

  it('reports a file that could not be read, so a bad font is discoverable rather than only console.warn-ed', async () => {
    const adapter = plugin.app.vault.adapter;
    vi.spyOn(adapter, 'list').mockResolvedValue({ files: ['fonts/bad-400.ttf'], folders: [] });
    vi.spyOn(adapter, 'stat').mockRejectedValue(new Error('EPERM'));

    await plugin.onload();
    await plugin.rescan();

    expect(plugin.skippedFiles()).toStrictEqual(['fonts/bad-400.ttf']);
  });

  it('clears skippedFiles once a later scan no longer skips anything', async () => {
    const adapter = plugin.app.vault.adapter;
    const list = vi.spyOn(adapter, 'list');
    list.mockResolvedValueOnce({ files: ['fonts/bad-400.ttf'], folders: [] });
    vi.spyOn(adapter, 'stat').mockRejectedValueOnce(new Error('EPERM'));

    await plugin.onload();
    await plugin.rescan();
    expect(plugin.skippedFiles()).toStrictEqual(['fonts/bad-400.ttf']);

    list.mockResolvedValueOnce({ files: [], folders: [] });
    await plugin.rescan();

    expect(plugin.skippedFiles()).toStrictEqual([]);
  });

  it('has no scan failure reported before any scan runs', async () => {
    await plugin.onload();

    expect(plugin.lastScanFailure()).toBeNull();
  });

  it('surfaces a deferred rescan failure instead of leaving it in console.error only', async () => {
    await plugin.app.vault.adapter.writeBinary(
      'fonts/probe-sans-400.ttf',
      readFixture('probe-sans/probe-sans-400.ttf'),
    );
    await plugin.onload();
    vi.spyOn(plugin, 'rescan').mockRejectedValue(new Error('disk exploded'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const workspace = plugin.app.workspace as unknown as { setLayoutReady__: () => void };
    workspace.setLayoutReady__();

    await vi.waitFor(() => {
      expect(plugin.lastScanFailure()).toBe('disk exploded');
    });
    expect(consoleError).toHaveBeenCalled();
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

      // The primary path never touches the fallback stylesheet: only the marker rule
      // that was already there remains.
      expect(pluginStyleSheet.cssRules).toHaveLength(1);
      expect(document.adoptedStyleSheets).toHaveLength(1);
      expect(document.adoptedStyleSheets[0]?.cssRules[0]?.cssText).toContain('Probe Sans');
    });

    it('replaces the sheet in place on repeated calls instead of adopting duplicates', async () => {
      await plugin.onload();
      await plugin.onload();

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
