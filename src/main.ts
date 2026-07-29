import { Platform, Plugin } from 'obsidian';
import { buildCache, groupIntoFamilies, isCacheStale } from './fonts/catalog.js';
import { buildCss } from './fonts/css.js';
import type { Engine } from './fonts/platform.js';
import { listStamps, type FontAdapter } from './fonts/scanner.js';
import { selectFaces } from './fonts/select.js';
import type { FaceRecord } from './fonts/types.js';
import { LocalFontsSettingTab } from './settings-tab.js';
import { DEFAULT_SETTINGS, type PluginSettings } from './settings.js';
import { mergeSettings } from './utils/merge-settings.js';

const STYLE_ID = 'local-fonts-style';

/**
 * `adoptedStyleSheets` needs Chromium 73+ or WebKit 16.4+. Obsidian ships to iOS
 * 16.0–16.3 devices, where this is absent — feature-detect rather than assume.
 */
function supportsAdoptedStyleSheets(): boolean {
  return 'adoptedStyleSheets' in document && typeof CSSStyleSheet === 'function';
}

export default class LocalFontsPlugin extends Plugin {
  override settings!: PluginSettings;
  /** Primary path: a constructable stylesheet, adopted directly by the document. */
  private sheet: CSSStyleSheet | null = null;
  /** Fallback for WebKit below 16.4, where the sheet above doesn't exist. */
  private styleEl: HTMLStyleElement | null = null;
  /** Paths dropped by the most recent scan, surfaced by the settings tab. */
  private skipped: string[] = [];
  /** Message from the most recent failed scan, surfaced by the settings tab. */
  private scanError: string | null = null;

  override async onload(): Promise<void> {
    const saved = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = mergeSettings(DEFAULT_SETTINGS, saved);

    // Startup path only: read the cache, build a string, inject it. No font I/O.
    this.applyFonts();
    this.addSettingTab(new LocalFontsSettingTab(this.app, this));

    // Scanning is deliberately deferred off the critical path.
    this.app.workspace.onLayoutReady(() => {
      this.rescanIfStale().catch((error: unknown) => {
        // console.error alone is invisible to a non-technical user; the settings tab
        // reads this back so a failed scan is something they can actually discover.
        this.scanError = error instanceof Error ? error.message : String(error);
        console.error('[local-fonts] rescan failed', error);
      });
    });
  }

  override onunload(): void {
    if (this.sheet !== null && supportsAdoptedStyleSheets()) {
      // Reassign rather than mutate: other code may hold a reference to the current array.
      const sheet = this.sheet;
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
    }
    this.sheet = null;
    this.styleEl?.remove();
    this.styleEl = null;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Faces grouped by family, for the settings UI. */
  families(): Map<string, FaceRecord[]> {
    return groupIntoFamilies(this.settings.cache?.faces ?? []);
  }

  /** Files dropped by the most recent scan because they could not be read or parsed. */
  skippedFiles(): readonly string[] {
    return this.skipped;
  }

  /** Message from the most recent scan that failed outright, or null if none has. */
  lastScanFailure(): string | null {
    return this.scanError;
  }

  /** Regenerate and apply the stylesheet from the current cache and settings. */
  applyFonts(): void {
    const css = this.buildStylesheet();
    if (supportsAdoptedStyleSheets()) {
      this.applyViaAdoptedStyleSheet(css);
    } else {
      this.applyViaStyleElement(css);
    }
  }

  /** Build the CSS string for the current cache, role assignments and engine. */
  private buildStylesheet(): string {
    // Obsidian's Platform flags are set by the native app shell itself, not sniffed from
    // a UA string, so they're the correct source here (and the policy-mandated one:
    // eslint-plugin-obsidianmd bans reading `navigator` directly). WKWebView (the iOS/
    // iPadOS app) is the only WebKit target the plugin ships to; Electron (desktop) and
    // the Android WebView are both Chromium. `detectEngine` itself stays UA-string-based
    // so it remains unit-testable without an Obsidian runtime.
    const engine: Engine = Platform.isIosApp ? 'webkit' : 'chromium';
    const faces = selectFaces(this.settings.cache?.faces ?? [], engine);
    return buildCss({
      faces,
      roles: this.settings.roles,
      hardOverride: this.settings.hardOverride,
      resolve: (path) => this.app.vault.adapter.getResourcePath(path),
    });
  }

  /**
   * No element is created at all, so there's nothing for `no-forbidden-elements` to
   * catch and nothing to hunt for on repeated calls: `replaceSync` makes re-applying
   * trivially idempotent, and re-adding an already-adopted sheet is a guarded no-op.
   */
  private applyViaAdoptedStyleSheet(css: string): void {
    this.sheet ??= new CSSStyleSheet();
    this.sheet.replaceSync(css);
    if (!document.adoptedStyleSheets.includes(this.sheet)) {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.sheet];
    }
  }

  /** Reuses a single element across repeated calls so a stale one never lingers. */
  private applyViaStyleElement(css: string): void {
    this.styleEl ??= document.head.createEl('style', { attr: { id: STYLE_ID } });
    this.styleEl.textContent = css;
  }

  /** Rescan the folder and re-apply. Safe to call at any time; never on the startup path. */
  async rescan(): Promise<void> {
    const skipped: string[] = [];
    const cache = await buildCache(this.adapter(), this.settings.folder, (path) => {
      skipped.push(path);
    });
    this.skipped = skipped;
    this.scanError = null;
    // A scan that finds nothing is more likely a bad folder path (renamed/moved) than an
    // intentionally emptied one — keep the last-known-good cache rather than clobbering
    // it, so the user doesn't lose every font over a typo'd path.
    if (cache.faces.length > 0 || (this.settings.cache?.faces.length ?? 0) === 0) {
      this.settings.cache = cache;
      await this.saveSettings();
    }
    this.applyFonts();
  }

  private async rescanIfStale(): Promise<void> {
    // Stamps must come from the folder as it is NOW. Deriving them from the cache would
    // compare the cache against itself and never detect a change.
    const stamps = await listStamps(this.adapter(), this.settings.folder);
    if (isCacheStale(this.settings.cache, this.settings.folder, stamps)) {
      await this.rescan();
    }
  }

  private adapter(): FontAdapter {
    const adapter = this.app.vault.adapter;
    return {
      list: (path) => adapter.list(path),
      stat: (path) => adapter.stat(path),
      readBinary: (path) => adapter.readBinary(path),
    };
  }
}
