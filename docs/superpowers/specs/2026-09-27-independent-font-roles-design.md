# Independent font roles

Date: 2026-09-27

Status: Approved by the specification-review subagent after correction of four material findings. This document specifies a future implementation; it does not report that the implementation or its test matrix has passed.

## 1. Purpose and scope

Make Text, Interface, Monospace, Headings and Emoji independently usable. A person can select only one role, including Emoji, and continue using Obsidian Appearance settings and the theme for the remaining roles. Existing combinations must keep working.

This is one change to font-role composition, application and verification. Font discovery, parsing, face selection, caching and stylesheet delivery remain separate responsibilities. The work includes honest diagnostics and regression coverage because the existing checks do not establish whether an independently selected role works in its intended surface.

The initial Windows/QuickAdd report is not a confirmed root cause. The confirmed defect is that selecting only Emoji currently registers a font without assigning it to any surface. Do not describe this work as a verified fix for that person's machine.

The user requested a specification, subagent specification review, implementation plan and plan review in this session. Implementation, release and deployment to a personal vault are outside this planning deliverable.

## 2. Evidence and current limits

- `src/fonts/css.ts:233`: role stacks are produced only for non-null Text, Interface, Monospace and Headings. Emoji has no independent application branch.
- Invoking the installed 1.3.0 generator on copies of settings produced no application rules for Emoji alone, both with Hard override off and on. Text + Emoji and Interface + Emoji produced their respective rules. Saved settings were not changed.
- `src/fonts/css.ts:309`: Hard override applies Interface to a container. An inherited important value does not defeat a descendant's own declaration.
- `src/fonts/probe.ts:29` and `src/settings-tab.ts:661`: Check measures a separately styled sample. It does not inspect an actual editor, heading or menu.
- `src/fonts/css.test.ts:294`: the emoji-priority test already assigns Text. The emoji-only test checks a Unicode range, not application.
- The e2e fixture assigns Text only and sets Emoji to null. Existing e2e coverage verifies stylesheet delivery, a text face, and the editor, not independent roles or real emoji glyph selection.
- In the user's Obsidian 1.13.7 / Electron 43.3 / Chromium 150 on macOS, QuickAdd MAIN MENU uses Noto Color Emoji for the map glyph, confirmed by CDP `CSS.getPlatformFontsForNode`. This does not establish Windows behavior.
- The running app composes `--font-text` and `--font-interface` as comma-separated override/theme/default lists. Existing comments describing a nested `var()` fallback chain are not an authoritative description of all supported Obsidian versions.
- Read-only inspection of the cached official app CSS found a version difference: Obsidian 1.0.3 ends `--font-text` in `var(--font-interface)`, while 1.13.7 ends it in `var(--font-default)`. Interface can therefore legitimately affect unassigned Text through native fallback on the minimum version.
- Native `h1`–`h6` rules consume `--hN-font` globally in both inspected versions. Preserve this native heading behavior; do not promise that a semantic UI heading using these variables is independent of Headings.

## 3. Global constraints

These exact constraints also belong in the implementation plan.

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

## 4. Role contract

### R1. Meaning of an unassigned role

`null` means: do not choose a font for this role. Obsidian's normal Appearance/theme/default behavior and natural inheritance remain in effect. An independent Emoji selection may decorate that inherited stack for emoji characters.

Independence is ownership of a setting, not freezing every surface to its appearance before any role was selected. For example, an unassigned heading inherits its actual parent: Text in an ordinary note, Interface in an ordinary dialog. A heading with a separately defined theme font keeps that font until Headings is explicitly assigned. On older Obsidian, unassigned Text can fall back to Interface. Inline code inside a heading follows Monospace, not Headings. Emoji unset leaves the normal glyph fallback of the resulting text stack in effect.

The user clarified that the existing vault-local configuration model and general behavior must remain intact. Role assignments continue to sync as existing plugin settings; normal native inheritance remains a CSS consequence, not a new user-facing mode or a new priority rule. The required new behavior is a global Emoji assignment independent of the four other dropdowns.

The neutral baseline for tests is **the plugin loaded with all roles null and Hard override off**, with the same font registrations, Appearance settings and theme. This matters because Appearance can reference a vault font whose `@font-face` registration still comes from Local Fonts. Plugin unload must separately remove those registrations and restore the native cascade; it cannot keep a vault-only font available after unload.

