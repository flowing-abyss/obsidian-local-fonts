import type { RoleAssignments } from '../settings.js';
import type { FaceRecord, FontFormat } from './types.js';

/**
 * Emoji blocks, plus the variation selector and keycap combiner. Restricting the emoji
 * family to these ranges is what lets it sit FIRST in the stack: first position is
 * required, because on macOS, Windows and iOS the system emoji font otherwise wins and
 * the vault font never renders. Without the range it would also steal Latin digits.
 *
 * The range deliberately covers the text-default emoji in U+203C-3299 (arrows, geometric
 * shapes, U+2139 INFORMATION SOURCE and so on) even though those are also ordinary text
 * characters. Unicode distinguishes the two uses by a trailing U+FE0F variation selector,
 * and CSS `unicode-range` cannot express "only when followed by FE0F" — so one behaviour
 * has to win for both. Emoji presentation wins, because assigning an emoji font is an
 * explicit request to draw emoji with it, and measured against a real vault the emoji
 * spelling outnumbered the bare text spelling of these characters by more than five to
 * one. Narrowing the range instead traded 12 correctly-rendered text characters for 66
 * broken emoji.
 *
 * U+2122 TRADE MARK SIGN is the one carve-out. In prose it is a trademark symbol
 * essentially always, its emoji spelling is vanishingly rare, and rendering it from a
 * colour emoji font in running text is plainly wrong.
 *
 * U+200D ZERO WIDTH JOINER must be listed too, even though it draws nothing on its own.
 * ZWJ is what fuses a run of base emoji into one glyph (families, professions, some
 * flags). If it falls outside this font's declared range, the browser treats it as a
 * character this font doesn't cover, splits the text run there, and shapes the pieces
 * on either side separately — the ZWJ sequence renders as N unjoined emoji instead of
 * one ligature, even though the font's own GSUB tables have the ligature.
 *
 * Measured with two @font-face declarations over the same file differing only in this
 * one range entry, at 64px: every sequence tried came out one glyph wide with U+200D
 * listed and two or three glyphs wide without it — family, couple-with-heart, rainbow
 * flag, pirate flag, red hair, firefighter, eye-in-speech-bubble.
 *
 * ZWJ also drives ligature and half-form selection in Devanagari, Bengali, Tamil,
 * Sinhala and the Perso-Arabic scripts, so claiming it for the emoji font could in
 * principle have split those runs instead. It does not: the same measurement over
 * conjuncts in all five scripts gave identical widths either way. The browser resolves
 * the emoji font for U+200D only where the surrounding run is already emoji.
 */
export const EMOJI_UNICODE_RANGE = [
  'U+203C-2121',
  'U+2123-3299',
  'U+FE0F',
  'U+200D',
  'U+20E3',
  'U+1F000-1F9FF',
  'U+1FA70-1FAFF',
  'U+2600-27BF',
  'U+2B00-2BFF',
].join(', ');

const CSS_FORMAT: Record<FontFormat, string> = {
  woff2: 'woff2',
  woff: 'woff',
  otf: 'opentype',
  ttf: 'truetype',
};

/**
 * Escape a family name for use inside a single-quoted CSS string. Exported so the
 * settings tab can quote a family the same way when setting a preview element's
 * `font-family` inline (family names are arbitrary text read out of a font binary,
 * not something that can be hardcoded in styles.css).
 */
