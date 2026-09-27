# Independent font roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each Local Fonts role usable on its own, including global Emoji, while preserving Obsidian's native inheritance, existing non-emoji precedence and synced settings.

**Architecture:** Retain ordinary role assignments on `html body` and the existing mirrored stylesheet. Register a restricted internal Emoji alias, capture native font variables on the body, and decorate their resolved values on application/modal roots. Keep font loading, requested-stack diagnostics and actual rendering evidence separate.

**Tech Stack:** TypeScript, Obsidian API, native CSS custom properties and Font Loading API, Vitest/jsdom, existing WebdriverIO Obsidian service and Android/Appium matrix, fontTools for committed development fixtures.

## Global Constraints

- Plugin ID remains `local-fonts`; this work does not bump a release version.
- Desktop minimum Obsidian version remains `1.0.3`; desktop coverage includes that floor and the latest stable app/installer pair resolved by the existing harness.
- Android automation covers Obsidian `1.8.10` and the latest stable release; iOS requires a real-device manual verification record.
- Keep the existing settings shape and platform-neutral cache format; do not persist resolved CSS, native font stacks, internal aliases or platform-dependent choices.
- Use `vault.adapter` for vault file access; no indexed Vault file APIs.
- `onload()` performs no font-file I/O. Font resources use `adapter.getResourcePath()`, never base64 or remote URLs.
- Generated production CSS remains text appended to the plugin's own marked `<style>` element, including its existing replacement/reload recovery and pop-out mirroring.
- No new production dependency, network service, polling loop, DOM-wide text rewrite or per-document font injection mechanism.
- Register runtime cleanup through the plugin lifecycle; repeated application and unload must not accumulate rules, listeners or observers.
- Preserve the existing supported color-format selection and emoji Unicode policy, including ZWJ coverage and the trademark exclusion.
- All user-visible settings and diagnostic copy remains English, shared by the legacy and Obsidian 1.13 declarative settings paths.
- Preserve the existing normal-mode precedence of non-emoji roles versus Appearance and theme CSS; independence does not introduce a new priority model.

---

## Execution contract

Specification: [Independent font roles](../specs/2026-09-27-independent-font-roles-design.md). Read R1–R7 and V01–V15 before implementing. This is a plan, not an execution record. No checkbox below indicates work already done.

Run tasks in order. At execution time, use `using-git-worktrees` to obtain an isolated checkout; do not install an unfinished build into the user's personal vault. Establish the baseline with `pnpm run test -- src/fonts/css.test.ts src/fonts/probe.test.ts src/settings-tab.test.ts src/main.test.ts`, then `pnpm run build` and `OBSIDIAN_VERSIONS='earliest/earliest latest/latest' pnpm run test:e2e`. Record pre-existing failures before changing behavior. Existing downloaded versions are not proof that another platform passed.

Use TDD for behavior changes. A missing import, malformed fixture or failed app launch is not the intended red result. Stop on an unexplained failure. Unit tests check policy; real Obsidian checks computed inheritance and glyphs. Do not ask jsdom to establish either of the latter.

Known compatibility facts to preserve:

- 1.0.3 Text falls back to Interface; 1.13.7 Text falls back to the native default. An unassigned role is not a frozen snapshot.
- Global native `h1`–`h6` consumers use `--hN-font`, including semantic UI headings. Hard heading rules are limited to notes; ordinary UI labels are not headings.
- Invalid/inherited heading variables must stay invalid. A universal Text fallback would change dialog headings and undo inherited Hard Text.
- `--inline-title-font`, `--table-header-font`, `--file-header-font`, `--metadata-label-font` and `--metadata-input-font` need their own baselines.
- `body > *` needs a normal decorated Interface font-family; Hard Interface must reach that same boundary.
- Appearance inline values and higher-specificity body theme rules keep their current normal-mode priority for non-emoji glyphs.

## Files and boundaries

