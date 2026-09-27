import { expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import {
  measureSurface,
  openRoleNote,
  openRoleSettings,
  openRoleSuggestion,
  withRoleScenario,
} from './helpers/roles.js';

describe('calibrated real font rendering', () => {
  it('distinguishes every ordinary role face and both emoji faces', async () => {
    await withRoleScenario('calibration', async () => {
      await openRoleNote('reading');
      const families = [
        'Role Text',
        'Role Interface',
        'Role Mono',
        'Role Headings',
        'Role Baseline',
      ];
      const widths: number[] = [];
      for (const family of families) {
        const result = await measureSurface('.markdown-preview-view p', 'ABCАБя0123', family);
        widths.push(result.referenceWidth);
      }
      for (const [index, left] of widths.entries()) {
        for (const right of widths.slice(index + 1)) {
          expect(Math.abs(left - right)).toBeGreaterThan(2);
        }
      }
      for (const sample of ['😀', '☀️', '👩‍💻']) {
        const a = await measureSurface('.markdown-preview-view p', sample, 'Role Emoji A');
        const b = await measureSurface('.markdown-preview-view p', sample, 'Role Emoji B');
        expect(Math.abs(a.referenceWidth - b.referenceWidth)).toBeGreaterThan(2);
      }
      for (const family of ['Role Emoji A', 'Role Emoji B']) {
        const joined = await measureSurface('.markdown-preview-view p', '👩‍💻', family);
        const one = await measureSurface('.markdown-preview-view p', '👩', family);
        expect(Math.abs(joined.referenceWidth - one.referenceWidth)).toBeLessThanOrEqual(0.5);
      }
    });
  });

  it('keeps unassigned note, code, and native settings on their baseline fonts', async () => {
    await withRoleScenario('native baseline', async () => {
      await openRoleNote('reading');
      for (const selector of ['.markdown-preview-view p', '.markdown-preview-view p code']) {
        const result = await measureSurface(selector, 'ABCАБя0123', 'Role Baseline');
        expect(Math.abs(result.width - result.referenceWidth)).toBeLessThanOrEqual(0.5);
      }
      await openRoleSettings();
      const setting = await measureSurface(
        '.role-test-setting .setting-item-name',
        'ABCАБя0123',
        'Role Baseline',
        'settings',
      );
      expect(Math.abs(setting.width - setting.referenceWidth)).toBeLessThanOrEqual(0.5);
      const ordinaryLabel = await measureSurface(
        '.setting-item-name',
        'Emoji',
        'Role Baseline',
        'settings',
      );
      expect(Math.abs(ordinaryLabel.width - ordinaryLabel.referenceWidth)).toBeLessThanOrEqual(0.5);
    });
  });

  it('keeps unassigned editor modes and native suggestions on their baseline fonts', async () => {
    await withRoleScenario('editor and suggestion baseline', async () => {
      for (const mode of ['live', 'source'] as const) {
        await openRoleNote(mode);
        const paragraph = await measureSurface(
          '.workspace-leaf.mod-active .cm-line',
          'ABCАБя0123',
          'Role Baseline',
        );
        expect(Math.abs(paragraph.width - paragraph.referenceWidth)).toBeLessThanOrEqual(0.5);
      }
      await openRoleSuggestion();
      const suggestion = await measureSurface('.suggestion-item', 'ABCАБя0123', 'Role Baseline');
      expect(Math.abs(suggestion.width - suggestion.referenceWidth)).toBeLessThanOrEqual(0.5);
    });
  });
});
