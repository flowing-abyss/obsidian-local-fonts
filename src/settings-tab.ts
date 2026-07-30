import { Platform, PluginSettingTab, Setting, type App } from 'obsidian';
import { quote } from './fonts/css.js';
import { canRender, OS_ENGINES, SUPPORTED_OSES, type Engine, type OS } from './fonts/platform.js';
import { isFamilyApplied } from './fonts/probe.js';
import { explainSelection, type FaceVerdict, type SelectionReason } from './fonts/select.js';
import type { FaceRecord, VariableAxis } from './fonts/types.js';
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

const OS_LABELS: Record<OS, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
};

/**
 * Which OS this device is running, for the diagnostics card's "you are here" marker.
 *
 * `Platform.isMacOS` alone can't tell macOS apart from iOS/iPadOS: Obsidian's own docs
 * say it is also true "on a device that pretends to be one (like iPhones and iPads)".
 * Checking `isIosApp`/`isAndroidApp`/`isWin`/`isLinux` first and falling back to macOS
 * sidesteps that ambiguity entirely.
 */
function currentOS(): OS {
  if (Platform.isIosApp) {
    return 'ios';
  }
  if (Platform.isAndroidApp) {
    return 'android';
  }
  if (Platform.isWin) {
    return 'windows';
  }
  if (Platform.isLinux) {
    return 'linux';
  }
  return 'macos';
}

