import type { RoleAssignments } from '../settings.js';
import type { FaceRecord, FontFormat } from './types.js';

/**
 * Emoji blocks, plus the variation selector and keycap combiner. Restricting the emoji
 * family to these ranges is what lets it sit FIRST in the stack: first position is
 * required, because on macOS, Windows and iOS the system emoji font otherwise wins and
 * the vault font never renders. Without the range it would also steal Latin digits.
 */
export const EMOJI_UNICODE_RANGE =
  'U+203C-3299, U+FE0F, U+20E3, U+1F000-1F9FF, U+1FA70-1FAFF, U+2600-27BF, U+2B00-2BFF';

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

function fontFace(face: FaceRecord, url: string, isEmoji: boolean): string {
  const lines = [
    '@font-face {',
    `  font-family: ${quote(face.family)};`,
    `  font-style: ${face.italic ? 'italic' : 'normal'};`,
    `  font-weight: ${String(face.weight)};`,
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
    blocks.push(`body {\n${declarations.join('\n')}\n}`);
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
      `body {\n  font-family: ${stack(roles.interface, emoji, 'sans-serif')} !important;\n}`,
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
