# Independent font roles — implementation and verification

Date: 2026-09-28

Status: Implementation and reviews complete; exact-code desktop/Android verification passed. iOS remains unverified.

This record follows the [approved specification](../specs/2026-09-27-independent-font-roles-design.md), [implementation plan](../plans/2026-09-27-independent-font-roles.md), and [planning reviews](2026-09-27-independent-font-roles-review.md). The user subsequently authorized autonomous implementation and regression testing.

## Behavior and compatibility

Emoji decorates native font paths independently of Text, Interface, Monospace and Headings. Ordinary assignments remain independent; an unassigned role follows Obsidian's existing cascade and natural inheritance. Normal Appearance/theme precedence remains intact. Hard override targets only explicitly assigned ordinary roles.

The selected Emoji family gets an internal Unicode-restricted alias; its ordinary family stays unrestricted. A missing or unusable Emoji face leaves ordinary font rendering available. Existing settings and the platform-neutral cache retain their schema. No release version, scanner behavior, production dependency, font I/O during startup, network service or stylesheet delivery mechanism was changed.

Check now reports local loading and the requested font stacks of visible surfaces separately. It does not claim to prove every rendered glyph. Both legacy settings and the current separate settings document use the same result contract and suppress stale asynchronous results after detachment. Role changes apply to rendering immediately, before awaiting persistence, so a quick Check does not observe the new selection with the old CSS; save completion and rejection are still awaited.

## Executable coverage

| Contract / risk                                                | Verification                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every role subset, both Hard settings, inactive ownership      | `src/fonts/roles.test.ts`: all 64 policy combinations; face/alias behavior in `css.test.ts`                                                                                                                                                      |
| Each role alone and with Emoji, distinct simultaneous choices  | `tests/e2e/roles.e2e.ts`: real reading/editor/settings/suggestion surfaces compared with calibrated font references                                                                                                                              |
| Native inheritance, Appearance and theme priority              | `role-inheritance.e2e.ts`: independent native tiers, h1–h6, current Bases, live class/theme/snippet/Appearance changes without stylesheet regeneration                                                                                           |
| Ordinary roles configured before Emoji                         | `role-lifecycle.e2e.ts`: multiple assignments with Emoji absent, selected and cleared; every role A → B → null                                                                                                                                   |
| Emoji file arrives later / loading fails                       | `role-delivery.e2e.ts`: real adapter file copy into an isolated font folder and rescan; readable fallback on a failed font URL                                                                                                                   |
| Code/heading ownership                                         | `role-lifecycle.e2e.ts` and `role-headings.e2e.ts`: reading, regular/list headings in Live Preview/source, normal/Hard, assigned/unassigned Monospace, ordinary and Emoji glyphs; Appearance and independently styled code retain their priority |
| Native INPUT rendering                                         | `role-input.e2e.ts`: actual property input with positive and negative calibrated width controls                                                                                                                                                  |
| Main window, existing/new pop-outs, settings reopen            | `role-documents.e2e.ts`, `roles-calibration.e2e.ts`: actual native windows/handles, per-document baseline rendering, main/floating and pinned/unpinned restoration, hidden saved-window recovery                                                 |
| Persistence and fixture isolation                              | `role-cleanup.e2e.ts`: no writes for rendering only; rollback after current/fresh plugin instance writes, rejected writes, pending rescan and a delayed real adapter write                                                                       |
| Failed native cleanup                                          | `native-lifecycle.e2e.ts`: real canceled close, bounded failure, listener/state cleanup, exact error propagation and a subsequent real-glyph scenario                                                                                            |
| Stylesheet replacement, repeated application, unload/re-enable | `role-delivery.e2e.ts` plus existing delivery/lifecycle tests                                                                                                                                                                                    |
| Honest Check results and stale-result prevention               | `diagnostics.e2e.ts`, parser/probe/settings unit tests; native phone close/reopen regression                                                                                                                                                     |

