# Obsidian community plugin

Reference template for an Obsidian Community Plugin (TypeScript → `main.js` via esbuild). Read `src/main.ts`/`src/settings.ts` for the real code pattern, and run `pnpm run <script>` to see what's available — this file only covers what isn't already enforced by config/tooling or discoverable that way.

## Manual UI verification

Obsidian ships a CLI for driving a _running_ Obsidian instance from the terminal — use it instead of guessing whether a UI change works: `obsidian devtools` (toggle DevTools), `obsidian plugin:reload id=<plugin-id>` (hot-reload after a build), `obsidian dev:dom selector=<css>` (query the live DOM), `obsidian dev:screenshot path=out.png`, `obsidian dev:console` / `dev:errors` (captured console/errors), `obsidian eval code="..."` (run JS in-app). Requires Obsidian 1.12+ with **Settings → General → Command line interface** enabled, and the app running. Docs: https://obsidian.md/help/cli#Developer+commands

## Constraints nothing else catches

- `id` in `manifest.json` is permanent once released — never rename it.
- Releasing means bumping `version` in **both** `manifest.json` and `versions.json`; the release tag must match `manifest.json`'s version exactly (no leading `v`).
- Any network call or external service needs explicit opt-in and disclosure (README + settings) — default is local/offline. Never fetch-and-eval remote code or self-update outside normal releases.
- Use `this.register*` (`registerEvent`, `registerDomEvent`, `registerInterval`) for anything that needs cleanup — nothing lints for a raw `addEventListener`/`setInterval` leaking past unload.

## References

- Obsidian sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- API docs: https://docs.obsidian.md · Developer policies: https://docs.obsidian.md/Developer+policies · Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Manifest validation rules: https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml
