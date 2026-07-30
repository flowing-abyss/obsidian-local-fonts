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
    Platform.isAndroidApp = false;
    Platform.isLinux = false;
    Platform.isWin = true;
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
      version: 2,
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
      version: 2,
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
      version: 2,
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
    expect(card?.querySelector('.local-fonts-face-colour')?.textContent).toContain('supported');
    expect(card?.querySelector('.local-fonts-face-verdict')?.textContent).toContain('selected');
  });

  it('reports a missing regular weight and formats a large file in MB', () => {
    plugin.settings.cache = {
      version: 2,
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

  it('marks a guessed value as guessed, distinctly from a parsed one', () => {
    plugin.settings.cache = {
      version: 2,
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

    const source = tab.containerEl.querySelector('.local-fonts-face-source');
    expect(source?.textContent).toContain('guessed from filename');
    expect(source?.classList.contains('local-fonts-face-source-guessed')).toBe(true);
  });

  it('attaches the metadata source per face, so a mixed family does not hide which face was guessed', () => {
    plugin.settings.cache = {
      version: 2,
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

    const rows = tab.containerEl.querySelectorAll('.local-fonts-faces li');
    expect(rows[0]?.querySelector('.local-fonts-face-source')?.textContent).toContain(
      'guessed from filename',
    );
    expect(
      rows[0]
        ?.querySelector('.local-fonts-face-source')
        ?.classList.contains('local-fonts-face-source-guessed'),
    ).toBe(true);
    expect(rows[1]?.querySelector('.local-fonts-face-source')?.textContent).toContain(
      'parsed from name-table',
    );
    expect(
      rows[1]
        ?.querySelector('.local-fonts-face-source')
        ?.classList.contains('local-fonts-face-source-guessed'),
    ).toBe(false);
  });

  it('renders non-empty variable axes with tag, range and default', () => {
    plugin.settings.cache = {
      version: 2,
      folder: '.fonts',
      faces: [
        {
          path: '.fonts/a-var.woff2',
          format: 'woff2',
          size: 1,
          mtime: 1,
          family: 'Probe Variable',
          weight: 400,
          italic: false,
          colorFormats: [],
          scripts: [],
          axes: [{ tag: 'wght', min: 100, max: 900, default: 400 }],
          license: null,
          source: 'name-table',
        },
      ],
    };

    tab.display();

    const axes = tab.containerEl.querySelector('.local-fonts-face-axes');
    expect(axes?.textContent).toContain('wght 100–900 (default 400)');
  });

  it('omits the axes element entirely for a static face', () => {
    plugin.settings.cache = {
      version: 2,
      folder: '.fonts',
      faces: [
        {
          path: '.fonts/a-static.woff2',
          format: 'woff2',
          size: 1,
          mtime: 1,
          family: 'Probe Static',
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

    tab.display();

    expect(tab.containerEl.querySelector('.local-fonts-face-axes')).toBeNull();
  });

  it('gives the winner a reason and the loser a matching one, for genuinely competing faces', () => {
    plugin.settings.cache = {
      version: 2,
      folder: '.fonts',
      faces: [
        {
          path: '.fonts/a.ttf',
          format: 'ttf',
          size: 100,
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
        {
          path: '.fonts/a.woff2',
          format: 'woff2',
          size: 100,
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

    tab.display();

    const rows = tab.containerEl.querySelectorAll('.local-fonts-faces li');
    // Faces are rendered in scan order (ttf, then woff2); woff2 wins on format rank.
    expect(rows[0]?.querySelector('.local-fonts-face-verdict')?.textContent).toBe(
      ' — not selected (preferred format)',
    );
    expect(rows[1]?.querySelector('.local-fonts-face-verdict')?.textContent).toBe(
      ' — selected (preferred format)',
    );
  });

  it('gives a "smaller file" reason when two competing faces share a format', () => {
    plugin.settings.cache = {
      version: 2,
      folder: '.fonts',
      faces: [
        {
          path: '.fonts/a-big.woff2',
          format: 'woff2',
          size: 2000,
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
        {
          path: '.fonts/a-small.woff2',
          format: 'woff2',
          size: 1000,
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

    tab.display();

    const rows = tab.containerEl.querySelectorAll('.local-fonts-faces li');
    expect(rows[0]?.querySelector('.local-fonts-face-verdict')?.textContent).toBe(
      ' — not selected (smaller file)',
    );
    expect(rows[1]?.querySelector('.local-fonts-face-verdict')?.textContent).toBe(
      ' — selected (smaller file)',
    );
  });

  it('gives a "tie-break" reason when format and size are both tied', () => {
    plugin.settings.cache = {
      version: 2,
      folder: '.fonts',
      faces: [
        {
          path: '.fonts/zzz.woff2',
          format: 'woff2',
          size: 500,
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
        {
          path: '.fonts/aaa.woff2',
          format: 'woff2',
          size: 500,
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

    tab.display();

    const rows = tab.containerEl.querySelectorAll('.local-fonts-faces li');
    expect(rows[0]?.querySelector('.local-fonts-face-verdict')?.textContent).toBe(
      ' — not selected (tie-break)',
    );
    expect(rows[1]?.querySelector('.local-fonts-face-verdict')?.textContent).toBe(
      ' — selected (tie-break)',
    );
  });

  it('shows a per-face unsupported-colour verdict even when the family has a usable face', () => {
    plugin.settings.cache = {
      version: 2,
      folder: '.fonts',
      faces: [
        {
          path: '.fonts/emoji.woff2',
          format: 'woff2',
          size: 100,
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
        {
          path: '.fonts/emoji.ttf',
          format: 'ttf',
          size: 200,
          mtime: 1,
          family: 'Probe Emoji',
          weight: 400,
          italic: false,
          colorFormats: ['SVG', 'COLR1'],
          scripts: ['emoji'],
          axes: [],
          license: null,
          source: 'name-table',
        },
      ],
    };

    tab.display();

    // The family as a whole is fine (the ttf can render), so no family-level warning —
    // but the woff2 face specifically cannot draw its colour format on Chromium, and
    // that must still be visible per-face.
    const card = tab.containerEl.querySelector('.local-fonts-family');
    expect(card?.querySelector('.local-fonts-warning')).toBeNull();
    const rows = tab.containerEl.querySelectorAll('.local-fonts-faces li');
    expect(rows[0]?.querySelector('.local-fonts-face-colour')?.textContent).toContain(
      'unsupported',
    );
    expect(rows[1]?.querySelector('.local-fonts-face-colour')?.textContent).toContain('supported');
    expect(rows[1]?.querySelector('.local-fonts-face-verdict')?.textContent).toContain('selected');
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

  describe('weight chips', () => {
    it('shows one chip per distinct weight present', () => {
      plugin.settings.cache = {
        version: 2,
        folder: '.fonts',
        faces: [
          {
            path: '.fonts/a-300.woff2',
            format: 'woff2',
            size: 1,
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
      const chips = Array.from(card?.querySelectorAll('.local-fonts-weight-chip') ?? []);
      const presentChips = chips.filter(
        (c) => !c.classList.contains('local-fonts-weight-chip-missing'),
      );
      expect(presentChips.map((c) => c.textContent)).toStrictEqual(['300', '700']);
    });

    it('adds a distinctly-styled "missing" chip when 400 is absent', () => {
      plugin.settings.cache = {
        version: 2,
        folder: '.fonts',
        faces: [
          {
            path: '.fonts/a-300.woff2',
            format: 'woff2',
            size: 1,
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
      const missing = card?.querySelector('.local-fonts-weight-chip-missing');
      expect(missing?.textContent).toContain('400');
    });

    it('omits the "missing" chip when 400 is present', () => {
      plugin.settings.cache = {
        version: 2,
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

      tab.display();

      const card = tab.containerEl.querySelector('.local-fonts-family');
      expect(card?.querySelector('.local-fonts-weight-chip-missing')).toBeNull();
    });
  });

  describe('font sample preview', () => {
    function withCache(): void {
      plugin.settings.cache = {
        version: 2,
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
    }

    it('renders no sample at all while the card is collapsed', () => {
      withCache();

      tab.display();

      expect(tab.containerEl.querySelector('.local-fonts-sample')).toBeNull();
    });

    it('renders the sample, styled in the real family, once the card is expanded', async () => {
      withCache();
      tab.display();

      const card = tab.containerEl.querySelector('.local-fonts-family') as HTMLDetailsElement;
      const summary = card.querySelector('summary');
      summary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      // The `toggle` event is dispatched as a queued task per the HTML spec, not
      // synchronously with the click that flips `.open` — it needs a turn to fire.
      await vi.waitFor(() => {
        expect(tab.containerEl.querySelector('.local-fonts-sample')).not.toBeNull();
      });
      const sample = tab.containerEl.querySelector<HTMLElement>('.local-fonts-sample');
      expect(sample?.style.fontFamily).toContain('Probe Sans');
    });

    it('does not create a second sample element on repeated expand/collapse', async () => {
      withCache();
      tab.display();

      const card = tab.containerEl.querySelector('.local-fonts-family') as HTMLDetailsElement;
      const summary = card.querySelector('summary');
      summary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await vi.waitFor(() => {
        expect(tab.containerEl.querySelector('.local-fonts-sample')).not.toBeNull();
      });
      summary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      summary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));

      expect(tab.containerEl.querySelectorAll('.local-fonts-sample')).toHaveLength(1);
    });
  });

  describe('per-OS support badges', () => {
    it('shows all five OS pills, in order, all supported for a plain font', () => {
      plugin.settings.cache = {
        version: 2,
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

      tab.display();

      const card = tab.containerEl.querySelector('.local-fonts-family');
      const badges = card?.querySelectorAll('.local-fonts-os-badge');
      expect(badges).toHaveLength(5);
      expect(Array.from(badges ?? []).map((b) => b.textContent.trim())).toStrictEqual([
        expect.stringContaining('macOS'),
        expect.stringContaining('Windows'),
        expect.stringContaining('Linux'),
        expect.stringContaining('Android'),
        expect.stringContaining('iOS'),
      ]);
      for (const badge of Array.from(badges ?? [])) {
        expect(badge.classList.contains('local-fonts-os-supported')).toBe(true);
        expect(badge.classList.contains('local-fonts-os-unsupported')).toBe(false);
      }
    });

    it('marks Chromium OSes unsupported and iOS supported for an SVG-only colour font', () => {
      plugin.settings.cache = {
        version: 2,
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
      const badges = Array.from(card?.querySelectorAll('.local-fonts-os-badge') ?? []);
      const byLabel = new Map(badges.map((b) => [b.getAttribute('data-os'), b] as const));

      for (const os of ['macos', 'windows', 'linux', 'android']) {
        const badge = byLabel.get(os);
        expect(badge?.classList.contains('local-fonts-os-unsupported')).toBe(true);
        expect(badge?.classList.contains('local-fonts-os-supported')).toBe(false);
      }
      const ios = byLabel.get('ios');
      expect(ios?.classList.contains('local-fonts-os-supported')).toBe(true);
    });

    it('conveys support state with a text or glyph cue, not colour alone', () => {
      plugin.settings.cache = {
        version: 2,
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
      const badges = Array.from(card?.querySelectorAll('.local-fonts-os-badge') ?? []);
      const byLabel = new Map(badges.map((b) => [b.getAttribute('data-os'), b] as const));

      // The supported and unsupported pills must differ in their text content, not just
      // in a CSS class — a colour-blind user reading only the text must be able to tell.
      const supportedText = byLabel.get('ios')?.textContent ?? '';
      const unsupportedText = byLabel.get('macos')?.textContent ?? '';
      expect(supportedText).not.toBe(unsupportedText.replace('macOS', 'iOS'));
      expect(supportedText).toMatch(/✓|supported/i);
      expect(unsupportedText).toMatch(/✕|✗|unsupported|not supported/i);
    });

    it("marks the family's home OS badge as the user's current platform, distinctly from a colour", () => {
      // The test-mock Platform defaults to isWin: true.
      plugin.settings.cache = {
        version: 2,
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

      tab.display();

      const card = tab.containerEl.querySelector('.local-fonts-family');
      const badges = Array.from(card?.querySelectorAll('.local-fonts-os-badge') ?? []);
      const byLabel = new Map(badges.map((b) => [b.getAttribute('data-os'), b] as const));

      expect(byLabel.get('windows')?.classList.contains('local-fonts-os-current')).toBe(true);
      for (const os of ['macos', 'linux', 'android', 'ios']) {
        expect(byLabel.get(os)?.classList.contains('local-fonts-os-current')).toBe(false);
      }
      // The marker must be discoverable from more than a class name alone (e.g. a
      // title/aria attribute or distinguishing text), since "not a second colour" was
      // the whole point.
      const marker =
        byLabel.get('windows')?.getAttribute('title') ??
        byLabel.get('windows')?.getAttribute('aria-label') ??
        '';
      expect(marker.length).toBeGreaterThan(0);
    });

    it('marks iOS as current when Platform.isIosApp is true', () => {
      Platform.isIosApp = true;
      plugin.settings.cache = {
        version: 2,
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

      tab.display();

      const card = tab.containerEl.querySelector('.local-fonts-family');
      const badges = Array.from(card?.querySelectorAll('.local-fonts-os-badge') ?? []);
      const byLabel = new Map(badges.map((b) => [b.getAttribute('data-os'), b] as const));

      expect(byLabel.get('ios')?.classList.contains('local-fonts-os-current')).toBe(true);
      expect(byLabel.get('windows')?.classList.contains('local-fonts-os-current')).toBe(false);
    });

    it('marks Android as current when Platform.isAndroidApp is true', () => {
      Platform.isAndroidApp = true;
      plugin.settings.cache = {
        version: 2,
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

      tab.display();

      const card = tab.containerEl.querySelector('.local-fonts-family');
      const badges = Array.from(card?.querySelectorAll('.local-fonts-os-badge') ?? []);
      const byLabel = new Map(badges.map((b) => [b.getAttribute('data-os'), b] as const));

      expect(byLabel.get('android')?.classList.contains('local-fonts-os-current')).toBe(true);
      expect(byLabel.get('windows')?.classList.contains('local-fonts-os-current')).toBe(false);
    });

    it('marks Linux as current when Platform.isWin is false and Platform.isLinux is true', () => {
      Platform.isWin = false;
      Platform.isLinux = true;
      plugin.settings.cache = {
        version: 2,
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

      tab.display();

      const card = tab.containerEl.querySelector('.local-fonts-family');
      const badges = Array.from(card?.querySelectorAll('.local-fonts-os-badge') ?? []);
      const byLabel = new Map(badges.map((b) => [b.getAttribute('data-os'), b] as const));

      expect(byLabel.get('linux')?.classList.contains('local-fonts-os-current')).toBe(true);
    });
  });

  it('sorts families alphabetically regardless of scan order', () => {
    plugin.settings.cache = {
      version: 2,
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
        version: 2,
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
      await vi.waitFor(() => {
        expect(results?.textContent).toContain('Text: Probe Sans — rendering');
      });
    });

    it('reports whether each assigned role is actually rendering', async () => {
      plugin.settings.cache = {
        version: 2,
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
      await vi.waitFor(() => {
        expect(results?.textContent).toContain('Text: Probe Sans');
      });
    });

    it('clears previous results on a second click rather than appending', async () => {
      plugin.settings.cache = {
        version: 2,
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
      const results = tab.containerEl.querySelector('.local-fonts-check-results');

      button?.click();
      await vi.waitFor(() => {
        expect(results?.querySelectorAll('p')).toHaveLength(1);
      });

      button?.click();
      await vi.waitFor(() => {
        expect(results?.querySelectorAll('p')).toHaveLength(1);
      });
    });

    it('ignores a click while a check is already in flight, rather than racing two runs', async () => {
      // runCheck awaits document.fonts.load per role before measuring; a second click
      // before the first run settles could otherwise interleave two runs' DOM writes —
      // the second run's results.empty() landing after the first run has already
      // started appending rows, leaving rows from both runs behind.
      plugin.settings.cache = {
        version: 2,
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
      const results = tab.containerEl.querySelector('.local-fonts-check-results');

      button?.click();
      button?.click();

      await vi.waitFor(() => {
        expect(results?.querySelectorAll('p')).toHaveLength(1);
      });
      // Give any wrongly-scheduled second run a turn to (mis)fire before asserting
      // the count stays put.
      await Promise.resolve();
      await Promise.resolve();
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

  describe('the Emoji role dropdown', () => {
    it('lists only families with at least one colour-glyph face', () => {
      plugin.settings.cache = {
        version: 2,
        folder: '.fonts',
        faces: [
          {
            path: '.fonts/ibm-plex-serif/thin.woff2',
            format: 'woff2',
            size: 1,
            mtime: 1,
            family: 'IBM Plex Serif',
            weight: 100,
            italic: false,
            colorFormats: [],
            scripts: [],
            axes: [],
            license: null,
            source: 'name-table',
          },
          {
            path: '.fonts/probe-emoji/probe-emoji.woff2',
            format: 'woff2',
            size: 1,
            mtime: 1,
            family: 'Probe Emoji',
            weight: 400,
            italic: false,
            colorFormats: ['COLR0'],
            scripts: ['emoji'],
            axes: [],
            license: null,
            source: 'name-table',
          },
        ],
      };

      tab.display();

      const selects = tab.containerEl.querySelectorAll('select');
      // ROLES order is text, interface, monospace, headings, emoji — the 5th select
      // is the Emoji role's dropdown.
      const emojiOptions = Array.from(selects[4]?.querySelectorAll('option') ?? []).map(
        (o) => o.value,
      );
      const textOptions = Array.from(selects[0]?.querySelectorAll('option') ?? []).map(
        (o) => o.value,
      );

      expect(emojiOptions).toStrictEqual(['', 'Probe Emoji']);
      // Every other role must still list every family, colour or not.
      expect(textOptions).toStrictEqual(['', 'IBM Plex Serif', 'Probe Emoji']);
    });

    it('does not use the emoji script probe as a substitute for real colour-glyph detection', () => {
      // The emoji script probe covers U+2600-26FF (miscellaneous symbols), which an
      // ordinary text font can also claim — scripts.includes('emoji') would let a
      // ordinary text font into the Emoji dropdown, which is exactly the bug.
      plugin.settings.cache = {
        version: 2,
        folder: '.fonts',
        faces: [
          {
            path: '.fonts/ibm-plex-serif/thin.woff2',
            format: 'woff2',
            size: 1,
            mtime: 1,
            family: 'IBM Plex Serif',
            weight: 100,
            italic: false,
            colorFormats: [],
            scripts: ['emoji'],
            axes: [],
            license: null,
            source: 'name-table',
          },
        ],
      };

      tab.display();

      const selects = tab.containerEl.querySelectorAll('select');
      const emojiOptions = Array.from(selects[4]?.querySelectorAll('option') ?? []).map(
        (o) => o.value,
      );

      expect(emojiOptions).toStrictEqual(['']);
    });

    it('still renders "leave the theme alone" and says plainly when no colour-emoji font was found', () => {
      plugin.settings.cache = {
        version: 2,
        folder: '.fonts',
        faces: [
          {
            path: '.fonts/ibm-plex-serif/thin.woff2',
            format: 'woff2',
            size: 1,
            mtime: 1,
            family: 'IBM Plex Serif',
            weight: 100,
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

      const selects = tab.containerEl.querySelectorAll('select');
      const emojiOptions = Array.from(selects[4]?.querySelectorAll('option') ?? []).map(
        (o) => o.value,
      );
      expect(emojiOptions).toStrictEqual(['']);

      const emojiControl = tab.containerEl.querySelectorAll('.setting-item')[5];
      expect(emojiControl?.textContent).toContain('No colour-emoji font found');
    });
  });
});
