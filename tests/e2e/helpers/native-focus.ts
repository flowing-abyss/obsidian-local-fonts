import { browser } from '@wdio/globals';
import type { ActiveLeafWorkspace } from './roles.js';

/** Exercise the cached official app's native focus callbacks, awaiting their actual
 * completion rather than sleeping past an assumed timer delay. */
export async function observeNativeFocusBoundary(): Promise<{
  before: string | null;
  active: string | null;
  callbacks: Array<{ root: string; focused: boolean; active: string | null }>;
}> {
  return browser.executeObsidian(async ({ app }) => {
    type Container = { doc: Document; onFocus(): void };
    const workspace = app.workspace as unknown as ActiveLeafWorkspace & {
      rootSplit: Container;
      floatingSplit: { children: Container[] };
    };
    const callbacks: Array<{ root: string; focused: boolean; active: string | null }> = [];
    const before = (workspace.activeLeaf as unknown as { id: string } | null)?.id ?? null;
    const timerHost = window as unknown as {
      setTimeout(handler: TimerHandler, delay?: number, ...args: unknown[]): number;
    };
    const pending: Array<Promise<void>> = [];
    for (const [root, container] of [
      ['main', workspace.rootSplit],
      ...workspace.floatingSplit.children.map((child) => ['floating', child] as const),
    ] as const) {
      // Intercept only the synchronous scheduling done by onFocus, restoring the
      // timer immediately. The real app callback still runs after its own delay.
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Restored by identity and invoked with the window receiver.
      const original = timerHost.setTimeout;
      try {
        timerHost.setTimeout = (handler, delay, ...args) => {
          let complete: () => void = () => {};
          pending.push(
            new Promise<void>((resolve) => {
              complete = resolve;
            }),
          );
          return original.call(
            window,
            () => {
              try {
                if (typeof handler !== 'function')
                  throw new Error('Native focus callback is not a function');
                const focused = container.doc.hasFocus();
                Reflect.apply(handler as (...values: unknown[]) => unknown, window, args);
                callbacks.push({
                  root,
                  focused,
                  active: (workspace.activeLeaf as unknown as { id: string } | null)?.id ?? null,
                });
              } finally {
                complete();
              }
            },
            delay,
          );
        };
        container.onFocus();
      } finally {
        timerHost.setTimeout = original;
      }
    }
    await Promise.all(pending);
    if (callbacks.length === 0) throw new Error('Native focus callback was not observed');
    return {
      before,
      active: (workspace.activeLeaf as unknown as { id: string } | null)?.id ?? null,
      callbacks,
    };
  });
}
