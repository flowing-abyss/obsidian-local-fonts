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
 * Marker custom property declared in styles.css (`:root { --local-fonts-sheet: 1 }`),
 * used to find this plugin's own `<style>` element among `document.styleSheets`.
 * Matching on content, rather than `href` or position, survives Obsidian bundling this
 * file under whatever path or index it chooses.
 */
const SHEET_MARKER_PROPERTY = '--local-fonts-sheet';

/**
 * The marker's exact value, which has to match, not merely be present.
 *
 * `all: unset` resets *every* property including custom ones, so in Chromium a rule
 * that uses it reports something rather than the empty string for any custom property
 * asked about. Observed in a running Obsidian: a presence test for
 * `--local-fonts-sheet` matched Excalidraw's stylesheet, whose rules reset with
 * `all: unset`, and this plugin appended its CSS there instead of into its own
 * styles.css. (What Chromium reports for such a property was not pinned down, and does
 * not need to be — anything other than `1` is not this marker.) Compare against the
 * value styles.css actually declares.
 */
const SHEET_MARKER_VALUE = '1';

/** How long to wait for Obsidian to append styles.css before reporting it missing. */
const STYLE_ELEMENT_TIMEOUT_MS = 10_000;

/**
 * Locates the `<style>` element Obsidian created for this plugin's styles.css, by
 * looking for `SHEET_MARKER_PROPERTY` among every stylesheet in the document and
 * taking that sheet's owner node.
 *
 * That element is the delivery vehicle for the generated CSS, and the reason is
 * pop-out windows. Every pop-out is a separate `Window` with its own `Document`, and
 * Obsidian populates it by cloning the main document's `<style>` elements and keeping
 * the clones in sync with later edits — text content only. Nothing else crosses that
 * boundary: a constructed `CSSStyleSheet` cannot even be adopted by a second document
 * (Chromium throws `NotAllowedError`), and rules inserted through the CSSOM never
 * reach the clone, because they are not part of the element's text. Appending to this
 * element's `textContent` is therefore the one injection route that reaches every
 * window, and it needs no per-window bookkeeping at all.
 *
 * Obsidian's own settings dialog can be one of those windows: observed on desktop
 * (1.12, macOS), `app.setting` opened into a separate `Window` whose document had an
 * empty `adoptedStyleSheets` and the theme's placeholder font values. That is how
 * "fonts apply everywhere except inside a plugin's settings tab" turned out to be a
 * symptom of this same bug. Whether settings opens that way appears to depend on the
 * version and the platform, so treat it as one case this covers rather than a rule.
 */
