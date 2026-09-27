import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import { measureInput } from './helpers/input.js';
import {
  applyRoles,
  EMPTY_ROLES,
  openRoleNote,
  setNativeTestCss,
  withRoleScenario,
} from './helpers/roles.js';

describe('actual property key input glyphs', () => {
  it('calibrates positive and negative control widths and preserves its native font with Emoji', async function () {
    if (!(await browser.executeObsidian(({ obsidian }) => obsidian.requireApiVersion('1.4.0')))) {
      console.info('Capability skip: this app predates Properties inputs');
      this.skip();
    }
    await withRoleScenario('actual property INPUT', async () => {
      await openRoleNote('reading');
      await setNativeTestCss(
        "body {--font-text-theme:'Role Baseline';--font-interface-theme:'Role Interface';--metadata-label-font:'Role Mono';}",
      );
      const selector = '.metadata-property-key-input';
      const native = await measureInput(selector, 'ABCАБя0123', 'Role Mono');
      expect(Math.abs(native.width - native.referenceWidth)).toBeLessThanOrEqual(1);
      const wrongText = await measureInput(selector, 'ABCАБя0123', 'Role Text');
      expect(Math.abs(wrongText.width - wrongText.referenceWidth)).toBeGreaterThan(16);
      await applyRoles({ ...EMPTY_ROLES, emoji: 'Role Emoji A' }, false);
      const decorated = await measureInput(selector, 'ABCАБя0123', 'Role Mono');
      expect(Math.abs(decorated.width - native.width)).toBeLessThanOrEqual(1);
      for (const sample of ['😀', '☀️', '👩‍💻']) {
        const positive = await measureInput(selector, sample, '__local-fonts-emoji__');
        expect(Math.abs(positive.width - positive.referenceWidth)).toBeLessThanOrEqual(1);
        const negative = await measureInput(selector, sample, 'Role Emoji B');
        expect(Math.abs(negative.width - negative.referenceWidth)).toBeGreaterThan(16);
      }
      await applyRoles(EMPTY_ROLES, false);
      const restored = await measureInput(selector, 'ABCАБя0123', 'Role Mono');
      expect(Math.abs(restored.width - native.width)).toBeLessThanOrEqual(1);
    });
  });
});
