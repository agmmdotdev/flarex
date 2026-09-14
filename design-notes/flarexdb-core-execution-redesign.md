# FlarexDB Core Execution Redesign

## Status And Authority

Status: owner-requested design and acceptance plan; runtime replacements,
benchmarks and activation are not implemented by this document. Source findings
identify costs and contention risks, not measured production bottlenecks.

The [accepted design](./flarex-db-accepted-design.md) and
[shared logical storage decision](./flarexdb-shared-logical-storage.md) retain
architecture authority. This note specifies the core execution correction within
that destination. The [core execution roadmap](../roadmaps/shared-transaction-core/10-core-execution-redesign.md)
owns implementation gates; [query and constraint acceptance](../roadmaps/shared-logical-storage/02-query-and-constraint-acceptance.md)
owns framework-facing semantic witnesses. These are complementary contracts,
not competing storage, transaction or workflow engines.

Keep PostgreSQL as the committed-data authority, native Application OCC, distinct
trusted framework execution profiles, singular physical settlement, and shared
publication/recovery. Redesign avoidable work at their existing owners. Do not
freeze Application-shaped internals merely to avoid changing their consumers.
Early-development breaking changes remain permitted under the accepted policy;
each implementation slice identifies exact affected APIs, formats, data and
removal obligations before changing them.

## Objective And Non-Goals

The objective is predictable core cost under a declared workload, not a claim
that a finite database can never become a bottleneck. A successful correction
reduces unnecessary serial SQL, hot coordination rows, repeated evidence work
and write amplification while preserving the complete admitted behavior.

This is not a replacement of PostgreSQL, a universal ORM/SQL parser, another
committer, automatic native OCC for all frameworks, or a switch to SERIALIZABLE
for every command. It does not authorize user SQL, arbitrary transaction
callbacks, field-level OCC, automatic schema migration, production routing,
a new journal placement, or a distributed commit service. Developer APIs and
advanced framework evolution retain their existing deferrals.

## Source Findings And Retained Assets

| Existing owner | Source observation | Design consequence |
| --- | --- | --- |
| [Point OCC](../packages/persistence-postgres/src/appRowPointOcc.ts), `validateAppRowPointOccV1` | Pure, I/O-free comparison distinguishes conflicts from invalid evidence, including missing and tombstone observations. | Retain its correctness contract. A scope clock advance alone is not a same-row conflict. Measure state collection and retries separately from comparison CPU. |
| [Materialization](../packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts), `loadPointCommitHeads` | Uses a bounded VALUES query for current-pointer/latest-revision evidence. | Preserve batching and integrity; do not misdescribe this path as one query per dependency. |
| Same owner, `materializeApplicationDocumentRows`, `writePointCommitDeveloperIndexActions`, `writePointCommitUniqueKeyActions` | Row, changed-index and unique actions still enter sequential per-action operations. | Make bounded set-based application an explicit core capability, not an adapter loop or concurrent promises on one connection. |
| Same owner, `lockPointCommitDeveloperIndexBuilds`, `lockPointCommitIntrinsicIndexBuilds` | Relevant build rows acquire update locks; enabled maintained indexes advance `coveredThroughCommitSeq` during ordinary commits. | Scope-clock changes alone may expose index-state contention. Lifecycle readiness and enabled-index maintenance need a replacement proof. |
| [Point commit owner](../packages/persistence-postgres/src/pointCommitTransaction.ts) and materialization | Authoritative validation and materialization use the locked clock; row/index revisions take a tentative commit sequence. | Sequence assignment constrains the critical-section design. Existing materialization cannot simply move before sequence allocation. |
| [Publisher](../packages/persistence-postgres/src/commitPublication/publication.ts) | Shared owner writes complete publication families, outcome and wake, then advances the clock; Application and adjacency facts are batched. | Retain one atomic publisher and existing batching. Publication batching is not proof that all row/index/unique application is batched. |
| [Physical session](../packages/persistence-postgres/src/physicalSession/postgres.ts) and [request recovery](../packages/persistence-postgres/src/relationalTransaction/requestRecovery.ts) | Acquisition, pending work, cancellation/quarantine and uncertain outcomes have explicit owners; framework uncertainty re-entry is recovery-only. | Preserve cleanup and decision provenance. Measure ordinary operation separately from exceptional cleanup/recovery. |
| [Journal](../packages/persistence-postgres/src/sessionJournalStore.ts) and [storage redesign](../roadmaps/shared-transaction-core/07-transactional-storage-redesign.md) | Native syscalls retain dependencies, working values, receipts and seal evidence. Several storage/receipt reductions already exist; coalescing has separate proof obligations. | Attribute journal cost across the request. Do not add this native cost model to every framework command or remove evidence without a replacement contract. |

