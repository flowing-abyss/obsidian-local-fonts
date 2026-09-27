import { browser } from '@wdio/globals';

/** Shipped comments mention @font-face before the deferred scan registers any faces. */
export async function waitForFixtureFonts(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(() => {
        for (const style of Array.from(document.head.querySelectorAll('style'))) {
          const rules = Array.from(style.sheet?.cssRules ?? []);
          const marked = rules.some(
            (rule) =>
              rule instanceof CSSStyleRule &&
              rule.style.getPropertyValue('--local-fonts-sheet').trim() === '1',
          );
          const registered = rules.some(
            (rule) =>
              rule instanceof CSSFontFaceRule &&
              rule.style.getPropertyValue('font-family').replace(/["']/g, '') === 'Probe Sans',
          );
          if (marked && registered) return true;
        }
        return false;
      }),
    { timeout: 10_000, timeoutMsg: 'Plugin never registered the fixture font faces' },
  );
}
