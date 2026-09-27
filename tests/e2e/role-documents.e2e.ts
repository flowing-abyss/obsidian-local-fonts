import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import type { TestDocument } from './helpers/roles.js';
import {
  applyRoles,
  closeRoleSettings,
  EMPTY_ROLES,
  measureSurface,
  openRoleNote,
  openRolePopout,
  openRoleSettings,
  selectRolePopout,
  setNativeInlineFonts,
  setPopoutNativeFonts,
  withRoleScenario,
} from './helpers/roles.js';

async function matches(target: TestDocument, family: string, sample = 'ABCАБя0123'): Promise<void> {
  const selector =
    target === 'settings' ? '.role-test-setting .setting-item-name' : '.markdown-preview-view p';
  await browser.waitUntil(
    async () => {
      const value = await measureSurface(selector, sample, family, target);
      return Math.abs(value.width - value.referenceWidth) <= 0.5;
    },
    { timeout: 10000, timeoutMsg: `${target}: expected ${family} for ${sample}` },
  );
}

describe('independent role documents', () => {
  it('updates existing and newly created pop-outs with their own native baselines', async function () {
    if (!(await browser.executeObsidian(({ obsidian }) => obsidian.Platform.isDesktopApp))) {
      console.info('Capability skip: pop-out windows require desktop');
      this.skip();
    }
    await withRoleScenario('existing and new pop-outs', async () => {
      await openRoleNote('reading');
      // Main baseline comes from the native test stylesheet. Core mirrors main
      // inline variables into pop-outs, so per-window theme values stay local.
      await setNativeInlineFonts({ '--font-text-override': null });
      await openRolePopout();
      await setPopoutNativeFonts({ '--font-text-theme': "'Role Text'" });
      await matches('main', 'Role Baseline');
      await matches('popout', 'Role Text');
      await applyRoles({ ...EMPTY_ROLES, emoji: 'Role Emoji A' }, false);
      await matches('main', 'Role Emoji A', '😀');
      await matches('popout', 'Role Emoji A', '😀');
      await matches('main', 'Role Baseline');
      await matches('popout', 'Role Text');
      await openRolePopout();
      await setPopoutNativeFonts({ '--font-text-theme': "'Role Mono'" });
      await matches('popout', 'Role Mono');
      await matches('popout', 'Role Emoji A', '😀');
      // Core mirrors Appearance override variables whenever the main body changes.
      await browser.executeObsidian(() => {
        document.body.classList.toggle('role-document-refresh');
      });
      await selectRolePopout(0);
      await matches('popout', 'Role Text');
      await matches('popout', 'Role Emoji A', '😀');
      await selectRolePopout(1);
      await applyRoles({ ...EMPTY_ROLES, emoji: 'Role Emoji B' }, false);
      await matches('main', 'Role Emoji B', '😀');
      await matches('popout', 'Role Emoji B', '😀');
      await selectRolePopout(0);
      await matches('popout', 'Role Text');
      await matches('popout', 'Role Emoji B', '😀');
      await selectRolePopout(1);
      await applyRoles(EMPTY_ROLES, false);
      await matches('main', 'Role Baseline');
      await matches('popout', 'Role Mono');
      await matches('main', 'Role Baseline', '😀');
      await matches('popout', 'Role Mono', '😀');
      await selectRolePopout(0);
      await matches('popout', 'Role Text');
      await matches('popout', 'Role Text', '😀');
    });
  });

  it('mirrors replacement style text and current settings across separate documents', async function () {
    if (!(await browser.executeObsidian(({ obsidian }) => obsidian.Platform.isDesktopApp))) {
      console.info('Capability skip: pop-out windows require desktop');
      this.skip();
    }
    await withRoleScenario('style replacement and reopened settings', async () => {
      await openRoleNote('reading');
      await setNativeInlineFonts({ '--font-text-override': null });
      await openRolePopout();
      await setPopoutNativeFonts({ '--font-text-theme': "'Role Mono'" });
      await applyRoles(
        { ...EMPTY_ROLES, interface: 'Role Interface', emoji: 'Role Emoji A' },
        false,
      );
      await matches('popout', 'Role Emoji A', '😀');
      await browser.executeObsidian(() => {
        const style = Array.from(document.head.querySelectorAll('style')).find((element) =>
          element.textContent.includes('--local-fonts-sheet: 1'),
        );
        if (style === undefined) throw new Error('Missing plugin style');
        const clone = style.cloneNode(true) as HTMLStyleElement;
        const generated = style.textContent.indexOf('\n\n@font-face');
        if (generated < 0) throw new Error('Missing generated face block');
        clone.textContent = style.textContent.slice(0, generated);
        style.replaceWith(clone);
      });
      await matches('popout', 'Role Emoji A', '😀');
      await matches('popout', 'Role Mono');
      await openRoleSettings();
      await matches('settings', 'Role Interface');
      await matches('settings', 'Role Emoji A', '😀');
      await browser.executeObsidian((_, sample: string) => {
        const doc = (window as Window & { __roleScenario?: { settingsDocument: Document | null } })
          .__roleScenario?.settingsDocument;
        const row = doc?.querySelector('.role-test-setting');
        if (row === null || row === undefined) throw new Error('Missing current settings row');
        row.createEl('h1', { cls: 'role-inherited-dialog' }).textContent = sample;
      }, 'ABCАБя0123 😀');
      for (const [sample, family] of [
        ['ABCАБя0123', 'Role Interface'],
        ['😀', 'Role Emoji A'],
      ]) {
        if (sample === undefined || family === undefined) throw new Error('Missing heading sample');
        const heading = await measureSurface('.role-inherited-dialog', sample, family, 'settings');
        expect(Math.abs(heading.width - heading.referenceWidth)).toBeLessThanOrEqual(0.5);
      }
      await closeRoleSettings();
      await applyRoles(
        { ...EMPTY_ROLES, interface: 'Role Headings', emoji: 'Role Emoji B' },
        false,
      );
      await openRoleSettings();
      await matches('settings', 'Role Headings');
      await matches('settings', 'Role Emoji B', '😀');
      await matches('popout', 'Role Emoji B', '😀');
    });
  });
});
