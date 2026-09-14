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

## Target Direction

Implement one connected neutral storage capability with real Application,
Payload and Medusa consumers. Preserve their business semantics while allowing
the core schema, index and relation machinery to change. An implementation
preflight should show representative native calls, the shared contract they
use, the exact incompatibilities being replaced, and the paths removed.

## Next Correctness Gates

| Gate | Coherent outcome | Completion evidence |
| --- | --- | --- |
| GLS1: contract and baseline | Inventory current three-lane schemas, query/mutation semantics, identities, constraints, profiles and retained consumers; freeze the first connected replacement contract and performance targets. | Exact source/test mappings; representative Product/Variant/Pricing/Link graph and Payload/Application calls; same-workload baseline; named durable environments and public/issued obligations distinguished from resettable fixtures. |
| GLS2: shared logical definitions and indexes | Implement the admitted typed values, composite/conditional indexes, unique ownership, scoped identity and query bounds in existing neutral owners; wire one real consumer from each lane. | Different deployments and logical schemas use the same physical families; exact decimals/nulls/order and active-handle uniqueness pass; actual SQL is selective; index creation means logical metadata/build work, not tenant DDL. |
| GLS3: logical relations and atomic writes | Complete rich Link records, relationship integrity, pending state and complete shared materialization/publication for the connected workflow. | Native assertions plus parent-delete/child-insert, missing endpoint, pair/cardinality, restore/cascade, cross-scope, rollback, duplicate request and lost-COMMIT witnesses on both database lanes as applicable. |
| GLS4: logical evolution and serving admission | Add compatible schema/index builds and data conversions through existing lifecycle owners; bind different logical schemas without physical module-table creation. | Concurrent-write backfill coverage, stale-definition refusal, crash/resume, revision-pinned readers/recovery and deliberate integrity contract; measured build and warm admission costs. |
| GLS5: concurrency and capacity | Replace coarse exclusion only after the shared invariant protocol is approved; prove bounded work and tenant fairness. | Real Postgres barriers, query plans and declared latency/resource limits; independent/conflicting workloads, many scopes/deployments, hot tenants and mixed framework traffic; hosted proof separately gated. |
| GLS6: final retirement | Finish consumer cutover and remove displaced commerce physical storage paths plus obsolete compiler/adapter contracts. | No generated commerce DDL or fallback in the target runtime; no duplicate authoritative rows, indexes, relations or recovery engine; named retained system/lifecycle DDL users remain explicit; all owning docs reflect actual status. |

These are capability gates, not instructions to build a whole core before
exercising consumers. GLS2/GLS3 must run real consumers as capabilities land.
Each gate includes in-scope caller migration, obsolete-code removal, roadmap
reconciliation and one coherent verified commit. GLS6 is the final audit, not
permission to postpone routine cleanup. A core contract mismatch is corrected
at its owner under the approved slice; materially different authority or public
semantics require a focused revised decision.

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
