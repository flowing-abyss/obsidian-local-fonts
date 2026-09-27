import { browser } from '@wdio/globals';
import type { DataAdapter, WorkspaceLeaf } from 'obsidian';
import { quote } from '../../../src/fonts/family.js';
import type { PluginSettings, RoleAssignments } from '../../../src/settings.js';
import { captureRoleFailure } from './evidence.js';

export type NoteMode = 'reading' | 'live' | 'source';
export type TestDocument = 'main' | 'popout' | 'settings';
export interface GlyphObservation {
  width: number;
  referenceWidth: number;
  stack: string;
  fontSize: string;
}
interface FixtureFontPlugin {
  settings: PluginSettings;
  applyFonts(): void;
  saveSettings(): Promise<void>;
  scanQueue: Promise<void>;
}

export const EMPTY_ROLES: RoleAssignments = {
  text: null,
  interface: null,
  monospace: null,
  headings: null,
  emoji: null,
};
export const ROLE_FAMILIES: RoleAssignments = {
  text: 'Role Text',
  interface: 'Role Interface',
  monospace: 'Role Mono',
  headings: 'Role Headings',
  emoji: 'Role Emoji A',
};

// The public field is discouraged for navigation, but it is the read-only
// selection observation required here. getLeaf(false) can create/select a leaf.
export interface ActiveLeafWorkspace {
  readonly activeLeaf: WorkspaceLeaf | null;
}

export interface RoleCleanupObservation {
  savedActive: string | null;
  active: string | null;
  attached: boolean;
  connected: boolean;
  navigable: boolean;
  root: 'floating' | 'main' | 'other';
  windowOpen: boolean;
  nativeTransitions: Array<{ operation: string; durationMs: number; complete: boolean }>;
}

interface NativeRoleWindow {
  isDestroyed(): boolean;
  isFocused(): boolean;
  isVisible(): boolean;
  show(): void;
  once(event: 'closed', callback: () => void): void;
  removeListener(event: 'closed', callback: () => void): void;
}
interface ElectronRoleWindow extends Window {
  electronWindow: { id: number };
  electron: { remote: { BrowserWindow: { fromId(id: number): NativeRoleWindow | null } } };
}

interface RoleState {
  cleanupTrace?: Array<Record<string, unknown>>;
  originalPlugin: FixtureFontPlugin;
  persistence: {
    path: string;
    attempted: boolean;
    pending: Set<Promise<void>>;
    original: DataAdapter['write'];
    descriptor: PropertyDescriptor | undefined;
  };
  settings: PluginSettings;
  layout: unknown;
  bodyStyle: string | null;
  bodyClass: string | null;
  nativeStyle: HTMLStyleElement | null;
  leaves: Array<{ detach(): void }>;
  initialWindows: Window[];
  popoutWindow: Window | null;
  popoutStyles: Map<Window, string | null>;
  suggestion: { close(): void } | null;
  settingRow: HTMLElement | null;
  settingsDocument: Document | null;
  settingsOpened: boolean;
  closingSettingsRoot: HTMLElement | null;
}

