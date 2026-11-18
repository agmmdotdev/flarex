# Typed buffers for canonical document IDs

Convex `db914cf06e2b06ee985646611b9e12ed7a770318`
`crates/value/src/id_v6.rs` uses stack byte buffers and a SIMD checksum during
encoding. TypeScript uses bounded `Uint8Array` scratch storage and scalar
checksum accumulation. Integer-indexed stores avoid inherited indexed setters
without defining one JavaScript property per byte. The same-realm predicate
retains captured intrinsics and the canonical re-encode comparison.

Public decoding still validates untrusted text. Brand issuance after the
canonical proof avoids parsing the same text again. The fixed-width writer
requires sixteen genuine visible bytes. Preserve emitted ID bytes, minimal
table encoding, checksum, owned decoded bytes and legacy normalization.
The exported byte schema retains its Uint8Array codec metadata. The encoder
checks the intrinsic view separately before it uses fixed-width storage.
