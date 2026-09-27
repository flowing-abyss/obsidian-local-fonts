# Independent font roles: planning review

Date: 2026-09-27

Scope: documentation and implementation planning. Source changes, new implementation tests, builds, release and personal-vault deployment are not part of this deliverable.

- [Specification](../specs/2026-09-27-independent-font-roles-design.md)
- [Implementation plan](../plans/2026-09-27-independent-font-roles.md)

## Specification subagent review

Reviewer: `spec_review`, using the brainstorming specification-review prompt.

Initial status: **Issues Found**. Four material findings were corrected:

| Finding                                                                                  | Resolution                                                                                                                             |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Interface-only expectations contradicted native 1.0.3 Text fallback                      | Preserve each version's native inheritance; independent assignment does not freeze dependent surfaces                                  |
| Body-resolved font derivatives were missing                                              | Add separate inline-title/table/file-header/property font baselines; state the diagram/branding/print/native-menu boundary             |
| A Text fallback for inherited headings changed UI fonts and defeated inherited Hard Text | Preserve guaranteed-invalid heading values so the actual parent supplies the font; preserve existing native semantic heading consumers |
| Diagnostics would misidentify the managed Emoji alias as a competing Text font           | Ignore that alias for ordinary role ordering; inspect it explicitly for Emoji, displaying the selected family name                     |

Repeat-review status: **Approved**, with no remaining material issues. The reviewer verified the corrected specification, not an implemented feature.

## Author's writing-plans self-review

This was performed by the plan author, separately from the independent plan reviewer, as required by `writing-plans`.

- **Specification coverage:** R1–R7 and V01–V15 are mapped to exact tasks/steps in the plan. All 12 global constraints were copied. The supported-platform matrix and iOS evidence requirement remain explicit.
- **Placeholder scan:** No unfinished requirement markers or deferred implementation placeholders. The plan includes concrete paths, test inputs, observable assertions, interfaces and commands. Existing helper signatures and newly introduced signatures are identified separately.
- **Type/interface consistency:** Family quoting has one owner without a CSS/role import cycle. The parser preserves generic-vs-quoted family identity. Role helpers share a typed plugin boundary and three explicit document targets. Full settings/cache snapshots are restored. Renderer callbacks do not close over host runtime helpers.
- **Scope:** No new font scanning, platform cache choice, synchronization service, production network/dependency, theme observer or per-document stylesheet mechanism. No blanket claim about arbitrary hardcoded third-party text or the original Windows machine.
- **Verification quality:** Tests compare actual DOM text to calibrated explicit references; missing targets and missing platform execution cannot count as passing. The test baseline retains ordinary face registrations so Appearance can still reference vault fonts.

The self-review corrected ambiguous helper cleanup, quoted generic handling, actual settings sample construction, the literal policy-matrix example and fresh-family load-failure setup before final handoff.

## Independent plan review

Reviewer: `plan_review`, using the writing-plans plan-review prompt. This additional review does not replace the author's self-review.

Initial status: **Issues Found**. Three material findings were corrected:

| Finding                                                                    | Resolution                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Hard Interface could override the reference span and invalidate the oracle | Inline important family on the reference only, plus a computed-family guard; the actual tested surface is untouched |
| Setup ran outside cleanup protection                                       | Put setup inside try/finally, allocate cleanup state before mutations and tolerate partial initialization           |
| Settings glyph tests assumed the main document                             | Add a settings target from the displayed tab container's ownerDocument                                              |

Repeat-review status: **Approved**, with no remaining material issues in the focused re-review. No implementation or test execution was performed by either reviewer.

## Document verification

- Explicit-path `pnpm exec prettier --ignore-path .prettierignore --check` for all three planning documents: exit 0.
- Documentation audit: 12 global constraints, none missing; R1–R7/V01–V15 coverage references, none missing.
- TypeScript parser check of 21 fenced TypeScript examples: zero syntax errors. This checks syntax only; it is not a typecheck or execution of the future implementation.
- Placeholder search: no unfinished markers found. The tracked source tree was unchanged during planning.

## Evidence boundary

The specification separates code-confirmed Emoji-only coupling from the unconfirmed Windows report. Read-only source review, cached official app CSS inspection and the limited local CSS observations described in the specification support the design. They do not establish that the planned feature works on Windows, Android or iOS.

The future implementation must execute the plan's regression and platform matrix, record actual results and report any unverified target. All implementation checkboxes remain open.