### R2. Ownership and precedence

| Role      | Owns                                                                                                                                              | Does not independently choose                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Text      | Note body text in reading view, Live Preview and source view; native text-variable consumers                                                      | Interface, code font, explicitly styled heading font                                                            |
| Interface | Obsidian chrome, sidebars, settings, command palette and suggestion dialogs                                                                       | An independent Text selection, code, explicitly styled headings; native Text fallback to Interface is preserved |
| Monospace | Reading inline/fenced code and source/Live Preview code                                                                                           | Ordinary paragraphs, interface text, heading text outside code                                                  |
| Headings  | Native heading-variable consumers: h1–h6, source headings and the note inline title; semantic UI headings follow Obsidian's existing variable use | Ordinary interface labels, code inside headings                                                                 |
| Emoji     | Covered emoji characters in all supported role surfaces                                                                                           | Latin/Cyrillic letters, ordinary digits, icon-font glyphs outside the emoji range                               |

For non-emoji glyphs, preserve the existing normal-mode cascade: Local Fonts writes the assigned role's override/theme tiers on `html body`; native inline Appearance values and higher-priority theme/snippet rules may still win. With no such conflict, the explicitly selected role face must render in its intended surface. Hard override retains its existing purpose of enforcing explicitly assigned roles on supported surfaces. Do not silently change this precedence to make a test green.

For Emoji, prepend a restricted alias to each already resolved role stack, whether that stack came from Local Fonts, Appearance, the theme or Obsidian defaults. Emoji therefore has one global selection across the supported Obsidian UI, independent of which other roles are assigned. Preserve the complete underlying stack for non-emoji glyphs. When Emoji is null, do not change existing non-emoji stack/fallback composition merely as incidental refactoring.

### R3. Required independent configurations

1. All roles null: no application rules and no change from the neutral baseline.
2. Only Text: its selected face draws ordinary note text; Interface and Monospace match their baseline; headings retain native inheritance or their explicit theme font.
3. Only Interface: UI changes; Text and headings follow this Obsidian version's existing inheritance/fallback dependencies, and independently defined Text/code stacks retain their baseline.
4. Only Monospace: inline and fenced code change; ordinary paragraphs and UI keep their baseline.
5. Only Headings: every supported note heading level and the inline title changes; note paragraphs, ordinary UI labels and code keep their baseline. Semantic UI headings which natively consume heading variables retain that behavior.
6. Only Emoji: the selected face supplies covered emoji in notes, headings, code, menus and settings; non-emoji text in each surface matches its own baseline.
7. Each non-emoji role + Emoji: both settings apply without assigning unrelated roles.
8. Every subset of assigned roles composes without cycles or invalid font lists. Distinct assigned families remain distinct.

### R4. Reversibility and live changes

Changing a role from A to B, or from a family back to null, must update all supported surfaces without a reload. Removing Emoji restores ordinary emoji fallback without discarding other selected roles. Removing another role retains Emoji.

Appearance font changes, switching between light/dark themes, changing a theme's body font variables and enabling/disabling a snippet must continue to affect unassigned roles and fallback stacks while the plugin is enabled. Repeat application must not grow lists or retain previous selections.

Existing and newly opened desktop pop-outs must receive the same rules but resolve their own document's native values. Opened/closed/reopened settings and suggestion dialogs must inherit the current values. Disable/re-enable and stylesheet replacement must recover through the existing delivery mechanism.

### R5. Hard override and compatibility boundary

Normal mode supports Obsidian's native font variables, the documented theme tiers, and native inheritance. It must also support known theme consumers which read `--font-*-theme` directly, without changing their unassigned non-emoji baseline.

Hard override adds important `font-family` rules only for explicitly assigned non-emoji roles, on the standard mapped role surfaces. It does not activate an unassigned text role. Emoji-only is functional in normal mode; toggling Hard override with only Emoji selected must not replace a theme's hardcoded text font with a guessed base font.

