# FlarexDB Framework Integration

## Status And Scope

Status: active accepted roadmap domain. The private artifact-value, additive
DDL, runtime-authenticated admission-preparation, stored-reconstruction, and
repository-construction sub-checkpoints, runtime-authenticated control-session
starter, deterministic control-session lifecycle, and an artifact-private
PostgreSQL control-session adapter are implemented, together with the exact
private point-read, locked-admission, and bounded identity-list operations with
completed focused PGlite evidence. Focused ordinary-role PostgreSQL 18
evidence now proves the native migration/catalog, control-session probe, point
read, exact-admission convergence, deployment-row blocking, collision
contention, both
dependency-lock orders, cross-deployment non-blocking, owner/lineage coordinate
isolation, post-write rollback, and driver-edge pre-/post-`COMMIT` settlement
recovery after discarding the uncertain native backend and using a distinct
recovery backend, plus advisory-lock-backed callback-SQL and server-blocked-
`COMMIT` interruption settlement, native queued-acquisition expiry, server lock
and statement timeouts, and detached and post-resolution reconstruction
deadlines, plus both supported cross-owner deployment-lock holder orders with
the existing Application schema-version artifact writer. The separately
accepted `FSA-PG-DRAIN-01` correction now cancels and drains active native
SQL and recovery work before returning. Native bounded-list ordering,
pagination, and initial/resumed natural-index behavior complete the genuine-
PostgreSQL acceptance enumerated for the private artifact repository. Together
the PGlite and genuine-PostgreSQL lanes complete the private repository
checkpoint. Later lifecycle codecs remain gated.

The exact Medusa package/capability map and Payload `3.88.0` adapter-contract
audit are accepted, and the private value-only relational schema plus the first
physical/lifecycle/migration value checkpoint are implemented and
production-inert. The exact target-local coordinator metadata and private
repository contract is accepted; its additive private metadata DDL and focused
PGlite catalog/rollback plus representative root constraint, foreign-key,
uniqueness, nullable-tuple rejection, and root-row cold-reopen evidence are
implemented. Stored restoration/repositories, target sessions, generated
relational DDL, the later binding checkpoint, Payload/Medusa adapters, runtime
wiring, and production work remain pending.

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
13. Current code, migrations, any source snapshot already admitted by its own
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
| [`preflight/04-medusa-fork-source-island-and-package-convergence.md`](./preflight/04-medusa-fork-source-island-and-package-convergence.md) | Accepted; inert source island imported and verified, package promotion pending | Cloudflare-oriented fork as primary source, official Medusa as provenance baseline, independent verified island, reuse classification, and separately gated package promotion |
| [`preflight/05-core-first-three-lane-readiness.md`](./preflight/05-core-first-three-lane-readiness.md) | Accepted sequencing; consumer audits and relational value slice complete, later shared-core gates pending | Consumer-informed shared core followed by Flarex Application preservation, Payload scalar and native-relation proofs, then Medusa package convergence |
| [`preflight/06-medusa-package-capability-source-map.md`](./preflight/06-medusa-package-capability-source-map.md) | Accepted exact source/capability audit; no promotion or runtime activation | Mature-DML authority, reproducible 65-input Currency semantic graph, exploratory broader graph notes, reuse classifications, retained evidence, and deferred Query/Link/workflow/lock/idempotency/event gates |
| [`preflight/07-payload-release-and-adapter-contract.md`](./preflight/07-payload-release-and-adapter-contract.md) | Accepted exact `payload@3.88.0` audit; no dependency, adapter, or runtime activation | Adapter surface, request nesting, hook/transaction constraint, internal collections, first headless scalar profile, relation cutline, and migration/host boundary |
| [`preflight/08-relational-schema-value-contract.md`](./preflight/08-relational-schema-value-contract.md) | Implemented privately; value evidence complete and no DDL/runtime activation | Exact first-slice relational value vocabulary, deterministic normalization, framework-artifact composition, Currency and synthetic fixtures, and closed downstream gates |
| [`preflight/09-relational-installation-and-migration-coordination.md`](./preflight/09-relational-installation-and-migration-coordination.md) | Accepted; checkpoint 1 private pure values and checkpoint-2 additive metadata DDL implemented, while restoration, repositories, target sessions, binding, and runtime remain closed | Cycle-free plan/installation identity, stable physical collision domain, bounded digest names, scope-isolated lowering, structural plan/ledger values, capability-evidence split, readiness/availability values, and later execution/database proof matrix |
| [`preflight/10-relational-coordinator-metadata-and-repositories.md`](./preflight/10-relational-coordinator-metadata-and-repositories.md) | Accepted checkpoint-2 contract; additive private metadata DDL and focused PGlite catalog evidence implemented, later restoration/repository slices pending | Exact eighteen-table target-local catalog, canonical-byte authority, normalized constraint sidecars, timestamp mapping, topological cold rehydration, private transaction kernels, and PGlite evidence gate |

