import { browser } from '@wdio/globals';
import { quote } from '../../../src/fonts/family.js';
import type { PluginSettings, RoleAssignments } from '../../../src/settings.js';

export type NoteMode = 'reading' | 'live' | 'source';
export type TestDocument = 'main' | 'popout' | 'settings';
export interface GlyphObservation {
  width: number;
  referenceWidth: number;
  stack: string;
  fontSize: string;
}
export interface FixtureFontPlugin {
  settings: PluginSettings;
  applyFonts(): void;
  saveSettings(): Promise<void>;
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

interface RoleState {
  settings: PluginSettings;
  layout: unknown;
  bodyStyle: string | null;
  bodyClass: string | null;
  nativeStyle: HTMLStyleElement | null;
  leaves: Array<{ detach(): void }>;
  initialWindows: Window[];
  suggestion: { close(): void } | null;
  settingRow: HTMLElement | null;
  settingsDocument: Document | null;
  settingsOpened: boolean;
}

/** Every renderer callback is self-contained: only arguments and { app, obsidian } cross the boundary. */
export async function beginRoleScenario(): Promise<void> {
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
    const state: RoleState = {
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
      suggestion: null,
      settingRow: null,
      settingsDocument: null,
      settingsOpened: false,
    };
    testWindow.__roleScenario = state;
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

export async function endRoleScenario(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const testWindow = window as Window & { __roleScenario?: RoleState };
    const state = testWindow.__roleScenario;
    if (state === undefined) return;
    const errors: unknown[] = [];
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
      const currentWindows =
        (app.workspace as unknown as { floatingSplit?: { children: Array<{ win: Window }> } })
          .floatingSplit?.children ?? [];
      for (const child of currentWindows.filter(
        (child) => !state.initialWindows.includes(child.win),
      ))
        await clean(() => {
          child.win.close();
        });
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
      if (plugin !== undefined) {
        plugin.settings = state.settings;
        await clean(() => plugin.saveSettings());
        await clean(() => {
          plugin.applyFonts();
        });
      }
      await clean(() =>
        (app.workspace as unknown as { setLayout(layout: unknown): Promise<void> }).setLayout(
          state.layout,
        ),
      );
    } finally {
      delete testWindow.__roleScenario;
    }
    if (errors.length > 0)
      throw new Error(`Role scenario cleanup failed: ${errors.map(String).join('; ')}`);
  });
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
    const leaf = app.workspace.getLeaf(false);
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
  if (target === 'popout') {
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(({ app }) => {
          const state = (window as Window & { __roleScenario?: RoleState }).__roleScenario;
          if (state === undefined) throw new Error('No role scenario is active');
          const windows =
            (app.workspace as unknown as { floatingSplit?: { children: Array<{ win: Window }> } })
              .floatingSplit?.children ?? [];
          return windows.some((child) => !state.initialWindows.includes(child.win));
        }),
      { timeout: 10_000, timeoutMsg: 'No new pop-out was opened by this role scenario' },
    );
  }
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(
        ({ app }, css: string, text: string, destination: TestDocument) => {
          const state = (window as Window & { __roleScenario?: RoleState }).__roleScenario;
          let doc: Document | null | undefined = document;
          if (destination === 'settings') doc = state?.settingsDocument;
          if (destination === 'popout') {
            const windows =
              (app.workspace as unknown as { floatingSplit?: { children: Array<{ win: Window }> } })
                .floatingSplit?.children ?? [];
            const opened = windows.find(
              (child) => state !== undefined && !state.initialWindows.includes(child.win),
            );
            doc = opened?.win.document;
          }
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
      { app },
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
      if (destination === 'popout') {
        const windows =
          (app.workspace as unknown as { floatingSplit?: { children: Array<{ win: Window }> } })
            .floatingSplit?.children ?? [];
        const opened = windows.find(
          (child) => state !== undefined && !state.initialWindows.includes(child.win),
        );
        doc = opened?.win.document;
      }
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

export async function openRoleSettings(): Promise<void> {
  await browser.executeObsidian(({ app, obsidian }) => {
    const state = (window as Window & { __roleScenario?: RoleState }).__roleScenario;
    if (state === undefined) throw new Error('No role scenario is active');
    const setting = (
      app as unknown as {
        setting: {
          open(): void;
          openTabById(id: string): void;
          tabContentContainer?: HTMLElement;
          activeTab?: { containerEl: HTMLElement };
        };
      }
    ).setting;
    setting.open();
    state.settingsOpened = true;
    setting.openTabById('local-fonts');
    const displayed =
      setting.tabContentContainer !== undefined &&
      setting.tabContentContainer.getClientRects().length > 0
        ? setting.tabContentContainer
        : setting.activeTab?.containerEl;
    if (displayed === undefined || displayed.getClientRects().length === 0) {
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
  _testName: string,
  assertions: () => Promise<void>,
): Promise<void> {
  try {
    await beginRoleScenario();
    await assertions();
  } finally {
    await endRoleScenario();
  }
}