Preserve a theme/plugin's independent descendant font declaration outside the supported native-variable path unless an explicitly assigned role's documented Hard override selector targets that surface. Arbitrary inline important declarations, isolated iframe content, private shadow trees and third-party hardcoded font stacks are not a universal override promise. Do not add selectors for QuickAdd-specific versions merely to claim coverage; verify its normal suggestion path.

There must be no universal important font-family rule. Hard heading selectors target note surfaces, rather than adding global important rules for every UI heading; the normal native heading variables keep their existing behavior. An icon with its own font declaration must retain it. A global `.svg-icon { font-family: revert !important }` is not an acceptable substitute for scoped ownership: it can itself replace an icon's declaration.

### R6. Emoji registration and fallback

Keep ordinary family registrations unrestricted. Emit an additional plugin-private `@font-face` alias for the selected emoji family using the same selected source URL and the existing emoji Unicode range. This prevents selecting a family for Emoji from restricting that family's normal registration when it is also used by another role or Appearance.

The alias is deterministic for the current catalog and cannot collide with an ordinary registered family. It remains internal and is never saved or offered in dropdowns. Emit matching aliases for selected weights/styles of the chosen family. Both original and alias declarations reuse a resolved source URL within one CSS build.

No usable emoji face: omit the alias prefix, retain normal rendering, and use the existing unsupported/missing-family diagnostics. A registered file that fails to load must fall through to the original stack and be visible in Check. Emoji glyph coverage and color-format support are not expanded by this change.

### R7. Settings and diagnostics

Keep the five dropdowns, existing null option labels and the existing Hard override toggle. Emoji description: `Replaces emoji throughout Obsidian, independently of the other font choices.` Explain normal native inheritance, synced role assignments, and the existing Appearance/theme conflict behavior in README. Do not rename unrelated controls or require an additional emoji-only mode.

Check must distinguish local font loading from the font stack used by an inspected surface. Loading is reported as `Local font loaded`, `Local font could not be loaded`, or `Could not verify this font`. For each assigned role, inspect representative currently open standard surfaces in the current diagnostics document. For Emoji inspect all available role categories. Report `Selected font is first in the checked stack`, `Another font is listed first here`, `Selected font is absent from the checked stack`, or `No matching open surface to check`, with the surface name. A literal missing-family placeholder `??` is not an effective competing font for this order check. Non-emoji checks also ignore this build's managed restricted emoji alias, because it intentionally precedes ordinary text. Emoji checks look for that alias, not the ordinary registration, while displaying the user's selected family name. Other restricted or unknown font families are not silently ignored.

Do not say that a named earlier font actually rendered merely from its position. A competing or absent stack is useful conflict evidence; actual glyph selection is a different question. Explain once: `Checks font loading and the font stacks of open views. Results do not verify every rendered character.` This preserves useful conflict feedback without the existing misleading universal rendering claim.

Use `document.fonts.load()` with explicit sample text so the restricted alias/range can be requested when needed. A non-empty successful local-face result proves loading; a rejected load is a load failure; an empty result or unavailable API is inconclusive, not proof of fallback or success. Keep per-role names and selected families in the results, and parse font-family lists correctly for quoted/escaped names. Actual application is established by e2e rendering checks, not asserted by the stack inspection alone.

The visible diagnostics document must come from the current render target's `ownerDocument`, not a stale legacy `tab.containerEl`. Keep both rendering paths and the 1.13 `renderTab()`/`update()` behavior working.

## 5. Architecture

### Alternatives considered

1. **Native CSS inheritance with an ancestor baseline and descendant composition — selected.** Keeps original variables live, works independently in each mirrored document, and requires no theme observers or runtime font-stack snapshots.
2. Runtime `getComputedStyle()` capture and reconstruction. Rejected for this scope: suppressing one's own CSS, tracking every theme/Appearance mutation and preserving different pop-out defaults add state and race risks.
3. Wrap emoji text or override every DOM element's font. Rejected: modifies note/UI content, adds maintenance/performance costs and threatens code/icon fonts.

### A1. Responsibilities

