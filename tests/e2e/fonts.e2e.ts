import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import { waitForFixtureFonts } from './helpers/ready.js';

// The plugin appends its generated CSS to the `<style>` element Obsidian loaded
// styles.css into, identified by the `--local-fonts-sheet` marker rule that file
// declares. That is the only delivery route Obsidian mirrors into pop-out windows, so
// the assertions below read the element's *text* — the thing that gets cloned — rather
// than any CSSOM view of it.
//
// The read is duplicated inline in each `executeObsidian` callback rather than shared,
// because each callback is serialized and executed inside Obsidian on its own — it
// cannot close over a helper defined in this file's outer scope.

describe('local fonts apply in a real Obsidian', () => {
  // Scanning the hidden folder happens off the critical path (onLayoutReady), so give
  // it a real chance to finish before any assertion runs.
  beforeEach(async () => {
    await waitForFixtureFonts();
  });

  // The guard for the bug this delivery mechanism exists to fix. Everything else in
  // this file reads the main window, where every previous mechanism also worked — only
  // a second, real Document can tell whether the CSS actually crossed the boundary.
  // Obsidian's own settings dialog was one of these windows on the desktop build where
  // this was found, so a regression here is the "fonts apply everywhere except inside a
  // plugin's settings tab" report all over again. Settings is not driven directly: it
  // opens in a separate window only under some versions and platforms, which would make
  // for a test that passes by not exercising anything. A workspace pop-out is the same
  // second-document condition, unconditionally.
  //
  // The pop-out is inspected from inside the main window through its `win` handle
  // rather than by switching WebDriver window handles: the assertion is about CSS
  // reaching a second document, and reading it directly keeps the test from depending
  // on how the driver enumerates Obsidian's windows.
  it('reaches a pop-out window, which only mirrored element text ever does', async function () {
    // Mobile has no second window to reach: `openPopoutLeaf` throws "This feature is
    // only available in the desktop app" there, which is how the Android leg of this
    // matrix failed while the desktop legs all passed. Skipped rather than quietly
    // returned from, so the report says this ran nowhere rather than passing hollowly.
    const isDesktop = await browser.executeObsidian(
      ({ obsidian }) => obsidian.Platform.isDesktopApp,
    );
    if (!isDesktop) {
      this.skip();
    }

    const result = await browser.executeObsidian(async ({ app }) => {
      const workspace = app.workspace as unknown as {
        openLinkText: (link: string, source: string, pane: string) => Promise<unknown>;
        floatingSplit: { children: Array<{ win: Window }> };
      };
      await workspace.openLinkText('Welcome.md', '', 'window');

      try {
        // Obsidian clones the head into the new window asynchronously; poll for the
        // condition rather than sleeping on a margin that ages badly.
        let variable = '';
        let fontFaceRules = 0;
        for (let attempt = 0; attempt < 40; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          const win = workspace.floatingSplit.children[0]?.win;
          if (win === undefined) {
            continue;
          }
          const doc = win.document;
          fontFaceRules = Array.from(doc.head.querySelectorAll('style')).filter(
            (el) =>
              el.textContent.includes('--local-fonts-sheet') &&
              el.textContent.includes('Probe Sans'),
          ).length;
          variable = win.getComputedStyle(doc.body).getPropertyValue('--font-text-override').trim();
          if (variable !== '' && fontFaceRules > 0) {
            break;
          }
        }
        return { variable, fontFaceRules };
      } finally {
        for (const child of [...workspace.floatingSplit.children]) {
          child.win.close();
        }
      }
    });

    // The generated CSS is present in the pop-out's own copy of styles.css...
    expect(result.fontFaceRules).toBe(1);
    // ...and Obsidian's cascade in that window actually resolves to it.
    expect(result.variable).toContain('Probe Sans');
  });

  it('applies its stylesheet exactly once, into styles.css and nowhere else', async () => {
    const placements = await browser.executeObsidian(() => {
      const inStyleElements = Array.from(document.head.querySelectorAll('style')).filter((el) =>
        el.textContent.includes('Probe Sans'),
      ).length;
      // A constructed sheet is invisible to pop-out windows, so a copy landing there
      // would mean fonts silently missing outside the main window — not a duplicate
      // that merely wastes memory.
      const adopted = Array.from(document.adoptedStyleSheets).filter((sheet) =>
        Array.from(sheet.cssRules).some((rule) => rule.cssText.includes('Probe Sans')),
      ).length;
      return { inStyleElements, adopted };
    });

    expect(placements.inStyleElements).toBe(1);
    expect(placements.adopted).toBe(0);
  });

  it('serves fonts by resource URL, never base64 — the performance premise of the design', async () => {
    const css = await browser.executeObsidian(() => {
      const el = Array.from(document.head.querySelectorAll('style')).find((style) =>
        style.textContent.includes('--local-fonts-sheet'),
      );
      return el?.textContent ?? '';
    });

    expect(css).not.toContain('base64');
    // A positive check as well, so this fails loudly if resolve() ever returns something
    // that is neither base64 nor a real resource URL, such as a bare vault-relative path.
    // The scheme differs by platform: desktop gets app://, and Obsidian mobile serves
    // files through Capacitor at http://localhost/_capacitor_file_/<abs path>. Asserting
    // on app:// alone passed on all three desktop runners and failed on real Android,
    // which is what the mobile leg of this matrix exists to catch. Both platforms must
    // point at the hidden fonts folder and must not use a data: URI.
    expect(css).toMatch(/url\(["'](?!data:)[a-z]+:\/\//i);
    expect(css).toContain('/.fonts/');
    // Quoting is matched loosely (' or ") so the assertion does not pin down which one
    // css.ts happens to emit.
  });

  it('loads a font from the hidden .fonts folder, proving dot-folder access works', async () => {
    // A registered FontFace with a matching family name alone would still pass even if
    // the fixtures were moved out of a hidden folder — the guarantee would live in the
    // fixture layout, not in this assertion. Reading the actual @font-face `src` URL for
    // a Probe face and requiring it to contain `.fonts` makes the test state what it
    // claims to prove: this specific font was served from inside the dot-folder, and it
    // would fail if that folder were ever renamed to something visible.
    const result = await browser.executeObsidian(async () => {
      await document.fonts.ready;
      let registered = false;
      document.fonts.forEach((f) => {
        if (f.family.includes('Probe')) registered = true;
      });

      const styleEl = Array.from(document.head.querySelectorAll('style')).find((el) =>
        el.textContent.includes('--local-fonts-sheet'),
      );
      // css.ts joins blocks with a blank line between them (see buildCss), so split
      // back into one block per @font-face / rule.
      const cssBlocks = (styleEl?.textContent ?? '').split('\n\n');

      let probeSrcUrl = '';
      for (const block of cssBlocks) {
        if (block.includes('Probe') && block.includes('@font-face')) {
          const match = /url\(["']([^"')]+)["']\)/.exec(block);
          if (match?.[1] !== undefined) {
            probeSrcUrl = match[1];
            break;
          }
        }
      }

      return { registered, probeSrcUrl };
    });

    expect(result.registered).toBe(true);
    expect(result.probeSrcUrl).toContain('.fonts');
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
    await browser.executeObsidian(async ({ app }) => {
      await app.workspace.openLinkText('Welcome.md', '', true);
    });

    // A fixed sleep here would either flake on a slower machine or hide a real mounting
    // delay behind a margin that happens to be generous enough today. Poll for the
    // actual condition this test needs instead: a `.cm-content` element that exists AND
    // has rendered the note's text, which is what "the editor mounted" concretely means.
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(() => {
          const el = document.querySelector('.cm-content');
          return el !== null && el.textContent.trim().length > 0;
        }),
      { timeout: 10_000, timeoutMsg: 'editor content element never mounted with text' },
    );

    const result = await browser.executeObsidian(async () => {
      await document.fonts.load("64px 'Probe Sans'");

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
