# Engine open questions

Status: **Open design queue; no implementation authorization**. This is the
canonical list of unresolved engine questions. [DECISIONS.md](./DECISIONS.md)
owns accepted/proposed status; [REFACTOR.md](./REFACTOR.md) owns the accepted
existing-core migration direction. Focused notes explain the current candidate
without maintaining another independent question list.

Only **concept 02: snapshot lifetime** is the active discussion focus. App
ownership, coordinator placement, out-of-order saves with ordered normal
publication, and uncertainty recovery are [accepted](./01-commit-coordination.md). The
[timestamped-snapshot contract](./02-timestamped-snapshots.md) now answers the
published-read-view question. Q01/Q02 remain partially open because their
implementation protocols are not fully specified. Snapshot lifetime is next;
other questions are queued dependencies, not silently accepted answers.
Replication is **open and explicitly deferred**; single-owner fencing/recovery
is still required. Record a
decision or explicit deferral before moving to the next concept.

All Convex links below use the [recorded source pin](../REFERENCES.md#convex-source-identity),
not an implicit moving upstream revision. Source inspection is evidence for a
mechanism, not performance parity or permission to copy licensed implementation.

## Q01 - Scope ownership and routing

**Partially answered, concept 01.** Accepted: one independent app has one logical
owner; Medusa/Payload/Application share its data and coordination, with distinct
domain permissions and execution profiles. A shop was only an example. See the
[app boundary](./01-commit-coordination.md#app-boundary-and-placement).

Still open: concrete app/installation identity mapping, routing, ownership
generation, acquisition/loss and PostgreSQL fencing; participation by every
relevant writer and handling of commands crossing app boundaries. Sharing an
owner does not make independent calls atomic. These are single-owner correctness
questions, not a request to design execution replication now.

References: [ownership concept](./01-ownership-and-lifetime.md), Convex
[database bootstrap](../../../../../crates/database/src/database.rs) and
[PostgreSQL lease](../../../../../crates/postgres/src/lib.rs), plus the
[DO candidate](./01-do-execution-and-replicas.md#proposed-initial-placement).
Required examples: old/new owners during takeover, loss, a stale writer and
an operation spanning the proposed partition boundary.

## Q02 - Validation, commit ordering and recovery

**Partially answered, concept 01.** Accepted: the app DO
hosts logical validation and commit coordination; PostgreSQL enforces durable
conditions and commits data/outcomes. Independent accepted saves may finish out
of order, with ordered normal publication/acknowledgement. On uncertainty: stop,
fence, reconcile every in-flight outcome, rebuild, resume. See the
[commit contract](./01-commit-coordination.md).

Still open: concrete publication representation, PostgreSQL interlock and ownership
fence, durable operation identity/retention, treatment of confirmed noncommitted
positions, late writes, pipeline bounds and recovery terminality. The current
scalar-clock implementation is replaceable; unchanged concurrent calls do not
implement this contract. Detailed concept 06 remains queued.

References: Convex [committer](../../../../../crates/database/src/committer.rs),
[write log](../../../../../crates/database/src/write_log.rs) and
[mutation retry](../../../../../crates/application/src/application_function_runner/mod.rs);
Flarex [publication](../../../packages/persistence-postgres/src/frameworks/commerceTransaction/publication.ts)
and [point commit owner](../../../packages/persistence-postgres/src/commit/point/README.md).
Required examples: two proposals passing concurrently, failure before/after
PostgreSQL commit, cache publication loss and redelivery of a committed request.

### Answered: published read view

Accepted: pin each admitted operation to a safe published timestamp and carry it
through RAM/SQLite hits and PostgreSQL misses. Explicit versioned document,
index and deletion history supplies the older view; a cache without a valid
answer misses. Saved B remains hidden while its position is unpublished. A running
operation keeps its timestamp when publication advances. The highest saved
sequence alone is not safe, and unavailable history never permits latest-row
fallback. The [focused decision](./02-timestamped-snapshots.md) owns the cart
example, pinned Convex source and remaining representation/proof boundaries.

## Q03 - Snapshots, authorization and read-only freshness

**Partially answered; active concept 02.** The fixed-timestamp read contract is
[accepted](./02-timestamped-snapshots.md). Snapshot lifetime is the next narrow
decision. Still open: native profile mapping, client freshness tokens, retention
budgets and expiry handling, current authorization/readiness, and disclosure or
early errors that never reach final commit. A progress cursor or cached permission
boolean cannot stand in for the whole contract. A complete native workflow is not
automatically one atomic snapshot.

References: Convex [snapshot manager](../../../../../crates/database/src/snapshot_manager.rs),
[database read timestamps](../../../../../crates/database/src/database.rs);
Flarex [participant admission](../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission.ts)
and [current read profiles](../DESIGN.md#execution-profiles).
Required examples: revocation during a read, newer cache rows in an older attempt,
history expiry, stale early refusal and read-after-write following success.
Replica lag remains deferred with replication.

### Next question: snapshot lifetime

**How long may an operation keep its timestamp, and what happens if the required
history expires before it finishes?** Decide the lifetime/resource contract and
eligible restart versus explicit failure. Keeping history for every unfinished
operation can grow storage; bounding history can interrupt a slow operation.
Do not select a numeric limit or automatic native retry without evidence.

Use one cart read pinned at `100` that pauses while newer commits publish.
When it resumes, distinguish an ordinary local cache miss (PostgreSQL can still
answer at `100`) from expired authoritative history (the operation cannot continue
at `100`). Consider native hooks and effects when deciding whether restart is safe.
Compare Convex [snapshot retention](../../../../../crates/database/src/snapshot_manager.rs),
[retention validation](../../../../../crates/database/src/retention.rs),
[persistence snapshots](../../../../../crates/common/src/persistence.rs) and
[root retry ownership](../../../../../crates/application/src/application_function_runner/mod.rs).
Local cache representation remains Q05; concrete fencing remains Q01/Q02.

## Q04 - Values, IDs and ordered representations

**Queued, concept 03.** Which value, ordering, timestamp and identity semantics
must remain equivalent, and what TypeScript/SQLite representations provide them?
Choose structures by required operations and budgets. Neither a Rust type name
nor a JavaScript Map proves ordered or persistent behavior. Identify supported
library reuse and any intentional public or durable-format break.

References: [Convex source map](../REFERENCES.md#convex-source-identity),
[selected in-memory indexes](../../../../../crates/indexing/src/backend_in_memory_indexes.rs),
[existing Application contracts](../APPLICATION.md) and
[ordered-query requirements](../DESIGN.md#complete-query-operations).
Required examples: boundary values, stable ordering/tie-breakers, historical
versions and encoding comparisons across PostgreSQL and local cache execution.

## Q05 - Local rows, indexes and cache coverage

**Queued, concept 04.** Which data lives in RAM, DO SQLite and PostgreSQL? Is the
cache partial or complete for a declared range, and how are misses, absence,
counts and pagination proved? Decide warming, copying, version retention,
eviction and query lowering, including PostgreSQL-dependent predicates.
Do not infer a complete result from an incomplete local index. The accepted
[timestamped-read contract](./02-timestamped-snapshots.md) constrains these choices:
retain an eligible historical answer locally or miss to PostgreSQL at the same
timestamp. It does not select local version retention or a cache data structure.

References: Convex [index cache](../../../../../crates/indexing/src/index_cache/mod.rs)
and [in-memory indexes](../../../../../crates/indexing/src/backend_in_memory_indexes.rs);
Flarex [working-set model](../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/model.ts);
Cloudflare [instance memory](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/)
and [SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
Required examples: incomplete ranges, inserted/deleted members, cold reads,
cache updates during an attempt and equivalent native count/population results.

## Q06 - Pending state, framework visibility and replay

**Queued, concept 05.** Which state belongs to a private attempt versus a shared
committed cache? Which native commands may execute speculatively and which may
rerun? Preserve actual visibility, nested calls, rollback-only failure, hook
ordering, events and workflow compensation. Specify framework conflict behavior
before enabling automatic replay. Updating the cache does not salvage an old
pending-write proposal; an eligible retry recomputes the whole operation.

References: Convex [reads](../../../../../crates/database/src/reads.rs),
[writes](../../../../../crates/database/src/writes.rs) and
[mutation rules](https://docs.convex.dev/functions/mutation-functions);
[experimental direct-command baseline](../DESIGN.md#direct-command-contract-for-the-first-candidate),
Medusa [repository context](../../../packages/medusa-adapter/src/repository/context.ts)
and Payload [native operations](../../../packages/payload-adapter/src/operations.ts).
Required examples: two add-one operations, phantom cart items, nested-hook failure,
one-time external effects and unknown-COMMIT recovery without native reexecution.

## Q07 - Schema, index lifecycle and retention

**Queued, concept 07.** How do schema activation, index builders, repair,
deletion, permission changes and history GC invalidate or fence cached state?
Which PostgreSQL layout is retained or replaced, and what data migration/reset
disposition is required? Do not freeze the old schema to preserve unshipped APIs.

References: Convex [schema registry](../../../../../crates/database/src/schema_registry.rs),
[index registry](../../../../../crates/indexing/src/index_registry.rs) and
[retention](../../../../../crates/database/src/retention.rs);
[shared logical storage](../../../design-notes/flarexdb-shared-logical-storage.md)
and [invalidating-writer baseline](../DESIGN.md#identity-and-invalidating-writers).
Required examples: activation during reads, missing feed history, repair writes,
expired pinned views and safe cleanup after consumer/data cutover.

## Q08 - Host adapters, scheduling and hot-shop scaling

**Queued, concept 08; app coordinator placement accepted.** What remaining
framework/host capabilities run in the DO, routing Worker and untrusted sandbox?
Bound CPU, queues, memory, synchronous
SQLite work and resource lifetimes. How do the executing Medusa/Payload branches
bundle and behave in that host? Replication/partitioning comparisons remain open
and explicitly deferred until the owner reopens that discussion.

References: [portable boundary](./01-ownership-and-lifetime.md#accepted-portable-core-and-adapter-boundary),
Convex [production runtime](../../../../../crates/runtime/src/prod.rs),
Flarex [Worker request lifecycle](../../../apps/executor/src/requestLifecycle.ts),
[Medusa](../../../roadmaps/flarexdb-framework-integration/06-medusa-adoption.md)
and [Payload](../../../roadmaps/flarexdb-framework-integration/07-payload-adoption.md)
hosting gates, and [DO execution rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).
Required examples: cold start, eviction, long synchronous work, cancellation,
late callbacks and mixed busy-shop traffic. No throughput follows from a host name.

## Q09 - Change delivery, replica eligibility and reactivity

**Queued across concepts 04, 06 and 09; replication explicitly deferred.** Single-owner
cache reconstruction and ordered visibility remain current correctness obligations.
For a later replica design: how are committed changes replayed into
each cache, how are gaps detected, and when may a replica serve a given view?
Choose push, invalidation, on-demand fetch or a bounded combination. Define
resnapshot, deletion/range updates, local progress and publication ordering.
Cache replication and client subscriptions may consume the same durable facts
without becoming the same authority or lifecycle.

References: Convex [commit publication](../../../../../crates/database/src/committer.rs),
[cached write application](../../../../../crates/indexing/src/index_cache/mod.rs),
[Flarex query-sync design](../../../design-notes/runtime-agnostic-query-sync-engine.md)
and the [replica cart example](./01-do-execution-and-replicas.md#cart-example-and-the-proposed-replica-path).
Required examples: missed/reordered wakeups, partial local application, restart
with an old cursor, retention gaps and reads during another replica's commit.

## Q10 - Connected replacement, performance and retirement

**Queued, concept 10.** Which complete native consumers prove the first owner
replacement, what old work disappears, and what remains? Select implementation
scope only after its dependencies are decided. Define measurements and stop or
redesign criteria before expanding coverage. Plan caller migration and deletion
of the displaced paths rather than a permanent parallel engine.

References: [refactor direction and source seams](./REFACTOR.md),
[modular replacement gates](../MODULES.md#proving-replaceability-before-expanding-coverage),
[validation](../VALIDATION.md), [historical results](../RESULTS.md), and the
[performance owner](../../../roadmaps/core-performance/README.md).
Required evidence: same real business graph, both database lanes, actual host
proof, warm/cold/contended traces, CPU and tail latency, cache/retry costs, explicit
data disposition and no obsolete compatibility route after the selected cutover.
