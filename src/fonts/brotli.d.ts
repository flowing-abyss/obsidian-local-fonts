/**
 * `brotli` ships no type declarations. `decompress.js`'s `module.exports` IS the
 * decompress function itself (not a named export), which is what the default import
 * resolves to under esModuleInterop-style CJS interop.
 *
 * `BrotliDecompressBuffer` (see node_modules/brotli/dec/decode.js) always either
 * returns a `Uint8Array` or throws on malformed input — it never returns null.
 */
declare module 'brotli/decompress.js' {
  export default function decompress(input: Uint8Array): Uint8Array;
}