Current canonical-byte row bodies, membership-transition index history, stable
unique ownership and commit-keyed wakes are assets, not work to repeat. Precise
implemented status remains in the storage record and executing consumers.
Legacy serving, private target kernels and proposed generic execution are
separate measurement subjects. Name the path actually invoked in every result.

## Responsibility Boundaries

| Responsibility | Intended owner and retained contract |
| --- | --- |
| Logical values, indexes and relationships | Existing protocol, schema and persistence owners supply typed scoped operations, comparison policies, constraints and bounded access paths. No framework-name dispatch or adapter-owned enforcement. |
| Execution | Native code uses exact snapshots and tracked dependencies outside long-lived SQL transactions. Trusted framework operations borrow an admitted transaction lifetime. Durable workflows use committed steps through existing execution owners. |
| Commit planning and application | Existing compiler/materializer owners derive the complete logical transition set and apply rows plus derived state, with current-state validation where required. |
| Publication and recovery | Existing physical owner and publisher atomically establish the commit, outcome and required facts/events/wake. Recovery never infers success from a written prefix. |

The shared layer supplies mechanisms; its consumers retain semantic policy.
Native-Link versus strong-reference behavior, exact decimal ordering, conditional
uniqueness and Payload Local API lifecycle remain governed by the query and
constraint contract. Fewer physical tables or common interfaces do not satisfy
those requirements by themselves.

## OCC And Dependency Collection

Preserve exact snapshot tokens, qualified absence, tombstones, returned-row
point dependencies, range/phantom dependencies, relation dependencies and pinned
history. Membership-only indexes still require correct document dependencies
when a returned record changes without moving its index key. Keep conflict,
stale authority, invalid evidence and resource refusal distinguishable.

The PostgreSQL transaction protects physical statements executed within it.
Native OCC also protects decisions made against earlier reads while user code
ran outside that transaction. Starting a SERIALIZABLE final transaction does
not validate those earlier reads on its own. Any reference or replacement must
retain explicit dependency validation or demonstrate an equivalent complete
execution model without holding a transaction over untrusted code.

Batch current-head and overlapping-change retrieval where semantics permit;
avoid decoding full document bodies solely to compare revisions. Reuse exact
read and plan evidence only within its authority and lifetime. Do not replace
precise dependencies with a table/scope version merely to simplify code: that
changes conflict granularity. Nor should row-level dependencies become
field-level dependencies without a separate semantic decision and witnesses.

Measure read-set size, range width, dependency age, overlap and retry count.
Independent-row commits can wait for publication without producing OCC
conflicts; report those separately. Hot-record contention is real work, while
conflicts from unnecessarily broad reads or coarse fences are optimization
candidates. Retain bounded fresh-attempt retries and an overall deadline.

## Enabled Indexes And Lifecycle Coordination

### Current Risk

Ordinary writes can lock the same index-build row and update its coverage even
when they modify disjoint records. Those locks are currently nested inside a
broader serialized commit path. Removing the scope lock alone may therefore
move contention rather than remove it. PostgreSQL row locks normally last until
the owning transaction ends; inspect every late waiter and shared metadata row,
not just the first acquired lock.

### Proposed Replacement Contract

Separate the lifecycle proof that an index became readable from ongoing
synchronous maintenance of an enabled index. Assess a protected activation
certificate or existing readiness/fence representation at the current owner,
not a second mutable index registry.

A replacement must establish all of the following: activation covers the
required baseline and concurrent changes; every admitted subsequent writer
maintains membership atomically; old snapshots remain answerable within the
retention contract; retirement/rebuild and schema/generation changes fence
stale users; and bypass, repair or corruption scenarios have explicit handling.
A cached boolean or a stored digest alone does not establish these facts.

Prefer an enabled-state path without an exclusive metadata-row update on every
ordinary commit when this proof permits it. Rare lifecycle transitions may need
exclusive protection while ordinary operations use a compatible fence. Specify
which actual fields and consumers change before selecting physical rows or lock
modes. Shared read protection on a row still conflicts with an update to that
same row; moving progress elsewhere must not create duplicated authority.

