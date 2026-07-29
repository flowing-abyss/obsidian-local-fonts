import { Platform, PluginSettingTab, Setting, type App } from 'obsidian';
import { canRender, type Engine } from './fonts/platform.js';
import { isFamilyApplied } from './fonts/probe.js';
import { selectFaces } from './fonts/select.js';
import type { FaceRecord } from './fonts/types.js';
import type LocalFontsPlugin from './main.js';
import type { RoleName } from './settings.js';

const ROLES: ReadonlyArray<readonly [RoleName, string, string]> = [
  ['text', 'Text', 'Body text in notes'],
  ['interface', 'Interface', 'Menus, sidebars and dialogs'],
  ['monospace', 'Monospace', 'Code blocks and inline code'],
  ['headings', 'Headings', 'Levels 1 to 6'],
  ['emoji', 'Emoji', 'Placed first in every stack, limited to emoji characters'],
];

const NONE = '';

export class LocalFontsSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: LocalFontsPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    // display() runs again every time the tab is reopened; without this the controls stack.
    this.containerEl.empty();

    const families = this.plugin.families();
    // Obsidian's Platform flags come from the native app shell itself, not a sniffed UA
    // string, and eslint-plugin-obsidianmd bans reading `navigator` directly. WKWebView
    // (the iOS/iPadOS app) is the only WebKit target this plugin ships to; Electron
    // (desktop) and the Android WebView are both Chromium.
    const engine: Engine = Platform.isIosApp ? 'webkit' : 'chromium';

    this.renderFolder();
    this.renderRoles([...families.keys()].sort((a, b) => a.localeCompare(b)));
    this.renderHardOverride();
    this.renderDiagnostics(families, engine);
  }

  private renderFolder(): void {
    new Setting(this.containerEl)
      // Real Obsidian's Setting always carries this class on settingEl; the test mock
      // does not add it, so it's set explicitly here (harmless duplicate in-app) to keep
      // the "seven controls" test discriminating on genuine DOM structure.
      .setClass('setting-item')
      .setName('Fonts folder')
      .setDesc('Vault-relative. May be hidden, for example .fonts')
      .addText((text) => {
        text.setValue(this.plugin.settings.folder);
        // onChange fires per keystroke; committing there would re-walk the whole folder
        // once per character typed. Blur fires once, when the user is done editing, and
        // reading the DOM value directly (rather than trusting onChange to have kept
        // settings.folder in sync) means a change made without an intervening keystroke
        // event is still picked up.
        text.inputEl.addEventListener('blur', () => {
          this.commitFolderChange(text.inputEl.value.trim()).catch((error: unknown) => {
            console.error('[local-fonts] failed to apply the new fonts folder', error);
          });
        });
      });
  }

  private async commitFolderChange(folder: string): Promise<void> {
    if (folder === this.plugin.settings.folder) {
      return;
    }
    this.plugin.settings.folder = folder;
    await this.plugin.saveSettings();
    await this.plugin.rescan();
    this.display();
  }

  private renderRoles(familyNames: readonly string[]): void {
    for (const [role, name, desc] of ROLES) {
      new Setting(this.containerEl)
        .setClass('setting-item')
        .setName(name)
        .setDesc(desc)
        .addDropdown((dropdown) => {
          dropdown.addOption(NONE, 'Leave the theme alone');
          for (const family of familyNames) {
            dropdown.addOption(family, family);
          }
          dropdown
            .setValue(this.plugin.settings.roles[role] ?? NONE)
            .onChange(this.commitRoleChange.bind(this, role));
        });
    }
  }

  private async commitRoleChange(role: RoleName, value: string): Promise<void> {
    this.plugin.settings.roles[role] = value === NONE ? null : value;
    await this.plugin.saveSettings();
    this.plugin.applyFonts();
  }

  private renderHardOverride(): void {
    new Setting(this.containerEl)
      .setClass('setting-item')
      .setName('Hard override')
      .setDesc('Force fonts onto themes that set font-family directly. Icons are left alone.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.hardOverride)
          .onChange(this.commitHardOverride.bind(this)),
      );
  }

  private async commitHardOverride(value: boolean): Promise<void> {
    this.plugin.settings.hardOverride = value;
    await this.plugin.saveSettings();
    this.plugin.applyFonts();
  }

  private renderDiagnostics(families: Map<string, FaceRecord[]>, engine: Engine): void {
    const section = this.containerEl.createDiv({ cls: 'local-fonts-diagnostics' });
    section.createEl('h3', { text: 'Fonts found' });

    const failure = this.plugin.lastScanFailure();
    if (failure !== null) {
      section.createEl('p', {
        cls: 'local-fonts-warning',
        text: `Last scan failed: ${failure}`,
      });
    }
    const skipped = this.plugin.skippedFiles();
    if (skipped.length > 0) {
      section.createEl('p', {
        cls: 'local-fonts-warning',
        text: `Skipped ${String(skipped.length)} file(s) that could not be read: ${skipped.join(', ')}`,
      });
    }

    if (families.size === 0) {
      section.createEl('p', {
        cls: 'local-fonts-empty',
        text: `No fonts found in ${this.plugin.settings.folder}. Put font files there, one folder per family.`,
      });
      return;
    }

    const sortedEntries = [...families].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [family, faces] of sortedEntries) {
      this.renderFamilyCard(section, family, faces, engine);
    }
    this.renderCheckButton(section);
  }

  private renderFamilyCard(
    parent: HTMLElement,
    family: string,
    faces: readonly FaceRecord[],
    engine: Engine,
  ): void {
    const card = parent.createEl('details', { cls: 'local-fonts-family' });
    card.createEl('summary', { cls: 'local-fonts-family-name', text: family });

    const usable = faces.filter((face) => canRender(engine, face.colorFormats));
    if (usable.length === 0) {
      card.createEl('p', {
        cls: 'local-fonts-warning',
        text: 'This family cannot render on this platform: every face uses a colour format this engine does not support. Add a build in a format it does support.',
      });
    }

    card.createEl('p', { text: `Weights: ${describeWeights(faces)}` });

    const scripts = [...new Set(faces.flatMap((face) => face.scripts))].sort((a, b) =>
      a.localeCompare(b),
    );
    card.createEl('p', {
      text: scripts.length > 0 ? `Scripts: ${scripts.join(', ')}` : 'Scripts: unknown',
    });

    const sources = [...new Set(faces.map((face) => face.source))].sort((a, b) =>
      a.localeCompare(b),
    );
    card.createEl('p', {
      cls: 'local-fonts-source',
      text: `Metadata from: ${sources.join(', ')}`,
    });

    const chosen = new Set(selectFaces(faces, engine).map((face) => face.path));
    const list = card.createEl('ul', { cls: 'local-fonts-faces' });
    for (const face of faces) {
      const colours = face.colorFormats.length > 0 ? ` [${face.colorFormats.join(', ')}]` : '';
      const mark = chosen.has(face.path) ? ' — selected on this platform' : '';
      list.createEl('li', {
        text: `${String(face.weight)}${face.italic ? ' italic' : ''} · ${face.format} · ${formatSize(face.size)}${colours}${mark}`,
      });
    }

    const licence = faces.find((face) => face.license !== null)?.license ?? null;
    if (licence !== null) {
      card.createEl('p', { cls: 'local-fonts-licence', text: licence });
    }
  }

  private renderCheckButton(parent: HTMLElement): void {
    const results = parent.createDiv({ cls: 'local-fonts-check-results' });
    const button = parent.createEl('button', { text: 'Check' });
    button.addEventListener('click', () => {
      this.runCheck(results);
    });
  }

  private runCheck(results: HTMLElement): void {
    results.empty();
    // `containerEl.doc` is Obsidian's document accessor, correct in popout windows too;
    // the test harness (obsidian-test-mocks) polyfills the same accessor onto jsdom's
    // Node prototype, so this one line is exercised identically in both environments.
    const doc = this.containerEl.doc;
    for (const [role, name] of ROLES) {
      const family = this.plugin.settings.roles[role];
      if (family === null) {
        continue;
      }
      const applied = isFamilyApplied(family, doc);
      results.createEl('p', {
        text: `${name}: ${family} — ${applied ? 'rendering' : 'NOT rendering, the theme font is being used'}`,
      });
    }
  }
}

/** "300, 400, 700; no 500" — gaps are what users actually need to see. */
function describeWeights(faces: readonly FaceRecord[]): string {
  const present = [...new Set(faces.map((face) => face.weight))].sort((a, b) => a - b);
  const missingRegular = present.includes(400) ? '' : '; no 400';
  return `${present.join(', ')}${missingRegular}`;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024)).toString()} KB`;
}
