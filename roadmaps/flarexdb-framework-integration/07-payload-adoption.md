# Payload Adoption

## Status And Scope

Status: accepted source-backed sequence; native non-reactive relation
prerequisite complete, Payload adapter implementation not started

This plan owns the ordered adoption of Payload over Flarex application storage
and adapter-owned lifecycle state. It does not redefine native relation
semantics, public SDK syntax, or Payload's framework behavior.

The existing private `SV-R Core` relation vertical permits non-reactive Payload
adapter work. Fenced relation-sync registration and `SV-R Live` are
prerequisites only for subscriptions, live invalidation, reconnect, or
resnapshot claims.

There is currently no Payload dependency, adapter package, `ctx.cms` runtime,
or production Payload path in the repository.

The exact Payload contract preflight below may proceed now as source-backed
constraint extraction. It authorizes no dependency, adapter package, runtime
import, write-policy change, migration, or compatibility claim. The accepted
cross-lane order is owned by
[`preflight/05-core-first-three-lane-readiness.md`](./preflight/05-core-first-three-lane-readiness.md).

## Ownership Boundary

FlarexDB owns:

- stable application table and relation identities;
- authoritative document rows and revision history;
- row validation, indexes, uniqueness, relation target integrity, and derived
  edge maintenance;
- exact reads, OCC where applicable, commit facts, and outbox;
- schema artifact/readiness/activation mechanics; and
- trusted migration and operator capabilities.

Payload owns:

- collection/global configuration and observable API behavior;
- access control and principals;
- defaults, field validation, and hook ordering;
- nested request transactions;
- localization and population behavior;
- drafts, versions, publication visibility, and restore;
- uploads and object lifecycle;
- auth, sessions, globals, locks, jobs, preferences, and scheduled publication;
  and
- Payload-compatible query, result, and error behavior.

## CMS Exposure Modes

| Mode | Dashboard | Ordinary write owner |
| --- | --- | --- |
| Application table | absent | `ctx.db` application lane |
| CMS view | read-only | admitted `ctx.db` lane or application-domain commands |
| CMS managed | editable | one private Payload command pipeline through enabled surfaces; planned `ctx.cms` only after its separate public gate |
| Application-command managed | actions delegate to application-domain commands | application-domain command |

An editable CMS-managed table is excluded from ordinary generated `ctx.db`
write capabilities and protected by runtime checks. Migration, import, repair,
and fixtures use explicit privileged authority and cannot bypass database
invariants.

## Schema And Migration Ownership

```text
Flarex platform DDL
  -> Flarex platform migration owner

Application-owned CMS view
  -> authenticated Application declaration and active artifact
  -> Payload configuration validates against exact table identities

Payload-owned content collection
  -> pinned Payload compiler output with explicit provenance
  -> existing authenticated Application Analysis/publication chain
  -> canonical Application schema candidate
  -> existing managed-schema readiness and activation

Payload lifecycle/data migration
  -> Payload-owned semantic migration plan
  -> privileged shared migration host
  -> native row/relation/unique/commit invariants retained
```

Payload and Medusa do not share a migration language. Production startup fails
closed on schema mismatch and does not auto-apply lifecycle migrations.

The Payload compiler has no direct schema publication or activation authority.
If the existing authenticated Application Analysis chain cannot admit its
generated input without changing the current sole-source contract, that owner
change requires a separate preflight before the first collection proof.

## Adapter Package

Use one implementation-bearing package with a plain name:

```text
@flarex/payload-adapter
  normalized Payload operations
  pinned compatibility bindings
  trusted Flarex storage capabilities
  conformance fixtures
```

Payload-release differences belong in package-local compatibility bindings and
artifact provenance, not parallel version-named adapter packages.

## Implementation Sequence

### Exact Payload contract preflight

- Pin one exact Payload release, source revision, package graph, and
  provenance.
- Inventory `BaseDatabaseAdapter`, query/result/error shapes, transactions,
  migrations, internal collections, Local API nesting, hooks, access, and
  enabled surfaces.
- Produce supported, deferred, and rejected behavior matrices.
- Freeze package dependency direction.
- Create no adapter package or compatibility claim before acceptance.

### Shared-core and Application preservation prerequisites

Before the first Payload adapter or writable collection is implemented:

