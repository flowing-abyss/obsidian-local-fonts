import { Platform, Plugin } from 'obsidian';
import { buildCache, groupIntoFamilies, isCacheStale } from './fonts/catalog.js';
import { buildCss } from './fonts/css.js';
import type { Engine } from './fonts/platform.js';
import { listStamps, type FontAdapter } from './fonts/scanner.js';
import { selectFaces } from './fonts/select.js';
import type { FaceRecord } from './fonts/types.js';
import { LocalFontsSettingTab } from './settings-tab.js';
import { DEFAULT_SETTINGS, type PluginSettings } from './settings.js';
import { isHiddenPath } from './utils/hidden-path.js';
import { mergeSettings } from './utils/merge-settings.js';

/**
 * `adoptedStyleSheets` needs Chromium 73+ or WebKit 16.4+. Obsidian's own minimum is
 * iOS/iPadOS 14.5 (per the App Store listing), which is below that — so real installs
 * on iOS/iPadOS 14.5–16.3 lack it. Feature-detect rather than assume.
 */
function supportsAdoptedStyleSheets(): boolean {
  return 'adoptedStyleSheets' in document && typeof CSSStyleSheet === 'function';
}

/**
 * Marker custom property declared in styles.css (`:root { --local-fonts-sheet: 1 }`),
 * used to find this plugin's own stylesheet among `document.styleSheets` for the
 * fallback path below. Matching on content, rather than `href` or position, survives
 * Obsidian bundling this file under whatever path or index it chooses.
 */
const SHEET_MARKER_PROPERTY = '--local-fonts-sheet';

/**
 * Locates this plugin's own stylesheet — the one Obsidian loaded from styles.css —
 * among every stylesheet in the document, by looking for `SHEET_MARKER_PROPERTY`. Used
 * only by the WebKit-below-16.4 fallback, to inject generated CSS via `insertRule`
 * without creating any element (`no-forbidden-elements` exists precisely to stop a
 * plugin from doing that).
 */
function findPluginStyleSheet(): CSSStyleSheet | null {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const hasMarker = Array.from(sheet.cssRules).some(
        (rule) =>
          rule instanceof CSSStyleRule &&
          rule.style.getPropertyValue(SHEET_MARKER_PROPERTY).trim() !== '',
      );
      if (hasMarker) {
        return sheet;
      }
    } catch {
      // A cross-origin stylesheet throws on `cssRules` access; it is never this
      // plugin's own, so treat it the same as "no marker found" and keep looking.
    }
  }
  return null;
}

/**
 * Splits a flat run of top-level CSS rules (as produced by `buildCss`: `@font-face`
 * blocks and plain selector blocks, never nested) into one string per rule, suitable
 * for individual `CSSStyleSheet.insertRule` calls — which, unlike `replaceSync`, accept
 * only a single rule at a time. Tracks brace depth rather than splitting on blank lines,
 * so it stays correct regardless of `buildCss`'s exact formatting.
 */
function splitCssRules(css: string): string[] {
  const rules: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch !== '}') {
      continue;
    }
    depth -= 1;
    if (depth !== 0) {
      continue;
    }
    rules.push(css.slice(start, i + 1).trim());
    start = i + 1;
  }
  return rules.filter((rule) => rule !== '');
}

/**
 * Wording for a cache that outlived a scan finding nothing. A hidden folder gets the
 * extra sentence because that combination has one overwhelmingly likely cause: Obsidian
 * Sync excludes every folder whose name starts with a dot, with no setting to change it,
 * and `.obsidian` is its only exception. The cache travels inside `.obsidian`; the fonts
 * do not travel at all.
 */
function describeUnverifiedCache(folder: string): string {
  const base = `No font files were found in ${folder}, so the families below come from the last successful scan and may not exist on this device.`;
  return isHiddenPath(folder)
    ? `${base} Obsidian Sync does not sync folders whose name starts with a dot, so a synced vault will not carry this one. Moving the fonts to a folder without a leading dot fixes it.`
    : base;
}