| File                                                                      | Responsibility                                                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/fonts/family.ts` + `.test.ts` (new)                                  | CSS family quoting and parsing; no DOM/Obsidian/I/O                                                |
| `src/fonts/roles.ts` + `.test.ts` (new)                                   | Pure role declarations, private baseline properties, scoped Hard rules                             |
| `src/fonts/css.ts` + `.test.ts`                                           | Face registration, deterministic alias selection, one-build URL reuse, assembly                    |
| `src/fonts/probe.ts` + `.test.ts`                                         | Font loading status and requested-stack comparison; replace width-based application claims         |
| `src/fonts/surfaces.ts` + `.test.ts` (new)                                | Representative real DOM consumers for diagnostics only                                             |
| `src/settings-tab.ts` + `.test.ts`                                        | Shared English copy and diagnostic rendering in the current document                               |
| `src/main.test.ts`                                                        | Existing delivery/cleanup invariants with Emoji-only and role transitions                          |
| `scripts/make-role-fixtures.py` (new)                                     | Deterministic, purpose-built role/emoji fixtures; leave existing fixture generator/files unchanged |
| `tests/vaults/minimal/.fonts/roles/*.ttf` (new, explicit names in Task 1) | Distinguishable public-domain test fonts                                                           |
| `tests/vaults/minimal/Font roles.md` (new)                                | Actual Markdown consumers: text, headings, code, table, properties                                 |
| `tests/e2e/helpers/roles.ts` (new)                                        | Isolated temporary state, actual DOM measurement and reference calibration                         |
| `tests/e2e/roles.e2e.ts` (new)                                            | Assignment combinations, inheritance and real role rendering                                       |
| `tests/e2e/role-lifecycle.e2e.ts` (new)                                   | Reversal, theme mutation, lifecycle and pop-outs                                                   |
| `tests/e2e/diagnostics.e2e.ts` (new)                                      | Actual settings controls and visible Check results                                                 |
| `tests/e2e/fonts.e2e.ts`                                                  | Replace existing indexed Vault lookups in touched tests; preserve delivery checks                  |
| `tests/e2e/helpers/evidence.ts` (new), both WDIO configs, E2E workflow    | Failure evidence and artifact collection                                                           |
| `README.md`, `styles.css`                                                 | Describe the actual contract; remove obsolete probe-only styles                                    |
| `tests/manual/font-roles-ios.md` (new)                                    | Real-device procedure and evidence fields; no pre-filled passing result                            |

The production change requires no new state in `main.ts`, scanner, cache or selector. If implementation appears to require a theme observer or body-style mutation, revisit the CSS design before adding it.

## Task 1: Calibrate real rendering and establish a reusable native baseline

**Files:** Create `scripts/make-role-fixtures.py`, `tests/vaults/minimal/Font roles.md`, `tests/e2e/helpers/roles.ts`, `tests/e2e/roles.e2e.ts`, and `tests/vaults/minimal/.fonts/roles/{text,interface,mono,headings,baseline,emoji-a,emoji-b}.ttf`. Modify the two note-opening callbacks in `tests/e2e/fonts.e2e.ts`.

**Interfaces:**

```ts
// tests/e2e/helpers/roles.ts — host-side helpers; callbacks are serialized.
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
export function beginRoleScenario(): Promise<void>;
export function endRoleScenario(): Promise<void>;
export function applyRoles(roles: RoleAssignments, hardOverride: boolean): Promise<void>;
export function openRoleNote(mode: NoteMode): Promise<void>;
export function measureSurface(
  selector: string,
  sample: string,
  referenceFamily: string,
  target?: TestDocument,
): Promise<GlyphObservation>;
export function setNativeTestCss(css: string): Promise<void>;
export function setNativeInlineFonts(values: Record<string, string | null>): Promise<void>;
export function openRoleSuggestion(): Promise<void>;
export function closeRoleSuggestion(): Promise<void>;
export function openRoleSettings(): Promise<void>;
export function withRoleScenario(testName: string, assertions: () => Promise<void>): Promise<void>;
export const EMPTY_ROLES: RoleAssignments;
export const ROLE_FAMILIES: RoleAssignments;
```

All functions are implemented in this task. Renderer callbacks consume only their argument values and the provided `{ app, obsidian }`; they cannot close over host imports or helpers. A test-local window property may retain handles for cleanup, but must be deleted afterward. Do not add test hooks to production.

- [ ] **Step 1: Add the fixture source with explicit calibration data.**

Use fontTools' existing `FontBuilder`/`TTGlyphPen` pattern in a separate script so the old fixtures and metadata expectations stay unchanged. Generate these exact families, all with unitsPerEm 1000:

| File            | Family           | Advance |
| --------------- | ---------------- | ------- |
| `text.ttf`      | `Role Text`      | 610     |
| `interface.ttf` | `Role Interface` | 710     |
| `mono.ttf`      | `Role Mono`      | 410     |
| `headings.ttf`  | `Role Headings`  | 810     |
| `baseline.ttf`  | `Role Baseline`  | 510     |
| `emoji-a.ttf`   | `Role Emoji A`   | 1100    |
| `emoji-b.ttf`   | `Role Emoji B`   | 1300    |

Every face contains ASCII U+0020–007E, Cyrillic `АБя`, `😀`, `☀`, `👩`, `💻`, FE0F and ZWJ. In the two Emoji faces, add COLRv0/CPAL and a single-glyph GSUB ligature for `👩‍💻`; give the ligature the face's single advance. FE0F and ZWJ have zero advance. The ordinary characters in Emoji faces deliberately have their wide advance: losing `unicode-range` must visibly fail the non-emoji assertions.

```python
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString

# Use these glyph names in the cmap/glyph order; VS/ZWJ outlines are empty.
addOpenTypeFeaturesFromString(font, '''
languagesystem DFLT dflt;
feature ccmp { sub woman zwj laptop by woman_laptop; } ccmp;
''')
font['head'].created = 3406620153
font['head'].modified = 3406620153
font.recalcTimestamp = False
```

Construct one filled-box outline per normal glyph and a distinguishable filled-box ligature; set glyph order/cmap/hmtx/name/OS2/post before saving, as in `scripts/make-fixtures.py`. Include `Fixture font, public domain.` in the license metadata. Save TTF only; COLRv0 covers the desktop floor and mobile targets without relying on COLRv1 or OT-SVG. Generate with:

```sh
uv run --with fonttools python scripts/make-role-fixtures.py
```

- [ ] **Step 2: Add an actual Markdown fixture, including repeated short samples.**

```markdown
---
role-label: ABCАБя0123 😀 ☀️ 👩‍💻
---

# ABCАБя0123 😀 ☀️ 👩‍💻

## ABCАБя0123 😀 ☀️ 👩‍💻

### ABCАБя0123 😀 ☀️ 👩‍💻

#### ABCАБя0123 😀 ☀️ 👩‍💻

##### ABCАБя0123 😀 ☀️ 👩‍💻

###### ABCАБя0123 😀 ☀️ 👩‍💻

ABCАБя0123 😀 ☀️ 👩‍💻

Inline `ABCАБя0123 😀 ☀️ 👩‍💻`.

### Heading with `ABCАБя0123 😀 ☀️ 👩‍💻`

| ABCАБя0123 😀 ☀️ 👩‍💻 |
| ------------------- |
| ABCАБя0123 😀 ☀️ 👩‍💻 |
```

Also add an unlabelled fenced code block containing the sample. A short sample is intentional: measure one token at a time to avoid a mobile line wrap being mistaken for a font difference. For inline-title/file-header checks, create a temporary copy via `adapter.read/write` whose filename contains the samples; remove it in cleanup. No indexed Vault calls.

- [ ] **Step 3: Implement isolated state and native baselines.**

`beginRoleScenario` waits for scanning and the marked stylesheet, deep-copies the existing plain-data `PluginSettings` (including cache, because later failure cases alter it), snapshots modified document style/class attributes and the workspace layout, then applies all-null roles. Install a test-owned style in the temporary vault's document:

```css
body {
  --font-text-theme: 'Role Baseline';
  --font-interface-theme: 'Role Baseline';
  --font-monospace-theme: 'Role Baseline';
}
```

Its `body` specificity intentionally allows the existing `html body` assignments to win. `setNativeTestCss` replaces this one test style, never the plugin sheet. `setNativeInlineFonts` sets/removes only supplied custom properties on the current document body and records originals. `applyRoles` changes the running plugin's roles/Hard and calls `applyFonts()` without saving; UI tests may persist and must restore the original data separately.

```ts
// Type-only references disappear during callback serialization.
const registry = app.plugins as unknown as {
  plugins: Record<string, FixtureFontPlugin | undefined>;
};
const plugin = registry.plugins['local-fonts'];
if (plugin === undefined) throw new Error('Local Fonts is not enabled');
plugin.settings.roles = { ...roles };
plugin.settings.hardOverride = hardOverride;
plugin.applyFonts();
```

Use `workspace.openLinkText('Font roles.md', '', true)` then `leaf.setViewState` with the existing Markdown view state (`mode: 'preview'` for reading, `mode: 'source'` and `source: false/true` for Live Preview/source). Preserve the rest of the returned view state. Poll for the actual view and required selector. For existing pop-out tests, use `workspace.openLinkText('Welcome.md', '', 'window')` with desktop feature gating instead of `vault.getFiles()`.

`withRoleScenario` calls `beginRoleScenario` **inside** its `try` block, awaits the supplied assertions and calls `endRoleScenario` in `finally`. Use it in each role test instead of also installing a duplicate teardown. Allocate the cleanup record before the first mutation, record each original before changing it, and make `endRoleScenario` safe when setup completed only partially. It closes only created modals/windows/leaves, removes test styles and temporary notes through the adapter, restores body attributes and the saved full settings including cache, saves restored settings if a UI test persisted changes, reapplies the current plugin instance, restores the layout, then deletes test-owned renderer state. Clean up even after setup or assertions fail. The short test bodies below are the callbacks passed to this wrapper.

- [ ] **Step 4: Implement measurement on the actual surface and a calibrated reference.**

`measureSurface` finds the matching real element in the chosen document, finds a text-node substring matching `sample`, and uses a `Range` for that substring. Do not append test text to the editor or infer actual rendering from `getComputedStyle` alone. Copy the text node's parent font size/style/weight/stretch/feature/variation settings and letter/word spacing to an offscreen reference span in the same document, overriding only its font family. Use the sample explicitly with `document.fonts.load` for both requested stacks. Remove the reference in `finally`.

```ts
const computed = doc.defaultView!.getComputedStyle(textNode.parentElement!);
const reference = doc.createElement('span');
reference.textContent = sample;
reference.style.cssText = 'position:fixed;left:-10000px;white-space:pre;';
for (const property of [
  'font-size',
  'font-style',
  'font-weight',
  'font-stretch',
  'font-feature-settings',
  'font-variation-settings',
  'letter-spacing',
  'word-spacing',
]) {
  reference.style.setProperty(property, computed.getPropertyValue(property));
}
// The oracle must beat even Hard Interface on body > *; the measured surface is untouched.
reference.style.setProperty('font-family', referenceFamilyCss, 'important');
doc.body.appendChild(reference);
try {
  const referenceStack = doc.defaultView!.getComputedStyle(reference).fontFamily;
  // The Task 1 fixture names contain no quotes/commas; this is exactly one family.
  if (referenceStack.replace(/^(['"])(.*)\1$/, '$2') !== referenceFamily) {
    throw new Error(`Reference family was overridden: ${referenceStack}`);
  }
  const metrics = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize}`;
  await doc.fonts.load(`${metrics} ${computed.fontFamily}`, sample);
  await doc.fonts.load(`${metrics} ${referenceFamilyCss}`, sample);
  const range = doc.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, start + sample.length);
  return {
    width: range.getBoundingClientRect().width,
    referenceWidth: reference.getBoundingClientRect().width,
    stack: computed.fontFamily,
    fontSize: computed.fontSize,
  };
} finally {
  reference.remove();
}
```

Missing elements/text nodes throw a descriptive error; no silent pass. Poll until loading/layout settles. The primary equality tolerance is 0.5 CSS px and reference-vs-control difference must exceed 2 CSS px. If that calibration fails, fix the fixture/sample instead of widening tolerance.

`openRoleSuggestion` instantiates a small native `obsidian.SuggestModal<string>` in the fixture app. Implement `getSuggestions`, `renderSuggestion` and `onChooseSuggestion`; the suggestion text is the same sample. Store the modal for `closeRoleSuggestion`. This exercises the standard modal path without depending on a third-party QuickAdd release.

`openRoleSettings` opens the actual Local Fonts settings page and adds one test-owned `new obsidian.Setting(visibleTabContent).setName('ABCАБя0123 😀 ☀️ 👩‍💻')` row, marked `.role-test-setting`. This gives the real native settings component emoji text without changing plugin labels. Save `visibleTabContent.ownerDocument` as the `settings` measurement target, resolving the currently displayed `app.setting.tabContentContainer` on 1.13 and the visible legacy settings content on earlier versions. Never substitute `document` or stale `tab.containerEl`. Measure its `.setting-item-name` with `measureSurface(selector, sample, family, 'settings')`; also measure an existing ordinary label such as `Emoji` against the reference in that same document. Restore any test edits and remove the row on cleanup. Tests of Check itself must interact with the existing actual controls/results, not this sample row.

Import the existing `quote` from `src/fonts/css.ts` on the host side for `referenceFamilyCss` in this task; Task 2 updates that import when it moves the helper.

- [ ] **Step 5: Add and run calibration and baseline tests.**

```ts
it('calibrates ordinary role faces and the two emoji references', async () => {
  await openRoleNote('reading');
  const families = ['Role Text', 'Role Interface', 'Role Mono', 'Role Headings', 'Role Baseline'];
  const widths: number[] = [];
  for (const family of families) {
    const result = await measureSurface('.markdown-preview-view p', 'ABCАБя0123', family);
    widths.push(result.referenceWidth);
  }
  for (let i = 0; i < widths.length; i++) {
    for (let j = i + 1; j < widths.length; j++) {
      expect(Math.abs(widths[i]! - widths[j]!)).toBeGreaterThan(2);
    }
  }
  for (const sample of ['😀', '☀️', '👩‍💻']) {
    const a = await measureSurface('.markdown-preview-view p', sample, 'Role Emoji A');
    const b = await measureSurface('.markdown-preview-view p', sample, 'Role Emoji B');
    expect(Math.abs(a.referenceWidth - b.referenceWidth)).toBeGreaterThan(2);
  }
});
```

Also assert each Emoji ZWJ reference is one advance, not the sum of woman and laptop, and that all-null notes/code/UI match their native baseline. Calibration should pass before any production change; it is not the regression proof.

Run `pnpm run typecheck:e2e`, `pnpm run build`, then `OBSIDIAN_VERSIONS='earliest/earliest latest/latest' pnpm run test:e2e -- --spec tests/e2e/roles.e2e.ts`. Diagnose baseline failures separately. Commit only these test/helper/fixture changes: `test: calibrate independent font role rendering`.

## Task 2: Implement independent role composition and the restricted Emoji alias

**Files:** Create `src/fonts/family.ts`, `src/fonts/family.test.ts`, `src/fonts/roles.ts`, `src/fonts/roles.test.ts`. Modify `src/fonts/css.ts`, `src/fonts/css.test.ts`, the `quote` imports in `src/settings-tab.ts` and `tests/e2e/helpers/roles.ts`, and `tests/e2e/roles.e2e.ts`.

**Interfaces:** Consumes `FaceRecord`, `RoleAssignments`, unchanged `BuildCssInput` and Task 1 helpers. Produces:

```ts
// family.ts
export function quote(family: string): string;
// roles.ts
export interface RoleCssInput {
  roles: RoleAssignments;
  hardOverride: boolean;
  emojiAlias: string | null;
}
export function buildRoleCss(input: RoleCssInput): string;
// css.ts
export function resolveEmojiAlias(
  faces: readonly FaceRecord[],
  family: string | null,
): string | null;
export function buildCss(input: BuildCssInput): string; // existing public contract unchanged
```

Move `quote` into `family.ts` unchanged initially, then cover line breaks/control escaping as necessary for arbitrary family names. Import it directly from that module in CSS, role policy and settings; do not create a `css.ts`↔`roles.ts` cycle. Keep face-weight code and Unicode constants in `css.ts`.

- [ ] **Step 1: Write failing independent Emoji tests in pure CSS and real Obsidian.**

```ts
it('applies only Emoji without selecting a text role', () => {
  const css = buildCss({
    faces: [face({ family: 'Role Emoji A', colorFormats: ['COLR0'] })],
    roles: { ...DEFAULT_SETTINGS.roles, emoji: 'Role Emoji A' },
    hardOverride: false,
    resolve,
  });
  expect(css).toContain('html body > *');
  expect(css).toContain('--font-interface:');
  expect(css).toContain('--font-text:');
  expect(css).toContain('--font-monospace:');
  expect(css).not.toContain('!important');
});

it('renders emoji-only in notes without changing ordinary text', async () => {
  await openRoleNote('reading');
  const before = await measureSurface('.markdown-preview-view p', 'ABCАБя0123', 'Role Baseline');
  await applyRoles({ ...EMPTY_ROLES, emoji: 'Role Emoji A' }, false);
  const after = await measureSurface('.markdown-preview-view p', 'ABCАБя0123', 'Role Baseline');
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(0.5);
  for (const sample of ['😀', '☀️', '👩‍💻']) {
    const emoji = await measureSurface('.markdown-preview-view p', sample, 'Role Emoji A');
    expect(Math.abs(emoji.width - emoji.referenceWidth)).toBeLessThanOrEqual(0.5);
  }
});
```

Run `pnpm run test -- src/fonts/css.test.ts`, then build and the focused `roles.e2e.ts` test. Expect the unit failure to identify missing application rules and the real test to identify the wrong Emoji glyph width. Record those failures before implementation.

- [ ] **Step 2: Register both ordinary faces and a private restricted alias.**

`resolveEmojiAlias` returns null when no selected face matches the selected family. Otherwise start with `__local-fonts-emoji__`, append an integer suffix until it does not case-insensitively collide with any ordinary registered family. Compute this per generation; persist nothing. Register all ordinary faces unrestricted, then extra alias declarations for the selected family's weights/styles using `EMOJI_UNICODE_RANGE`.

```ts
const urls = new Map<string, string>();
const sourceUrl = (path: string): string => {
  const cached = urls.get(path);
  if (cached !== undefined) return cached;
  const url = resolve(path);
  urls.set(path, url);
  return url;
};
```

Adapt the private `fontFace` builder to receive `family: string` and `restricted: boolean`, preserving format/style/weight/font-display behavior. Reuse `sourceUrl(face.path)` for both declarations, including hidden paths whose resource URL may change on each resolution. A local `Map` is sufficient; do not add a persistent resource cache.

- [ ] **Step 3: Extract unchanged non-emoji role policy and add CSS composition.**

Retain `html body`, both override/theme tiers and existing fallback values (`sans-serif`, `monospace`, no invalid `inherit` list item for Headings). Do not prepend Emoji to those ordinary declarations. Generate the following inventory inside `roles.ts`:

```ts
const nativeProperties = [
  ...['text', 'interface', 'monospace'].flatMap((role) => [
    `--font-${role}`,
    `--font-${role}-override`,
    `--font-${role}-theme`,
  ]),
  ...[1, 2, 3, 4, 5, 6].map((level) => `--h${level}-font`),
  '--inline-title-font',
  '--table-header-font',
  '--file-header-font',
  '--metadata-label-font',
  '--metadata-input-font',
];
const baselineProperty = (property: string): string => `--local-fonts-base-${property.slice(2)}`;
```

For each property, put `private: var(native)` on `html body`, and `native: alias, var(private)` on `html body > *`. **No fallback in this `var()`**: guaranteed-invalid/inherited heading and derivative variables must stay invalid. Preserve separate tiers; do not reconstruct them from the final Text/Interface stack.

```css
html body {
  --local-fonts-base-h1-font: var(--h1-font);
  --local-fonts-base-font-interface: var(--font-interface);
}
html body > * {
  --h1-font: '__local-fonts-emoji__', var(--local-fonts-base-h1-font);
  --font-interface: '__local-fonts-emoji__', var(--local-fonts-base-font-interface);
  font-family: var(--font-interface);
}
```

Only produce this layer for a non-null usable alias. Keep existing hard-rule semantics during extraction, pass the alias separately to their stack composer, and include `html body > *` when Hard Interface is explicitly selected. Task 3 narrows/fixes the Hard boundaries. `main.ts` still passes the same input and replaces the same stylesheet text.

- [ ] **Step 4: Add the policy matrix and registration boundaries.**

Generate 32 role masks × both Hard values. In tests, map roles to distinct literal family names and real selected face records; do not use production role constants as the expectation. Parse blocks to distinguish ordinary faces, alias faces, body assignments and child assignments. Assert: all-null gives faces only; null non-emoji roles have no body assignment; Emoji null/missing has no child layer; active child declarations reference only private ancestor properties; repeated identical builds are equal; no `, inherit`, empty list item or same-scope variable self-reference. Existing face/weight/escaping tests remain.

```ts
const keys = ['text', 'interface', 'monospace', 'headings', 'emoji'] as const;
for (let mask = 0; mask < 32; mask++) {
  for (const hardOverride of [false, true]) {
    it(`owns only the selected roles: mask ${mask}, hard ${hardOverride}`, () => {
      const roles = { ...DEFAULT_SETTINGS.roles };
      keys.forEach((key, index) => {
        roles[key] = mask & (1 << index) ? `Fixture ${key}` : null;
      });
      const input = {
        faces: keys.map((key) => face({ family: `Fixture ${key}`, path: `.fonts/${key}.ttf` })),
        roles,
        hardOverride,
        resolve,
      };
      const css = buildCss(input);
      const rules = css.split('\n\n').filter((block) => !block.startsWith('@font-face'));
      const body = rules.filter((block) => block.startsWith('html body {')).join('\n');
      const child = rules.filter((block) => block.startsWith('html body > * {')).join('\n');
      for (const role of ['text', 'interface', 'monospace'] as const) {
        expect(body.includes(`--font-${role}-override:`)).toBe(roles[role] !== null);
        expect(body.includes(`--font-${role}-theme:`)).toBe(roles[role] !== null);
      }
      for (const level of [1, 2, 3, 4, 5, 6]) {
        expect(body.includes(`--h${level}-font:`)).toBe(roles.headings !== null);
      }
      expect(child.includes('--font-interface:')).toBe(roles.emoji !== null);
      expect(css).not.toMatch(/,\s*(?:inherit|initial|unset)\s*;/);
      expect(css).not.toMatch(/,\s*,/);
      expect(buildCss(input)).toBe(css);
      if (mask === 0) expect(rules).toEqual([]);
    });
  }
}
```

Explicit registration tests: same family as Emoji+Text remains unrestricted under its ordinary name; alias has the range; colliding mixed-case ordinary alias name gets a suffix; resolver spy is called once per unique path; multiple weights/italic/variable ranges preserved; absent selected family yields readable normal stacks; quotes, backslashes and commas in names remain valid. Change old tests which expected the original registration to be restricted; do not delete the policy they protected.

- [ ] **Step 5: Extend real-app role cases and run them green.**

For each single role, each of the four non-emoji roles + Emoji, and all roles, measure selected faces against references on the real consumers below. Run both Hard settings; Task 3 owns any newly exposed hardcoded-container regression.

| Role      | Real consumer                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------- |
| Text      | `.markdown-preview-view p`, ordinary `.cm-line` in source/Live Preview                                  |
| Interface | `.suggestion-item`, existing native settings ordinary label and `.role-test-setting .setting-item-name` |
| Monospace | reading `code` / `pre code`, `.cm-inline-code`, `.cm-line.HyperMD-codeblock`                            |
| Headings  | reading h1–h6, `.HyperMD-header-1`…`6`, `.inline-title`                                                 |
| Emoji     | Those same available consumers, all three emoji samples                                                 |

Assert unaffected independent stacks against the all-null native baseline; do not assert that a naturally inherited heading or old-version Text fallback cannot change. Add inherited vs explicit title/table fonts, UI semantic h1 using Interface, and current-app file/property consumers. Source/Live Preview checks require scrolling each target into view; absence is not a skip.

Run `pnpm run test -- src/fonts/css.test.ts src/fonts/roles.test.ts src/fonts/family.test.ts`, `pnpm run typecheck`, `pnpm run build`, then the floor/latest focused real suite. Commit `feat: compose emoji independently of font role assignments`.

## Task 3: Enforce only assigned Hard roles and prove restoration

**Files:** Modify `src/fonts/roles.ts`, `src/fonts/roles.test.ts`, `src/fonts/css.test.ts`, `src/main.test.ts`; create `tests/e2e/role-lifecycle.e2e.ts`.

**Interfaces:** Consumes `buildRoleCss(RoleCssInput): string`, unchanged `buildCss(BuildCssInput): string`, and Task 1 helpers. Produces no new production API. `main.ts` lifecycle stays unchanged unless a failing regression demonstrates a necessary correction.

- [ ] **Step 1: Add failing role-boundary tests.**

Use a deliberately hardcoded note container and independent icon declaration:

```css
body {
  --font-text-theme: 'Role Baseline';
  --font-interface-theme: 'Role Baseline';
}
.markdown-preview-view,
.markdown-source-view {
  font-family: 'Role Baseline';
}
.suggestion-container {
  font-family: 'Role Baseline';
}
.role-test-icon {
  font-family: 'Role Mono';
}
```

Verify Hard Text selects Text in ordinary note text but leaves code's own face and explicit heading face intact. Hard Interface selects Interface on its mapped native UI boundaries. Emoji-only with Hard on/off must preserve these independently hardcoded ordinary fonts; it must not manufacture Text/Interface assignments. An icon span with both `.svg-icon` and `.role-test-icon` must keep Role Mono. A dialog h1 with its own font must not receive a new important note-heading rule.

```ts
it('does not reset independently styled icons', () => {
  const css = buildRoleCss({
    roles: { ...DEFAULT_SETTINGS.roles, text: 'Role Text' },
    hardOverride: true,
    emojiAlias: null,
  });
  expect(css).not.toContain('.svg-icon');
  expect(css).not.toContain('font-family: revert');
});
```

Run focused unit/real tests and identify the current global reset and heading selector failures.

- [ ] **Step 2: Scope important rules and remove the global icon reset.**

Use literal assigned families plus the optional restricted Emoji alias and the existing generic fallback; do not read an Appearance-winning variable for the explicit Hard assignment. Keep normal body variable declarations unchanged. The intended hard-rule boundaries are:

```ts
const hardText = ['.markdown-preview-view', '.markdown-source-view'];
const hardInterface = [
  'html body',
  'html body > *',
  '.workspace-ribbon',
  '.workspace-tab-header',
  '.view-header',
  '.nav-files-container',
  '.modal',
  '.suggestion-container',
  '.suggestion-item',
  '.setting-item-name',
  '.setting-item-description',
];
const hardMonospace = ['code', 'pre', '.cm-inline-code', '.cm-line.HyperMD-codeblock'];
const hardHeadings = [
  ...[1, 2, 3, 4, 5, 6].flatMap((level) => [
    `.markdown-preview-view h${level}`,
    `.markdown-source-view .HyperMD-header-${level}`,
    `.markdown-source-view .HyperMD-list-line .cm-header-${level}`,
  ]),
  '.workspace-leaf-content[data-type="markdown"] .inline-title',
];
```

Only the non-null assigned role emits its group. Apply the standard map to actual current/floor consumers; if a tested core text element has its own family declaration bypassing its boundary, add only the observed role-specific selector and the failing case. Never use `*` as a font-family forcing descendant selector, `.cm-content` as Monospace, or a global icon reset. Independent descendant icon declarations remain authoritative through normal CSS inheritance.

Include code-in-heading with Headings-only, Monospace-only and both, both Hard settings. A normal heading with native `inherit` must inherit Hard Text from its parent even if body Appearance Text is different; do not repair that case by forcing Headings when it is null.

- [ ] **Step 3: Add A→B→null and repeated-application assertions.**

```ts
for (const role of ['text', 'interface', 'monospace', 'headings', 'emoji'] as const) {
  const familyA = ROLE_FAMILIES[role]!;
  const familyB = role === 'emoji' ? 'Role Emoji B' : 'Role Baseline';
  await applyRoles({ ...EMPTY_ROLES, [role]: familyA }, false);
  await applyRoles({ ...EMPTY_ROLES, [role]: familyB }, false);
  await applyRoles(EMPTY_ROLES, false);
  // Measure the role and independent controls after every transition.
}
```

Define `familyA = ROLE_FAMILIES[role]!` and `familyB = role === 'emoji' ? 'Role Emoji B' : 'Role Baseline'` inside the loop. Add/remove Emoji while another role stays selected, then clear that other role while Emoji remains. At every point compare actual glyphs to the appropriate reference. Reapply ten times; compare stylesheet text/face count and inspect no obsolete alias or prior family in application rules. Ordinary catalog registrations legitimately remain, so do not assert that an old family name disappears from all CSS.

- [ ] **Step 4: Extend lifecycle regression tests without redesigning delivery.**

Reuse `src/main.test.ts`'s marked-style fixtures and observer flushing for: Emoji-only startup from cache, replacement element with exact marker value, style text reset, unload before delayed marker, disable/re-enable and assignments restored from existing data. Assert generated CSS disappears on unload, no subsequent mutation restores it, cache serialization stays platform-neutral, and startup performs no font-file reads. Existing clone/delivery tests remain.

```ts
// Add to the existing lifecycle harness, using its plugin/style variables.
plugin.settings.roles = { ...DEFAULT_SETTINGS.roles, emoji: 'Role Emoji A' };
plugin.applyFonts();
const first = styleEl.textContent;
plugin.applyFonts();
expect(styleEl.textContent).toBe(first);
// Existing replacement/unload helpers then check both face and composition rules.
```

In the disposable e2e vault, disable/re-enable via the app plugin manager, always obtain the new plugin instance after enable, and verify glyph restoration. For stylesheet replacement, clone the plugin style node with its marker/base CSS then replace it; wait for existing recovery and verify a rendered Emoji sample. Do not inject a second production sheet from the test.

- [ ] **Step 5: Test graceful missing/load-failure behavior, then commit.**

Unit cases distinguish unavailable selected family (no alias/application prefix) from a registered file that later fails loading (valid fallback stack remains). In a disposable real-app case, add a new cached face with a unique test family name and absent fixture path, select it for Emoji, and restore the cache in `finally`; using a never-loaded family prevents the browser cache from hiding the failure. Ordinary glyphs must still render in the baseline. Do not delete shared font fixtures or mutate the user's vault. Test same-family ordinary/Emoji usage and existing font weights again after Hard changes.

Run affected unit tests, build, and both role e2e specs at the floor/latest. Commit `fix: keep hard font overrides within assigned roles`.

## Task 4: Make Check describe loading and actual requested stacks honestly

**Files:** Modify `src/fonts/probe.ts`, `src/fonts/probe.test.ts`, `src/fonts/family.ts`, `src/fonts/family.test.ts`, `src/settings-tab.ts`, `src/settings-tab.test.ts`, `styles.css`, `README.md`. Create `src/fonts/surfaces.ts`, `src/fonts/surfaces.test.ts`, `tests/e2e/diagnostics.e2e.ts`.

**Interfaces:** Consumes `resolveEmojiAlias`, `selectFaces`, existing `RoleAssignments` and `quote`. Produces:

```ts
// family.ts
export interface ParsedFamily {
  name: string;
  generic: boolean;
}
export function parseFontFamilies(value: string): ParsedFamily[];
// probe.ts
export type FontLoadStatus = 'loaded' | 'failed' | 'unverified';
export type StackStatus = 'first' | 'preceded' | 'absent';
export function loadLocalFont(
  doc: Document,
  family: string,
  sample: string,
): Promise<FontLoadStatus>;
export function inspectStack(
  value: string,
  family: string,
  ignoredFamilies?: readonly string[],
): StackStatus;
// surfaces.ts
export interface FontSurface {
  role: Exclude<RoleName, 'emoji'>;
  name: string;
  element: HTMLElement;
}
export function findFontSurfaces(doc: Document): FontSurface[];
```

No rename or new value for stored settings. Remove `measureText`/`isFamilyApplied` after updating all their callers/tests; they must not survive as misleading public diagnostics or dead code.

- [ ] **Step 1: Write failing loading/order/parser tests.**

```ts
expect(
  inspectStack('"__local-fonts-emoji__", "Role Text", sans-serif', 'Role Text', [
    '__local-fonts-emoji__',
  ]),
).toBe('first');
expect(inspectStack('"__local-fonts-emoji__", "Role Text"', '__local-fonts-emoji__')).toBe('first');
expect(inspectStack('"??", "Role Baseline", "Role Text"', 'Role Text')).toBe('preceded');
expect(inspectStack('"Role Baseline", sans-serif', 'Role Text')).toBe('absent');
expect(parseFontFamilies('"Name, With Comma", "Quoted\\\"Name", sans-serif')).toEqual([
  { name: 'Name, With Comma', generic: false },
  { name: 'Quoted"Name', generic: false },
  { name: 'sans-serif', generic: true },
]);
```

Also cover single quotes, escaped backslash, CSS hex escapes with optional terminator whitespace, unquoted multiword family, case-insensitive name matching, quoted generics, empty strings and malformed/unterminated values. Malformed input yields no confident first-family assertion. Literal `??` is ignored; no other unknown family is assumed missing.

Stub FontFaceSet: nonempty resolved list → loaded; rejection → failed; empty result or absent API → unverified. Verify that `fonts.load` receives both a quoted family declaration and explicit text; Emoji uses `😀`, ordinary roles use `ABCАБя0123`. Stub status independently of any mocked width.

Run `pnpm run test -- src/fonts/probe.test.ts src/fonts/family.test.ts`; expect missing-new-contract failures first, then run assertion-level tests after the signatures exist.

- [ ] **Step 2: Implement the pure parser/comparison and font loading.**

Use a single-pass scanner with quote state, escape decoding and comma boundaries outside quotes. Decode CSS escapes (up to six hex digits and one following whitespace; escaped newline consumes no character), normalize unquoted whitespace, preserve quoted spaces/commas. Avoid `split(',')` and simplistic quote-stripping. Mark unquoted CSS generic families as `generic: true`; a quoted family named `serif` is an ordinary family. Match selected ordinary names case-insensitively without treating a generic keyword as that same-named local font.

```ts
export async function loadLocalFont(
  doc: Document,
  family: string,
  sample: string,
): Promise<FontLoadStatus> {
  const fonts = (doc as unknown as { fonts?: FontFaceSet }).fonts;
  if (fonts === undefined) return 'unverified';
  try {
    return (await fonts.load(`64px ${quote(family)}`, sample)).length > 0 ? 'loaded' : 'unverified';
  } catch {
    return 'failed';
  }
}
```

`inspectStack` removes the ordinary family `??` and only the supplied ignored managed alias, finds the requested non-generic family, and returns absent/first/preceded. A preceding generic still counts as a competing font. It does not infer glyph rendering or whether an earlier arbitrary family is installed. For malformed lists, return absent rather than invent an order; display this as the selected font being absent from the checked parseable stack, with the raw stack available for inspection.

- [ ] **Step 3: Map representative visible standard surfaces.**

Use specific leaf text consumers, not just broad view containers; return each available category's representative elements. The map includes:

```ts
const selectors = {
  text: '.markdown-preview-view p, .markdown-source-view .cm-line:not([class*="HyperMD-header-"]):not(.HyperMD-header):not(.HyperMD-codeblock)',
  interface:
    '.suggestion-item, .setting-item-name, .nav-file-title-content, .view-header-title, .metadata-property-key',
  monospace:
    '.markdown-preview-view code, .markdown-source-view .cm-inline-code, .markdown-source-view .HyperMD-codeblock',
  headings:
    '.markdown-preview-view h1, .markdown-preview-view h2, .markdown-preview-view h3, .markdown-preview-view h4, .markdown-preview-view h5, .markdown-preview-view h6, .markdown-source-view [class*="HyperMD-header-"], .markdown-source-view .HyperMD-header, .inline-title',
};
```

Check the concrete source heading class list at floor/latest; exclude all `.HyperMD-header-N` variants from ordinary text, including versions without an unsuffixed heading class. Filter detached/hidden targets, avoid descendants of diagnostic results themselves, and deduplicate elements. Name surfaces clearly (`Reading text`, `Live editor text`, `Suggestion`, `Settings label`, `Inline code`, `Heading 1`, etc.). Limit to one representative per named category so a long note does not create hundreds of diagnostics. Tests build these small real DOM structures and mock only visibility where jsdom lacks layout.

- [ ] **Step 4: Integrate shared results and the correct document into settings.**

`runCheck(results)` reads `results.ownerDocument`. Resolve the current device's selected faces with the existing `selectFaces`/Platform route, then compute the same alias used by CSS. For a non-emoji role, load the ordinary selected family and inspect matching surfaces ignoring the alias. For Emoji, load/inspect the alias and inspect all available role categories; display the original selected family name. A missing alias is unverified/unavailable, not a probe of a same-named system font.

```ts
const loadCopy: Record<FontLoadStatus, string> = {
  loaded: 'Local font loaded',
  failed: 'Local font could not be loaded',
  unverified: 'Could not verify this font',
};
const stackCopy: Record<StackStatus, string> = {
  first: 'Selected font is first in the checked stack',
  preceded: 'Another font is listed first here',
  absent: 'Selected font is absent from the checked stack',
};
```

Use `No matching open surface to check` when the assigned role has no available surface. Display once: `Checks font loading and the font stacks of open views. Results do not verify every rendered character.` Set Emoji description to `Replaces emoji throughout Obsidian, independently of the other font choices.` Preserve the existing no-overlapping-Check guard, catch unexpected errors as today, and avoid writing results into a detached rerender target after awaiting loading. Do not add a permanent listener or observer for diagnostics.

- [ ] **Step 5: Cover the settings paths and true UI transitions.**

Replace width-based settings assertions with loading + per-surface result assertions, including Text+Emoji and Emoji-only. In unit tests give the results element a different ownerDocument from legacy `containerEl` and prove that both load and computed-style queries use that document. Preserve 1.13 `renderTab`/`update` regression tests and legacy `display` cases.

In the real fixture app, open Local Fonts through `app.setting.open()` / `openTabById('local-fonts')`, querying the displayed tab content container on 1.13 and the displayed legacy content on earlier versions. Drive a real dropdown to Emoji-only, then Text+Emoji, wait for saved roles/CSS and click Check. Reopen and confirm choices/results refresh. Set an Appearance inline competing Text family, verify loading still succeeds but the stack reports precedence; close notes and verify explicit no-surface text. Do not read a hidden stale `containerEl` as the visible result.

Also create a broken resource case and assert `Local font could not be loaded` with readable fallback. Do not assert a theme caused a load error. These UI tests may save settings only in the disposable fixture vault; restore them through Task 1 cleanup.

- [ ] **Step 6: Update user documentation and remove obsolete probe styles.**

Replace README's current claim that Check measures what actually rendered, including its iOS advice. Describe independent assignments, preserved natural/native inheritance, global Emoji on standard native font paths, synced choices requiring the font files on each device, normal Appearance/theme precedence, the purpose/limits of Hard override, and the distinction between loading/stack inspection and rendering. Keep the existing hidden-folder sync warning; this change does not add a synchronization service. Remove `.local-fonts-probe` CSS only after no production caller remains. Run:

```sh
rg -n 'isFamilyApplied|measureText|local-fonts-probe|NOT rendering' src styles.css README.md
pnpm run test -- src/fonts/family.test.ts src/fonts/probe.test.ts src/fonts/surfaces.test.ts src/settings-tab.test.ts
pnpm run typecheck
pnpm run build
OBSIDIAN_VERSIONS='earliest/earliest latest/latest' pnpm run test:e2e -- --spec tests/e2e/diagnostics.e2e.ts
```

The search should find no obsolete API/copy. Commit `fix: report font loading and role stack conflicts accurately`.

## Task 5: Prove live native inheritance, pop-outs and platform boundaries

**Files:** Extend `tests/e2e/roles.e2e.ts`, `tests/e2e/role-lifecycle.e2e.ts`, `tests/e2e/helpers/roles.ts`. Create `tests/e2e/helpers/evidence.ts` and `tests/manual/font-roles-ios.md`; modify both WDIO configs and `.github/workflows/e2e.yml` to collect failure evidence.

**Interfaces:** Consumes Task 1 helper API, completed role composition and diagnostics. Add these exact test-only exports:

```ts
// helpers/roles.ts
export function openRolePopout(): Promise<void>;
export function setPopoutNativeFonts(values: Record<string, string | null>): Promise<void>;
// helpers/evidence.ts — called from the test catch path before cleanup.
export function captureRoleFailure(testName: string): Promise<void>;
```

- [ ] **Step 1: Add native priority/inheritance cases against both app versions.**

```ts
it('decorates the winning Appearance font without changing ordinary text', async () => {
  await openRoleNote('reading');
  await setNativeInlineFonts({ '--font-text-override': '"Role Baseline"' });
  await applyRoles({ ...EMPTY_ROLES, text: 'Role Text', emoji: 'Role Emoji A' }, false);
  const text = await measureSurface('.markdown-preview-view p', 'ABCАБя0123', 'Role Baseline');
  const emoji = await measureSurface('.markdown-preview-view p', '😀', 'Role Emoji A');
  expect(Math.abs(text.width - text.referenceWidth)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(emoji.width - emoji.referenceWidth)).toBeLessThanOrEqual(0.5);
});
```

Then repeat with Hard Text: ordinary text must use Role Text while inherited note headings use that actual parent; an explicit custom heading stays custom when Headings is null. Add separate direct-theme reader probes as ordinary DOM children that use `font-family:var(--font-text-theme)`: they must retain that tier's native baseline instead of being replaced by Appearance's final stack. These probes complement, not replace, actual note/menu tests.

For the old Text→Interface dependency, set native Text override/theme to `??`, assign only Interface and compare with the native formula present in that exact app. On the floor it can change Text; latest can retain native default. Assert the version's actual resolved native baseline and independent explicit Text priority, rather than hardcoding one cross-version appearance.

Test a family used simultaneously by Emoji and Text/Appearance: ordinary reference widths must match the unrestricted registration and emoji references the restricted alias. Include multiple weights and escaped-name unit evidence from Task 2 in the case report.

- [ ] **Step 2: Add live mutation and inherited/explicit derivative cases.**

Activate Emoji once, then change only native CSS/inline settings, without `applyFonts()` or rescan. Cover low-specificity `body` theme variables, higher-specificity `body.theme-dark`, light/dark class switch, temporary snippet insertion/removal, and native inline Appearance changes. Poll for changed reference widths and confirm plugin stylesheet text did not change during these native-only mutations.

```css
body.theme-dark {
  --font-text-theme: 'Role Text';
  --font-interface-theme: 'Role Interface';
}
body.theme-light {
  --font-text-theme: 'Role Baseline';
  --font-interface-theme: 'Role Baseline';
}
```

Use distinct h1–h6 font values and then remove them; test both an explicit and inherited inline title/table header. Include a dialog h1 with native inherited Interface and a note heading inheriting Hard Text while Appearance differs. On versions exposing properties/file headers, assert Emoji + unchanged ordinary text in those actual consumers. For Bases, add one latest-only real `.base` view with a direct-theme font reader when the built-in feature exists; absence on floor is an explicit capability skip. Fundamental role tests may not be skipped.

- [ ] **Step 3: Verify existing/new pop-out documents with different baselines.**

`openRolePopout` uses the standard desktop `workspace.openLinkText(path, '', 'window')` route and stores the created window handle. `setPopoutNativeFonts` edits only its body inline font variables and restores them later. `measureSurface(..., 'popout')` uses that document's own defaultView and FontFaceSet, never the main window's computed style.

Create a pop-out before selecting Emoji, set different main/pop-out native Text families, then select Emoji and verify the same selected emoji plus distinct ordinary references in both documents. Create another pop-out after selection and verify it too. Change a main selection, remove Emoji and repeat; close/reopen settings and inspect the currently displayed document. Test style-text replacement while a pop-out is open. Skip only on non-desktop platforms, using an explicit reported skip.

- [ ] **Step 4: Add useful failure evidence before cleanup.**

`captureRoleFailure` writes under `tests/e2e/wdio-logs/role-failures/` with a sanitized unique filename containing session/platform/app/test identity. Collect actual app version, installer/browser versions from capabilities, platform, roles/Hard, body native font variables, checked computed stacks, FontFace loading statuses, marked stylesheet text and a screenshot. Only disposable fixture content is captured. Obtain renderer/engine version via harness capabilities/Obsidian API, not production user-agent sniffing. Do not let a failed evidence capture hide the original test failure.

```ts
// Extend Task 1's existing wrapper; no second afterEach cleanup.
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
```

Configure WDIO `outputDir` under existing ignored `tests/e2e/wdio-logs/`, and add an `if: failure()` artifact-upload step in both CI jobs using the repository's existing action-version convention. Keep desktop and Android version matrices intact. Unit tests of evidence plumbing are unnecessary; provoke one deliberate local assertion failure, confirm diagnostic files and screenshot, remove the deliberate failure, then run the targeted case green.

- [ ] **Step 5: Add the iOS procedure and run the actual supported matrix.**

The manual record must list app/iOS/device, font names/formats, settings, observed glyphs, and pass/fail/unverified for: Emoji-only, Text-only, Interface-only, distinct full assignment, note/code/heading/settings/suggestion, light/dark/theme change, A→B→null and unload/re-enable. Compare against the fixture reference images or widths from the same device. Do not call Check sufficient proof of glyph selection. Include actual UI/console observations, or explicitly record `Unverified: no iOS device available`.

Run the relevant suites progressively, then:

```sh
pnpm run verify
OBSIDIAN_VERSIONS='earliest/earliest latest/latest' pnpm run test:e2e
OBSIDIAN_MOBILE_VERSIONS='earliest/earliest latest/latest' pnpm run test:e2e:android
```

The Android command requires the existing real emulator/Appium prerequisites; if unavailable locally, obtain results from the existing Android CI jobs. Obtain actual Windows/macOS/Linux CI results for this implementation revision. Do not convert unavailable infrastructure into a passing claim. Record commands, revision, resolved app/installer versions, exit codes, pass/fail/skip counts and artifact locations. Relevant unsupported skips or unresolved platform failures block a claim of full cross-platform completion.

Commit `test: verify font role inheritance across supported platforms`. Use the existing code-review and verification-before-completion skills before implementation handoff; no release/version bump is part of this plan.

## Coverage audit and execution handoff

| Spec coverage                                         | Implemented / verified by                      |
| ----------------------------------------------------- | ---------------------------------------------- |
| R1 native inheritance and neutral baseline            | Tasks 1, 2, 5; V01, V02, V04, V05              |
| R2/R3 role ownership, singles, pairs, global Emoji    | Task 2 plus Task 3 Hard boundaries; V01–V08    |
| R4 reversibility/live mutation/documents              | Tasks 3, 5; V09–V12                            |
| R5 Hard and compatibility boundary                    | Tasks 2, 3, 5; V04–V08                         |
| R6 unrestricted originals, alias, fallback            | Tasks 2, 3; V13, V14                           |
| R7 accurate settings/diagnostics                      | Task 4; V13, V15                               |
| V01 all 64 policy combinations                        | Task 2 step 4                                  |
| V02/V03 singles, pairs, distinct full assignment      | Task 2 step 5                                  |
| V04 native Appearance/theme tiers                     | Task 5 steps 1–2                               |
| V05/V06 heading/code boundaries and inheritance       | Task 2 step 5, Task 3 steps 1–2, Task 5 step 2 |
| V07 actual suggestion/settings/core derived consumers | Tasks 2, 4, Task 5 step 2                      |
| V08 hardcoded containers/icons                        | Task 3 steps 1–2                               |
| V09 native live changes                               | Task 5 step 2                                  |
| V10 role changes/no buildup                           | Task 3 step 3                                  |
| V11 existing/new pop-outs                             | Task 5 step 3                                  |
| V12 recovery/unload/no I/O                            | Task 3 step 4, Task 5 step 3                   |
| V13 missing/load failure                              | Task 3 step 5, Task 4                          |
| V14 shared family/escaping/weights                    | Task 2 step 4, Task 5 step 1                   |
| V15 honest and alias-aware Check                      | Task 4 steps 1–5                               |
| Windows/macOS/Linux, Android, explicit iOS status     | Task 5 step 5                                  |

Before implementation, the plan author checks this table against the specification, scans for incomplete placeholders, and checks every cross-task function/type/property signature. Document material corrections in the review record. A reviewer may check the final plan independently; that does not replace the author's writing-plans self-review.

Execution can use fresh implementer subagents with per-task review or the executing-plans workflow in one session. The current authorized deliverable ends with this reviewed plan; these implementation tasks remain unexecuted.