/** Every renderer callback is self-contained: only arguments and { app, obsidian } cross the boundary. */
async function beginRoleScenario(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(({ app }) => {
        const plugin = (
          app.plugins as unknown as { plugins: Record<string, FixtureFontPlugin | undefined> }
        ).plugins['local-fonts'];
        const marked = Array.from(document.head.querySelectorAll('style')).some(
          (style) =>
            style.textContent.includes('--local-fonts-sheet: 1') &&
            style.textContent.includes('@font-face'),
        );
        return (
          marked &&
          plugin?.settings.cache?.faces.some((face) => face.family === 'Role Baseline') === true
        );
      }),
    { timeout: 20_000, timeoutMsg: 'Role fixture scan or marked stylesheet did not complete' },
  );
  await browser.executeObsidian(async ({ app }) => {
    const testWindow = window as Window & { __roleScenario?: RoleState };
    if (testWindow.__roleScenario !== undefined)
      throw new Error('A role scenario is already active');
    const plugin = (
      app.plugins as unknown as { plugins: Record<string, FixtureFontPlugin | undefined> }
    ).plugins['local-fonts'];
    if (plugin === undefined) throw new Error('Local Fonts is not enabled');
    const workspace = app.workspace as unknown as { getLayout(): unknown };
    // The scan updates memory before saving. Snapshot after its existing queue
    // settles so a startup save cannot be mistaken for scenario persistence.
    await plugin.scanQueue;
    const adapter = app.vault.adapter;
    const state: RoleState = {
      originalPlugin: plugin,
      persistence: {
        path: `${app.vault.configDir}/plugins/local-fonts/data.json`,
        attempted: false,
        pending: new Set(),
        original: adapter.write.bind(adapter),
        descriptor: Object.getOwnPropertyDescriptor(adapter, 'write'),
      },
      settings: JSON.parse(JSON.stringify(plugin.settings)) as PluginSettings,
      layout: workspace.getLayout(),
      bodyStyle: document.body.getAttribute('style'),
      bodyClass: document.body.getAttribute('class'),
      nativeStyle: null,
      leaves: [],
      initialWindows: (
        (workspace as unknown as { floatingSplit?: { children: Array<{ win: Window }> } })
          .floatingSplit?.children ?? []
      ).map((child) => child.win),
      popoutWindow: null,
      popoutStyles: new Map(),
      suggestion: null,
      settingRow: null,
      settingsDocument: null,
      settingsOpened: false,
      closingSettingsRoot: null,
    };
    testWindow.__roleScenario = state;
    // Observe the stable adapter boundary, including saves from a re-enabled
    // plugin instance or rescan. Count attempts before calling through, including
    // rejected writes, and retain in-flight operations until they settle.
    adapter.write = function (path, data, options) {
      const persistence = state.persistence;
      if (path !== persistence.path) return persistence.original.call(this, path, data, options);
      persistence.attempted = true;
      const pending = persistence.original.call(this, path, data, options);
      persistence.pending.add(pending);
      void pending.then(
        () => persistence.pending.delete(pending),
        () => persistence.pending.delete(pending),
      );
      return pending;
    };
    const style = new DOMParser()
      .parseFromString('<style data-role-test="native"></style>', 'text/html')
      .querySelector('style');
    if (style === null) throw new Error('Could not install the native baseline style');
    style.dataset['roleTest'] = 'native';
    state.nativeStyle = style;
    style.textContent =
      "body { --font-text-theme: 'Role Baseline'; --font-interface-theme: 'Role Baseline'; --font-monospace-theme: 'Role Baseline'; }";
    document.head.appendChild(document.adoptNode(style));
    plugin.settings.roles = {
      text: null,
      interface: null,
      monospace: null,
      headings: null,
      emoji: null,
    };
    plugin.settings.hardOverride = false;
    plugin.applyFonts();
  });
}

