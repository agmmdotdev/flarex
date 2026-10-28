# Existing core refactor direction

Status: **Accepted design and migration direction; implementation not started**.
Refactor the existing Flarex core toward the portable engine and proposed DO
placement, carrying forward the Medusa and Payload integration investment.
`experiments/core` is the design/proof area; the destination is the existing
system with migrated consumers and removed displaced internals. Rebuilding a
permanent parallel engine or reproducing all framework coverage here is not the
plan. The [accepted architecture record](../../../design-notes/flarex-db-accepted-design.md#portable-core-refactor-direction)
owns this direction; the [decision register](./DECISIONS.md) separates it from
unresolved topology and protocol choices.

The [app and commit record](./01-commit-coordination.md) now fixes the independent-app
ownership boundary, initial DO coordinator placement, out-of-order saves with
ordered normal publication, and the uncertainty recovery contract. The
[snapshot record](./02-timestamped-snapshots.md) fixes local and PostgreSQL reads
to one safe published timestamp per operation. The [lifetime record](./02-operation-lifetime.md)
owns atomic grouping, deadline sharing and expiry/retry policy. The
[authorization record](./02-read-authorization.md) selects tracked snapshot
permission reads and identity-aware result reuse while keeping authentication and
engine-grant revocation separate. The
[read-after-write record](./02-read-after-write.md) owns latest-ready-owner reads,
recovery gating and reactive-client timestamp synchronization. The
[index-readiness record](./02-index-readiness.md) selects ordinary-index lifecycle,
deployment gating and snapshot-based query admission. Numerical budgets,
concrete fencing and storage/cache representation remain open; replication is explicitly
deferred.

## Keep, adapt, replace and add

| Area | Treatment | Boundary |
| --- | --- | --- |
| Native Medusa services, workflow graphs, normalization and business rules | Keep reusable implementations and meaningful behavioral tests | Preserve the supported native result, error, hook and compensation behavior |
| Native Payload Local API, access, validation, hooks and population | Keep reusable implementations and meaningful behavioral tests | Request objects, dataloaders and mutable population state remain request-owned |
| Adapter argument/result/query translation and native repository interfaces | Reuse or adapt | Separate actual framework semantics from imports of old core types and execution choreography |
| Prepared definitions and sound pure policy/encoding helpers | Reuse after dependency audit | A prepared value never supplies fresh authorization or a valid live snapshot by itself |
| Command contexts, repository managers, workflow bindings and host construction | Redesign as connected owners | Break interfaces that force repeated admission, reconstruction or obsolete physical lifetimes |
| Attempt working sets, read-your-writes and exact dependencies | Preserve guarantees; redesign representation and storage-facing contract | Keep private pending state separate from shared committed caches; track absence and ranges |
| PostgreSQL schemas, session mechanics, commit/publication/history/outcomes | Reuse correct owners where they fit; adapt or replace where necessary | PostgreSQL authority is fixed; retaining the current physical layout and APIs is optional |
| Shared committed snapshots, local cache/index state and DO lifecycle | Add under portable semantic owners and injected adapters | Cache validity, ownership, replay and recovery need explicit contracts |
| Replicated execution and cache synchronization | Design and prove later | Multiple DO IDs do not automatically supply one coherent database |

The initial experiment contributes useful modular ownership, complete bounded
query operations, pending-state semantics and comparison evidence. Its internal
APIs, SQL segmentation and scalar-clock implementation are not a destination
contract. Neither the active code nor the experiment gets preserved merely
because it exists.

## Breaking changes and cleanup

The project is early and not in production. Necessary internal API, type,
schema, codec, identity and integration-contract breaks are accepted for this
redesign. Do not add compatibility wrappers, fallback engines, dual writes or
duplicate execution paths just to keep unshipped internals working. Reuse does
not mean retaining every current adapter signature.

For each connected replacement, name the changed owner, affected callers and
formats/data, preserved behavior, replacement enforcement, validation and removal
steps. Migrate its consumers and remove displaced exports, dependencies, helpers,
fixtures and stale planning guidance in that scope. Keep regression assertions
for real behavior; replace tests that only enforce obsolete choreography.

Retaining current PostgreSQL tables initially is a possible sequencing choice,
not a requirement. If their shape causes the targeted cost, redesign them too.
State the migration or reset disposition for actual retained data before changing
it. Breaking-change permission does not authorize deleting unspecified data.
The current documentation task performs no runtime, schema or data changes.

## Existing seams and limits

The source assessment found reusable seams, not a drop-in SQLite driver swap:

| Evidence | Consequence for refactoring |
| --- | --- |
| [Commerce host](../../../packages/persistence-postgres/src/frameworks/commerceTransaction/host.ts), `retainPreparedHost` and command execution | Some preparation already survives calls; standalone commands use an admitted bounded relational session. Do not describe all profiles as one transaction per method. |
| [Working-set model](../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/model.ts) and [participant admission](../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission.ts) | Reads require a metadata transaction or checked transaction callback. Introduce a profile-correct snapshot/read-evidence boundary before serving local cached observations. |
| [Commerce publication](../../../packages/persistence-postgres/src/frameworks/commerceTransaction/publication.ts) and [physical session integration](../../../packages/persistence-postgres/src/database/relationalTransaction/session.ts) | Correct durable outcome, publication and database-resource owners are reuse candidates. They do not own DO-cache lifetimes. |
| [Medusa Address workflow](../../../packages/medusa-core-flows/src/customer/workflows/update-addresses.ts), [module definition](../../../packages/medusa-adapter/src/module/definition.ts) and [repository context](../../../packages/medusa-adapter/src/repository/context.ts) | Native behavior already reaches injected repositories. Rebind command/manager lifetimes without copying the business algorithm or retaining mutable service state across requests. |
| [Medusa workflow host](../../../packages/medusa-adapter/src/workflow/host.ts) and [native workflow runtime](../../../packages/medusa-workflows-sdk/src/runtime.ts) | Existing execution injection is useful; workflow visibility, events, retry and compensation still require their native contracts. |
| [Payload operations](../../../packages/payload-adapter/src/operations.ts), [runtime](../../../packages/payload-adapter/src/runtime.ts) and [CMS host configuration](../../../packages/persistence-postgres/src/frameworks/cmsTransaction/hostConfiguration.ts) | Keep real Local API execution while replacing current command/read/journal bindings and PostgreSQL-bound host lifetimes where required. |
| [Payload population](../../../packages/payload-adapter/src/population.ts) and [adapter](../../../packages/payload-adapter/src/adapter.ts) | Keep request-local authorization evidence, native population ordering and copy boundaries; cached bodies do not authorize target disclosure. |

The inspected integration coverage is substantial but bounded. Consult the
[Medusa adoption owner](../../../roadmaps/flarexdb-framework-integration/06-medusa-adoption.md)
and [Payload adoption owner](../../../roadmaps/flarexdb-framework-integration/07-payload-adoption.md)
for current branches and hosting gates. Node conformance is not DO-host proof,
and a Node import alone is not a demonstrated incompatibility. Work in progress
and common interfaces do not establish completed capability coverage.

## Convex as the development reference

For each engine concept and each later implementation slice, inspect the
corresponding [pinned Convex owners](../REFERENCES.md#engine-mechanism-reference-map)
first. Record the mechanism, invariants, concurrency and failure behavior, then
map it to the responsible Flarex owner. Follow the portable developer semantics
and correctness mechanisms as closely as the selected runtime and product allow.
Follow the [source and divergence rules](../REFERENCES.md#source-and-divergence-rules):
inspect relevant callers/tests, retain the exact pin, and record the replacement,
necessary reason, effects and required evidence for each difference. Where
Convex has no framework equivalent, inspect the executing native Medusa/Payload
source instead.

TypeScript can maintain in-memory state. We need deliberate alternatives to
Rust's ordered, persistent/copy-on-write and concurrent structures, not a ban on
RAM caching or a requirement to invent every data structure. Evaluate existing
libraries, plain TypeScript structures and SQLite indexes by their guarantees
and measured costs. A JavaScript Map is not automatically an ordered index or a
versioned snapshot; a current-state SQLite table is not retained history.

Keep pure calculation local and ordinary function calls direct. Logical modules
do not each need a package, service, transaction or RPC. Host adapters supply
platform mechanisms; portable owners retain validity, visibility and acceptance
rules. Record the pinned revision, source paths and relevant symbols for adapted
mechanisms. Implementation follows a separately selected refactor slice.

## Convex-guided replacement workflow

Accepted development rule: organize the refactor around replacing existing
responsibilities. Inspect and adapt the corresponding pinned Convex logic as
closely as the runtime and supported behavior permit. Rust file order is not a
migration plan, and existing Flarex differences are expected refactor inputs.

For each slice, keep a short record:

**Current owner -> pinned Convex mechanism -> keep/adapt/replace -> correctness
cases -> removed code.**

Identify the actual callers and execution profile, source revision/files/symbols,
required guarantees, affected data and cleanup. Keep native Medusa/Payload
business behavior, hooks and workflows; reuse or adapt sound core logic. Replace
mechanisms that cause unnecessary work or conflict with the accepted direction.
Change obstructing internal interfaces and migrate their callers. Preserve
required behavior without a Convex equivalent, such as engine-grant revocation,
with its explicit reason and evidence.

Within an authorized slice, routine TypeScript structure, private API changes,
caller migration and removal of displaced machinery proceed without another
approval. An existing mismatch with Convex is not itself a reason to stop. A
known, accepted divergence does not need repeated approval.

Pause the affected path when the replacement requires an unresolved change to
guarantees: replaying a native hook/external effect, changing visibility,
ownership or recovery, or introducing a new divergence to preserve supported
behavior. Record the source mechanism, concrete conflict, affected behavior and
recommended resolution in the owning decision/question. Continue independent
in-scope work. Final validation cannot repair a disclosure or business error
that has already escaped, and native commands do not automatically become
Application OCC transactions.

## One concept and one connected proof at a time

Focus one replacement on a connected outcome. Resolve its semantic prerequisites
from the [open-question queue](./OPEN-QUESTIONS.md); do not require all future
questions to be answered or explicitly deferred first. Inspect pinned code while
working and raise a decision when a real conflict appears. Ordinary mechanism
choices that preserve accepted guarantees can be made and recorded in the slice.
The [decision register](./DECISIONS.md) distinguishes accepted rules, proposed
scopes and implementation; documentation approval still does not start coding.

Once implementation is authorized, finish the selected consumer migration,
owner/consumer validation and cleanup together. Retain an old path only for a
named unmigrated consumer or durable obligation with a removal gate; do not
accumulate a permanent second engine. The [validation contract](../VALIDATION.md)
and root review rules apply to the connected replacement.

## Recommended starting slice

Status: **Proposed starting scope; no runtime implementation authorized**.
Start with one snapshot-correct document lookup and bounded ordinary-index range
query, including cache hits and PostgreSQL misses. Use an already enabled index.
This replaces the read responsibility through a real existing consumer; it is
not an isolated cache library or a new general index builder.

Current [Application query snapshots](../../../packages/persistence-postgres/src/application/applicationQuerySnapshot.ts)
already reach [historical row reads](../../../packages/persistence-postgres/src/storage/documents/appRows.ts)
and [historical index scans](../../../packages/persistence-postgres/src/storage/indexes/appIndexEntries.ts).
The [logical working-set contract](../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/model.ts)
still takes a metadata transaction or checked read-transaction callback. Audit
and move the required read semantics to their portable owner; adding a cache
behind the old callback alone would retain its SQL/lifetime coupling.

| Responsibility | Initial replacement and injection boundary |
| --- | --- |
| Portable snapshot/read owner | Create an operation-scoped view with app/generation and snapshot identity, metadata/index eligibility, point/range dependencies, cache eligibility and complete-range versus missing coverage. Keep pending writes operation-local. |
| PostgreSQL reader | Reuse or adapt existing timestamped row/index readers behind narrow data-read operations. Keep SQL/Drizzle and database sessions here; a miss must read at the same snapshot. |
| Local cache/index storage | Supply bounded RAM or DO SQLite storage for versioned records/pages, ordered keys and coverage. The core decides validity; SQLite persistence does not make a cached value authoritative. Select the smallest representation this path needs. |
| Cloudflare DO host | Construct shared read services and local storage once per app-owner lifetime; each operation gets its own snapshot and working set. Calls within that DO are direct; interfaces do not require an RPC per lookup. Revalidate or discard retained SQLite cache state during bootstrap before reuse. |
| Existing consumer | Start with a bounded Application point/range read, whose explicit snapshot/dependency contract is already visible. Migrate its call chain and remove the displaced read path in that scope. This is a sequencing recommendation, not a new public API. |
| Medusa/Payload integration | Reuse native services/Local API and their translations. Rebind a bounded native read after its visibility, lifecycle, authorization and pending-state requirements are accounted for; do not silently switch either framework to Application OCC. |

Keep canonical cached values private; mutable framework results and population
state remain request-owned. Shared cache lifetime does not extend an operation's
deadline, snapshot eligibility or mutation authority.

Inspect pinned [SnapshotManager](../../../../../crates/database/src/snapshot_manager.rs),
[DatabaseIndexSnapshot::range_batch and fetch_cache_misses](../../../../../crates/indexing/src/backend_in_memory_indexes.rs),
[IndexCache::get, populate and apply_writes](../../../../../crates/indexing/src/index_cache/mod.rs)
and their relevant tests before implementation. The
[reference map](../REFERENCES.md#engine-mechanism-reference-map) records the pin
and hashes. Translate their snapshot, coverage and racing-fill rules; choose
TypeScript/SQLite representations by the operations they must support.

Suggested order within that connected slice:

1. Trace one existing point/range caller and its actual admission, snapshot,
   history and dependency owners. Record what stays, changes and disappears.
2. Establish the narrow snapshot-read boundary and PostgreSQL miss path, then
   inject local cache storage and the DO composition for the same path. Keep
   correctness in the core and host types in adapters; avoid a generic runtime
   registry or a new package per interface.
3. Connect ordered publication/invalidation and startup readiness to the actual
   writer/owner path before enabling shared cache reuse. Cover every relevant
   writer, including framework writers that can touch those records/indexes.
   Unproven freshness cannot be replaced by a cache TTL or an assumed timestamp.
4. Prove warm/cold reads, absence and partial ranges, ordering/pagination,
   concurrent fills/writes, old snapshots, eviction, restart, history expiry and
   authorization. Migrate and remove the selected old path; compare complete
   operations, not just local lookup speed.

The cart example for this read contract is: select safe snapshot S, read the
cart and its item-index range from eligible local state, and fetch uncovered
data from PostgreSQL at S. After an item update publishes at S+1, a new read
must see the updated range; an existing S read keeps its old view. A missing
cache entry is not an empty cart. This example does not itself migrate native
Medusa cart workflows or authorize their replay.

Only the slice's required portions of Q01/Q02 ownership/publication, Q03
admission/lifetime, Q04 ordering and Q05 coverage/storage must be settled for
its activation. Work on proven subpaths can proceed within the selected scope.
New out-of-order persistence, general index backfill and replica protocols are
not implicit prerequisites when the slice does not change them; existing
writer semantics must be stated and proved, not mistaken for the new pipeline.
If the chosen read cannot work without changing one of those guarantees, resolve
that dependency before activating the affected path. The canonical queue owns
remaining questions; no new cache/index algorithm is accepted by this proposal.

Replication remains open and explicitly deferred. A later replica proof is not
a prerequisite for the first single-owner replacement.

## Completion boundary

A new host or a lower SQL count does not establish removal of the old bottleneck.
For each replacement, name the eliminated work/round trips and the mechanism that
preserves their guarantees. Measure complete native business graphs, CPU, latency,
queueing, misses, retries, memory and warm-up. Reuse existing correctness evidence
without presenting historical cohorts as current performance results.

Current approval is for these design documents and the replacement workflow.
The starting slice is a recommendation; its required grant enforcement and
ownership/publication protocols need a concrete mapping before activation.
Resumable index backfill and other unrelated questions remain open.
Runtime implementation, cutover,
deployment and data changes remain unstarted. Preserve current behavior until a
connected replacement is implemented and verified, then retire it rather than
accumulate another engine.
