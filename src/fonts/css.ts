import type { RoleAssignments } from '../settings.js';
import { quote } from './family.js';
import { buildRoleCss } from './roles.js';
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

function fontFace(face: FaceRecord, url: string, family: string, restricted: boolean): string {
  const lines = [
    '@font-face {',
    `  font-family: ${quote(family)};`,
    `  font-style: ${face.italic ? 'italic' : 'normal'};`,
    `  font-weight: ${weightDescriptor(face)};`,
    '  font-display: swap;',
    `  src: url('${url}') format('${CSS_FORMAT[face.format]}');`,
  ];
  if (restricted) {
    lines.push(`  unicode-range: ${EMOJI_UNICODE_RANGE};`);
  }
  lines.push('}');
  return lines.join('\n');
}

export interface BuildCssInput {
  /** Already narrowed to one file per (family, weight, style) by selectFaces. */
  faces: readonly FaceRecord[];
  roles: RoleAssignments;
  hardOverride: boolean;
  /** Turns a vault-relative path into a loadable URL — adapter.getResourcePath. */
  resolve: (path: string) => string;
}

/** A private name that cannot shadow an ordinary registered family. */
export function resolveEmojiAlias(
  faces: readonly FaceRecord[],
  family: string | null,
): string | null {
  if (family === null || !faces.some((face) => face.family === family)) return null;
  const names = new Set(faces.map((face) => face.family.toLowerCase()));
  const base = '__local-fonts-emoji__';
  let alias = base;
  let suffix = 1;
  while (names.has(alias.toLowerCase())) {
    alias = `${base}${suffix}`;
    suffix++;
  }
  return alias;
}

/** Ordinary registrations remain unrestricted, even when also assigned to Emoji. */
export function buildCss(input: BuildCssInput): string {
  const { faces, roles, hardOverride, resolve } = input;
  const alias = resolveEmojiAlias(faces, roles.emoji);
  const urls = new Map<string, string>();
  const sourceUrl = (path: string): string => {
    const cached = urls.get(path);
    if (cached !== undefined) return cached;
    const url = resolve(path);
    urls.set(path, url);
    return url;
  };
  const blocks = faces.map((face) => fontFace(face, sourceUrl(face.path), face.family, false));
  if (alias !== null) {
    for (const face of faces.filter((face) => face.family === roles.emoji))
      blocks.push(fontFace(face, sourceUrl(face.path), alias, true));
  }
  const roleCss = buildRoleCss({ roles, hardOverride, emojiAlias: alias });
  if (roleCss !== '') blocks.push(roleCss);
  return blocks.join('\n\n');
}
