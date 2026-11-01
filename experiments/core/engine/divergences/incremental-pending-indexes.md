# Incremental private pending indexes

Design status: **Selected bounded adaptation after independent source challenge**.
Implementation status: **Bounded shared-root replacement implemented**.
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

### Translated Core native selection at the current pin

The translated Core at `db914cf06e2b06ee985646611b9e12ed7a770318`
already maintains Source's per-index private live-document/tombstone delta in
[`transaction.ts`](../../../../packages/persistence-postgres/src/core/transaction.ts).
Native unique/range reads and checkpoint uniqueness now consume that existing
ordered delta through
[`coreNativePendingIndexDocuments`](../../../../packages/persistence-postgres/src/core/nativeQuery.ts).
They seek the selected interval instead of re-encoding every pending document
for each point lookup. This is reuse of the pinned transaction-index mechanism,
not another algorithm divergence or a second write-state owner.

The physical native slot/range retains its first captured membership and exact
dependencies. Unwritten remembered originals retain first-observation behavior;
every written identity suppresses its original, including deletes and rows
whose final key moved out. Only live final pending members of the selected
interval are added. Uniqueness still inspects remembered originals and checks
conditional eligibility on actual key fields. Releases, accounting, eager Core
key-validation timing and final accepted-prefix validation remain with their
existing owners. The
[`bounded pending-index witness`](../../../../packages/persistence-postgres/test/core/nativePendingIndex.test.ts)
checks the seek, selected live/tombstone prefix, end guard and untouched suffix.

The remaining sections describe the retained logical-root adaptation; they do
not change the translated Core's already eager index-maintenance contract.

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

## Replacement mechanism

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

Reuse the existing canonical index-cache ownership as the native-first payload
proof. For Application-first reuse, the root's exact current-key lookup proves
its retained payload. The native index-retention callback preserves its existing
full lifetime charge when adding a cache record, while root retention includes
the new metadata and only payload not already owned. The root computes this
qualification itself; there is no caller boolean, second key ledger or free tree
metadata. Application no-op callbacks cannot bypass actual root retention.
Both reuse orders, existing retained-key hits and refusal placement need proof.
For a new body with an unchanged key, genuine native lowering must happen before
any prior-tuple payload discount. A retained old tuple can prove payload ownership
without proving the new body's interpretation; the strict hint still misses.

Root-local memory/identity bounds produce `LogicalDocumentRootLimitError` with
the actual resource and observed/maximum values. Point/index journal boundaries
preserve it, including selected-body hydration through `observePoint` after a
valid membership capture. Quota refusal at that cut is not
`pointDependencyChangedAtSnapshot` corruption. Native owners retain their
existing limit classification and original cause. Keep the body-ingestion and
index-installation bounds at their existing cuts and preserve ordered cleanup;
do not turn exhaustion into partial results, refunds or retry permission.
Root memory is not a persisted syscall read-byte dimension. This adaptation adds
no saved receipt/codec or new retry policy. Named root accounting costs remain
separate from document, attempt and returned-value charges.

Independent preparation can reissue genuine handles for one physical index.
Use one exact qualification from the existing located-definition owner in both
root registration and the canonical derived-key cache. The latter retains one
qualified genuine definition per physical ID, rather than charging another key
payload because a different handle object reached it. Keep current integrity,
codec/specification and scope/table checks; mismatches refuse at the existing
native read boundary. No alias table or second key ledger is introduced.

## Canonical ownership and native write proof

Retaining documents across reads must preserve the pinned private-document
ownership in TypeScript despite mutable runtime trees, policy objects and binary
leaves. A read-only collection and shallow object freeze cannot establish it.
The root uses `protectLogicalCanonicalDocument` in the existing
[canonical owner](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalRows.ts),
which delegates stored provenance to the existing
[decoder evidence owner](../../../../packages/persistence-postgres/src/storage/documents/appRowCanonicalEvidence.ts).
They capture private runtime/policy and byte/digest storage, freeze owned policy
containers and supply defensive mutable loans. Foreign shapes gain no decoder
or native interpretation evidence. Known corruption remains a refusal rather
than being repaired by the copy.

