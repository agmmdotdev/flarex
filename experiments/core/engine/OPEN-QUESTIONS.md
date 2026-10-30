# Engine open questions

Status: **Open design queue within the authorized refactor goal**. This is the
canonical list of unresolved engine questions. [DECISIONS.md](./DECISIONS.md)
owns accepted/proposed status; [REFACTOR.md](./REFACTOR.md) owns the accepted
existing-core migration direction. Focused notes explain the current candidate
without maintaining another independent question list.

The accepted target is [Convex core and physical-schema translation](./REFACTOR.md#core-and-physical-schema-translation-plan)
into the existing TypeScript core. DO/runtime constraints and required native
behavior are the divergence grounds. Remaining questions concern the concrete
mapping and guarantee/data dispositions, not whether old Flarex interfaces or
physical layouts must be preserved.

The first bounded [operation-local snapshot cache](./slices/01-snapshot-reads.md)
is implemented. The connected
[timestamped cache-transfer slice](./slices/02-timestamped-cache-transfer.md)
also implements bounded Application app-row handoff and refresh. The bounded
[actual-DO query host](./slices/03-application-query-do-host.md) implements genuine
local query composition and cold restart. Full app-owner bootstrap/recovery and
broader native integration remain open. The next
[mutation pending-state replacement](./slices/04-mutation-pending-state.md) has
completed independent source challenge. Range evidence, incremental shared-root
indexes, operation admission and exact original finite preparation are implemented.
The [ordinary Standard cutover](./slices/04c3-standard-finite-execution.md) remains
open. The [stored-attempt retirement policy](./05-stored-attempt-disposition.md) is
accepted; classification, reconciliation and retirement implementation remain gates.
The accepted [replacement workflow](./REFACTOR.md#convex-guided-replacement-workflow)
does not require this whole queue to be answered before a bounded slice can
start. An unresolved guarantee pauses the affected path, not independent work;
routine in-scope adaptation follows pinned source and accepted rules. App
ownership, coordinator placement, out-of-order saves with ordered normal
publication, and uncertainty recovery are [accepted](./01-commit-coordination.md). The
[timestamped-snapshot contract](./02-timestamped-snapshots.md) now answers the
published-read-view question. Demand population, relevant-write invalidation,
validated cache fills and bounded cache/history retention are accepted directions;
Convex's reference defaults are not selected engine settings. Q01/Q02 remain
partially open because their implementation protocols are not fully specified.
Snapshot ownership, inherited deadlines and phase-aware expiry/retry are now
[accepted](./02-operation-lifetime.md); numerical limits and native conformance
remain open. The [authorization split](./02-read-authorization.md) is accepted:
tracked snapshot permission reads and identity-aware result reuse, with separate
authentication and engine-grant revocation. [Read-after-write freshness](./02-read-after-write.md)
is accepted: latest-ready-owner reads, recovery gating, timestamped misses and
reactive-client timestamp synchronization. [Index readiness](./02-index-readiness.md)
is accepted: build, complete, then enable; required builds gate deployment and
queries reject unavailable indexes. Resumable backfill remains open. Remaining
concept-02 protocols and other questions stay open/queued, not silently completed.
Replication is **open and explicitly deferred**; single-owner fencing/recovery
is still required where the selected slice depends on it. Record the required
decisions in that slice; unrelated questions remain open without a forced
discussion or deferral. The [goal contract](./GOAL.md) authorizes bounded
implementation after the independent pre-slice challenge; an open question
does not supply its own answer or accept a new divergence.

All Convex links below use the [recorded source pin](../REFERENCES.md#convex-source-identity),
not an implicit moving upstream revision. Source inspection is evidence for a
mechanism, not performance parity.

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

**Partially answered; remaining protocols queued, concept 02.** The fixed-timestamp read contract,
bounded history and [operation-lifetime policy](./02-operation-lifetime.md) are
accepted, as are the [authorization direction](./02-read-authorization.md) and
[read-after-write policy](./02-read-after-write.md) and
[index-readiness direction](./02-index-readiness.md).
Still open: numerical deadline/history budgets, native branch conformance, exact
expiry errors and cancellation/acceptance interlocks, client timestamp encoding/protocol,
engine-grant enforcement/readiness mechanisms, and disclosure or early errors that never
reach final commit. A progress cursor or cached permission boolean cannot stand
in for the whole contract. A complete native workflow is not automatically one
atomic snapshot.

References: Convex [snapshot manager](../../../../../crates/database/src/snapshot_manager.rs),
[database read timestamps](../../../../../crates/database/src/database.rs);
Flarex [participant admission](../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission.ts)
and [current read profiles](../DESIGN.md#execution-profiles).
Required examples: revocation during a read, newer cache rows in an older attempt,
history expiry, stale early refusal and read-after-write following success.
Replica lag remains deferred with replication.

### Answered: snapshot ownership and expiry policy

Accepted: one bounded atomic operation owns a snapshot/deadline; participating
nested work shares them and the outer owner settles. Preserve actual native
transaction groups, with no snapshot held across remote effects or suspension.
Before acceptance, expiry closes the operation and prevents late acceptance.
Eligible pure queries and replay-safe Application mutations may restart as a
whole under bounded rules; automatic Medusa/Payload replay stays disabled until
whole-command proof. After acceptance or uncertain persistence, resolve the
durable outcome rather than treating expiry as permission to repeat work.

The [focused record](./02-operation-lifetime.md) owns the mapping, cart example,
pinned sources and failure witnesses. Numerical budgets and concrete interlocks
remain open, including distinctions between evicted cache data, missing change-log
proof and expired authoritative history. Reference defaults are not our settings.

### Answered: authorization for cached reads

Accepted: application permission records are tracked reads at the operation's
snapshot; result reuse accounts for relevant identity and complete dependencies.
Changes prevent reuse at newer snapshots containing those changes. An ordinary
permission-row update does not impose universal cancellation of an older running
query. Authentication and engine-grant revocation remain separate; the latter
retains its existing attempt-invalidating contract. Stronger disclosure rules
need a named supported requirement, not an inference from framework integration.

The [focused record](./02-read-authorization.md) owns the cart example, pinned
Convex mechanisms, Flarex differences and proof obligations. No runtime gates are
removed. Concrete grant freshness, disclosure/acceptance races and native
result-cache eligibility remain open; a dependency-aware cache does not prove them.

### Answered: read-after-write freshness

Accepted: new ordinary queries use the current ready owner's latest published
snapshot. A call after mutation success includes that mutation; an older running
query retains its own timestamp. During startup/uncertainty recovery, new ordinary
reads wait within a bounded deadline or fail explicitly until the owner reconstructs
a safe view. A ready owner can serve cold-cache misses from PostgreSQL at that
timestamp; complete cache warming is unnecessary.

The ordinary single-owner path does not require a separate timestamp-fetch request
or a client minimum-timestamp token on every call. Reactive-client direction:
carry commit/query-state timestamps, resolve successful mutation promises after
applied query-state progress, and reject backwards reconnect views. The
[focused record](./02-read-after-write.md) owns the pinned backend/client sources,
cart example, recovery adaptation and remaining protocol/proof gates. No SDK,
subscription or native replay capability is implemented by this decision.

### Answered: index readiness

Accepted for ordinary application database indexes: Backfilling, Backfilled and
Enabled are distinct states. Required non-staged builds gate deployment activation;
staged builds remain unavailable until a later enablement. A query explicitly
requiring an unavailable index fails rather than waiting, scanning implicitly or
reading partial results. Operations resolve readiness from their own versioned
metadata and retain the required dependency.

The [focused record](./02-index-readiness.md) owns the cart example, pinned source
and adaptation boundary. Enablement does not mean every index page is cached;
eligible misses still read PostgreSQL at the operation timestamp. Build checkpoints,
concurrent-write coverage, crash recovery and activation mechanics remain Q07;
local coverage remains Q05. No runtime change is authorized by this acceptance.

## Q04 - Values, IDs and ordered representations

The translation must map Convex value/key/timestamp semantics to the physical
Drizzle layout and local comparators together, including long-key handling,
ID tie-breakers and native exact-decimal extensions. Current encoded-key/row-ID
tuples and key-limit failures are mechanisms to challenge, not DO necessities.

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

The full snapshot/catalog/write-log owner and its PostgreSQL miss contract remain
to be connected. Reuse the interval-cache translation in the current packages;
wrapping the old experiment's per-read SQL checks in a DO is not this replacement.
Any retained current projection must preserve the safe published prefix while
independent accepted saves overlap.

**Direction partly accepted; details queued, concept 04.** Demand population,
publication-driven invalidation, validated concurrent fills and bounded cache size
are [accepted principles](./02-timestamped-snapshots.md#accepted-cache-and-retention-direction).
The [operation-local slice](./slices/01-snapshot-reads.md) implements bounded
point/range reuse with complete intervals and exact misses. The selected
[timestamped transfer](./slices/02-timestamped-cache-transfer.md) applies the
active pinned cache-refresh mechanism to supported Application app-row data,
retaining live gates. Its connected execution does not establish actual DO
lifecycle, native-cache or complete-request performance acceptance.
A cache adapter cannot hide current transaction coupling or substitute for
writer coverage. Wider local-storage, shared-page and native contracts stay open.
Still open: which data lives in RAM, DO SQLite and PostgreSQL? Is the
cache partial or complete for a declared range, and how are misses, absence,
counts and pagination proved? Decide warming, copying, version retention,
eviction and query lowering, including PostgreSQL-dependent predicates.
Do not infer a complete result from an incomplete local index. The accepted
[timestamped-read contract](./02-timestamped-snapshots.md) constrains these choices:
retain an eligible historical answer locally or miss to PostgreSQL at the same
timestamp. It does not select local version retention or a cache data structure.

References: Convex [index cache](../../../../../crates/indexing/src/index_cache/mod.rs),
[in-memory indexes](../../../../../crates/indexing/src/backend_in_memory_indexes.rs),
[write log](../../../../../crates/database/src/write_log.rs) and the
[pinned cache/retention evidence](./02-timestamped-snapshots.md#pinned-cache-and-retention-evidence);
Flarex [working-set model](../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/model.ts);
Cloudflare [instance memory](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/)
and [SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
Required examples: incomplete ranges, inserted/deleted members, cold reads,
cache updates during an attempt, lost change-log coverage, fills racing
invalidation/replacement, budget eviction and equivalent native count/population results.

## Q06 - Pending state, framework visibility and replay

Compare eager Convex pending-index deltas with the current lazy key-lowering
adaptation; identify any required native failure timing before retaining it.
Duplicate-body suppression, original signed-program retry and invocation-sticky
caught-child failure are existing Application policy choices, not consequences
of DO hosting. Resolve any change to their observable guarantees explicitly;
keep native replay/visibility policy at its own boundary. Nested rollback must
follow the pin's handler-error and accounting behavior, not generic undo-all.

**Ownership/retry policy partly accepted; details queued, concept 05.** Follow the
[operation-lifetime boundary](./02-operation-lifetime.md). Which state belongs to a private attempt versus a shared
committed cache? Which native commands may execute speculatively and which may
rerun? Preserve actual visibility, nested calls, rollback-only failure, hook
ordering, events and workflow compensation. Specify framework conflict behavior
before enabling automatic replay. Updating the cache does not salvage an old
pending-write proposal; an eligible retry recomputes the whole operation.

The selected [range-evidence correction](./slices/04a-range-completion-evidence.md)
retains the already fetched membership lookahead for exact completion verdicts
on newly executed operations. It does not enable mutation-cache handoff or
repair saved durable receipts. The [pending replacement](./slices/04-mutation-pending-state.md)
owns incremental index maintenance, both Application/native write paths,
untrusted syscall admission, nested-lifecycle witnesses and stored-profile
cutover prerequisites. Native replay eligibility is unchanged. The next connected
[Standard replacement](./slices/04c3-standard-finite-execution.md) has completed
independent challenge and peer exchange; the accepted historical-data policy is
[stored Application attempt retirement](./05-stored-attempt-disposition.md). Its
executing classification, recovery and lifecycle proofs remain open.

References: Convex [reads](../../../../../crates/database/src/reads.rs),
[writes](../../../../../crates/database/src/writes.rs) and
[mutation rules](https://docs.convex.dev/functions/mutation-functions);
[experimental direct-command baseline](../DESIGN.md#direct-command-contract-for-the-first-candidate),
Medusa [repository context](../../../packages/medusa-adapter/src/repository/context.ts)
and Payload [native operations](../../../packages/payload-adapter/src/operations.ts).
Required examples: two add-one operations, phantom cart items, nested-hook failure,
one-time external effects and unknown-COMMIT recovery without native reexecution.

## Q07 - Schema, index lifecycle and retention

Total rewrite scope includes the [shared installation/migration lifecycle](./REFACTOR.md#framework-adapters-and-shared-schema-installation)
above/below the translated engine. Map platform Drizzle upgrades, logical schema
installation/evolution and producer-defined conversion separately. Determine
the concrete old/new transitions, build/concurrency policy, durable progress,
activation dependencies and repair/recovery; current installers and adapter
contracts do not constrain the solution. General populated-data evolution keeps
its sequencing owner while required installation and core cutover work proceeds.

The accepted default is the pinned versioned document/index layout and ordinary
same-timestamp index/body hydration. Plan current-pointer, independent-membership,
per-row/per-entry evidence, catalog and feed/journal retirement together with
reader/writer/backfill/cache/retention migration and named-data disposition.
The [physical findings](./CONVEX-ALIGNMENT.md#physical-schema-and-engine-translation-findings)
map the remaining work; this records no completed schema migration.

**Partially answered; remaining mechanisms open, concept 07.** Follow the
[separate cache/history bounds](./02-timestamped-snapshots.md#accepted-cache-and-retention-direction).
The accepted [index-readiness record](./02-index-readiness.md) governs lifecycle
and read admission; it does not decide the complete builder/activation protocol here.
The concrete cleanup protocol and numerical limits remain open.
How do schema activation, index builders, repair,
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

### Next question: resumable index backfill

This is the next unresolved question within index lifecycle, not a required
global next step. A read slice over an already enabled index need not redesign
the builder. Any new build or activation path still needs this proof.

**How do we build an index while writes continue, then resume after a crash
without missing or duplicating logical entries?** Select the snapshot/cursor
contract, how ongoing inserts/updates/deletes are covered, what progress is saved
durably, and the proof required before marking the index Backfilled.

Example: the builder has processed half the carts when Alice adds a cart, Bob
changes a customer assignment and the DO restarts. Determine which work is safe
to repeat, how those writes remain represented, and how the replacement owner
knows the index is complete. A last-seen row ID alone is not the chosen protocol.

References: pinned Convex [database index worker](../../../../../crates/database/src/database_index_workers/mod.rs),
[IndexWriter](../../../../../crates/database/src/database_index_workers/index_writer.rs),
[backfill progress metadata](../../../../../crates/database/src/bootstrap_model/index_backfills/mod.rs)
and [index state](../../../../../crates/common/src/bootstrap_model/index/database_index/index_state.rs);
Flarex [readiness contract](./02-index-readiness.md) and
[owner recovery](./01-commit-coordination.md#accepted-uncertainty-recovery).
Inspect the actual scan, live-write, checkpoint and retention interleavings before
selecting the replacement. This does not enable the index, implement a builder,
settle every schema lifecycle question or reopen replication.

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
The [reactive-client timestamp direction](./02-read-after-write.md#accepted-reactive-client-direction)
is accepted; subscription delivery, wire details and reconnect handling still need
their own design. This does not implement reactivity or select replica freshness.
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

**Connected refactor active, concept 10.** The
[starting milestone](./REFACTOR.md#recommended-starting-slice) begins with one existing
Application point/range read, its portable snapshot owner, a PostgreSQL miss
adapter and DO-local cache storage. Bounded native Medusa/Payload reads follow
through their existing integrations once their profile-specific prerequisites
are met. Which exact consumer and writer/publication hooks prove this replacement,
what old work disappears, and what remains? Resolve the affected guarantees
before activation; unrelated future design questions do not block this slice.
Define measurements and stop or
redesign criteria before expanding coverage. Plan caller migration and deletion
of the displaced paths rather than a permanent parallel engine.

References: [refactor direction and source seams](./REFACTOR.md),
[modular replacement gates](../MODULES.md#proving-replaceability-before-expanding-coverage),
[validation](../VALIDATION.md), [historical results](../RESULTS.md), and the
[performance owner](../../../roadmaps/core-performance/README.md).
Required evidence: same real business graph, both database lanes, actual host
proof, warm/cold/contended traces, CPU and tail latency, cache/retry costs, explicit
data disposition and no obsolete compatibility route after the selected cutover.
