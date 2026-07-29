import { Platform, type PluginManifest } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LocalFontsPlugin from './main.js';
import { LocalFontsSettingTab } from './settings-tab.js';
import type { RoleName } from './settings.js';

/** Reaches a private handler directly — this mock's Dropdown/Toggle components only fire
 *  onChange when their own setValue()/onClick() is called, which the test has no handle
 *  on; the handler itself is what matters, so it's invoked directly rather than faked
 *  through an unrelated DOM event. */
function asTestable(tab: LocalFontsSettingTab): {
  commitRoleChange: (role: RoleName, value: string) => Promise<void>;
  commitHardOverride: (value: boolean) => Promise<void>;
} {
  return tab as unknown as {
    commitRoleChange: (role: RoleName, value: string) => Promise<void>;
    commitHardOverride: (value: boolean) => Promise<void>;
  };
}

const manifest: PluginManifest = {
  id: 'local-fonts',
  name: 'Local Fonts',
  author: 'test',
  version: '0.0.0-test',
  minAppVersion: '1.0.3',
  description: 'Test manifest',
};

describe('LocalFontsSettingTab', () => {
  let plugin: LocalFontsPlugin;
  let tab: LocalFontsSettingTab;

  beforeEach(async () => {
    const app = App.createConfigured__();
    plugin = new LocalFontsPlugin(app.asOriginalType__(), manifest);
    await plugin.onload();
    tab = new LocalFontsSettingTab(app.asOriginalType__(), plugin);
  });

  afterEach(() => {
    Platform.isIosApp = false;
  });

  it('renders exactly seven controls — folder, five roles, hard override', () => {
    tab.display();

    expect(tab.containerEl.querySelectorAll('.setting-item')).toHaveLength(7);
  });

  it('is idempotent, so reopening settings does not stack duplicate controls', () => {
    tab.display();
    tab.display();

    expect(tab.containerEl.querySelectorAll('.setting-item')).toHaveLength(7);
  });

  it('tells the user the folder is empty rather than showing nothing', () => {
    tab.display();

    const empty = tab.containerEl.querySelector('.local-fonts-empty');
    expect(empty?.textContent).toContain('No fonts found');
  });

  it('lists a discovered family with its weights', () => {
    plugin.settings.cache = {
      version: 1,
      folder: '.fonts',
      faces: [
        {
          path: '.fonts/a-400.woff2',
          format: 'woff2',
          size: 1,
          mtime: 1,
          family: 'Probe Sans',
          weight: 400,
          italic: false,
          colorFormats: [],
          scripts: ['latin', 'cyrillic'],
          axes: [],
          license: null,
          source: 'name-table',
        },
      ],
    };

    tab.display();

    const card = tab.containerEl.querySelector('.local-fonts-family');
    expect(card?.querySelector('summary')?.textContent).toBe('Probe Sans');
    expect(card?.querySelectorAll('.local-fonts-faces li')).toHaveLength(1);
    expect(card?.querySelector('.local-fonts-faces li')?.textContent).toContain('400');
    expect(card?.textContent).toContain('cyrillic');
  });

  it('warns when no face of a family can render on this engine', () => {
    plugin.settings.cache = {
      version: 1,
      folder: '.fonts',
      faces: [
        {
          path: '.fonts/emoji.woff2',
          format: 'woff2',
          size: 1,
          mtime: 1,
          family: 'Probe Emoji',
          weight: 400,
          italic: false,
          colorFormats: ['SVG'],
          scripts: ['emoji'],
          axes: [],
          license: null,
          source: 'name-table',
        },
      ],
    };

    tab.display();

    const card = tab.containerEl.querySelector('.local-fonts-family');
    expect(card?.querySelector('.local-fonts-warning')?.textContent).toContain('cannot render');
  });

  it('renders an SVG-colour face as usable on WebKit (iOS/iPadOS), unlike on Chromium', () => {
    Platform.isIosApp = true;
    plugin.settings.cache = {
      version: 1,
      folder: '.fonts',
      faces: [
        {
          path: '.fonts/emoji.woff2',
          format: 'woff2',
          size: 1,
          mtime: 1,
          family: 'Probe Emoji',
          weight: 400,
          italic: true,
          colorFormats: ['SVG'],
          scripts: ['emoji'],
          axes: [],
          license: null,
          source: 'name-table',
        },
      ],
    };

    tab.display();

    const card = tab.containerEl.querySelector('.local-fonts-family');
    expect(card?.querySelector('.local-fonts-warning')).toBeNull();
    expect(card?.querySelector('.local-fonts-faces li')?.textContent).toContain('italic');
    expect(card?.querySelector('.local-fonts-faces li')?.textContent).toContain(
      'selected on this platform',
    );
  });

  it('reports a missing regular weight and formats a large file in MB', () => {
    plugin.settings.cache = {
      version: 1,
      folder: '.fonts',
      faces: [
        {
          path: '.fonts/a-300.woff2',
          format: 'woff2',
          size: 2 * 1024 * 1024,
          mtime: 1,
          family: 'Probe Sans',
          weight: 300,
          italic: false,
          colorFormats: [],
          scripts: [],
          axes: [],
          license: null,
          source: 'name-table',
        },
      ],
    };

    tab.display();

    const card = tab.containerEl.querySelector('.local-fonts-family');
    expect(card?.textContent).toContain('no 400');
    expect(card?.querySelector('.local-fonts-faces li')?.textContent).toContain('2.0 MB');
  });

  it('shows which extraction level supplied the data, so guesses are visible', () => {
    plugin.settings.cache = {
      version: 1,
      folder: '.fonts',
      faces: [
        {
          path: '.fonts/mystery.woff2',
          format: 'woff2',
          size: 1,
          mtime: 1,
          family: 'Mystery',
          weight: 400,
          italic: false,
          colorFormats: [],
          scripts: [],
          axes: [],
          license: null,
          source: 'filename',
        },
      ],
    };

    tab.display();

    const card = tab.containerEl.querySelector('.local-fonts-family');
    expect(card?.querySelector('.local-fonts-source')?.textContent).toContain('filename');
  });

  it('lists every distinct extraction level when faces of a family disagree, in a stable order', () => {
    plugin.settings.cache = {
      version: 1,
      folder: '.fonts',
      faces: [
        {
          path: '.fonts/a-400.woff2',
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
          source: 'filename',
        },
        {
          path: '.fonts/a-700.woff2',
          format: 'woff2',
          size: 1,
          mtime: 1,
          family: 'Probe Sans',
          weight: 700,
          italic: false,
          colorFormats: [],
          scripts: [],
          axes: [],
          license: null,
          source: 'name-table',
        },
      ],
    };

    tab.display();

    const card = tab.containerEl.querySelector('.local-fonts-family');
    expect(card?.querySelector('.local-fonts-source')?.textContent).toBe(
      'Metadata from: filename, name-table',
    );
  });

  it('surfaces a file the scanner had to skip', () => {
    vi.spyOn(plugin, 'skippedFiles').mockReturnValue(['.fonts/broken.ttf']);

    tab.display();

    const warning = tab.containerEl.querySelector('.local-fonts-diagnostics .local-fonts-warning');
    expect(warning?.textContent).toContain('.fonts/broken.ttf');
  });

  it('surfaces a failed scan', () => {
    vi.spyOn(plugin, 'lastScanFailure').mockReturnValue('disk exploded');

    tab.display();

    const warning = tab.containerEl.querySelector('.local-fonts-diagnostics .local-fonts-warning');
    expect(warning?.textContent).toContain('disk exploded');
  });

  it('sorts families alphabetically regardless of scan order', () => {
    plugin.settings.cache = {
      version: 1,
      folder: '.fonts',
      faces: [
        {
          path: '.fonts/z.woff2',
          format: 'woff2',
          size: 1,
          mtime: 1,
          family: 'Zebra',
          weight: 400,
          italic: false,
          colorFormats: [],
          scripts: [],
          axes: [],
          license: null,
          source: 'name-table',
        },
        {
          path: '.fonts/a.woff2',
          format: 'woff2',
          size: 1,
          mtime: 1,
          family: 'Anteater',
          weight: 400,
          italic: false,
          colorFormats: [],
          scripts: [],
          axes: [],
          license: 'OFL-1.1',
          source: 'name-table',
        },
      ],
    };

    tab.display();

    const options = Array.from(
      tab.containerEl.querySelectorAll('select')[0]?.querySelectorAll('option') ?? [],
    );
    expect(options.map((o) => o.value)).toStrictEqual(['', 'Anteater', 'Zebra']);
    const cards = tab.containerEl.querySelectorAll('.local-fonts-family');
    expect(cards[0]?.querySelector('.local-fonts-licence')?.textContent).toBe('OFL-1.1');
  });

  it('saves and applies the chosen family when a role changes', async () => {
    const saveSettings = vi.spyOn(plugin, 'saveSettings').mockResolvedValue();
    const applyFonts = vi.spyOn(plugin, 'applyFonts').mockImplementation(() => undefined);
    tab.display();

    await asTestable(tab).commitRoleChange('text', 'Probe Sans');

    expect(plugin.settings.roles.text).toBe('Probe Sans');
    expect(saveSettings).toHaveBeenCalled();
    expect(applyFonts).toHaveBeenCalled();
  });

  it('clears the role when "leave the theme alone" is chosen', async () => {
    plugin.settings.roles.text = 'Probe Sans';
    vi.spyOn(plugin, 'saveSettings').mockResolvedValue();
    vi.spyOn(plugin, 'applyFonts').mockImplementation(() => undefined);
    tab.display();

    await asTestable(tab).commitRoleChange('text', '');

    expect(plugin.settings.roles.text).toBeNull();
  });

  it('saves and applies hardOverride when the toggle changes', async () => {
    const saveSettings = vi.spyOn(plugin, 'saveSettings').mockResolvedValue();
    const applyFonts = vi.spyOn(plugin, 'applyFonts').mockImplementation(() => undefined);
    tab.display();

    await asTestable(tab).commitHardOverride(true);

    expect(plugin.settings.hardOverride).toBe(true);
    expect(saveSettings).toHaveBeenCalled();
    expect(applyFonts).toHaveBeenCalled();
  });

  describe('the Check button', () => {
    // isFamilyApplied measures real font-rendered pixel widths; jsdom never actually
    // rasterises fonts, so measured widths never differ and it always reports "not
    // applied". Mocking it here is the only way to exercise the "rendering" branch.
    afterEach(() => {
      vi.doUnmock('./fonts/probe.js');
      vi.resetModules();
    });

    it('reports a role as rendering when the probe says it applied', async () => {
      vi.resetModules();
      vi.doMock('./fonts/probe.js', () => ({ isFamilyApplied: () => true }));
      const { LocalFontsSettingTab: MockedTab } = await import('./settings-tab.js');
      const mockedTab = new MockedTab(tab.app, plugin);
      plugin.settings.cache = {
        version: 1,
        folder: '.fonts',
        faces: [
          {
            path: '.fonts/a-400.woff2',
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
      };
      plugin.settings.roles.text = 'Probe Sans';
      mockedTab.display();

      const button = Array.from(mockedTab.containerEl.querySelectorAll('button')).find(
        (b) => b.textContent === 'Check',
      );
      button?.click();

      const results = mockedTab.containerEl.querySelector('.local-fonts-check-results');
      expect(results?.textContent).toContain('Text: Probe Sans — rendering');
    });

    it('reports whether each assigned role is actually rendering', () => {
      plugin.settings.cache = {
        version: 1,
        folder: '.fonts',
        faces: [
          {
            path: '.fonts/a-400.woff2',
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
      };
      plugin.settings.roles.text = 'Probe Sans';
      tab.display();

      const button = Array.from(tab.containerEl.querySelectorAll('button')).find(
        (b) => b.textContent === 'Check',
      );
      button?.click();

      const results = tab.containerEl.querySelector('.local-fonts-check-results');
      expect(results?.textContent).toContain('Text: Probe Sans');
    });

    it('clears previous results on a second click rather than appending', () => {
      plugin.settings.cache = {
        version: 1,
        folder: '.fonts',
        faces: [
          {
            path: '.fonts/a-400.woff2',
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
      };
      plugin.settings.roles.text = 'Probe Sans';
      tab.display();

      const button = Array.from(tab.containerEl.querySelectorAll('button')).find(
        (b) => b.textContent === 'Check',
      );
      button?.click();
      button?.click();

      const results = tab.containerEl.querySelector('.local-fonts-check-results');
      expect(results?.querySelectorAll('p')).toHaveLength(1);
    });
  });

  describe('the folder field', () => {
    it('commits and rescans once, on blur, rather than on every keystroke', async () => {
      const rescan = vi.spyOn(plugin, 'rescan').mockResolvedValue();
      tab.display();

      const input = tab.containerEl.querySelector('input') as HTMLInputElement;
      input.value = '.f';
      input.dispatchEvent(new Event('input'));
      input.value = '.fonts2';
      input.dispatchEvent(new Event('input'));
      expect(rescan).not.toHaveBeenCalled();

      input.dispatchEvent(new FocusEvent('blur'));
      await vi.waitFor(() => {
        expect(rescan).toHaveBeenCalledTimes(1);
      });
      expect(plugin.settings.folder).toBe('.fonts2');
    });

    it('does not rescan on blur when the folder was not actually changed', async () => {
      const rescan = vi.spyOn(plugin, 'rescan').mockResolvedValue();
      tab.display();

      const input = tab.containerEl.querySelector('input') as HTMLInputElement;
      input.dispatchEvent(new FocusEvent('blur'));
      // Give the (unwanted) async commit a turn to run before asserting it didn't.
      await Promise.resolve();
      await Promise.resolve();

      expect(rescan).not.toHaveBeenCalled();
    });

    it('logs rather than throws when committing the new folder fails', async () => {
      vi.spyOn(plugin, 'rescan').mockRejectedValue(new Error('scan blew up'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      tab.display();

      const input = tab.containerEl.querySelector('input') as HTMLInputElement;
      input.value = '.fonts2';
      input.dispatchEvent(new FocusEvent('blur'));

      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalled();
      });
    });
  });
});
