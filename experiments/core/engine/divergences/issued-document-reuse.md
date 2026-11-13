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

- A root that `capture` issued is recognised by identity. The first time it is captured
  again, its shape is checked and then the codec walks it as before.
- If every container was a frozen plain array or object with string-keyed data
  properties and every leaf was null, boolean, number, string or bigint, that walk's
  output is recorded as proven for both roots. Later captures of either return it,
  with its size and nesting, when they fit the requested profile. A root outside that
  profile takes the full walk, which selects the refusal.
- The returned tree is always the codec's own output, never the tree first handed in.
- A root that fails the shape check or the proving walk is never reused.
- JavaScript cannot freeze an `ArrayBuffer`: any holder can write, transfer or detach
  it. A tree with a binary leaf is therefore walked and copied on every capture, where
  Convex reuses it.
- Issuance alone is not proof. The runtime codec copies a binary leaf through the
  input's own `slice`, so a forged subclass can plant an unvalidated leaf, a Proxy or a
  shared subtree in an issued tree. That codec is embedded in generated runtimes and
  stays unchanged here. The shape check runs before the walk, frozen state first, so a
  Proxy cannot differ between the two, and it is bounded by a node budget.

## Why

One native Product create re-captured already issued documents in 36% of captures,
about 62% of capture time.
