# FlarexDB Framework Integration

## Status And Scope

Status: active accepted roadmap domain. The private framework-artifact
repository has completed its focused PGlite and ordinary-role PostgreSQL
acceptance. Relational values, coordinator metadata/repositories, and all
three fresh-install execution slices are implemented privately. Fresh
installation and one fresh-base-to-additive-successor upgrade have independent
PGlite and ordinary-role PostgreSQL acceptance. General lineage scale and
upgrades beyond that bounded profile remain open. Private binding admission and
synthetic scalar transactions/store and the private scalar CMS Application
commit participant are implemented. Pinned Payload scalar CRUD and fixed nested
hooks are proven privately, including exact preference cleanup and atomic
lifecycle publication under the combined binding. Private Flarex-backed Currency now proves fresh actual-DML installation,
seed-gated serving and shared relational commit publication. Public serving and
production activation remain gated.

The [current gate matrix](#current-gate-status) is the cross-lane status index.
Focused owners define exact contracts and evidence; lane documents link here
rather than maintaining another detailed implementation-status inventory.

The [shared transaction core roadmap](../shared-transaction-core/README.md)
tracks the broader transaction/publication/recovery redesign reconciliation.
Its source ownership audit is complete; physical resource and CMS participant /
materialization replacements are proposed and await approval. Record 36 closes
its bounded extraction; broader implementation and measurement remain open.
This framework roadmap continues to own adapter capabilities and conformance sequencing.

This domain owns the extraction and admission of shared FlarexDB mechanisms
needed by Payload and Medusa, plus the ordered adapter conformance work that
uses them. It coordinates those consumers without replacing the existing
application foundation or making framework semantics part of a universal core.

The accepted destination is one FlarexDB/Postgres authority, two storage
profiles, and three semantic lanes:

```text
Application                 Payload                     Medusa
document schema/OCC         CMS request lifecycle       commerce modules/workflows
document storage            document + lifecycle        reserved relational storage
       \                         |                         /
        scope / schema lifecycle / migration / transaction
          commit publication / feed / outbox / query sync
```

This roadmap does not authorize a public relational API, production framework
activation, raw SQL access, a general cross-lane transaction, or a rewrite of
the existing application commit path.

## Current Sources Of Truth

Use these sources in order:

1. [`../../design-notes/flarex-db-accepted-design.md`](../../design-notes/flarex-db-accepted-design.md)
   owns the general FlarexDB data, trust, transaction, and commit authority.
2. [`../../design-notes/flarexdb-framework-storage-architecture.md`](../../design-notes/flarexdb-framework-storage-architecture.md)
   owns the cross-domain architecture and ownership split.
3. Lane-specific accepted notes own their semantics:
   - [`../../design-notes/flarexdb-native-relational-system.md`](../../design-notes/flarexdb-native-relational-system.md)
   - [`../../design-notes/flarexdb-payload-relational-adapter.md`](../../design-notes/flarexdb-payload-relational-adapter.md)
   - [`../../design-notes/flarexdb-medusa-commerce-adapter.md`](../../design-notes/flarexdb-medusa-commerce-adapter.md)
4. [`../flarexdb-foundation/README.md`](../flarexdb-foundation/README.md) and
   its focused plans own the implemented application schema, OCC, commit, and
   native document-relation foundation.
5. [`../query-sync-engine/README.md`](../query-sync-engine/README.md) owns the
   runtime-neutral downstream query-sync product and kernel.
6. [`preflight/05-core-first-three-lane-readiness.md`](./preflight/05-core-first-three-lane-readiness.md)
   owns the consumer-informed shared-core, Flarex Application, Payload, then
   Medusa proof and promotion order.
7. [`preflight/04-medusa-fork-source-island-and-package-convergence.md`](./preflight/04-medusa-fork-source-island-and-package-convergence.md)
   owns the Medusa source hierarchy, inert fork island, provenance, and later
   package-promotion boundary. The selected Cloudflare-oriented fork is the
   primary Medusa source; official Medusa is historical provenance and
   comparison evidence only.
8. [`preflight/06-medusa-package-capability-source-map.md`](./preflight/06-medusa-package-capability-source-map.md)
   owns the exact pinned-fork capability classifications, reproducibly measured
   65-input Currency semantic graph, and broader exploratory graph constraints.
9. [`preflight/07-payload-release-and-adapter-contract.md`](./preflight/07-payload-release-and-adapter-contract.md)
   owns the exact Payload `3.88.0` adapter, transaction, query, internal-
   collection, migration, relation, and first-profile constraints.
10. [`preflight/08-relational-schema-value-contract.md`](./preflight/08-relational-schema-value-contract.md)
    owns the implemented private relational value vocabulary, normalization,
    framework-artifact composition, evidence receipt, and closed boundaries.
11. [`preflight/09-relational-installation-and-migration-coordination.md`](./preflight/09-relational-installation-and-migration-coordination.md)
    owns the cycle-free installation identity, deterministic scope-isolated
    physical lowering, stable migration collision domain, coordinator ledger,
    recovery, readiness/availability, and database-evidence design.
12. [`preflight/10-relational-coordinator-metadata-and-repositories.md`](./preflight/10-relational-coordinator-metadata-and-repositories.md)
    owns the exact target-local metadata catalog, normalized sidecars,
    timestamp mapping, cold rehydration, private transaction kernels, and
    checkpoint-2 storage evidence.
13. [`preflight/11-target-session-and-fresh-coordinator.md`](./preflight/11-target-session-and-fresh-coordinator.md)
    owns the three-slice checkpoint-3 decomposition, opaque target/session and
    PGlite functional boundary, the private plan/target-bound structural-runner
    registry, fresh coordinator with PGlite and bounded native PostgreSQL
    evidence, and remaining other-transport, host-resolver and scaling gates.
14. [`preflight/12-base-backed-additive-upgrade.md`](./preflight/12-base-backed-additive-upgrade.md)
    owns the implemented one-hop additive upgrade, exact retained-base
    verification, bounded lineage and independent PGlite/native acceptance.
15. [`preflight/13-application-projection-and-data-bindings.md`](./preflight/13-application-projection-and-data-bindings.md)
    owns the private Application projection, binding selection/admission/recovery
    and synthetic test-selection implementation, including its explicit profile gates.
16. [`preflight/14-transaction-execution-profiles.md`](./preflight/14-transaction-execution-profiles.md)
    owns the accepted execution profiles, pinned framework lifecycle findings,
    outer transaction ownership, and deferred cross-domain command proof.
17. [`preflight/15-scalar-relational-transaction-and-store.md`](./preflight/15-scalar-relational-transaction-and-store.md)
    owns the implemented private scalar store, borrowed transaction lifetime,
    cancellation/cleanup and fail-closed settlement contract.
18. [`preflight/16-mutation-receipts-and-finalization-admission.md`](./preflight/16-mutation-receipts-and-finalization-admission.md)
    owns the implemented private receipt issuer, complete collection,
    single-use outer admission and unadmitted-family rejection capability.
19. [`preflight/17-cms-request-transactions-and-application-publication.md`](./preflight/17-cms-request-transactions-and-application-publication.md)
    records the completed Application-preservation gate and proposes the private
    CMS read/request host and Application publication participation contract.
20. [`preflight/18-application-table-write-policy.md`](./preflight/18-application-table-write-policy.md)
    defines accepted Application table policy, retained managed ownership
    and the complete private denial vertical required before CMS writes.
21. [`preflight/19-payload-preference-cleanup-and-delete-publication.md`](./preflight/19-payload-preference-cleanup-and-delete-publication.md)
    records the real Payload delete blocker and accepted private lifecycle
    storage/binding, bounded cleanup/receipts, atomic lifecycle publication and
    exact Payload delete routing.
22. [`preflight/20-payload-content-relations-and-rebinding.md`](./preflight/20-payload-content-relations-and-rebinding.md)
    owns the implemented private optional-one Payload relation capability, including the
    missing same-owner configuration transition, exact combined rebinding and
    native CMS relation publication. Existing-row many upgrades remain gated.
23. [`preflight/21-payload-many-transition-and-bounded-population.md`](./preflight/21-payload-many-transition-and-bounded-population.md)
    owns implemented standalone depth-one forward population and the native
    distinction between an empty many array and an absent field.
24. [`preflight/22-payload-many-installation-and-migration-boundary.md`](./preflight/22-payload-many-installation-and-migration-boundary.md)
    implements fresh-install many conformance and records the separate existing-row
    conversion authority, serving exclusion and recovery gate.
25. [`preflight/23-payload-bounded-reverse-joins.md`](./preflight/23-payload-bounded-reverse-joins.md)
    records the implemented request-bound native reverse-read capability, fixed Payload join
    windows and depth-one response contract for the private fresh-only profile.
26. [`preflight/24-medusa-currency-convergence-and-schema-compatibility.md`](./preflight/24-medusa-currency-convergence-and-schema-compatibility.md)
    records the implemented Currency source relocation and actual DML compatibility
    capability, its unchanged baseline, exact promotion manifest and the
    explicit remaining Flarex commerce-host boundaries.
27. [`preflight/25-medusa-currency-host-and-publication.md`](./preflight/25-medusa-currency-host-and-publication.md)
    records the implemented private Flarex-backed Currency service: live fresh
    installation, seed-gated serving, bounded DAL, authenticated transactions
    and typed row publication.
28. [`preflight/26-medusa-product-schema-and-relationships.md`](./preflight/26-medusa-product-schema-and-relationships.md)
    records the implemented fresh Product schema and physical constraints, with
    [bounded shared reconstruction](./preflight/27-product-installation-reconstruction-cost.md).
29. [`preflight/28-medusa-product-create-and-event-delivery.md`](./preflight/28-medusa-product-create-and-event-delivery.md)
    records implemented private nested Product creation, bounded population and transaction-buffered
    local event conformance. It records dispatcher ownership and defers the
    durable event storage/provider decision.
30. [`preflight/29-medusa-original-product-tests.md`](./preflight/29-medusa-original-product-tests.md)
    records the original Product test runner and its explicit admitted/blocked case inventory.
31. [`preflight/30-medusa-product-related-create-and-reads.md`](./preflight/30-medusa-product-related-create-and-reads.md)
    records related creation and bounded reads with eleven admitted original Product cases.
32. [`preflight/31-medusa-keyed-updates-and-remaining-product-tests.md`](./preflight/31-medusa-keyed-updates-and-remaining-product-tests.md)
    records shared keyed updates proved by tag/type mutations and maps remaining Product dependencies.
33. [`preflight/32-medusa-standalone-options-and-variants.md`](./preflight/32-medusa-standalone-options-and-variants.md)
    owns the approved 35-case Product mutation milestone with related-entity and graph checkpoints,
    and maps all remaining originals through lifecycle and scale slices.
34. [`preflight/33-commerce-write-kernel-efficiency.md`](./preflight/33-commerce-write-kernel-efficiency.md)
    owns the implemented shared write-kernel efficiency correction required by Product acceptance,
    preserving existing resource limits and transaction authority.
35. [`preflight/34-medusa-product-lifecycle.md`](./preflight/34-medusa-product-lifecycle.md)
    owns the implemented lifecycle milestone, proving 55 originals per driver with
    explicit managed-transition authority and authenticated local events.
36. [`preflight/35-medusa-product-scale.md`](./preflight/35-medusa-product-scale.md)
    proposes the remaining 1000-image case through measured shared resource
    budgets, complete atomic batches and stable relation reads.
37. [`preflight/36-shared-publication-and-request-recovery.md`](./preflight/36-shared-publication-and-request-recovery.md)
    owns the implemented common publisher and framework recovery routing while
    preserving native OCC, bounded SQL and participant-specific completion.
38. Current code, migrations, any source snapshot already admitted by its own
    gate, and decisive tests prove exact implemented behavior.

If this roadmap conflicts with an implemented application invariant owned by
the foundation plans, the foundation owner controls until a separate approved
owner-change preflight replaces it.

## Ownership Map

| Domain | Owns | Does not own |
| --- | --- | --- |
| Flarex application foundation | Standard/Application manifest, document rows, OCC, native document relations, current commit path | Payload lifecycle, Medusa modules, generic framework migration language |
| Shared framework-storage mechanisms | artifact/install/binding lifecycle, relational schema representation, migration coordination, trusted scoped transactions, typed commit participation | framework schema interpretation or business behavior |
| Payload adapter | CMS exposure, access, hooks, validation, drafts, versions, localization, request transaction, Payload errors | native relation identity, commit order, raw Postgres |
| Medusa adapter | DML normalization, module manifests, Joiner/Link mapping, repositories, Query compatibility, workflows, locks, commerce events and migrations | public application APIs, Flarex scope/commit authority |
| Postgres persistence | physical tables, constraints, locks, transaction execution, receipts, feed/outbox persistence | public or framework semantics |

Every table has one ordinary semantic write owner. Cross-domain references do
not transfer mutation authority.

## Roadmap Files

| File | Owner |
| --- | --- |
| [`01-system-boundaries.md`](./01-system-boundaries.md) | Lane, trust, API, storage, and package boundaries |
| [`02-schema-artifacts-and-bindings.md`](./02-schema-artifacts-and-bindings.md) | Artifact, physical installation, readiness, binding, and coordinated activation |
| [`03-relational-schema-and-migrations.md`](./03-relational-schema-and-migrations.md) | Value-only relational schema and framework structural-migration coordination design |
| [`04-transactions-and-commit-publication.md`](./04-transactions-and-commit-publication.md) | Trusted transaction hosts, opaque mutation receipts, commit/feed/outbox integration |
| [`05-relations-links-and-references.md`](./05-relations-links-and-references.md) | Document relations, foreign keys, Module Links, adjacency, and cross-domain references |
| [`06-medusa-adoption.md`](./06-medusa-adoption.md) | Fork-island, package-convergence, compiler, and adapter sequence |
| [`07-payload-adoption.md`](./07-payload-adoption.md) | Payload content/lifecycle adapter and CMS write-authority sequence |
| [`08-conformance-and-activation.md`](./08-conformance-and-activation.md) | Evidence matrix and private, integrated, and production gates |

Preflight records:

| File | Status | Decision |
| --- | --- | --- |
| [`preflight/01-artifact-installation-and-binding-identity.md`](./preflight/01-artifact-installation-and-binding-identity.md) | Accepted; artifact value complete and separately gated artifact repository complete | Lifecycle/authority architecture, owner-qualified artifact value contract, and deferred installation and binding contracts |
| [`preflight/02-artifact-repository-and-ddl.md`](./preflight/02-artifact-repository-and-ddl.md) | Accepted and implemented; private repository operations, focused PGlite repository acceptance, ordinary-role PostgreSQL migration/catalog, control-session, admission/concurrency/rollback/recovery/interruption, seven native deadline receipts, supported cross-owner deadlock-absence evidence, and native identity-list/index behavior complete | Additive private control registry, compact dependency evidence, authenticated admission, replay/collision/read/list semantics, migration compatibility, and database evidence split |
| [`preflight/03-postgres-active-work-quarantine.md`](./preflight/03-postgres-active-work-quarantine.md) | Accepted; owner correction and native acceptance implemented | Artifact-private authenticated PostgreSQL backend cancellation, tracked-work drain, original-client discard, and fail-closed cleanup semantics for `FSA-PG-DRAIN-01` |
| [`preflight/04-medusa-fork-source-island-and-package-convergence.md`](./preflight/04-medusa-fork-source-island-and-package-convergence.md) | Accepted; inert island retained and private Currency closure admitted | Fork source authority, official provenance baseline, exact promotion boundary and reuse classifications; broader promotion remains gated |
| [`preflight/05-core-first-three-lane-readiness.md`](./preflight/05-core-first-three-lane-readiness.md) | Accepted sequencing; consumer audits and relational value slice complete, later shared-core gates pending | Consumer-informed shared core followed by Flarex Application preservation, Payload scalar and native-relation proofs, then Medusa package convergence |
| [`preflight/06-medusa-package-capability-source-map.md`](./preflight/06-medusa-package-capability-source-map.md) | Accepted source/capability audit; exact active Currency promotion owned by record 24 | Mature-DML authority, original semantic inventory, reuse classifications, and deferred Query/Link/workflow/lock/idempotency/event gates |
| [`preflight/07-payload-release-and-adapter-contract.md`](./preflight/07-payload-release-and-adapter-contract.md) | Accepted exact `payload@3.88.0` audit and private scalar CRUD conformance under combined content/lifecycle binding | Adapter surface, request nesting, hook/transaction constraint, internal collections, first headless scalar profile, relation cutline, and migration/host boundary |
| [`preflight/08-relational-schema-value-contract.md`](./preflight/08-relational-schema-value-contract.md) | Implemented privately; value evidence complete and no DDL/runtime activation | Exact first-slice relational value vocabulary, deterministic normalization, framework-artifact composition, Currency and synthetic fixtures, and closed downstream gates |
| [`preflight/09-relational-installation-and-migration-coordination.md`](./preflight/09-relational-installation-and-migration-coordination.md) | Accepted; value/storage checkpoints and bounded private fresh/additive PGlite and native acceptance complete; general scale, binding and runtime remain pending | Cycle-free identities, collision domain, physical lowering, structural plan/ledger values, readiness/availability and upgrade/database proof matrix |
| [`preflight/10-relational-coordinator-metadata-and-repositories.md`](./preflight/10-relational-coordinator-metadata-and-repositories.md) | Complete checkpoint-2 contract; exact additive catalog, topological restoration, all thirteen source-private repository families, and manifest-owned serial PGlite functional gate implemented production-inert | Exact eighteen-table baseline plus the separately owned additive base sidecar, canonical-byte authority, normalized constraint sidecars, timestamp mapping, complete-graph cold rehydration, private transaction kernels, and PGlite evidence gate |
| [`preflight/11-target-session-and-fresh-coordinator.md`](./preflight/11-target-session-and-fresh-coordinator.md) | Private no-base PGlite and bounded native PostgreSQL execution, contention, cancellation, settlement and process-restart evidence | Opaque authority, four fresh operation handlers, bounded read-only graph reuse, fifteen-step execution profile, remaining general scale and host-resolution gates |
| [`preflight/12-base-backed-additive-upgrade.md`](./preflight/12-base-backed-additive-upgrade.md) | Implemented privately with PGlite and ordinary-role PostgreSQL acceptance | One fresh base to one additive successor, explicit base verification, versioned plan/admission contracts, bounded lineage and combined PGlite/native acceptance |
| [`preflight/13-application-projection-and-data-bindings.md`](./preflight/13-application-projection-and-data-bindings.md) | Private Application-only and synthetic Medusa binding implementation and acceptance complete | Application-owned coherent projection, exact named bindings, residual profile authentication, atomic selection, transaction-local admission, restart recovery and non-serving synthetic selection |
| [`preflight/14-transaction-execution-profiles.md`](./preflight/14-transaction-execution-profiles.md) | Accepted architecture direction; scalar transaction contract implemented, commit-family and cross-domain proofs pending | Shared transaction ownership, separate Application/framework/workflow execution profiles, nested failure and event boundaries, and explicitly gated cross-domain atomic commands |
| [`preflight/15-scalar-relational-transaction-and-store.md`](./preflight/15-scalar-relational-transaction-and-store.md) | Implemented privately with focused PGlite and ordinary-role PostgreSQL coverage | Private synthetic scalar operations, exact owner/table authority, pending-write reads, rollback-only nesting, cancellation with cleanup, read-only settlement and mutation rollback before receipt-family admission |
| [`preflight/16-mutation-receipts-and-finalization-admission.md`](./preflight/16-mutation-receipts-and-finalization-admission.md) | Implemented privately with focused PGlite and ordinary-role PostgreSQL coverage | SQL-issued private receipts, complete bounded collection, one outer admission, and synthetic rejection without a new fact family or Application publisher changes |
| [`preflight/17-cms-request-transactions-and-application-publication.md`](./preflight/17-cms-request-transactions-and-application-publication.md) | Private scalar CMS host and Application publication implemented | Bounded pending documents, authenticated materialization, one publication, retained-result recovery and preserved Application driver lanes; Payload compatibility remains separate |
| [`preflight/18-application-table-write-policy.md`](./preflight/18-application-table-write-policy.md) | Private denial capability implemented | Policy-bearing canonical Application identity, new managed-table activation, retained ownership, authoring restrictions and authoritative denial before any CMS writer is admitted |
| [`preflight/20-payload-content-relations-and-rebinding.md`](./preflight/20-payload-content-relations-and-rebinding.md) | Private optional-one Payload relation capability implemented | Authenticated scalar successor, exact combined binding, native relation integrity/publication and bounded cold ownership recovery |
| [`preflight/21-payload-many-transition-and-bounded-population.md`](./preflight/21-payload-many-transition-and-bounded-population.md) | Private depth-one forward population implemented; many-transition direction proposed | Request-bound identity batching and consistent bounded reads; many-valued existing-row conversion requires a separate migration-host decision; bounded reverse joins use the separate profile in preflight 23 |
| [`preflight/22-payload-many-installation-and-migration-boundary.md`](./preflight/22-payload-many-installation-and-migration-boundary.md) | Private fresh-install many conformance implemented | Ordered many CRUD, bounded population, exact binding and retained recovery; existing-row conversion separately needs authenticated transformation, serving exclusion and durable progress |
| [`preflight/23-payload-bounded-reverse-joins.md`](./preflight/23-payload-bounded-reverse-joins.md) | Private fresh-only reverse joins implemented | Same-transaction CMS incoming-source reads and bounded Payload virtual joins over both native relations; closes the bounded non-reactive Payload prerequisite |
| [`preflight/24-medusa-currency-convergence-and-schema-compatibility.md`](./preflight/24-medusa-currency-convergence-and-schema-compatibility.md) | Implemented private Currency source/value compatibility | Actual DML, manifest-admitted source/build/type closure and unchanged PGlite/MikroORM comparison baseline; live Flarex installation, bounded relational queries and typed commerce publication are owned by record 25 |
| [`preflight/25-medusa-currency-host-and-publication.md`](./preflight/25-medusa-currency-host-and-publication.md) | Implemented private Currency service and relational publication | Shared initialization/change metadata, live installation, borrowed managers, bounded queries, atomic publication/recovery and retention; broader modules and public activation remain gated |
| [`preflight/26-medusa-product-schema-and-relationships.md`](./preflight/26-medusa-product-schema-and-relationships.md) | Fresh Product schema and physical relationships implemented | Ten pinned models produce thirteen tables through shared schema/install/readiness machinery; the bounded private service proof is recorded separately in record 28 |
| [`preflight/28-medusa-product-create-and-event-delivery.md`](./preflight/28-medusa-product-create-and-event-delivery.md) | Implemented privately with PGlite and ordinary-role PostgreSQL proof | Actual pinned Product service creates and reads nested graphs; 14 conformance cases pass per database, shared Currency/Core checks and required reviews complete; durable event storage/dispatch deferred |
| [`preflight/29-medusa-original-product-tests.md`](./preflight/29-medusa-original-product-tests.md) | Original-test runner proven on PGlite and PostgreSQL | Two byte-identical Product suites; three original cases pass per driver, 54 skips explicitly inventoried; one installed fixture per driver |
| [`preflight/30-medusa-product-related-create-and-reads.md`](./preflight/30-medusa-product-related-create-and-reads.md) | Related creation and reads implemented privately | Eleven original cases pass per driver, 46 exclusions inventoried; existing identities, bounded relation filtering and local events; no new core schema |
| [`preflight/31-medusa-keyed-updates-and-remaining-product-tests.md`](./preflight/31-medusa-keyed-updates-and-remaining-product-tests.md) | Selected keyed updates implemented privately | Fifteen original cases pass per driver; explicit primary-key update admission, operation-specific local events, unchanged core schema and budgets; 41 blocked cases and one upstream skip remain |
| [`preflight/32-medusa-standalone-options-and-variants.md`](./preflight/32-medusa-standalone-options-and-variants.md) | Product mutation milestone implemented privately | 50 originals pass per driver: 15 baseline, 11 related-entity and 24 graph cases; six blocked cases and one upstream skip remain |
| [`preflight/33-commerce-write-kernel-efficiency.md`](./preflight/33-commerce-write-kernel-efficiency.md) | Approved shared-owner correction implemented | Operation-local catalog reuse and bounded insert/update RETURNING envelopes preserve limits, exact row facts, cancellation and atomicity |
| [`preflight/34-medusa-product-lifecycle.md`](./preflight/34-medusa-product-lifecycle.md) | Implemented privately with both-driver original-test proof | 55 originals pass per driver; managed transitions, complete cascade facts, deleted-row reads and authenticated local events; one scale case and one upstream skip remain |
| [`preflight/35-medusa-product-scale.md`](./preflight/35-medusa-product-scale.md) | Proposed next milestone | Measure and admit bounded complete 1000-image writes/reads; target 56 originals, preserving the upstream performance skip |
| [`preflight/36-shared-publication-and-request-recovery.md`](./preflight/36-shared-publication-and-request-recovery.md) | Private ownership consolidation implemented | One common publisher and one framework uncertain-outcome router; trusted commerce finalization, retained CMS materialization, unchanged execution profiles and no schema replacement |

## Current Architecture

The accepted [transaction execution profiles](./preflight/14-transaction-execution-profiles.md)
share transaction ownership and commit evidence while preserving Application
journal/OCC, bounded framework commands, and Medusa workflow recovery.
The private common publisher and framework recovery router are implemented in
record 36; this does not imply a neutral execution host or universal mutation API.

The repository contains a private fresh-install and bounded additive-upgrade
lifecycle through artifact, physical plan, target/session, structural execution
and readiness publication.
It contains a private Payload scalar/optional-one data path with preference
cleanup and publication. Broader framework serving remains gated:

- scope resolution and physical placement are reusable authorities;
- scoped execution is the best transaction-host seed but remains backed by
  application-row operations;
- the Application schema/readiness/activation owners remain separate from the
  new framework artifact and installation/readiness owners; private binding
  selection is implemented, while real framework serving profiles remain gated;
- native relation storage and OCC use application-row and document-occurrence
  semantics;
- commit feed and wake-outbox infrastructure is reusable in shape, while its
  current fact families are application-specific; and
- the checked-in migration runner owns static Flarex platform migrations;
  generated framework structures use the separately owned private coordinator,
  with fresh and one-hop additive PGlite and native PostgreSQL acceptance.

The `payload` and `medusa` catalog namespaces reserve stable vocabulary. They
do not prove an adapter, framework migration compatibility, runtime caller or
production path.

## Invariants And Trust Boundaries

- FlarexDB/Postgres remains the only committed data authority.
- Application, Payload, Medusa, and migration operations enter through
  different high-level hosts.
- Framework adapters never receive unrestricted physical database authority.
- A transaction is pinned to scope, owner capability, placement, generation,
  and schema digest.
- The active binding is revalidated inside the transaction that accepts a
  write.
- Only core finalization allocates commit order and writes typed change/outbox
  facts.
- Payload and Medusa retain their observable framework semantics.
- Application document relations and Medusa Module Links retain distinct
  authoritative representations.
- Migration execution is a deployment operation, not an ordinary request or
  implicit runtime-startup side effect.
- No lane may activate a partially compiled module or link set.
- Current application behavior is changed only through a separately approved
  owner preflight with focused regression evidence.

## Master Execution Order

The smallest safe sequence is:

1. Freeze system ownership, trust boundaries, and the exact private capability
   surface. The private framework-artifact repository checkpoint is complete.
2. Keep the clean committed Cloudflare-oriented Medusa fork in the verified,
   inert `third_party/medusa` source island. This source-only admission is
   complete at fork commit `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`;
   official Medusa remains historical provenance and comparison evidence, and
   no active package or runtime import exists.
3. The exact Medusa package/capability source map from that island and the exact
   Payload `3.88.0` release/adapter contract preflight are complete. They
   constrain shared primitives but authorize no package promotion, adapter,
   runtime import, or write path.
4. The private canonical value-only `RelationalSchema` contract is complete,
   including deterministic normalization, framework-artifact composition,
   provenance, and unsupported-capability rules against exact source-audited
   fixtures. It performs no DDL and compiles no live Medusa candidate.
5. The pure-value and private storage/repository checkpoints of the separately
   accepted installation/readiness/availability and structural migration
   program are complete in
   [`preflight/09-relational-installation-and-migration-coordination.md`](./preflight/09-relational-installation-and-migration-coordination.md)
   and its exact checkpoint-2 storage contract in
   [`preflight/10-relational-coordinator-metadata-and-repositories.md`](./preflight/10-relational-coordinator-metadata-and-repositories.md),
   including their manifest-owned serial PGlite functional gate. Checkpoint 3
   is separately decomposed in
   [`preflight/11-target-session-and-fresh-coordinator.md`](./preflight/11-target-session-and-fresh-coordinator.md):
   the opaque target/session plus PGlite functional adapter and the fixed-
   registry relational structural runner are now closed as separate private
   functional evidence alongside the fresh coordinator and repository helpers.
   Fresh plus base-backed genuine-PostgreSQL structural acceptance is complete.
   The [binding preflight](./preflight/13-application-projection-and-data-bindings.md)
   implements the private Application projection, `DataBindingSet`,
   activation/admission and recovery with a separate non-serving synthetic
   selection. Application-only and owner-correct synthetic Medusa commerce
   evidence pass; Payload profiles and production bindings remain gated.
6. The accepted
   [execution-profile preflight](./preflight/14-transaction-execution-profiles.md)
   and implemented [scalar transaction/store contract](./preflight/15-scalar-relational-transaction-and-store.md)
   supply the private synthetic transaction capability. Preserve
   outer ownership, fail-closed borrowed sessions, framework lifecycle semantics,
   and current Application lock ordering. Do not create a universal database
   or transaction API.
7. The implemented [receipt/admission contract](./preflight/16-mutation-receipts-and-finalization-admission.md)
   supplies SQL-issued receipts, complete collection and outer finalization
   rejection. No generic relational change-fact family or successful
   framework publication is admitted by this capability.
8. The framework-neutral lifecycle and transaction path is proven on a synthetic
   reserved-relational schema through artifact, installation, readiness,
   the separately admitted synthetic-`system` selection, migration,
   transaction-local mutation/read, authenticated receipt preparation,
   fail-closed finalization rejection, and rollback in PGlite and genuine
   PostgreSQL. Do not invent a generic system binding or synthetic change-fact
   family.
9. The complete existing Flarex Application document, OCC, native-relation,
   commit, and read vertical passes after shared-core work on both drivers.
   Retain the [preservation lanes](./preflight/17-cms-request-transactions-and-application-publication.md#application-preservation)
   for later changes to shared publication.
10. With the private CMS request host, Application commit participation and
    write-policy gates implemented, prove the pinned Payload Local API profile:
    one scalar-only CMS-managed collection and its fixed nested request hook
    through the existing Application document path. Create/read/update and
    nested hooks now have private evidence; complete delete requires the
    [preference-cleanup owner decision](./preflight/19-payload-preference-cleanup-and-delete-publication.md).
11. Publish and activate a relation-bearing Application candidate, rebind its
    Payload overlay to that exact active head/readiness/placement, then prove
    Payload's first top-level, nonlocalized, monomorphic one/many relationships
    through the existing non-reactive native Application relation path.
    `R03-B` remains required only for reactive/reconnectable claims.
12. Only after steps 3 through 11 pass, promote the exact private, test-only
    Currency-connected Medusa closure and establish unchanged compatibility.
    This source/value capability is implemented; adapt its service to the
    already-proven shared mechanisms under the following host gate.
13. Admit Currency transaction propagation, commerce-row receipts and typed
    finalization before the fresh Currency baseline may write. Unadmitted
    business events remain refused.
14. Product's complete fresh schema and physical relationships are implemented
    under record 26. Record 28 implements and validates nested creation, bounded population and
    transaction-buffered local events as the first service transaction proof.
    Durable event storage and dispatch require their own later decision and proof.
    Records 32-34 implement bounded replacement and lifecycle/cascade publication
    with 55 originals per driver. Record 35 preflights the remaining scale case.
    Follow with both endpoints and the
    typed link/event contracts for one real stored Module Link with database-
    enforced uniqueness/cardinality and genuine-PostgreSQL concurrency proof.
15. Add custom repositories, Query, workflows, locks, idempotency, events, and
    broader modules only through their own bounded conformance gates.
16. Add cross-domain references only after both endpoint lanes have stable
    identities, bindings, lifecycle rules, and committed change facts.
    Separately admit a named private cross-domain atomic command after the
    participating lane and transaction/commit-owner proofs. It must use one
    scope, physical transaction and finalizer, preserve each domain's write
    authority, and prove complete rollback and event withholding. This is not
    a prerequisite for the earlier individual lane proofs and does not admit
    arbitrary journal callbacks or whole-workflow SQL transactions.
17. Run full conformance, scale, recovery, hosted, and operator gates before
    any production activation.

Use coherent implementation capabilities with explicit outcomes and failure
proofs. Ordinary implementation details do not create additional approval
gates; materially different owners or authority boundaries still require their
own preflight. Later steps do not authorize earlier owner changes implicitly.

The approved [native PostgreSQL fresh installation and recovery](./preflight/11-target-session-and-fresh-coordinator.md#native-implementation-evidence)
capability is implemented for a bounded, private profile. It brings forward
fresh acceptance before a base-backed candidate. The shared coordinator admits
at most fifteen plan steps on both drivers, with bounded immutable-reference
reuse inside each read-only restoration pass. Larger plans and long lineage
need their own measured bound before that limit can grow. The separate
[additive profile](./preflight/12-base-backed-additive-upgrade.md) completes
bounded fresh-plus-base acceptance. The following
[binding preflight](./preflight/13-application-projection-and-data-bindings.md)
has private Application-only and synthetic Medusa acceptance.

## Current Gate Status

| Capability | Implemented/proven boundary | Remaining boundary |
| --- | --- | --- |
| Architecture and consumer constraints | Accepted ownership and core-first order; exact Medusa fork and Payload `3.88.0` audits complete | Source audit does not prove either adapter |
| Framework artifact repository | Private admission/read/list, authenticated control sessions, PGlite and ordinary-role PostgreSQL acceptance complete | Does not execute framework target plans |
| Relational and lifecycle values | Private canonical schema, physical layout, plan, installation/readiness/availability values complete | No public DSL or live framework compiler |
| Coordinator metadata/repositories | Eighteen-table baseline plus immutable plan-base sidecar, thirteen repository families with base corroboration, bounded cold restoration and PGlite/native evidence complete | General lineage scale remains open |
| Fresh coordinator execution | Private no-base PGlite and ordinary-role native PostgreSQL profile; bounded read-only graph reuse, physical sessions, concurrency, cancellation, uncertain settlement, OS-process restart and exact readiness replay | Fifteen-step execution limit; larger plans, general lineage scale, hosted/TLS transports and production resolution unproven |
| Base-backed structural upgrade | Private fresh A to additive B and exact replay, retained objects/rows, locked base availability, recovery and PGlite/PostgreSQL acceptance | One-hop synthetic system profile only; general upgrades and production selection remain gated |
| Serving bindings | Private Application projection, exact binding ledger, activation/admission/recovery and synthetic Medusa evidence complete | Exact scalar/optional-one content and preference binding admitted through the private Payload runtime; broader lifecycle, multi-physical-lane admission and production serving remain gated |
| Relational data transaction/store | Private scalar profile implemented on PGlite and ordinary-role PostgreSQL | Read-only settlement and mutation rollback only; no Payload or Medusa store admission |
| Relational receipts and finalization | Private SQL-issued receipts, complete collector and outer admission implemented on both drivers | No admitted relational fact family or successful framework publication |
| Synthetic relational data proof | Non-serving selection, scalar operations, pending reads, nested rollback, authenticated receipts and finalization rejection implemented | Mutation attempts cannot publish; real framework conformance remains |
| Application preservation | Post-core complete native mutation/OCC/replay/publication, query, SV-R Core and RQ01 scenarios pass on PGlite and ordinary-role PostgreSQL | Rerun after shared publication changes; Action/Task, live sync and hosted claims remain separate |
| CMS request host and Application publication | Private CMS host, pending documents, row/relation materialization and publication implemented | Pinned Payload scalar CRUD and atomic preference cleanup publication proven under combined binding |
| Application table write policy | Private denial capability implemented | Canonical ownership and ordinary Application journal/commit denial preserved; the separate private CMS participant owns managed writes |
| Payload scalar and non-reactive relation proofs | Private pinned scalar/optional-one/fresh-many CRUD, fresh-only reverse joins, depth-one standalone population, preference cleanup/publication and nested requests implemented | Bounded non-reactive consumer milestone complete on both drivers. Existing-row many upgrades, general join parity and public/production activation remain gated |
| Medusa Currency, Product and Module Link proofs | Private Currency publication and nested Product creation/population with local events are proven through the shared core | Remaining Product operations, stored Links, durable domain-event delivery and general module compatibility follow |
| Cross-domain references | Authority profiles defined | Runtime deferred |
| Hosted, public and production selection | Separate gates defined | Unproven and unauthorized; private evidence grants no activation |

## Proposed Decisions Before Their Owning Capabilities

The core-first objective is a shared foundation proven by both real framework
operation paths. Preserve Application, Payload scalar/request transaction,
Payload native relations, then Medusa Currency as the consumer proof order.
Broader Payload dashboard, hook, upload and lifecycle parity are not added as
Currency prerequisites. Exact consumer coverage is owned by
[the three-lane plan](./preflight/05-core-first-three-lane-readiness.md#consumer-proof-of-shared-mechanisms).

The following recommendations are proposals, not accepted replacement
contracts or implementation authorization:

- [Payload standalone read admission](./preflight/07-payload-release-and-adapter-contract.md#proposed-standalone-read-contract),
  distinct from nested transaction reuse and invalid-token refusal.
- [Transaction lock-order reconciliation](./04-transactions-and-commit-publication.md#proposed-lock-order-reconciliation)
  before the Application-shaped execution host becomes shared machinery.
- [Binding selection, admission and interruption recovery](./preflight/13-application-projection-and-data-bindings.md),
  now specified as one private implementation proposal, including the serving
  gap while exact overlay rebinding is incomplete and distinct test-only
  synthetic selection.

## Package Direction

Start with private domain modules under their real owners. Do not create empty
packages merely to make the architecture diagram look complete.

The Medusa fork first enters `third_party/medusa` as a pinned, refreshable,
independent workspace. It is source and regression evidence, not an active
import surface.
Only a later package-specific promotion gate may move an exact connected
closure into root `packages/*`; the promoted package must have no runtime file
dependency on the island. Source presence does not authorize an adapter,
runtime caller, or activation.

Likely private persistence domains are:

```text
scopeExecution/
frameworkSchema/
relationalSchema/
migrationCoordination/
commitPublication/
relationProjection/
```

Portable packages are extracted only after at least two real owners prove the
same contract. The framework adapters may later use the plain package names
`@flarex/payload-adapter` and `@flarex/medusa-adapter`. Do not introduce a
universal `@flarex/database` package.

## Current Correctness Gate

The [capability matrix](#current-gate-status) owns the cross-lane summary.
Detailed correctness contracts and limitations remain with their focused
owners:

- [Artifact repository and DDL](./preflight/02-artifact-repository-and-ddl.md)
  owns the completed private admission/read/list, ordinary-role PostgreSQL,
  collision, ordering and settlement acceptance.
- [Active-work quarantine](./preflight/03-postgres-active-work-quarantine.md)
  owns authenticated cancellation, tracked-work drain, discard and fail-closed
  cleanup. Its artifact-private proof is not native coordinator evidence.
- [Coordinator metadata and repositories](./preflight/10-relational-coordinator-metadata-and-repositories.md)
  owns the exact catalog, restoration and transaction-parameterized kernels.
- [Target/session, structural runner and fresh coordinator](./preflight/11-target-session-and-fresh-coordinator.md)
  owns implemented no-base PGlite and bounded native behavior, its fifteen-step
  execution limit, and remaining general scale and production-resolution boundaries.
- [The installation/migration umbrella](./preflight/09-relational-installation-and-migration-coordination.md)
  owns the bounded fresh-plus-base-backed acceptance and sequence before the
  later binding checkpoint.

Fresh installation has private native contention, interruption and uncertain
settlement evidence within the admitted work profile. Bounded read-only graph
reuse reduces repeated restoration work and supports the larger fresh profile.
The [approved additive capability](./preflight/12-base-backed-additive-upgrade.md)
implements one fresh-base-to-successor upgrade with exact base authority,
retained structures and bounded lineage, with independent PGlite/native acceptance.
The [Application projection and `DataBindingSet` preflight](./preflight/13-application-projection-and-data-bindings.md)
implements private selection/admission/recovery for Application-only and
synthetic Medusa evidence. The private synthetic scalar transaction/store now
proves owned scalar data, pending-write reads, nested rollback, bounded cleanup
and read-only settlement. The implemented [receipt/admission contract](./preflight/16-mutation-receipts-and-finalization-admission.md)
adds authentic SQL evidence, complete collection and outer rejection. Full
Application preservation now passes on both drivers. The
[CMS host/Application publication proposal](./preflight/17-cms-request-transactions-and-application-publication.md)
follows implementation of the [Application table write-policy proposal](./preflight/18-application-table-write-policy.md).
The private denial capability now activates a new managed table, preserves
Application reads and app-owned writes, and denies ordinary managed-table writes
at the journal and authoritative commit boundaries. The private CMS host now
adds pending documents, authenticated materialization, one Application publication
and retained-result recovery. The pinned Payload private consumer proves scalar
CRUD and nested hooks. Combined content/lifecycle admission enables
actual delete with atomic preference facts. The [lifecycle contract](./preflight/19-payload-preference-cleanup-and-delete-publication.md)
implements lifecycle storage, binding, bounded cleanup receipts, atomic
publication and exact adapter routing. Content-only composition still refuses
cleanup. The [optional-one capability](./preflight/20-payload-content-relations-and-rebinding.md)
implements authenticated configuration advancement, exact rebinding and native
CMS publication. The [bounded population capability](./preflight/21-payload-many-transition-and-bounded-population.md)
implements depth-one standalone forward reads over that relation. The
[migration-host assessment](./preflight/22-payload-many-installation-and-migration-boundary.md)
implements fresh-install many conformance; existing-row conversion remains
a separate authority and recovery capability. The [bounded reverse-join capability](./preflight/23-payload-bounded-reverse-joins.md)
implements one CMS transaction for root, edge and source reads, with first-window
results and bounded population. This completes the bounded private non-reactive
Payload prerequisite. The [Currency preflight](./preflight/24-medusa-currency-convergence-and-schema-compatibility.md)
records private source relocation and actual DML compatibility as implemented.
The [Currency host/publication capability](./preflight/25-medusa-currency-host-and-publication.md)
implements Flarex-backed installation, bounded repository queries and commerce row
publication as one capability. Shared change facts and initialization receipts
contain no Currency-specific core schema or fixed dataset size. It preserves the read-only
public Currency interface and rejects unadmitted domain events. General Payload
parity is a separate gate.
Public framework adapters, SDKs, runtime routes and production remain gated.