async function endRoleScenario(): Promise<void> {
  // eslint-disable-next-line complexity -- Self-contained renderer cleanup also snapshots the native restoration boundary.
  const result = await browser.executeObsidian(async ({ app }) => {
    const testWindow = window as Window & {
      __roleScenario?: RoleState;
      __roleCleanupObservation?: RoleCleanupObservation;
      __roleCleanupTrace?: Array<Record<string, unknown>>;
    };
    const state = testWindow.__roleScenario;
    if (state === undefined) return;
    const errors: unknown[] = [];
    const nativeTransitions: RoleCleanupObservation['nativeTransitions'] = [];
    // Keep the first attempt's stages if WebDriver retries a timed-out command.
    const trace = (state.cleanupTrace ??= []);
    const reentered = trace.length > 0;
    testWindow.__roleCleanupTrace = trace;
    const record = (stage: string, details: Record<string, unknown> = {}): void => {
      if (trace.length >= 40) return;
      try {
        const workspace = app.workspace as unknown as ActiveLeafWorkspace & {
          floatingSplit?: { children: Array<{ win: Window }> };
        };
        const floatingFocused = (workspace.floatingSplit?.children ?? []).map(
          ({ win }) => !win.closed && win.document.hasFocus(),
        );
        trace.push({
          stage,
          time: Date.now(),
          active: (workspace.activeLeaf as unknown as { id: string } | null)?.id ?? null,
          mainFocused: document.hasFocus(),
          floatingFocused,
          // WebDriver abbreviates nested arrays as [Array]; keep the decisive
          // same-workspace focus observation visible in the existing trace.
          anyFloatingFocused: floatingFocused.includes(true),
          ...details,
        });
      } catch (error) {
        trace.push({ stage, time: Date.now(), probeError: String(error) });
      }
    };
    record(reentered ? 'command reentered' : 'started');
    const nativeWindow = (win: Window): NativeRoleWindow | null =>
      (window as unknown as ElectronRoleWindow).electron.remote.BrowserWindow.fromId(
        (win as ElectronRoleWindow).electronWindow.id,
      );
    const awaitNativeEvent = async (
      operation: string,
      boundary: {
        subscribe(complete: () => void): void;
        unsubscribe(complete: () => void): void;
        request(): void;
        isComplete(): boolean;
      },
    ): Promise<void> => {
      let complete: () => void = () => {};
      let fail: (error: Error) => void = () => {};
      const event = new Promise<void>((resolve, reject) => {
        complete = resolve;
        fail = reject;
      });
      // Failure-only deadline, below the existing 60s case budget. Success still
      // requires the native event/observed state, never elapsed time.
      const deadline = window.setTimeout(() => {
        record(`native ${operation} deadline`);
        fail(new Error(`Timed out waiting for native ${operation}`));
      }, 10_000);
      try {
        boundary.subscribe(complete);
        boundary.request();
        if (boundary.isComplete()) complete();
        await event;
      } finally {
        window.clearTimeout(deadline);
        boundary.unsubscribe(complete);
      }
    };
    const closeNative = async (win: Window): Promise<void> => {
      const native = nativeWindow(win);
      if (native === null || native.isDestroyed()) return;
      const started = performance.now();
      record('close requested', { nativeId: (win as ElectronRoleWindow).electronWindow.id });
      await awaitNativeEvent('close', {
        subscribe(complete) {
          native.once('closed', complete);
        },
        unsubscribe(complete) {
          if (!native.isDestroyed()) native.removeListener('closed', complete);
        },
        request() {
          win.close();
        },
        isComplete: () => native.isDestroyed(),
      });
      record('native closed');
      nativeTransitions.push({
        operation: 'closed',
        durationMs: performance.now() - started,
        complete: native.isDestroyed(),
      });
    };
    const focusNative = async (win: Window): Promise<void> => {
      const native = nativeWindow(win);
      if (native === null) throw new Error('Restored native window disappeared');
      const started = performance.now();
      record('focus requested', {
        nativeId: (win as ElectronRoleWindow).electronWindow.id,
        nativeFocused: native.isFocused(),
        nativeVisible: native.isVisible(),
        targetDocumentFocused: win.document.hasFocus(),
      });
      await awaitNativeEvent('focus', {
        subscribe(complete) {
          win.addEventListener('focus', complete);
        },
        unsubscribe(complete) {
          win.removeEventListener('focus', complete);
        },
        request() {
          // Electron 18/macOS focus() ignores occluded windows. show() also
          // brings the saved test window forward, then the same native focus
          // event/document state below establishes completion.
          // https://www.electronjs.org/docs/latest/api/browser-window#winshow
          native.show();
          record('show returned', {
            nativeFocused: native.isFocused(),
            nativeVisible: native.isVisible(),
            targetDocumentFocused: win.document.hasFocus(),
          });
        },
        isComplete: () => win.document.hasFocus(),
      });
      record('native focused', {
        nativeFocused: native.isFocused(),
        targetDocumentFocused: win.document.hasFocus(),
      });
      nativeTransitions.push({
        operation: 'focused',
        durationMs: performance.now() - started,
        complete: win.document.hasFocus(),
      });
    };
    const clean = async (operation: () => void | Promise<void>): Promise<void> => {
      try {
        await operation();
      } catch (error) {
        errors.push(error);
      }
    };
    try {
      await clean(() => state.suggestion?.close());
      await clean(() => state.settingRow?.remove());
      if (state.settingsOpened) {
        await clean(() => {
          (app as unknown as { setting: { close(): void } }).setting.close();
        });
      }
      for (const [win, style] of state.popoutStyles)
        await clean(() => {
          if (win.closed) return;
          if (style === null) win.document.body.removeAttribute('style');
          else win.document.body.setAttribute('style', style);
        });
      const currentWindows =
        (app.workspace as unknown as { floatingSplit?: { children: Array<{ win: Window }> } })
          .floatingSplit?.children ?? [];
      for (const child of currentWindows.filter(
        (child) => !state.initialWindows.includes(child.win),
      ))
        // DOM close() initiates an asynchronous native close. Wait for the
        // actual closed event before layout/focus restoration (Electron docs):
        // https://www.electronjs.org/docs/latest/api/browser-window#event-closed
        await clean(() => closeNative(child.win));
      record('detach leaves');
      for (const leaf of state.leaves)
        await clean(() => {
          leaf.detach();
        });
      await clean(() => state.nativeStyle?.remove());
      await clean(() => {
        if (state.bodyStyle === null) document.body.removeAttribute('style');
        else document.body.setAttribute('style', state.bodyStyle);
        if (state.bodyClass === null) document.body.removeAttribute('class');
        else document.body.setAttribute('class', state.bodyClass);
      });
      const plugin = (
        app.plugins as unknown as { plugins: Record<string, FixtureFontPlugin | undefined> }
      ).plugins['local-fonts'];
      record('drain scenario persistence');
      await clean(async () => {
        // A rescan may not have reached saveSettings yet. Its queue belongs to
        // the instance, so drain both the original and any re-enabled instance.
        await state.originalPlugin.scanQueue;
        if (plugin !== undefined) await plugin.scanQueue;
        while (state.persistence.pending.size > 0)
          await Promise.allSettled([...state.persistence.pending]);
      });
      if (plugin !== undefined) {
        plugin.settings = state.settings;
        await clean(() => {
          plugin.applyFonts();
        });
      }
      if (state.persistence.attempted) {
        record('save settings');
        await clean(() =>
          plugin === undefined
            ? app.vault.adapter.write(
                state.persistence.path,
                JSON.stringify(state.settings, null, 2),
              )
            : plugin.saveSettings(),
        );
        record('settings saved');
      } else record('settings unchanged on disk');
      await clean(async () => {
        const workspace = app.workspace as typeof app.workspace & {
          setLayout(layout: unknown): Promise<void>;
          floatingSplit: unknown;
        };
        record('set layout', { preservedWindows: state.initialWindows.length });
        if (state.initialWindows.length === 0) {
          await workspace.setLayout(state.layout);
          record('layout restored');
          return;
        }
        // setLayout deserializes every saved floating window, even when its
        // original is still open. Preserve that live root instead of cloning it.
        const floating = workspace.floatingSplit;
        const layout = { ...(state.layout as Record<string, unknown>) };
        delete layout['floating'];
        try {
          await workspace.setLayout(layout);
        } finally {
          workspace.floatingSplit = floating;
        }
        record('layout restored');
        const active = layout['active'];
        if (typeof active === 'string') {
          const savedLeaves: WorkspaceLeaf[] = [];
          workspace.iterateAllLeaves((leaf) => {
            if ((leaf as unknown as { id: string }).id === active) savedLeaves.push(leaf);
          });
          const leaf = savedLeaves[0];
          if (leaf === undefined) throw new Error(`Saved active leaf ${active} was not restored`);
          const win = leaf.view.containerEl.ownerDocument.defaultView as ElectronRoleWindow | null;
          if (win === null) throw new Error('Restored leaf has no native window');
          // The public selection focus path has workspace/document focus gates;
          // request and await native focus after close completion explicitly.
          await focusNative(win);
          // Commit selection after native activation, which can itself dispatch
          // Obsidian focus handlers while the promise is pending.
          workspace.setActiveLeaf(leaf, { focus: true });
          record('selection restored');
        }
      });
    } finally {
      if (state.persistence.descriptor === undefined)
        Reflect.deleteProperty(app.vault.adapter, 'write');
      else Object.defineProperty(app.vault.adapter, 'write', state.persistence.descriptor);
      // Read activeLeaf directly. getLeaf(false) can select/create a different leaf
      // when this leaf is pinned or its view cannot navigate.
      // https://docs.obsidian.md/Reference/TypeScript+API/Workspace/activeLeaf
      const workspace = app.workspace as Omit<typeof app.workspace, 'activeLeaf'> &
        ActiveLeafWorkspace & {
          isAttached(leaf: unknown): boolean;
          floatingSplit: unknown;
        };
      const active = workspace.activeLeaf as
        | (NonNullable<typeof workspace.activeLeaf> & {
            id: string;
            containerEl: HTMLElement;
            canNavigate(): boolean;
          })
        | null;
      let root: RoleCleanupObservation['root'] = 'other';
      if (active?.getRoot() === workspace.floatingSplit) root = 'floating';
      if (active?.getRoot() === workspace.rootSplit) root = 'main';
      testWindow.__roleCleanupObservation = {
        savedActive: (state.layout as { active?: string }).active ?? null,
        active: active?.id ?? null,
        attached: workspace.isAttached(active),
        connected: active?.containerEl.isConnected ?? false,
        navigable: active?.canNavigate() ?? false,
        root,
        windowOpen: active?.containerEl.ownerDocument.defaultView?.closed === false,
        nativeTransitions,
      };
      delete testWindow.__roleScenario;
      record('finished');
    }
    // WebDriver retries rejected execute commands. Return the completed cleanup
    // result, then propagate its failure in Node so a retry cannot hide it.
    // Avoid a top-level `error` key too: WebDriver interprets it as a failed
    // protocol response even when the execute command itself succeeded.
    return {
      observation: testWindow.__roleCleanupObservation,
      trace,
      cleanupError:
        errors.length > 0 ? `Role scenario cleanup failed: ${errors.map(String).join('; ')}` : null,
    };
  });
  if (result?.cleanupError !== null && result?.cleanupError !== undefined)
    throw new Error(result.cleanupError);
}

