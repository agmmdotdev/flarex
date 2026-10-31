# Payload and Medusa capability migration map

Status: **Planning only; source-inspected existing behavior and replacement gaps.**
No runtime validation is claimed by this map. The accepted design, existing
goal and owning capability plans retain authority; the proposed sequence below
does not authorize implementation or activate additional framework features.

## Reading the map

The destination is the translated runtime in existing packages and apps, not
the retained candidate in experiments/core/src. Payload and Medusa already have
substantial bounded native integrations on the earlier persistence owners.
Preserve those observable behaviors while replacing their core-facing plumbing.

Use three distinct statuses:

- **Foundation available:** implemented translated machinery that a native path
  can use; it does not establish that the framework is connected to it.
- **Migration required:** existing admitted native behavior whose equivalent
  execution and proofs still need the translated owners.
- **Deferred/unsupported:** outside the existing admitted profile. Preserve its
  refusal; do not invent a compatibility obligation from a framework export.

The decisive current boundary is
[requireCoreApplicationSchemaSupport](../../../../packages/persistence-postgres/src/application/coreSchema.ts):
the translated caller refuses non-V1 native manifests and decimal index fields
because native write ownership, exact values, uniqueness and references are not
connected. Shared table namespaces and ordinary index readiness cannot bypass
that gate. The [native activation boundary](../slices/07-shared-schema-lifecycle.md#native-boundary-and-retirement)
records the same limitation.

Source identities are the [current Convex pin](../CONVEX-REFERENCE-UPGRADE.md),
the [recorded Medusa fork](../../../../third_party/medusa/SOURCE.json) at
48d5cc675e4e8bc821e22c20c88a751acc66fb5f (2.13.4 package baseline), promoted
executing Medusa packages, and genuine Payload 3.88.0 from the
[adapter manifest](../../../../packages/payload-adapter/package.json).
At each implementation slice, identify actual source/dist exports and generated
artifacts. Unrelated shared-worktree changes require coordination and do not
silently enlarge the admitted inventory.

## Integration boundaries to preserve

Payload's existing path is
[direct binding](../../../../packages/payload-adapter/src/direct/binding.ts) or
[borrowed participant](../../../../packages/payload-adapter/src/participant/binding.ts)
-> [operation translation](../../../../packages/payload-adapter/src/operations.ts)
-> genuine Local API -> [database adapter](../../../../packages/payload-adapter/src/adapter.ts)
-> trusted CMS capabilities -> outer settlement.
Native access, validation and population remain Payload-owned. Direct CRUD/read
and borrowed Application participation have different admitted operations.

Medusa's existing path is admitted workflow/service -> native module behavior ->
confined repository/query/Link translation -> trusted commerce capabilities ->
outer settlement. [Module construction](../../../../packages/medusa-adapter/src/module/definition.ts)
and [workflow execution](../../../../packages/medusa-adapter/src/workflow/runtime.ts)
are important seams. The latter invokes genuine executeWorkflow with the admitted
atomicRootOutcome policy. Preserve native callbacks, compensation, errors and
event meaning; redesign construction or repository interfaces that force the
old transaction choreography.

Both schema producers feed shared logical definitions and admission. They do
not own independent persistence, index, migration or commit engines.
Framework code must receive confined capabilities rather than raw SQL, scope
clocks, commit functions or unrestricted native-table writes.

## Rewritten core foundations and missing native capabilities

| Capability | Translated foundation | Native gap / correct owner |
| --- | --- | --- |
| Shared physical storage | Five-table document/index persistence, scoped ownership and atomic batches on the selected Application path. | Route native logical records, catalogs, constraints and required durable outcomes through these owners; inventory named data before cutover. Five tables alone prove no framework compatibility. |
| Snapshots and pending writes | Timestamped snapshots, ordinary index overlays, dependency/conflict checking and shared Application root ownership. | Connect direct native requests and borrowed participants to the same effective pending state, with their own visibility, flush/checkpoint and retry contracts. |
| Index queries and caches | Full-table/index ranges, ordered traversal, bounded limits, Application streaming/cursors and snapshot-aware cache machinery. | Native predicate trees, null semantics, decimal order, logical-root pagination, filtered counts, joins/aggregates and computed ordering need admitted shared query plans. Internal table counts are not filtered listAndCount. |
| Values and identifiers | Convex-style values, qualified logical identities and ordinary ordered keys. | Preserve native public IDs, exact decimals, dates/timestamps, SQL-real normalization, null/missing/default distinctions and serial values. Reuse sound codecs after dependency review; producer conversion meaning stays native. |
| Native write ownership | Logical namespaces and Application schema activation exist. | Authenticate producer/schema ownership separately from write permission and request access; reject direct Application writes to native-owned records. |
| Uniqueness and constraints | Ordinary document validation and index maintenance. | Core must atomically enforce required fields, admitted CHECK semantics, compound/conditional uniqueness, null participation, claim release/reuse and concurrent conflicts. An ordinary index is not a unique constraint. |
| References and Links | IDs and ordinary forward/reverse access building blocks. | A table-typed ID does not prove target existence. Core needs policy-driven integrity, cardinality, deletion/restoration and pending target checks; native Links and strong references retain different policies. |
| Schema and index lifecycle | Logical proposals, validation, enabled/pending generations, backfill and atomic schema/index/program activation on the bounded Application path. | Migrate native producers, dependency/ownership admission and native constraint builds; prove initial install and required cutover recovery. Producer representability is not activation. |
| Settlement, publication and recovery | Translated commit/persistence/publication mechanisms serve bounded Application calls. | Attach admitted native result, event and uncertainty semantics to the trusted outer owner; prove closed capabilities and no duplicated native work. Old framework journal layouts are not the target contract. |
| Cached native reads | Snapshot-qualified ordinary-index pages, exact revision hydration, invalidation and reconstruction exist for Application. | Native value projections, predicates, authorization and every relevant writer must participate before native cached serving. Prove fill/publication races and permission freshness; general GC and production capacity remain open. |
| Host and resource lifecycle | Portable core with the selected Application Worker/DO path and bounded cache proofs. | Prove actual native host placement, cancellation/drain, cold restart, query selectivity and complete-request cost. Workerd transport around Node-hosted framework code does not prove native DO execution. |

Current translated owners include
[core transaction](../../../../packages/persistence-postgres/src/core/transaction.ts),
[core persistence](../../../../packages/persistence-postgres/src/database/corePersistence/),
[Application mutation composition](../../../../packages/persistence-postgres/src/application/coreMutation.ts)
and the [Application DO](../../../../apps/executor/src/applicationDO.ts).
The [shared schema slice](../slices/07-shared-schema-lifecycle.md),
[snapshot/cache slice](../slices/06d-snapshot-index-cache.md) and
[goal](../GOAL.md) retain their precise implemented and remaining boundaries.
Current schema/validator work in progress is not a completed native gate.

The concrete storage declaration is
[database/schema/corePersistence.ts](../../../../packages/persistence-postgres/src/database/schema/corePersistence.ts).
The current [index query grammar](../../../../packages/flarex-protocol/src/index-range.ts)
and [ordinary key construction](../../../../packages/persistence-postgres/src/core/documentIndex.ts)
explain why range support alone does not establish native query or exact-decimal
support. Reuse the existing
[persistence scenarios](../../../../packages/persistence-postgres/test/core/persistenceScenarios.ts),
[query scenarios](../../../../packages/persistence-postgres/test/core/queryScenarios.ts),
[bootstrap/recovery scenarios](../../../../packages/persistence-postgres/test/core/bootstrapScenarios.ts)
and [cache scenarios](../../../../packages/persistence-postgres/test/core/indexCacheScenarios.ts)
as core prerequisite witnesses, paired with the native proofs below.

The current pinned Convex PostgreSQL schema, value domain, Transaction::finalize,
transaction-index overlay and schema registry supply translation evidence.
Convex's Int64/Float64 value domain does not supply a native decimal type or
Payload/Medusa lifecycle semantics. Use the executing frameworks for those
requirements and record necessary mechanism differences through the existing
[divergence process](../divergences/README.md).

## Payload capability map

The [Payload baseline](./payload.md) and executing contracts define separate
profiles. Their union is not a new universal request shape. All existing native
rows below require migration; none claims completed native five-table execution.

| Capability | Existing admitted behavior | Replacement work and compatibility witness |
| --- | --- | --- |
| Collection compilation | Compiler-owned bounded text, number, checkbox and date fields; native sanitation/defaults/validation and configured multiple collections. | Adapt producer output to shared catalog/activation. Compare genuine buildConfig/Local API behavior, managed-field refusal and invalid definitions; do not replace native validators with a second framework model. |
| Direct operations | create, update, delete, find, findByID and count; standalone reads have their own binding. | Supply translated confined CMS capabilities. Compare complete native results, missing records, errors and request ownership through Local API rather than direct database-adapter calls. |
| Borrowed Application calls | create/update/delete/findByID only, over admitted scalar/content-relations; delete requires finiteRoot and preference-cleanup authority. | Bind the exact parent attempt, preserve read-your-writes and outer-only settlement. Refuse borrowed find/count and foreign, expired or closed capabilities. |
| Scalar/default/null behavior | Selected nullability, native defaults, managed timestamps and omitted-versus-explicit-null behavior; Payload normalizes negative zero to zero. | Preserve row and ordered-key semantics, patch omission and complete decoded output. Include missing/null, finite-number and signed-zero cases without changing Application value semantics globally. |
| Indexed filters and pages | Selected equality prefixes and numeric ranges over ordinary scalar/compound indexes; native ID page order and bounded exact counts. | Lower admitted predicates to translated indexed work, including pending membership. Verify page/count agreement, selectivity and refusal on exceeded complete-set bounds; a LIMIT alone is not a scan bound. |
| Uniqueness | Required scalar/compound constraints and nullable-key behavior through shared claims. | Enforce at final core acceptance, with pending key reuse and two-connection collisions. Verify native error presentation and no partial document/index/event state. |
| Request lifecycle/access | Genuine Local API with overrideAccess:false, request-owned dataloaders and same-request nesting. Ordinary collections are bounded/hook-free; selected private access/hook instrumentation has its own contract. | Preserve access-combined filters, transaction ownership and native lifecycle ordering. Test denied access, nested failure and request reuse isolation. Do not infer arbitrary hook or remote-effect support. |
| Optional one relationship | One admitted optional monomorphic configured relationship, depth-one forward population and detached mutable results. | Enforce declared target/deletion policy against pending state; retain native access and population. Test reassignment, clear, missing target, concurrent delete and mutation of a returned populated object. |
| Many relationship | Separate fresh-install content-many profile: ordered relatedPosts, at most 32 targets, preserve/clear semantics and duplicate refusal. | Preserve authoritative relation order, cardinality and atomic index maintenance. Test omission, empty array, duplicate/overflow, reorder and rollback. Do not add it to borrowed participation implicitly. |
| Reverse joins | Separate fresh-install content-joins profile, depth one, first window only, default 8 / maximum 16, no exact total count. | Preserve reverse-index membership and native page shape, including access and lookahead. Test limits, incomplete windows and pending changes without claiming general cursor/count support. |
| Delete/preferences | Exact internal payload-preferences cleanup and atomic publication; ordinary deleteMany remains unsupported. | Carry cleanup into the same root and enforce exact selected IDs. Inject late cleanup failure and verify document, preferences, relations and events all roll back. |
| Private cross-framework extensions | Selected Product reference read/save/reverse-page and binding-lifecycle profiles with protected access. | Port existing private authorization, target-liveness, freshness, replay and schema-binding proofs. General native population of commerce targets is not established. |
| Request replay and cancellation | Selected direct/borrowed outcome recovery and explicit retry policies; no general automatic native replay. | Preserve owned string/Promise transaction IDs, caught-child rollback-only state, closed/foreign-ID refusal and abort/drain. Separate committed replay from an admitted whole-root retry and check native callback invocation counts. |
| Named schema transitions | Specific scalar-to-optional-one additive transition/rebinding witnesses; many/joins require fresh installation. | Preserve named existing data/binding behavior in shared lifecycle. Test old-writer refusal, interrupted activation and unsupported many/joins successors, including an empty existing collection; do not infer general conversions. |

Payload features outside this compatibility migration remain refused unless a
later capability slice admits them: globals, drafts/versions, jobs, general
auth/uploads/blocks/arrays, findDistinct, updateMany, ordinary deleteMany,
upsert, general migrations/schema generation and unsupported locale/select/
sort/query forms. Admin/public APIs, arbitrary hooks and native Cloudflare
hosting are separate product/host gates, not implied by Local API parity.

Useful existing Payload witnesses include
[indexed query scenarios](../../../../packages/persistence-postgres/test/integration/payload/payloadIndexedScenario.ts)
and their [PostgreSQL plan checks](../../../../packages/persistence-postgres/test/integration/payload/payloadIndexed.postgres.test.ts),
[unique](../../../../packages/persistence-postgres/test/integration/payload/payloadUniqueScenario.ts)
and [nullable](../../../../packages/persistence-postgres/test/integration/payload/payloadNullableScenario.ts)
scenarios, [configured relationships](../../../../packages/persistence-postgres/test/integration/payload/payloadConfiguredRelationshipScenario.ts),
[population](../../../../packages/persistence-postgres/test/integration/payload/payloadPopulationScenario.ts),
[many](../../../../packages/persistence-postgres/test/integration/payload/payloadManyScenario.ts),
[joins](../../../../packages/persistence-postgres/test/integration/payload/payloadJoinScenario.ts),
[upgrade refusal](../../../../packages/persistence-postgres/test/integration/payload/payloadManyUpgrade.test.ts)
and [request lifetime](../../../../packages/persistence-postgres/test/frameworks/cmsTransaction/cmsRequestLifetime.test.ts).
These use genuine native behavior but need replacement test-driver selection.

## Medusa capability map

The [Medusa baseline](./medusa.md), current module/workflow contracts and their
native tests bound each row. A module's schema or exported service does not admit
every method. All existing native rows require translated-core migration.

| Capability | Existing admitted behavior | Replacement work and compatibility witness |
| --- | --- | --- |
| DML/model/Link compilation | Promoted native definitions plus framework-neutral logical composition; some consumers still retain physical targets. | Adapt producer output to logical identity, ownership, defaults, indexes and constraint admission. Prove fresh installation and refusal of unsupported changes without preserving per-module DDL as destination. |
| Native services/repositories | Selected genuine services and confined repository methods with normalization, serialization and native errors. | Reuse native behavior; adapt repository boundaries to translated reads/writes. Compare scalar/array, empty/omitted, insert/upsert and managed-field semantics through real services. |
| Query/graph reads | Bounded selected filters, relations, graph permissions, ordering and list/count behavior. | Give shared query owners admitted indexed plans and exact resource accounting. Preserve root versus child filtering, complete-set requirements, missing/null and native output shape; no hidden adapter scans. |
| Exact values/defaults | Exact decimal/raw companions, dates/timestamps, finite-number and SQL-real rules, JSON defaults and selected serial values. | Preserve storage, comparisons, ordering and native presentation separately. Compare values beyond binary64 precision, equivalent decimal scales, generated/default values and corruption refusal. |
| Product/Currency/Sales Channel | Native services, Product graph/category/lifecycle/events and bounded Sales Channel associations. | Carry upstream behavioral assertions to translated execution. Include uniqueness after soft deletion, conflicting restore, category graph changes and event publication. |
| Conditional uniqueness and native lifecycle | Active-row unique claims, soft-delete key release, graph replacement, managed timestamps, no-op restore and historical restoration. | Core must preserve atomic before/after membership and admitted null semantics. Soft-delete A, create B with A's handle, then restore A: require the native conflict with no partial rows, indexes or events, including concurrent variants. |
| Module-local relation graphs | Admitted to-one/to-many/many-to-many population and owned Product category/tag/option/variant/image graphs. | Preserve selected target/delete/set-null policies, pivot identity, pending traversal, root versus child filters and returned cascade maps. Test target-deletion races and graph replacement without transferring cross-owner mutation rights. |
| Native Module Links | Explicit pair identity, cardinality, rich data, soft deletion/restoration and native absent-endpoint behavior. | Core enforces the selected Link policy and derived indexes atomically. Preserve rich Link fields and restore conflicts; do not silently turn every native Link into a strong reference. |
| Pricing | PriceSet/List/Price/Rule lifecycle and bounded calculated Pricing/variant-item workflows already execute; current served PriceRule operators are equality-only. | Reuse native selection/calculation meaning over exact shared indexes and query plans. Test currency/quantity, coherent transaction time, active/time-valid lists, matching rules, JSON predicates, exact amount order and pending updates. Full API parity and numeric range-rule serving remain separate. |
| Inventory/Stock Location | Admitted Item/Level/reservation and stock-location workflows, tuple reads and native reference/lifecycle behavior. | Preserve composite selection, quantity checks, reservations and rollback. Race stock/reservation changes on independent connections and compare the complete selected native result. |
| Tax | Selected Region/Rate/Rule workflows and item tax-line calculations. | Preserve reference validation/flush points, numeric normalization and native errors. Test late failure and exact result/event rollback through genuine Tax behavior. |
| Fulfillment/Store | Admitted profiles, types, options, zones/sets, Links, local-provider branches and Store workflows. | Preserve graph membership, inverse updates, ordering and delete/restore behavior. Test selected create/cancel/shipment/delivery/return paths with native compensation. Remote providers remain separate. |
| Cart and Promotion | Bounded native Cart creation/refresh, automatic Promotion computation and existing-cart context/checkout paths are present in current tracked code, including selected Customer creation/deletion/read methods. | Preserve native child-workflow order, defaults, exact pricing/Tax, Promotion rules/budgets/time boundaries and late rollback. This does not admit general Customer/Group or Promotion CRUD, or arbitrary Cart operations. |
| Order and Payment | Selected Order/archive/change/checkout and local System-provider Payment session/collection/authorization/capture/refund branches. | Preserve serial IDs, historical deletion/restore, complete DTOs, event and inverse behavior. Test replay/cancellation/late failure; external gateways and arbitrary order/payment methods remain outside this claim. |
| Workflow grouping/compensation | Genuine executeWorkflow, admitted callbacks/hooks and atomicRootOutcome over one trusted outer outcome. | Preserve native compensation as well as root rollback. Test failing step/hook, inverse failure, pending-work refusal, cancellation/drain and no side-effect replay outside the admitted policy. |
| Durable events/results/recovery | Selected native events and workflow outcomes share trusted publication and recovery. | Reattach event meaning and exact outcome replay to translated durable owners. Lose the COMMIT response, restart and verify one accepted result/event set without rerunning native callbacks. |
| Cross-framework participation | Selected native commerce commands participate with Application and Payload in one explicit root. | Port the existing mixed Product/Pricing/Link/Payload witness early. Prove shared pending reads, one settlement, rollback-only, authorization and complete rollback after a late native error. |

General Customer/Group CRUD, arbitrary module sets, unsupported provider branches,
resumable external sagas, automatic native replay, general populated upgrades and
public/hosted activation are not supplied by this inventory. Keep supported local
System-provider behavior distinct from an external payment gateway integration.

Useful current native witnesses include
[Product lifecycle](../../../../packages/medusa-adapter/test/logical-product-lifecycle-storage.test.ts),
[Pricing storage](../../../../packages/medusa-adapter/test/logical-pricing-storage.test.ts),
[variant-item Pricing](../../../../packages/medusa-adapter/test/logical-variant-item-pricing-workflow.test.ts),
[Cart creation](../../../../packages/medusa-adapter/test/logical-cart-create-root.test.ts),
[Cart refresh/inverses](../../../../packages/medusa-adapter/test/logical-cart-creation-refresh.test.ts),
[Promotion computation](../../../../packages/medusa-adapter/test/logical-native-promotion-compute.test.ts),
[checkout](../../../../packages/medusa-adapter/test/logical-checkout-workflow.test.ts),
[Payment reliability](../../../../packages/medusa-adapter/test/logical-payment-reliability.test.ts)
and [stored workflow replay](../../../../packages/medusa-adapter/test/logical-atomic-stored-workflow.test.ts).
The current [Pricing calculation](../../../../packages/medusa-adapter/src/modules/pricing/calculation.ts),
[Cart root](../../../../packages/medusa-adapter/src/workflows/cart/create-cart.ts)
and [Promotion service](../../../../packages/medusa-adapter/src/modules/promotion/compute-service.ts)
are stronger current support evidence than older preflight status paragraphs.
Direct workflow participation and the narrower borrowed Product attempt remain
separate profiles; its update/retrieve/listByHandle surface is not universal
Medusa participation.

## Compatibility proofs to carry onto the replacement

Existing tests are reusable witnesses, not proof of the translated path. A test
that still constructs the old relational session or finite-capture owner has not
completed migration merely because it passes. Port the genuine native behavior
and observable assertions; replace old physical-table counts, journal layout
and scope-lock choreography with observations of the new owner.

| Proof family | Existing evidence / starting witness | Required replacement result |
| --- | --- | --- |
| Native entry and error behavior | [Payload tests](../../../../packages/payload-adapter/test/), [Payload integration tests](../../../../packages/persistence-postgres/test/integration/payload/), [Medusa tests](../../../../packages/medusa-adapter/test/) and [Product original-case inventory](../../../../roadmaps/flarexdb-framework-integration/preflight/product-upstream-test-cases.json) | Genuine Local API/services/workflows execute the admitted branch on translated storage. Preserve complete outputs, native errors, refusal boundaries and source provenance. |
| Mixed success and failure | [mixedMutationWorkflow.workerd.test.ts](../../../../packages/flarex-backend/test/mixedMutationWorkflow.workerd.test.ts) | Application + Product + Pricing + Link + Payload settle once; a caught late failure cannot publish partial state. No open database transaction spans native/untrusted execution. |
| Borrowed lifetime | [mixedMutationPayloadAttempt.test.ts](../../../../packages/executor/test/integration/mixedMutationPayloadAttempt.test.ts) and [mixed recovery](../../../../packages/flarex-backend/test/mixedMutationPayloadCommerceRecovery.workerd.test.ts) | Reject foreign/closed capabilities; abort and drain real native Promise work; no late completion or leaked scope can publish. |
| Pending query consistency | [query/constraint acceptance](../../../../roadmaps/shared-logical-storage/02-query-and-constraint-acceptance.md) plus real native indexed queries | Move a value between ranges, query old/new memberships, follow new Links and count roots before commit. All consumers see the same pending state; late failure rolls back every derived entry. |
| Uniqueness and exact order | [decimal capability](../../../../roadmaps/shared-logical-storage/06-exact-decimal-indexes.md), native Product/nullable Payload tests | Compare exact numeric order against PostgreSQL; race compound/conditional uniqueness and soft-delete/restore conflicts. Atomic final acceptance, not prevalidation alone, decides the winner. |
| Strong references and native Links | [mixed reference](../../../../packages/flarex-backend/test/mixedMutationPayloadCommerceReference.workerd.test.ts), [concurrency](../../../../packages/flarex-backend/test/mixedMutationPayloadCommerceConcurrency.postgres.test.ts), [native Link lifecycle](../../../../packages/medusa-adapter/test/logical-variant-pricing-link-lifecycle.test.ts) | Preserve reference on soft deletion, reject new invalid assignments, restrict hard deletion until clear; race both orders. Separately preserve native Link cardinality, rich data and allowed absent endpoints. |
| Protected access and reverse reads | [private saves](../../../../packages/flarex-backend/test/privatePayloadReferenceSaves.test.ts), [save concurrency](../../../../packages/flarex-backend/test/privatePayloadSaveConcurrency.postgres.test.ts), [reverse serving](../../../../packages/flarex-backend/test/privatePayloadReverseServing.workerd.test.ts), [reverse scopes](../../../../packages/flarex-backend/test/privatePayloadReverseScopes.workerd.test.ts) | Bind scope/principal/source/generation and fresh permission evidence; prevent cross-shop leaks and direct native writes. Preserve bounded visible lookahead, exact dependencies and pending membership. |
| Retry versus replay | Mixed workflow/recovery tests and [reverse restart](../../../../packages/flarex-backend/test/privatePayloadReverseRestart.test.ts) | Separate tentative receipt replay, committed-result replay and admitted whole-root conflict retry. Resolve unknown COMMIT before unsafe reexecution; recover one outcome/event set after closing the original producer. |
| Schema/binding lifecycle | [binding lifecycle](../../../../packages/flarex-backend/test/privatePayloadBindingLifecycle.test.ts), [ordering](../../../../packages/flarex-backend/test/privatePayloadBindingOrdering.workerd.test.ts), [recovery](../../../../packages/flarex-backend/test/privatePayloadBindingRecovery.workerd.test.ts) | Reject incompatible endpoint/write-owner activation while preserving active data; retain unchanged rebinding, withdrawal, stale/ABA refusal and recovery after withdrawal. |
| Host, selectivity and retirement | Existing native database drivers, translated Application host tests and each slice's acceptance owner | Report PGlite and ordinary-role PostgreSQL separately; use actual overlap, lost COMMIT and query plans. Separately prove native hosting/restart, bounded complete-request performance, required data disposition and removal of displaced callers. |

The selected private reference save/binding/reverse profiles are existing
compatibility obligations. General authorized traversal, a complete bidirectional
three-owner relationship proof including a Medusa-originating extension, and new
pending Product construction remain separate gaps. Do not confuse these with
the already implemented bounded article-to-Product profile.

## Proposed implementation sequence

This is a dependency proposal for later challenged slices, not a new parallel
engine or a requirement to implement every framework feature before migration.

1. **Fix the semantic inventory for the selected slice.** Name exact entry
   profiles, executing versions/builds, retained data and unsupported operations.
   Compare current files with older baseline notes and coordinate foreign work.
2. **Connect native schema and write authority.** Adapt both producers to shared
   logical installation and stable IDs; prove native ownership, dependencies,
   readiness and activation refusal while keeping the current support gate closed.
3. **Close shared prerequisites through real native requests.** Pair neutral
   core tests with a bounded direct Payload collection and a small native Medusa
   service. Add exact values, unique/null rules, query plans and relation policies
   as required by the connected path. Establish error/lifetime behavior here.
   Activate only an individually admitted profile after all of its required shared
   mechanics and native proofs pass; never remove the support gate globally on
   the strength of schema ownership/readiness alone.
4. **Challenge the design with relations and Pricing early.** Exercise conditional
   Product uniqueness, rich Links, exact calculated Pricing and Payload indexed
   filters/pages/counts before broad module migration. Reuse native algorithms;
   missing mechanics belong to the shared owner rather than adapter workarounds.
5. **Migrate one mixed root and its failure graph.** Port the existing
   Application/Product/Pricing/Link/Payload case, then pending visibility,
   rollback-only, cancellation, conflict/replay and lost-COMMIT recovery.
6. **Port private reference authorization and schema-binding behavior, then
   expand the admitted inventory.** Carry current direct/borrowed distinctions,
   selected reverse traversal, native module/workflow cases and Cart/Promotion/
   checkout coverage. Each connected cutover replaces its real callers.
7. **Close lifecycle, data, host and retirement gates.** Prove initial install,
   index/constraint builds, concurrent activation, restart and required named data
   conversion; remove displaced storage/installers/exports/tests after equivalent
   semantic coverage. Measure complete requests and validate actual host placement.

General populated-data schema conversion, native version upgrades and write-owner
transfers remain under the [deferred evolution contract](../../../../roadmaps/shared-logical-storage/deferred-framework-schema-evolution.md).
That deferral does not excuse retaining duplicate installers or skipping a
required migration for existing named data. Unsupported transitions must fail
without damaging the active schema/execution combination.

## Reuse, adapt and replace

| Treatment | Existing investment |
| --- | --- |
| Reuse | Genuine Payload lifecycle and native Medusa services/workflows, business algorithms, normalization, meaningful original assertions and source provenance. |
| Adapt after dependency review | Native schema compilers, query/result translation, pure exact-value/key helpers, repository seams, test drivers and confined capability construction. |
| Replace where displaced | Core-facing SQL/lifetime choreography, per-framework physical installation, duplicate catalogs/journals, old settlement hooks and assertions tied solely to their layout. |

No successful cutover should leave a fallback engine or require a compatibility
wrapper solely to preserve an unshipped internal API. Keep a retained path only
for a named consumer/data obligation with a removal gate. Every runtime slice
still needs the independent current-core/accepted-direction/pinned-Convex
challenge, concrete native witnesses and required database/host validation.

## Evidence discrepancies that affect planning

- Earlier baseline notes exclude Cart creation and Promotion computation. Current
  tracked native workflows/tests include bounded Cart creation/refresh and
  Promotion computation; their selected contracts, not that old exclusion, define
  the migration inventory. This does not imply every Cart/Promotion operation.
- Older statements that calculated Pricing itself is unimplemented are stale.
  Current bounded calculation selects candidates through ID/foreign-key indexes,
  validates exact companions and runs the native selector. This establishes
  existing behavior to migrate, not adoption of the decimal ordered-index
  projection or full Pricing API parity. Preserve that distinction when reading
  the older query/decimal acceptance notes.
- An older schema-binding preflight leaves reverse phases RR2-RR4 pending. The
  [reverse-read owner](../../../../roadmaps/shared-logical-storage/reference-reverse-read-preflight.md)
  and actual serving/recovery/scope tests establish the selected private profile.
  They do not establish general authorized traversal.
- Historical Payload firstProfile and old Medusa source-audit maps are narrower
  than current executing contracts. Conversely, native framework exports are
  broader than the admitted contracts. Neither is an exhaustive support ledger.

This map is a source-based planning aid. Presence of a test, a recorded earlier
pass or metadata representation is not a fresh replacement compatibility proof.
