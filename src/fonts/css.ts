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

/** Escape a family name for use inside a single-quoted CSS string. */
function quote(family: string): string {
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
 * Emoji first (see EMOJI_UNICODE_RANGE), then the role family, then the theme's own
 * value. Skips the emoji entry when it is the same family as the role, so a family
 * assigned to both `emoji` and this role does not appear twice in the stack.
 */
function stack(family: string, emoji: string | null, fallback: string): string {
  const parts =
    emoji !== null && emoji !== family ? [quote(emoji), quote(family)] : [quote(family)];
  return `${parts.join(', ')}, ${fallback}`;
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

/** `--font-*-override` / `--h*-font` declarations for the roles that are assigned. */
function buildDeclarations(roles: RoleAssignments): string[] {
  const emoji = roles.emoji;
  const declarations: string[] = [];

  if (roles.text !== null) {
    declarations.push(`  --font-text-override: ${stack(roles.text, emoji, 'sans-serif')};`);
  }
  if (roles.interface !== null) {
    declarations.push(
      `  --font-interface-override: ${stack(roles.interface, emoji, 'sans-serif')};`,
    );
  }
  if (roles.monospace !== null) {
    declarations.push(
      `  --font-monospace-override: ${stack(roles.monospace, emoji, 'monospace')};`,
    );
  }
  if (roles.headings !== null) {
    for (const variable of HEADING_VARIABLES) {
      declarations.push(`  ${variable}: ${stack(roles.headings, emoji, 'inherit')};`);
    }
  }

  return declarations;
}

/**
 * Build the whole stylesheet: one @font-face per selected file, then the forcing rules.
 *
 * Writes the `*-override` variable tier because that is the tier Obsidian's Appearance
 * settings use; writing `*-theme` would lose silently for anyone who has ever picked a
 * font there.
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
    rules.push(
      `.cm-editor .cm-content,\ncode,\npre {\n  font-family: ${stack(roles.monospace, emoji, 'monospace')} !important;\n}`,
    );
  }
  if (roles.headings !== null) {
    rules.push(
      `h1, h2, h3, h4, h5, h6 {\n  font-family: ${stack(roles.headings, emoji, 'inherit')} !important;\n}`,
    );
  }
  if (rules.length > 0) {
    rules.push('.svg-icon, .svg-icon * {\n  font-family: revert !important;\n}');
  }
  return rules.join('\n\n');
}
