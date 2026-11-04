# Convex core translation and existing-core refactor

Status: **Accepted design and migration direction; goal execution authorized**.
Translate the pinned Convex database core into portable TypeScript, including
its physical persistence schema through Drizzle. Use its mechanisms as the
default; diverge only where the DO runtime or required native behavior demands
it, with a concrete requirement and dedicated divergence record. Existing private
APIs, layouts, optimizations and product-policy choices are not independent
exceptions. Preserve supported guarantees until a conflicting policy is resolved
for the affected slice. Refactor existing Flarex owners and callers into that
engine, carrying forward the Medusa and Payload integration investment.
`experiments/core` is the design/proof area; the destination is the existing
system with migrated consumers and removed displaced internals. Rebuilding a
permanent parallel engine or reproducing all framework coverage here is not the
plan. The [accepted architecture record](../../../design-notes/flarex-db-accepted-design.md#portable-core-refactor-direction)
owns this direction; the [decision register](./DECISIONS.md) separates it from
unresolved topology and protocol choices. The [goal contract](./GOAL.md) owns
the authorized bounded-milestone execution and completion criteria. Runtime
implementation still requires the pre-slice challenge below.

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

Active Convex pin: `db914cf06e2b06ee985646611b9e12ed7a770318`.
The [reference upgrade](./CONVEX-REFERENCE-UPGRADE.md) is part of this plan:
revalidate affected earlier source challenges/divergences before runtime edits.
Current owners and raw source identities are in [REFERENCES.md](../REFERENCES.md).

## Keep, adapt, replace and add

The [Convex alignment findings](./CONVEX-ALIGNMENT.md) supply the source-grounded
keep/replace assessment and recommended priorities. They distinguish existing
finite/prepared-state reuse from remaining SQL interactions and unimplemented
coordination, without changing accepted guarantees or claiming a measured gain.

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

The scope is a total rewrite of current core and integration internals around
the translated Convex mechanisms. "Refactor" names the current-codebase
destination, not a requirement to preserve existing architecture. Current core
and adapter APIs, types, schemas, codecs, installation/migration contracts and
execution sequences may be replaced wholesale. Reuse sound code only where it
fits that target; previous effort or an existing test of internal choreography
does not require retention. Intended native behavior and correctness remain
requirements. The project is early and not in production.
Do not add compatibility wrappers, fallback engines, dual writes or
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
Recording the plan performs no runtime, schema or data changes.

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
first. Translate/copy their mechanisms as closely as possible: algorithm,
control/visibility order, invariants, dependency and coverage accounting, and
failure/recovery behavior. Prefer a faithful translation or verified existing
equivalent over inventing a simpler alternative. Map it to the responsible Flarex
owner; Rust source-file layout and syntax do not determine TypeScript structure.
Follow the [source and divergence rules](../REFERENCES.md#source-and-divergence-rules):
inspect relevant callers/tests, retain the exact pin, and record the replacement,
necessary reason, effects and required evidence for each difference. Where
Convex has no framework equivalent, inspect the executing native Medusa/Payload
source instead. Record each necessary mechanism difference in a dedicated new
[divergence file](./divergences/README.md) before affected implementation. Explain
the pinned behavior, why it cannot be retained, how the replacement works,
affected guarantees/costs and the evidence needed. Update that record with actual
owner/symbol links and remaining limits after implementation; do not call a
proposed adaptation implemented. Previously accepted platform differences retain
their existing authority and need a record when a slice concretely adapts them.

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
mechanisms. Implementation follows the goal's challenged bounded slices.

## Core and physical-schema translation plan

The destination is the current core in `packages/` and `apps/`. The earlier
`experiments/core/src` candidate and its Drizzle schema are retained comparison
material, outside workspace membership, not the engine to extend or wrap in a
DO. Current cache/index replacements execute in existing package owners; they do
not import that candidate. Reuse sound pieces and behavioral witnesses after
audit, without rebuilding a permanent second engine or preserving old execution
sequences. The [alignment findings](./CONVEX-ALIGNMENT.md#physical-schema-and-engine-translation-findings)
record the inspected differences and remaining policy choices.

### Engine responsibilities

| Convex responsibility to translate | Flarex destination contract |
| --- | --- |
| SnapshotManager and versioned table/schema/index registries | One portable app owner supplies a safe published snapshot, exact metadata dependencies, versioned TableCounts, bounded history and retained-view eligibility. |
| Transaction, TransactionReadSet, Writes and TransactionIndex | One operation owns reads, first-original/final pending values, cursor-bounded pending-page merge, nested checkpoints including TableCounts and accounting; finalization hands one final transaction to the committer. Preserve snapshot-derived time and commit-timestamp resolution at the correct phases. |
| WriteLog and PendingWrites | Translate immutable per-index WriteLogSnapshot batches and FIFO PendingWrites with ordered PendingKeysInIndex overlap. Final acceptance checks residual committed history and every accepted pending write; publication also supplies local cache changes. |
| Committer and WriteBatcher | Bound staged prevalidation/inflight work, carry validated_through, recheck the final published suffix and pending writes, assign logical timestamps and derive changes. Translate bounded group commit, eligible overlapping persistence and ordered publication/acknowledgement; reconcile batch-wide uncertainty with each logical outcome intact. |
| Persistence reader/writer and lease protection | Exact historical reads, snapshot-consistent IndexRef identity, index write modes/predecessors, idempotent backfill/reconciliation, document-pair reclamation, read-only-aware leases and atomic fenced batches/outcomes. Drizzle/SQL stay below the engine boundary. |
| Runtime adapter | DO lifecycle, scheduling, transport and optional local cache storage; no extra committed-data authority or SQL transaction across untrusted execution, workflow pauses or remote effects. |

Rust background prevalidation/destruction threads do not translate to parallel
JavaScript CPU work through promises. Choose DO scheduling and ordered/versioned
structures with bounded work; record necessary adaptations while preserving final
validation and recovery. Read-only bypass requires a finalized empty write set,
including required outcome/system writes, not merely no user document changes.

These are responsibilities, not mandatory new classes, packages, services or
RPCs. Reuse correct existing owners/types and replace obstructing handoffs
together. Required native result/event/effect obligations join the actual outer
settlement; adapters do not acquire a second transaction or publisher.

### Physical persistence is in scope

Start the Drizzle design from the pinned Convex PostgreSQL adapter's five core
tables and reader/writer contract. The
[physical/logical storage owner](../../../design-notes/flarexdb-shared-logical-storage.md#five-table-physical-starting-point)
records their roles and the framework mapping. A conceptual mapping is:

```text
documents(scope, ts, table_id, id, value_bytes, deleted, prev_ts)
indexes(scope, index_id, key_prefix, key_suffix, key_sha256,
        ts, deleted, table_id, document_id)
leases(scope, ts)
read_only(scope)
persistence_globals(scope, key, value_bytes)
```

Payload/Medusa data and native internal records use logical tables over the
document/index logs. Engine catalog/schema definitions, installation/build and
activation state, migration progress and durable outcomes likewise default to
private logical records. Do not add separate physical framework, catalog or
migration families by default. Native constraints need shared enforcement;
logical representation alone does not supply uniqueness or reference integrity.
An extra physical family needs a demonstrated DO/native requirement and recorded
divergence. Configured blob/control systems remain distinct from this base layout.

This is the selected PostgreSQL adapter layout, not a universal Convex table
count: selectable MySQL V6 now has latest/backfill-delete/bucketed index tables.
Keep the PostgreSQL baseline. Current engine IndexRef/write-mode/predecessor,
backfill reconciliation and storage-owned reclamation contracts must be mapped
through it; richer engine metadata does not automatically require MySQL's tables.
Do not remove current heads solely by claiming no upstream adapter has them.

This is a mapping, not final DDL. Preserve required scope confinement and native
identities, exact timestamp/value/key ordering, long-key handling, atomic durable
outcomes and PostgreSQL fencing. Translate engine catalog meaning into private
logical records and versioned registries by default; keep genuinely external
deployment/artifact authority at its own boundary. Bootstrap and native constraint
requirements still need their correct owners.

Default ordinary-index maintenance to Convex's final live index entry at the
document's commit timestamp, including unchanged keys, with same-timestamp body
hydration. This replaces the independent membership/no-op-proof direction unless
a DO/native requirement justifies a recorded departure. More index writes are a
cost to measure, not grounds to retain the old optimization automatically.
Reassess lazy pending-index maintenance against Convex's eager old/new deltas:
fallible key lowering and observable native error timing need a concrete
disposition, not an assumption that TypeScript requires lazy maintenance.

Audit current pointers, per-revision schema/hash/codec/epoch columns, per-entry
specification evidence, normalized catalog copies, durable syscall journals and
duplicate change directories against the translated contract. Move their real
authority/integrity/recovery duties to the correct owner and remove displaced
representations. A retained accelerator needs a DO/native justification and must
remain snapshot-safe, rebuildable and compatible with overlapping saves.
No table/column removal occurs without connected writer/reader, cache, backfill,
retention, outcome and named-data migration or reset disposition.

### Framework adapters and shared schema installation

Payload and Medusa are consumers above the translated core. Convex need not
contain those frameworks for its engine mechanisms to serve them. Rewrite the
Flarex adapter/compiler seams where required; preserve the intended admitted
native behavior rather than current SQL/repository/transaction-token internals.

| Layer | Target responsibility |
| --- | --- |
| Application schema producer | Compile developer declarations and authenticated analysis into logical definitions and executable dependencies. |
| Payload producer/adapter | Compile collections and translate native query/write operations. Keep native access, validation, hooks, population and request ownership. |
| Medusa producer/adapter | Compile models/modules/Links and translate native repository/query operations. Keep native business rules, exact values, events, grouping and compensation. |
| Shared schema lifecycle | Stable identities, versions/dependencies, change planning, index/constraint builds, validation, progress/recovery, readiness, activation and retirement. |
| Translated engine/persistence | Shared snapshots, index/query mechanics, constraints/relations, operation state, OCC, atomic persistence, outcomes and publication. |

Required exact-value, conditional-unique and relation behavior extends shared
capabilities with a concrete native witness. Do not create module-specific
database engines, duplicate migration authorities or a universal transaction API
that erases native boundaries. Query translation and native transaction/replay
rules need real conformance; representable metadata alone is not integration.

The [shared schema lifecycle](../../../design-notes/flarexdb-shared-schema-lifecycle.md#logical-evolution-and-physical-core-upgrades)
owns three distinct migration layers: platform Drizzle upgrades of physical
engine storage, per-scope logical schema installation/evolution, and explicitly
producer-defined data conversions using common progress/recovery machinery.
For example, adding Payload `articles` or installing Medusa Product creates
logical definitions/index requirements over shared storage, not dedicated
per-app/collection/module SQL tables. Ordinary framework startup consumes ready
bindings; it does not run hidden DDL or migrations.

Include fresh install/replay, compatible changes, required builds, unsupported
change refusal, interrupted progress, dependent activation and necessary storage
cutover migrations in each connected lifecycle slice. Data conversion must name
its old/new schema, native meaning, retained readers, concurrent-write policy,
recovery and rollback/forward-repair disposition. General populated-data
transitions retain their [sequencing owner](../../../roadmaps/shared-logical-storage/deferred-framework-schema-evolution.md);
this does not preserve old installers or exclude shared lifecycle replacement.

### Connected implementation sequence and conformance

1. Map pinned engine/persistence responsibilities to current executing owners,
   native requirements, actual data and removed mechanisms. Complete or safely
   hand off in-flight finite/stored-attempt work; do not reset its status or
   create another engine to avoid it.
2. Define the translated transaction-to-persistence batch, physical schema,
   shared installation/migration lifecycle and bootstrap/fencing/retention
   boundary together. Include native schema/runtime translation requirements.
   Begin with the five-table layout and an inventory mapping current physical
   framework/catalog/installation/migration records to logical definitions/data.
   Select a connected vertical slice; the field mapping alone is not an
   executable design.
3. Establish versioned snapshot/catalog ownership and exact historical misses,
   reusing the translated interval cache. Cover relevant writers before local
   state replaces live database work.
4. Translate transaction dependencies, coalesced writes, pending index deltas,
   nested state/accounting and finalization, then committed/pending conflict
   checks, fenced batch persistence and ordered publication/recovery. Choose
   slice boundaries that prove these connections, not disconnected modules.
5. Rewrite/rebind Application and admitted native callers, schema compilers,
   runtime adapters, shared installation/migration and feed consumers; retire
   displaced code/layouts after durable-data disposition.
   Prove actual DO/native operation and complete-request performance separately.

The [shared schema milestone](./slices/07-shared-schema-lifecycle.md) supplies the
bounded Application lifecycle and five-table generated platform baseline in this
sequence. Its native activation guard preserves the previous ready combination
when shared native constraints are unsupported; it does not wrap or fall back to
old framework installers. The [bounded literal translation](./slices/08-validator-literal-parity.md)
now connects Int64/signed-zero semantics through authoring, analysis, manifests,
stored metadata, hashing and actual runtime consumers. The connected
[source translation](./slices/09-source-validator-wire-parity.md) replaces the
record wire/parser and document-root subset, including named stored identity
handling. Its external/native cutover and broader source gates remain. Managed
hosting, native/GC, supported-data and complete-flow performance gates remain
separate.

Derive executable conformance traces from pinned source and tests where present:
conflict against an accepted unsaved write; independent saves completing out of
order; durable B hidden before the safe published prefix; missing/empty ranges,
key moves and same-key body changes; first-original/final-write coalescing with
per-call accounting; nested handler rollback; ownership replacement and unknown
commit recovery. Also cover prevalidation/final-acceptance races, multiple logical
commits in one SQL batch with unknown outcomes, lease/read-only races, cursor-
bounded short-page pending merges in both directions, TableCounts rollback,
repeatable-timestamp race re-arming and historical index identity/backfill/
reclamation. Schema validation and cache fills must handle index-metadata writes
as well as row changes. See the [source-derived cases](./CONVEX-REFERENCE-UPGRADE.md#updated-correctness-cases-and-implementation-gates).
Run equivalent abstract Rust/TypeScript traces where harnesses
exist and both database lanes plus required host proofs for Flarex adaptations.
Name policy-sensitive cases and resolve their Application/native disposition
before changing observable behavior; a retained policy difference is not parity.
Matching names or SQL text is not algorithm conformance or a measured speedup.

The [fresh many/join continuation](./slices/15-native-many-and-joins.md) implements
its actual fixed producer and genuine Local API consumers after three-way peer
challenge. It uses confined logical memberships, unchanged ordinary Source indexes,
shared native integrity and one schema lifecycle, preserving fresh-only installation,
refused many upgrades, source-authoritative order, root-only bounded joins and real
source observations. Its [membership divergence](./divergences/native-reference-memberships.md)
records the executing native derivation and paired proof. Relation workload
construction also uses the current owner and its bounded regressions are complete;
broader retirement, native, host and performance gates remain part of the goal.

## Convex-guided replacement workflow

Accepted development rule: organize the refactor around replacing existing
responsibilities. Inspect and adapt the corresponding pinned Convex logic as
closely as the runtime and supported behavior permit. Rust file order is not a
migration plan, and existing Flarex differences are expected refactor inputs.
The [pre-slice challenge](#pre-slice-challenge-and-agent-coordination) is mandatory
before runtime edits, and [divergence records](./divergences/README.md) make each
necessary departure from the pinned mechanism reviewable.

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

For native schema producers, inspect the actual compiled logical declarations
alongside the pinned models: generated/default indexes, predicates and final
identities participate in admission too. Static model counts or an inferred
index name do not prove that the complete producer can install.

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

## Pre-slice challenge and agent coordination

Before each runtime implementation slice, the coordinator records its candidate
responsibility, owned paths/consumers and baseline checkpoint. Assign at least
two independent read-only sub-agents to inspect the three sources below; the
coordinator covers any gaps. Agents form source-grounded initial findings before
exchanging them and challenging each other's conclusions.

| Source | Required challenge |
| --- | --- |
| Current core and executing consumers | Trace actual owners, callers, tests, authority/lifetimes and cost. Identify reusable logic and what is replaceable; existing code is neither an automatic obligation nor disposable by default. |
| Accepted new direction | Check that the slice preserves the selected app boundary, profiles, snapshot/commit/recovery guarantees and portable injection. Identify assumptions the design has not settled. |
| Pinned Convex core | Read actual mechanism, callers and relevant tests. Explain why a close translation works or identify the exact platform/native obligation requiring a recorded difference. |

Challenge concrete scenarios: racing cache fill/publication, absence or partial
range mistaken for completeness, older snapshots, pending writes, revocation,
stale owners, uncertain commit and repeated native effects as relevant. Agreement
without source evidence or counterexample analysis does not finish the challenge.

Before assigning runtime edits, the coordinator records the short slice map,
findings and dispositions, retained invariants, removed work, necessary divergence
links, correctness witnesses and actual consumer/cleanup boundary in a focused
slice note. Resolve competing ownership/protocol claims; unresolved guarantee
changes pause the affected path for the owner's decision. Missing evidence is
an open gate, not an assumed pass. Routine choices within accepted guarantees
can be resolved by the coordinator without another approval.

Use worker sub-agents for implementation with explicit responsibility and owned
paths. Tell each worker it shares the codebase, must preserve others' changes and
must coordinate contract changes with dependent workers. Parallelize independent
owners; serialize shared-owner edits and dependency handoffs. Agents may exchange
findings and questions directly; the coordinator owns the final contract and
integration, not a second runtime authority. Do not run competing heavy database
or benchmark work on shared resources.

After significant code, run both root-mandated read-only reviewers with exact
scope and validation evidence. Pre-slice challengers and implementation workers
do not replace those reviews. Fix substantive findings, revalidate, remove
displaced paths and commit the connected completed slice.

## One concept and one connected proof at a time

Focus one replacement on a connected outcome. Resolve its semantic prerequisites
from the [open-question queue](./OPEN-QUESTIONS.md); do not require all future
questions to be answered or explicitly deferred first. Inspect pinned code while
working and raise a decision when a real conflict appears. Ordinary mechanism
choices that preserve accepted guarantees can be made and recorded in the slice.
The [decision register](./DECISIONS.md) distinguishes accepted rules, proposed
scopes and implementation. The goal authorizes bounded implementation after the
mandatory challenge; accepted design by itself is not implementation evidence.

For each authorized milestone, finish the selected consumer migration,
owner/consumer validation and cleanup together. Retain an old path only for a
named unmigrated consumer or durable obligation with a removal gate; do not
accumulate a permanent second engine. The [validation contract](../VALIDATION.md)
and root review rules apply to the connected replacement.

## Recommended starting slice

Status: **Bounded operation-local read replacement implemented; wider first
milestone open under the authorized goal**.
The exact consumer/owner boundary follows source findings, not this sketch alone.
The [first source challenge](./slices/01-snapshot-reads.md) refines the initial
runtime step to a fixed-timestamp reader seam and operation-local complete-range
cache, preserving current source/grant checks. At the pin, shared-page
`IndexCacheReader` fetches persistence first; serving those shared pages directly
would require a separate divergence and writer/publication proof. The wider DO
cache/storage integration below is the milestone target, not an assumption that
the first code patch supplies an app-lifetime cache.
The next selected [cache-transfer slice](./slices/02-timestamped-cache-transfer.md)
follows the pin's active timestamped transaction-cache handoff, with protected
PostgreSQL refresh; it does not enable the shadow shared-page reader.
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
[DatabaseIndexSnapshot::range_batch and fetch_cache_misses](../../../../../crates/indexing/src/database_index_snapshot.rs),
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

The [goal](./GOAL.md) authorizes implementation with the stronger translation,
divergence and sub-agent challenge rules above. The first slice's required grant
enforcement and ownership/publication protocols need a concrete mapping before
activation; the pre-slice findings determine its exact implementation boundary.
Resumable index backfill and other unrelated questions remain open.
The owning slice records distinguish implemented paths from proposals; these
rules alone supply no runtime or cutover evidence. Production
rollout and unspecified data resets are outside the goal. Preserve current behavior until a
connected replacement is implemented and verified, then retire it rather than
accumulate another engine.

The [source validator wire translation](./slices/09-source-validator-wire-parity.md)
closes remaining raw record grammar and parser-policy gaps beyond the connected
numeric slice. Treat canonical-byte changes as a named stored-identity migration
responsibility; do not preserve the simplified private wire as a runtime exception.

The [managed scalar Payload cutover](./slices/10-payload-native-core-cutover.md)
connects its existing fresh consumer after independent source/current/design
challenge. Shared native reservations, required-text uniqueness, explicit
observation/acceptance, real Local API lifetime and native outcomes use the
translated five-table owner. Direct commands preserve remembered membership and
later untouched observations; standalone reads retain one snapshot. Broader
native profiles, multi-source composition, retained-data cutover, native hosting
and complete-flow performance remain open. The selected binding has no old-engine
fallback; retained consumers and their removal gates are named in the slice.

The [indexed scalar Payload continuation](./slices/11-payload-indexed-scalar.md)
selects the existing indexed/compound-unique/nullable fixture family next. Its
three-way challenge preserves raw Source event dependencies and records the
necessary native ordinary-range observation and shared-budget differences
separately. The selected replacement and its bounded database/consumer proofs
are complete; its displaced fixture plumbing is retired. Broader native
profiles, schema composition, retained data, hosting and performance remain open.

The [Currency and native composition continuation](./slices/12-medusa-currency-composition.md)
implements the selected genuine three-source announcement and Currency service path.
Independent peer challenge rejects a fixed-S assumption for that existing
READ COMMITTED profile. Compose authentic schema sources before shared
activation, preserve per-source identities, and use confined child views over
one pending/observation/budget/finalization owner. Exact Currency storage is
required; its code-only queries do not select decimal ordered indexes. The
contract, characterization and divergence handoff connects native examined pages,
source initialization/retry and the genuine consumer to the shared core. The
named Legacy Product/strong-reference and joint relation closure remains until
its own migration; broader native, hosting and performance gates stay open.

The [transaction ID continuation](./slices/13-transaction-id-generation.md)
replaces complete-ID injection with trusted entropy and a transaction-owned
Source generator, including real metadata/bootstrap allocation and independent
UUID secret entropy. Its challenged scope also corrects ordinary insertion's
allocation/document-validation phases while preserving native batch preflight.
Existing stored IDs are unchanged. No algorithm divergence is required.
The selected replacement and bounded caller/database/host proofs are complete.
Generated metadata uses fresh-insert semantics and the Source batched history
check; numeric revision ordering and interruptible transaction preparation stay
with their shared owners. Broader native migration, retained-data cutover,
managed hosting and complete-flow performance remain full-goal gates.

The [Product, Links and protected-reference continuation](./slices/16-native-product-links-and-references.md)
selects the complete admitted graph after independent current/design/Source
challenge and peer exchange. Shared native-key FKs, conditional uniqueness,
native query execution, explicit closure preparation, durable events and
historically authenticated committed-first recovery now execute in existing
owners. The connected [app-generation supervisor](./slices/16a-app-owner-recovery.md)
preserves the terminal committer stop and reconstructs after whole-scope drain,
fencing and all-inflight reconciliation; the actual DO and explicit native
caller-retry path use that owner. Native business semantics remain with
Medusa/Payload. The selected original/authored Product, Links, protected
read/save/reverse/race/recovery and actual-host proof and review are complete.
Selected unused helpers are removed. Named Legacy finite/journal, workflow,
mixed/performance and durable-data consumers retain explicit migration/removal
gates; the complete rewrite and paused performance acceptance remain open.

The [ordinary atomic workflow and Tax continuation](./slices/17-native-atomic-workflows-and-tax.md)
has completed independent challenge and peer exchange. It replaces the remaining
SQL/session-held ordinary workflow execution through the existing portable
compiler seam and one Core root/lifetime/outcome. Complete admitted Product-only
and Product/Currency workflows precede the full Tax source/eight workflow-family
proof, including shared REAL, compound eligibility and native flush checkpoints.
Native hooks are not replayed, ordinary failed roots add no inverse callbacks,
and explicit retained inverses remain fresh roots. The selected replacement,
complete admitted consumer proof in both database lanes and displaced fixture
cleanup are complete. Durable Task, finite borrowed, later-source graphs,
retained data and actual Native17 managed hosting remain named gates.

The [multi-source Product/Variant continuation](./slices/18-native-product-multi-source-workflows.md)
implements the independently challenged connected replacement: all eight
already-admitted Product/Variant create/update/delete/batch roots and their full
business producer/runtime closure. Preserve the combined Variant Links source,
one-table ShippingProfile selection, native exact values and original budgets;
no new physical family or preliminary numeric-index project is established.
PriceList's null-plus-text predicate uses the shared ordinary equality prefix,
preserving broader reads and old predicate identities. Its shared conditional
uniqueness has paired proof without changing the Source index algorithm.
Repository failures observe/rethrow the existing complete Cause without admitting
a new refusal operation. Product's event-check bridge follows the same rule,
including the actual first `unadmittedEvent` from an absent-ID upsert in an
update-only root. Event grants, native upsert, receipt-validation order and the
distinct sticky guard on later result capture retain their contracts.
Private failure origins use reference equality so Effect's structural Cause
joins preserve independently authenticated occurrences with equal values; the
lifetime issuer owns that representation and its aggregation proof.
Fresh construction, complete paired consumer proof and selected retirement are
complete. Populated transitions, named retained Task/finite/native consumers,
native managed hosting and performance retain their separate gates.

The [Inventory deletion and Variant read continuation](./slices/19-native-inventory-and-variant-read-workflows.md)
implements the three retained consumer replacements and authentic nine-source
closure after renewed independent challenge. Its shared-lowering prerequisite adds
missing inferred composite-key reverse access as ordinary Source indexes;
whole-table capture cannot replace admitted endpoint-selective history. Preserve
existing FK/index identities, native profiles and metadata authentication.
Paired owner and genuine native proof cover these mechanisms, and the displaced
standalone fixtures are retired. Complete consumer coverage passes on both
database lanes, and connected regressions are complete. Wider goal gates remain
open.

Genuine setup further exposes the admitted
[native scope-exclusion prerequisite](./slices/19a-native-scope-exclusion.md).
Its implemented trusted Core admission/settlement adaptation preserves ordinary
callback concurrency, selected exclusion, writer fencing and lifecycle recovery
without holding a SQL transaction across callbacks. Independent challenge and
paired owner/native proof cover the mechanism and the complete selected consumer
coverage and connected regressions. Populated conversion, wider hosting and
performance retain their separate gates.

The [optional-one native continuation](./slices/14-native-reference-integrity.md)
implements complete direct Payload relations/population/preferences and the genuine
joint native consumer after independent peer challenge. Its scope includes the
existing populated scalar successor and compatible audit-only Application-source
change, not fresh installation alone. Extend authenticated active/pending native
policy and atomic handoff through the existing shared lifecycle; reuse durable
ordinary-index backfill rather than add another builder. Preserve late native
reference errors without introducing target-body observations or callback replay.
The recorded Source-compatible readiness correction removes the old whole-data
sequence fence while keeping actual schema/policy/identity invalidation strict.
The selected populated successor, cold build/rebinding, native late-integrity,
opaque cleanup and genuine joint proof are complete. Selected fixtures have
retired their old relation/catalog materialization and Legacy joint host; named
Product, developer-UDF and query-sync consumers remain separate gates. The selected
fresh many/join continuation above replaces its named old consumer assembly.

The [complete Inventory maintenance continuation](./slices/20-native-inventory-maintenance-workflows.md)
replaces the remaining eleven admitted standalone workflow/read families after
independent current-core, accepted-direction and pinned-source challenge and peer
exchange. It preserves genuine two-source and neighboring five-source closures,
per-facade exclusion, queued-only batches, native inverses and original bounds.
Its [declared equality prerequisite](./slices/20a-native-declared-equality-indexes.md)
corrects the shared omission of authenticated unconditional text declarations
through ordinary Source indexes, preserving existing index identities. Paired
neutral owner and genuine producer/schema characterization cover the correction;
complete consumer coverage and connected fixture regressions pass on both database
lanes. Shared fixture hosts follow the existing lazy selection contract and
validate authority before callbacks. Selected obsolete fixture construction is
removed; named direct-service and paused Task consumers retain their own removal
gates. The full goal remains active.

The [complete Pricing maintenance continuation](./slices/21-native-pricing-maintenance-workflows.md)
is selected after independent current/design/pinned-source challenge and peer
reconciliation. Preserve all ten ordinary roots, their removal read and receipt
callers, original bounds and genuine retained native inverses. Its shared
prerequisites translate closed PostgreSQL predicates over captured Core rows and
authenticated native restoration through bounded index/canonical history with
historical schema proof. The [bounded physical-history prerequisite](./slices/21c-native-history-physical-pages.md)
extends the existing ordered index with timestamp and limits physical tuples
before time eligibility. Existing installations require an explicit data-preserving
platform upgrade after actual runtime/SQL drain. The five tables, Source
observations, fresh internal-ID rules and one settlement authority remain.
Native construction and caller retirement, corrected predicate/history owners,
the data-preserving upgrade and focused plan proof have scoped connected
acceptance and completed review. Named remaining consumers, paused
Task/finite/performance work and broader goal gates remain open.

The [Stock Location/Sales Channel continuation](./slices/22-native-stock-location-sales-channel.md)
has migrated the complete already-admitted ordinary consumer construction to
Core, including required Links, Location/Fulfillment Set creation and the existing
Fulfillment Set deletion forest. Source producers preserve logical storage and
data-only setup; native callbacks, retained inverses and exact publication retain
their existing owners. The [atomic admission correction](./slices/22a-native-atomic-admission.md)
preserves implicit and explicitly selected native identity limits in live and
recovery frames. Selected obsolete fixtures are retired after caller migration.
Bounded connected validation and review are complete; named remaining consumers,
Task-backed fulfillment, hosting, component-scope and performance gates remain open.

The [Store continuation](./slices/23-native-store-workflows.md) has replaced
complete admitted creation/update/deletion construction, including genuine
Pricing callbacks and retained inverses. Independent challenges identified and
translated same-root child reconstitution through existing Core pending/deleted/
original owners, preserving proven identity/creation time and its authenticated
timestamp policy. Recorded historical replay remains separate. Dedicated old
Store fixtures are retired; required scoped validation and review are complete.
API Key follows as a separate complete connected slice. Broader native, hosted,
Task and performance gates remain open; the full goal is unchanged.

The selected [API Key continuation](./slices/24-native-api-key-workflows.md) has
replaced all five admitted roots and retired their dedicated Legacy fixtures.
Core schema producers preserve exact source grants, durable Link operation
receipts and pair revisions. Trusted SDK invocation identity and native replay,
fencing and cancellation remain with their existing owners. The trusted deletion
facade selects a named allowance for the complete graph, with ordinary-budget
rollback preserved. Bounded connected validation and review are complete. The
full goal remains open; finite, Task and performance work remains paused.

The [Order Change continuation](./slices/25-native-order-change-workflows.md)
has replaced all four admitted ordinary workflow roots and retired their
dedicated Legacy fixtures. The complete 23-model source retains its 34
conditional declarations through the [shared index lowering](./slices/25a-native-non-null-indexes.md).
Authenticated bindings use ordinary Core field indexes. Paired acceptance for
this family is complete. Broader native and hosted gates remain open.

The [Order Archive and Completion continuation](./slices/26-native-order-status-workflows.md)
has moved both admitted status roots to the shared Core Order fixture and
retired their dedicated Legacy fixtures. Both preserve the full Order source,
retained status inverses, ordered events and callback-free recovery.
Completion retains its confined finite hook. Bounded paired acceptance is complete.

The [generated serial and Order creation continuation](./slices/27-native-order-generated-serials.md)
moves standalone Order creation and deletion and Order Change Action ordering
to Core. The ordinary descending query and existing commit validation preserve
native max-plus-one values. The neutral owner and both direct consumers passed
paired acceptance. The checkout participant remains a separate cutover.

The [checkout Order continuation](./slices/28-native-checkout-order.md) moves
the existing Order workflow participant onto Core, including native graph
accounting and the retained inverse. The paired Order cases passed. Full
Cart checkout and Payment finance retain their connected gates.

The [Cart completion and exact-price continuation](./slices/29-native-cart-completion-exact-price.md)
uses the complete nine-model Cart source with an ordinary index lowering for
its CreditLine history declaration. Both workflows passed paired verification
through the existing Core transaction and native decimal owners.

The [Cart creation and refresh continuation](./slices/30-native-cart-creation-refresh.md)
uses one fresh Cart source with three logical generation records for retained
compensation across requests. The selected workflows passed paired verification
through the existing Core settlement owner.

The [selected native Promotion related-predicate continuation](./slices/31-native-promotion-related.md)
uses exact complete Core reads and the existing closed predicate evaluator
for the selected native Rule and Value operation. Paired acceptance is complete.

The [Customer selection and Cart group read continuation](./slices/32-native-customer-selection.md)
uses existing Core source, index and settlement owners for the two native
Customer consumers. Paired acceptance is complete.

The [native Cart context read continuation](./slices/33-native-cart-context.md)
uses complete indexed Region counts and existing relation receipts under
the same Core root as Store defaults and Sales Channel retrieval. Paired acceptance is complete.

The [Cart PaymentCollection continuation](./slices/34-native-cart-payment-collections.md)
uses Core's native index, reference and settlement owners for genuine
creation, Link attachment and linked refresh. The synchronous diagnostic
uses the existing callback drain. Paired acceptance is complete.

The [full native Cart creation continuation](./slices/35-native-cart-creation.md)
uses complete Fulfillment and Cart Promotion Link sources on one Core bundle
with the sixteen existing sources. Paired acceptance is complete.

The [full native checkout continuation](./slices/36-native-checkout.md) uses the
existing Core owners for both genuine checkout profiles, the four exact Link
sources and the queued root scope proof. Paired acceptance is complete.

The [native Payment finance continuation](./slices/37-native-payment-finance.md)
uses the existing Payment, generated Order and exact Link sources and Core
settlement for the selected native roots. Paired acceptance is complete.

The [native Payment collections and Sessions continuation](./slices/38-native-payment-collections-and-sessions.md)
uses existing sources and one Core settlement for the remaining Payment and
Customer Account/Address profiles in this workflow family. Paired acceptance is complete.

The [native Shipping Profiles continuation](./slices/39-native-shipping-profiles.md)
uses existing Fulfillment and Product Link sources for the selected native
profiles and retains exact Option and Link observations. Paired acceptance is complete.

The [native Shipping Option Types continuation](./slices/40-native-shipping-option-types.md)
uses the existing Fulfillment source and extends the trusted native upsert
owner for the genuine timestamp-advancing update inverse. Paired acceptance
is complete.
