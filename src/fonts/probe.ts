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

function widthOf(doc: Document, fontFamily: string, sample: string): number {
  const el = doc.createElement('span');
  el.className = 'local-fonts-probe';
  el.textContent = sample;
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  el.style.top = '-9999px';
  el.style.whiteSpace = 'pre';
  el.style.fontSize = '64px';
  el.style.fontFamily = fontFamily;
  doc.body.appendChild(el);
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
 * Whether the family actually rendered.
 *
 * getComputedStyle only reports the *requested* stack, so it cannot answer this. Measuring
 * the same string in the family and in a guaranteed-missing family does: identical widths
 * mean the browser fell back, i.e. the font did not apply. Widths are compared with a small
 * epsilon rather than strict inequality, since two independent measurements of the same
 * fallback font can differ by sub-pixel amounts due to font-smoothing.
 */
export function isFamilyApplied(family: string, doc: Document, sample: string = SAMPLE): boolean {
  const target = measureText(family, doc, sample);
  const baseline = widthOf(doc, SENTINEL, sample);
  return Math.abs(target - baseline) > EPSILON;
}
