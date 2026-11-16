# Mechanism: reuse of issued document roots

Design status: **Accepted**.
Implementation status: **Implemented**.
Measurement status: **Required gates unmet**; local load only.

## Ownership and decision

- Owning slice: [Issued document reuse](../slices/issued-document-reuse.md).
- Owner: `capture` in `packages/flarex-protocol/src/document-value.ts`.
- No guarantee or durable data changes. The exported `captureDocument*` functions may
  now return the root they were given instead of a detached copy.

## Pinned Convex mechanism

- Revision: `db914cf06e2b06ee985646611b9e12ed7a770318`.
- `crates/value/src/object.rs` and `array.rs`: `ConvexObject` and `ConvexArray` keep
  private fields, validate once in `TryFrom`, and carry their size and nesting.
- `crates/value/src/bytes.rs`: `ConvexBytes` owns an immutable `Vec<u8>`.
- A constructed value is never validated again; ownership is the proof.

## Flarex mechanism and difference

- A walk is proven when its input could not change under the codec and held no binary
  leaf: a tree of frozen plain arrays and objects with string-keyed data properties
  over null, boolean, number, string or bigint leaves, whoever built it; a root
  `capture` issued, checked the same way the first time it is captured again; or a
  tree this module decoded. The codec's output for that walk is recorded as proven,
  and later captures of it (and of an issued input root) return it, with its size and
  nesting, when they fit the requested profile. A root outside that profile takes the
  full walk, which selects the refusal.
- A frozen input is walked, never issued: only the codec's output is recorded, so a
  foreign tree is not returned and is not a captured root. Convex needs no such case
  because only its own constructors build values; Flarex accepts it because a frozen
  tree is pinned by the language exactly as an issued one is, and it removes the
  second codec walk of every document Core assembles from captured parts.
- The shape check charges each node no more than the codec's semantic size for it
  (strings by length, object keys by length), bounded by the size measured at issuance
  or by the profile's byte limit. A frozen foreign tree the codec refuses early can
  therefore cost up to one further limit-bounded traversal before that refusal.
- The shape check asks a Proxy whether it is extensible, one trap call the codec
  never makes. A trap that throws there proves nothing; the codec's walk alone
  selects the outcome.
- `isProvenScalarDocumentRoot` reports that evidence by identity to trusted owners; a
  structural copy never qualifies.
- The returned tree is always the codec's own output, never the tree first handed in.
- A root that fails the shape check or the proving walk is never reused.
- A stored document is proven when it is decoded. Decoding builds this module's own
  fresh tree from parsed JSON, and when that tree holds no binary leaf the codec's
  walk of it copies nothing foreign, so its output needs no second walk.
- JavaScript cannot freeze an `ArrayBuffer`: any holder can write, transfer or detach
  it. A tree with a binary leaf is therefore walked and copied on every capture, where
  Convex reuses it.
- Issuance alone is not proof. The runtime codec copies a binary leaf through the
  input's own `slice`, so a forged subclass can plant an unvalidated leaf, a Proxy or a
  shared subtree in an issued tree. That codec is embedded in generated runtimes and
  stays unchanged here. The shape check runs before the walk, frozen state first, so a
  Proxy cannot differ between the two.

## Why

One native Product create re-captured already issued documents in 36% of captures,
about 62% of capture time.