Preserve or deliberately replace `firstReadableCommitSeq`, coverage, build
frontiers, epoch/generation fences and validation restart semantics. Readers,
writers, builders, activation, recovery and compaction must change together.
An index becoming enabled is not permission to stop detecting incomplete
maintenance. The faster path must state its integrity threat model explicitly.

## Bounded Batch Materialization

Extend the existing trusted materializer to accept a complete bounded transition
set: base dependencies, final row state, changed index memberships, unique
releases/claims, relation changes and publication contributions. This is an
internal execution boundary, not a public mutation API or a second intent
format. Reuse the current logical planner and remove displaced per-action
assembly when the selected consumers migrate.

Coalesce final state while retaining attempted-operation/resource accounting,
write ownership and required event semantics. An insert-then-delete may leave
no final row but is not free work; a no-row successful mutation retains its
admitted outcome/publication contract. Do not introduce mid-batch commits.

Group compatible operations by physical family and operation shape. Bound each
statement by rows, parameters and encoded bytes; a row-count cap alone is not a
query-memory bound. Prefer set-based SQL with complete affected-key/ordinal
verification. A count of RETURNING rows alone cannot prove the expected set.
Handle duplicate inputs before lowering, and do not depend on unspecified
RETURNING order or physical row order to establish lock order.

Keep unique releases and claims ordered to preserve supported swaps and
conflicts; do not use blanket ON CONFLICT DO NOTHING to hide lost writes.
Validate conditional membership, null policy, prior ownership and hash-collision
evidence. Preserve idempotency identity, rollback-only nesting and complete
relation/publication evidence if any batch fails or is cancelled.

Already-enabled unchanged memberships and same-owner unique keys should not
be refreshed merely because a document body changed. Any remaining validation
cost must be visible. Point dependencies must still detect returned-body changes.
Statements should scale with bounded batches and distinct action categories
where safe, not automatically with every row times every index. This is a cost
target to measure, not a fixed statement count promised by this document.

## Commit Critical Section And Sequence Assignment

Keep a dense, authoritative scope-local commit stream under the accepted
contract. Rollback must not consume a published sequence. A PostgreSQL sequence
or independently allocated counter is not an equivalent committed-order proof.
One logical publisher does not require one process, a global actor or a global
mutex across all scopes.

The first native optimization retains authoritative validation and application
in the existing final SQL transaction while reducing its serial work:

```text
Before final commit exclusion
  authenticate immutable inputs and prepare pure plan structure
  coalesce logical changes and capture bounded immutable definitions

Inside final authoritative transaction and protected commit section
  check current authority, request identity, dependencies and readiness
  derive/recheck all decisions that depend on mutable state
  allocate the scope-local commit sequence
  apply bounded row/index/unique/relation batches
  publish complete outcome/facts/events/wake and settle
```

Preparing a candidate outside a lock does not validate it. Any prior-state plan
needs exact revalidation before application; dynamic checks cannot be hoisted
into an indefinitely cached prepared object. Never hold this transaction across
untrusted callbacks, external effects or workflow suspension.

Current rows and index revisions consume the assigned sequence, so this first
step does not claim that all DML moves outside the critical section. A later
concurrent framework/native application protocol must specify how tentative
rows, uniqueness, dependency validation and sequence identity become one atomic
outcome. Avoid adding a second transaction-ID-to-sequence authority by accident.

Inventory scope clocks, request identity, sessions/claims/leases, index lifecycle
state, business rows/keys, adjacency records, schema heads and maintenance locks.
The [runtime scalability protocol](../roadmaps/shared-transaction-core/09-runtime-scalability-redesign.md)
remains the starting cross-owner proposal. Refining the order is a coordinated
Application/CMS/commerce/control-plane change, not a Medusa-local patch. Include
implicit constraint locks and deletion of journal children in the inventory.

Do not run clock-first and row-first writers over shared resources without a
proved compatible order. For a selected publication-last protocol, do not acquire
new business locks or execute native callbacks after the sequencer. Audit any
remaining fixed metadata locks for inversions. Stronger isolation may produce
retries when shared rows change; it is not a substitute for this analysis.

Short serialized publication is an acceptable first target. Independent phases
may overlap while final publication remains ordered. Measure server lock hold
where observable and client acquisition-to-COMMIT-acknowledgement time separately,
not just time spent in the publisher. A delayed or lost acknowledgement does not
prove the database is still holding the lock.
Only investigate more complex sequencing/group commit after measured capacity
requires it and recovery/order proofs accompany the change.

## Physical Lifetime, Recovery And Execution Evidence