## Current Architecture

The existing repository contains the private relational value contract and
reusable lower-level evidence, but not yet a framework-neutral relational
lifecycle kernel:

- scope resolution and physical placement are reusable authorities;
- scoped execution is the best transaction-host seed but remains backed by
  application-row operations;
- schema artifacts, readiness, and activation demonstrate useful mechanics but
  currently identify and validate application schema state;
- native relation storage and OCC use application-row and document-occurrence
  semantics;
- commit feed and wake-outbox infrastructure is reusable in shape, while its
  current fact families are application-specific; and
- the checked-in migration runner owns static Flarex platform migrations, not
  managed framework schema evolution.

The `payload` and `medusa` catalog namespaces reserve stable vocabulary. They
do not prove an adapter, migration engine, runtime caller, or production path.

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
5. Implement the separately accepted installation/readiness/availability and
   structural migration checkpoints in
   [`preflight/09-relational-installation-and-migration-coordination.md`](./preflight/09-relational-installation-and-migration-coordination.md)
   and its exact checkpoint-2 storage contract in
   [`preflight/10-relational-coordinator-metadata-and-repositories.md`](./preflight/10-relational-coordinator-metadata-and-repositories.md),
   beginning with pure target-namespace/physical-layout/name-assignment/plan/
   ledger/lifecycle values and stopping after fresh plus base-backed genuine-PostgreSQL
   structural acceptance. Then separately preflight the Application projection,
   `DataBindingSet`, activation, and serving owner. Before the synthetic system
   transaction proof, also preflight one specifically named system slot or a
   non-serving test-only selection capability; the initial binding set supplies
   neither.
6. Complete the mandatory transaction-owner preflight, then add its narrow
   owner-scoped relational transaction/store capability. Do not create a
   universal database or transaction API.
7. Complete the mandatory commit-owner preflight, then add its transaction-
   bound mutation receipts and typed finalization mechanics without inventing a
   generic relational change-fact family.
8. Prove the framework-neutral lifecycle and transaction path on a synthetic
   reserved-relational schema through artifact, installation, readiness,
   the separately admitted synthetic-`system` selection, migration,
   transaction-local mutation/read, authenticated receipt preparation,
   fail-closed finalization rejection, and rollback in PGlite and genuine
   PostgreSQL. Do not invent a generic system binding or synthetic change-fact
   family.
9. Run the complete existing Flarex Application document, OCC, native-relation,
   commit, and read vertical to prove that shared-core work did not reroute or
   weaken Application authority.
10. With the exact Payload contract accepted, complete the CMS request-
   transaction-host, Application commit-participation/finalization, and
   Application write-policy gates, then prove one scalar-only CMS-managed
   collection and nested request transaction through the existing Application
   document path.
11. Publish and activate a relation-bearing Application candidate, rebind its
    Payload overlay to that exact active head/readiness/placement, then prove
    Payload's first top-level, nonlocalized, monomorphic one/many relationships
    through the existing non-reactive native Application relation path.
    `R03-B` remains required only for reactive/reconnectable claims.
12. Only after steps 3 through 11 pass, promote the exact private, test-only
    Currency-connected Medusa closure, establish unchanged compatibility, and
    adapt it to the already-proven shared mechanisms.
13. Admit Currency transaction propagation, commerce-row/event-intent receipts,
    and typed finalization before the fresh Currency baseline may write.
14. Add Product and its intra-module relationships, then both endpoints and the
    typed link/event contracts for one real stored Module Link with database-
    enforced uniqueness/cardinality and genuine-PostgreSQL concurrency proof.
