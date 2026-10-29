# Application mutation pending state and read evidence

Status: **Independent source challenge and peer exchange complete; range-evidence
producer contract selected; broader pending replacement and stored-profile
cutover remain open**. No runtime implementation is established by this note.
The [goal](../GOAL.md) remains unchanged. The bounded
[actual DO query host](./03-application-query-do-host.md) is implemented.

Initial source checkpoint: Flarex `a1ec642f772fc5a8fd93cf8b8aa033b0b97cdae2`,
rechecked at `526182cf05c6f42a0aa874a12db31d80a7a9134c`; Convex
`84fbb0e70b4e857913673871cb847ad11a55f3d5`. These are source findings, not new
database, timing or upstream-test evidence.

## Independent challenge and convergence

The current-owner, pinned-Convex and accepted-direction agents first formed
independent findings, then exchanged evidence and challenged their conclusions.

| Current responsibility | Pinned mechanism and selected investigation |
| --- | --- |
| Standard `ApplicationMutationSystem` constructs the durable journal; activation without an explicit profile selects `durableOperations`. | The replacement must reach this actual consumer. A finite-only helper change would miss the ordinary mutation path. |
| Durable point operations prefer staged live/deleted state, preserve original observations and reread unchanged base rows. | Convex separates the admitted snapshot, original base writes and private pending state. Reuse qualified readers and dependencies; investigate replacing repeated reads and per-syscall temporary persistence. |
| Current range evaluation overfetches by the staged-row count, suppresses all staged base identities, merges pending keys and sorts. | Preserve deletion/key-move refill correctness. An incremental index overlay needs a certified base-prefix or equivalent overfetch proof. |
| Finite roots already use the logical document root evaluator; borrowed native operations share it. | Reuse/adapt that owner rather than add a parallel generic pending map. Preserve distinct native lifecycle and replay contracts. |
| Current final acceptance owns fresh authority/OCC checks, outcome resolution and atomic PostgreSQL publication. | Keep these owners in a pending-only replacement. Accepted-but-unpublished reservations and out-of-order saves belong to the later commit pipeline. |

Executing Flarex owners include
[`ApplicationMutationSystem`](../../../../packages/standard-application-invocation/src/ApplicationMutationSystem.ts),
[`pointOperations`](../../../../packages/persistence-postgres/src/execution/journal/pointOperations.ts),
[`indexedQueries`](../../../../packages/persistence-postgres/src/execution/journal/indexedQueries.ts),
the [root evaluator](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/rootEvaluator.ts)
and [durable publication](../../../../packages/persistence-postgres/src/commit/point/durablePublication.ts).
The admitted Worker surface is point CRUD and bounded ascending
`queryIndexRange`; exported count/filter/descending/relation helpers do not prove
those Worker capabilities are enabled.

## Pinned mechanism and important limits

Convex's real JS `db.get` and range path reaches `TransactionIndex::range_batch`
through `DeveloperQuery`. Patch/replace/delete also use singleton
`Transaction::get_inner` reads. The private index delta maps physical index IDs
and complete encoded keys to live packed documents or explicit tombstones.
Equal keys replace base state; tombstones suppress it.

[`transaction_index.rs`](../../../../../../crates/database/src/transaction_index.rs),
[`query/index_range.rs`](../../../../../../crates/database/src/query/index_range.rs),
[`reads.rs`](../../../../../../crates/database/src/reads.rs) and
[`writes.rs`](../../../../../../crates/database/src/writes.rs) are the primary
owners to inspect at the pin. Logical consumption establishes range evidence;
physical cache coverage is not the read set. Document accounting is separate.
Same-key body changes still conflict because applicable index writers report
both old and new keys even when equal. Replacing Flarex's extra returned-row
point evidence therefore requires proving that complete writer closure first.

A source-inferred partial-page risk must be challenged before translation:
snapshot keys `1,2,3,4,...`, base fetch size `2`, pending deletes of `1,2` and an
insert at `100`. Merging all pending keys against only `[1,2]` can expose `100`
while retaining a continuation after `2`, before unseen `3,4`. The pin's fully
loaded in-memory path can hide this; ordinary indexes can also use partial
persistence pages. This is not an executed upstream bug report. Preserve the
current compensation bound or establish a certified-prefix/refill mechanism
with a failing witness before activation.

## Exact page completion is part of the current result

