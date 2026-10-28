# First slice: snapshot reader and operation-local coverage

Status: **Bounded Application operation-local replacement implemented; wider
portable snapshot/DO milestone open**. The [goal](../GOAL.md) remains active.
This note records scope and decisions; Git owns validation receipts.

Baseline checkpoint: Flarex `5f6b78b73425`; Convex
`84fbb0e70b4e857913673871cb847ad11a55f3d5`. Current Flarex sources were inspected
in the shared worktree, not assumed identical to HEAD. Inspect semantic overlap
with other work before each edit; dirty status alone does not establish ownership.
Do not claim a frozen whole-workload inventory from this bounded inspection.

## Three-way challenge

Independent current-core and pinned-Convex sub-agents first inspected their
owners and then exchanged challenges. Both independently confirmed the shared
page-cache finding below. The coordinator's dispositions are:

| Finding | Evidence and disposition |
| --- | --- |
| Three different cache paths were being blended in the starting proposal | [DatabaseIndexSnapshot::start_range_fetch, range_batch and DatabaseIndexSnapshotCache](../../../../../../crates/indexing/src/backend_in_memory_indexes.rs) distinguish selected resident indexes, operation-local coverage and shared page machinery. Translate the operation-local mechanism first; the broader DO cache milestone remains separate. |
| The pinned shared page reader does not serve cached pages | `IndexCacheReader::index_page` in the same file fetches and returns persistence data, compares an existing cached page, and invalidates/repopulates it only on mismatch. A cold miss does not populate through that method. Our source map and snapshot note are corrected. A shared-page fast-serving path would require its own divergence record and writer/publication proof before implementation. |
| Source/grant checks are separate from storage observations | [readApplicationQueryPoint, readApplicationQueryIndex and runLocatedRead](../../../../packages/persistence-postgres/src/application/applicationQuerySnapshot.ts) enforce lifecycle, checked reads, accounting and dependencies. Keep their current required checks on cache hits in this slice; memoization does not grant authority or extend history. Classify and replace obsolete current-head choreography separately with its actual writer proof. |
| Current read-only range dependencies are broad | `readIndex` records an `appTable` dependency. This is not exact mutation range OCC evidence, nor is broad invalidation by itself an unsoundness defect. Preserve the external read-only receipt until its consumers are migrated; do not claim that translating cache intervals also migrates the dependency protocol. |
| Current publication differs from the target DO chain | [advanceScopePublicationClock](../../../../packages/persistence-postgres/src/commit/publication/publication.ts) advances the PostgreSQL clock transactionally; framework publishers use that family. There is no equivalent app-lifetime write-log/cache invalidation chain demonstrated here. Retain current serialized publication for this bounded data-reader step; do not represent it as the new out-of-order save pipeline. |
| Native adapters cannot simply consume cached bodies | [LogicalDocumentReadTransaction](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/model.ts) and [participant admission](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission.ts) couple reads to checked transactions/source validation. Keep native paths with their owners until their profile-specific replacement is challenged. |
| Comments are not upstream race-test evidence | The inspected [index-cache shuttle file](../../../../../../crates/indexing/src/index_cache/shuttle_tests.rs) contains setup/helpers but no executable test scenarios. Author real scenario witnesses rather than claiming translated coverage from those comments. |

The selected first mechanism remains within accepted snapshot guarantees; it
does not activate a new shared-cache protocol. Required live checks may still
incur SQL, which must remain visible in complete-request measurements. Their
retention here is a staged migration, not acceptance of the old bottleneck as
the final engine.

## Current owner to replacement map

The real Application path starts at
[executePreparedSelectionQuery and ApplicationQueryRpcCapability](../../../../packages/standard-application-invocation/src/ApplicationQuerySystem.ts),
then the [Application query snapshot](../../../../packages/persistence-postgres/src/application/applicationQuerySnapshot.ts),
its checked reader, and the
[historical row](../../../../packages/persistence-postgres/src/storage/documents/appRows.ts)
and [historical index](../../../../packages/persistence-postgres/src/storage/indexes/appIndexEntries.ts)
owners.

