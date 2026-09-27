import { expect, it, vi } from 'vitest';
import { findFontSurfaces } from './surfaces.js';

it('finds one visible leaf per role category and excludes source headings from text', () => {
  document.body.empty();
  const preview = document.body.createDiv({ cls: 'markdown-preview-view' });
  preview.createEl('p', { text: 'Body' });
  preview.createEl('p', { text: 'Second' });
  preview.createEl('h1', { text: 'Title' });
  preview.createEl('code', { text: 'Code' });
  const source = document.body.createDiv({ cls: 'markdown-source-view' });
  source.createDiv({ cls: 'cm-line HyperMD-frontmatter', text: 'YAML' });
  source.createDiv({ cls: 'cm-line HyperMD-header-2', text: 'Heading' });
  source.createDiv({ cls: 'cm-line HyperMD-codeblock', text: 'Fenced code' });
  source.createDiv({ cls: 'cm-line' });
  source.createDiv({ cls: 'cm-line', text: 'Live' });
  source.createSpan({ cls: 'cm-inline-code', text: 'Inline' });
  document.body.createDiv({ cls: 'setting-item-name', text: 'Setting' });
  document.body
    .createDiv({ cls: 'local-fonts-check-results' })
    .createEl('p', { cls: 'setting-item-name', text: 'Diagnostic' });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.isConnected ? ({ length: 1 } as DOMRectList) : ({ length: 0 } as DOMRectList);
  });
  const surfaces = findFontSurfaces(document);
  expect(surfaces.filter((surface) => surface.name === 'Reading text')).toHaveLength(1);
  expect(surfaces.find((surface) => surface.name === 'Live editor text')?.element.textContent).toBe(
    'Live',
  );
  expect(
    surfaces.some(
      (surface) => surface.role === 'headings' && surface.element.textContent === 'Heading',
    ),
  ).toBe(true);
  expect(surfaces.some((surface) => surface.element.textContent === 'Diagnostic')).toBe(false);
  expect(
    surfaces.some(
      (surface) => surface.role === 'monospace' && surface.element.textContent === 'Inline',
    ),
  ).toBe(true);
});

it('rejects detached and hidden targets', () => {
  document.body.empty();
  const preview = document.body.createDiv({ cls: 'markdown-preview-view' });
  preview.createEl('p', { text: 'Hidden', attr: { hidden: '' } });
  preview.createEl('p', { text: 'Visible' });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
  expect(
    findFontSurfaces(document).find((surface) => surface.name === 'Reading text')?.element
      .textContent,
  ).toBe('Visible');
});
