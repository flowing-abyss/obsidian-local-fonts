import { readFileSync } from 'node:fs';
import * as path from 'node:path';

/** Absolute path to the checked-in fixture fonts, which live in a hidden folder on purpose. */
export const FIXTURE_DIR = path.resolve(import.meta.dirname, 'vaults', 'minimal', '.fonts');

/** Read a fixture font as an ArrayBuffer, e.g. `readFixture('probe-sans/probe-sans-400.ttf')`. */
export function readFixture(relPath: string): ArrayBuffer {
  const buf = readFileSync(path.join(FIXTURE_DIR, relPath));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