- `scanner`, `metadata`, `catalog`, `platform`, `select`: unchanged platform-neutral metadata and per-device face selection.
- New `src/fonts/roles.ts`: pure role policy, internal property names, independent emoji decoration and scoped application rules. It has no DOM, Obsidian or I/O imports. Existing non-emoji body variable declarations retain their cascade contract.
- `src/fonts/css.ts`: ordinary/emoji face declarations and stylesheet assembly. Preserve escaping, variable weights, resource URLs and Unicode policy.
- `src/main.ts`: retains delivery/lifecycle ownership; passes the existing settings and selected faces to CSS generation. No new snapshot state or theme watchers.
- `src/fonts/probe.ts` and `settings-tab.ts`: accurately scoped font-loading diagnostics and shared settings copy.
- E2e role fixtures/helpers: observations and comparisons against explicit reference rendering, with complete restoration of temporary state.

### A2. Two CSS scopes, no circular custom properties

First generate the existing non-emoji role declarations on `html body`, without embedding Emoji in them. A null role still emits no such declaration. Their normal specificity and Appearance/theme precedence are preserved. Hard override composition receives the optional restricted emoji alias separately.

When Emoji has a usable face, additionally declare plugin-private baseline properties on `html body`, referencing the effective values **after the non-emoji assignments and native cascade**. For each text role capture its final `--font-X` value and each of its `--font-X-override` / `--font-X-theme` tiers separately. Separate tier baselines are necessary: a direct-theme consumer must not silently receive the Appearance font from the final stack. Capture each `--hN-font` separately; preserve its guaranteed-invalid/inherited state rather than inserting the literal keyword `inherit` into a font list.

On `html body > *`, prepend the restricted emoji alias to each inherited baseline. Update the final native variable and its two native tiers independently from their respective baselines. Do not supply a fallback to a missing/guaranteed-invalid baseline: the decorated custom property must remain invalid too, so its `font-family` consumer continues to inherit from its actual parent. This descendant layer exists only while a usable Emoji selection is active; without Emoji, retain the original body-based non-emoji application route. Native values on `html` are never written. On `body`, only explicitly selected non-emoji roles may write their existing native properties.

While Emoji is active, set the descendant scope's normal `font-family` to its decorated interface variable. This is necessary because inheriting `body`'s already computed font-family would otherwise keep the original interface font. If Hard override explicitly assigns Interface, its important rule must reach this same root boundary so the decoration does not reverse Hard override's priority. The scope covers workspace roots and modal/pop-out roots; inserted roots acquire it automatically.

Illustrative data flow (names are examples, not complete production CSS):

```css
html body {
  --local-fonts-base-text: var(--font-text);
}
html body > * {
  --font-text: '__local-fonts-emoji__', var(--local-fonts-base-text);
}
```

The ancestor value resolves before it is inherited. Thus the descendant can redefine `--font-text` without referring recursively to itself. A root Appearance/theme change recomputes the baseline and descendant values through CSS. A separate document resolves against its own body.

For headings, preserve a missing/inherited native heading value as invalid, without a Text fallback: the actual heading inherits its already decorated parent. This preserves Interface in dialogs, Text in ordinary notes, and explicitly enforced Hard Text on its note container even when Appearance supplies a different normal Text variable. An explicit heading font, whether from Local Fonts or the theme, stays in the captured per-level stack. Do not collapse h1–h6 baselines into one family. Headings unset and Emoji unset emits no heading-variable override.

The finite supported consumer inventory includes the following body-resolved derivatives. Capture and decorate each independently, preserving its own native font and invalid/inherited state; changing its upstream variable at the child is insufficient. Variables absent from older Obsidian remain invalid without breaking inheritance.

| Native variable         | Standard consumer / baseline                                                      |
| ----------------------- | --------------------------------------------------------------------------------- |
| `--inline-title-font`   | Note inline title; normally derived from `--h1-font`                              |
| `--table-header-font`   | Reading/embedded table headings; normally inherited                               |
| `--file-header-font`    | Current-app file header; normally derived from Interface                          |
| `--metadata-label-font` | Current-app property keys; normally derived from Interface                        |
| `--metadata-input-font` | Current-app property values and related controls; normally derived from Interface |

This change covers DOM text rendered through the stated native font paths. Mermaid's renderer, canvas watermark branding (`--font-default`), print/export typography and native operating-system menus are not expanded into new role surfaces. `--font-mermaid` exists in app CSS, but its rendering path is not established by a `font-family` consumer there; do not claim diagram coverage from the variable alone. This boundary does not narrow existing role rules or disable fonts already inherited by those features.

