# Local Fonts

Load font files from a folder in your vault and apply them to text, interface,
monospace, headings and emoji — on desktop and mobile, with no network access.

## What it does

Point the plugin at a folder (`.fonts` by default) and it reads every `.ttf`,
`.otf`, `.woff` and `.woff2` file inside, recursively. It does not guess a
font's identity from its filename first — it reads the font binary itself:
real family name, weight, style, script coverage, colour-glyph format,
variable axes, licence. Only if that fails does it fall back, level by level,
down to a filename guess as a last resort. The settings tab shows which level
supplied each face's data, so a guessed value never gets confused for a
parsed one.

Fonts are served by resource URL, never embedded as base64, so the browser
only fetches the faces a note actually uses instead of loading every weight
up front.

Scanning never happens on startup. `onload` reads the last scan from
`data.json` and applies it immediately; the folder is only re-walked once
the workspace layout is ready, and only if something in it changed size or
modification time since the last scan.

## Adding fonts

Drop font files into the fonts folder. **In normal use, filenames don't
matter** — every face's family, weight, style and the rest are read straight
out of the font binary, and the plugin groups faces by that parsed family
name, not by folder structure (a subfolder per family is a reasonable
convention, but nothing requires it).

Names only come into play as a fallback, in two specific cases: if a
`.woff2`/`.woff` file's metadata can't be decoded, the plugin looks for a
sibling file with the **same filename stem** (e.g. `foo.woff2` and `foo.ttf`)
and reads that instead; and if nothing at all can be parsed, it falls back to
guessing family/weight/style from the filename itself. Practically, this
means a `.woff2` and `.ttf` of the same face should share a stem — mismatched
names silently lose the sibling fallback, and you get a filename guess or a
missing face instead. The diagnostics card names exactly which level
supplied each face's data, so a guess never gets mistaken for something
parsed.

The folder can be hidden (dot-prefixed, `.fonts` by default) so a font
collection doesn't clutter your note tree — Obsidian's own vault index can't
see into dot-folders, which is exactly why the plugin reads the filesystem
directly instead.

**Shipping the same face in more than one format is an encouraged workflow,
not an edge case.** If a family's regular weight exists as both `.woff2` and
`.ttf`, keep both — the plugin picks one per platform automatically, in this
order:

1. **Can this engine actually render it?** A colour-emoji face in a format
   the engine doesn't support is skipped outright, even if it's smaller or
   newer.
2. **Format preference** among the renderable candidates: woff2 > woff > otf
   > ttf.
3. **Smaller file**, if formats tie.
4. **A deterministic tie-break** on file path (shorter path wins, then
   lexicographic order), so the same vault always produces byte-identical
   CSS.

## Settings

Seven controls, all under **Settings → Local Fonts**:

- **Fonts folder** — vault-relative path; may be hidden.
- **Text**, **Interface**, **Monospace**, **Headings** — each a dropdown of
  every family found, or "Leave the theme alone."
- **Emoji** — same dropdown, but this family is always placed first in every
  role's font stack and restricted to emoji code points, so it can't steal
  Latin digits or punctuation from the family you actually picked for that
  role.
- **Hard override** — a toggle for themes that hardcode `font-family` instead
  of using Obsidian's CSS variables. It forces the chosen fonts on with
  `!important`, with an explicit exception for icon elements so glyph fonts
  aren't affected.

## Diagnostics

Below the settings, one collapsible card per family found in the folder,
listing:

- the weights present (and which common ones are missing, e.g. "300, 700; no
  400"),
- the scripts it covers,
- one line per face: its weight/style, format, file size, colour format and
  whether _this_ engine can draw it, its variable axes if any, whether
  `selectFaces` chose it and why (preferred format, smaller file, or
  tie-break), and which metadata level supplied its data.

A **Check** button measures whether each role's assigned family actually
rendered, by inspecting the live DOM — the definitive way to know whether a
role is working on the device you're on right now, rather than trusting that
the CSS was generated correctly.

## Emoji fonts need both builds

Colour emoji fonts don't ship in one universal format, and the two engines
Obsidian runs on disagree about which they draw:

- **Chromium** (Obsidian on desktop, and on Android) draws **COLRv1** but has
  never shipped OT-SVG.
- **WebKit** (Obsidian on iOS) draws **OT-SVG**, and treats COLRv1 as
  supported too.

A single emoji font file often can't satisfy both. The fix is to put more
than one build of the same emoji family in the folder — the plugin picks the
right one per device automatically, and the family's diagnostics card
reports which one it chose and why.

Concretely: Google's **Noto Color Emoji** ships as a COLRv1 `.woff2` (for
Chromium), a separate OT-SVG build (for WebKit/iOS), and also as a single
~25 MB `.ttf` that carries both formats in one file. Any of these
combinations works — put the ones you need in the folder and let the plugin
sort it out per platform.

## No network access

The plugin makes no network requests of any kind. It reads only the folder
you point it at, in your own vault.

## Limitations

- The desktop end-to-end suite is verified against Obsidian 1.0.3 (the
  minimum supported version) and the latest stable release at the time of
  testing. **Android has not been verified by an automated run**, and no
  automation exists for iOS at all. If you're on either platform, use the
  **Check** button after setting things up — it's there precisely so you can
  confirm a font actually rendered on your own device rather than take it on
  faith.
- Whether emoji render on iOS depends entirely on which colour formats the
  font files in your folder carry. If they don't render there, the
  diagnostics card names what's missing from the format list.

## Installation

Not yet listed in Obsidian's community plugin browser. Until then, install
manually:

1. Download `main.js`, `manifest.json` and `styles.css` (if present) from the
   [latest release](https://github.com/flowing-abyss/obsidian-local-fonts/releases).
2. Create a folder named `local-fonts` inside your vault's
   `.obsidian/plugins/` directory and put those files in it.
3. Reload Obsidian and enable **Local Fonts** under Settings → Community
   plugins.

Or use the [Obsidian42 - BRAT](https://github.com/TfTHacker/obsidian42-brat)
plugin to track and update it from this repository directly.

## License

[MIT](LICENSE)
