# Local Fonts — Obsidian community plugin

Loads font files from a folder inside the vault (`fonts` by default, may be hidden) and applies them to text, interface, monospace, headings and emoji, on desktop and mobile. TypeScript → `main.js` via esbuild. Run `pnpm run <script>` to see what's available — this file only covers what isn't already enforced by config/tooling or discoverable from the code.

## Invariants that no single file makes obvious

- **The cache in `data.json` must stay platform-neutral.** It syncs across devices, so `scanner`/`metadata`/`catalog` store every face with its full colour-format set and choose nothing. All platform-dependent selection happens in `select.ts`/`css.ts` at CSS-generation time, on the device doing the rendering. A cached _choice_ silently corrupts other platforms — the worst bug shape this design has.
- **Never use `Vault`'s indexed file APIs** (`vault.getFiles()`, `getAbstractFileByPath`, `vault.read`). They cannot see dot-folders, and a hidden fonts folder is a hard requirement. Use `vault.adapter` only.
- **`onload()` performs no font I/O.** It reads the cache and injects one stylesheet; scanning is deferred to `onLayoutReady` and runs only when the folder actually changed.
- **The generated CSS goes into this plugin's own `<style>` element, appended to the text styles.css shipped with.** Obsidian fills every pop-out window by cloning the main document's `<style>` elements and mirroring later edits to their text, and its own settings dialog can be one of those windows (observed on desktop 1.12/macOS, where `app.setting` opened into a separate `Window` — it fires no `window-open` event and never appears in `floatingSplit`, so per-window injection driven by events would miss exactly it). Nothing else crosses that boundary: a constructed `CSSStyleSheet` cannot be adopted by a second document at all, and rules pushed through `insertRule` are not part of any element's text, so both leave every pop-out with the theme's fonts. `main.ts` finds the element by the `--local-fonts-sheet` marker rule and waits for it, because Obsidian appends it only after `onload` resolves.
- **Match the marker's value, never just its presence.** `all: unset` resets custom properties too, so in Chromium a rule using it answers `getPropertyValue` with something other than `''` for any custom property — a presence check picked Excalidraw's stylesheet in a real vault and appended this plugin's CSS there.
- **Chromium has never shipped OT-SVG; WebKit has.** That asymmetry is the whole reason per-platform face selection exists. The capability matrix lives in `src/fonts/platform.ts` — it is the one place to correct when a real device contradicts it.
- Fonts are served via `adapter.getResourcePath()`, never base64. That is the performance premise: the browser lazily fetches only the faces it uses.

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