export async function applyRoles(roles: RoleAssignments, hardOverride: boolean): Promise<void> {
  await browser.executeObsidian(
    ({ app }, values: RoleAssignments, hard: boolean) => {
      const plugin = (
        app.plugins as unknown as { plugins: Record<string, FixtureFontPlugin | undefined> }
      ).plugins['local-fonts'];
      if (plugin === undefined) throw new Error('Local Fonts is not enabled');
      plugin.settings.roles = { ...values };
      plugin.settings.hardOverride = hard;
      plugin.applyFonts();
    },
    roles,
    hardOverride,
  );
}

export async function openRoleNote(mode: NoteMode): Promise<void> {
  await browser.executeObsidian(async ({ app }, requested: NoteMode) => {
    const state = (window as Window & { __roleScenario?: RoleState }).__roleScenario;
    if (state === undefined) throw new Error('No role scenario is active');
    await app.workspace.openLinkText('Role title ABCАБя0123 😀 ☀️ 👩‍💻.md', '', true);
    const leaf = (app.workspace as unknown as ActiveLeafWorkspace).activeLeaf;
    if (leaf === null) throw new Error('Opened role note has no active leaf');
    state.leaves.push(leaf);
    const viewState = leaf.getViewState();
    await leaf.setViewState({
      ...viewState,
      state: {
        ...viewState.state,
        mode: requested === 'reading' ? 'preview' : 'source',
        source: requested === 'source',
      },
    });
  }, mode);
  const selector = mode === 'reading' ? '.markdown-preview-view p' : '.cm-content';
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(
        (_, css: string) =>
          Array.from(document.querySelectorAll(css)).some((el) =>
            el.textContent.includes('ABCАБя0123'),
          ),
        selector,
      ),
    { timeout: 10_000, timeoutMsg: `${mode} role note never rendered its sample` },
  );
}

