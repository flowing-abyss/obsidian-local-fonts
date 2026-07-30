/**
 * A family name no font can have. Anything rendered in it falls back to the generic,
 * which gives the baseline width to compare against.
 */
const SENTINEL = 'LocalFontsNoSuchFamily';

const SAMPLE = 'Съешь ещё этих мягких французских булок WWWiii 0123 😀';

/**
 * Widths that differ by less than this are treated as identical. Real font substitutions
 * produce differences of many pixels; this only absorbs sub-pixel noise from font-smoothing
 * or subpixel rendering when the fallback path is measured twice.
 */
const EPSILON = 0.5;

/**
 * Everything static (off-screen positioning, `white-space`, `font-size`) lives in
 * `.local-fonts-probe` in styles.css, so a theme or this plugin's own generated CSS has
 * no plausible rule to collide with. Only `font-family` — the one thing that varies per
 * call — is set from code, through `setCssStyles` (the sanctioned API for a dynamic
 * inline style, not a raw `.style.x =` assignment).
 *
 * `createEl`/`setCssStyles` are Obsidian's own DOM helpers, patched onto `Node.prototype`/
 * `HTMLElement.prototype` at runtime in the app. `obsidian-test-mocks` (this project's
 * jsdom test harness) patches the same prototypes the same way via its vitest setup file,
 * so this one code path is genuinely exercised in both environments — no jsdom-only
 * fallback is needed here.
 */
function widthOf(doc: Document, fontFamily: string, sample: string): number {
  const el = doc.body.createSpan({ cls: 'local-fonts-probe', text: sample });
  el.setCssStyles({ fontFamily });
  try {
    return el.getBoundingClientRect().width;
  } finally {
    el.remove();
  }
}

/** Rendered width of the sample in the given family, in CSS pixels. */
export function measureText(family: string, doc: Document, sample: string = SAMPLE): number {
  return widthOf(doc, `'${family}', ${SENTINEL}`, sample);
}

/**
 * Document.fonts is a standard `FontFaceSet`, but jsdom (this project's test
 * environment) does not implement it — so this can't be typed as always-present the
 * way `lib.dom.d.ts` claims, or `@typescript-eslint/no-unnecessary-condition` would
 * (wrongly, for this codebase) reject the presence check below as dead code.
 */
interface MaybeFontFaceSetDocument {
  fonts?: FontFaceSet;
}

/**
 * `font-display: swap` (used by every @font-face this plugin emits) means a face is
 * not fetched until something on screen actually uses it. Measuring it before that
 * happens sees only the fallback width — indistinguishable from "this font is not
 * applying" — so a family the Check button hasn't previously rendered on screen
 * would always report as absent, whether or not it is actually configured
 * correctly. `document.fonts.load` forces the fetch and resolves once it (or its
 * failure) is settled, so the measurement below always reflects the real font.
 */
async function ensureFontLoaded(family: string, doc: Document): Promise<void> {
  const fonts = (doc as unknown as MaybeFontFaceSetDocument).fonts;
  if (fonts === undefined) {
    return;
  }
  try {
    await fonts.load(`64px '${family}'`);
  } catch {
    // A face that fails to load (network error, corrupt file) still needs to be
    // measured — the fallback-width comparison below already handles "did not apply".
  }
}

/**
 * Whether the family actually rendered.
 *
 * getComputedStyle only reports the *requested* stack, so it cannot answer this. Measuring
 * the same string in the family and in a guaranteed-missing family does: identical widths
 * mean the browser fell back, i.e. the font did not apply. Widths are compared with a small
 * epsilon rather than strict inequality, since two independent measurements of the same
 * fallback font can differ by sub-pixel amounts due to font-smoothing.
 */
export async function isFamilyApplied(
  family: string,
  doc: Document,
  sample: string = SAMPLE,
): Promise<boolean> {
  await ensureFontLoaded(family, doc);
  const target = measureText(family, doc, sample);
  const baseline = widthOf(doc, SENTINEL, sample);
  return Math.abs(target - baseline) > EPSILON;
}
