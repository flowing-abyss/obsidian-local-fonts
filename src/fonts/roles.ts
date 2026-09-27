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

const HARD_TEXT = ['.markdown-preview-view', '.markdown-source-view'];
const HARD_INTERFACE = [
  ROLE_SCOPE,
  `${ROLE_SCOPE} > *`,
  '.workspace-ribbon',
  '.workspace-tab-header',
  '.view-header',
  '.nav-files-container',
  '.modal',
  '.suggestion-container',
  '.suggestion-item',
  '.setting-item-name',
  '.setting-item-description',
];
const HARD_MONOSPACE = ['code', 'pre', '.cm-inline-code', '.cm-line.HyperMD-codeblock'];
const HARD_HEADINGS = [
  ...[1, 2, 3, 4, 5, 6].flatMap((level) => [
    `.markdown-preview-view h${level}`,
    `.markdown-source-view .HyperMD-header-${level}`,
    `.markdown-source-view .HyperMD-list-line .cm-header-${level}:not(.cm-inline-code)`,
  ]),
  '.workspace-leaf-content[data-type="markdown"] .inline-title',
];

/** `!important` rules only at boundaries owned by assigned roles. */
function buildHardOverrides(roles: RoleAssignments, emoji: string | null): string {
  const rules: string[] = [];

  if (roles.text !== null) {
    rules.push(
      `${HARD_TEXT.join(',\n')} {\n  font-family: ${stack(roles.text, emoji, 'sans-serif')} !important;\n}`,
    );
  }
  if (roles.interface !== null) {
    rules.push(
      `${HARD_INTERFACE.join(',\n')} {\n  font-family: ${stack(roles.interface, emoji, 'sans-serif')} !important;\n}`,
    );
  }
  if (roles.monospace !== null) {
    rules.push(
      `${HARD_MONOSPACE.join(',\n')} {\n  font-family: ${stack(roles.monospace, emoji, 'monospace')} !important;\n}`,
    );
  }
  if (roles.headings !== null) {
    rules.push(
      `${HARD_HEADINGS.join(',\n')} {\n  font-family: ${stack(roles.headings, emoji, 'inherit')} !important;\n}`,
    );
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
  if (roles.headings !== null) {
    // Obsidian 1.0.3 declares list-heading font-family after its equally specific
    // code rule. Correct the variable consumed by that native rule on code only;
    // do not outrank a theme's own code font-family or native Appearance tiers.
    // Custom properties resolve on the consuming element (CSS Variables §3):
    // https://www.w3.org/TR/css-variables-1/#using-variables
    blocks.push(
      `.markdown-source-view .HyperMD-list-line .cm-inline-code {\n${HEADING_VARIABLES.map(
        (property) => `  ${property}: var(--font-monospace);`,
      ).join('\n')}\n}`,
    );
  }
  if (hardOverride) {
    const hard = buildHardOverrides(roles, emojiAlias);
    if (hard !== '') blocks.push(hard);
  }
  return blocks.join('\n\n');
}
