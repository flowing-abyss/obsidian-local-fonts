---
name: observability-and-instrumentation
description: Makes plugin failures visible to the user and diagnosable from a bug report, without telemetry. Use when adding any file I/O, network call, or parsing step that can fail. Use when a user reports "it doesn't work" with no other detail.
---

# Observability and Instrumentation (Obsidian plugin edition)

## Why this looks different from the usual version of this skill

There's no server, no on-call, no metrics backend, no dashboards — a plugin runs on someone else's machine and the only diagnostic channel is whatever the user chooses to paste into a GitHub issue. AGENTS.md already rules out the usual fallback (phone-home telemetry: no hidden analytics, no undisclosed network calls). So "observability" here means exactly two things: **the user sees that something went wrong and why**, and **a developer reading a bug report has enough to reproduce it** — both from information already on the user's own screen.

## When to use

- Any `app.vault`/`app.fileManager` read, write, or path resolution that can fail (missing file, permission error, malformed frontmatter)
- Any `fetch`/network call (already requires disclosure per AGENTS.md — pair that disclosure with visible failure handling)
- Any parsing of user-authored content (settings JSON, a config file the plugin reads from the vault)
- A silent `catch {}` or a promise rejection with no `.catch` — the classic "plugin just stops working" bug class

## Process

### 1. Every user-triggered failure gets a `Notice()`, not a silent catch

```typescript
// BAD — user sees nothing, has no idea the folder was misconfigured
try {
  await loadFontsFrom(folder);
} catch {}

// GOOD — actionable, names the thing that broke
try {
  await loadFontsFrom(folder);
} catch (error) {
  new Notice(`Could not load fonts from "${folder}": ${error instanceof Error ? error.message : String(error)}`);
}
```

A `Notice()` is the plugin's entire "alerting" system. Word it like an on-call runbook line: name what was being attempted and what specifically failed — not just "An error occurred."

### 2. `console.error`/`console.warn` for the part a Notice can't hold

Obsidian's own guidelines only allow `warn`/`error`/`debug` console methods (already enforced by `eslint-plugin-obsidianmd`'s `no-console` override). Use them for the detail a toast is too small for — stack traces, the full failing object — since that's what ends up in a screenshot of DevTools attached to a bug report:

```typescript
console.error('[your-plugin-id] Failed to parse font manifest', { path, cause: error });
```

Prefix with the plugin id so it's greppable in a console full of every other plugin's output.

### 3. A debug-mode setting, not always-on verbose logging

If a feature needs step-by-step tracing to debug, gate it behind a settings toggle (`this.settings.debugLoggingEnabled`) rather than always emitting it — matches the "minimize noise" spirit of Obsidian's console-usage guideline, and gives users a switch to flip when a maintainer asks "can you enable debug logging and reproduce?"

### 4. Make errors reproducible, not just visible

When catching an error you can't fully handle, include what a maintainer needs to reproduce it: the input that failed (file path, setting value), not just the exception message. This is the entire substitute for a trace/correlation ID — there's no distributed system to correlate across, just one bug report to make useful.

## Explicitly not applicable here

Metrics, dashboards, distributed tracing, alerting/paging, SLOs, cardinality — all assume a backend collecting data from many instances of a running service. A plugin has neither the backend nor (per this template's own privacy stance) permission to phone one. Don't reach for OpenTelemetry/Prometheus/etc. for an Obsidian plugin; if a future feature genuinely needs opt-in usage analytics, that's a `source-driven-development`-grounded, explicitly-disclosed decision on its own, not something this skill covers.

## Red Flags

- A `catch {}` with nothing inside it
- A promise with no `.catch` in a place Vitest's unhandled-rejection reporting won't cover (see `test-driven-development` — but don't rely on tests catching every runtime path a real user hits)
- An error message that's just the raw exception (`String(error)`) with no context about what the plugin was trying to do
- Reaching for a network call, analytics SDK, or crash reporter to "get visibility" — that's the thing AGENTS.md already says not to do without disclosure

## Verification

- [ ] Every `await` that touches the vault, filesystem, or network has a `catch` that shows the user a `Notice()`, not a silent failure
- [ ] Notice text names what was attempted and what failed, not just "An error occurred"
- [ ] Anything logged to console goes through `warn`/`error`/`debug` (not `log`), prefixed with the plugin id
- [ ] No new telemetry, analytics, or crash-reporting network call was added without the disclosure AGENTS.md requires
