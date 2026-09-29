import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import { measureSurface, openRoleNote, openRolePopout, withRoleScenario } from './helpers/roles.js';

interface CloseCancellation {
  win: Window;
  originalClose: () => void;
  recovery: number;
  native: { listenerCount(event: 'closed'): number };
  listenersBefore: number;
}

interface HeldClose {
  win: Window;
  originalClose: () => void;
  requested: boolean;
}

describe('native lifecycle failure cleanup', () => {
  it('keeps the driver available to observe and release a pending native close', async function () {
    const desktop = await browser.executeObsidian(({ obsidian }) => obsidian.Platform.isDesktopApp);
    if (!desktop) this.skip();
    const handlesBefore = await browser.getWindowHandles();
    let ready: () => void = () => {};
    const prepared = new Promise<void>((resolve) => {
      ready = resolve;
    });
    // Observe failure immediately, including while an independent command is
    // checking the pending native transition.
    const cleanup = withRoleScenario('observable native close', async () => {
      await openRolePopout();
      await browser.executeObsidian(() => {
        const owner = window as unknown as Window & {
          __roleScenario: { popoutWindow: Window };
          __heldRoleClose?: HeldClose;
        };
        const win = owner.__roleScenario.popoutWindow;
        const held = { win, originalClose: win.close.bind(win), requested: false };
        owner.__heldRoleClose = held;
        win.close = () => {
          held.requested = true;
        };
      });
      ready();
    }).then(
      () => null,
      (error: unknown) => String(error),
    );
    try {
      await Promise.race([
        prepared,
        cleanup.then((failure) => {
          throw new Error(failure ?? 'Scenario ended before the close was held');
        }),
      ]);
      await browser.waitUntil(
        async () =>
          browser.executeObsidian(
            () => (window as Window & { __heldRoleClose?: HeldClose }).__heldRoleClose?.requested,
          ),
        { timeout: 20_000, timeoutMsg: 'Scenario cleanup did not request the held close' },
      );
      const pending = await browser.executeObsidian(() => {
        const owner = window as Window & {
          __roleScenario?: unknown;
          __heldRoleClose?: HeldClose;
          __roleCleanupTrace?: Array<{ stage: string }>;
        };
        const trace = owner.__roleCleanupTrace ?? [];
        return {
          active: owner.__roleScenario !== undefined,
          open: owner.__heldRoleClose?.win.closed === false,
          stage: trace[trace.length - 1]?.stage,
        };
      });
      expect(pending).toEqual({ active: true, open: true, stage: 'close requested' });
    } finally {
      await browser.executeObsidian(() => {
        const owner = window as Window & { __heldRoleClose?: HeldClose };
        const held = owner.__heldRoleClose;
        if (held === undefined) return;
        if (!held.win.closed) {
          held.win.close = held.originalClose;
          held.originalClose();
        }
        delete owner.__heldRoleClose;
      });
      await cleanup;
    }
    expect(await cleanup).toBeNull();
    const handlesAfter = await browser.getWindowHandles();
    expect(handlesAfter).toHaveLength(handlesBefore.length);
    expect(handlesAfter).toEqual(expect.arrayContaining(handlesBefore));
  });

  it('bounds a canceled close and removes its listener before the next scenario', async function () {
    const desktop = await browser.executeObsidian(({ obsidian }) => obsidian.Platform.isDesktopApp);
    if (!desktop) this.skip();
    const handlesBefore = await browser.getWindowHandles();
    let failure = '';
    try {
      try {
        await withRoleScenario('canceled native close', async () => {
          await openRolePopout();
          await browser.executeObsidian(() => {
            const owner = window as unknown as Window & {
              __roleScenario: { popoutWindow: Window };
              __roleCloseCancellation?: CloseCancellation;
              electron: {
                remote: { BrowserWindow: { fromId(id: number): CloseCancellation['native'] } };
              };
            };
            const win = owner.__roleScenario.popoutWindow;
            const native = owner.electron.remote.BrowserWindow.fromId(
              (win as unknown as { electronWindow: { id: number } }).electronWindow.id,
            );
            const originalClose = win.close.bind(win);
            // A recovery guard keeps the RED run with the old unbounded helper
            // finite. The fixed helper must fail and clean up before it fires.
            const recovery = window.setTimeout(originalClose, 45_000);
            owner.__roleCloseCancellation = {
              win,
              originalClose,
              recovery,
              native,
              listenersBefore: native.listenerCount('closed'),
            };
            win.close = () => {};
          });
        });
      } catch (error) {
        failure = String(error);
      }
      expect(failure).toContain('Timed out waiting for native close');
      const state = await browser.executeObsidian(() => {
        const owner = window as Window & {
          __roleScenario?: unknown;
          __roleCloseCancellation?: CloseCancellation;
        };
        const canceled = owner.__roleCloseCancellation;
        if (canceled === undefined) throw new Error('Missing canceled native window');
        return {
          scenarioCleared: owner.__roleScenario === undefined,
          stillOpen: !canceled.win.closed,
          listenersBefore: canceled.listenersBefore,
          listenersAfter: canceled.native.listenerCount('closed'),
        };
      });
      expect(state.scenarioCleared).toBe(true);
      expect(state.stillOpen).toBe(true);
      expect(state.listenersAfter).toBe(state.listenersBefore);
    } finally {
      await browser.executeObsidian(() => {
        const owner = window as Window & { __roleCloseCancellation?: CloseCancellation };
        const canceled = owner.__roleCloseCancellation;
        if (canceled === undefined) return;
        window.clearTimeout(canceled.recovery);
        if (!canceled.win.closed) {
          canceled.win.close = canceled.originalClose;
          canceled.originalClose();
        }
        delete owner.__roleCloseCancellation;
      });
      await browser.waitUntil(
        async () => {
          const handles = await browser.getWindowHandles();
          return (
            handles.length === handlesBefore.length &&
            handles.every((handle) => handlesBefore.includes(handle))
          );
        },
        { timeout: 10_000, timeoutMsg: 'Canceled native window survived test rollback' },
      );
    }
    await withRoleScenario('after canceled native close', async () => {
      await openRoleNote('reading');
      const glyph = await measureSurface('.markdown-preview-view p', 'ABCАБя0123', 'Role Baseline');
      expect(Math.abs(glyph.width - glyph.referenceWidth)).toBeLessThanOrEqual(0.5);
    });
  });
});
