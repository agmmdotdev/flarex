# Shared Logical Storage Redesign

## Status And Scope

Sequencing warning: [advanced framework schema evolution](./deferred-framework-schema-evolution.md)
is a separately approved follow-on after the core redesign. GLS work establishes
shared foundations, existing safeguards and safe refusal, not a general upgrade
or data-conversion engine. This boundary supersedes earlier wording that made
full migration/ownership transitions prerequisites for core completion.

Status: accepted development-phase architecture replacement; implementation
pending. The owner chooses generic physical storage with logical Application,
Payload and Medusa tables and permits proper core redesign rather than adapter
workarounds or preservation of unshipped internals.

This domain owns the cross-consumer logical-storage contract, physical placement,
index/constraint/relation replacement, connected migration and retirement. It
does not create a universal transaction API or move framework business semantics
into core. Runtime optimization follows this storage decision.

## Current Sources Of Truth

- [Accepted database design](../../design-notes/flarex-db-accepted-design.md) and
  [shared logical storage decision](../../design-notes/flarexdb-shared-logical-storage.md)
  own the target, replacement authority and tradeoffs.
- [Query and constraint acceptance](./02-query-and-constraint-acceptance.md)
  owns the early source-to-proof matrix, native-Link distinction, pending-state
  witnesses and comparison requirements. These are required tests, not results.
- [Core execution design](../../design-notes/flarexdb-core-execution-redesign.md)
  and [CE gates](../shared-transaction-core/10-core-execution-redesign.md) own
  materialization/coordination costs, native evidence and the fair PostgreSQL
  reference. Both candidates use PostgreSQL; no second production engine is planned.
- [Package boundaries](../16-package-boundaries.md) own dependency placement.
- [Application evolution planner](../../packages/managed-schema/src/Planning.ts),
  [Application apply/build composition](../../packages/persistence-postgres/src/applicationManagedSchemaApplication.ts),
  [framework coordinator](../../packages/persistence-postgres/src/migrationCoordination/freshCoordinator.ts)
  and [framework migration metadata](../../packages/persistence-postgres/src/migrationCoordination/schema.ts)
  are the starting owners for logical evolution consolidation.
- [Schema](../../packages/persistence-postgres/src/schema.ts),
  [ordered index codec](../../packages/flarex-protocol/src/ordered-index.ts),
  [index persistence](../../packages/persistence-postgres/src/appIndexEntries.ts)
  and [relation repository](../../packages/persistence-postgres/src/appRelationEdges/Repository.ts)
  establish the current generic foundation.
- [Commerce physical naming](../../packages/persistence-postgres/src/relationalSchema/physical/canonical.ts),
  [commerce store](../../packages/persistence-postgres/src/commerceTransaction/store.ts),
  [CMS documents](../../packages/persistence-postgres/src/cmsTransaction/documents.ts)
  and [Payload compilation](../../packages/payload-adapter/src/collections.ts)
  establish the current replacement gaps.
- Existing [ordered-index database tests](../../packages/persistence-postgres/test/orderedIndexKeyCodec.postgres.test.ts),
  [index repository tests](../../packages/persistence-postgres/test/appIndexEntries.postgres.test.ts),
  [Payload collection contracts](../../packages/payload-adapter/test/collections.test.ts)
  and [connected Variant/Pricing workflow](../../packages/medusa-adapter/test/product-variant-pricing-workflow.test.ts)
  are regression inputs, not tests of the unimplemented target.
- [Medusa adoption](../flarexdb-framework-integration/06-medusa-adoption.md),
  [Payload adoption](../flarexdb-framework-integration/07-payload-adoption.md),
  [native foundation](../flarexdb-foundation/README.md),
  [shared transaction core](../shared-transaction-core/README.md), and
  [workflow foundations](../workflow-foundations/README.md) retain domain ownership.

## Current Architecture

Application/Payload data already uses fixed physical row, index, unique and
edge families. Definitions and scoped keys identify logical data. Payload's
collection compiler currently admits a narrow unique-field contract, emits no
ordinary logical indexes, and CMS non-ID find uses bounded collection reads.
Generic storage therefore exists without complete generic framework query support.