Protection is idempotent only for an already protected frame. One ingestion
reuses that protected identity for a shared base/current/original document;
there is no global memo from a mutable original to an old snapshot. The original
full revision evaluation order and general mutable-detachment contracts remain
unchanged. Root rows, index positions and attempts can share the protected frame,
with copying at unsafe ingestion and defensive runtime/buffer reads. This has
allocation cost and does not establish a zero-copy fast path.

Native business validation still precedes candidate protection, which precedes
unique validation and the existing REAL write-evidence capture. Root acceptance
keeps the exact authored frozen attempt when its protected canonical references
are unchanged. Otherwise, a frozen owner-created canonical projection uses
[`retainDetachedLogicalRealWriteAttempt`](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/realWriteEvidence.ts)
to transfer an existing genuine witness after canonical-copy qualification.
Copying an attempt header loses its WeakMap identity; calling the capture issuer
again would instead risk granting proof to an unauthenticated projection.
Keep original issuer identity or use its authenticated transfer. Structural
copies and genuine converted documents
alone cannot manufacture an original attempt witness. Preserve insertion/causal
tokens, ordinals and digests rather than issuing replacement evidence.

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

Complete native `withAccessCandidates` returns all pending table candidates,
even sparse/out-of-index-bound rows; its lower/mark phase and later validation,
projection and accounting precede residual filtering. It had no global sort to
remove. Keep that responsibility. Its native interpretation owner may accept an
optional key interpretation from the root only after existing canonical/cache
guards, with normal retention and error mapping afterward. Require the exact
physical specification, current body, creation time and covered accepted write;
a miss uses the original lowerer, while sparse null is a cached interpretation.
The result is `Result<Option<Key | null>, RootFailure>`: `None` is a miss and
`Some(null)` is a qualified sparse key. Only `None` selects fallback; closed or
foreign roots and conflicting definitions remain failures. Sparse exclusion does
not erase the row's accepted write identity or accounting obligations.
This lookup never activates global catch-up or skips native side phases. Actual
ordered tree consumption remains finite ranges and native bounded-page merging.

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

Required regressions cover repeated reads without complete staged-key
rebuilds, same-key body replacement, repeated key moves, sparse exclusion,
insert/delete identity preservation, late index registration, native/Application
alternation, temporary-invalid repair, selected-index failure order, refill and
exact completion, failed candidate installation, close/freeze and canonical
integrity through genuine owners and both PGlite and ordinary PostgreSQL consumer
lanes. The affected actual Cloudflare host path and both mandated reviews remain
part of the slice's acceptance contract.
Structural removal of scans/sorts is not a throughput or complete-request claim.

## Executing source and acceptance status

The root owner now implements `acceptLogicalDocumentRootWrite`,
`registerLogicalDocumentRootIndexes`, `readLogicalDocumentRootPendingIndex`,
`lookupLogicalDocumentRootPendingKey` and `retainLogicalDocumentRootIndexKey`.
Its private state and runtime read-only views replace external mutation of
current rows/attempts. `finiteRoot` supplies genuine prepared definitions;
finite range merging and native bounded pages consume the private tree.

[`sameLocatedAppIndexDefinition`](../../../../packages/persistence-postgres/src/storage/indexes/locatedAppIndexDefinition.ts)
qualifies genuine immutable definitions. The existing canonical-key owner in
[`relationalRows`](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalRows.ts)
uses it for physical-ID cache records and retention proof. Native complete and
private-reference eligibility/error phases remain as described above.

The root emits its own typed resource limit error, preserved by the
[journal failure owner](../../../../packages/persistence-postgres/src/execution/journal/journalFailures.ts)
and correctly mapped by native callers. No persisted quota dimension or error
receipt codec is added. Owner-level quota/callback proofs, genuine finite
entry/publication cases and real catalog predicate coverage retain their distinct
scopes. Detailed validation and review receipts belong in the scoped Git record;
the wider goal remains open.
