# Incremental indexes for the shared pending root

Status: **Bounded shared-root pending-index replacement implemented**.
Independent current-owner,
pinned-Convex and accepted-direction findings have been exchanged. This document
records the bounded replacement and its implementation gates. Source checkpoint:
Flarex `d1002bae4`; Convex
`84fbb0e70b4e857913673871cb847ad11a55f3d5`.

This is substep 04B of the
[mutation pending-state replacement](./04-mutation-pending-state.md).
[04A](./04a-range-completion-evidence.md) owns membership lookahead and its OCC
evidence. The actual Standard stored-profile, preparation, grant-admission and
old-anchor cutover remains 04C. Neither a new pending-index helper nor this
contract completes that cutover. Replication remains deferred.

## Current owner, pinned mechanism and replacement

| Current responsibility | Pinned Convex mechanism | Bounded replacement |
| --- | --- | --- |
| `finitePoints` walks root dependencies; finite `indexedQueries` reconstructs staged positions, lowers their keys and sorts a merged array for each read. | `TransactionIndex` owns per-physical-index ordered pending entries. | Keep a per-index BTree on the existing root and catch up accepted changes before ordinary indexed reads. Remove the finite per-read pending reconstruction. |
| Application `rootEvaluator.writePoint` and native `workingSet` write helpers mutate the same original/current rows and accepted attempts through different paths. | `Writes::update` accepts the write before `TransactionIndex::finish_update` updates its private index delta. | Give both actual writers one synchronous accepted-transition boundary. Existing rows and immutable attempts remain the pending-data owner. |
| Native complete-membership and bounded-page reads inspect pending table rows and lower their selected index keys. | Ordered pending live values and tombstones merge with the admitted snapshot. | Bounded pages consume ordered current positions. Complete native selection retains its all-pending candidate phase and can reuse exact current-key interpretations without activating global catch-up. Preserve admission, predicates, accounting and membership evidence. |
| Native private reference paging checks its authenticated relevant value and allowed IDs before lowering a pending key. | The general upstream index merge does not establish this product-specific eligibility order. | Retain this reader's existing eligibility-first bounded merge until an equivalent delta proof exists. Do not introduce failures from hidden rows. |

Executing owners are the
[root evaluator](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/rootEvaluator.ts),
[finite root](../../../../packages/persistence-postgres/src/execution/journal/finiteRoot.ts),
[indexed queries](../../../../packages/persistence-postgres/src/execution/journal/indexedQueries.ts)
and native
[working set](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts).
The root already holds original rows, current rows, immutable accepted attempts,
read evidence and its memory budget. Do not add a Standard-only pending map,
another write journal, a cache service or publication authority.

At the pin, inspect `TransactionIndex::begin_update` and `finish_update` in
[`transaction_index.rs`](../../../../../../crates/database/src/transaction_index.rs),
the call order in
[`transaction.rs`](../../../../../../crates/database/src/transaction.rs),
[`index_registry.rs`](../../../../../../crates/indexing/src/index_registry.rs)
and [`writes.rs`](../../../../../../crates/database/src/writes.rs).
`begin_update` validates a cloned registry; the fallible `Writes::update` precedes
the infallible `finish_update`. The pin eagerly computes applicable keys and
stores complete positions mapped to packed live documents or tombstones. It
updates same-key body replacements and can retain intermediate tombstones.
It does not use a deferred key-error record.

