# Contributing

Thanks for taking an interest. Issues and pull requests are both welcome.

## Getting set up

You need pnpm and a Node version matching `engines` in `package.json`, then

```
pnpm install
pnpm dev
```

`pnpm dev` rebuilds `main.js` on every save. Copy `main.js`, `manifest.json` and
`styles.css` into `.obsidian/plugins/local-fonts/` in a vault you do not mind breaking,
or symlink them there so a rebuild lands straight away. `tests/vaults/minimal` already
carries a small font collection and settings to point at.

## Before you open a pull request

```
pnpm verify
```

That runs formatting, lint, types, architecture rules, dead code and the unit tests with
coverage. CI runs the same command, so a green local run means a green pull request.

`pnpm test:e2e` drives a real Obsidian on desktop and takes a few minutes. Worth running
when you touch anything that loads or applies fonts. It downloads Obsidian on first use.

Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org),
so `fix: ...`, `feat: ...` or `docs: ...`. A check enforces it.

New behaviour wants a test. Coverage thresholds are enforced per file, so an untested
branch fails the build rather than slipping through.

## Worth knowing

`AGENTS.md` lists the invariants that no single file makes obvious, such as why the
cache must stay platform-neutral and why `vault.adapter` is the only file API used here.
Reading it first will save you a review round.

Anything touching a network request needs discussion first. This plugin is offline by
design.