Medusa currently compiles admitted models to physical module tables. Deployment
identity participates in table/index names and target namespace authentication.
The current Product/Variant/Pricing/Link implementation is regression evidence,
not the target physical model. Its native tests and exact numeric/index/link
contracts are valuable replacement witnesses. Existing code is not relabeled as
already using generic storage.

## Invariants And Trust Boundaries

- No physical table/index set per shop, deployment, module or logical index by
  default. Physical growth follows shared-family evolution and capacity placement.
- One logical semantic owner per table; scope and deployment bindings protect
  row, index, unique, relation and recovery access.
- Shared core owns enforcement, resource accounting, settlement and publication.
  Adapters translate; they do not emulate missing core guarantees.
- Preserve intended Application OCC, Payload lifecycle and Medusa business
  semantics through explicit execution profiles. No transaction spans external
  effects or workflow suspension.
- All admitted writes settle data, derived state, outcomes and events atomically.
  Missing capabilities fail closed, with no generated-table fallback.
- Implementation approval is bounded by a concrete core contract and witnesses;
  ordinary in-scope fixes, validation and cleanup need no repeated approval.

## Decisions And Rationale

Generic physical storage is the accepted target. Fixed shared Medusa module
tables are only a comparison candidate if measured evidence requires reopening
that decision. Deployment identity remains authorization/definition metadata;
it must not implicitly allocate a complete physical commerce schema.

The current `fx_app_*` internals may be redesigned around all three consumers.
There is no requirement to force Medusa into an insufficient Application-shaped
API. Nor may a new commerce-only engine be hidden behind a common interface.
Reuse proven owners first, correct them when inadequate, and remove displaced
contracts and runtime paths as consumers move.

## Convex Compatibility And Flarex Divergences

Retain logical schema/table/index authoring and the native Application behavior
where portable. Inspect the enclosing Convex table registry and index metadata
sources for the matching logical contract. Shared Postgres families, logical
relational enforcement, framework lifecycle ownership and distinct transaction
profiles are Flarex decisions, not claims about Convex physical storage.

## Implemented Capabilities

Current row/index/unique/edge kernels, core settlement/recovery, private framework
operations and source-preserved module/workflow tests provide the starting point.
No gate below is completed by this documentation change. Existing PGlite and
Postgres tests remain evidence only for their actual current implementation.

## Known Gaps And Limitations

- Generic Medusa schema/index/query translation and mutation materialization do
  not exist as a proven replacement of the physical relational path.
- Native conditional uniqueness, decimal/null/order semantics and rich Link
  constraints need an explicit shared-core capability matrix.
- Payload ordinary/compound index compilation and indexed non-ID queries need
  connected core work, not only collection-schema acceptance.
- Generic families do not remove catalog-dependent guards, early scope locks,
  request evidence cost, build cost, tenant skew or shared-database contention.
- Generic schema evolution still needs conversion/build/readiness and old-reader
  handling. No independent-schema or production performance claim is proven.
- Cross-framework relationships, authorized reverse traversal and dependency-aware
  evolution have not been proved as one connected Application/Payload/Medusa path.
- Application evolution and framework structural installation remain distinct
  implementations. Shared storage does not itself consolidate their metadata,
  progress or activation responsibilities.
- Existing catalog namespaces and Payload-generated Application definitions do
  not prove joint admission of all three producers, existing-table overlays or
  safe transfer of write authority. Public APIs are not a prerequisite to the
  required private core proofs.

## Target Direction

Implement one connected neutral storage capability with real Application,
Payload and Medusa consumers. Preserve their business semantics while allowing
the core schema, index and relation machinery to change. An implementation
preflight should show representative native calls, the shared contract they
use, the exact incompatibilities being replaced, and the paths removed.

