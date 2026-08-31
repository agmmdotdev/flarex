# FlarexDB Framework Integration

## Status And Scope

Status: active accepted roadmap domain. The private artifact-value, additive
DDL, runtime-authenticated admission-preparation, stored-reconstruction, and
repository-construction sub-checkpoints, runtime-authenticated control-session
starter, deterministic control-session lifecycle, and an artifact-private
PostgreSQL control-session adapter are implemented, together with the exact
private point-read, locked-admission, and bounded identity-list operations with
focused PGlite evidence. The genuine-PostgreSQL lane is not yet run.
Installation, binding, Payload/Medusa adapters, runtime wiring, and production
work remain pending and production-inert.

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
6. Current code, migrations, pinned framework source, and decisive tests prove
   exact implemented behavior.

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
| [`03-relational-schema-and-migrations.md`](./03-relational-schema-and-migrations.md) | Value-only relational schema and shared migration execution mechanics |
| [`04-transactions-and-commit-publication.md`](./04-transactions-and-commit-publication.md) | Trusted transaction hosts, opaque mutation receipts, commit/feed/outbox integration |
| [`05-relations-links-and-references.md`](./05-relations-links-and-references.md) | Document relations, foreign keys, Module Links, adjacency, and cross-domain references |
| [`06-medusa-adoption.md`](./06-medusa-adoption.md) | Source-backed Medusa compiler and adapter sequence |
| [`07-payload-adoption.md`](./07-payload-adoption.md) | Payload content/lifecycle adapter and CMS write-authority sequence |
| [`08-conformance-and-activation.md`](./08-conformance-and-activation.md) | Evidence matrix and private, integrated, and production gates |

Preflight records:

| File | Status | Decision |
| --- | --- | --- |
| [`preflight/01-artifact-installation-and-binding-identity.md`](./preflight/01-artifact-installation-and-binding-identity.md) | Accepted; first checkpoint implemented | Lifecycle/authority architecture, owner-qualified artifact value contract, and deferred repository, installation, and binding contracts |
| [`preflight/02-artifact-repository-and-ddl.md`](./preflight/02-artifact-repository-and-ddl.md) | Accepted; DDL, preparation, neutral loading/reconstruction, repository construction, starter authenticity, deterministic control-session lifecycle, private PostgreSQL adapter, point read, locked admission, bounded identity list, and focused PGlite evidence implemented; genuine-PostgreSQL acceptance incomplete | Additive private control registry, compact dependency evidence, authenticated admission, replay/collision/read/list semantics, migration compatibility, and database evidence split |

## Current Architecture

The existing repository contains reusable lower-level evidence but not yet a
framework-neutral relational kernel:

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
   surface.
2. Add owner-qualified artifact, installation, readiness, and binding concepts
   beside the current application path without rerouting it.
3. Complete the exact Medusa source-and-contract preflight so the actual DML,
   repository, Link, Query, transaction, migration, workflow, lock, event, and
   idempotency contracts constrain the shared primitives.
4. Admit the resulting canonical value-only relational schema and deterministic
   digest; perform no DDL yet.
5. Prove the migration coordinator on a synthetic relational schema, including
   lease loss, retry, replay, and readiness.
6. Make Medusa persistence preparation module-scoped and compile the complete
   configured supported module/link set for one pinned candidate. Completeness
   is candidate-relative; the first candidate may contain Currency alone.
7. Complete the commerce transaction-host/transaction-owner preflight.
8. Complete the commit-owner preflight and add typed commerce-row plus admitted
   Medusa event-intent families to the common finalizer.
9. Install and exercise the fresh Currency-only baseline through a scope-pinned
   commerce transaction while preserving unchanged Medusa service behavior.
10. Admit Product's exact typed event-intent contracts before its first write,
    then add and prove Product intra-module relationships.
11. Select and install both endpoint modules for one real stored Module Link,
    admit its typed link fact and exact event-intent contracts, then exercise it
    with database-enforced uniqueness/cardinality and genuine-PostgreSQL
    concurrency evidence.
12. Add custom repositories and Query integration.
13. Complete the separate Application-owner write-policy admission preflight,
    then begin Payload scalar CRUD and request-transaction conformance through
    the existing document foundation, followed by relations and lifecycle
    behavior.
14. Add cross-domain references only after both endpoint lanes have stable
    identities, bindings, lifecycle rules, and committed change facts.
15. Run full conformance, scale, recovery, hosted, and operator gates before
    any production activation.

Steps may be split into smaller implementation checkpoints, but later steps do
not authorize earlier owner changes implicitly.

## Current Gate Status

| Outcome | Status |
| --- | --- |
| Cross-domain architecture and ownership | Accepted in design; no implementation authority inferred |
| Framework-neutral artifact/install/binding model | Artifact value, additive DDL, admission preparation, neutral stored loading/reconstruction, repository construction, starter authenticity, deterministic control-session lifecycle, private PostgreSQL adapter, exact point read, locked admission, bounded identity list, and focused PGlite evidence implemented privately; genuine-PostgreSQL acceptance remains incomplete; later lifecycle codecs stay gated |
| Relational schema representation | Pending preflight |
| Framework migration coordinator | Pending preflight |
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

The repository and DDL contract is accepted in
[`preflight/02-artifact-repository-and-ddl.md`](./preflight/02-artifact-repository-and-ddl.md).
Its additive tables, PGlite DDL evidence, runtime-authenticated admission
preparation, operation-neutral stored reconstruction, and control-bound
repository construction are implemented privately, together with the
authenticated session starter, deterministic control-session lifecycle,
private PostgreSQL control-session adapter, and deterministic fake-pool
evidence, plus the exact private point-read, locked-admission, and bounded
identity-list operations and focused PGlite evidence. Genuine-PostgreSQL
acceptance remains incomplete. The implemented sub-boundary contains only:

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

The remaining private acceptance work may add only genuine-PostgreSQL
migration, repository, settlement, locking, and concurrency evidence.

This authority stops at the files and evidence named by that record.
Installation, readiness, availability, Application-reference, Payload-overlay,
and `DataBindingSet` codecs remain later separate preflights. No framework
adapter, runtime caller, public API, or production activation is included.
