# Font roles — iOS real-device verification

**Status: Unverified: no iOS device available.** No UI or console observations have been collected on iOS for this implementation. Desktop and Android results do not establish WebKit glyph selection.

Record before testing:

| Field                                             | Observed value |
| ------------------------------------------------- | -------------- |
| Date / tester / commit SHA                        | Unverified     |
| Obsidian app version / iOS version / device model | Unverified     |
| Theme / snippets / light or dark                  | Unverified     |
| Font names and file formats                       | Unverified     |
| Appearance Text / Interface / Monospace values    | Unverified     |
| Plugin roles and Hard override                    | Unverified     |
| Screenshot and console artifact paths             | Unverified     |

Use a disposable copy of `tests/vaults/minimal`, not a personal vault. Install the built plugin at the revision under test and select its `.fonts` folder. The bundled synthetic Role Baseline, Role Text, Role Interface, Role Mono, Role Headings, Role Emoji A and Role Emoji B fixtures are TrueType files with distinct advance widths. Record exact files used. For color-format selection also record actual COLRv0/COLRv1, SVG, sbix or CBDT/CBLC fonts used; synthetic monochrome fixtures alone do not validate color support.

Open `Role title ABCАБя0123 😀 ☀️ 👩‍💻.md`. Compare ordinary `ABCАБя0123`, emoji `😀`, `☀️`, and joined `👩‍💻` against reference images or widths rendered **on the same device** with the same size, weight and style. Record the reference and observed glyphs. A loaded FontFace, computed stack or the plugin's Check result is supplementary evidence, not proof of which glyph rendered.

For each row record Pass, Fail or Unverified, exact settings, observed glyphs, references and screenshot/console evidence. Run both Hard settings and record each separately.

| Scenario                                                   | Required observation                                                                 | Result / evidence |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------- |
| All roles null                                             | Native ordinary and emoji baseline recorded                                          | Unverified        |
| Emoji only (A, then B)                                     | Emoji matches selected reference; ordinary text unchanged                            | Unverified        |
| Text only                                                  | Note text changes; other roles keep their native baseline                            | Unverified        |
| Interface only                                             | Settings/suggestions change; Text follows this app's native dependency if present    | Unverified        |
| Distinct full assignment                                   | Text, Interface, Monospace, Headings and Emoji each match their reference            | Unverified        |
| Multiple ordinary roles, Emoji null → A → null             | Ordinary assignments remain stable throughout                                        | Unverified        |
| Reading / Live Preview / source                            | Paragraph and headings use intended fonts                                            | Unverified        |
| Inline and fenced code, code inside heading                | Monospace remains independent from Headings and Text                                 | Unverified        |
| Settings and suggestion modal                              | Ordinary UI baseline and selected emoji both verified                                | Unverified        |
| Inline title / table header / property key input and value | Explicit and inherited native fonts stay distinct; selected emoji appears            | Unverified        |
| Appearance override versus theme                           | Winning native stack and direct-theme readers retain independent baselines           | Unverified        |
| Light/dark, theme switch and temporary snippet             | Changes update live without a plugin rescan                                          | Unverified        |
| Each role A → B → null                                     | Native font restored when cleared; independent roles unchanged                       | Unverified        |
| Disable and re-enable plugin                               | Native rendering restored, then saved selections reapplied                           | Unverified        |
| Color fonts and fallback                                   | Correct supported face and actual colored glyphs, or honest missing-format diagnosis | Unverified        |

When a case fails, collect the visible surface, expected/actual glyphs, font files, native variables, role settings, Hard state, theme/snippets, Check output and available console errors before resetting it. Do not mark the matrix complete while any required row remains Unverified.
