import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import type { PluginSettings } from '../../src/settings.js';
import { navigateRoleEditor } from './helpers/editor.js';
import { observeNativeFocusBoundary } from './helpers/native-focus.js';
import { waitForFixtureFonts } from './helpers/ready.js';
import type { ActiveLeafWorkspace, RoleCleanupObservation } from './helpers/roles.js';
import {
  measureSurface,
  openRoleNote,
  openRoleSettings,
  openRoleSuggestion,
  withRoleScenario,
} from './helpers/roles.js';

interface NativeWindowOwner extends Window {
  electronWindow: { id: number };
  electron: {
    remote: {
      BrowserWindow: { fromId(id: number): { hide(): void; show(): void; isVisible(): boolean } };
    };
  };
}

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
        await navigateRoleEditor('ABCАБя0123');
        const paragraph = await measureSurface(
          '.workspace-leaf.mod-active .cm-line.cm-active',
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

  it('waits through deferred registration instead of accepting a stylesheet comment', async () => {
    await withRoleScenario('deferred font readiness', async () => {
      await browser.executeObsidian(({ app }) => {
        const plugin = (
          app.plugins as unknown as {
            plugins: Record<string, { settings: PluginSettings; applyFonts(): void }>;
          }
        ).plugins['local-fonts'];
        if (plugin === undefined) throw new Error('Missing fixture plugin');
        const owner = window as Window & { __restoreRoleRegistration?: () => void };
        const cache = plugin.settings.cache;
        const timer = window.setTimeout(() => {
          owner.__restoreRoleRegistration?.();
        }, 1000);
        owner.__restoreRoleRegistration = () => {
          window.clearTimeout(timer);
          plugin.settings.cache = cache;
          plugin.applyFonts();
          delete owner.__restoreRoleRegistration;
        };
        plugin.settings.cache = null;
        plugin.applyFonts();
      });
      try {
        await waitForFixtureFonts();
        const loaded = await browser.executeObsidian(
          async () => (await document.fonts.load("16px 'Probe Sans'", 'ABC')).length,
        );
        expect(loaded).toBeGreaterThan(0);
      } finally {
        await browser.executeObsidian(() => {
          (
            window as Window & { __restoreRoleRegistration?: () => void }
          ).__restoreRoleRegistration?.();
        });
      }
    });
  });

  for (const [activeRoot, hidden] of [
    ['main', false],
    ['floating', false],
    ['main', true],
  ] as const)
    for (const pinned of [false, true])
      // eslint-disable-next-line complexity -- Native identity, selection, focus and pinned navigation are independent cleanup assertions.
      it(`closes a newly opened pop-out and restores the ${activeRoot} active leaf, pinned ${pinned}, hidden ${hidden}`, async function () {
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
        try {
          await browser.executeObsidian(async ({ app }) => {
            await app.workspace.openLinkText('Welcome.md', '', 'window');
            const children = (
              app.workspace as unknown as { floatingSplit: { children: Array<{ win: Window }> } }
            ).floatingSplit.children;
            const existing = children[children.length - 1]?.win;
            if (existing === undefined) throw new Error('Pre-existing pop-out did not open');
            (window as Window & { __roleExistingPopout?: Window }).__roleExistingPopout = existing;
            // Bring the original to the front before awaiting its initial active
            // leaf; BrowserWindow.focus alone can ignore an occluded macOS window.
            (window as unknown as NativeWindowOwner).electron.remote.BrowserWindow.fromId(
              (existing as NativeWindowOwner).electronWindow.id,
            ).show();
          });
          await browser.waitUntil(async () => (await popoutCount()) > startingCount, {
            timeout: 10_000,
            timeoutMsg: 'Pre-existing pop-out was not registered',
          });
          // Registration precedes native focus on latest Obsidian. Wait for the
          // opened window's leaf before pinning/snapshotting the pre-scenario state.
          await browser.waitUntil(
            async () =>
              browser.executeObsidian(({ app }) => {
                const existing = (window as Window & { __roleExistingPopout?: Window })
                  .__roleExistingPopout;
                return (
                  (app.workspace as unknown as ActiveLeafWorkspace).activeLeaf?.view.containerEl
                    .ownerDocument === existing?.document
                );
              }),
            { timeout: 10_000, timeoutMsg: 'Pre-existing pop-out did not become the active leaf' },
          );
          if (activeRoot === 'main') {
            await browser.executeObsidian(({ app }) => {
              app.workspace.iterateAllLeaves((leaf) => {
                if (leaf.getRoot() === app.workspace.rootSplit)
                  app.workspace.setActiveLeaf(leaf, { focus: true });
              });
            });
          }
          const before = await popoutCount();
          const nativeHandlesBefore = await browser.getWindowHandles();
          const activeBefore = await browser.executeObsidian(({ app }, pin: boolean) => {
            const leaf = (app.workspace as unknown as ActiveLeafWorkspace).activeLeaf;
            if (leaf === null) throw new Error('Missing pre-existing active pop-out leaf');
            leaf.setPinned(pin);
            return (leaf as unknown as { id: string }).id;
          }, pinned);
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
                // eslint-disable-next-line @typescript-eslint/unbound-method -- Restored by identity; invoked with .call(workspace).
                const original = workspace.setLayout;
                const descriptor = Object.getOwnPropertyDescriptor(workspace, 'setLayout');
                const originalClose = popout.close.bind(popout);
                const native = (
                  window as unknown as {
                    electron: {
                      remote: { BrowserWindow: { fromId(id: number): { isDestroyed(): boolean } } };
                    };
                  }
                ).electron.remote.BrowserWindow.fromId(
                  (popout as unknown as { electronWindow: { id: number } }).electronWindow.id,
                );
                const owner = window as Window & {
                  __rolePopoutWitness?: {
                    original: typeof original;
                    descriptor: PropertyDescriptor | undefined;
                    originalClose: typeof originalClose;
                    popout: Window;
                    closeCalled: boolean;
                    closedBeforeLayout: boolean | null;
                  };
                };
                owner.__rolePopoutWitness = {
                  original,
                  descriptor,
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
                  if (descriptor === undefined) Reflect.deleteProperty(workspace, 'setLayout');
                  else Object.defineProperty(workspace, 'setLayout', descriptor);
                  const witness = owner.__rolePopoutWitness;
                  if (witness !== undefined)
                    witness.closedBeforeLayout = witness.closeCalled && native.isDestroyed();
                  await original.call(workspace, layout);
                };
              });
              if (hidden) {
                const visible = await browser.executeObsidian(() => {
                  const owner = window as unknown as NativeWindowOwner;
                  const native = owner.electron.remote.BrowserWindow.fromId(
                    owner.electronWindow.id,
                  );
                  native.hide();
                  return native.isVisible();
                });
                expect(visible).toBe(false);
              }
              if (!hidden)
                throw new Error('deliberate assertion failure before pop-out measurement');
            });
            failedAsExpected = hidden;
          } catch (error) {
            if (hidden) throw error;
            expect(String(error)).toContain(
              'deliberate assertion failure before pop-out measurement',
            );
            failedAsExpected = true;
          }
          expect(failedAsExpected).toBe(true);
          const nativeHandlesAfter = await browser.getWindowHandles();
          nativeHandlesAfter.sort((left, right) => left.localeCompare(right));
          nativeHandlesBefore.sort((left, right) => left.localeCompare(right));
          expect(nativeHandlesAfter).toEqual(nativeHandlesBefore);
          const focusBoundary = await observeNativeFocusBoundary();
          expect(focusBoundary.before).toBe(activeBefore);
          expect(focusBoundary.active).toBe(activeBefore);
          for (const callback of focusBoundary.callbacks) {
            expect(callback.active).toBe(activeBefore);
            // Other concurrently running Obsidian instances can own OS focus.
            // Any focused document in this workspace must belong to the saved root.
            if (callback.focused) expect(callback.root).toBe(activeRoot);
          }
          const observation = await browser.executeObsidian(({ app }, pin: boolean) => {
            const owner = window as Window & {
              __roleExistingPopout?: Window;
              __roleCleanupObservation?: RoleCleanupObservation;
              __rolePopoutWitness?: { closedBeforeLayout: boolean | null };
            };
            const observation = {
              closedBeforeLayout: owner.__rolePopoutWitness?.closedBeforeLayout,
              existingOpen: owner.__roleExistingPopout?.closed === false,
              existingRegistered: (
                app.workspace as unknown as { floatingSplit: { children: Array<{ win: Window }> } }
              ).floatingSplit.children.some((child) => child.win === owner.__roleExistingPopout),
              active:
                (
                  (app.workspace as unknown as ActiveLeafWorkspace).activeLeaf as unknown as {
                    id: string;
                  } | null
                )?.id ?? null,
              cleanup: owner.__roleCleanupObservation,
            };
            let unsafe: { before: string; selected: string; after: string | null } | null = null;
            if (pin) {
              // Deliberately exercise the old mutating oracle after read-only capture,
              // in the same renderer task so native focus cannot intervene.
              const before = (app.workspace as unknown as ActiveLeafWorkspace).activeLeaf;
              if (before === null) throw new Error('Missing restored pinned leaf');
              const selected = app.workspace.getLeaf(false);
              unsafe = {
                before: (before as unknown as { id: string }).id,
                selected: (selected as unknown as { id: string }).id,
                after:
                  (
                    (app.workspace as unknown as ActiveLeafWorkspace).activeLeaf as unknown as {
                      id: string;
                    } | null
                  )?.id ?? null,
              };
              app.workspace.setActiveLeaf(before, { focus: false });
              if (selected !== before) selected.detach();
            }
            return { ...observation, unsafe };
          }, pinned);
          expect(observation.closedBeforeLayout).toBe(true);
          expect(observation.existingOpen).toBe(true);
          expect(observation.existingRegistered).toBe(true);
          expect(observation.active).toBe(activeBefore);
          expect(observation.cleanup).toMatchObject({
            savedActive: activeBefore,
            active: activeBefore,
            attached: true,
            connected: true,
            navigable: !pinned,
            root: activeRoot,
            windowOpen: true,
          });
          expect(
            observation.cleanup?.nativeTransitions.map((transition) => transition.operation),
          ).toEqual(['closed', 'focused']);
          for (const transition of observation.cleanup?.nativeTransitions ?? [])
            expect(transition.complete).toBe(true);
          if (pinned) {
            expect(observation.unsafe?.before).toBe(activeBefore);
            expect(observation.unsafe?.selected).not.toBe(activeBefore);
            // The official 1.0.3 getter creates/returns a replacement without
            // selecting it; 1.13.7 also calls setActiveLeaf. Neither is an oracle.
            expect(observation.unsafe?.after).toBe(
              browser.getObsidianVersion() === '1.0.3'
                ? activeBefore
                : observation.unsafe?.selected,
            );
          }
          await browser.waitUntil(async () => (await popoutCount()) === before, {
            timeout: 10_000,
            timeoutMsg: 'New role pop-out remained open after scenario cleanup',
          });
        } finally {
          await browser.executeObsidian(({ app }, restoreVisible: boolean) => {
            if (restoreVisible) {
              const nativeOwner = window as unknown as NativeWindowOwner;
              nativeOwner.electron.remote.BrowserWindow.fromId(
                nativeOwner.electronWindow.id,
              ).show();
            }
            const owner = window as Window & {
              __roleExistingPopout?: Window;
              __rolePopoutWitness?: {
                original: (layout: unknown) => Promise<void>;
                descriptor: PropertyDescriptor | undefined;
                originalClose: () => void;
                popout: Window;
              };
            };
            const witness = owner.__rolePopoutWitness;
            if (witness !== undefined) {
              if (witness.descriptor === undefined)
                Reflect.deleteProperty(app.workspace, 'setLayout');
              else Object.defineProperty(app.workspace, 'setLayout', witness.descriptor);
              if (!witness.popout.closed) witness.popout.close = witness.originalClose;
              delete owner.__rolePopoutWitness;
            }
            const windows = new Set(
              (
                app.workspace as unknown as { floatingSplit: { children: Array<{ win: Window }> } }
              ).floatingSplit.children.map((child) => child.win),
            );
            if (owner.__roleExistingPopout !== undefined) windows.add(owner.__roleExistingPopout);
            for (const win of windows) if (!win.closed) win.close();
            delete owner.__roleExistingPopout;
          }, hidden);
        }
        await browser.waitUntil(async () => (await popoutCount()) === startingCount, {
          timeout: 10_000,
          timeoutMsg: 'Pre-existing test pop-out remained open after test cleanup',
        });
      });
});