The fixture fonts have distinct advances for Latin, Cyrillic, digits and Emoji, including variation-selector and ZWJ samples. E2E compares actual surface ranges with explicit reference rendering; merely finding a family name in CSS is insufficient. Failure artifacts record selections, native/computed stacks, font loading, app/renderer versions and screenshots from disposable vaults.

## Review and verification results

Code and test revision: `a57a5f27944933a7875481713d14ddccbd090f8c`. Any later documentation-only commit does not change this tested tree.

Local commands on the final code tree, all exit 0:

```sh
pnpm run verify
env -u ELECTRON_RUN_AS_NODE OBSIDIAN_VERSIONS='earliest/earliest latest/latest' pnpm run test:e2e
```

- Repository verification: 418 unit tests in 18 files, formatting, lint, CSS lint, both typechecks, dependency architecture, dead-code detection, coverage thresholds, production build and release consistency checks. Coverage: 99.02% statements, 96.03% branches, 99.38% lines.
- Full local macOS desktop E2E: 176 passed, four capability skips, zero failed; all 26 spec/version pairs. Versions: Obsidian 1.0.3 / installer 0.14.5 / Chromium 100, and Obsidian 1.13.7 / installer 1.13.7 / Chromium 150.
- The pre-push hook reran the complete repository verification successfully before publishing this branch revision.

Exact `a57a5f2` remote results, collected from job logs:

| Job                                        | Result | Coverage                                                  |
| ------------------------------------------ | ------ | --------------------------------------------------------- |
| Node 22 / 24 repository gates              | Passed | 418 unit tests and all repository checks                  |
| Linux desktop                              | Passed | 176 passed / 4 capability skips, 26/26 spec/version pairs |
| macOS desktop                              | Passed | 176 passed / 4 capability skips, 26/26 spec/version pairs |
| Windows desktop, controlled second attempt | Passed | 176 passed / 4 capability skips, 26/26 spec/version pairs |
| Android 1.8.10                             | Passed | 76 passed / 14 capability skips, 13/13 specs              |
| Android 1.13.7                             | Passed | 77 passed / 13 capability skips, 13/13 specs              |

The first Windows attempt had 175 passes/four skips/one timeout. It stalled in the unchanged floor test's core `app.workspace.openLinkText('Welcome.md', '', true)` call, before editor mounting or glyph assertions. The preceding font registration, loading and independent rendered-width checks passed. The command trace identifies this outer navigation await but does not expose which inner view/file operation stalled. No plugin or speculative harness change was made for it. A single controlled same-SHA Windows rerun passed every test in2m31, including the editor-tier case on both versions. This supplies fresh coverage; it does not prove a causal fix for the initial stall. Both attempts are preserved in the local evidence and CI history.

