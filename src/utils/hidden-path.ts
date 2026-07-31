/**
 * Whether a vault-relative path lies inside a hidden folder, at any depth.
 *
 * Obsidian Sync excludes every folder whose name starts with a dot, with `.obsidian`
 * as its only exception, and that exclusion applies to a dot anywhere in the path:
 * `assets/.fonts` is skipped just as surely as `.fonts`. Checking only the first
 * character of the whole path — the obvious `folder.startsWith('.')` — misses every
 * nested case, which is the shape a font collection tucked away in an existing
 * attachments folder most naturally takes.
 *
 * `.` and `..` are not hidden names: they are relative-path segments, and a folder
 * typed as `./fonts` is the same visible folder as `fonts`.
 */
export function isHiddenPath(path: string): boolean {
  return path
    .split('/')
    .some((segment) => segment.startsWith('.') && segment !== '.' && segment !== '..');
}