Flarex computes `isDone` using N+1 membership and exposes it to the Worker. For
snapshot `[A,B]`, limit `1` returns `[A], false`. Source inspection finds its
retained interval can stop at `A`, with point evidence only for selected rows.
A concurrent deletion/key move of `B` can change that exact verdict outside the
retained evidence. Preserve a failing owner-level witness and correct the real
evidence producer; this finding is not runtime reproduced yet.

The pinned Convex paginator stops at page size and can conservatively return
false on a full final page. Its consumed-prefix rule does not establish
Flarex's N+1 verdict. Preserve the current observable result with sufficient
lookahead evidence; changing that API guarantee requires a separate decision.
Physical overfetch and dependency evidence do not automatically charge another
user-visible document.

## Candidate connected replacement and retained guarantees

The candidate responsibility is one real Application mutation attempt's private
pending evaluation, exact read-set production, immutable freeze/handoff and the
existing acceptance consumer, including nested borrowing. It is not a new cache
interface or an adapter wrapping the old choreography unchanged.

Preserve one admitted snapshot and deadline; original base observations;
present/missing/tombstone distinctions; pending key order and refill; generated-ID
history checks; metadata/index/permission evidence; logical accounting and exact
replay; closed-capability refusal; full failure Causes; and authoritative
unknown-COMMIT reconciliation. Failed nested calls retain the required reads and
read accounting while restoring their pending writes where that Application
failure is catchable. Sticky terminal and rollback-only cases remain terminal.
Do not introduce native
hook replay, extra finalizers, a universal transaction profile or a database
transaction across user execution/effects.

Shared mutation-cache handoff is not enabled by the query cache slices. A local
base cache still needs complete overlay, snapshot/identity qualification,
writer participation and evidence proof. Read-only query receipts that currently
use conservative `appTable` dependencies are a separate migration.

## Required contract and data disposition before code

Record the exact new-root profile, existing root-evaluator reuse, writer closure,
dependency encoding/acceptance path and displaced code. Inventory stored session
formats and authoritative outcome identities. The audit did not establish named
live stored-session data, but that absence alone does not authorize deletion.
Choose a migration/retention/reset disposition before touching durable data.
Existing private fixtures do not independently establish permanent compatibility.

Required connected witnesses include phantom insertions into empty ranges;
pending insert/delete/key moves and refill; same-key body updates; lookahead
changes; historical generated-ID collisions; nested failure; replay accounting;
late asynchronous results; and uncertain outcomes. Reuse current point/range,
publication/concurrency and native Application contracts on both database lanes.
Both final reviews, removal of displaced paths and any required actual-host
proof remain implementation gates. Replication stays deferred.

## Connected implementation order

These substeps retain the complete pending-state milestone. A producer correction
or finite-only helper does not complete the real Standard cutover.

1. [Range completion evidence](./04a-range-completion-evidence.md): preserve the
   already fetched membership lookahead and retain sufficient logical OCC evidence
   for newly executed indexed operations. Keep returned-body point dependencies,
   current pagination results and accounting. Existing journal receipts are not
   repaired by replay; their cutover remains a separate required disposition.
2. Incremental pending indexes: adapt the existing shared root evaluator and
   both its Application and borrowed native write paths. Maintain per-index
   pending changes instead of relowering and sorting every staged table point on
   every range. Private pending state remains separate from committed query cache.
3. Actual Standard mutation cutover: route new requests through the shared
   evaluator, existing finite Worker runner, immutable freeze and publication
   owners. Remove displaced Standard durable-journal/seal/loader construction.
   Preserve authoritative outcomes and require explicit old-anchor disposition.

The existing finite preparation is not sufficient for the last step. Standard
accepts legacy selections and relation manifests V2/V3, public and authenticated
internal callbacks, while composite finite preparation currently assumes a
relation selection, V3 and empty relations. Preserve the already selected target
and visibility rather than preparing an unrelated active head. Retain genuine
activation repository identity and bounded host-preparation lifetime.

Required relation-integrity algorithms already reach finite publication, but
the Application metadata write-closure projection currently emits empty source,
extension and incoming relation evidence. Close its schema, relation binding,
semantic/edge and publication identity proof through the existing metadata
owners before removing that preparation gate. Adding a second edge engine or
merely deleting the refusal would not establish this guarantee.

Existing/busy activation must be handled before entering a new finite body.
Matching stored durable requests must not become fresh finite executions or false
request-key conflicts. Preserve authenticated retry tickets, full outcome
reconciliation and native non-replay rules. Retained old readers need a named
anchor obligation and removal gate; no durable-data deletion is selected here.
