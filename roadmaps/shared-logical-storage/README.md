# Shared Logical Storage Redesign

## Status And Scope

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
GLS4 completes consolidated execution and dependency-aware activation. Do not
freeze the Application APIs or preserve a separate logical migration engine to
avoid correcting them. Platform physical upgrades remain a distinct concern.

## First Core Composition Gate

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
- Define the complete identity-preserving Application-to-Payload write-policy
  transition now. GLS4 proves old-capability revocation, new-policy activation,
  in-flight request handling and recovery without a dual-writer interval before
  that transition can be admitted. Until then it remains refused.
- Inventory Application-only binding/planning assumptions and migrate the
  affected owners and callers within each approved slice. Keep one catalog and
  evolution authority; retain original behavior and remove displaced glue.

Developer-facing declaration syntax, generated handles/APIs, dashboard routes
and CMS interfaces are explicit non-goals. Use real producer outputs and core
capabilities for these proofs; test fixtures may not emulate missing admission.

## Early Cross-Framework Proof

GLS1 defines this contract, GLS2 supplies indexed endpoint access, and GLS3
executes the connected relation proof. GLS4 adds full transition/recovery
coverage. Do not postpone discovering dependency or activation incompatibilities
until all individual adapters are complete. Target behavior remains unimplemented.

- Create a Medusa product through its admitted service/workflow, a Payload page
  through Local API, and an Application record through its intended execution
  path. Declare relationships across all three and include one originating in
  an admitted Medusa-owned extension. Do not prove only references into commerce.
- Traverse forward and backward through admitted APIs with selective database
  access. Prove source/target access rules, draft/soft-delete visibility, bounded
  fan-out and refusal across two shops, even when their local IDs match.
- Exercise concurrent reference insertion and target deletion, explicit deletion
  and restore policies, cardinality and dangling-target refusal. A reverse index
  must not become an independently writable source of truth.
- Change an endpoint schema while another framework depends on it. Refuse an
  incompatible activation; prove a supported compatible transition and backfill
  with concurrent writes. Define cyclic-dependency disposition before activation.
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
| GLS1: contract and baseline | Inventory current three-lane schemas, query/mutation semantics, identities, constraints, profiles and both migration systems; freeze the first connected replacement contract and performance targets. | Exact source/test mappings; per-table and per-component retain/extend/replace/delete decisions for Application evolution and framework migration, with named consumers and retirement gates; representative Product/Variant/Pricing/Link graph and Payload/Application calls; same-workload baseline; durable/public obligations distinguished from resettable fixtures. |
| GLS2: core composition, shared definitions and indexes | First prove joint producer admission and existing-table overlays, then implement admitted typed values, composite/conditional indexes, unique ownership and query bounds; wire one real consumer from each lane. | First core composition gate passes with stable identities, explicit schema/write ownership and dependency/conflict refusal; different deployments/schemas share physical families; exact decimals/nulls/order and active-handle uniqueness pass; actual SQL is selective; logical index creation does not issue tenant DDL. |
| GLS3: logical relations and atomic writes | Complete rich Link records, relationship integrity, pending state and complete shared materialization/publication for the connected workflow. | Native assertions plus parent-delete/child-insert, missing endpoint, pair/cardinality, restore/cascade, cross-scope, rollback, duplicate request and lost-COMMIT witnesses on both database lanes as applicable. |
| GLS4: shared logical evolution and serving admission | Consolidate Application, Payload and Medusa logical planning, validation/build, progress/recovery and readiness; migrate callers off the separate framework structural migration path for business schemas and remove its displaced in-scope components. | Cross-framework dependency checks and compatible activation; concurrent-write backfill coverage, stale-definition refusal, crash/resume and revision-pinned recovery; one authority per responsibility, no parallel logical migration engine or fallback; deliberate integrity contract and measured build/warm admission costs. |
| GLS5: concurrency and capacity | Replace coarse exclusion only after the shared invariant protocol is approved; prove bounded work and tenant fairness. | Real Postgres barriers, query plans and declared latency/resource limits; independent/conflicting workloads, many scopes/deployments, hot tenants and mixed framework traffic; hosted proof separately gated. |
| GLS6: final retirement | Audit complete cutover and removal of displaced commerce physical storage and framework migration systems, including obsolete metadata tables, coordinators, repositories, compiler/adapter contracts, exports and test scaffolding. | No generated commerce DDL, parallel logical migration engine or fallback; no duplicate authoritative rows, indexes, relations, progress or recovery; obsolete tables removed through the approved physical upgrade/reset policy; any retained platform/system lifecycle DDL component has a named consumer and justification; meaningful behavioral coverage and all owning docs match the replacement. |

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

R2 readiness and R3 concurrency decisions are incorporated at GLS4/GLS5 where
required. Durable workflow R4 remains consumer-driven and does not become a
prerequisite for migrating database-only atomic commerce. Keep original native
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