Immutable pin references:
[`begin_update`/`finish_update`](https://github.com/get-convex/convex-backend/blob/84fbb0e70b4e857913673871cb847ad11a55f3d5/crates/database/src/transaction_index.rs#L493-L544),
[write-before-index call order](https://github.com/get-convex/convex-backend/blob/84fbb0e70b4e857913673871cb847ad11a55f3d5/crates/database/src/transaction.rs#L974-L1047),
[applicable index updates](https://github.com/get-convex/convex-backend/blob/84fbb0e70b4e857913673871cb847ad11a55f3d5/crates/indexing/src/index_registry.rs#L167-L220)
and [write accounting/coalescing](https://github.com/get-convex/convex-backend/blob/84fbb0e70b4e857913673871cb847ad11a55f3d5/crates/database/src/writes.rs#L239-L345).

## Selected representation and catch-up

Use the already installed `sorted-btree` 2.1.0 implementation (`BTreeEx`) as an
ordered private delta for each authenticated physical index. The existing
[snapshot index cache](../../../../packages/persistence-postgres/src/storage/indexes/snapshotIndexCache.ts)
establishes dependency availability, not a reason to make pending state part of
the committed query cache. Use the existing total order of encoded key followed
by row ID; a logical key without row identity cannot distinguish pending rows
at the same logical key. Base suppression uses the accepted written-ID owner.

Each activated pending index retains its genuine immutable definition, ordered
current live entries, the locator needed to remove a row's previous pending key,
and a watermark into the existing root's accepted attempts. The attempt log is
the sole change history. Written identities include only accepted writes, not
snapshot hydration or read-only point dependencies. They remain rooted in those
accepted attempts and suppress base membership, including pending deletions.
Do not add another retained dirty journal merely to discover changes. An unchanged read
must not rescan all root dependencies or relower and sort every pending table
document. First successful activation examines prior accepted attempts once. Later
successful catch-ups advance past only their unseen suffix, including attempts
for other tables that can be filtered without lowering. Work is bounded by the
existing accepted history and activated indexes; this is not a claim of constant
write cost or of eliminating every native candidate inspection.

For ordinary readers, catch-up inspects only the unseen accepted-attempt suffix,
coalesces affected identities, and lowers each affected row's latest pending
value for the selected index. It considers all eligible written rows for that
consumer before applying range bounds. In
particular, the current ordinary readers do not hide an invalid pending key
merely because its value lies outside the requested bounds.

Remove a row's previously installed pending live position through its retained
locator, keep its written-ID suppression, and install its latest live body or
remove its current entry on deletion. Same-key body changes must participate
even when the key is equal.
For original `A`, then pending `B`, then pending `C`, the coalesced result
suppresses the base row by identity and retains only latest `C`; stale live `B`
must disappear. For `A -> B -> A`, the latest body at `A` replaces the suppressed
base. A base-absent insert followed by delete can leave no ordered index entry,
but its written identity, original observation, attempts, insertion evidence,
materialization obligations and write charges remain intact.

Do not introduce original-body key lowering or another body read merely to
manufacture full-key base tombstones. Existing finite reads lower only current
pending values and suppress all written base IDs. Later settlement lowering of
original/final changes does not prove an earlier original-key failure or cost is
harmless across supported historical/readiness states. A future move to the
pin's exact tombstones requires that writer/readiness proof first.

Lazy coalescing and written-ID base suppression differ from the pin's eager
maintenance and complete-key tombstones, including intermediate tombstones.
The reason is the current TypeScript lowering and failure contract, not a claim
of mechanical translation. The dedicated
[divergence record](../divergences/incremental-pending-indexes.md) owns the reason
and implementation differences.

## Prepared definitions and ownership

Seed Application index mechanics through its existing admitted preparation and
[prepared publication definitions](../../../../packages/persistence-postgres/src/commit/publication/definitionPreparation.ts).
Borrowed native sources already have genuine prepared write mechanics and index
definitions. Register those through their existing checked construction/borrowing
boundary; do not fetch a specification from Postgres on every local range read.

Late registration starts from the root's original snapshot and catches up all
prior accepted writes relevant to that index. It registers an already admitted
definition; it does not enable a newly created or backfilling database index.
Identity includes the table, physical index, codec and exact specification under
the existing root/snapshot identity. Reject conflicting definitions for one
identity. A logical name, structurally similar object or another source's newer
head is insufficient.

Definition retention grants no admission or freshness verdict. Existing source
lifetimes, selected metadata consumption and storage-frontier checks remain with
their owners. A borrower closing must not clear the original root's delta.

All Application and shared-root native mutations must publish their accepted
attempt, current row and written-identity notification together in one
synchronous fold. Cover document insert/patch/replace/remove, relational deletion, close-time
cascade deletion and set-null rewrites that already use the document writer.
Snapshot hydration is not a write. `overlayWriteGenerations` now advances for
accepted shared-root writes; the before-operation `activityGeneration` also
includes non-write activity. Neither replaces the immutable accepted-attempt log
as the per-index catch-up history.

Constrain mutable row/current/attempt access to that boundary. A `ReadonlyMap`
whose values or canonical bytes remain mutable is not sufficient. Consumers
must not receive the mutable BTree or an index result that can mutate its retained
canonical evidence. Preserve existing detached public projections and authentic
canonical ingestion. This does not authorize a new root service or transaction
API; reuse the current owner's types and capability boundaries.

## Retained canonical bodies and native attempt evidence

The root's rows, attempts and index positions share protected canonical frames,
using `protectLogicalCanonicalDocument` in the existing
[canonical interpretation owner](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalRows.ts)
and `protectStoredAppDocumentEvidence` in the existing
[stored-document evidence owner](../../../../packages/persistence-postgres/src/storage/documents/appRowCanonicalEvidence.ts).
A read-only collection or frozen outer object alone cannot protect nested runtime
values, JSON policy, typed arrays or `ArrayBuffer` leaves. These owners capture
private runtime/policy and evidence buffers, freeze their owned policy containers,
and expose defensive runtime/binary/evidence reads. Protection does not validate
or confer stored-decoder provenance on a foreign canonical shape.

Already protected frames retain their identity. Mutable originals are not
globally memoized: a later capture must still observe source corruption. One
root ingestion protects a shared source document once and reuses that protected
identity across base, current and original revision. The original full revision
copy/evaluation order and existing mutable-detachment contracts stay with their
owners. Existing false/corrupt interpretation verdicts remain false; protection
must not turn a corrupted source into valid evidence. This adds owning copies
at unsafe ingestion and defensive copies for mutable loans; it is not a
zero-allocation or zero-copy claim.

Native candidate protection occurs after document validation and before unique
validation and REAL attempt capture. If the authored frozen attempt already
contains the root's protected before/after frames, the root retains that exact
attempt. If owner-created canonical copies are necessary, it freezes the
projected attempt and uses
[`retainDetachedLogicalRealWriteAttempt`](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/realWriteEvidence.ts)
to transfer only an existing genuine witness with verified canonical-copy
lineage. A structurally identical attempt cannot inherit REAL proof merely by
referencing a genuinely converted document. Do not recapture or manufacture
proof at root acceptance. Original opaque insertion and deleted-reference
evidence, ordinals and digests remain unchanged.

## Atomicity, lowering and budgets

Capture the accepted suffix endpoint and relevant latest row states, prepare
the complete index change and check its retention budget under the actual
ordered root operation. Publish the tree, locators, written-identity view and
watermark in one synchronous fold with a final open/root-generation check.
An index's derived written-identity view never replaces the root's authoritative
accepted written identities.
Existing Effect wrappers can be suspension boundaries: either the owning
operation proves exclusion throughout preparation, or generation revalidation
must refuse stale installation after any suspension. Do not infer exclusion
from a helper's synchronous-looking call site. An index failure, closed root or
refused retention must not publish a partial tree or advance its watermark.
The cursor must belong to this root's accepted history; a bare array length is
insufficient if a future lifecycle can restore or replace that history.

The executor's existing
[point mutation journal](../../../../packages/executor/src/mutation/journal/pointMutationJournal.ts)
semaphore orders admitted Application point/index/participant operations.
Native bounded request lifetime admission also rejects overlapping operations
within its lifetime. Reuse and verify those actual owners; a participant's
in-flight counter alone is not a universal root mutex. If any existing path can
bypass that ordering, retain the final generation check rather than asserting
that its preparation cannot interleave.

Preserve each consumer's established failure order when folding affected rows.
Unseen attempt order is not that order: finite `finitePoints` uses dependency
Map insertion order, while native ordinary paths use row Map insertion order.
After observing `A`, then `B`, writes to `B`, then `A` can leave two invalid
latest keys. Lowering in suffix order would change the first typed failure or
Cause from the existing owner. Retain the original encounter provenance needed
to order affected identities, or prove equivalence; do not introduce that change
to avoid a lookup. Keep native REAL/integrity preflight phases in their existing
order as well. Any necessary remaining scan must be named rather than claimed
removed.

Keep
[`lowerAppDeveloperIndexKeyV1`](../../../../packages/persistence-postgres/src/storage/indexes/appDeveloperIndexKeys.ts)
as the common interpretation owner. Native
[`lowerLogicalCanonicalIndexKey`](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/relationalRows.ts)
also owns canonical integrity checks, native error mapping and bounded retained
key interpretation. The delta must preserve these obligations, including
integrity checks on cached reuse where mutable evidence can still be reached.
It must not silently bypass them by trusting a previously lowered string.

Current writes can accept a schema-valid value whose ordered key later fails
exact-decimal interpretation or maximum key size. A later accepted write may
repair that intermediate value before an indexed read or final publication.
Coalesce before lowering so an unqueried intermediate failure does not become
an earlier write error or poison the final value. Final settlement already
derives publication from original and final changes. A failed native read still
latches its existing full failure Cause and rollback-only state; this contract
does not permit repair after that terminal failure.

Charge additional retained tree/position bookkeeping through the existing root
and native lifetime budget owners. Canonical bodies remain owned once by the
root. Do not duplicate native retained-key charges for the same retained payload,
charge unchanged cached reads again for retention, loosen limits, or replace
logical read/write accounting with tree cardinality. Existing spent charges and
failure latches do not acquire a refund or rollback policy from this cache.
Preserve refusal-before-cache-install and adversarial canonical corruption
coverage while establishing the concrete ownership and charge placement.

The shared-key bridge uses the existing canonical index-cache ownership to
prove native-first payload retention; it does not add another key ledger.
For Application-first reuse, the root's exact current-key lookup proves which
payload it already owns. An optional native index-retention callback keeps the
existing full native lifetime cost when adding that native cache record, while
the root charges its newly retained metadata and any payload not already owned.
The root computes that discount from genuine ownership, never a caller boolean.
An unchanged retained native key still follows its existing guard/cache path.
Additional tree/locator metadata remains charged, and Application callbacks
cannot waive root retention. Prove both reuse orders and refusal placement.
Interpretation and payload ownership are distinct: after a new current body is
genuinely lowered, the root may prove that its unchanged key/row tuple is still
retained from the previous body and avoid charging that payload again. This does
not let the previous body's key answer interpretation for the new body. Keep the
strict current-body hint, exact tuple proof and different-key negative control.

Root memory/identity exhaustion is a local resource failure, not storage
corruption. `LogicalDocumentRootLimitError` carries the actual resource,
observed amount and maximum. Point/index journal owners preserve it, including
when an otherwise valid indexed page exhausts the root while hydrating a
selected body through `observePoint`. That refusal must not become
`pointDependencyChangedAtSnapshot` corruption. Native owners keep their existing
limit classification with the original cause. The body-ingestion bound remains
before protected capture; index retention bounds remain before candidate
installation. Selected-body
hydration refusal retains the existing ordered operation's failure/cleanup
behavior. No partial success, quota refund or new retry eligibility follows.

First-write identity/order and first-table retention use the root owner's
`LOGICAL_DOCUMENT_ROOT_WRITTEN_IDENTITY_BYTES` and
`LOGICAL_DOCUMENT_ROOT_WRITTEN_TABLE_BYTES`, separately from
document/attempt/return envelopes. A
fixture targeting a later return refusal must reserve those genuine intervening
costs rather than weaken limits or move the acceptance boundary. No existing
persisted syscall dimension describes root working memory. Do not invent a
read-byte dimension, persist a new receipt format or add another error wrapper.

Located definitions can be reissued as distinct genuine handles. Native-first
payload proof cannot rely on object identity: native complete selection may
retain a key under one handle before an Application range activates the tree
using another. Qualify by the existing located-definition owner, including the
same physical ID, scope/table, codec and exact immutable specification. Reuse
that single qualification in root registration and the existing canonical key
cache, keyed by physical definition identity with a genuine qualified handle.
A conflicting definition must fail at its existing read boundary, not overwrite
or silently miss. This replaces the cache's object-key representation; it adds
no alias collection, second payload ledger or competing fingerprint codec.

## Actual reader closure and retained algorithms

The ordered delta must reach finite Application `runIndexedQuery` and native
bounded indexed pages with residual predicates. Native `withAccessCandidates`
complete-membership reads consume the shared root's current rows and may reuse
its valid per-row keys through the native interpretation owner. Keep actual snapshot capture, selected
body reads, per-consumer provenance, exact dependencies, error mapping and
admission checks. Ordered lookup does not authorize native document disclosure
or replace predicate evaluation. Standalone native working sets without a
shared root retain their distinct current lifecycle; they are not implicitly
converted to Application OCC by this substep.
This delta covers ordinary current visible pending values at the admitted
snapshot. It does not replace historical retained-membership candidate APIs,
unique enforcement, search or vector mechanisms.

The implementation source pass established a more precise complete-native
boundary: `withAccessCandidates` returns every pending table row, including
sparse/out-of-index-bound rows. Its lower-key/mark-use phase is interleaved in row
order; later REAL/projection/inspection/charge phases precede residual filtering.
There was no global pending-key sort there. A global failing catch-up before
that phase, or tree-filtering its returned candidates, changes failure order.
Retain this native responsibility rather than call a tree and discard its result.

The bounded shared-key bridge is an optional interpretation callback at
`lowerLogicalCanonicalIndexKey`, after its canonical and retained-key guards,
before its existing retention and error mapping. It may reuse only a root-owned
key for the exact immutable physical specification, current canonical body,
creation time and covered accepted write. A miss uses the existing lowerer;
sparse null remains distinct from a miss. `lookupLogicalDocumentRootPendingKey`
returns `Result<Option<Key | null>, RootFailure>`: only `None` runs the existing
lowerer; `Some(null)` is a qualified sparse interpretation. Closed/foreign roots
or conflicting physical definitions remain failures, never cache misses. A
sparse key still retains its written identity and write/accounting obligations.
This lookup performs no global
catch-up, admission or broader validation. Thus an Application-warm tree cannot
skip native integrity/retention or expose another pending row's error early.
The complete native candidate loop and its required cost remain explicit.

Retain native side preflight before bounds/residual filtering. In particular,
bounded native pages run `checkRealDocuments` over all pending live candidates;
this can perform actual database REAL validation and has borrower-local verdict
ownership. A warm root index does not grant a new borrower that verdict. Existing
candidate projection checks and charges also keep their current order. Native
pending inspection counts and charges cover every pending table candidate where
the current owner requires it, including out-of-range rows; do not charge only
in-range tree entries or output rows. Root written-identity enumeration can
avoid key reconstruction while preserving those obligations. This means some
native validation/inspection work remains even when its index has no new writes.

Retain the current finite `N + S` compensation, or establish an equivalent
certified-prefix/refill proof before reducing it. `S` is the number of distinct
accepted written identities for the table, including deletions, sparse-index
values and base-absent insert/delete pairs; it is not the live BTree size.
Ordinary native bounded pages
already compare a logical result frontier with a committed membership witness;
preserve that obligation. With snapshot `1,2,3,4`, pending deletions of `1,2` and
an insert at `100`, an ordered delta must not expose `100` ahead of unseen `3,4`.
A tree alone does not prove a complete base prefix.

Keep 04A's logical lookahead dependency and returned-row point dependencies.
The continuation remains the last returned position. Membership lookahead and
pending rows do not expand committed query-cache coverage or require another
public document charge. Same-key body conflict protection must not be removed
without the separately required complete writer proof.

`privateReferencePage` is an explicit retained consumer. Its authenticated
binding/relevant value/allowed-ID projection precedes pending-key lowering. Keep
that order, its bounded committed-prefix refill, continuation validity,
inspection accounting and result disclosure. It may reuse root written-identity
enumeration only if that enumeration performs no key lowering or broader
admission and preserves existing encounter order and charges for all inspected
table writes. It must not activate ordinary catch-up as a side effect. A warm
broad index read and a cold private reference read must not produce different
hidden-row failures. Its current eligible-row rebuild/sort remains until a
future eligibility-preserving delta proof and connected native witness allow
removal; this is a named product obligation, not an unused fallback.

Remove the displaced shared-root finite `finitePoints` range scan, per-read
staged-key map and merged-array sort, and bounded native result sorts replaced
by ordered merging. Preserve the complete native interpretation/side-preflight
loop; it is not a displaced ordered-range implementation. Remove obsolete exports/helpers only after
checking their actual other consumers. Do not remove non-indexed table reads,
the retained private reference algorithm, standalone native paths or genuine
behavioral coverage merely because they also inspect pending rows.

## Lifecycle and runtime gates

The original root owns disposal. Freeze detaches its existing graph/original
evidence and revokes the root; private index mechanics are discarded, not
persisted as authority. Abort/close clears the delta, registry and cursors.
Hydrating an unchanged base row must not dirty an index. A late result must not
install anything after closure. Borrowed native failure continues to abort the
whole root. No new native replay, nested checkpoint or catchable rollback is
selected here. The parent slice still owns the actual nested Application
failure witness and guarantee decision. Any future write rollback must restore
or invalidate the delta and watermark with pending writes while preserving the
selected read evidence/accounting contract.

Required regressions exercise actual Application and ordinary native
consumers for insert/delete/key moves, same-key body updates, repaired invalid
intermediate keys, invalid latest keys outside bounds, repeated unchanged reads,
cross-writer changes, late borrowed registration, hydration, cascade writes,
retention refusal, canonical tampering and root/borrower close. Prove that a
failed catch-up installs no partial version. Keep private reference eligibility
and warm/cold behavior covered without replacing its retained algorithm.

Retain empty-range phantom, exact lookahead, base-prefix/refill, final
publication and native rollback-only witnesses on the affected PGlite and
ordinary-role Postgres lanes. Use the actual finite Worker path where the
consumer crosses that boundary; an actual DO mutation-host claim needs its own
host proof and is not established by the earlier DO query host or a unit helper.
This document owns the mechanism and required regression contracts. Executed
database/host checks, required reviews and cleanup belong in the scoped Git
record. No timing or scale acceptance follows from the bounded replacement.

## Executing owners and remaining boundary

`rootEvaluator` now owns the accepted transition, protected row/attempt views,
accepted written identities and incremental pending trees. `writePoint` and
native `recordAttempt` reach the same synchronous fold. `finiteRoot` registers
genuine prepared definitions and no longer exports `finitePoints`.
`runFiniteIndexedQueryEffect` consumes ordered current positions and captured
written-ID suppression with a linear merge, retaining the compensation bound
and 04A evidence. Native bounded pages consume the same ordered positions after
their required native side phases. Complete native selection retains its own
candidate ordering and uses the exact per-row canonical-key bridge.

`sameLocatedAppIndexDefinition` owns physical qualification across genuine
handles. The issuer retains owned immutable access/spec containers; root
registration and the canonical index cache reuse that single comparison. The
canonical cache stores one qualified record per physical definition, preserving
integrity, native error mapping and actual retention. Payload ownership is
separate from a current-body interpretation hint.

`LogicalDocumentRootLimitError` identifies actual local byte/identity exhaustion.
The journal failure owner preserves it; native owners retain their limit mapping
and cause. Private save/reverse access and causal-evidence fixtures use the
revised protected owner boundary. The native return-refusal witness reserves
new authoritative first-write metadata costs while keeping its original quota,
remaining-byte, accepted-attempt and full-Cause assertions.

The genuine finite driver scenario connects entry, operations, freeze and
publication. Additional owner scenarios cover callback failure/closure and
retention with real observations/definitions; those are owner proofs, not host
admission claims. A real catalog-bound, unactivated predicate variant exercises
key/null/key with live current rows and retained write identity/history. It
leaves the selected binding unchanged and does not add public Application
predicate admission, index readiness or a native hosting capability.

The retained private reference merge, native complete side phases and standalone
native profile remain explicit responsibilities. Standard still needs the 04C
preparation/grant/outcome cutover; old saved readsets are not repaired. This slice
does not implement mutation DO hosting, catchable nested rollback, out-of-order
saves/publication, fencing, replication or complete-request capacity. Detailed
validation and review receipts belong in the scoped Git record; these wider
goal gates remain open.
