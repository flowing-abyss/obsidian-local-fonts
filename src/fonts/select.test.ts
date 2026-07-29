import { describe, expect, it } from 'vitest';
import { explainSelection, selectFaces } from './select.js';
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

describe('explainSelection', () => {
  it('marks the only face at a key as selected with no reason, since nothing competed', () => {
    const verdicts = explainSelection([face({ path: '.fonts/a.woff2' })], 'chromium');

    expect(verdicts.get('.fonts/a.woff2')).toStrictEqual({ status: 'selected', reason: null });
  });

  it('flags a face this engine cannot render as unrenderable', () => {
    const verdicts = explainSelection(
      [face({ path: '.fonts/a.woff2', colorFormats: ['SVG'] })],
      'chromium',
    );

    expect(verdicts.get('.fonts/a.woff2')).toStrictEqual({ status: 'unrenderable' });
  });

  it('gives the winner a format reason and the loser a matching not-selected reason', () => {
    const verdicts = explainSelection(
      [
        face({ path: '.fonts/a.ttf', format: 'ttf', size: 100 }),
        face({ path: '.fonts/a.woff2', format: 'woff2', size: 100 }),
      ],
      'chromium',
    );

    expect(verdicts.get('.fonts/a.woff2')).toStrictEqual({ status: 'selected', reason: 'format' });
    expect(verdicts.get('.fonts/a.ttf')).toStrictEqual({
      status: 'not-selected',
      reason: 'format',
    });
  });

  it('gives the same verdicts regardless of which face appears first in the input', () => {
    // The comparator sorting each bucket must work in both directions: with the winner
    // listed first here (reversed from the test above), isBetter(a, b) is true on the
    // very first comparison rather than false.
    const verdicts = explainSelection(
      [
        face({ path: '.fonts/a.woff2', format: 'woff2', size: 100 }),
        face({ path: '.fonts/a.ttf', format: 'ttf', size: 100 }),
      ],
      'chromium',
    );

    expect(verdicts.get('.fonts/a.woff2')).toStrictEqual({ status: 'selected', reason: 'format' });
    expect(verdicts.get('.fonts/a.ttf')).toStrictEqual({
      status: 'not-selected',
      reason: 'format',
    });
  });

  it('gives a size reason when format is already tied', () => {
    const verdicts = explainSelection(
      [
        face({ path: '.fonts/a-100.woff2', size: 2000 }),
        face({ path: '.fonts/a-200.woff2', size: 1000 }),
      ],
      'chromium',
    );

    expect(verdicts.get('.fonts/a-200.woff2')).toStrictEqual({
      status: 'selected',
      reason: 'size',
    });
    expect(verdicts.get('.fonts/a-100.woff2')).toStrictEqual({
      status: 'not-selected',
      reason: 'size',
    });
  });

  it('gives a tie-break reason when format and size are both tied', () => {
    const verdicts = explainSelection(
      [
        face({ path: '.fonts/zzz.woff2', size: 500 }),
        face({ path: '.fonts/aaa.woff2', size: 500 }),
      ],
      'chromium',
    );

    expect(verdicts.get('.fonts/aaa.woff2')).toStrictEqual({
      status: 'selected',
      reason: 'tie-break',
    });
    expect(verdicts.get('.fonts/zzz.woff2')).toStrictEqual({
      status: 'not-selected',
      reason: 'tie-break',
    });
  });

  it('selects on renderability alone when only one candidate at a key can render', () => {
    const verdicts = explainSelection(
      [
        face({ path: '.fonts/emoji.woff2', format: 'woff2', size: 100, colorFormats: ['SVG'] }),
        face({
          path: '.fonts/emoji.ttf',
          format: 'ttf',
          size: 200,
          colorFormats: ['SVG', 'COLR1'],
        }),
      ],
      'chromium',
    );

    expect(verdicts.get('.fonts/emoji.woff2')).toStrictEqual({ status: 'unrenderable' });
    // Only one renderable candidate at this key: it wins purely on being the only one
    // that can render, not on format/size — decidingRule is never reached because there
    // is no runner-up to compare against.
    expect(verdicts.get('.fonts/emoji.ttf')).toStrictEqual({ status: 'selected', reason: null });
  });

  it('keeps different (weight, style) keys independent of each other', () => {
    const verdicts = explainSelection(
      [
        face({ path: '.fonts/a-400.woff2', weight: 400 }),
        face({ path: '.fonts/a-700.woff2', weight: 700 }),
      ],
      'chromium',
    );

    expect(verdicts.get('.fonts/a-400.woff2')).toStrictEqual({ status: 'selected', reason: null });
    expect(verdicts.get('.fonts/a-700.woff2')).toStrictEqual({ status: 'selected', reason: null });
  });
});
