import type { RoleAssignments } from '../settings.js';
import { quote } from './family.js';

/**
 * CSS-wide keywords are only valid as the *entire* value of a property, never as one
 * item in a comma-separated font-family list. `font-family: 'X', inherit` is invalid
 * CSS — the whole declaration is dropped at parse/computed-value time, silently
 * losing 'X' too. `stack()` must never append one of these as a trailing "fallback".
 */
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

/**
 * Ordinary role tiers omit Emoji; hard rules prepend the separately registered alias.
 * CSS-wide keywords cannot be list items, so inherited headings have no trailing fallback.
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
  const declarations: string[] = [];

  if (roles.text !== null) {
    pushTieredDeclaration(declarations, 'text', stack(roles.text, null, 'sans-serif'));
  }
  if (roles.interface !== null) {
    pushTieredDeclaration(declarations, 'interface', stack(roles.interface, null, 'sans-serif'));
  }
  if (roles.monospace !== null) {
    pushTieredDeclaration(declarations, 'monospace', stack(roles.monospace, null, 'monospace'));
  }
  if (roles.headings !== null) {
    // No Obsidian-level heading variable tier exists to pair with `--h*-font`
    // (headings are not one of Obsidian's `--font-X-override`/`-theme` roles), so
    // there is nothing to write a second tier for here — leave this path alone.
    for (const variable of HEADING_VARIABLES) {
      declarations.push(`  ${variable}: ${stack(roles.headings, null, 'inherit')};`);
    }
  }

  return declarations;
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
function buildHardOverrides(roles: RoleAssignments, emoji: string | null): string {
  const rules: string[] = [];

  if (roles.text !== null) {
    rules.push(
      `.markdown-preview-view,\n.markdown-source-view {\n  font-family: ${stack(roles.text, emoji, 'sans-serif')} !important;\n}`,
    );
  }
  if (roles.interface !== null) {
    rules.push(
      `${ROLE_SCOPE},\n${ROLE_SCOPE} > * {\n  font-family: ${stack(roles.interface, emoji, 'sans-serif')} !important;\n}`,
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

const nativeProperties = [
  ...['text', 'interface', 'monospace'].flatMap((role) => [
    `--font-${role}`,
    `--font-${role}-override`,
    `--font-${role}-theme`,
  ]),
  ...[1, 2, 3, 4, 5, 6].map((level) => `--h${level}-font`),
  '--inline-title-font',
  '--table-header-font',
  '--file-header-font',
  '--metadata-label-font',
  '--metadata-input-font',
];
const baselineProperty = (property: string): string => `--local-fonts-base-${property.slice(2)}`;

export interface RoleCssInput {
  roles: RoleAssignments;
  hardOverride: boolean;
  emojiAlias: string | null;
}

/** Capture computed native tiers on the ancestor before composing them on its children.
 * No var fallback: invalid/inherited heading and derivative values must remain invalid.
 */
export function buildRoleCss({ roles, hardOverride, emojiAlias }: RoleCssInput): string {
  const declarations = buildDeclarations(roles);
  if (emojiAlias !== null) {
    for (const property of nativeProperties)
      declarations.push(`  ${baselineProperty(property)}: var(${property});`);
  }
  const blocks: string[] = [];
  if (declarations.length > 0) blocks.push(`${ROLE_SCOPE} {\n${declarations.join('\n')}\n}`);
  if (emojiAlias !== null) {
    const composed = nativeProperties.map(
      (property) => `  ${property}: ${quote(emojiAlias)}, var(${baselineProperty(property)});`,
    );
    composed.push('  font-family: var(--font-interface);');
    blocks.push(`${ROLE_SCOPE} > * {\n${composed.join('\n')}\n}`);
  }
  if (hardOverride) {
    const hard = buildHardOverrides(roles, emojiAlias);
    if (hard !== '') blocks.push(hard);
  }
  return blocks.join('\n\n');
}