export class LocalFontsSettingTab extends PluginSettingTab {
  /**
   * `runCheck` is async (it awaits each family's font load before measuring — see
   * `isFamilyApplied`), so a second click before the first run finishes would race
   * it: the second run's `results.empty()` can execute before the first run has
   * finished appending its rows, leaving both runs' rows behind instead of just the
   * second's. Ignoring a click while one is already in flight is simpler and safer
   * than trying to make two concurrent DOM-mutating runs commute.
   */
  private checkInFlight = false;

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
    this.renderRoles(
      [...families.keys()].sort((a, b) => a.localeCompare(b)),
      [...families]
        .filter(([, faces]) => faces.some((face) => face.colorFormats.length > 0))
        .map(([family]) => family)
        .sort((a, b) => a.localeCompare(b)),
    );
    this.renderHardOverride();
    this.renderDiagnostics(families, engine);
  }

  /** Every one of the seven controls goes through here, so the class that keeps the
   *  "exactly seven controls" test meaningful is applied in exactly one place. */
  private newControl(name: string, desc: string): Setting {
    return (
      new Setting(this.containerEl)
        // Real Obsidian's Setting always carries this class on settingEl; the test mock
        // does not add it, so it's set explicitly here (harmless duplicate in-app) to keep
        // the "seven controls" test discriminating on genuine DOM structure.
        .setClass('setting-item')
        .setName(name)
        .setDesc(desc)
    );
  }

  private renderFolder(): void {
    this.newControl('Fonts folder', 'Vault-relative. May be hidden, for example .fonts').addText(
      (text) => {
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
      },
    );
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

  /**
   * The Emoji role is filtered to families with at least one colour-glyph face —
   * only those are plausible emoji fonts. `scripts.includes('emoji')` is not used
   * for this: that probe covers U+2600-26FF (miscellaneous symbols), which ordinary
   * text fonts also cover, so it would let nearly everything through. The other
   * four roles are unfiltered.
   */
  private renderRoles(familyNames: readonly string[], emojiFamilyNames: readonly string[]): void {
    for (const [role, name, desc] of ROLES) {
      const isEmoji = role === 'emoji';
      const options = isEmoji ? emojiFamilyNames : familyNames;
      const description =
        isEmoji && emojiFamilyNames.length === 0
          ? 'No colour-emoji font found in the folder — add one with COLR, CBDT, sbix or SVG glyphs to enable this role.'
          : desc;

      this.newControl(name, description).addDropdown((dropdown) => {
        dropdown.addOption(NONE, 'Leave the theme alone');
        for (const family of options) {
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
    this.newControl(
      'Hard override',
      'Force fonts onto themes that set font-family directly. Icons are left alone.',
    ).addToggle((toggle) =>
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
    const badgesRow = renderOsBadges(card, faces);
    renderSample(card, family, badgesRow);

    const verdicts = explainSelection(faces, engine);
    const usable = faces.filter((face) => verdicts.get(face.path)?.status !== 'unrenderable');
    if (usable.length === 0) {
      card.createEl('p', {
        cls: 'local-fonts-warning',
        text: 'This family cannot render on this platform: every face uses a colour format this engine does not support. Add a build in a format it does support.',
      });
    }

    renderWeightChips(card, faces);

    const scripts = [...new Set(faces.flatMap((face) => face.scripts))].sort((a, b) =>
      a.localeCompare(b),
    );
    card.createEl('p', {
      text: scripts.length > 0 ? `Scripts: ${scripts.join(', ')}` : 'Scripts: unknown',
    });

    const list = card.createEl('ul', { cls: 'local-fonts-faces' });
    for (const face of faces) {
      // Always present: `verdicts` was built from this exact `faces` array.
      const verdict = verdicts.get(face.path) ?? { status: 'unrenderable' as const };
      renderFaceRow(list, face, verdict);
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
      if (this.checkInFlight) {
        return;
      }
      this.checkInFlight = true;
      this.runCheck(results)
        .catch((error: unknown) => {
          console.error('[local-fonts] check failed', error);
        })
        .finally(() => {
          this.checkInFlight = false;
        });
    });
  }

  /**
   * `isFamilyApplied` is async because it awaits `document.fonts.load` first — a face
   * using `font-display: swap` (every face this plugin emits) is not fetched until
   * something on screen has used it, so measuring before that would report a
   * correctly-configured-but-not-yet-used family as absent.
   */
  private async runCheck(results: HTMLElement): Promise<void> {
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
      const applied = await isFamilyApplied(family, doc);
      results.createEl('p', {
        text: `${name}: ${family} — ${applied ? 'rendering' : 'NOT rendering, the theme font is being used'}`,
      });
    }
  }
}

/**
 * Whether at least one of the family's faces can render on the engine `os` runs.
 * Reuses `canRender` (the same rule `selectFaces`/`explainSelection` use) rather than
 * reimplementing the capability matrix here — this file must never decide what a
 * platform can draw on its own.
 */
function familySupportsOS(faces: readonly FaceRecord[], os: OS): boolean {
  const engine = OS_ENGINES[os];
  return faces.some((face) => canRender(engine, face.colorFormats));
}

/**
 * One pill per OS this plugin ships to, green when at least one face renders there and
 * red otherwise. Colour alone never carries the meaning: each pill's own text says
 * "supported"/"not supported" too, so it reads the same to a colour-blind user. The
 * OS matching this device gets `local-fonts-os-current` plus a `title`, a marker that
 * is deliberately not a third colour.
 */
function renderOsBadges(card: HTMLElement, faces: readonly FaceRecord[]): HTMLElement {
  const here = currentOS();
  const row = card.createDiv({ cls: 'local-fonts-os-badges' });
  for (const os of SUPPORTED_OSES) {
    const supported = familySupportsOS(faces, os);
    row.createSpan({
      cls: [
        'local-fonts-os-badge',
        supported ? 'local-fonts-os-supported' : 'local-fonts-os-unsupported',
        ...(os === here ? ['local-fonts-os-current'] : []),
      ],
      text: `${supported ? '✓' : '✕'} ${OS_LABELS[os]}`,
      attr: { 'data-os': os },
      ...(os === here && { title: 'Your current platform' }),
    });
  }
  return row;
}

/**
 * One chip per distinct weight present, plus a distinctly-styled "missing" chip for
 * 400 when the family has no regular weight — the gap `describeWeights` used to spell
 * out in prose ("300, 700; no 400") is exactly as visible here, just scannable rather
 * than read as a sentence.
 */
function renderWeightChips(card: HTMLElement, faces: readonly FaceRecord[]): void {
  const row = card.createDiv({ cls: 'local-fonts-weight-chips' });
  const present = [...new Set(faces.map((face) => face.weight))].sort((a, b) => a - b);
  for (const weight of present) {
    row.createSpan({ cls: 'local-fonts-weight-chip', text: String(weight) });
  }
  if (!present.includes(400)) {
    row.createSpan({
      cls: 'local-fonts-weight-chip local-fonts-weight-chip-missing',
      text: 'no 400',
    });
  }
}

/** A pangram-ish sample, wide enough in character variety to show off a typeface. */
const SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog — 0123456789';

/**
 * Render the family's own sample text lazily, only once the card is actually expanded.
 *
 * This is the whole performance premise of the plugin applied to the diagnostics UI
 * too: every family's @font-face is already declared globally (selectFaces already
 * narrowed the cache to one file per family/weight/style, and buildCss emits a rule
 * for each), but `font-display: swap` means nothing is actually fetched until an
 * element on screen requests that family. Creating the sample element eagerly for
 * every card would request every family's face the moment the tab opens — the exact
 * 43-declared-12-fetched gap this plugin exists to keep small. Listening for the
 * `<details>` element's own `toggle` event (rather than a click on the summary) means
 * this also fires for keyboard-driven opens, not just mouse clicks.
 */
function renderSample(card: HTMLDetailsElement, family: string, after: HTMLElement): void {
  let rendered = false;
  card.addEventListener('toggle', () => {
    if (!card.open || rendered) {
      return;
    }
    rendered = true;
    const sample = card.createEl('p', { cls: 'local-fonts-sample', text: SAMPLE_TEXT });
    // Data-driven, not a hardcoded literal — `family` comes from the scanned font, so
    // this can't live in styles.css (see `quote`'s own doc comment for why it's exported).
    sample.style.fontFamily = `${quote(family)}, sans-serif`;
    // createEl always appends at the end; move it right under the OS badges instead,
    // so it reads as part of "what is this family", not as an afterthought below the
    // per-face detail list.
    card.insertBefore(sample, after.nextSibling);
  });
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024)).toString()} KB`;
}

function describeReason(reason: SelectionReason): string {
  switch (reason) {
    case 'format':
      return 'preferred format';
    case 'size':
      return 'smaller file';
    case 'tie-break':
      return 'tie-break';
  }
}

function describeAxes(axes: readonly VariableAxis[]): string {
  return axes
    .map(
      (axis) =>
        `${axis.tag} ${String(axis.min)}–${String(axis.max)} (default ${String(axis.default)})`,
    )
    .join(', ');
}

function renderFaceColour(li: HTMLElement, face: FaceRecord, verdict: FaceVerdict): void {
  if (face.colorFormats.length === 0) {
    return;
  }
  const supported = verdict.status !== 'unrenderable';
  li.createSpan({
    cls: 'local-fonts-face-colour',
    text: ` · [${face.colorFormats.join(', ')}] — ${supported ? 'supported' : 'unsupported'} on this engine`,
  });
}

function renderFaceAxes(li: HTMLElement, face: FaceRecord): void {
  if (face.axes.length === 0) {
    return;
  }
  li.createSpan({ cls: 'local-fonts-face-axes', text: ` · Axes: ${describeAxes(face.axes)}` });
}

function renderFaceVerdict(li: HTMLElement, verdict: FaceVerdict): void {
  if (verdict.status === 'unrenderable') {
    return;
  }
  const detail = verdict.reason === null ? '' : ` (${describeReason(verdict.reason)})`;
  li.createSpan({
    cls: 'local-fonts-face-verdict',
    text: verdict.status === 'selected' ? ` — selected${detail}` : ` — not selected${detail}`,
  });
}

function renderFaceSource(li: HTMLElement, face: FaceRecord): void {
  const guessed = face.source === 'filename';
  const description = guessed ? 'guessed from filename' : `parsed from ${face.source}`;
  li.createSpan({
    cls: guessed
      ? 'local-fonts-face-source local-fonts-face-source-guessed'
      : 'local-fonts-face-source',
    text: ` · ${description}`,
  });
}

/** One `<li>` per face: what it is, whether this engine can draw its colour glyphs,
 *  whether `selectFaces` chose it and why (or why not), its variable axes if any, and
 *  which extraction level supplied its data — a guess must never look parsed. */
function renderFaceRow(list: HTMLElement, face: FaceRecord, verdict: FaceVerdict): void {
  const li = list.createEl('li');
  li.createSpan({
    cls: 'local-fonts-face-summary',
    text: `${String(face.weight)}${face.italic ? ' italic' : ''} · ${face.format} · ${formatSize(face.size)}`,
  });

  renderFaceColour(li, face, verdict);
  renderFaceAxes(li, face);
  renderFaceVerdict(li, verdict);
  renderFaceSource(li, face);
}
