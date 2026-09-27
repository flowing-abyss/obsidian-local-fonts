import {
  Platform,
  Setting,
  type PluginManifest,
  type SettingDefinitionItem,
  type SettingGroup,
} from 'obsidian';
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

  /**
   * Take the tab down the pre-1.13 `display()` re-render path. The mock's base class
   * always carries an `update()` method, unlike real Obsidian before 1.13, and its
   * `update()` does nothing — so a re-render routed through it is invisible to a test
   * that reads the rendered DOM or counts what the render did.
   */
  function withoutUpdateApi(): void {
    (tab as unknown as { update: (() => void) | undefined }).update = undefined;
  }

  /**
   * One full turn of the macrotask queue, which drains every microtask queued before it.
   * The refresh a render kicks off is deliberately not awaited by the render, so a test
   * that wants to see its effect has to let the whole promise chain — the scan, its
   * `.then`, the re-render inside it and the `.finally` that clears the in-flight flag —
   * run to completion first. `vi.waitFor` is not a substitute: it can resolve while that
   * flag is still held, which silently turns off the very guard a test is measuring.
   */
  async function settle(): Promise<void> {
    await new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
  }

  afterEach(() => {
    Platform.isIosApp = false;
    Platform.isAndroidApp = false;
    Platform.isLinux = false;
    Platform.isWin = true;
  });

  it('renders exactly seven controls — folder, five roles, hard override', () => {
    tab.display();

    expect(
      tab.containerEl.querySelectorAll('.setting-item:not(.setting-item-heading)'),
    ).toHaveLength(7);
  });

  it('is idempotent, so reopening settings does not stack duplicate controls', () => {
    tab.display();
    tab.display();

    expect(
      tab.containerEl.querySelectorAll('.setting-item:not(.setting-item-heading)'),
    ).toHaveLength(7);
  });

  it('renders the diagnostics heading as a Setting heading, not a raw element', () => {
    tab.display();

    const heading = tab.containerEl.querySelector('.setting-item-heading');
    expect(heading?.textContent).toContain('Fonts found');
    // A heading is not one of the seven controls the test above counts.
    expect(heading?.classList.contains('setting-item')).toBe(false);
  });

  it('warns when the families shown were never confirmed against this device', () => {
    // The Sync case: data.json arrives with the cache, the dot-folder never does.
    vi.spyOn(plugin, 'unverifiedCache').mockReturnValue(
      'No font files were found in .fonts, so the families below come from the last successful scan and may not exist on this device.',
    );

    tab.display();

    // Scoped to the diagnostics section: the default folder ('.fonts') now also carries
    // its own dot-prefix warning next to the folder field, so an unscoped query could
    // match that one instead. Rendered first within diagnostics, ahead of any per-family
    // warning.
    const warning = tab.containerEl
      .querySelector('.local-fonts-diagnostics')
      ?.querySelector('.local-fonts-warning');
    expect(warning?.textContent).toContain('may not exist on this device');
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

  // Everything else on this tab reads the cache, so it keeps looking healthy while not
  // one font is being applied. This is the only place that failure becomes visible to
  // somebody who is never going to open the developer console.
  it('says so when the stylesheet the fonts are written into was never found', () => {
    vi.spyOn(plugin, 'stylesheetMissing').mockReturnValue(true);

    tab.display();

    const warning = tab.containerEl.querySelector('.local-fonts-diagnostics .local-fonts-warning');
    expect(warning?.textContent).toContain('stylesheet was not found');
  });

  it('says nothing about the stylesheet when it was found, which is every normal run', () => {
    tab.display();

    const warnings = Array.from(
      tab.containerEl.querySelectorAll('.local-fonts-diagnostics .local-fonts-warning'),
    );
    expect(warnings.some((el) => el.textContent.includes('stylesheet was not found'))).toBe(false);
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
      expect(unsupportedText).toMatch(/×|✕|✗|unsupported|not supported/i);
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

  for (const path of ['legacy', 'declarative'] as const)
    it(`applies a ${path} role change while persistence is still pending`, async () => {
      let finishSave = (): void => {};
      const pendingSave = new Promise<void>((resolve) => {
        finishSave = resolve;
      });
      vi.spyOn(plugin, 'saveSettings').mockReturnValue(pendingSave);
      const applyFonts = vi.spyOn(plugin, 'applyFonts').mockImplementation(() => undefined);
      const commit =
        path === 'legacy'
          ? asTestable(tab).commitRoleChange('emoji', 'Probe Emoji')
          : tab.setControlValue('role:emoji', 'Probe Emoji');
      try {
        expect(plugin.settings.roles.emoji).toBe('Probe Emoji');
        expect(applyFonts).toHaveBeenCalledOnce();
      } finally {
        finishSave();
        await commit;
      }
    });

  it('keeps role persistence failures visible after applying the in-memory selection', async () => {
    vi.spyOn(plugin, 'saveSettings').mockRejectedValue(new Error('settings write failed'));
    const applyFonts = vi.spyOn(plugin, 'applyFonts').mockImplementation(() => undefined);
    await expect(asTestable(tab).commitRoleChange('text', 'Probe Sans')).rejects.toThrow(
      'settings write failed',
    );
    expect(applyFonts).toHaveBeenCalledOnce();
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
    beforeEach(() => {
      document.body.appendChild(tab.containerEl);
    });

    const face = (family: string, colorFormats: Array<'COLR1'> = []) => ({
      path: `.fonts/${family}.woff2`,
      format: 'woff2' as const,
      size: 1,
      mtime: 1,
      family,
      weight: 400,
      italic: false,
      colorFormats,
      scripts: [],
      axes: [],
      license: null,
      source: 'name-table' as const,
    });

    afterEach(() => {
      Reflect.deleteProperty(document, 'fonts');
      document.body.empty();
      vi.restoreAllMocks();
    });

    it('reports loading and requested stacks for Text plus Emoji', async () => {
      plugin.settings.cache = {
        version: 2,
        folder: '.fonts',
        faces: [face('Role Text'), face('Role Emoji', ['COLR1'])],
      };
      plugin.settings.roles.text = 'Role Text';
      plugin.settings.roles.emoji = 'Role Emoji';
      const preview = document.body.createDiv({ cls: 'markdown-preview-view' });
      preview.createEl('p', { text: 'Body' }).setCssStyles({
        fontFamily: '"__local-fonts-emoji__", "Role Text", sans-serif',
      });
      document.body.createDiv({ cls: 'setting-item-name', text: 'Name' }).setCssStyles({
        fontFamily: '"__local-fonts-emoji__", "Role Baseline"',
      });
      vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({
        length: 1,
      } as DOMRectList);
      const load = vi.fn().mockResolvedValue([{}]);
      Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
      tab.display();
      const button = Array.from(tab.containerEl.querySelectorAll('button')).find(
        (item) => item.textContent === 'Check',
      );
      button?.click();
      await vi.waitFor(() => {
        const text = tab.containerEl.querySelector('.local-fonts-check-results')?.textContent ?? '';
        expect(text).toContain('Text: Role Text — Local font loaded');
        expect(text).toContain('Reading text: Selected font is first in the checked stack');
        expect(text).toContain('Emoji: Role Emoji — Local font loaded');
        expect(text).toContain('Settings label: Selected font is first in the checked stack');
      });
      expect(load).toHaveBeenCalledWith("64px 'Role Text'", 'ABCАБя0123');
      expect(load).toHaveBeenCalledWith("64px '__local-fonts-emoji__'", '😀');
    });

    it('reports precedence and no matching surface separately from loading', async () => {
      plugin.settings.cache = {
        version: 2,
        folder: '.fonts',
        faces: [face('Role Text'), face('Role Mono')],
      };
      plugin.settings.roles.text = 'Role Text';
      plugin.settings.roles.monospace = 'Role Mono';
      document.body
        .createDiv({ cls: 'markdown-preview-view' })
        .createEl('p', { text: 'Body' })
        .setCssStyles({
          fontFamily: 'Role Baseline, Role Text',
        });
      vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({
        length: 1,
      } as DOMRectList);
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { load: vi.fn().mockResolvedValue([{}]) },
      });
      tab.display();
      Array.from(tab.containerEl.querySelectorAll('button'))
        .find((item) => item.textContent === 'Check')
        ?.click();
      await vi.waitFor(() => {
        const text = tab.containerEl.querySelector('.local-fonts-check-results')?.textContent ?? '';
        expect(text).toContain('Text: Role Text — Local font loaded');
        expect(text).toContain('Reading text: Another font is listed first here');
        expect(text).toContain('Monospace: Role Mono — Local font loaded');
        expect(text).toContain('No matching open surface to check');
      });
    });

    it('uses the displayed results ownerDocument for loading and computed stacks', async () => {
      plugin.settings.cache = { version: 2, folder: '.fonts', faces: [face('Role Text')] };
      plugin.settings.roles.text = 'Role Text';
      tab.display();
      const frame = document.body.createEl('iframe');
      const other = frame.contentDocument;
      if (other === null) throw new Error('No iframe document');
      const view = document.body.createDiv({ cls: 'markdown-preview-view' });
      view.createEl('p', { text: 'Body' }).setCssStyles({ fontFamily: 'Role Text' });
      other.body.appendChild(view);
      const results = tab.containerEl.querySelector<HTMLElement>('.local-fonts-check-results');
      if (results === null) throw new Error('No results');
      other.body.appendChild(results);
      const load = vi.fn().mockResolvedValue([{}]);
      Object.defineProperty(other, 'fonts', { configurable: true, value: { load } });
      if (other.defaultView === null) throw new Error('No iframe window');
      vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({
        length: 1,
      } as DOMRectList);
      await (tab as unknown as { runCheck(results: HTMLElement): Promise<void> }).runCheck(results);
      expect(load).toHaveBeenCalledWith("64px 'Role Text'", 'ABCАБя0123');
      expect(results.textContent).toContain(
        'Reading text: Selected font is first in the checked stack',
      );
      frame.remove();
    });

    it('stops a pending Check after display rerenders and detaches its results ancestor', async () => {
      plugin.settings.cache = {
        version: 2,
        folder: '.fonts',
        faces: [face('Role Text'), face('Role Emoji', ['COLR1'])],
      };
      plugin.settings.roles.text = 'Role Text';
      plugin.settings.roles.emoji = 'Role Emoji';
      tab.display();
      const results = tab.containerEl.querySelector<HTMLElement>('.local-fonts-check-results');
      if (results === null) throw new Error('No results');
      let resolveLoad: (faces: object[]) => void = () => {};
      const load = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<object[]>((resolve) => {
              resolveLoad = resolve;
            }),
        )
        .mockResolvedValue([{}]);
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { load },
      });
      const pending = (
        tab as unknown as { runCheck(results: HTMLElement): Promise<void> }
      ).runCheck(results);
      tab.display();
      expect(results.parentElement).not.toBeNull();
      expect(results.isConnected).toBe(false);
      resolveLoad([{}]);
      await pending;
      expect(results.textContent).not.toContain('Text:');
      expect(load).toHaveBeenCalledTimes(1);
    });

    it('ignores an overlapping Check click and replaces completed results on a later click', async () => {
      plugin.settings.cache = { version: 2, folder: '.fonts', faces: [face('Role Text')] };
      plugin.settings.roles.text = 'Role Text';
      tab.display();
      const button = Array.from(tab.containerEl.querySelectorAll('button')).find(
        (item) => item.textContent === 'Check',
      );
      const results = tab.containerEl.querySelector<HTMLElement>('.local-fonts-check-results');
      if (results === null) throw new Error('No results');
      let resolveLoad: (faces: object[]) => void = () => {};
      const load = vi.fn().mockImplementation(
        () =>
          new Promise<object[]>((resolve) => {
            resolveLoad = resolve;
          }),
      );
      Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
      button?.click();
      button?.click();
      expect(load).toHaveBeenCalledTimes(1);
      resolveLoad([{}]);
      await vi.waitFor(() => {
        expect(results.textContent).toContain('Text: Role Text — Local font loaded');
      });
      expect(results.querySelectorAll('.local-fonts-check-role')).toHaveLength(1);
      await settle();
      button?.click();
      resolveLoad([{}]);
      await vi.waitFor(() => {
        expect(results.textContent).toContain('Text: Role Text — Local font loaded');
      });
      expect(load).toHaveBeenCalledTimes(2);
      expect(results.querySelectorAll('.local-fonts-check-role')).toHaveLength(1);
    });

    it('does not probe a same-named system font when the Emoji alias is unavailable', async () => {
      plugin.settings.cache = { version: 2, folder: '.fonts', faces: [face('Role Text')] };
      plugin.settings.roles.emoji = 'Missing Emoji';
      tab.display();
      const load = vi.fn().mockResolvedValue([{}]);
      Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
      Array.from(tab.containerEl.querySelectorAll('button'))
        .find((item) => item.textContent === 'Check')
        ?.click();
      await vi.waitFor(() => {
        expect(tab.containerEl.querySelector('.local-fonts-check-results')?.textContent).toContain(
          'Emoji: Missing Emoji — Could not verify this font',
        );
      });
      expect(load).not.toHaveBeenCalled();
    });
  });

  describe('the folder field', () => {
    const folderWarning = (): Element | null | undefined => {
      const folderControl = tab.containerEl.querySelectorAll(
        '.setting-item:not(.setting-item-heading)',
      )[0];
      return folderControl?.querySelector('.local-fonts-warning');
    };

    it('warns that Sync excludes the folder when it starts with a dot, linking to the help docs', () => {
      plugin.settings.folder = '.fonts';
      tab.display();

      const warning = folderWarning();
      expect(warning?.textContent).toContain('Obsidian Sync will not sync .folders');
      expect(warning?.querySelector('a')?.getAttribute('href')).toBe(
        'https://obsidian.md/help/sync/settings#Hidden+files+and+folders',
      );
    });

    it('warns about a hidden folder nested under a visible one', () => {
      plugin.settings.folder = 'assets/.fonts';
      tab.display();

      expect(folderWarning()?.textContent).toContain('Obsidian Sync will not sync .folders');
    });

    it('does not warn for the default folder, which is visible', () => {
      tab.display();

      expect(folderWarning()).toBeNull();
    });

    it('commits and rescans once, on blur, rather than on every keystroke', async () => {
      const rescan = vi.spyOn(plugin, 'rescan').mockResolvedValue();
      // Opening the tab checks the folder on its own now. That check reaches the scan
      // without going through `rescan`, so it does not currently reach this spy — but
      // that is an implementation detail of one call, and this test is about the blur,
      // so the tab's own check is stubbed out rather than left to stay invisible by luck.
      vi.spyOn(plugin, 'rescanIfStale').mockResolvedValue(false);
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

    it('shows a folder change that failed to scan, the same as any other failed scan', async () => {
      withoutUpdateApi();
      vi.spyOn(plugin, 'rescanIfStale').mockResolvedValue(false);
      vi.spyOn(plugin, 'saveSettings').mockResolvedValue();
      let failure: string | null = null;
      vi.spyOn(plugin, 'lastScanFailure').mockImplementation(() => failure);
      vi.spyOn(plugin, 'rescan').mockImplementation(async () => {
        await Promise.resolve();
        failure = 'disk exploded';
        throw new Error(failure);
      });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      tab.display();

      const input = tab.containerEl.querySelector('input') as HTMLInputElement;
      input.value = '.fonts-elsewhere';
      input.dispatchEvent(new FocusEvent('blur'));
      await settle();

      expect(tab.containerEl.textContent).toContain('Last scan failed: disk exploded');
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

      const emojiControl = tab.containerEl.querySelectorAll(
        '.setting-item:not(.setting-item-heading)',
      )[5];
      expect(emojiControl?.textContent).toContain('No colour-emoji font found');
    });
  });

  describe('the declarative settings API (Obsidian 1.13+)', () => {
    function definitions(): SettingDefinitionItem[] {
      return tab.getSettingDefinitions();
    }

    it('describes the same seven controls as display(), plus one render definition for diagnostics', () => {
      const defs = definitions();

      expect(defs).toHaveLength(8);
      expect(defs.map((def) => ('name' in def ? def.name : null))).toStrictEqual([
        'Fonts folder',
        'Text',
        'Interface',
        'Monospace',
        'Headings',
        'Emoji',
        'Hard override',
        'Fonts found',
      ]);
      const controlTypes = defs
        .slice(0, 7)
        .map((def) => ('control' in def ? def.control.type : null));
      expect(controlTypes).toStrictEqual([
        'text',
        'dropdown',
        'dropdown',
        'dropdown',
        'dropdown',
        'dropdown',
        'toggle',
      ]);
      const diagnostics = defs[7];
      expect(diagnostics !== undefined && 'render' in diagnostics).toBe(true);
    });

    it('folds the Sync warning into the folder description when it starts with a dot', () => {
      plugin.settings.folder = '.fonts';
      const folder = definitions()[0];
      const desc = folder !== undefined && 'desc' in folder ? folder.desc : undefined;
      expect(desc).toBeInstanceOf(DocumentFragment);
      expect((desc as DocumentFragment).textContent).toContain(
        'Obsidian Sync will not sync .folders',
      );
      expect((desc as DocumentFragment).querySelector('a')?.getAttribute('href')).toBe(
        'https://obsidian.md/help/sync/settings#Hidden+files+and+folders',
      );
    });

    it('folds the Sync warning in for a hidden folder nested under a visible one', () => {
      plugin.settings.folder = 'assets/.fonts';

      const folder = definitions()[0];
      const desc = folder !== undefined && 'desc' in folder ? folder.desc : undefined;
      expect((desc as DocumentFragment).textContent).toContain('Obsidian Sync will not sync');
    });

    it('leaves the folder description plain for the default folder, which is visible', () => {
      const folder = definitions()[0];
      const desc = folder !== undefined && 'desc' in folder ? folder.desc : undefined;
      expect((desc as DocumentFragment).textContent).not.toContain('Obsidian Sync');
    });

    it('marks the heading row so its body stacks below the heading instead of beside it', () => {
      // `.setting-item` is a flex row of `.setting-item-info` and `.setting-item-control`,
      // so the diagnostics body lands as a third flex item and the heading is squeezed
      // into a narrow column beside the cards. styles.css turns the row into a block via
      // this class; without it the layout breaks, so the class is part of the contract.
      const definition = definitions()[7];
      if (definition === undefined || !('render' in definition)) {
        throw new Error('expected a render definition for the diagnostics section');
      }
      const settingEl = createDiv({ cls: 'setting-item' });
      const setHeading = vi.fn();
      const setting = { setHeading, settingEl } as unknown as Setting;

      const cleanup = definition.render(setting, {} as unknown as SettingGroup);

      expect(settingEl.hasClass('local-fonts-diagnostics-row')).toBe(true);
      expect(settingEl.querySelector('.local-fonts-diagnostics')).not.toBeNull();
      expect(setHeading).toHaveBeenCalledTimes(1);

      // Obsidian may re-render a definition; without cleanup each pass would leave
      // another copy of every family card behind.
      cleanup?.();
      expect(settingEl.querySelector('.local-fonts-diagnostics')).toBeNull();
      expect(settingEl.hasClass('local-fonts-diagnostics-row')).toBe(false);
    });

    it('offers only colour-glyph families for the Emoji dropdown, matching renderRoles', () => {
      plugin.settings.cache = {
        version: 2,
        folder: '.fonts',
        faces: [
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

      const emojiDef = definitions()[5];
      const control =
        emojiDef !== undefined && 'control' in emojiDef ? emojiDef.control : undefined;
      expect(control?.type === 'dropdown' ? Object.keys(control.options) : null).toStrictEqual([
        '',
        'Probe Emoji',
      ]);
    });

    it('getControlValue reads the current folder, roles and hardOverride, and returns undefined for an unknown key', () => {
      plugin.settings.roles.text = 'Probe Sans';
      plugin.settings.hardOverride = true;

      expect(tab.getControlValue('folder')).toBe(plugin.settings.folder);
      expect(tab.getControlValue('role:text')).toBe('Probe Sans');
      expect(tab.getControlValue('role:interface')).toBe('');
      expect(tab.getControlValue('hardOverride')).toBe(true);
      expect(tab.getControlValue('nonsense')).toBeUndefined();
    });

    it('setControlValue commits a folder change through the same path as the text field', async () => {
      const rescan = vi.spyOn(plugin, 'rescan').mockResolvedValue();
      vi.spyOn(plugin, 'saveSettings').mockResolvedValue();

      await tab.setControlValue('folder', '.fonts2');

      expect(plugin.settings.folder).toBe('.fonts2');
      expect(rescan).toHaveBeenCalledTimes(1);
    });

    it('calls update() instead of display() after a folder change, when running under Obsidian 1.13+', async () => {
      vi.spyOn(plugin, 'rescan').mockResolvedValue();
      vi.spyOn(plugin, 'saveSettings').mockResolvedValue();
      const display = vi.spyOn(tab, 'display');
      // Obsidian 1.13+ adds `update()` to the base SettingTab class; the test mock's
      // base class predates that API, so it's stubbed on directly to exercise the
      // branch that picks it over `display()`.
      const update = vi.fn();
      (tab as unknown as { update: () => void }).update = update;

      await tab.setControlValue('folder', '.fonts3');

      expect(update).toHaveBeenCalledTimes(1);
      expect(display).not.toHaveBeenCalled();
    });

    it('setControlValue commits a role change through the same path as the dropdown', async () => {
      vi.spyOn(plugin, 'saveSettings').mockResolvedValue();
      const applyFonts = vi.spyOn(plugin, 'applyFonts').mockImplementation(() => undefined);

      await tab.setControlValue('role:headings', 'Probe Sans');

      expect(plugin.settings.roles.headings).toBe('Probe Sans');
      expect(applyFonts).toHaveBeenCalled();
    });

    it('setControlValue commits hardOverride through the same path as the toggle', async () => {
      vi.spyOn(plugin, 'saveSettings').mockResolvedValue();
      vi.spyOn(plugin, 'applyFonts').mockImplementation(() => undefined);

      await tab.setControlValue('hardOverride', true);

      expect(plugin.settings.hardOverride).toBe(true);
    });

    it('setControlValue does nothing and does not throw for an unknown key', () => {
      expect(() => tab.setControlValue('nonsense', 'anything')).not.toThrow();
      expect(tab.setControlValue('nonsense', 'anything')).toBeUndefined();
    });

    it('the diagnostics render definition marks its row as a heading and renders the same body display() does', () => {
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
      const diagnostics = definitions()[7];
      if (diagnostics === undefined || !('render' in diagnostics)) {
        throw new Error('expected a render definition');
      }

      const setting = new Setting(document.body.createDiv());
      diagnostics.render(setting, {} as unknown as SettingGroup);

      expect(setting.settingEl.classList.contains('setting-item-heading')).toBe(true);
      const card = setting.settingEl.querySelector('.local-fonts-family');
      expect(card?.querySelector('summary')?.textContent).toBe('Probe Sans');
    });
  });

  /**
   * Opening the settings tab is the moment a user is most likely to have just dropped a
   * font into the folder, and until this the list they were looking at came straight
   * from a cache last refreshed at startup — so a new font only appeared after
   * restarting Obsidian.
   */
  describe('picking up folder changes when the tab is opened', () => {
    function cacheOneFamily(family: string): void {
      plugin.settings.cache = {
        version: 2,
        folder: '.fonts',
        faces: [
          {
            path: `.fonts/${family}-400.woff2`,
            format: 'woff2',
            size: 1,
            mtime: 1,
            family,
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

    it('re-renders with the newly found family when the folder had changed', async () => {
      withoutUpdateApi();
      cacheOneFamily('Old Family');
      vi.spyOn(plugin, 'rescanIfStale').mockImplementation(async () => {
        // Deferred past the synchronous part of display(), the way a real scan is: the
        // point of the assertion below is that the cached list is drawn straight away
        // rather than waiting on disk.
        await Promise.resolve();
        cacheOneFamily('New Family');
        return true;
      });

      tab.display();
      expect(tab.containerEl.textContent).toContain('Old Family');
      await settle();

      expect(tab.containerEl.textContent).toContain('New Family');
      expect(tab.containerEl.textContent).not.toContain('Old Family');
    });

    it('leaves the rendered tab alone when the folder still matches the cache', async () => {
      withoutUpdateApi();
      cacheOneFamily('Old Family');
      vi.spyOn(plugin, 'rescanIfStale').mockResolvedValue(false);

      tab.display();
      const marker = tab.containerEl.createDiv({ cls: 'survives-only-without-a-rerender' });
      await settle();

      expect(tab.containerEl.contains(marker)).toBe(true);
    });

    /**
     * The hook that actually matters on Obsidian 1.13. Verified against 1.13.7: the base
     * class renders a shown tab through `renderTab()`, which redraws from a cached
     * `settingItems` array and calls neither `display()` nor `getSettingDefinitions()`
     * again — so without this the folder was only ever read on the first render after a
     * plugin load, which is precisely the "restart Obsidian to see a new font" symptom.
     */
    describe('renderTab, the per-open hook on Obsidian 1.13+', () => {
      it('checks the folder every time the tab is shown', async () => {
        const refresh = vi.spyOn(plugin, 'rescanIfStale').mockResolvedValue(false);

        tab.renderTab();
        await settle();
        tab.renderTab();
        await settle();

        expect(refresh).toHaveBeenCalledTimes(2);
      });

      it('still hands the render itself to the base class', () => {
        const base = Object.getPrototypeOf(
          Object.getPrototypeOf(LocalFontsSettingTab.prototype),
        ) as Record<string, unknown>;
        vi.spyOn(plugin, 'rescanIfStale').mockResolvedValue(false);
        const inherited = vi.fn().mockReturnValue('rendered');
        base['renderTab'] = inherited;

        const result = tab.renderTab('an argument the base class expects');

        expect(inherited).toHaveBeenCalledWith('an argument the base class expects');
        expect(result).toBe('rendered');
        delete base['renderTab'];
      });

      it('does not throw on a version whose base class has no renderTab at all', () => {
        vi.spyOn(plugin, 'rescanIfStale').mockResolvedValue(false);

        expect(() => tab.renderTab()).not.toThrow();
      });
    });

    it('re-renders through update() rather than display() on Obsidian 1.13+', async () => {
      cacheOneFamily('Old Family');
      vi.spyOn(plugin, 'rescanIfStale').mockResolvedValue(true);
      const update = vi.fn();
      (tab as unknown as { update: () => void }).update = update;

      tab.getSettingDefinitions();
      await settle();

      expect(update).toHaveBeenCalledTimes(1);
    });

    /**
     * The re-render re-reads the definitions, which kicks the refresh off again. Without
     * a guard held across the re-render that recurses until the folder happens to settle,
     * doing a full stat sweep of the folder on every lap.
     */
    it('does not kick off a second refresh from the re-render it triggered', async () => {
      withoutUpdateApi();
      cacheOneFamily('Old Family');
      const refresh = vi.spyOn(plugin, 'rescanIfStale').mockResolvedValue(true);

      tab.display();
      await settle();

      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('does not kick one off from the 1.13+ re-render either, which re-reads the definitions', async () => {
      cacheOneFamily('Old Family');
      const refresh = vi.spyOn(plugin, 'rescanIfStale').mockResolvedValue(true);
      // What Obsidian 1.13's own `update()` does: re-read the declarative definitions and
      // redraw from them. Reading them is one of the two places a refresh starts.
      (tab as unknown as { update: () => void }).update = (): void => {
        tab.getSettingDefinitions();
      };

      tab.getSettingDefinitions();
      await settle();

      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('shows a failed refresh in the tab, not only in the console', async () => {
      withoutUpdateApi();
      cacheOneFamily('Old Family');
      // The failure has to arrive *after* the first render, the way a real one does, or
      // the warning would already be on screen and the re-render would prove nothing.
      let failure: string | null = null;
      vi.spyOn(plugin, 'lastScanFailure').mockImplementation(() => failure);
      vi.spyOn(plugin, 'rescanIfStale').mockImplementation(async () => {
        await Promise.resolve();
        failure = 'disk exploded';
        throw new Error(failure);
      });
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      tab.display();
      expect(tab.containerEl.textContent).not.toContain('Last scan failed');
      await settle();

      expect(tab.containerEl.textContent).toContain('Last scan failed: disk exploded');
      expect(consoleError).toHaveBeenCalled();
    });
  });

  describe('the rescan button', () => {
    function rescanButton(): HTMLButtonElement {
      const buttons = Array.from(
        tab.containerEl.querySelectorAll<HTMLButtonElement>('button'),
        (button) => button,
      );
      const found = buttons.find((candidate) => candidate.textContent === 'Rescan');
      if (found === undefined) {
        const labels = buttons.map((button) => button.textContent).join(', ');
        throw new Error(`no Rescan button among [${labels}]`);
      }
      return found;
    }

    it('is offered even when the folder looks empty, which is exactly when it is needed', () => {
      vi.spyOn(plugin, 'rescanIfStale').mockResolvedValue(false);
      plugin.settings.cache = { version: 2, folder: '.fonts', faces: [] };

      tab.display();

      expect(() => rescanButton()).not.toThrow();
    });

    it('forces a full re-read, which the automatic check cannot be made to do', async () => {
      vi.spyOn(plugin, 'rescanIfStale').mockResolvedValue(false);
      const rescan = vi.spyOn(plugin, 'rescan').mockResolvedValue();
      tab.display();

      rescanButton().click();

      await vi.waitFor(() => {
        expect(rescan).toHaveBeenCalledWith({ force: true });
      });
    });

    it('ignores a second click while the first rescan is still running', async () => {
      vi.spyOn(plugin, 'rescanIfStale').mockResolvedValue(false);
      const rescan = vi
        .spyOn(plugin, 'rescan')
        .mockImplementation(() => new Promise<void>(() => undefined));
      tab.display();

      rescanButton().click();
      rescanButton().click();

      expect(rescan).toHaveBeenCalledTimes(1);
    });

    /**
     * The re-render that shows the rescan's result must not go back to disk to ask
     * whether that same rescan is already out of date. Same for the re-render after a
     * folder change: both already know the cache is current.
     */
    /**
     * The re-render runs from inside a `.catch()` on a chain nothing awaits. If it threw
     * there, the chain would reject with no consumer and the failure would surface as an
     * unhandled rejection instead of anything the user or a bug report could see —
     * losing both the original scan failure and the render one.
     */
    it('survives a re-render that itself throws while reporting a failure', async () => {
      withoutUpdateApi();
      vi.spyOn(plugin, 'rescanIfStale').mockResolvedValue(false);
      vi.spyOn(plugin, 'rescan').mockRejectedValue(new Error('disk exploded'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      tab.display();
      vi.spyOn(tab, 'display').mockImplementation(() => {
        throw new Error('the render blew up too');
      });

      rescanButton().click();
      await settle();

      // Both failures reported, which is only possible if the second was caught. Asserted
      // through the log rather than an `unhandledrejection` listener, because jsdom does
      // not raise that event and a test built on it passes whether the guard is there or
      // not — verified by removing the guard and watching such a test still pass.
      const logged = consoleError.mock.calls.map((call) => String(call[0]));
      expect(logged).toContain('[local-fonts] rescan failed');
      expect(logged).toContain('[local-fonts] could not show the scan failure');
    });

    it('does not send the re-render back to disk to re-check what it just scanned', async () => {
      withoutUpdateApi();
      const refresh = vi.spyOn(plugin, 'rescanIfStale').mockResolvedValue(false);
      vi.spyOn(plugin, 'rescan').mockResolvedValue();
      tab.display();
      await settle();
      expect(refresh).toHaveBeenCalledTimes(1);

      rescanButton().click();
      await settle();

      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('shows a failed rescan in the tab, not only in the console', async () => {
      withoutUpdateApi();
      vi.spyOn(plugin, 'rescanIfStale').mockResolvedValue(false);
      // Recorded when the rescan fails, not before, so the assertion below can only pass
      // through a re-render that happened after the click.
      let failure: string | null = null;
      vi.spyOn(plugin, 'lastScanFailure').mockImplementation(() => failure);
      vi.spyOn(plugin, 'rescan').mockImplementation(async () => {
        await Promise.resolve();
        failure = 'disk exploded';
        throw new Error(failure);
      });
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      tab.display();
      await settle();
      expect(tab.containerEl.textContent).not.toContain('Last scan failed');

      rescanButton().click();
      await settle();

      expect(tab.containerEl.textContent).toContain('Last scan failed: disk exploded');
      expect(consoleError).toHaveBeenCalled();
    });
  });
});
