import { browser } from '@wdio/globals';

export async function navigateRoleEditor(pattern: string): Promise<void> {
  await browser.executeObsidian(({ app }, prefix: string) => {
    const view = app.workspace.getLeaf(false).view as unknown as {
      editor: {
        getValue(): string;
        setCursor(position: { line: number; ch: number }): void;
        scrollIntoView(
          range: { from: { line: number; ch: number }; to: { line: number; ch: number } },
          center: boolean,
        ): void;
      };
    };
    const line = view.editor
      .getValue()
      .split('\n')
      .findIndex((text) => text.startsWith(prefix));
    if (line < 0) throw new Error(`Missing fixture line ${prefix}`);
    view.editor.setCursor({ line, ch: 0 });
    view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 1 } }, true);
  }, pattern);
}
