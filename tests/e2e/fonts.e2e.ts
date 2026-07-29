import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';

// Obsidian's Electron (desktop) and Android WebView are both well past Chromium 73, so
// `supportsAdoptedStyleSheets()` in src/main.ts is true on both platforms this suite
// targets: the plugin applies its CSS via `document.adoptedStyleSheets`, NOT the
// `<style id="local-fonts-style">` fallback element. (That fallback only fires on WebKit
// below 16.4 — iOS, which this suite does not cover.) Assertions below read whichever
// mechanism is actually active instead of assuming the style-element path, so a real
// pass here can't be a false green from an empty `getElementById` lookup.
//
// The read is duplicated inline in each `executeObsidian` callback rather than shared,
// because each callback is serialized and executed inside Obsidian on its own — it
// cannot close over a helper defined in this file's outer scope.

describe('local fonts apply in a real Obsidian', () => {
  // Scanning the hidden folder happens off the critical path (onLayoutReady), so give
  // it a real chance to finish before any assertion runs.
  beforeEach(async () => {
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(() => {
          const styleEl = document.getElementById('local-fonts-style');
          if (styleEl !== null) return styleEl.textContent.includes('@font-face');
          return Array.from(document.adoptedStyleSheets).some((sheet) =>
            Array.from(sheet.cssRules).some((rule) => rule.cssText.includes('@font-face')),
          );
        }),
      { timeout: 10_000, timeoutMsg: 'plugin never injected any @font-face rules' },
    );
  });

  it('applies its stylesheet exactly once — via adoptedStyleSheets on this platform, not a duplicated element', async () => {
    const count = await browser.executeObsidian(() => {
      const styleElCount = document.querySelectorAll('#local-fonts-style').length;
      const adoptedCount = Array.from(document.adoptedStyleSheets).filter((sheet) =>
        Array.from(sheet.cssRules).some((rule) => rule.cssText.includes('@font-face')),
      ).length;
      return styleElCount + adoptedCount;
    });

    expect(count).toBe(1);
  });

  it('serves fonts by resource URL, never base64 — the performance premise of the design', async () => {
    const css = await browser.executeObsidian(() => {
      const styleEl = document.getElementById('local-fonts-style');
      if (styleEl !== null) return styleEl.textContent;
      for (const sheet of document.adoptedStyleSheets) {
        const text = Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join('\n');
        if (text.includes('@font-face')) return text;
      }
      return '';
    });

    expect(css).not.toContain('base64');
    // Positive check, not just the absence of base64: the URL must actually be an
    // app:// resource path (what adapter.getResourcePath returns), so this fails loudly
    // if resolve() ever silently returns something else (e.g. a bare vault-relative path).
    // Quoting is matched loosely (' or ") because this reads CSSOM's `cssText`
    // serialization, which normalizes to double quotes regardless of how css.ts wrote it.
    expect(css).toMatch(/url\(["']app:\/\//);
  });

  it('loads a font from the hidden .fonts folder, proving dot-folder access works', async () => {
    const loaded = await browser.executeObsidian(async () => {
      await document.fonts.ready;
      let found = false;
      document.fonts.forEach((f) => {
        if (f.family.includes('Probe')) found = true;
      });
      return found;
    });

    expect(loaded).toBe(true);
  });

  it('renders text in the selected family, not a fallback', async () => {
    // Width measurement is the primary check: it works identically on desktop and
    // Android, unlike CDP. Identical widths mean the browser fell back.
    const applied = await browser.executeObsidian(async () => {
      // @font-face + font-display: swap means the FIRST time a family is requested for
      // layout, the browser paints the fallback immediately and only fetches the font
      // asynchronously in the background, swapping once it lands. A synchronous
      // getBoundingClientRect() right after setting font-family can therefore observe
      // the pre-swap fallback even though the font is genuinely going to load a moment
      // later — that's not a design failure, it's this test racing the browser's own
      // swap. `document.fonts.load()` forces that fetch and resolves only once it's
      // done, so the measurement below reflects the settled state, not the transient one.
      await document.fonts.load("64px 'Probe Sans'");

      const measure = (family: string): number => {
        const el = document.createElement('span');
        el.textContent = 'WWWiii 0123';
        el.style.cssText = `position:absolute;left:-9999px;font-size:64px;white-space:pre;font-family:${family};`;
        document.body.appendChild(el);
        const w = el.getBoundingClientRect().width;
        el.remove();
        return w;
      };
      const withFont = measure("'Probe Sans', LocalFontsNoSuchFamily");
      const fallback = measure('LocalFontsNoSuchFamily');
      // A small epsilon absorbs sub-pixel font-smoothing noise between two independent
      // measurements of the same fallback font — matches src/fonts/probe.ts's own
      // isFamilyApplied, which this assertion mirrors.
      return Math.abs(withFont - fallback) > 0.5;
    });

    expect(applied).toBe(true);
  });

  it('the --font-text-override variable is the tier that actually wins in the running editor', async () => {
    // The test above only proves the font FILE loads and CAN render in isolation — it
    // doesn't touch the CSS custom-property tier the design depends on Obsidian's own
    // app.css to read (spike question 3: does the *-override tier actually win?). This
    // opens the fixture note and measures text inside the real editor content element,
    // so it inherits whatever font Obsidian itself resolves via var(--font-text-override)
    // — not a font-family this test sets by hand. Comparing that inherited width only
    // against a nonexistent-family fallback would be a false-green risk: ANY real font
    // (including Obsidian's own default editor font, present even with the plugin
    // disabled) differs from a bogus family's width, so that alone wouldn't prove the
    // override variable specifically won. Instead this asserts the inherited width
    // matches an explicit 'Probe Sans' request pixel-for-pixel, and differs from the
    // fallback — i.e. the cascade actually resolved to our font, not just to some font.
    const result = await browser.executeObsidian(async ({ app }) => {
      await document.fonts.load("64px 'Probe Sans'");

      const file = app.vault.getFiles().find((f) => f.path === 'Welcome.md');
      if (file === undefined) {
        throw new Error('fixture note Welcome.md is missing from the vault');
      }

      const leaf = app.workspace.getLeaf(true);
      await leaf.openFile(file);
      // Let the editor mount before probing its computed cascade.
      await new Promise((resolve) => setTimeout(resolve, 250));

      const cmContent = document.querySelector('.cm-content');
      if (cmContent === null) {
        throw new Error('no .cm-content editor element found after opening the note');
      }

      const measure = (family: string | null): number => {
        const el = document.createElement('span');
        el.textContent = 'WWWiii 0123';
        el.style.cssText = 'position:absolute;left:-9999px;font-size:64px;white-space:pre;';
        if (family !== null) {
          el.style.fontFamily = family;
        }
        cmContent.appendChild(el);
        const w = el.getBoundingClientRect().width;
        el.remove();
        return w;
      };

      // No explicit font-family: inherits Obsidian's real cascade, including whatever
      // var(--font-text-override) resolves to on this element.
      const inherited = measure(null);
      const explicitProbeSans = measure("'Probe Sans', LocalFontsNoSuchFamily");
      const fallback = measure('LocalFontsNoSuchFamily');
      return {
        matchesProbeSans: Math.abs(inherited - explicitProbeSans) <= 0.5,
        differsFromFallback: Math.abs(inherited - fallback) > 0.5,
      };
    });

    expect(result.matchesProbeSans).toBe(true);
    expect(result.differsFromFallback).toBe(true);
  });
});