export default class LocalFontsPlugin extends Plugin {
  override settings!: PluginSettings;
  /** Primary path: a constructable stylesheet, adopted directly by the document. */
  private sheet: CSSStyleSheet | null = null;
  /** Fallback for WebKit below 16.4: this plugin's own stylesheet, found once and reused. */
  private fallbackSheet: CSSStyleSheet | null = null;
  /** How many rules at the tail of `fallbackSheet` this plugin inserted, so a reapply
   *  removes exactly those and never touches styles.css's own static rules. */
  private fallbackRuleCount = 0;
  /** Paths dropped by the most recent scan, surfaced by the settings tab. */
  private skipped: string[] = [];
  /** Message from the most recent failed scan, surfaced by the settings tab. */
  private scanError: string | null = null;
  /** Set when a scan found nothing but a non-empty cache was kept, so the settings tab
   *  can say the list it shows was not confirmed against the folder on this device. */
  private unverified: string | null = null;

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
    this.clearFallbackRules();
    this.fallbackSheet = null;
  }

  /** Removes exactly the rules this plugin inserted into `fallbackSheet`, leaving every
   *  rule that was already in styles.css (including the marker) untouched. */
  private clearFallbackRules(): void {
    if (this.fallbackSheet === null) {
      return;
    }
    for (let i = 0; i < this.fallbackRuleCount; i++) {
      this.fallbackSheet.deleteRule(this.fallbackSheet.cssRules.length - 1);
    }
    this.fallbackRuleCount = 0;
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

  /** Message for a cache that survived a scan which found no files, or null if the last
   *  scan confirmed the folder. */
  unverifiedCache(): string | null {
    return this.unverified;
  }

  /** Regenerate and apply the stylesheet from the current cache and settings. */
  applyFonts(): void {
    const css = this.buildStylesheet();
    if (supportsAdoptedStyleSheets()) {
      this.applyViaAdoptedStyleSheet(css);
    } else {
      this.applyViaInsertRule(css);
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

  /**
   * No element is created here either: this plugin's own stylesheet (loaded by
   * Obsidian from styles.css) is located once via `findPluginStyleSheet` and reused,
   * and each call replaces exactly the rules the previous call inserted — via
   * `insertRule`/`deleteRule`, since a non-constructed stylesheet's `replaceSync`
   * throws.
   */
  private applyViaInsertRule(css: string): void {
    this.fallbackSheet ??= findPluginStyleSheet();
    const sheet = this.fallbackSheet;
    if (sheet === null) {
      // Nothing to inject into; surfaced here rather than thrown, since a rescan or a
      // settings change must not crash the plugin over a stylesheet that failed to load.
      console.error(
        '[local-fonts] could not find the plugin stylesheet among document.styleSheets; fonts will not apply on this device',
      );
      return;
    }
    this.clearFallbackRules();
    const rules = splitCssRules(css);
    for (const rule of rules) {
      sheet.insertRule(rule, sheet.cssRules.length);
    }
    this.fallbackRuleCount = rules.length;
  }

  /** Rescan the folder and re-apply. Safe to call at any time; never on the startup path. */
  async rescan(): Promise<void> {
    const skipped: string[] = [];
    const cache = await buildCache(
      this.adapter(),
      this.settings.folder,
      (path) => {
        skipped.push(path);
      },
      this.settings.cache,
    );
    this.skipped = skipped;
    this.scanError = null;
    // A scan that finds nothing is more likely a bad folder path (renamed/moved) than an
    // intentionally emptied one, so the last-known-good cache is kept rather than
    // clobbered and the user doesn't lose every font over a typo'd path. Keeping it
    // silently is the trap though: data.json lives under .obsidian and syncs, while a
    // dot-folder never does, so a second device can receive a cache describing fonts it
    // does not have and show them as if they were present.
    const keptWithoutConfirming =
      cache.faces.length === 0 && (this.settings.cache?.faces.length ?? 0) > 0;
    if (keptWithoutConfirming) {
      this.unverified = describeUnverifiedCache(this.settings.folder);
    } else {
      this.unverified = null;
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