- complete the value-only relational schema, installation/readiness/binding,
  migration-coordinator, owner-scoped transaction/store, receipt/finalizer, and
  synthetic reserved-relational lifecycle/transaction proof gates required by
  the core-first preflight;
- rerun the complete existing Flarex Application document, OCC, native-relation,
  commit, and read vertical without routing Application content through the
  reserved-relational store; and
- retain Application as the schema, row, OCC, relation, and commit authority for
  Payload content.

These prerequisites prepare shared mechanisms and prove non-regression. They do
not make Payload content a `RelationalSchema` consumer or authorize Payload
framework behavior inside shared core.

### CMS request transaction and commit participation preflight

Before scalar CRUD implementation, complete the mandatory transaction-owner and
commit-owner preflights from
[`04-transactions-and-commit-publication.md`](./04-transactions-and-commit-publication.md):

- define the CMS request transaction host, nested Local API reuse, scope and
  binding revalidation, timeout, interruption, rollback, settlement, and exact
  finalization boundary;
- compose authenticated Application row and later relation capabilities without
  exposing the current `AppRowTransaction`, a raw database handle, or the
  reserved-relational transaction host;
- do not use the Dynamic Worker logical journal for trusted Payload commands;
- publish scalar content mutations only through the already admitted exact
  Application-row fact family and common finalizer; and
- require a separate typed family and commit-owner preflight before any Payload
  lifecycle sidecar can participate in a commit.

This gate must be accepted before implementing nested rollback, transaction-
local reads, or the exactly-one commit/change/outbox claim.

### Application write-policy admission preflight

This separately approved Application-owner gate is mandatory before the first
writable Payload vertical because the current framework-binding work does not
authorize a change to application commit admission:

- define an independently digestible Payload configuration/provenance artifact
  over stable logical table identities and a stable Payload policy ID,
  excluding the later exact Application head/schema/readiness/placement
  reference and every digest derived from it;
- record that policy ID and configuration digest as authenticated per-table
  write-policy evidence in the canonical Application artifact;
- make every application write admission consult that evidence at runtime;
- use a newly declared Payload-managed table for the first proof;
- activate its Application artifact in a state that rejects ordinary `ctx.db`
  writes while Payload writes remain unavailable;
- construct and activate the content overlay only after the Application artifact
  is final, referencing both digests plus the exact Application
  schema/readiness/placement and table identities, and only while that head and
  policy evidence still match; and
- defer transfer of an existing app-writable table until a later gate proves
  atomic capability revocation and overlay activation with no dual-writer
  interval.

### Relation-free schema binding

- For the first vertical, bind one Payload-configured collection containing
  top-level scalar fields and send its pinned, provenance-bearing compiler
  output through the existing authenticated Application Analysis/publication
  chain to produce one canonical Application schema candidate with exact stable
  table identities.
- Make the Payload content overlay reference that exact active Application
  head/schema/readiness/placement reference and table identity, its
  authenticated write-policy evidence, and the pinned Payload
  configuration/provenance digest; do not install a second content schema. Add
  a separate lifecycle binding only when physical Payload lifecycle structures
  exist.
- Select the CMS-managed write-authority mode for that fixture.
- Reject conflicting ownership and unsupported fields/options before startup.
- In a separate follow-up fixture, expose an already Application-owned table as
  a read-only CMS view or application-command-managed view while its admitted
  `ctx.db` lane/application-domain commands remain the write owner.
- No table has two schema or ordinary write-policy owners in either fixture.
- Keep versions, drafts, auth, globals, uploads, relations, and lifecycle
  migrations disabled.

### Runtime write-authority prerequisite

This gate must pass before the first CMS-managed write is accepted:

- Prove CMS views are read-only through Payload.
- Route CMS-managed writes through one private Payload command implementation.
- Keep application-command-managed aggregates free of raw dashboard mutation.
- Reject direct application writes to Payload-managed tables at runtime.
- Make any trusted access override explicit and separately authorized.
- Prepare capability/codegen exclusion for later public surfaces, but do not
  treat TypeScript exclusion as the runtime trust boundary.
- Expose only a private operation suitable for later dashboard and `ctx.cms`
  composition; public syntax and codegen remain SDK-roadmap work.

### Scalar CRUD and request transaction

- Implement the admitted CRUD, find, count, filter, sort, selection, and page
  subset over application rows and declared indexes/uniques.