Preserve one checked-out transaction resource, cancellation fences, late-checkout
handling, quarantine/drain, rollback-only nesting and source-owned decision
provenance. Optimize the successful common path separately from the exceptional
path. A client-side timeout does not by itself prove database work stopped.
Connection reuse requires the owner's clean-settlement proof.

Keep three retry classes separate: a genuine OCC conflict may require fresh
native execution; a confirmed rolled-back physical transaction may permit an
explicitly replay-safe retry; an uncertain COMMIT requires authoritative outcome
reconciliation before any business execution is repeated. Preserve the original
failure and cleanup/recovery causes. Never replay arbitrary Payload hooks,
Medusa callbacks or external effects under a general retry wrapper.

Native journal cost is a separate phase from final validation and publication.
Evaluate coalesced base dependencies/final overlays, cumulative work counters,
an exact latest response receipt and authenticated seals at the existing journal
owner. Intermediate events and normalized children may be removed only when
independent verification, repeated writes, randomness/identity, loss of responses,
restart, takeover and pre-coalescing resource limits remain supported.

Evidence compaction and evidence relocation are separate decisions. Do not move
the journal to a Durable Object/facet, create a new codec or change the trust
boundary merely because serialization is expensive. Prepared immutable code or
plans may be shared; mutable native services and tenant-derived caches need
explicit tenant/schema/lifetime confinement. Cache hits never replace fresh
authority checks. Selected installation evidence cost remains distinct from
native journal evidence and from unrelated historical growth.

Retention follows real snapshot, dependency, recovery and delivery obligations.
Application history, commerce historical-read promises, outcomes, request-key
non-reuse, terminal markers and event delivery do not share one automatic TTL.
Any reduction names the final reader and retirement condition. Budget cleanup,
backfills and hot tenants so they cannot monopolize the ordinary commit lane.

## Fair PostgreSQL Reference Benchmark

### Meaning Of The Comparison

Both candidates already use PostgreSQL. Compare the current Flarex core with a
small, isolated implementation of the same admitted operation using explicit
code/SQL on PostgreSQL. The reference is a diagnostic comparator, not a second
production engine, supported API, fallback, or proof of the theoretical minimum.
It does not change the accepted generic-storage destination.

A lone UPDATE is not equivalent to a mutation that validates earlier reads,
maintains indexes/constraints, publishes durable facts and stores a replayable
result. An intentionally cheaper SQL microbenchmark can be useful, but label it
as a partial operation and never report its ratio as full Flarex overhead.

Use two clearly separated comparison questions when needed. A matched physical
layout and equivalent SQL work isolate orchestration/call overhead. A typed
relational representation with equivalent observable guarantees examines the
cost of generic placement itself; its difference includes representation and
indexing tradeoffs, not just Flarex wrapper overhead. Test-only relational DDL
is not permission to restore per-shop production tables or a runtime fallback.

### Equivalence Checklist

| Dimension | Required matched behavior or explicit scope limitation |
| --- | --- |
| Reads and decisions | Same snapshot/visibility and read-your-writes contract; protect earlier native reads and phantoms, not just the final UPDATE. Preserve any deliberately conservative conflict behavior being compared. |
| Constraints | Same scoped identity, data types, null/collation/decimal semantics, uniqueness and relationship policies; preserve required error outcomes and atomic rollback. |
| Publication and replay | Same required commit order, facts, result identity/non-reuse, event intent and wake; lost-acknowledgement resolution and duplicate requests do not repeat business work. |
| Authority and lifetime | Same selected tenant/generation/write authority checks, admitted resource bounds and cancellation/recovery behavior. A storage-only benchmark moves these outside both timed boundaries and cannot claim whole-request equivalence. |
| Data and execution | Same starting dataset, logical query, affected rows, selected fields, effective time, successful results and expected conflict/refusal cases. No silent workload reduction in one candidate. |
| Durability and infrastructure | Same PostgreSQL release/configuration, durability/replication policy, hardware, region/transport, driver, pooling, concurrency, cache preparation and maintenance conditions for the comparison in question. |

The reference may reuse audited pure codecs/validators where that avoids
inventing inconsistent semantics. Report shared code and all timed boundaries;
a shared expensive helper remains a cost in both candidates, not proof it is
optimal. Do not replace actual correctness checks with unconditional fixture
success. Before timing, run the same relevant failure/concurrency assertions
against both candidates. An unsupported reference capability is a comparison
limitation, not permission to drop the corresponding Flarex guarantee.