Logical evolution must converge on shared core owners across the three consumers,
with framework-specific compilation and conversion semantics at the boundary.
GLS1 inventories both migration metadata sets and overlapping responsibilities;
GLS4 consolidates the admitted core installation/build/readiness path and records
extension contracts for later evolution. General transition orchestration is
deferred. Do not freeze Application APIs or preserve a parallel engine to avoid
correcting them. Platform physical upgrades remain a distinct concern.

## Early Query And Constraint Gates

The [acceptance contract](./02-query-and-constraint-acceptance.md) is part of GLS1
and the connected GLS2/GLS3 deliverables, not a new metadata-only program. GLS1
maps calculated Pricing and Payload indexed operations to a finite neutral
query contract, declares exact value/unique-null/relation policies, and specifies
pending visibility and the invariant/lock protocol. It also defines commerce
history obligations, native cache lifetimes and predeclared comparison targets.

GLS2/GLS3 must execute representative calculated-pricing access paths, indexed
Payload non-ID and unique operations, conditional-unique restore, rich Link
records, pending indexed reads and distinct-connection constraint races. Full
Pricing module admission and advanced migrations remain separate. A passing
candidate-only checkpoint cannot substitute for these execution proofs.

The native Module Link baseline lacks endpoint FKs. Preserve its declared
cardinality/lifecycle behavior; strong local references add an explicitly
admitted existence/deletion contract. Missing schema dependencies always refuse,
but missing record targets are governed by the selected relationship policy.
Do not strengthen every Link implicitly or weaken a declared strong reference.

GLS5 measures and completes coordinated publication-lock cutover and capacity.
It does not defer concurrency design until after shared writes exist. Temporary
coarse exclusion can prove safety, not independent-operation overlap. Each
migrated consumer must pass its applicable acceptance witnesses before its old
path is removed; final GLS6 retirement audits the complete set.

Core CE0 attribution and benchmark-equivalence work run within GLS1, not after
framework migration. CE1 batch materialization and CE2 enabled-index lifecycle
proofs accompany GLS2/GLS3 writes and GLS4 readiness. CE3 covers the complete
commit/lock protocol, including index-state contention and sequence-stamped
materialization; GLS5 completes its applicable cross-owner cutover/capacity.
CE4 journal coalescing is conditional native work, not a prerequisite for all
frameworks. CE5 contributes connected acceptance and final cleanup to GLS5/GLS6.
These gates do not expand the candidate-only composition slice or resurrect the
generated commerce-table destination. A smaller scope lock alone is not proof
that shared index/metadata contention or per-action SQL has been removed.

## First Core Composition Gate

The [first implementation preflight](./01-schema-composition-preflight.md)
maps current producer/admission owners and proposes a persisted, authenticated
candidate-only slice. It requires implementation approval and does not complete
GLS2 storage execution or authorize new serving/writes. The entire GLS1 inventory
and performance baseline remain separate obligations for the later owners.

