# Mechanism: decoded document handoff

Design status: **Accepted**.
Implementation status: **Implemented**.
Measurement status: **Required gates unmet**; local load only.

## Ownership and decision

- Owning slice: [Native read decoding](../slices/native-read-decoding.md).
- Owner: `CoreDecodedDocumentHandoff` in `packages/persistence-postgres/src/core/indexSnapshot.ts`,
  one per transaction.
- No guarantee changes, durable data changes or public contract changes.

## Pinned Convex mechanism

- Revision: `db914cf06e2b06ee985646611b9e12ed7a770318`.
- `crates/indexing/src/database_index_snapshot.rs` keeps fetched user documents packed
  and `crates/common/src/document.rs` derives index keys without unpacking. A read
  unpacks its document once.

## Flarex mechanism and difference

- Flarex stores documents as JSON, so filling the operation cache must decode a
  fetched document to derive its index keys. The observation that reads the row then
  decoded the same bytes again.
- The fill now offers its decoded document to the transaction's handoff. The next
  observation of the same revision takes it when the stored bytes, tablet and expected
  table are identical, which is exactly what a fresh decode would return.
- A taken document leaves the handoff. A later observation of that row decodes again,
  so object identity per observation, and every charge that depends on it, is unchanged.
- Only the most recent offers are kept, inside a window of 1 MiB of stored bytes that is
  separate from the operation cache and not charged to it; the decoded trees add to that.
  Offers end with the transaction and nothing is shared between transactions.
- Fills made for a batch prefetch offer to the same handoff. Their rows are read by the
  slots that consume the prefetched pages, under the same identity checks.

## Encoded final documents

- Owner: `CoreEncodedDocumentHandoff` in `packages/persistence-postgres/src/core/transaction.ts`,
  one per transaction, carried to the commit on the finalized state.
- Pinned Convex: `crates/database/src/transaction.rs` charges a document by its `size()`
  without serialising it, and `crates/database/src/committer.rs` packs each update once
  when the commit is validated.
- Flarex bounds a native body by its stored JSON length, so staging a write must encode
  the document to check the limit and charge the retained bytes. The commit then encoded
  the same final document again for the write batch.
- Staging now offers those bytes for the exact final document object. The batch takes
  them when that object is the change's final document. A later patch stages a new
  object with its own bytes, so the later document wins; bytes of a displaced document
  are never looked up and are released with it.
- Only a document of frozen containers over scalar leaves is kept, since it cannot
  change and its kept bytes are what a fresh encode returns. Core freezes the document
  it assembles before staging, so staging's one codec walk proves it, the encode
  reuses that walk, and the handoff accepts the document on the capture owner's
  identity evidence instead of inspecting it again. A document without that evidence
  is still inspected here. A binary leaf can be written or detached by any holder, so
  such a document is encoded again at commit.
- A taken entry leaves the handoff: a second batch from the same finalized state encodes
  its own bytes, and no two batches share one byte array.
- The byte limit, the retained-byte charge, their order and the stored bytes are
  unchanged. The kept bytes equal the retained bytes already charged for that document.

## Why

A process-wide decoded cache was measured and rejected in challenge: the accepted
[cache and admission budgets](./do-cache-and-admission-budgets.md) forbid a shared
global document cache, its memory would be uncharged, and read charges would depend on
cache state.
