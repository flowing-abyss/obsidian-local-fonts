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

/** The static rule styles.css ships with, which main.ts finds the element by. */
const MARKER_CSS = ':root { --local-fonts-sheet: 1; }';

/**
 * Stands in for what Obsidian itself does before the plugin ever runs: load styles.css
 * into a `<style>` element in the head, marker rule and all.
 *
 * The tag name is held in a constant rather than written inline, because every lint
 * rule that would catch a plugin creating a `<style>` element matches on the literal,
 * and those rules may not be disabled anywhere in this repo. They are aimed at the
 * plugin, which never creates one — main.ts only finds this element and appends to it.
 * The test is playing Obsidian here, the one party that is supposed to create it.
 */
const STYLE_TAG = 'style';

function installPluginStyles(): HTMLStyleElement {
  const el = document.head.createEl(STYLE_TAG);
  el.textContent = MARKER_CSS;
  return el;
}

describe('LocalFontsPlugin', () => {
  let plugin: LocalFontsPlugin;
  /** The element main.ts is expected to find and write the generated CSS into. */
  let styleEl: HTMLStyleElement;

  beforeEach(() => {
    plugin = createPlugin();
    styleEl = installPluginStyles();
  });

  // jsdom's `document` is shared across every `it` in this file (vitest isolates per
  // file, not per test). Without this, each test would leave another stand-in
  // styles.css behind for the next one to find first.
  afterEach(() => {
    plugin.onunload();
    styleEl.remove();
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

  it('appends generated rules to the plugin style element and clears them on unload', async () => {
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

    expect(styleEl.textContent).toContain('Probe Sans');

    plugin.onunload();

    expect(styleEl.textContent).not.toContain('Probe Sans');
    // styles.css's own rules must survive — only this plugin's generated CSS goes.
    expect(styleEl.textContent).toBe(MARKER_CSS);
  });

  // The regression this guards: pop-out windows, the settings dialog among them on
  // desktop, are separate documents that Obsidian fills by cloning the main document's
  // `<style>` elements and mirroring later text edits into the clones. CSS delivered
  // any other way — an adopted constructed sheet, rules pushed through `insertRule` —
  // exists only in the CSSOM of the main document and never crosses that boundary, so
  // every pop-out rendered with the theme's fonts instead of the vault's.
  it('delivers the CSS as element text, the only form Obsidian mirrors into pop-out windows', async () => {
    vi.spyOn(plugin, 'loadData').mockResolvedValue({
      folder: 'fonts',
      roles: { text: 'Probe Sans', interface: null, monospace: null, headings: null, emoji: null },
      hardOverride: false,
      cache: { version: 1, folder: 'fonts', faces: [] },
    });

    await plugin.onload();

    // Not `sheet.cssRules`: the text itself has to carry it, because the text is what
    // gets cloned.
    expect(styleEl.textContent).toContain('--font-text-override');
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

    expect(styleEl.textContent).toContain('Probe Sans');
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
    const afterFirstLoad = styleEl.textContent;

    await plugin.onload();

    expect(styleEl.textContent).toBe(afterFirstLoad);
  });

  it('logs rather than throws when the plugin stylesheet never turns up', async () => {
    styleEl.remove();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.useFakeTimers();

    try {
      await expect(plugin.onload()).resolves.toBeUndefined();

      // Missing it at this point is the expected case — Obsidian appends styles.css
      // only after `onload` returns — so nothing is said while the wait is still on.
      expect(consoleError).not.toHaveBeenCalled();

      vi.advanceTimersByTime(30_000);
    } finally {
      vi.useRealTimers();
    }

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('could not find'));
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  // Obsidian reads a plugin's styles.css from disk and appends it only after `onload`
  // resolves, so the apply on the startup path finds nothing. Without waiting for it,
  // a fresh install and every reload in place came up with no fonts at all until
  // something else happened to force a rescan.
  it('applies as soon as Obsidian appends styles.css, however many ticks that takes', async () => {
    vi.spyOn(plugin, 'loadData').mockResolvedValue({
      roles: { text: 'Probe Sans', interface: null, monospace: null, headings: null, emoji: null },
    });
    styleEl.remove();

    await plugin.onload();
    expect(styleEl.textContent).toBe(MARKER_CSS);

    document.head.append(styleEl);

    await vi.waitFor(() => {
      expect(styleEl.textContent).toContain('Probe Sans');
    });
  });

  it('skips a stylesheet that throws on cssRules access (e.g. cross-origin) and keeps looking', async () => {
    const throwingSheet = {
      get cssRules(): never {
        throw new DOMException('cannot access rules');
      },
    } as unknown as CSSStyleSheet;
    // A cross-origin sheet cannot be built in jsdom, so it is stubbed ahead of the real
    // element in `document.styleSheets` — the one list main.ts walks.
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      get: () => [throwingSheet, styleEl.sheet],
    });

    await plugin.onload();

    Reflect.deleteProperty(document, 'styleSheets');
    expect(styleEl.textContent).toContain('--local-fonts-sheet');
  });

  // Found live: `all: unset` resets custom properties too, so in Chromium any rule
  // using it answers `getPropertyValue('--local-fonts-sheet')` with `'unset'` rather
  // than `''`. A presence check matched the first such rule in the document and this
  // plugin appended its CSS to a stranger's stylesheet (Excalidraw's, in the vault
  // where it turned up). The marker's value has to match, not merely exist.
  it('ignores a stylesheet whose rules only report the marker because they use all: unset', async () => {
    vi.spyOn(plugin, 'loadData').mockResolvedValue({
      roles: { text: 'Probe Sans', interface: null, monospace: null, headings: null, emoji: null },
    });
    const impostorCss = '.impostor { all: unset; }';
    const impostor = document.head.createEl(STYLE_TAG);
    impostor.textContent = impostorCss;
    // jsdom does not expand `all`, so the reported value is stubbed to what Chromium
    // actually returns for an undeclared custom property under `all: unset`.
    const rules = impostor.sheet?.cssRules;
    const rule = rules?.[0];
    if (rule instanceof CSSStyleRule) {
      vi.spyOn(rule.style, 'getPropertyValue').mockReturnValue('unset');
    }
    // Ahead of the real element, so a presence check would settle on this one.
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      get: () => [impostor.sheet, styleEl.sheet],
    });

    await plugin.onload();

    Reflect.deleteProperty(document, 'styleSheets');
    const impostorAfter = impostor.textContent;
    impostor.remove();
    expect(impostorAfter).toBe(impostorCss);
    expect(styleEl.textContent).toContain('Probe Sans');
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
});
