# Incremental private pending indexes

Design status: **Selected bounded adaptation after independent source challenge**.
Implementation status: **Unstarted**.
Measurement status: **Unmeasured**.
Owner: [04B pending-index replacement](../slices/04b-incremental-pending-indexes.md).
The [goal](../GOAL.md) and existing profile guarantees remain unchanged.

## Pinned Convex mechanism

At `84fbb0e70b4e857913673871cb847ad11a55f3d5`,
[`TransactionIndex`](../../../../../../crates/database/src/transaction_index.rs)
keeps an ordered private delta per physical index. Its values are live packed
documents or tombstones. `begin_update` checks a cloned index registry; after
fallible `Writes::update` accepts the write,
[`Transaction::apply_validated_write`](../../../../../../crates/database/src/transaction.rs)
calls `finish_update`, which eagerly applies index changes.
[`IndexRegistry::index_updates`](../../../../../../crates/indexing/src/index_registry.rs)
and `IndexedDocument::index_key_bytes` produce these keys without a typed
key-lowering failure. Do not describe this as fallible eager key validation
before write acceptance.

Every accepted transition updates old and new current keys. Same-key body
replacement still replaces the packed document. A -> B -> C can retain
tombstones at A and B and the latest body at C. The separate
[`Writes`](../../../../../../crates/database/src/writes.rs) owner coalesces the
first original and final value while preserving write-call accounting and
generated-ID obligations. An empty index delta does not prove an empty write
history. Nested checkpoints restore write/index state; required reads and read
accounting remain. These are source findings, not executed upstream tests.

## Why the write-maintenance timing differs

Current Flarex accepts schema-valid pending writes before ordinary ordered-key
lowering. The existing
[`indexedQueries` regression](../../../../packages/persistence-postgres/test/execution/journal/indexedQueries.test.ts)
accepts a decimal-index patch with an invalid decimal string, then observes
`ExactDecimalError` from the subsequent range read. Final publication separately
lowers original/final documents. The TypeScript key codec can also reject an
oversized ordered key. Convex's key representation is not that same hard limit.

Making every write eagerly throw these errors would change current admission
and failure timing, including temporary invalid values repaired before a read
or final publication. Cache warmth must not decide whether a write fails.
Retaining a new global error-sentinel policy would add a mechanism absent from
the pin and require extra native error/visibility rules. Instead, update the
selected index on demand from accepted writes. Keep the existing lowering,
integrity checks, profile error mapping and final acceptance enforcement.

## Planned replacement

The existing portable
[`root evaluator`](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/rootEvaluator.ts)
remains the pending-state owner for Application and borrowed native writes.
The runtime does not gain a second write journal or durable commit authority.

- Keep one ordered `BTreeEx` from the installed `sorted-btree` package for each
  activated physical index, ordered by the existing encoded-key/row-ID tuple.
  Its entries contain current live pending positions and bodies.
- Use the existing immutable accepted-attempt log and an applied ordinal per
  index. Coalesce unseen attempts by row identity, then lower the latest current
  value once for the selected index. First activation catches up from the root's
  accepted writes. Same-key body changes still invalidate the derived position.
- Retain authoritative written-row identities separately from live tree entries.
  Include accepted writes only, qualified by the root and table, not read-only
  observations. Suppress snapshot positions by these identities, including
  deletes, sparse-key exclusion and insert-then-delete. The compensation count
  is distinct written rows for the selected table, not current live tree size.
  Keep current refill bounds.
- Remove a row's prior local position before inserting its latest position.
  A -> B -> C must remove B; A -> B -> A must restore A with the latest body.
  Do not lower the original body merely to create a full-key tombstone. Current
  range evaluation lowers current bodies and suppresses by row ID; the source
  challenge did not establish that adding earlier original-key failures would
  be unobservable across every supported metadata/history lifecycle.
- Build a candidate without exposing partial state. Use the existing ordered
  point/index/native operation owners, preserve native retention/accounting, and
  recheck root openness and captured generations after any yielding work.
  Install positions, locators and the applied ordinal in one synchronous fold.
  Failure or closure must not partially install or advance the ordinal.

This is deliberately different from Convex's eager full-key tombstones. It
coalesces obsolete intermediate pending positions while preserving original
observations, accepted calls, generated identities and final publication data
in their existing owners. It adds no PostgreSQL read or body materialization
solely for index maintenance. The implementation must bound and release derived
memory without charging the same native canonical key twice.

## Native eligibility and retained consumer

Ordinary finite Application ranges and native complete/bounded indexed readers
currently lower the table's current pending rows before index bounds. Their
replacement must preserve this failure order, including invalid out-of-range
pending keys. Cache hits must retain canonical integrity checks. Unseen-attempt
order is not necessarily row encounter order: observing A then B, then writing
B then A, must not reverse which invalid latest key is reported first. Preserve
the actual Application dependency/native row encounter order and native REAL
document preflight, inspection and integrity phases. These native checks can
still inspect all pending rows; only the displaced key reconstruction and sort
are removed by this bounded adaptation.

The authenticated `privateReferencePage` in
[`workingSet.ts`](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts)
instead checks relevance and allowed identity before lowering a pending key.
A globally failing catch-up could expose a refusal caused by a hidden row.
Keep that projection's existing eligibility-first lowering and merge in this
bounded slice. A compatible written-identity projection may be reused only if
ordering, inspection limits, cursor generation and charges remain unchanged.

This is a named retained consumer, not completed migration. Its removal gate is
an eligibility-preserving root-delta contract and genuine allowed/hidden-row
failure, cursor, budget and page-completion witnesses. Do not introduce global
error sentinels or broaden disclosure just to remove this path now.

## Preserved authority, lifecycle and remaining gates

Index registration uses an already admitted immutable physical definition at the
same snapshot and metadata identity; it is not database index creation/readiness.
Pending trees are not shared committed query caches. Root closure/freeze releases
them; borrowed native working-set closure must retain the live root's state.
No new catchable nested rollback is selected here. A later checkpoint mechanism
must restore or invalidate the tree and ordinal together with writes while
preserving the selected read/accounting contract.

No schema, durable receipt/outcome format, grant rule, retry profile or stored
attempt disposition changes. PostgreSQL remains the sole durable authority.
The ordinary Standard mutation cutover, old journal disposition, commit pipeline,
native hosting, complete-flow performance and replication decisions are not
implemented by this record.

Before marking 04B implemented, prove repeated reads without complete staged-key
rebuilds, same-key body replacement, repeated key moves, sparse exclusion,
insert/delete identity preservation, late index registration, native/Application
alternation, temporary-invalid repair, selected-index failure order, refill and
exact completion, failed candidate installation, close/freeze and canonical
integrity. Use genuine owners and both PGlite and ordinary PostgreSQL consumer
lanes; rerun the affected actual Cloudflare host path and both mandated reviews.
Structural removal of scans/sorts is not a throughput or complete-request claim.