**Current Application snapshot owner -> pinned DatabaseIndexSnapshotCache and
fixed-timestamp reader -> reuse historical SQL and outer lifecycle, adapt reader
injection, add private operation-local coverage -> real query and failure
witnesses -> remove the selected direct-fetch bypasses after caller migration.**

The cache belongs to one operation at one immutable snapshot. Point entries
distinguish unknown, absent and present; absence retains tombstone/no-revision
evidence as needed. Range entries retain ordered keys, bodies and only completed
coverage. Populate and validate bodies before declaring their consumed interval
complete. A limited page cannot mark the unconsumed suffix complete. A result
returned to a mutable consumer must not mutate canonical cached state.

SQL/session types stay behind the persistence reader. Public snapshot methods
retain logical-call and output accounting, exact closure/finalization behavior,
current identity and required authorization/history checks. Keep pending-state
ownership and mutation OCC distinct from this read-only receipt.

## Required witnesses

Use the existing
[Application query snapshot tests](../../../../packages/persistence-postgres/test/application/queries/snapshot.test.ts)
and genuine Application caller, preserving meaningful assertions while changing
setup for the replacement owner. Required scenarios include:

- Repeated point reads reuse data while preserving present, tombstone and no
  visible revision distinctions, authority checks and logical-call accounting.
- A page followed by a point read, a covered subrange, an empty completed range
  and an uncovered suffix return correct results without invented completeness.
- Lookahead, continuation, ordering/tie-breakers and fetched-body index-key
  validation agree with PostgreSQL at the same snapshot.
- Newer writes do not change the operation view; a cache never moves to a new
  timestamp or survives beyond its operation/history eligibility by accident.
- Revocation/activation classification, finalization, queued-read closure,
  cancellation and budget exhaustion remain observable on hits and misses.
- Owner and actual consumer regressions pass on PGlite and ordinary-role
  PostgreSQL for database claims. Pure cache tests alone do not prove integration.

No test or performance pass is claimed by this inspection. DO storage/restart,
app-lifetime shared-cache serving, native replay, a new builder and the new save
pipeline require their own connected implementation and proof.

## Before assigning runtime edits

1. Recheck shared-worktree overlap, the dirty historical-index reader contract
   and executing caller/fixture identities. Select exact owned paths and cleanup
   targets; the [supported-profile baseline](../baseline/README.md) records the
   goal inventory, while exact slice execution closure remains a gate.
2. Specify the minimal reader/cache contract, ordered interval representation
   and bounded resource accounting. Inspect the applicable Effect rules before
   implementation. Record any necessary structural mechanism difference in the
   [divergence directory](../divergences/README.md) before affected edits.
3. Give workers disjoint ownership and dependent handoffs. Resolve new semantic
   conflicts before the affected path proceeds; routine representation choices
   within accepted guarantees are the coordinator's responsibility.
4. Run required lint/typechecks, owner/consumer regressions and both read-only
   code reviewers. Migrate and remove the selected old path in the connected
   scope; report retained SQL work and the remaining larger milestone gates.

## First implementation contract

The baseline and paired source challenge select a portable ordered cache module
under the existing storage/index owner, followed by Application reader integration.
The [storage adaptation record](../divergences/operation-cache-storage.md) owns
the necessary TypeScript collection, tuple-bound and capacity differences.

- A private cache instance belongs to one immutable operation. Async lifetime,
  cancellation, admission and serialization remain with the existing Effect
  snapshot owner; the synchronous ordered storage component creates no service,
  database transaction, runner or RPC.
- Store ordered documents per index plus coalesced complete intervals. Lookup
  splits the requested interval into cached documents and missing ranges,
  retaining the pinned cap of three cached ranges before a remaining miss.
- Generic ordered keys and before/after cuts represent exact positions. The
  PostgreSQL adapter lowers encoded-key-only bounds into the same tuple order
  as (encodedKey,rowId). After a limited page ending at (k,r1), coverage ends
  after that position, never after all rows with encoded key k.
- Populate validated bodies before coverage. If capacity prevents retaining
  every required body, do not mark the whole interval complete. Cache capacity
  counts distinct retained bodies independently of logical-call/output budgets.
  Keep metadata bounded as well as canonical document bytes.
