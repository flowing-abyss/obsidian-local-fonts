import { browser } from '@wdio/globals';
import { quote } from '../../../src/fonts/family.js';
import type { GlyphObservation } from './roles.js';

/** Measure the actual control's overflowing glyph run, then the same control with a reference font.
 * CSSOM View scrollWidth is integral: repeats separate faces beyond that rounding error.
 * https://www.w3.org/TR/cssom-view-1/#dom-element-scrollwidth
 * No copied span or computed-family string is used as glyph-selection proof.
 */
export async function measureInput(
  selector: string,
  sample: string,
  family: string,
): Promise<GlyphObservation> {
  return browser.executeObsidian(
    async (_, css: string, text: string, referenceCss: string) => {
      const input = document.querySelector<HTMLInputElement>(css);
      if (input?.tagName !== 'INPUT' || input.getClientRects().length === 0)
        throw new Error(`Missing visible real INPUT: ${css}`);
      const saved = {
        style: input.getAttribute('style'),
        value: input.value,
        start: input.selectionStart,
        end: input.selectionEnd,
        direction: input.selectionDirection,
        scroll: input.scrollLeft,
      };
      const computed = input.ownerDocument.defaultView?.getComputedStyle(input);
      if (computed === undefined) throw new Error('Input has no own window');
      const stack = computed.fontFamily;
      const fontSize = computed.fontSize;
      try {
        input.value = text.repeat(16);
        for (const [property, value] of Object.entries({
          width: '40px',
          'min-width': '0',
          'max-width': '40px',
        }))
          input.style.setProperty(property, value, 'important');
        const metrics = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize}`;
        await input.ownerDocument.fonts.load(`${metrics} ${stack}`, input.value);
        const width = input.scrollWidth;
        if (width <= input.clientWidth + 2)
          throw new Error('Input sample does not overflow; no glyph evidence');
        input.style.setProperty('font-family', referenceCss, 'important');
        await input.ownerDocument.fonts.load(`${metrics} ${referenceCss}`, input.value);
        return { width, referenceWidth: input.scrollWidth, stack, fontSize };
      } finally {
        input.value = saved.value;
        if (saved.style === null) input.removeAttribute('style');
        else input.setAttribute('style', saved.style);
        input.setSelectionRange(saved.start, saved.end, saved.direction ?? undefined);
        input.scrollLeft = saved.scroll;
      }
    },
    selector,
    sample,
    quote(family),
  );
}