GLS1 specifies the [composition contract](../../design-notes/flarexdb-shared-logical-storage.md#core-schema-composition-before-developer-apis).
The first GLS2 deliverable proves it through private compiler outputs and
internal admission calls, before downstream storage/index work relies on its
identity and ownership model. Do not defer core preparation to future developer
API work or build a second catalog for generated framework schemas.

- Compose an Application declaration, a supported Payload-owned collection and
  actual admitted Medusa model definitions in one authorized candidate graph.
  Resolve relationships by stable qualified identity without redeclaring Medusa
  fields in Application code. Reject missing or unauthorized dependencies.
- Bind a Payload view to an existing Application table. Verify one table identity,
  definition authority and row history; repeated compilation/admission must not
  create another copy. Reject incompatible overlay field/relation definitions
  and competing schema owners instead of merging by name.
- Distinguish source provenance, schema ownership and write policy. Verify an
  extra read surface cannot mutate its target. Exercise stale/unauthorized
  requests and safe refusal of any unimplemented write-owner transition.
- Record the identity/ownership/fencing requirements of a future Application-to-
  Payload write-policy transition. Its full orchestration and recovery proof
  belong to the deferred evolution work; core admission refuses it until then.
  Do not make its implementation a GLS4 prerequisite.
- Inventory Application-only binding/planning assumptions and migrate the
  affected owners and callers within each approved slice. Keep one catalog and
  evolution authority; retain original behavior and remove displaced glue.

Developer-facing declaration syntax, generated handles/APIs, dashboard routes
and CMS interfaces are explicit non-goals. Use real producer outputs and core
capabilities for these proofs; test fixtures may not emulate missing admission.

## Early Cross-Framework Proof

GLS1 defines this contract, GLS2 supplies indexed endpoint access, and GLS3
executes the connected relation proof. GLS4 proves admitted activation/recovery
and unsupported-transition refusal. Full schema/data transition orchestration
comes later. Discover dependencies now without implementing every transition;
target behavior remains unimplemented.

- Create a Medusa product through its admitted service/workflow, a Payload page
  through Local API, and an Application record through its intended execution
  path. Declare relationships across all three and include one originating in
  an admitted Medusa-owned extension. Do not prove only references into commerce.
- Traverse forward and backward through admitted APIs with selective database
  access. Prove source/target access rules, draft/soft-delete visibility, bounded
  fan-out and refusal across two shops, even when their local IDs match.
- Exercise concurrent strong-reference insertion and target deletion, explicit
  deletion/restore policies and dangling-target refusal. Separately characterize
  native-Link missing endpoints, cardinality, custom data and conflicting restore;
  stronger Link enforcement needs an explicit compatibility decision. A reverse
  index must not become an independently writable source of truth.
- Present an incompatible endpoint candidate while another framework depends
  on it and prove refusal without changing active authority or data. Preserve
  coverage for already admitted builds/activation and concurrent writes. Defer
  general conversion/backfill orchestration and coordinated cyclic transitions.
- Verify rollback, duplicate requests and uncertain-COMMIT recovery for the
  admitted transaction profile. Where cross-owner mutation is required, use
  each owner's behavior and an explicitly admitted composition; independent API
  calls do not become atomic because storage is shared.

Run fast PGlite semantics and ordinary-role Postgres concurrency/query-plan
witnesses, preserving framework-native assertions. A missing core guarantee is
a blocker to report with a proposed owner correction, not an adapter workaround.

## Next Correctness Gates

| Gate | Coherent outcome | Completion evidence |
| --- | --- | --- |
| GLS1: contract and baseline | Inventory three-lane semantics and both migration systems; specify calculated-pricing/Payload access plans, exact values, relation policies, pending visibility, invariant/lock order, history/cache obligations and performance targets. | Source-to-proof matrix and named retain/extend/replace/delete owners; native-Link versus strong-reference distinction; representative same-workload comparators, cost metrics and proposed breaks; durable/public obligations distinguished from resettable fixtures. |
| GLS2: core composition, shared definitions and indexes | Prove candidate-only joint admission first, then typed ordered values, conditional indexes/claims and operation-bounded queries through real consumers; begin the representative Pricing query proof. | Stable identities and serving refusal for unsupported metadata; decimal/null/collation differential tests, indexed Payload non-ID/unique operations, pending index membership and concurrent unique-claim/restore witnesses; selective SQL without tenant DDL. |
| GLS3: logical relations and atomic writes | Complete the representative Pricing query and connected workflow, rich Links/strong references, pending graph state and shared materialization/publication under the previously specified invariant protocol. | Native result/ordering/count assertions; separately characterized Link and strong-reference policies; rich data, parent-delete/reference-insert and cardinality races, pending new/old index reads, rollback, duplicate requests and lost-COMMIT recovery on the applicable database lanes. |
| GLS4: shared core readiness and evolution boundary | Consolidate admitted installation/build, validation, progress/recovery and serving readiness across the three consumers; migrate callers off displaced structural migration paths and remove obsolete components; record extension contracts for later evolution. | Admitted activation/build and concurrent-write safeguards, dependency/stale-definition refusal, crash/resume and pinned recovery; one authority per responsibility and no fallback; unsupported upgrades/conversions/ownership transfers remain blocked; no advanced evolution implementation is required for this gate. |
| GLS5: coordinated cutover and capacity | Complete coarse-lock replacement across affected owners using the protocol designed in GLS1 and exercised with GLS2/GLS3 writes; validate bounded work and tenant fairness. | Distinct-connection barriers prove independent overlap separately from conflicting-invariant safety; no mixed lock-order fallback; many scopes/deployments, hot tenants, maintenance, WAL/history and declared latency/resource limits; hosted proof separately gated. |
| GLS6: final retirement | Audit complete consumer cutover and all applicable query/constraint acceptance witnesses; remove remaining displaced commerce physical storage and migration components. | Representative Pricing, indexed Payload, declared relation policies and pending/concurrent constraints are proved before final retirement; no generated commerce DDL, duplicate authority, parallel logical migration engine or fallback; obsolete tables follow the approved upgrade/reset policy; retained platform/system consumers and original behavioral coverage are documented. |

These are capability gates, not instructions to build a whole core before
exercising consumers. GLS2/GLS3 must run real consumers as capabilities land.
Each gate includes in-scope caller migration, obsolete-code removal, roadmap
reconciliation and one coherent verified commit. GLS6 is the final audit, not
permission to postpone routine cleanup. When integration exposes a core mismatch,
preserve the witness, identify the responsible owner, record the expected/actual
behavior, and present a concrete correction with alternatives, compatibility,
cleanup and validation gates. Request explicit core-correction approval before
dependent implementation unless the existing approved slice already covers that
exact correction. State that coverage when continuing; do not repeatedly seek
approval for ordinary in-scope fixes. Broad development-phase redesign permission
does not authorize every newly discovered core contract change.

## Relationship To Runtime Scalability

[Runtime scalability](../shared-transaction-core/09-runtime-scalability-redesign.md)
still supplies useful attribution, operation budgets, integrity, lock and
durable-workflow requirements. Its former R0/R1 sequence is subordinate to
GLS1-GLS3: use R0 instrumentation for the baseline, then implement operation
bounds on the shared logical target. Do not first expand or optimize the
generated-commerce-table architecture as the destination.

R2 readiness contracts are specified with GLS1 and preserved in early serving
admission, with consolidation at GLS4. R3's invariant/lock design belongs to
GLS1 and its constraint races to GLS2/GLS3; GLS5 completes coordinated lock
cutover, overlap and capacity proof. Do not read GLS5 as permission to postpone
concurrency correctness. Durable workflow R4 remains consumer-driven and is not
a prerequisite for migrating database-only atomic commerce. Keep original native
tests as regression evidence and label approved divergences explicitly.

## Validation And Retirement Inventory

Use the [accepted replacement inventory](../../design-notes/flarexdb-shared-logical-storage.md#replacement-compatibility-and-completion).
GLS1 resolves every entry to actual files, consumers, supported contracts and
removal gates; it does not invent a compatibility requirement from file presence.
Both PGlite and ordinary-role Postgres are required for relevant storage claims.
Review significant code with both project reviewers; docs-only planning uses
main-thread review. No test fixture may implement missing core behavior.

Performance measurements separate logical index entries from physical SQL object
counts, selected rows from total stored data, CPU from network/lock wait, and
warm requests from builds and history maintenance. Use natural optimizer plans
with representative statistics; a fixed table count or a forced index scan is
not a scalability result. The shared-database baseline must eventually include
capacity placement and tenant fairness, not only one empty-shop benchmark.

Follow the [core reference equivalence checklist](../../design-notes/flarexdb-core-execution-redesign.md#equivalence-checklist):
compare the current core with a minimal isolated PostgreSQL implementation of
the same admitted guarantees, then with the replacement and actual framework
paths. Distinguish matched-layout orchestration cost from a separately labeled
relational-layout comparison. A bare UPDATE or rollback-only test does not
represent complete OCC, constraint, publication, durability and replay work.
Benchmark code must never become production dispatch or a fallback storage lane.