15. Add custom repositories, Query, workflows, locks, idempotency, events, and
    broader modules only through their own bounded conformance gates.
16. Add cross-domain references only after both endpoint lanes have stable
    identities, bindings, lifecycle rules, and committed change facts.
17. Run full conformance, scale, recovery, hosted, and operator gates before
    any production activation.

Steps may be split into smaller implementation checkpoints, but later steps do
not authorize earlier owner changes implicitly.

## Current Gate Status

| Outcome | Status |
| --- | --- |
| Cross-domain architecture and ownership | Accepted in design; no implementation authority inferred |
| Framework-neutral artifact/install/binding model | Private artifact repository operations and focused PGlite plus ordinary-role PostgreSQL acceptance complete; pure installation/readiness/availability values are implemented with goldens, while their repositories/execution and Application-reference, Payload-overlay, `DataBindingSet`, activation, and serving remain later gates |
| Medusa fork source island and package convergence | Inert source island admitted and verified at fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`; exact package/capability audit accepted; the later promotion source map, every active package promotion, and all runtime/adapter activation remain pending |
| Payload exact-release contract | `payload@3.88.0` and peeled release commit `fea6f8a47a50ff1330d8a5071b43e7dcffb97b22` accepted for the first headless compatibility profile; dependency, adapter, dashboard, host, and runtime work remain pending |
| Core-first three-lane execution sequence | Accepted; both consumer audits, the private `RelationalSchema`, the first pure target-namespace/physical-layout/name-assignment/plan/ledger/lifecycle values, and additive coordinator metadata DDL are complete; topological restoration and private repositories are next within the accepted checkpoint-2 boundary |
| Relational schema representation | Implemented privately under `@flarex/persistence-postgres`; exact normalization/artifact evidence complete, with no package-root export, DDL, installation, adapter, or runtime caller |
| Framework migration coordinator | Cycle-free physical-lane, plan, ledger, installation, readiness, and availability values plus additive private metadata DDL implemented; no stored restoration, repository, target session, lease orchestration, recovery runner, or execution exists |
| Owner-scoped relational store and typed finalization | Not implemented; transaction-owner and commit-owner preflights required |
| Synthetic reserved-relational lifecycle/transaction proof | Pending the shared-core and explicit synthetic-`system` selection gates; must not infer a generic system binding and must reject and roll back an unadmitted mutation fact family |
| Flarex Application preservation proof | Current private `SV-R Core` baseline complete; post-core full regression pending |
| Payload scalar/request-transaction proof | Exact Payload contract audit complete; pending remaining shared-core lifecycle, Application preservation, CMS transaction/commit, and write-policy gates |
| Payload non-reactive one/many relation proof | Pending the scalar proof plus relation-bearing Application candidate/readiness/overlay rebinding; `R03-B` is not required for this non-reactive gate |
| Medusa Currency/Product/Module Link promotion | Blocked on the preceding shared-core, Flarex Application, and Payload gates |
| Trusted commerce transaction host | Pending preflight |
| Typed commerce commit participation | Pending separate commit-owner preflight |
| Flarex-backed Medusa adapter | Not implemented |
| Flarex-backed Payload adapter | Not implemented |
| Cross-domain reference runtime | Deferred |
| Public `ctx.cms` / `ctx.commerce` | Not authorized |
| Production activation | Not authorized |

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

The artifact, installation, and binding identity preflight is accepted in
[`preflight/01-artifact-installation-and-binding-identity.md`](./preflight/01-artifact-installation-and-binding-identity.md),
and its first private artifact-value checkpoint is implemented.

The relational installation and structural migration design is accepted in
[`preflight/09-relational-installation-and-migration-coordination.md`](./preflight/09-relational-installation-and-migration-coordination.md).
It resolves physical identity, collision-domain fencing, scope isolation,
coexisting structure evidence, recovery, and readiness/availability ownership.
Its private pure-value checkpoint and additive coordinator metadata DDL are
implemented. The exact checkpoint-2 storage/restoration/repository contract is
accepted in
[`preflight/10-relational-coordinator-metadata-and-repositories.md`](./preflight/10-relational-coordinator-metadata-and-repositories.md),
with source-private topological restoration as the current bounded gate.

The repository and DDL contract is accepted in
[`preflight/02-artifact-repository-and-ddl.md`](./preflight/02-artifact-repository-and-ddl.md).
Its additive tables, PGlite DDL evidence, runtime-authenticated admission
preparation, operation-neutral stored reconstruction, and control-bound
repository construction are implemented privately, together with the
authenticated session starter, deterministic control-session lifecycle,
private PostgreSQL control-session adapter, and deterministic fake-pool
evidence, plus the exact private point-read, locked-admission, and bounded
identity-list operations and completed focused PGlite evidence. PGlite now
proves independent target-side cross-deployment/owner foreign keys and distinct
same-lineage rejection, constraint-valid ordinal corruption rejected by exact
admission replay and full point read, the persisted loader/read corruption
matrix including the canonical-byte and 257-edge bounds, and interruption
deferral through commit and release. Query-unreachable stored
row shapes remain covered by the pure defensive codec instead of a fake loader.
The owner-codec item is deliberately inapplicable because no owner adapter or
callback exists in this checkpoint; future owner codecs require a separate
adapter preflight and must finish before common capture/preparation.

The ordinary-role PostgreSQL 18 acceptance enumerated by that preflight is
complete. It includes
focused migration/catalog, control-session, point-read, exact-admission
convergence, and deployment-lock evidence, plus collision contention, ordered
dependency races, cross-deployment non-blocking, owner/lineage coordinate
isolation, and post-write rollback. It also proves that driver-edge faults
immediately before and after
native `COMMIT` quarantine and remove the uncertain backend, recover on one
distinct backend, return `created` before `COMMIT` or `existing` after
acknowledgement, preserve one parent and one dependency edge, and replay as
`existing`. This is not evidence for a TCP partition, server crash, lost
acknowledgement in transit, or interruption while PostgreSQL is executing a
statement. Separate advisory-lock-backed tests prove that an interruption while
a dependency-edge insert is blocked remains pending until the statement drains,
then rolls back the already-inserted parent and releases the healthy backend
before re-emitting exactly one interrupt. They also prove through
`pg_stat_activity` and `pg_blocking_pids` that an interruption while the initial
backend is executing native `COMMIT` remains pending through settlement, then
waits through quarantine and exactly one distinct-backend recovery after a
test-only post-acknowledgement driver fault. That synthetic fault, not the
interruption, creates uncertainty and causes recovery. The durable parent and
edge remain single and replay as `existing`. This proves neither query or
`COMMIT` cancellation nor a TCP partition, socket reset, server crash or
failover, backend termination, lost acknowledgement in transit, or a combined
`decisionUncertain`/interruption failure. Those cases remain outside this
accepted native evidence.

Five additional native deadline receipts now separate timeout authority and
session lifetime precisely: a saturated one-connection pool expires queued
acquisition and destroys its late backend; PostgreSQL's real clock returns
`55P03` for the deployment lock and `57014` for dependency-edge insertion while
the Effect clock stays frozen; detached optimistic reconstruction expires only
after its healthy read backend has been released; and post-resolution
reconstruction expires while its idle read backend is still owned, so that
backend is removed. All paths retain exact atomic rows and prove clean replay or
collision behavior. They do not claim driver query cancellation.

Two additional native scenarios prove the supported deployment-first sequence
against the existing Application schema-version artifact writer. A targeted
trigger blocks the first writer only after it owns the deployment row, and
`pg_stat_activity` plus `pg_blocking_pids()` prove the second writer is queued
on its own `deployments ... FOR UPDATE`, producing the acyclic graph external
barrier -> holder -> deployment waiter. The lane runs with the dependency-
bearing framework admission first and with the Application writer first. Both
first attempts return `created`, both exact replays return `existing`, and the
single Application row, framework dependency, parent, and edge remain exact.
This is not a universal deadlock-freedom or retry-policy claim and does not
authorize composite transactions.

The same lane exposed `FSA-PG-DRAIN-01`: after a host deadline expired during a
genuinely advisory-lock-blocked INSERT, admission returned and the pool emitted
`remove`, but `pg_stat_activity` still showed that PID active until the blocker
was released. A recovery-work reproduction removed the initial uncertain
backend but returned its final `decisionUncertain` while the distinct recovery
backend was still active on the blocked INSERT. The accepted contract requires
tracked SQL to reject and drain before return. The separately accepted
[`preflight/03-postgres-active-work-quarantine.md`](./preflight/03-postgres-active-work-quarantine.md)
now corrects that owner: a bounded PID-plus-secret PostgreSQL CancelRequest
stops the exact backend's active work, tracked work drains, and the original
client transport is destroyed and observed closed before return. Both native
tests run without skips; the initial active case also proves a one-connection
control pool needs no reserved pool slot.

Native identity-list evidence now runs the exact private operation through the
real artifact control-session adapter. It proves fixed-length `bytea` ordering,
exclusive existing, gap, and terminal cursors, deployment/owner/lineage
isolation, the exact `100/101` lookahead boundary, and an exact-100 terminal
page. The exact driver-issued initial and resumed identity-only statements use
`fx_framework_artifact_identity_unique` in forward single-loop 101-row index
scans with sequential scans left enabled, no explicit sort, no sequential scan,
and no post-index filter. This is local native list/index evidence, not snapshot
pagination, hosted behavior, or production-scale performance evidence.

The implemented sub-boundary contains only:

- an additive private control registry plus dependency sidecar;
- database-only compact storage identities while retaining the full natural
  artifact identity as the domain key;
- private Drizzle migration declarations and PGlite DDL evidence;
- capture-issued artifact authenticity plus detached evidence behind an opaque
  prepared-admission capability;
- fail-closed stored parent, canonical-frame, and dependency reconstruction
  through the same capture owner;
- a strict four-field identity decoder, neutral size-gated parent/dependency
  loader, and exact private point read that releases its session before common
  reconstruction and keeps one absolute deadline through hashing;
- private transaction-owning admission with optimistic full reconstruction,
  deployment-row locking, compact exact-replay comparison, one bounded
  dependency-resolution join, atomic parent/edge insertion, and admission-owned
  collision/corruption projection outside the lock;
- strict bounded identity discovery with required `1..100` limits, explicit
  nullable exclusive digest cursors, `limit + 1` byte-order pagination, exact
  coordinate isolation, frozen identity-only pages, and no canonical or
  dependency transfer;
- a frozen opaque repository identity bound to its exact control database,
  runtime-authenticated session starter, and validated fixed timeout policy;
- an absolute Effect-clock deadline model, deterministic settlement and one-
  recovery lifecycle, and mandatory post-settlement resolution;
- driver-callback session capabilities plus repository-issued scoped control-
  transaction tokens that authenticate the exact issuing starter and
  repository only during their exact callback lifetimes;
- an artifact-private PostgreSQL control-session adapter with Effect-clock
  acquisition/work deadlines, Promise-like SQL settlement/rejection tracking,
  deadline-bounded callback draining, exact commit/rollback-command validation,
  explicit transaction initialization, healthy release versus discard or
  quarantine, stable physical session identity, excluded-session recovery
  acquisition, and a bounded post-destroy drain; and
- deterministic fake-pool evidence for ordering and draining, late-acquisition
  discard, expired-work cleanup, construction/release/quarantine failures,
  native and foreign-promise SQL rejection, mixed rejection/timeout evidence,
  invalid commit/rollback command tags, cross-starter rejection, enclosing-
  clock preservation, distinct recovery, and complete interruption/deadline/
  finalizer `Cause` preservation.

The private artifact repository checkpoint is complete locally, including
focused PGlite, genuine-PostgreSQL, native identity-list/index, and
`FSA-PG-DRAIN-01` evidence. The accepted repository record authorizes no
additional implementation; hosted and production activation remain separate
gates.

This authority stops at the files and evidence named by that record.
Installation, readiness, availability, and structural migration have their
accepted boundary in
[`preflight/09-relational-installation-and-migration-coordination.md`](./preflight/09-relational-installation-and-migration-coordination.md)
and the exact checkpoint-2 contract in
[`preflight/10-relational-coordinator-metadata-and-repositories.md`](./preflight/10-relational-coordinator-metadata-and-repositories.md).
Their private pure values and additive metadata catalog are implemented; stored
restoration, repositories, target execution, and generated relational DDL
remain pending. Application-reference, Payload-overlay, and `DataBindingSet`
codecs remain the following separate preflight. No framework adapter, runtime
caller, public API, or production activation is included.
