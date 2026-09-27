import type { RoleName } from '../settings.js';

export interface FontSurface {
  role: Exclude<RoleName, 'emoji'>;
  name: string;
  element: HTMLElement;
}

const TARGETS: ReadonlyArray<readonly [FontSurface['role'], string, string]> = [
  ['text', 'Reading text', '.markdown-preview-view p'],
  ['text', 'Live editor text', '.markdown-source-view .cm-line:not([class*="HyperMD-"])'],
  ['interface', 'Suggestion', '.suggestion-item'],
  ['interface', 'Settings label', '.setting-item-name'],
  ['interface', 'File title', '.nav-file-title-content'],
  ['interface', 'View title', '.view-header-title'],
  ['interface', 'Metadata key', '.metadata-property-key'],
  ['monospace', 'Reading code', '.markdown-preview-view code'],
  ['monospace', 'Inline code', '.markdown-source-view .cm-inline-code'],
  ['monospace', 'Code block', '.markdown-source-view .HyperMD-codeblock'],
  ...[1, 2, 3, 4, 5, 6].flatMap((level): Array<readonly [FontSurface['role'], string, string]> => [
    [
      'headings',
      `Heading ${String(level)}`,
      `.markdown-preview-view h${String(level)}, .markdown-source-view .HyperMD-header-${String(level)}, .markdown-source-view .HyperMD-list-line .cm-header-${String(level)}`,
    ],
  ]),
  ['headings', 'Editor heading', '.markdown-source-view .HyperMD-header'],
  ['headings', 'Inline title', '.inline-title'],
];

function visible(element: HTMLElement, doc: Document): boolean {
  if (!element.isConnected || element.closest('.local-fonts-check-results') !== null) return false;
  if (element.textContent.trim() === '') return false;
  if (element.closest('[hidden], [aria-hidden="true"]') !== null) return false;
  if (element.getClientRects().length === 0) return false;
  const style = doc.defaultView?.getComputedStyle(element);
  return style?.display !== 'none' && style?.visibility !== 'hidden';
}

/** One visible representative for each named standard Obsidian text surface. */
export function findFontSurfaces(doc: Document): FontSurface[] {
  const surfaces: FontSurface[] = [];
  const seen = new Set<HTMLElement>();
  for (const [role, name, selector] of TARGETS) {
    const element = Array.from(doc.querySelectorAll<HTMLElement>(selector)).find(
      (candidate) => !seen.has(candidate) && visible(candidate, doc),
    );
    if (element === undefined) continue;
    seen.add(element);
    surfaces.push({ role, name, element });
  }
  return surfaces;
}
