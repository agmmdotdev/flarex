# Engine open questions

Status: **Open design queue; no implementation authorization**. This is the
canonical list of unresolved engine questions. [DECISIONS.md](./DECISIONS.md)
owns accepted/proposed status; [REFACTOR.md](./REFACTOR.md) owns the accepted
existing-core migration direction. Focused notes explain the current candidate
without maintaining another independent question list.

Only **concept 01: ownership and lifetime** is active. Discuss Q01 and Q02
together as one ownership/acceptance contract, using a successful cart update,
two conflicting replicas and a crash during commit. Other questions are queued
dependencies; surface a dependency when needed without silently accepting its
answer. After a decision or explicit deferral, update this queue and the register
and choose the next concept. Completed answers link to their owning decision;
they do not remain contradictory open instructions.

All Convex links below use the [recorded source pin](../REFERENCES.md#convex-source-identity),
not an implicit moving upstream revision. Source inspection is evidence for a
mechanism, not performance parity or permission to copy licensed implementation.

## Q01 - Scope ownership and routing

**Active, concept 01.** What does one execution owner represent: app, shop,
installation or a smaller partition? Which operations are atomic within it,
how do all relevant writers participate, and how are stale owners fenced?
Define owner identity, epoch, routing, acquisition/loss and cross-owner behavior.
An app/shop name alone is not an atomicity contract.

References: [ownership concept](./01-ownership-and-lifetime.md), Convex
[database bootstrap](../../../../../crates/database/src/database.rs) and
[PostgreSQL lease](../../../../../crates/postgres/src/lib.rs), plus the
[DO candidate](./01-do-execution-and-replicas.md#proposed-initial-placement).
Required examples: concurrent owners, takeover after loss, a stale writer and
an operation spanning the proposed partition boundary.

## Q02 - Validation, commit ordering and recovery

**Active dependency of concept 01; detailed concept 06 remains queued.** Where
does the accepting path run, and which PostgreSQL interlock makes validation and
durable acceptance safe? How do accepted pending writes participate before
publication? Can we retain or shorten the current scalar-clock critical section,
or does a different order require a new contract? Specify durable identity,
unknown outcomes, commit acknowledgement and restart reconciliation.

References: Convex [committer](../../../../../crates/database/src/committer.rs),
[write log](../../../../../crates/database/src/write_log.rs) and
[mutation retry](../../../../../crates/application/src/application_function_runner/mod.rs);
Flarex [publication](../../../packages/persistence-postgres/src/frameworks/commerceTransaction/publication.ts)
and [point commit owner](../../../packages/persistence-postgres/src/commit/point/README.md).
Required examples: two proposals passing concurrently, failure before/after
PostgreSQL commit, cache publication loss and redelivery of a committed request.

## Q03 - Snapshots, authorization and read-only freshness

**Queued, concept 02.** What authorized view can a root read, how long is it
retained, and what proves its cached data matches that view? Separate snapshot
validity, current authorization, readiness and required client freshness.
Define query responses and early errors that never reach final commit, pinned
versions across awaits and read-after-write behavior. A progress cursor or cached
permission boolean cannot stand in for the whole contract.

References: Convex [snapshot manager](../../../../../crates/database/src/snapshot_manager.rs),
[database read timestamps](../../../../../crates/database/src/database.rs);
Flarex [participant admission](../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission.ts)
and [current read profiles](../DESIGN.md#execution-profiles).
Required examples: revocation during a read, newer cache rows in an older attempt,
history expiry, stale early refusal and replica lag after a successful mutation.

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
Do not infer a complete result from an incomplete local index.

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

**Queued, concept 08; placement sketch remains proposed.** What runs inside the
DO, routing Worker and untrusted sandbox? Bound CPU, queues, memory, synchronous
SQLite work and resource lifetimes. How do the executing Medusa/Payload branches
bundle and behave in that host? If one scope saturates, compare read replicas,
write-executing replicas and partitioning using actual traffic and semantics.

References: [portable boundary](./01-ownership-and-lifetime.md#accepted-portable-core-and-adapter-boundary),
Convex [production runtime](../../../../../crates/runtime/src/prod.rs),
Flarex [Worker request lifecycle](../../../apps/executor/src/requestLifecycle.ts),
[Medusa](../../../roadmaps/flarexdb-framework-integration/06-medusa-adoption.md)
and [Payload](../../../roadmaps/flarexdb-framework-integration/07-payload-adoption.md)
hosting gates, and [DO execution rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).
Required examples: cold start, eviction, long synchronous work, cancellation,
late callbacks and mixed busy-shop traffic. No throughput follows from a host name.

## Q09 - Change delivery, replica eligibility and reactivity

**Queued across concepts 04, 06 and 09.** How are committed changes replayed into
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