function findPluginStyleElement(): HTMLStyleElement | null {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const hasMarker = Array.from(sheet.cssRules).some(
        (rule) =>
          rule instanceof CSSStyleRule &&
          rule.style.getPropertyValue(SHEET_MARKER_PROPERTY).trim() === SHEET_MARKER_VALUE,
      );
      if (hasMarker && sheet.ownerNode instanceof HTMLStyleElement) {
        return sheet.ownerNode;
      }
    } catch {
      // A cross-origin stylesheet throws on `cssRules` access; it is never this
      // plugin's own, so treat it the same as "no marker found" and keep looking.
    }
  }
  return null;
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
  /** This plugin's own `<style>` element, found once and reused. See
   *  `findPluginStyleElement` for why the generated CSS goes here and nowhere else. */
  private styleEl: HTMLStyleElement | null = null;
  /** styles.css as Obsidian loaded it, captured before the first write so every
   *  reapply rebuilds from the static rules instead of appending to its own output. */
  private baseCss = '';
  /** The exact text this plugin last wrote, so a later apply can tell its own output
   *  apart from styles.css having been reloaded underneath it. */
  private written = '';
  /** Set by `onunload`, so work already in flight cannot re-inject after it. */
  private unloaded = false;
  /** Whether a `MutationObserver` is already waiting for the style element. */
  private waiting = false;
  /** Paths dropped by the most recent scan, surfaced by the settings tab. */
  private skipped: string[] = [];
  /** Message from the most recent failed scan, surfaced by the settings tab. */
  private scanError: string | null = null;
  /** Set when a scan found nothing but a non-empty cache was kept, so the settings tab
   *  can say the list it shows was not confirmed against the folder on this device. */
  private unverified: string | null = null;

  override async onload(): Promise<void> {
    this.unloaded = false;
    const saved = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = mergeSettings(DEFAULT_SETTINGS, saved);

    // Startup path only: read the cache, build a string, inject it. No font I/O.
    this.applyFonts();
    this.addSettingTab(new LocalFontsSettingTab(this.app, this));

    // Obsidian reads a plugin's styles.css from disk and appends it to the head only
    // after `onload` returns, so the element the CSS goes into does not exist yet on
    // the call above — on a first install, and on every reload in place. How many ticks
    // that file read takes is not something to guess at, so watch for the element
    // instead of retrying on a timer.
    if (this.styleEl === null) {
      this.applyWhenStyleElementArrives();
    }

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
    // Obsidian removes the element itself on unload, so this matters only for a reload
    // in place: restore styles.css to exactly what it shipped as, generated rules gone.
    if (this.styleEl !== null) {
      this.styleEl.textContent = this.baseCss;
    }
    this.styleEl = null;
    this.baseCss = '';
    this.written = '';
    this.unloaded = true;
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

  /**
   * Regenerate the stylesheet from the current cache and settings, and append it to
   * this plugin's own `<style>` element — which reaches every window, main and pop-out
   * alike (see `findPluginStyleElement`). Rewriting from `baseCss` each time makes
   * repeated calls idempotent, so there is nothing to clean up between applies.
   */
  applyFonts(): void {
    // A rescan started before the plugin was disabled can resolve after it, and putting
    // the CSS back at that point would quietly undo the unload.
    if (this.unloaded) {
      return;
    }
    // A cached element that is no longer in the document is Obsidian having replaced the
    // whole `<style>` tag rather than rewriting it — writing into the detached node would
    // succeed silently and change nothing on screen, so drop it and look again.
    if (this.styleEl?.isConnected === false) {
      this.styleEl = null;
    }
    this.styleEl ??= this.locateStyleElement();
    if (this.styleEl === null) {
      return;
    }
    // Anything in the element that this plugin did not put there is styles.css having
    // been reloaded underneath it. Whether Obsidian rewrites this element in place on a
    // CSS change or replaces it outright was not established — the check above covers
    // replacement, this one covers a rewrite, and between them the next apply cannot
    // paste a stale copy of the file back over the fresh one.
    if (this.styleEl.textContent !== this.written) {
      this.baseCss = this.styleEl.textContent;
    }
    const css = this.buildStylesheet();
    this.written = css === '' ? this.baseCss : `${this.baseCss}\n\n${css}`;
    this.styleEl.textContent = this.written;
  }

  /** Find the element once and remember what styles.css shipped with. */
  private locateStyleElement(): HTMLStyleElement | null {
    const el = findPluginStyleElement();
    if (el === null) {
      return null;
    }
    this.baseCss = el.textContent;
    this.written = el.textContent;
    return el;
  }

  /**
   * Re-apply as soon as Obsidian appends this plugin's styles.css to the head, and give
   * up complaining about it after `STYLE_ELEMENT_TIMEOUT_MS`. Missing it is not fatal —
   * a settings change or a rescan calls `applyFonts` again and would pick it up then —
   * so this reports rather than throws, and reports once rather than on every apply.
   */
  private applyWhenStyleElementArrives(): void {
    // A second `onload` without an unload in between would otherwise leave two of these
    // running, and the "reports once" above would become "reports once per onload".
    if (this.waiting) {
      return;
    }
    this.waiting = true;
    const observer = new MutationObserver(() => {
      this.applyFonts();
      if (this.styleEl !== null) {
        observer.disconnect();
        window.clearTimeout(giveUp);
      }
    });
    observer.observe(document.head, { childList: true });

    const giveUp = window.setTimeout(() => {
      observer.disconnect();
      if (this.styleEl === null) {
        console.error(
          '[local-fonts] could not find the plugin stylesheet among document.styleSheets; fonts will not apply on this device',
        );
      }
    }, STYLE_ELEMENT_TIMEOUT_MS);

    this.register(() => {
      observer.disconnect();
      window.clearTimeout(giveUp);
      this.waiting = false;
    });
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