Keep direct-Postgres Node measurements separate from deployed Worker/Hyperdrive
measurements. Likewise, private core entry points, actual current serving and
framework Local API/service entry points are different layers. Invoke real core
owners in the core lane; an invented test implementation is only the reference.

### Workloads And Attribution

Begin with no-row mutation versus read as distinct cases, point read/update,
bounded multi-row changes, unchanged-key versus moving-key updates, unique swaps,
range/relationship dependencies and failure/replay. Vary row width, affected
rows, index count, read-set size, dependency age, number of scopes and skew.
Include different records sharing an enabled index, hot unique keys, lifecycle
transitions, and mixed Application/CMS/commerce writers as their paths migrate.

Measure end-to-end latency and throughput with errors/retries, plus acquisition,
preparation, journal, authority/readiness, dependency loading, validation,
materialization, lock wait/hold, publication, COMMIT and cleanup. Count all SQL,
not just observed adapter calls. Record processed/returned rows, parameters,
transported bytes, CPU, allocation/peak memory, buffers, WAL and retained storage.
Distinguish logical rows, physical row versions, index maintenance and delivery
multiplicity. Bound telemetry and never record secrets or raw tenant payloads.

Use normal query plans with representative statistics; EXPLAIN diagnostics are
separate from normal-request timings. EXPLAIN ANALYZE executes the statement.
An UPDATE followed by ROLLBACK can diagnose its query plan, but it does not
measure durable COMMIT or publication throughput. Measure real commits on owned
disposable data for that claim and clean up only those resources.

Predeclare targets, sample/warm-up policy and the allowed safety/cost tradeoffs.
Alternate comparable trials and report dispersion and sample counts; do not
subtract independent p95 values and call the difference one component's time.
Any latency delta can include CPU, SQL, locks, network and scheduling. Under
load, report queue growth/timeouts and offered versus completed work so that
backpressure is not mistaken for unlimited throughput. PGlite is a fast semantic
lane, not evidence of PostgreSQL lock contention or deployed performance.

## Replacement And Completion Rules

| Mechanism | Disposition and proof required |
| --- | --- |
| Native snapshots/OCC and outcome authority | Retain semantic guarantees; optimize collection/application without replacing them by a bare final SQL transaction. |
| Bounded head reads, membership-only history, stable unique ownership and shared publication | Reuse; do not reimplement already completed reductions or reintroduce body/index duplication. |
| Per-action materialization | Replace for named consumers through verified batches; delete the displaced loops after exact mutation/failure coverage. |
| Per-commit enabled-index coverage locks/updates | Proposed coordinated replacement only after lifecycle, current/historical reads, integrity and compaction proofs; never delete the checks in isolation. |
| Broad commit exclusion | First shrink measured work; later change the cross-owner protocol with correct sequence assignment and no mixed-order fallback. |
| Journal/phase evidence | Conditional coalescing after attribution and independent authentication/recovery proof; no automatic relocation or second journal. |
| PostgreSQL reference | Isolated benchmark/test owner with explicit equivalence, provenance and retention; never imported by production dispatch. |

Each runtime gate includes source-backed proposed breaks, actual consumer
migration, proportional tests, required code review and obsolete-path removal.
Do not delete another task's database or assume named durable data is disposable.
No new gate is complete because it has been documented; numerical performance
claims require reproducible evidence at the measured layer.

## Primary References

Repository links above identify current owners and must be rechecked before
implementation. The [native OCC roadmap](../roadmaps/flarexdb-foundation/02-occ-and-transactions.md)
and [commit compiler roadmap](../roadmaps/flarexdb-foundation/03-commit-compiler.md)
own dependency/retry contracts and existing validation issues. The
[transactional storage redesign](../roadmaps/shared-transaction-core/07-transactional-storage-redesign.md)
owns earlier representation reductions; source counts and its isolated storage
experiment are not complete-request benchmarks.

[PostgreSQL 18 locking](https://www.postgresql.org/docs/18/explicit-locking.html)
specifies row-lock lifetime and ordering concerns.
[PostgreSQL 18 isolation](https://www.postgresql.org/docs/18/transaction-iso.html)
specifies snapshots, serialization retries and nontransactional sequence behavior.
[PostgreSQL EXPLAIN](https://www.postgresql.org/docs/18/sql-explain.html)
and [plan interpretation](https://www.postgresql.org/docs/18/using-explain.html)
explain diagnostic scope and side effects. The actual server version and
configuration must be recorded by each benchmark; these references do not
assert a deployed version or upgrade a dependency.
