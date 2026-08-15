import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { brotliCompressSync } from 'node:zlib';

/** Absolute path to the checked-in fixture fonts, which live in a hidden folder on purpose. */
export const FIXTURE_DIR = path.resolve(import.meta.dirname, 'vaults', 'minimal', '.fonts');

/** Read a fixture font as an ArrayBuffer, e.g. `readFixture('probe-sans/probe-sans-400.ttf')`. */
export function readFixture(relPath: string): ArrayBuffer {
  const buf = readFileSync(path.join(FIXTURE_DIR, relPath));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** UIntBase128, the length encoding a woff2 table directory uses. */
function uintBase128(value: number): number[] {
  const out = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    out.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return out;
}

/** An `fvar` table carrying a single wght axis from 100 to 900, default 400. */
function fvarTable(): Uint8Array {
  const table = new Uint8Array(36);
  const view = new DataView(table.buffer);
  view.setUint16(0, 1); // majorVersion
  view.setUint16(4, 16); // axesArrayOffset
  view.setUint16(8, 1); // axisCount
  view.setUint16(10, 20); // axisSize
  for (const [index, char] of [...'wght'].entries()) {
    view.setUint8(16 + index, char.charCodeAt(0));
  }
  // Fixed 16.16, the format fvar stores axis bounds in.
  view.setInt32(20, 100 * 65536);
  view.setInt32(24, 400 * 65536);
  view.setInt32(28, 900 * 65536);
  return table;
}

/**
 * Build a decodable woff2 holding one untransformed `fvar` table: the 48-byte header, a
 * one-entry directory (the spec's known-tag index for `fvar`, transform bits zero, then
 * the length), and the brotli-compressed table body.
 *
 * Built rather than checked in because every fixture font is static, and the tooling that
 * generates them (`scripts/make-fixtures.py`) needs packages fetched from the network.
 * WOFF2 defines transforms only for `glyf`/`loca`/`hmtx`, so `fvar` travels as plain
 * bytes inside the brotli stream — which is what makes a hand-built container a faithful
 * stand-in for a real variable woff2 on this particular path.
 */
export function buildWoff2WithFvar(): ArrayBuffer {
  const table = fvarTable();
  const compressed = brotliCompressSync(table);
  const header = new Uint8Array(48);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x774f_4632); // 'wOF2'
  view.setUint16(12, 1); // numTables
  view.setUint32(20, compressed.byteLength);
  const FVAR_KNOWN_TAG_INDEX = 47;
  const directory = [FVAR_KNOWN_TAG_INDEX, ...uintBase128(table.byteLength)];
  return new Uint8Array([...header, ...directory, ...compressed]).buffer;
}