- Reuse one request transaction for nested Payload operations.
- Roll back every nested row and sidecar mutation on failure.
- Publish Flarex commit/change/outbox evidence exactly once.
- Do not use the Dynamic Worker logical journal for trusted Payload commands.
- Use PGlite for the fast matrix and genuine PostgreSQL for rollback,
  uniqueness, transaction-local reads, and concurrency.

### Relation-bearing Application candidate and overlay rebinding

- Capture a new independently digestible relation-bearing Payload
  configuration/provenance artifact. The stable Payload policy ID and ordinary
  write-owner mode may remain unchanged, but the configuration digest must
  change from the scalar candidate.
- Compile that exact relation-bearing configuration through the existing
  authenticated Application Analysis/publication chain as one new Application
  schema candidate, recording the new Payload configuration digest in its
  authenticated per-table write-policy evidence.
- Build its managed-schema structures and activate only after the exact
  readiness proof passes.
- Rebind the Payload content overlay to that exact active Application head,
  schema/readiness/placement reference, stable table and relation identities,
  authenticated write-policy evidence, stable policy ID/write-owner mode, and
  the new relation-bearing Payload configuration/provenance digest.
- Reject serving from the previous overlay after Application head movement and
  prove that no second content schema or dual-writer interval exists.
- Keep Payload lifecycle/data migrations and unrelated schema features disabled
  for this first relation candidate.

### Native relation adoption

Admit only the already proven non-reactive native storage and query guarantees
first:

- top-level, nonlocalized, monomorphic one/many values;
- duplicate rejection;
- target liveness and restrict deletion;
- source cleanup, retarget, reorder, and removal;
- bounded forward identity reads; and
- bounded reverse identity reads without unsupported filtering, sorting,
  counting, or orderability.

The Payload adapter separately composes bounded forward population, reverse
join behavior, authorization, and response shaping over those native
guarantees. That composition does not expand the native relation contract.

Repeated relation targets remain disabled. A separate later gate must prove
stable repeated-occurrence identity, ordering, mutation, OCC, and pinned Payload
conformance before accepting a configuration that permits them.

Run the claimed upstream relationship behavior plus PGlite and genuine
PostgreSQL evidence. This step makes no subscription or reconnect claim.

### Broader schema evolution and lifecycle migrations

- Publish content changes only through the authenticated Application
  Analysis/publication chain as Application schema candidates.
- Activate only after existing managed-schema readiness.
- Execute Payload lifecycle/data plans through the fenced migration host.
- Prove checksums, replay, interruption, retry, receipts, and recovery.
- Permit hook bypass only through explicit migration/import/repair authority
  while retaining row, relation, uniqueness, scope, feed, and outbox rules.

### Lifecycle islands

Admit each independently rather than claiming broad Payload parity:

- globals;
- localization;
- nested arrays and blocks;
- uploads and object lifecycle;
- auth and sessions;
- versions, drafts, and publication visibility;
- document locks; and
- jobs, preferences, and scheduled publication.

Draft/version relations require explicit visibility, edge, delete, and
invalidation semantics.

### Reactive relations

This step requires fenced relation-sync registration and `SV-R Live`.

- Consume native typed relation facts and registration authority.
- Prove duplicate, reverse, gap, lost-wake, restart, epoch, retained-floor,
  resnapshot, and reconnect behavior.
- Do not introduce a Payload-local invalidation registry or timestamp fallback.

## Application/CMS-To-Commerce References

Payload may manage an extension row that refers to a stable commerce identity.
It may mutate only the extension row. Target mutation goes through the commerce
lane.

The reference is neither a Payload reverse join nor a Medusa Module Link.
Existence, deletion, soft deletion, visibility, staleness, and binding
compatibility require an explicit cross-domain reference contract.

## Exit Criteria For Private Integration

- Every enabled table has one write-policy owner.
- The claimed Payload operations and errors match the pinned release.
- Nested request operations are transactionally atomic.
- Content schema and lifecycle migrations follow their separate owners.
- Native relation reuse introduces no second row or edge authority.
- Genuine PostgreSQL proves concurrency and rollback claims.
- Reactive behavior is claimed only after its external prerequisites pass.
- Public `ctx.cms`, dashboard routing, hosted operation, and production
  activation remain separate explicit decisions.