The [final scoped code review](2026-09-28-independent-font-roles-code-review.md) addressed both original Important findings and found no new Critical, Important or Minor breakage. It verified recorded causal regressions and covering logs. Its then-pending platform gates subsequently completed as shown above. Final exact-code runs both concluded successfully: [repository CI](https://github.com/flowing-abyss/obsidian-local-fonts/actions/runs/36343342536) and [desktop/Android E2E, attempt2](https://github.com/flowing-abyss/obsidian-local-fonts/actions/runs/36343342523/attempts/2). Earlier [6ebb9a8 E2E](https://github.com/flowing-abyss/obsidian-local-fonts/actions/runs/36341881450) passed both Android versions and Windows/macOS with identical production source; its Linux setup-root failure is diagnosed below.

Capability skips are explicit: old desktop Obsidian has no Properties/Bases consumers, and Android has no desktop pop-out windows. Android 1.8.10 also predates Bases. Fundamental role and editor/heading tests are not skipped on either supported version.

The final whole-branch reviewer found two Important issues. One combined fix wave addressed them over `6b80bff..a57a5f2`:

1. **Headings selected inline code inside list headings.** Hard selectors now exclude code. The floor app's native specificity is handled by routing the heading variable through the native Monospace stack only on list code, without raising code `font-family` priority. Three new unit tests failed before the fix; the real editor matrix then passed 20 cases across both desktop versions.
2. **Native-window cleanup had a mutating observation and an asynchronous focus race.** Observations now read `activeLeaf` directly. Pinned-leaf characterization proves that the old getter can return/create another leaf and, in current Obsidian, select it. Separate direct observations reproduced selection drifting after cleanup because native focus still belonged to the other window. The disposable test helper now awaits actual Electron window closure before restoring layout, shows and activates the saved native window, then restores selection after focus completion. Tests retain native handle/window identity, original-root and close-before-layout assertions, and observe actual native `onFocus` callbacks. They cover main/floating roots and both pin states, plus a saved main window hidden during the scenario. The old remote Windows trace cannot retrospectively distinguish the unsafe observation from the focus race.

The setup of the preserved pop-out now explicitly requests `{ active: true }`. The current app otherwise leaves a new window's leaf inactive until a deferred focus callback runs, and that callback can do nothing after focus moves away. A real-window regression holds that automatic callback and verifies that the intended leaf is still selected and attached; the old setup fails on current Obsidian. This corrects the fixture precondition without changing restoration assertions. A subsequent floor Linux trace identified a second preparation gap: after selecting main synchronously, a deferred native callback had already changed the saved leaf to floating. Cleanup correctly restored that captured floating leaf. Calibration now resolves the intended root, awaits actual native activation, then selects/pins and captures identity in one renderer task, asserting the intended root before the scenario begins. A real-native suppressed-focus regression fails with selection alone on both versions. A separate canceled-show control proves the bounded setup error crosses WebDriver once, followed by a successful new selection. The final focused native suite passed 30 cases; restoration assertions remain unchanged.

The native restoration corrections have causal regression evidence: reverting focus restoration caused three failures across both desktop versions; removing the native-close await caused eight; replacing show-and-activate with focus-only failed all four hidden-window controls. The helper's event waits have failure-only deadlines with listener/timer cleanup. A real canceled-close fault verifies bounded failure, the exact error, restored listener count, cleared scenario state and a subsequent successful glyph scenario. Errors cross WebDriver as structured data and are thrown in Node, preventing WebDriver's retry of a rejected renderer command from turning a failed cleanup into apparent success. These changes are confined to disposable test fixtures; production window management is unchanged.

The native completion requirement was sharpened by a Linux failure on the intermediate `6848ca0` tree, after Windows and macOS had passed. Latest Android on that intermediate tree also lost its emulator connection during execution; instrumentation/logcat exited and adb could no longer find the device. That is evidence of device loss, not a failed glyph comparison or a known initial cause. No speculative plugin or infrastructure change was made for it. Final revision results above supersede those intermediate runs without claiming to explain every historical failure.

Additional exact-code CI exposed a real diagnostics race while a role change was being saved. Holding persistence pending and using the actual dropdown and Check reproduced it on both desktop versions. Applying the new role before awaiting the save fixes it; unit tests cover both settings paths and preserved rejection, and the actual-app regression verifies the selection while persistence is still pending.

The native traces also separated two CI fixture problems. In Linux, the disposable herbstluftwm display used its default policy that rejects application focus requests; the [official manual](https://herbstluftwm.org/herbstluftwm.html#_settings) documents that policy. The CI setup now records its value before and after enabling application activation, with all native assertions and concurrency preserved. In Windows, the trace stopped at an unconditional cleanup settings write after native closure had completed. The official floor app's adapter has a 60-second queue watchdog, matching the observed delay; the initially stalled filesystem/reconciliation action remains unknown. Cleanup now tracks actual plugin-data write attempts at the adapter boundary, waits for in-flight writes/scans, and restores disk only when the scenario attempted persistence. This survives plugin reload and treats rejected attempts conservatively. Pure rendering scenarios do not need a disk write. Real adapter tests prove both no-write cleanup and persisted rollback; reverting the helper also reveals a delayed save overwriting the already-restored settings. Required-write failures remain visible.

Earlier review findings around detached diagnostics, phone settings animations, font readiness and native fixture restoration were resolved with focused regression evidence before the final review. In particular, the phone close/reopen regression exercised the official 1.8.10 animation completion; the full Android runs verify the corresponding real-app path.

## Evidence limits

- iOS remains **Unverified**: no real device was available. The [manual procedure](../../../tests/manual/font-roles-ios.md) records required cases and evidence. Desktop/mobile emulation and Android do not establish WebKit behavior.
- The original remote Windows report is not a proven root cause. This work fixes the independently confirmed Emoji-only coupling and the verified role-boundary defects.
- OS-native menus, isolated iframe/shadow content, arbitrary third-party important/hardcoded stacks, diagram rendering and print/export typography are not a universal override guarantee.
- Historical floor-version native-window timeouts are not attributed to a demonstrated common cause. A hidden latest pop-out can stall an animation-frame-based glyph probe; that controlled observation did not reproduce the old floor failures. Preserve this harness reliability limit separately from fresh platform results.
- A separate native-focus deadline occurred during the old-setup regression RED run. The target/main document was unfocused, but the old log abbreviated the floating-focus array, so the focus owner remains unknown. A scalar in the existing bounded trace now preserves that observation. The explicit activation correction is not claimed to explain this separate event; strict completion assertions remain.
- No release, merge or deployment into the user's personal vault was performed.

## Handoff

The implementation is preserved on `feat/independent-font-roles` in the isolated `independent-font-roles` worktree. The tested code revision is `a57a5f27944933a7875481713d14ddccbd090f8c`; this record and the scoped-review transcript are documentation added afterward. The specification and plan remain unchanged from their approved planning revision. No source edits followed the final scoped review.

The plan's temporary orchestration workspace is archived locally at `/tmp/local-fonts-independent-font-roles-evidence-2026-09-28.tar.gz` before cleanup. The committed tests, this record and the linked CI runs are the durable verification references.

## Real-vault release verification

On 2026-09-28, the reviewed build was installed in the owner's actual vault and exercised through Obsidian CLI on Obsidian/installer 1.13.7, Electron 43.3.0 and Chromium 150.0.7871.212 on macOS. The existing Base16 Default Dark theme and enabled snippets remained active. CDP `CSS.getPlatformFontsForNode` identified the actual rendered families, including custom-font identity, rather than relying on computed CSS alone.

- Twenty-three reading-view configurations covered the disabled-plugin baseline, all roles unset, Noto/Twemoji alone, each ordinary role alone and with either emoji family, all ordinary roles with no emoji and either emoji family in normal/Hard mode, and reset to native defaults. Native and unset results matched; unassigned ordinary roles retained their original fonts.
- Alt+P is the vault's QuickAdd MAIN MENU command. Both emoji families rendered in that actual menu independently of Text, Interface and Headings. Its text retained the native interface font unless Interface was assigned. The core quick switcher and the installed command palette were also checked.
- The actual settings dropdowns applied and persisted changes in Obsidian's separate native settings window. Its labels retained their ordinary font while an inherited sample used Noto or Twemoji. Check reported local loading and stack priority. Existing note pop-outs followed live font changes and emoji removal.
- Eight Live Preview/source configurations verified Text, Headings, list-heading inline code, assigned/unassigned Monospace, absent/present Emoji and Hard override. All six reading-view heading levels used the assigned family with Hard override.
- Original role assignments and settings were saved back and verified after a plugin reload. Plugin data matched the original JSON, Appearance/app/hotkeys files were unchanged, the original main layout and active leaf were restored, and the task-owned note was removed. No Local Fonts errors appeared in the captured console errors.

CLI's socket initially needed a normal Obsidian restart. Intermittent standalone `dev:cdp` transport timeouts were avoided by issuing the same CDP requests through CLI `eval`; no plugin source change was made for these tooling issues. This live macOS check does not identify the original remote Windows user's cause or replace the release's desktop/Android CI gate. Local raw evidence and backups are retained outside the repository to avoid publishing private vault configuration.