export function quote(family: string): string {
  return `'${family.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** The closed interval CSS allows a `font-weight` value in. */
const CSS_WEIGHT_MIN = 1;
const CSS_WEIGHT_MAX = 1000;

/**
 * fvar stores axis bounds as 16.16 fixed point, so a value the designer entered as 100
 * can come back as 99.99998474121094. Three decimals is finer than any weight axis is
 * ever authored to and keeps the emitted CSS readable.
 */
function tidy(value: number): number {
  return Number(value.toFixed(3));
}

/**
 * The `font-weight` descriptor for one face: a range when the file carries a `wght`
 * variation axis, the single parsed weight otherwise.
 *
 * This is what makes a variable font actually variable. With a single value declared,
 * the browser has exactly one instance to match against and answers every other weight
 * by synthesising one — smeared outlines instead of the real design. Measured in
 * Obsidian's own renderer over New York (wght 400-1000), the width of a 100px line was
 * identical at 400, 700 and 1000 with a single value declared, and 660/735/810 px with
 * the range declared.
 *
 * Bounds are clamped rather than trusted. An out-of-range value makes the whole
 * descriptor invalid, and an invalid `font-weight` descriptor is dropped and defaults to
 * `normal` — so one malformed fvar would cost the face even the weight its OS/2 table
 * states. A range that is inverted, non-finite or empty after clamping falls back to
 * that stated weight, which is always a valid value.
 *
 * Only `wght` is read. `wdth` and `slnt` are deliberately left alone: nothing in
 * Obsidian requests a condensed or oblique variant, so declaring those ranges would add
 * descriptors that never change a rendering while widening what face matching has to
 * resolve.
 */
function weightDescriptor(face: FaceRecord): string {
  // First match wins. An fvar table is not supposed to carry a tag twice, and a file
  // that does is already telling us its axis records cannot all be trusted; taking the
  // first is at least the one a shaping engine reads as authoritative.
  const axis = face.axes.find((candidate) => candidate.tag === 'wght');
  if (axis === undefined || !Number.isFinite(axis.min) || !Number.isFinite(axis.max)) {
    return String(face.weight);
  }
  const min = tidy(Math.max(axis.min, CSS_WEIGHT_MIN));
  const max = tidy(Math.min(axis.max, CSS_WEIGHT_MAX));
  if (min > max) {
    return String(face.weight);
  }
  return min === max ? String(min) : `${String(min)} ${String(max)}`;
}

function fontFace(face: FaceRecord, url: string, isEmoji: boolean): string {
  const lines = [
    '@font-face {',
    `  font-family: ${quote(face.family)};`,
    `  font-style: ${face.italic ? 'italic' : 'normal'};`,
    `  font-weight: ${weightDescriptor(face)};`,
    '  font-display: swap;',
    `  src: url('${url}') format('${CSS_FORMAT[face.format]}');`,
  ];
  if (isEmoji) {
    lines.push(`  unicode-range: ${EMOJI_UNICODE_RANGE};`);
  }
  lines.push('}');
  return lines.join('\n');
}

/**
 * CSS-wide keywords are only valid as the *entire* value of a property, never as one
 * item in a comma-separated font-family list. `font-family: 'X', inherit` is invalid
 * CSS — the whole declaration is dropped at parse/computed-value time, silently
 * losing 'X' too. `stack()` must never append one of these as a trailing "fallback".
 */
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

/**
 * Emoji first (see EMOJI_UNICODE_RANGE), then the role family, then the theme's own
 * value. Skips the emoji entry when it is the same family as the role, so a family
 * assigned to both `emoji` and this role does not appear twice in the stack.
 *
 * `fallback` is omitted entirely when it is a CSS-wide keyword (e.g. "inherit" for
 * the headings role): an unresolvable family already falls through to whatever the
 * cascade provides, so no trailing generic is needed, and appending one as a list
 * item would make the whole value invalid (see CSS_WIDE_KEYWORDS).
 */
function stack(family: string, emoji: string | null, fallback: string): string {
  const parts =
    emoji !== null && emoji !== family ? [quote(emoji), quote(family)] : [quote(family)];
  return CSS_WIDE_KEYWORDS.has(fallback) ? parts.join(', ') : `${parts.join(', ')}, ${fallback}`;
}

/**
 * `html body`, not `body`, and the extra element selector is load-bearing.
 *
 * This CSS is delivered inside the plugin's own styles.css element (see main.ts), which
 * Obsidian appends to the head *before* the theme and before every user snippet —
 * measured in a real vault: plugin stylesheets sat at index 45, the theme at 46,
 * snippets at 47 and up. With equal specificity the later rule wins, so a plain
 * `body { --font-text-override: ... }` in a theme or a snippet would silently take these
 * roles over. The mechanism this replaced could not lose that way: a constructed sheet
 * in `adoptedStyleSheets` is ordered after every document stylesheet no matter what.
 *
 * Two element names (0-0-2) restore that, without `!important` — which would have gone
 * further than the old behaviour and started beating inline styles too. Element
 * selectors only, so this holds in pop-out windows, where the body's classes differ.
 *
 * `body` and not `:root`: Obsidian's own `--font-text: var(--font-text-override, ...)`
 * chain is declared on `body` in app.css, with the string `'??'` as the placeholder. A
 * value declared on an element beats one inherited from an ancestor whatever the
 * specificity, so writing these to `:root` would leave that placeholder in charge and
 * apply no font at all.
 *
 * What this deliberately still loses to: `!important`, any selector carrying a class or
 * an id (`body.theme-dark { ... }` outranks it), and inline styles — the tier Obsidian's
 * own Appearance settings write to, so a font picked there keeps winning, as before.
 */
const ROLE_SCOPE = 'html body';

const HEADING_VARIABLES = [
  '--h1-font',
  '--h2-font',
  '--h3-font',
  '--h4-font',
  '--h5-font',
  '--h6-font',
];

export interface BuildCssInput {
  /** Already narrowed to one file per (family, weight, style) by selectFaces. */
  faces: readonly FaceRecord[];
  roles: RoleAssignments;
  hardOverride: boolean;
  /** Turns a vault-relative path into a loadable URL — adapter.getResourcePath. */
  resolve: (path: string) => string;
}

/**
 * Push both variable tiers for one Obsidian font role, carrying the identical value.
 *
 * Both tiers must stay, for two independent reasons — do not "simplify" this to one:
 * - `-override` is the tier Obsidian's own Appearance settings write, and it is what
 *   wins inside Obsidian's own `--font-X: var(--font-X-override, var(--font-X-theme,
 *   ...))` fallback chain. Anyone who has ever picked a font in Appearance settings
 *   depends on this tier existing.
 * - `-theme` is the tier community themes are written against; some themes read
 *   `--font-X-theme` *directly*, bypassing Obsidian's own `--font-X` chain entirely
 *   (observed live: Base16 Default Dark's `.bases-view` rule does this). Obsidian's
 *   own default for that tier is the literal placeholder string `'??'` — a font
 *   family that does not exist — so a theme reading it directly gets no font at all,
 *   which drops every family in the stack including emoji. Writing `-theme` too is
 *   what makes those themes pick up our fonts instead of silently falling through.
 */
function pushTieredDeclaration(
  declarations: string[],
  role: 'text' | 'interface' | 'monospace',
  value: string,
): void {
  declarations.push(`  --font-${role}-override: ${value};`);
  declarations.push(`  --font-${role}-theme: ${value};`);
}

/** `--font-*-override`/`--font-*-theme` / `--h*-font` declarations for assigned roles. */
function buildDeclarations(roles: RoleAssignments): string[] {
  const emoji = roles.emoji;
  const declarations: string[] = [];

  if (roles.text !== null) {
    pushTieredDeclaration(declarations, 'text', stack(roles.text, emoji, 'sans-serif'));
  }
  if (roles.interface !== null) {
    pushTieredDeclaration(declarations, 'interface', stack(roles.interface, emoji, 'sans-serif'));
  }
  if (roles.monospace !== null) {
    pushTieredDeclaration(declarations, 'monospace', stack(roles.monospace, emoji, 'monospace'));
  }
  if (roles.headings !== null) {
    // No Obsidian-level heading variable tier exists to pair with `--h*-font`
    // (headings are not one of Obsidian's `--font-X-override`/`-theme` roles), so
    // there is nothing to write a second tier for here — leave this path alone.
    for (const variable of HEADING_VARIABLES) {
      declarations.push(`  ${variable}: ${stack(roles.headings, emoji, 'inherit')};`);
    }
  }

  return declarations;
}

/**
 * Build the whole stylesheet: one @font-face per selected file, then the forcing rules.
 *
 * Writes both the `*-override` and `*-theme` variable tiers for text, interface and
 * monospace — see `pushTieredDeclaration` for why neither tier can be dropped.
 */
export function buildCss(input: BuildCssInput): string {
  const { faces, roles, hardOverride, resolve } = input;
  const blocks: string[] = [];

  for (const face of faces) {
    blocks.push(fontFace(face, resolve(face.path), face.family === roles.emoji));
  }

  const declarations = buildDeclarations(roles);
  if (declarations.length > 0) {
    blocks.push(`${ROLE_SCOPE} {\n${declarations.join('\n')}\n}`);
  }

  if (hardOverride) {
    const hard = buildHardOverrides(roles);
    if (hard !== '') {
      blocks.push(hard);
    }
  }

  return blocks.join('\n\n');
}

/**
 * `!important` rules for themes that hardcode font-family.
 *
 * The container selectors below carry no icon exclusion: a compound `:not(.svg-icon)`
 * on the container itself (e.g. `body:not(.svg-icon)`) never excludes anything, because
 * `body` is never `.svg-icon` — it only blocks the rule from matching an icon element
 * directly, while the forced `font-family` still *inherits* into every descendant,
 * icons included, regardless of any `:not()` on the ancestor. The one thing that
 * actually protects icons is the explicit reset rule appended at the end: it runs last
 * in source order, so it wins the cascade against the rules above without needing
 * excess specificity, and `font-family: revert` hands inheritance back to whatever the
 * icon font's own rule (or the theme) declares.
 */
function buildHardOverrides(roles: RoleAssignments): string {
  const emoji = roles.emoji;
  const rules: string[] = [];

  if (roles.text !== null) {
    rules.push(
      `.markdown-preview-view,\n.markdown-source-view {\n  font-family: ${stack(roles.text, emoji, 'sans-serif')} !important;\n}`,
    );
  }
  if (roles.interface !== null) {
    rules.push(
      `${ROLE_SCOPE} {\n  font-family: ${stack(roles.interface, emoji, 'sans-serif')} !important;\n}`,
    );
  }
  if (roles.monospace !== null) {
    // Scoped to code itself, not `.cm-editor .cm-content` — that selector is the
    // *entire* editor content area, so with !important it forced every paragraph,
    // heading and list in Live Preview monospace. `code`/`pre` cover reading view;
    // `.cm-inline-code` and `.cm-line.HyperMD-codeblock` are Obsidian's own classes
    // for inline code and fenced code-block lines in Live Preview (verified against
    // app.css — see the code-review report for this fix).
    rules.push(
      `code,\npre,\n.cm-inline-code,\n.cm-line.HyperMD-codeblock {\n  font-family: ${stack(roles.monospace, emoji, 'monospace')} !important;\n}`,
    );
  }
  if (roles.headings !== null) {
    // `h1`..`h6` cover reading view only. Live Preview never renders headings as
    // heading elements — it marks the `.cm-line` div with `.HyperMD-header-1`
    // through `.HyperMD-header-6` instead, and the note's own title (which Obsidian
    // treats as a heading) is `.inline-title`. Verified against a running app's own
    // app.css, which pairs `h1, .markdown-rendered h1` with
    // `.HyperMD-header-1, .inline-title h1, .HyperMD-list-line .cm-header-1`.
    rules.push(
      `h1, h2, h3, h4, h5, h6,\n.HyperMD-header-1, .HyperMD-header-2, .HyperMD-header-3, .HyperMD-header-4, .HyperMD-header-5, .HyperMD-header-6,\n.inline-title {\n  font-family: ${stack(roles.headings, emoji, 'inherit')} !important;\n}`,
    );
  }
  if (rules.length > 0) {
    rules.push('.svg-icon, .svg-icon * {\n  font-family: revert !important;\n}');
  }
  return rules.join('\n\n');
}
