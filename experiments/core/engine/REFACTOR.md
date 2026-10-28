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
Name every necessary difference and its reason. Where Convex has no framework
equivalent, inspect the executing native Medusa/Payload source instead.

TypeScript can maintain in-memory state. We need deliberate alternatives to
Rust's ordered, persistent/copy-on-write and concurrent structures, not a ban on
RAM caching or a requirement to invent every data structure. Evaluate existing
libraries, plain TypeScript structures and SQLite indexes by their guarantees
and measured costs. A JavaScript Map is not automatically an ordered index or a
versioned snapshot; a current-state SQLite table is not retained history.

Keep pure calculation local and ordinary function calls direct. Logical modules
do not each need a package, service, transaction or RPC. Host adapters supply
platform mechanisms; portable owners retain validity, visibility and acceptance
rules. Source adaptation requires its own pinned provenance/license disposition;
this direction authorizes architectural reference, not an automatic Rust port.

## One concept and one connected proof at a time

The [decision register](./DECISIONS.md) identifies the single active concept.
The [open-question queue](./OPEN-QUESTIONS.md) holds unresolved dependencies with
references; a queued question is not an instruction to implement it now.

Each focused concept records: Convex mechanism -> required behavior -> owner and
contract -> necessary differences/breaks -> failure and performance witnesses ->
remaining questions. Record its decision or explicit deferral before moving to
the next concept. Once a concrete implementation scope is authorized, complete
that connected outcome, consumer migration and cleanup without seeking permission
again for routine steps already covered by that scope.

Potential proofs, not a selected implementation schedule:

1. Establish the profile-correct logical read/attempt/acceptance boundary while
   retaining or deliberately replacing appropriate PostgreSQL owners.
2. Rebind real existing consumers: a bounded native Medusa Address operation and
   Payload CRUD/population path are candidates, alongside standalone Application
   point/range OCC. Preserve native hooks, outcomes and failure behavior.
3. Prove one DO's local reads, commit publication, restart and cache reconstruction.
   Compare complete operations against the current code and native baselines.
4. Prove two execution replicas separately, including pending conflicts, gaps,
   freshness, authorization and committed-but-unacknowledged recovery.
5. Cut over the selected existing consumers and remove the displaced paths;
   broaden only after their connected guarantees and cost are understood.

Actual native read visibility and replay eligibility may require a different
order or narrower scope. Do not convert all framework commands into Application
OCC. Do not assume final validation can repair disclosure or early business errors
that already escaped. The [validation contract](../VALIDATION.md) supplies the
existing gates; changed guarantees require explicit replacement evidence.

## Completion boundary

A new host or a lower SQL count does not establish removal of the old bottleneck.
For each replacement, name the eliminated work/round trips and the mechanism that
preserves their guarantees. Measure complete native business graphs, CPU, latency,
queueing, misses, retries, memory and warm-up. Reuse existing correctness evidence
without presenting historical cohorts as current performance results.

Current approval is for these design documents. Ownership/commit coordination is
the active concept; runtime implementation, cutover, deployment and data changes
remain unstarted. Preserve current behavior until a connected replacement is
implemented and verified, then retire it rather than accumulate another engine.