- The document-revision basis must come from the hydrated typed row, not index
  membership commitSeq. A nonindexed body update can leave that membership older.
- A gap between before(b) and after(b) is unknown b; it cannot be merged away.
  Repeated cache hits still run required authority/history/build checks and
  charge logical calls, result documents and semantic bytes.

The worker owns only the ordered module and pure scenario tests; the coordinator
owns dependency wiring, Application reader integration and connected database
tests. Runtime work is not complete until the real consumer uses the replacement,
the old direct-fetch bypasses are removed for that scope and required reviews pass.

## Installed snapshot-reader extension

The current-owner challenge traced historical reads through
`buildPreparedAppIndexSnapshotReadStatement` and the installed eight-argument
`fx_read_snapshot_index_page`, rather than the separate current-row SQL predicate
family. Exact cache misses require tuple cuts before the function's visibility
selection and LIMIT+1. Fetching extra rows and filtering them in an adapter would
retain unnecessary work and can misstate component continuation.

Extend the snapshot-only reader with explicit lower/upper full-position cuts,
including inclusion, while retaining existing whole-key bounds as intersections.
Normalize the existing exclusive `after` cursor through the same captured
position decoder. Define contradictory input combinations explicitly and fail
closed. New lower-before-position support must not be silently converted to an
exclusive after cursor, and upper-before-position must not exclude every row
sharing the encoded key.

The persistence worker owns the reader/compiler, shared installed SQL function,
finite-capture caller, installation/grant/fingerprint metadata, a new forward
migration and owner tests. Migrate every real function caller and remove the
displaced private signature. Preserve existing durable data; do not rewrite old
migrations or reset the database. Root owns Application integration and the
genuine shared PGlite/PostgreSQL query scenario. Existing dirty owner files must
be compared by semantic diff and preserved; observed EOL-only status is not
permission to overwrite future changes.

Required owner cases include lower/upper cuts inside duplicate encoded keys,
inclusive/exclusive tuple boundaries, tombstones at old snapshots, empty cuts,
limit/lookahead continuation and malformed cursor/boolean shapes. Verify actual
PostgreSQL plans, including repeated prepared execution, to ensure cutoffs
constrain storage before pagination. Current/native read families receive no new
advertised operation unless their executing paths are deliberately migrated.

## Implemented boundary and remaining work

[ApplicationQuerySnapshot](../../../../packages/persistence-postgres/src/application/applicationQuerySnapshot.ts)
owns one private cache per immutable query snapshot. Point/range reads compose
covered data and exact missing intervals, retaining current short checked
transactions, authority/history/build eligibility and logical/output budgets.
Both cold and cached requests pass the existing snapshot compiler before cache
lookup, so malformed bounds cannot become apparent absence. The historical
readers remain the miss path at the same timestamp; the selected unconditional
point/range fetches are displaced rather than retained as a parallel path.

[SnapshotIndexCache](../../../../packages/persistence-postgres/src/storage/indexes/snapshotIndexCache.ts)
owns ordered bodies, complete intervals and bounded capacity. The
[storage adaptation](../divergences/operation-cache-storage.md) records the
TypeScript collection/accounting and SQL tuple representation differences.
The installed reader and finite-capture binding share the replacement tuple-cut
compiler and twelve-argument function. Migration 0154 replaces the former private
signature through managed installation; old migrations remain immutable.

The genuine query scenario executes `ctx.db.get` and `ctx.db.queryIndexRange`
through the existing Worker RPC. Repeated hits avoid row/index data fetches;
they still perform the required authority work. This does not prove zero SQL,
zero RPC, a new DO host or complete-request performance.

The remaining milestone must extract the portable snapshot/read seam from
current checked-transaction choreography, establish required writer/publication
participation, compose the real Cloudflare owner and prove local storage recovery.
Shared-page serving needs its own justified divergence from the pinned shadow
reader before activation. Native Medusa/Payload pending-state and lifecycle paths
remain with their current owners until their connected replacement is challenged.
The new out-of-order save pipeline and replication are not implemented here;
replication remains deferred.
