# Mechanism: deferred index coverage

Design status: **Accepted**.
Implementation status: **Implemented**.
Measurement status: **Required gates unmet**; local load only.

## Ownership and decision

- Owning slice: [Native read decoding](../slices/native-read-decoding.md).
- Owner: `createCoreIndexSnapshot` in `packages/persistence-postgres/src/core/indexSnapshot.ts`,
  one per operation snapshot.
- No guarantee changes, durable data changes or public contract changes.

## Pinned Convex mechanism

- Revision: `db914cf06e2b06ee985646611b9e12ed7a770318`.
- `crates/indexing/src/database_index_snapshot.rs`, `populate_cache_misses`: for every
  fetched document, every index of its table receives the document's key and point
  interval at once. The document size is charged through ById. The fetched interval is
  certified afterwards when the budget still holds.
- Keys are derived from the packed document, which is cheap there.

## Flarex mechanism and difference

- A fill still decodes each fetched row, decides its admission to every index of the
  table in the same index order, and charges the budget through ById at the same point.
- It does not derive the key. Each admitted row, and the certified interval, is appended
  to a pending list of its index.
- `components` is the only reader of index coverage. Before it reads an index it applies
  that index's pending list in order: derive the key, store the row, add its point
  interval, or add the certified interval.
- Each index therefore receives the same operations in the same order as an immediate
  fill. The interval union and the row map depend only on that sequence, so a read sees
  identical coverage. An index nobody reads derives no keys.
- Applying a pending row still returns a typed result, which would answer the read
  that needed it. The invariants below make that branch unreachable.
- One index's intervals use `CoreIntervalSet`, which shares the read set's merge.

## Invariants

- The pending decoded document is the same object the fill offers to the
  [decoded handoff](./decoded-document-handoff.md). A taker must never mutate it.
  Today's only taker, `captureObservation`, reads it and captures it again.
- Deriving a key from a captured root can refuse only through the developer ID.
  `readDocumentObject` has already decoded that ID, and the fill proves it once more
  per admitted row with the ID-only key, so a refusal surfaces at the fill and the
  deferred failure branch is unreachable. If key encoding ever gains another fallible
  path, that failure would move from the fill to the first later read of the index.

## Why

A native read makes one operation snapshot per capture and usually reads one index of
it. A Product list page fetched about 100 rows; deriving every index key and interval
for them cost about 4 ms of a 25 ms request, and almost none of it was read.

## Preserved guarantees and cost

- Results, errors, coverage, the first-three-components rule, the byte budget and its
  cut-off row are unchanged. User reads, dependencies and charges are not involved.
- A pending row keeps its decoded document until its index is read or the snapshot
  ends. These are exactly the rows the operation budget admitted, at most the budget
  plus one row. An immediate fill kept each row's keys and interval bounds instead.
- A native capture's snapshot ends with that capture. The transaction's own snapshot
  lives as long as the transaction, so the decoded rows of an index it never reads are
  retained until the transaction ends, uncharged beyond the operation budget above.
- If the leading index of a table is ById and the developer ID refused, an immediate
  fill had charged the row before refusing. A stored row whose developer ID does not
  decode never reaches this point: `readDocumentObject` refuses it first.

## Witnesses

`test/core/indexSnapshot.test.ts`: rows read through ById are hits on an index never
fetched through, its gaps are still fetched, the budget cuts both indexes at the same
rows as before, and one batch filling through two indexes keeps each index's order.
The same tests pass on the immediate fill. A further test derives keys of a captured
document for arbitrary field paths without a refusal. `test/core/nativeTransaction.test.ts`
shows a prefetched row decoded once, by its fill.