/* eslint-disable complexity -- The serialized WebDriver callback measures one real text range with explicit guards. */
export async function measureSurface(
  selector: string,
  sample: string,
  referenceFamily: string,
  target: TestDocument = 'main',
): Promise<GlyphObservation> {
  const referenceFamilyCss = quote(referenceFamily);
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(
        (_, css: string, text: string, destination: TestDocument) => {
          const state = (window as Window & { __roleScenario?: RoleState }).__roleScenario;
          let doc: Document | null | undefined = document;
          if (destination === 'settings') doc = state?.settingsDocument;
          if (destination === 'popout') doc = state?.popoutWindow?.document;
          return (
            doc !== undefined &&
            doc !== null &&
            Array.from(doc.querySelectorAll(css)).some(
              (el) => el.getClientRects().length > 0 && el.textContent.includes(text),
            )
          );
        },
        selector,
        sample,
        target,
      ),
    {
      timeout: 10_000,
      timeoutMsg: `No ${target} element ${selector} contains ${JSON.stringify(sample)}`,
    },
  );
  return browser.executeObsidian(
    async (
      _,
      request: {
        css: string;
        text: string;
        family: string;
        familyCss: string;
        destination: TestDocument;
      },
    ) => {
      const { css, text, family, familyCss, destination } = request;
      const state = (window as Window & { __roleScenario?: RoleState }).__roleScenario;
      let doc: Document | null | undefined = document;
      if (destination === 'settings') doc = state?.settingsDocument;
      if (destination === 'popout') doc = state?.popoutWindow?.document;
      if (doc === undefined || doc === null)
        throw new Error(`No ${destination} document was opened by this role scenario`);
      const element = Array.from(doc.querySelectorAll(css)).find(
        (el) => el.getClientRects().length > 0 && el.textContent.includes(text),
      );
      if (element === undefined)
        throw new Error(`No ${destination} element ${css} contains ${JSON.stringify(text)}`);
      element.scrollIntoView({ block: 'center' });
      await new Promise<void>((resolve) =>
        doc.defaultView?.requestAnimationFrame(() => {
          resolve();
        }),
      );
      const walker = doc.createTreeWalker(element, 4);
      let node: Node | null = walker.nextNode();
      while (node !== null && !(node.nodeValue?.includes(text) ?? false)) node = walker.nextNode();
      if (node?.parentElement == null || node.nodeValue === null)
        throw new Error(`No text node in ${css} contains ${JSON.stringify(text)}`);
      if (doc.defaultView === null) throw new Error(`${destination} document has no window`);
      const start = node.nodeValue.indexOf(text);
      const computed = doc.defaultView.getComputedStyle(node.parentElement);
      const reference = doc.body.createSpan();
      reference.textContent = text;
      for (const [property, value] of Object.entries({
        position: 'fixed',
        left: '-10000px',
        'white-space': 'pre',
      }))
        reference.style.setProperty(property, value);
      for (const property of [
        'font-size',
        'font-style',
        'font-weight',
        'font-stretch',
        'font-feature-settings',
        'font-variation-settings',
        'letter-spacing',
        'word-spacing',
      ])
        reference.style.setProperty(property, computed.getPropertyValue(property));
      reference.style.setProperty('font-family', familyCss, 'important');
      doc.body.appendChild(reference);
      try {
        const referenceStack = doc.defaultView.getComputedStyle(reference).fontFamily;
        if (referenceStack.replace(/^(['"])(.*)\1$/, '$2') !== family) {
          throw new Error(`Reference family was overridden: ${referenceStack}`);
        }
        const metrics = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize}`;
        await doc.fonts.load(`${metrics} ${computed.fontFamily}`, text);
        await doc.fonts.load(`${metrics} ${familyCss}`, text);
        const range = doc.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + text.length);
        if (range.getBoundingClientRect().width === 0)
          throw new Error(`Zero-width visible text range in ${css}`);
        return {
          width: range.getBoundingClientRect().width,
          referenceWidth: reference.getBoundingClientRect().width,
          stack: computed.fontFamily,
          fontSize: computed.fontSize,
        };
      } finally {
        reference.remove();
      }
    },
    {
      css: selector,
      text: sample,
      family: referenceFamily,
      familyCss: referenceFamilyCss,
      destination: target,
    },
  );
}
/* eslint-enable complexity -- The measurement callback ends here. */

export async function setNativeTestCss(css: string): Promise<void> {
  await browser.executeObsidian((_, value: string) => {
    const style = (window as Window & { __roleScenario?: RoleState }).__roleScenario?.nativeStyle;
    if (style === undefined || style === null) throw new Error('No native test style is active');
    style.textContent = value;
  }, css);
}

export async function setNativeInlineFonts(values: Record<string, string | null>): Promise<void> {
  await browser.executeObsidian((_, entries: Record<string, string | null>) => {
    if ((window as Window & { __roleScenario?: RoleState }).__roleScenario === undefined)
      throw new Error('No role scenario is active');
    for (const [name, value] of Object.entries(entries)) {
      if (!name.startsWith('--font-')) throw new Error(`Unexpected native font property ${name}`);
      if (value === null) document.body.style.removeProperty(name);
      else document.body.style.setProperty(name, value);
    }
  }, values);
}

export async function openRoleSuggestion(): Promise<void> {
  await browser.executeObsidian(({ app, obsidian }) => {
    const state = (window as Window & { __roleScenario?: RoleState }).__roleScenario;
    if (state === undefined) throw new Error('No role scenario is active');
    class RoleSuggestion extends obsidian.SuggestModal<string> {
      getSuggestions(): string[] {
        return ['ABCАБя0123 😀 ☀️ 👩‍💻'];
      }
      renderSuggestion(value: string, element: HTMLElement): void {
        element.setText(value);
      }
      onChooseSuggestion(): void {
        /* The test only needs the native suggestion surface. */
      }
    }
    const modal = new RoleSuggestion(app);
    state.suggestion = modal;
    modal.open();
    modal.inputEl.value = 'ABC';
    modal.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(
        () =>
          document.querySelector('.suggestion-item')?.textContent.includes('ABCАБя0123') === true,
      ),
    { timeout: 10_000, timeoutMsg: 'Native role suggestion did not render' },
  );
}

export async function closeRoleSuggestion(): Promise<void> {
  await browser.executeObsidian(() => {
    const state = (window as Window & { __roleScenario?: RoleState }).__roleScenario;
    state?.suggestion?.close();
    if (state !== undefined) state.suggestion = null;
  });
}

interface FixtureSettings {
  open(): void;
  close(): void;
  openTabById(id: string): void;
  tabContentContainer?: HTMLElement;
  activeTab?: { containerEl: HTMLElement; refreshInFlight?: boolean };
}

/** Wait for the old displayed document/root to close before a subsequent open. */
export async function closeRoleSettings(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const state = (window as Window & { __roleScenario?: RoleState }).__roleScenario;
    if (state === undefined) throw new Error('No role scenario is active');
    const setting = (app as unknown as { setting: FixtureSettings }).setting;
    const current = setting.tabContentContainer;
    state.closingSettingsRoot =
      current !== undefined && current.getClientRects().length > 0
        ? current
        : (setting.activeTab?.containerEl ?? null);
    setting.close();
  });
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(() => {
        const root = (window as Window & { __roleScenario?: RoleState }).__roleScenario
          ?.closingSettingsRoot;
        return root == null || !root.isConnected || root.ownerDocument.defaultView?.closed === true;
      }),
    { timeout: 10_000, timeoutMsg: 'The displayed Local Fonts settings root did not close' },
  );
  await browser.executeObsidian(() => {
    const state = (window as Window & { __roleScenario?: RoleState }).__roleScenario;
    if (state === undefined) throw new Error('No role scenario is active');
    state.closingSettingsRoot = null;
    state.settingsOpened = false;
  });
}

export async function openRoleSettings(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const state = (window as Window & { __roleScenario?: RoleState }).__roleScenario;
    if (state === undefined) throw new Error('No role scenario is active');
    const setting = (app as unknown as { setting: FixtureSettings }).setting;
    setting.open();
    state.settingsOpened = true;
    setting.openTabById('local-fonts');
  });
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(({ app }) => {
        const setting = (app as unknown as { setting: FixtureSettings }).setting;
        const current = setting.tabContentContainer;
        const root =
          current !== undefined && current.getClientRects().length > 0
            ? current
            : setting.activeTab?.containerEl;
        return (
          root?.isConnected === true &&
          setting.activeTab?.refreshInFlight === false &&
          Array.from(root.querySelectorAll('button')).some(
            (button) => button.textContent === 'Check' && button.getClientRects().length > 0,
          )
        );
      }),
    { timeout: 10_000, timeoutMsg: 'Current Local Fonts settings Check did not become ready' },
  );
  await browser.executeObsidian(({ app, obsidian }) => {
    const state = (window as Window & { __roleScenario?: RoleState }).__roleScenario;
    if (state === undefined) throw new Error('No role scenario is active');
    const setting = (app as unknown as { setting: FixtureSettings }).setting;
    const displayed =
      setting.tabContentContainer !== undefined &&
      setting.tabContentContainer.getClientRects().length > 0
        ? setting.tabContentContainer
        : setting.activeTab?.containerEl;
    if (
      displayed === undefined ||
      !displayed.isConnected ||
      displayed.getClientRects().length === 0
    ) {
      throw new Error('Local Fonts settings tab has no visible content');
    }
    const sample = 'ABCАБя0123 😀 ☀️ 👩‍💻';
    const row = new obsidian.Setting(displayed).setName(sample);
    row.settingEl.addClass('role-test-setting');
    state.settingRow = row.settingEl;
    state.settingsDocument = displayed.ownerDocument;
  });
}

export async function withRoleScenario(
  testName: string,
  assertions: () => Promise<void>,
): Promise<void> {
  try {
    await beginRoleScenario();
    await assertions();
  } catch (error) {
    await captureRoleFailure(testName).catch(() => undefined);
    throw error;
  } finally {
    await endRoleScenario();
  }
}

/** Select the newly created window by identity, even when another role pop-out exists. */
export async function openRolePopout(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const state = (window as Window & { __roleScenario?: RoleState }).__roleScenario;
    if (state === undefined) throw new Error('No role scenario is active');
    const workspace = app.workspace as unknown as {
      floatingSplit: { children: Array<{ win: Window }> };
    };
    const before = workspace.floatingSplit.children.map((child) => child.win);
    await app.workspace.openLinkText('Role title ABCАБя0123 😀 ☀️ 👩‍💻.md', '', 'window');
    const created = workspace.floatingSplit.children.find((child) => !before.includes(child.win));
    if (created === undefined) throw new Error('Role pop-out did not create a new window');
    state.popoutWindow = created.win;
    state.popoutStyles.set(created.win, created.win.document.body.getAttribute('style'));
    const leaf = app.workspace
      .getLeavesOfType('markdown')
      .find((candidate) => candidate.view.containerEl.ownerDocument === created.win.document);
    if (leaf === undefined) throw new Error('New pop-out has no Markdown leaf');
    const current = leaf.getViewState();
    await leaf.setViewState({ ...current, state: { ...current.state, mode: 'preview' } });
  });
}

export async function setPopoutNativeFonts(values: Record<string, string | null>): Promise<void> {
  await browser.executeObsidian((_, entries: Record<string, string | null>) => {
    const win = (window as Window & { __roleScenario?: RoleState }).__roleScenario?.popoutWindow;
    if (win === undefined || win === null || win.closed)
      throw new Error('No selected role pop-out');
    for (const [name, value] of Object.entries(entries)) {
      if (!name.startsWith('--font-')) throw new Error(`Unexpected native font property ${name}`);
      if (value === null) win.document.body.style.removeProperty(name);
      else win.document.body.style.setProperty(name, value);
    }
  }, values);
}

/** Switch between windows already created by this scenario without consulting the active leaf. */
export async function selectRolePopout(index: number): Promise<void> {
  await browser.executeObsidian((_, requested: number) => {
    const state = (window as Window & { __roleScenario?: RoleState }).__roleScenario;
    const win = [...(state?.popoutStyles.keys() ?? [])][requested];
    if (state === undefined || win === undefined || win.closed)
      throw new Error('Unknown role pop-out index');
    state.popoutWindow = win;
  }, index);
}