Body text nodes outside an Obsidian application/modal root and custom descendants which deliberately redefine the native variables are outside the standard-surface guarantee. Do not conceal this boundary with document-wide mutation or more generic selectors. Test the real root structure on every supported engine/version before accepting this strategy.

### A3. Delivery and restoration

Every generated face, baseline and composition rule belongs to the existing plugin stylesheet text. No second sheet, direct body style edit, CSSOM-only production insertion or persistent native-setting mutation is needed. Removing generated text removes both baseline and composition layers. Existing style observers remain responsible for replacement/reload recovery and for teardown.

### A4. Standards and evidence

- [CSS custom properties: cycles and inheritance](https://www.w3.org/TR/css-variables-1/#cycles): ancestor values resolve before inheritance; a descendant redefinition can use that resolved baseline without a cycle.
- [CSS font character ranges](https://www.w3.org/TR/css-fonts-4/#unicode-range-desc): font usage is restricted by the declared range and the face's character map.
- [CSS inheritance](https://www.w3.org/TR/css-cascade-5/#inheriting): important declarations on ancestors do not remove independent declarations on descendants.
- [Obsidian typography variables](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Reference/CSS%20variables/Foundations/Typography.md): the public interface/text/monospace theme tiers.
- [Obsidian CLI](https://obsidian.md/help/cli): runtime CSS, DOM and CDP observation.

A temporary, removed DOM probe in the user's current Chromium verified the proposed ancestor/descendant dependency pattern and automatic propagation after a baseline changed from Arial to Georgia. This is evidence for the mechanism only; it is not a substitute for the minimum-version/platform matrix or full role rendering tests.

## 6. Verification contract

### V1. Oracles

Use distinct, deliberately shaped local fixture faces. Ordinary text samples include Latin, Cyrillic and digits; emoji samples include a simple emoji, a text-default emoji with FE0F, and a ZWJ sequence. Tests must prove which face rendered, not merely find a name in CSS or establish that two unknown fonts differ.

Cross-platform assertions compare actual-surface sample measurements against explicit reference samples using the selected face, and against distinct neutral-baseline samples. Calibrate fixture differences first. Emoji fixtures must have distinguishable metrics or distinguishable canvas pixel signatures; equal-width emoji is not evidence of equal font selection. On desktop, CDP actual-font observations can corroborate references, but cannot be the only oracle because Android and iOS differ.

Await loading with explicit sample text and use condition polling, not fixed sleeps. Store useful failure evidence: platform, app/installer/renderer versions, selections, baseline/effective stacks, loading results, relevant stylesheet text and screenshot. Do not retain real personal-vault content in test artifacts.

### V2. Coverage matrix

| ID  | Scenario                                                                                                                              | Required level / evidence                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V01 | All-null baseline, all 32 role-assignment subsets, both Hard modes                                                                    | Pure generation tests: active/inactive ownership, valid expressions, no cycles/growth, no empty/unavailable alias                                                           |
| V02 | Each of five roles alone                                                                                                              | Real Obsidian: selected-face reference matches; native dependency/fallback behavior retained, independent non-emoji stacks unchanged                                        |
| V03 | Each text role + Emoji; all roles with distinct faces                                                                                 | Real Obsidian: both selected faces, no role leakage, normal glyph fallbacks                                                                                                 |
| V04 | Appearance custom fonts and body theme variables                                                                                      | Real Obsidian: existing normal/Hard precedence retained, Emoji decorates the winning stack; unassigned roles and separate direct-theme readers preserve non-emoji baselines |
| V05 | h1–h6 inherited defaults, distinct per-level theme fonts, inherited/explicit inline-title and table-header fonts, code inside heading | Real reading/source/Live Preview surfaces; actual parent inheritance, Hard Text + native Appearance, UI semantic headings, and Monospace specificity                        |
| V06 | Inline/fenced code versus ordinary text                                                                                               | Actual reading/source/Live Preview rendering, both Hard modes                                                                                                               |
| V07 | Emoji only in suggestions, settings, note text, headings and code; version-gated file header and property controls                    | Actual native SuggestModal/command-palette path and settings; selected emoji with unchanged non-emoji glyphs, including independently derived stacks                        |
| V08 | Hardcoded role-container font and independently styled icon                                                                           | Hard mode affects only explicitly assigned standard roles; emoji-only does not coerce unassigned hardcoded fonts; icons retain their declared face                          |
| V09 | Theme, light/dark class, snippet and Appearance changes while active                                                                  | Native mutation plus settled rendering; no plugin rescan or manual reapply needed for baseline CSS changes                                                                  |
| V10 | Set A, set B, clear role; add/remove Emoji; repeated apply                                                                            | No obsolete rules/aliases, unchanged unrelated roles, baseline restoration                                                                                                  |
| V11 | Existing and newly opened desktop pop-outs; settings reopen                                                                           | Compare rendering and per-document body baselines, not merely cloned CSS text; pop-outs excluded only on platforms without this feature                                     |
| V12 | Disable/re-enable, own stylesheet replaced or text reloaded                                                                           | Existing lifecycle guards plus new composition restores correctly; no mutation after unload                                                                                 |
| V13 | Missing/unrenderable selected family or failed font URL                                                                               | Readable original fallback, no broken variable list, accurate availability result                                                                                           |
| V14 | Emoji family also chosen as Text/Appearance; quoted family names; multiple weights                                                    | Ordinary face unrestricted, emoji alias restricted and collision-free, shared URL resolution, existing weight behavior retained                                             |
| V15 | Check under emoji-only, Text+Emoji, conflicting theme, native Appearance and no open note; 1.13 visible settings document             | Alias-aware role ordering, loading and requested-stack results are distinct and never claim universal application; both settings paths display the same copy/results        |

Implement all 64 policy combinations as cheap pure tests. Use the listed scenario groups for real applications; do not multiply every theme, mode and role into an unbounded Cartesian product. Cover every role alone, every role+Emoji pair and the important boundary interactions with independent baselines.

### V3. Platforms and version floors

- Windows, macOS and Linux: existing CI runs the desktop minimum and latest stable app/installer pairs.
- Android: existing real-app/Appium matrix, minimum 1.8.10 and latest; do not substitute desktop mobile emulation.
- iOS: manual real-device record for emoji-only, Text-only, Interface-only, distinct full assignment, settings/modal, theme change and unload/re-enable. Exercise a supported color build; report app/iOS/device/font format. Without this record, report iOS as unverified and do not claim full cross-platform completion.
- Add a current-app/previous-installer diagnostic case only when an available supported pair exposes a specific compatibility boundary; do not silently change the documented support floor.
- Built-in/Bases surfaces which do not exist in the minimum app get an explicit version-gated latest-app case. All fundamental role tests must still run at the minimum.

### V4. Risk map

| Risk                                                      | Severity | Verification                                                              |
| --------------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| Cross-role leakage / native Appearance lost               | High     | V01–V06, V08–V10                                                          |
| Recursive variables / missing heading fallback            | High     | V01, V05, V09, V13                                                        |
| Font names present but incorrect glyphs actually rendered | High     | V02, V03, V07 and calibrated reference oracles                            |
| Pop-out baseline or stylesheet delivery regression        | High     | V11, V12                                                                  |
| Settings diagnostics falsely reassuring users             | Medium   | V13, V15                                                                  |
| Existing saved selections accidentally change precedence  | High     | V04, V10, explicit README precedence description                          |
| Alias breaks an ordinary registration or font loading     | Medium   | V13, V14                                                                  |
| Extra observers, I/O or repeated application growth       | Medium   | V10, V12; existing startup/lifecycle tests and resource-resolution counts |
| Storage migration / network access                        | Low      | No schema/dependency/network change; diff and existing invariant checks   |

## 7. Completion criteria

R1–R7 have executable coverage mapped to V01–V15. The future implementation passes the repository's required checks and the relevant desktop/Android matrix, with an explicit iOS evidence status. No statement that a platform passes may be based only on a CI configuration or a macOS run.

The current deliverable is complete when this specification has been reviewed by a subagent, material findings have been resolved, and the implementation plan has passed the writing-plans self-review and a documented review against this specification. Source implementation and new test execution belong to the later execution phase.
