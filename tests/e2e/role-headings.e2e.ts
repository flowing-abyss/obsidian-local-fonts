import { browser, expect } from '@wdio/globals';
import { describe, it } from 'mocha';
import type { ActiveLeafWorkspace } from './helpers/roles.js';
import {
  applyRoles,
  EMPTY_ROLES,
  measureSurface,
  openRoleNote,
  setNativeInlineFonts,
  setNativeTestCss,
  withRoleScenario,
} from './helpers/roles.js';

const ordinary = 'ABCАБя0123';
const code = '.workspace-leaf.mod-active .cm-inline-code:not(.cm-formatting)';
const heading = '.workspace-leaf.mod-active .cm-header-3:not(.cm-inline-code):not(.cm-formatting)';
async function matches(selector: string, sample: string, family: string): Promise<void> {
  const result = await measureSurface(selector, sample, family);
  expect(Math.abs(result.width - result.referenceWidth)).toBeLessThanOrEqual(0.5);
}

async function openHeading(mode: 'live' | 'source', list: boolean): Promise<void> {
  await openRoleNote(mode);
  await browser.executeObsidian(
    ({ app }, prefix: string) => {
      const leaf = (app.workspace as unknown as ActiveLeafWorkspace).activeLeaf;
      if (leaf === null) throw new Error('Missing active heading leaf');
      const editor = (
        leaf.view as unknown as {
          editor: {
            setValue(value: string): void;
            setCursor(position: { line: number; ch: number }): void;
          };
        }
      ).editor;
      editor.setValue(
        `${prefix}### Heading ABCАБя0123 😀 \`ABCАБя0123 😀\`\n\nParagraph ABCАБя0123`,
      );
      editor.setCursor({ line: 0, ch: 10 });
    },
    list ? '- ' : '',
  );
}

describe('editor code within headings', () => {
  for (const mode of ['live', 'source'] as const)
    for (const list of [false, true])
      for (const hard of [false, true])
        it(`keeps ${list ? 'list' : 'regular'} heading code independent in ${mode}, Hard ${hard}`, async () => {
          await withRoleScenario(`heading ${mode} list ${list} hard ${hard}`, async () => {
            await openHeading(mode, list);
            for (const monospace of [null, 'Role Mono'])
              for (const emoji of [null, 'Role Emoji A']) {
                await applyRoles(
                  { ...EMPTY_ROLES, headings: 'Role Headings', monospace, emoji },
                  hard,
                );
                await matches(code, ordinary, monospace ?? 'Role Baseline');
                await matches(heading, ordinary, 'Role Headings');
                await matches(code, '😀', emoji ?? monospace ?? 'Role Baseline');
                await matches(heading, '😀', emoji ?? 'Role Headings');
              }
          });
        });
  for (const mode of ['live', 'source'] as const)
    it(`preserves native Appearance and independently styled list-heading code in ${mode}`, async () => {
      await withRoleScenario(`heading native priority ${mode}`, async () => {
        await openHeading(mode, true);
        for (const monospace of [null, 'Role Mono']) {
          await setNativeInlineFonts({ '--font-monospace-override': "'Role Interface'" });
          await applyRoles(
            { ...EMPTY_ROLES, headings: 'Role Headings', monospace, emoji: 'Role Emoji A' },
            false,
          );
          await matches(code, ordinary, 'Role Interface');
          await matches(code, '😀', 'Role Emoji A');
          await setNativeTestCss(
            "body { --font-monospace-theme: 'Role Baseline'; } .cm-s-obsidian .cm-inline-code { font-family: 'Role Text'; }",
          );
          await matches(code, ordinary, 'Role Text');
          await matches(heading, ordinary, 'Role Headings');
          await setNativeTestCss("body { --font-monospace-theme: 'Role Baseline'; }");
        }
      });
    });
});
