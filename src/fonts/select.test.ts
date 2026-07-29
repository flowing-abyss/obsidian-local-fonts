import { describe, expect, it } from 'vitest';
import { selectFaces } from './select.js';
import type { FaceRecord } from './types.js';

function face(overrides: Partial<FaceRecord>): FaceRecord {
  return {
    path: '.fonts/a-400.woff2',
    format: 'woff2',
    size: 1000,
    mtime: 1,
    family: 'A',
    weight: 400,
    italic: false,
    colorFormats: [],
    scripts: [],
    axes: [],
    license: null,
    source: 'name-table',
    ...overrides,
  };
}

describe('selectFaces', () => {
  it('prefers woff2 over ttf for the same face, because it is smaller', () => {
    const chosen = selectFaces(
      [face({ path: '.fonts/a.ttf', format: 'ttf', size: 100 }), face({ path: '.fonts/a.woff2' })],
      'chromium',
    );

    expect(chosen).toHaveLength(1);
    expect(chosen[0]?.path).toBe('.fonts/a.woff2');
  });

  it('rejects an SVG-only woff2 on Chromium and takes the ttf that also has COLRv1', () => {
    // This is the author's real emoji situation. A naive "prefer woff2" rule ships a
    // regression here: Chromium cannot draw OT-SVG, so the smaller file is unusable.
    const chosen = selectFaces(
      [
        face({
          path: '.fonts/emoji.woff2',
          format: 'woff2',
          size: 3_700_000,
          colorFormats: ['SVG'],
        }),
        face({
          path: '.fonts/emoji.ttf',
          format: 'ttf',
          size: 25_000_000,
          colorFormats: ['SVG', 'COLR1'],
        }),
      ],
      'chromium',
    );

    expect(chosen[0]?.path).toBe('.fonts/emoji.ttf');
  });

  it('takes the small SVG woff2 on WebKit, which can draw it', () => {
    const chosen = selectFaces(
      [
        face({
          path: '.fonts/emoji.woff2',
          format: 'woff2',
          size: 3_700_000,
          colorFormats: ['SVG'],
        }),
        face({
          path: '.fonts/emoji.ttf',
          format: 'ttf',
          size: 25_000_000,
          colorFormats: ['SVG', 'COLR1'],
        }),
      ],
      'webkit',
    );

    expect(chosen[0]?.path).toBe('.fonts/emoji.woff2');
  });

  it('keeps faces that differ in weight or style rather than collapsing them', () => {
    const chosen = selectFaces(
      [
        face({ path: '.fonts/a-400.woff2' }),
        face({ path: '.fonts/a-700.woff2', weight: 700 }),
        face({ path: '.fonts/a-400i.woff2', italic: true }),
      ],
      'chromium',
    );

    expect(chosen).toHaveLength(3);
  });

  it('drops a face no engine capability covers, rather than emitting an unusable rule', () => {
    const chosen = selectFaces([face({ colorFormats: ['SVG'] })], 'chromium');

    expect(chosen).toStrictEqual([]);
  });

  it('breaks a tie on size, then on path, so output is byte-identical between runs', () => {
    const chosen = selectFaces(
      [
        face({ path: '.fonts/zzz.woff2', size: 500 }),
        face({ path: '.fonts/aaa.woff2', size: 500 }),
      ],
      'chromium',
    );

    expect(chosen[0]?.path).toBe('.fonts/aaa.woff2');
  });

  it('prefers the smaller file when format is already tied', () => {
    const chosen = selectFaces(
      [
        face({ path: '.fonts/a-100.woff2', size: 2000 }),
        face({ path: '.fonts/a-200.woff2', size: 1000 }),
      ],
      'chromium',
    );

    expect(chosen[0]?.path).toBe('.fonts/a-200.woff2');
  });

  it('breaks a size tie on the shorter path before falling back to lexicographic order', () => {
    const chosen = selectFaces(
      [
        face({ path: '.fonts/aaaaaaaaaa.woff2', size: 500 }),
        face({ path: '.fonts/a.woff2', size: 500 }),
      ],
      'chromium',
    );

    expect(chosen[0]?.path).toBe('.fonts/a.woff2');
  });

  it('sorts the result by family for deterministic output order', () => {
    const chosen = selectFaces(
      [
        face({ family: 'Zeta', path: '.fonts/zeta.woff2' }),
        face({ family: 'Alpha', path: '.fonts/alpha.woff2' }),
      ],
      'chromium',
    );

    expect(chosen.map((f) => f.family)).toStrictEqual(['Alpha', 'Zeta']);
  });
});
