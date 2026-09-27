import { browser } from '@wdio/globals';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

/** Called before scenario cleanup. Failure here must never replace the assertion error. */
export async function captureRoleFailure(testName: string): Promise<void> {
  const snapshot = await browser.executeObsidian(({ app, obsidian }) => {
    const plugin = (
      app.plugins as unknown as {
        plugins: Record<
          string,
          { settings: { roles: unknown; hardOverride: boolean } } | undefined
        >;
      }
    ).plugins['local-fonts'];
    const state = (
      window as Window & {
        __roleScenario?: {
          settingsDocument: Document | null;
          initialWindows: Window[];
          layout: { active?: string };
        };
      }
    ).__roleScenario;
    const windows =
      (
        app.workspace as unknown as {
          floatingSplit?: { children: Array<{ win: Window }> };
        }
      ).floatingSplit?.children ?? [];
    const documents = [
      document,
      state?.settingsDocument,
      ...windows.map((child) => child.win.document),
    ].filter((doc): doc is Document => doc !== null && doc !== undefined);
    return {
      appVersion: obsidian.apiVersion,
      platform: {
        desktop: obsidian.Platform.isDesktopApp,
        ios: obsidian.Platform.isIosApp,
        android: obsidian.Platform.isAndroidApp,
      },
      savedActiveLeaf: state?.layout.active ?? null,
      currentActiveLeaf:
        (app.workspace as unknown as { activeLeaf?: { id: string } }).activeLeaf?.id ?? null,
      roles: plugin?.settings.roles,
      hardOverride: plugin?.settings.hardOverride,
      documents: [...new Set(documents)].map((doc) => {
        const view = doc.defaultView;
        if (view === null) throw new Error('Evidence document has no window');
        const body = view.getComputedStyle(doc.body);
        const properties = [
          ...['text', 'interface', 'monospace'].flatMap((role) => [
            `--font-${role}`,
            `--font-${role}-override`,
            `--font-${role}-theme`,
          ]),
          ...[1, 2, 3, 4, 5, 6].map((level) => `--h${level}-font`),
          '--inline-title-font',
          '--table-header-font',
          '--metadata-label-font',
          '--metadata-input-font',
          '--file-header-font',
        ];
        return {
          main: doc === document,
          settings: doc === state?.settingsDocument,
          bodyClass: doc.body.className,
          inline: doc.body.getAttribute('style'),
          nativeFonts: Object.fromEntries(
            properties.map((property) => [property, body.getPropertyValue(property)]),
          ),
          computed: Array.from(
            doc.querySelectorAll(
              '.markdown-preview-view p, .markdown-preview-view h1, .cm-line.cm-active, .inline-title, .metadata-property-key-input, .metadata-input-longtext, .bases-view, .suggestion-item, .setting-item-name',
            ),
          ).map((element) => ({
            selector: `${element.tagName}.${element.className}`,
            text: element.textContent.slice(0, 150),
            font: view.getComputedStyle(element).font,
            visible: element.getClientRects().length > 0,
          })),
          fonts: Array.from(doc.fonts as unknown as Iterable<FontFace>).map((face) => ({
            family: face.family,
            status: face.status,
            weight: face.weight,
            style: face.style,
            unicodeRange: face.unicodeRange,
          })),
          markedStyles: Array.from(doc.head.querySelectorAll('style'))
            .filter((style) => style.textContent.includes('--local-fonts-sheet: 1'))
            .map((style) => style.textContent),
        };
      }),
    };
  });
  const directory = path.resolve(import.meta.dirname, '..', 'wdio-logs', 'role-failures');
  await mkdir(directory, { recursive: true });
  const identity = `${browser.sessionId}-${process.platform}-${snapshot.appVersion}-${testName}`
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 170);
  const stem = path.join(directory, `${identity}-${randomUUID()}`);
  await writeFile(
    `${stem}.json`,
    JSON.stringify(
      {
        testName,
        installerVersion: browser.getObsidianInstallerVersion(),
        harnessAppVersion: browser.getObsidianVersion(),
        capabilities: browser.capabilities,
        ...snapshot,
      },
      null,
      2,
    ),
  );
  await browser.saveScreenshot(`${stem}.png`);
}
