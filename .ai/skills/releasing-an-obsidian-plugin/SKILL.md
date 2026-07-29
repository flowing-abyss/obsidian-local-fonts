---
name: releasing-an-obsidian-plugin
description: Cuts a release for this Obsidian plugin — bumps the version, verifies it end-to-end against real Obsidian, tags, pushes, and confirms the release actually came out clean on GitHub. Use when the user asks to release, publish, ship, or cut a new version of the plugin.
---

# Releasing an Obsidian Plugin

## The one command

```bash
pnpm run release patch   # or: minor / major
```

**Confirm with the user before running this.** It pushes a commit and a tag to the remote and (via `.github/workflows/release.yml`) creates a public draft GitHub release — a one-way action, not a local dry run.

## What it does, in order

1. **`preversion`** — runs `pnpm run verify` (format, lint, types, arch, dead code, coverage, build, artifact checks including README/LICENSE presence) and then `pnpm run test:e2e` against real Obsidian, on whatever OS this machine is. Aborts here, untouched, if anything fails — no partial release state.
2. **`version`** — bumps `manifest.json`'s `version`, syncs `versions.json` (via `version-bump.mjs`), stages both.
3. pnpm's own version step commits (`"<new-version>"`) and tags **without a leading `v`** (`--tag-version-prefix ''`) — the tag must equal `manifest.json`'s `version` exactly; this is what `release.yml` and Obsidian's community-plugin submission process both expect.
4. **`postversion`** — `git push --follow-tags`, which triggers three separate GitHub Actions workflows on the same push: `ci.yml` (fast gate, redundant with what `preversion` already ran), `e2e.yml` (the cross-platform proof — desktop on Ubuntu/Windows/macOS **and** real Android — that `preversion`'s local `test:e2e` alone can't give you, since that only covers this one machine's OS), and `release.yml` (build, re-verify, generate a changelog from commit messages, open a **draft** GitHub release with `main.js`/`manifest.json`/`styles.css` attached).

## The command finishing is not the release finishing — verify on GitHub

`pnpm run release` returning success only means the **local** steps and the push worked. The actual release isn't real until the CI it triggered has finished and produced a correct result. Do not tell the user the release shipped until you've checked this. Using the `gh` CLI:

```bash
# 1. Watch the e2e workflow through to completion — this is the whole reason
#    the desktop/Android matrix exists; a release without it passing hasn't
#    actually been proven to work everywhere.
gh run list --workflow=e2e.yml --limit=1 --json databaseId --jq '.[0].databaseId' \
  | xargs -I{} gh run watch {} --exit-status

# 2. Same for the release build itself.
gh run list --workflow=release.yml --limit=1 --json databaseId --jq '.[0].databaseId' \
  | xargs -I{} gh run watch {} --exit-status

# 3. Confirm the release actually exists and has a real changelog body, not
#    an empty one (a broken changelog-builder step still exits 0).
gh release view "$(git describe --tags --exact-match HEAD)" --json isDraft,body,name
```

If either workflow's conclusion isn't `success`, or the release body is empty/missing, **stop and report the specific failure** — don't retry `pnpm run release` blindly (the tag already exists; a second run will fail on `--allow-same-version` or collide with the existing tag). Diagnose from the failed run's logs (`gh run view <id> --log-failed`) and fix forward.

## What's still manual

- Open the draft release on GitHub, skim the changelog you just confirmed is real, publish it.
- Obsidian now runs an automated review on every submitted version (security + code-quality scan, results in minutes) — see https://obsidian.md/blog/future-of-plugins/. Before a first submission, or if you want a pre-check beyond what this repo's own `eslint-plugin-obsidianmd` rules already catch, use the developer dashboard's own preview-scan feature on the pushed tag (https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins) — it's the same scanner that gates review, and nothing local can fully replicate it.
- First release only: submit the plugin to the community catalog per https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin.

## If `preversion` fails

Nothing was tagged or pushed — fix the failure, rerun `pnpm run release <bump>`. Don't hand-bump `manifest.json`/`versions.json` to route around a failure; that's exactly the drift `release-check.mjs` and this whole chain exist to catch.
