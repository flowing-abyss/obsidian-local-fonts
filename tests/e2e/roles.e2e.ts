import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import {
  measureSurface,
  openRoleNote,
  openRoleSettings,
  openRoleSuggestion,
  withRoleScenario,
} from './helpers/roles.js';

describe('calibrated real font rendering', () => {
  it('distinguishes every ordinary role face and both emoji faces', async () => {
    await withRoleScenario('calibration', async () => {
      await openRoleNote('reading');
      const families = [
        'Role Text',
        'Role Interface',
        'Role Mono',
        'Role Headings',
        'Role Baseline',
      ];
      const widths: number[] = [];
      for (const family of families) {
        const result = await measureSurface('.markdown-preview-view p', 'ABCАБя0123', family);
        widths.push(result.referenceWidth);
      }
      for (const [index, left] of widths.entries()) {
        for (const right of widths.slice(index + 1)) {
          expect(Math.abs(left - right)).toBeGreaterThan(2);
        }
      }
      for (const sample of ['😀', '☀️', '👩‍💻']) {
        const a = await measureSurface('.markdown-preview-view p', sample, 'Role Emoji A');
        const b = await measureSurface('.markdown-preview-view p', sample, 'Role Emoji B');
        expect(Math.abs(a.referenceWidth - b.referenceWidth)).toBeGreaterThan(2);
      }
      for (const family of ['Role Emoji A', 'Role Emoji B']) {
        const joined = await measureSurface('.markdown-preview-view p', '👩‍💻', family);
        const one = await measureSurface('.markdown-preview-view p', '👩', family);
        expect(Math.abs(joined.referenceWidth - one.referenceWidth)).toBeLessThanOrEqual(0.5);
      }
    });
  });

  it('keeps unassigned note, code, and native settings on their baseline fonts', async () => {
    await withRoleScenario('native baseline', async () => {
      await openRoleNote('reading');
      for (const selector of ['.markdown-preview-view p', '.markdown-preview-view p code']) {
        const result = await measureSurface(selector, 'ABCАБя0123', 'Role Baseline');
        expect(Math.abs(result.width - result.referenceWidth)).toBeLessThanOrEqual(0.5);
      }
      await openRoleSettings();
      const setting = await measureSurface(
        '.role-test-setting .setting-item-name',
        'ABCАБя0123',
        'Role Baseline',
        'settings',
      );
      expect(Math.abs(setting.width - setting.referenceWidth)).toBeLessThanOrEqual(0.5);
      const ordinaryLabel = await measureSurface(
        '.setting-item-name',
        'Emoji',
        'Role Baseline',
        'settings',
      );
      expect(Math.abs(ordinaryLabel.width - ordinaryLabel.referenceWidth)).toBeLessThanOrEqual(0.5);
    });
  });

  it('keeps unassigned editor modes and native suggestions on their baseline fonts', async () => {
    await withRoleScenario('editor and suggestion baseline', async () => {
      for (const mode of ['live', 'source'] as const) {
        await openRoleNote(mode);
        const paragraph = await measureSurface(
          '.workspace-leaf.mod-active .cm-line',
          'ABCАБя0123',
          'Role Baseline',
        );
        expect(Math.abs(paragraph.width - paragraph.referenceWidth)).toBeLessThanOrEqual(0.5);
      }
      await openRoleSuggestion();
      const suggestion = await measureSurface('.suggestion-item', 'ABCАБя0123', 'Role Baseline');
      expect(Math.abs(suggestion.width - suggestion.referenceWidth)).toBeLessThanOrEqual(0.5);
    });
  });

  it('closes a newly opened pop-out when assertions fail before measurement', async function () {
    const isDesktop = await browser.executeObsidian(
      ({ obsidian }) => obsidian.Platform.isDesktopApp,
    );
    if (!isDesktop) this.skip();
    const popoutCount = async (): Promise<number> =>
      browser.executeObsidian(
        ({ app }) =>
          (
            app.workspace as unknown as { floatingSplit: { children: Array<{ win: Window }> } }
          ).floatingSplit.children.filter((child) => !child.win.closed).length,
      );
    const startingCount = await popoutCount();
    expect(startingCount).toBe(0);
    await browser.executeObsidian(async ({ app }) => {
      await app.workspace.openLinkText('Welcome.md', '', 'window');
      const children = (
        app.workspace as unknown as { floatingSplit: { children: Array<{ win: Window }> } }
      ).floatingSplit.children;
      const existing = children[children.length - 1]?.win;
      if (existing === undefined) throw new Error('Pre-existing pop-out did not open');
      (window as Window & { __roleExistingPopout?: Window }).__roleExistingPopout = existing;
    });
    try {
      await browser.waitUntil(async () => (await popoutCount()) > startingCount, {
        timeout: 10_000,
        timeoutMsg: 'Pre-existing pop-out was not registered',
      });
      const before = await popoutCount();
      let failedAsExpected = false;
      try {
        await withRoleScenario('pop-out partial failure', async () => {
          await browser.executeObsidian(async ({ app }) => {
            await app.workspace.openLinkText('Font roles.md', '', 'window');
          });
          await browser.waitUntil(async () => (await popoutCount()) > before, {
            timeout: 10_000,
            timeoutMsg: 'Role pop-out did not open',
          });
          await browser.executeObsidian(({ app }) => {
            const workspace = app.workspace as unknown as {
              setLayout(layout: unknown): Promise<void>;
              floatingSplit: { children: Array<{ win: Window }> };
            };
            const children = workspace.floatingSplit.children;
            const popout = children[children.length - 1]?.win;
            if (popout === undefined) throw new Error('No opened role pop-out to observe');
            const original = workspace.setLayout.bind(workspace);
            const originalClose = popout.close.bind(popout);
            const owner = window as Window & {
              __rolePopoutWitness?: {
                original: typeof original;
                originalClose: typeof originalClose;
                popout: Window;
                closeCalled: boolean;
                closedBeforeLayout: boolean | null;
              };
            };
            owner.__rolePopoutWitness = {
              original,
              originalClose,
              popout,
              closeCalled: false,
              closedBeforeLayout: null,
            };
            popout.close = () => {
              const witness = owner.__rolePopoutWitness;
              if (witness !== undefined) witness.closeCalled = true;
              originalClose();
            };
            workspace.setLayout = async (layout) => {
              workspace.setLayout = original;
              const witness = owner.__rolePopoutWitness;
              if (witness !== undefined) witness.closedBeforeLayout = witness.closeCalled;
              await original(layout);
            };
          });
          throw new Error('deliberate assertion failure before pop-out measurement');
        });
      } catch (error) {
        expect(String(error)).toContain('deliberate assertion failure before pop-out measurement');
        failedAsExpected = true;
      }
      expect(failedAsExpected).toBe(true);
      const observation = await browser.executeObsidian(() => {
        const owner = window as Window & {
          __roleExistingPopout?: Window;
          __rolePopoutWitness?: { closedBeforeLayout: boolean | null };
        };
        return {
          closedBeforeLayout: owner.__rolePopoutWitness?.closedBeforeLayout,
          existingOpen: owner.__roleExistingPopout?.closed === false,
        };
      });
      expect(observation.closedBeforeLayout).toBe(true);
      expect(observation.existingOpen).toBe(true);
      await browser.waitUntil(async () => (await popoutCount()) === before, {
        timeout: 10_000,
        timeoutMsg: 'New role pop-out remained open after scenario cleanup',
      });
    } finally {
      await browser.executeObsidian(({ app }) => {
        const owner = window as Window & {
          __roleExistingPopout?: Window;
          __rolePopoutWitness?: {
            original: (layout: unknown) => Promise<void>;
            originalClose: () => void;
            popout: Window;
          };
        };
        const witness = owner.__rolePopoutWitness;
        if (witness !== undefined) {
          (app.workspace as unknown as { setLayout: typeof witness.original }).setLayout =
            witness.original;
          if (!witness.popout.closed) witness.popout.close = witness.originalClose;
          delete owner.__rolePopoutWitness;
        }
        for (const child of (
          app.workspace as unknown as { floatingSplit: { children: Array<{ win: Window }> } }
        ).floatingSplit.children) {
          if (!child.win.closed) child.win.close();
        }
        delete owner.__roleExistingPopout;
      });
    }
    await browser.waitUntil(async () => (await popoutCount()) === startingCount, {
      timeout: 10_000,
      timeoutMsg: 'Pre-existing test pop-out remained open after test cleanup',
    });
  });
});
