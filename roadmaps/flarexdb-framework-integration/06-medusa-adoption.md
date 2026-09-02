# Medusa Adoption

## Status And Scope

Status: accepted source-backed sequence with the inert fork source island and
exact package/capability audit complete; active package promotion and the
Flarex-backed Medusa adapter remain unimplemented, gated by the core-first
three-lane proof, and production-unauthorized

This plan owns the ordered adoption of the Medusa fork onto FlarexDB reserved
relational storage. It preserves Medusa's DML, module, repository, Query, Link,
workflow, locking, idempotency, and commerce-event semantics.

It does not turn Medusa tables into public application tables or make Flarex
core depend on Medusa.

## Source Authority

The primary integration source is the Cloudflare-oriented fork maintained at
`https://github.com/agmmdotdev/medusa-fork.git`. Official Medusa source and npm
packages are historical provenance, licensing, and comparison evidence; they
will not override behavior in the future selected fork snapshot.

[`preflight/04-medusa-fork-source-island-and-package-convergence.md`](./preflight/04-medusa-fork-source-island-and-package-convergence.md)
owns the exact source hierarchy, clean pin, inert `third_party/medusa` island,
verification contract, reuse classification, and later package-promotion
gates. The island is not a production dependency. Only source-map-admitted
packages promoted into the active root workspace may later enter the Medusa
adapter graph.

[`preflight/05-core-first-three-lane-readiness.md`](./preflight/05-core-first-three-lane-readiness.md)
owns the prerequisite order before any such package promotion. Source mapping
and inert fixture extraction may proceed early; package convergence waits for
the shared-core, Flarex Application, and Payload gates named there.

[`preflight/06-medusa-package-capability-source-map.md`](./preflight/06-medusa-package-capability-source-map.md)
now owns the exact fork-pin capability audit, the reproducibly measured
65-input Currency semantic graph, exploratory broader graph notes, reuse
classifications, retained test inventory, and source consequences for the
value-only relational schema. Its companion JSON is machine-readable audit
evidence, not a promoted package manifest.

The admitted island now pins fork commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f` as 8,496 exact tracked regular
files under [`third_party/medusa`](../../third_party/medusa). Its checksum and
boundary verifiers are root-owned admission tooling, not a Medusa runtime
dependency. No root `@medusajs/*` package or Flarex adapter exists yet.

## Current Source Findings

The locally audited fork demonstrates important compatibility surfaces:

- modules currently consume the mature `@medusajs/utils/dml/model` grammar,
  whose models include scalar fields, indexes, checks, defaults, soft-delete
  behavior, and relationship metadata;
- the newer `@medusajs/dml` implementation is currently scalar-only even though
  its types describe relationships, so it is not the module grammar to mirror;
- repository contracts include transaction reuse, list/count/query, create,
  update, upsert, delete, soft delete, restore, and relation replacement;
- static module manifests provide a Worker-safe alternative to filesystem
  discovery;
- `Context.transactionManager` is the existing transaction propagation seam;
- Module Joiner and Link definitions carry endpoint, alias, cardinality,
  cascade, extra-data, and read-only semantics; and
- custom repositories and Query require more than basic generated CRUD.

The fork is also substantially more advanced than a plain Node-oriented
Medusa checkout. It contains portable DML/DAL experiments, Drizzle and
Cloudflare persistence packages, Worker-safe runtime entrypoints, static
manifests, Query/runtime work, Cloudflare workflow/event/lock integrations,
physical Worker import guards, and real unchanged module assertions exercised
through multiple persistence lanes.

That work is valuable source and conformance evidence to reuse. It is not yet
a Flarex-backed production adapter:

- prepared module models are held in mutable module-global state while static
  modules may load concurrently;
- its generated Drizzle migration adapter intentionally throws from the
  optional run/revert methods and therefore does not provide the Flarex-managed
  production migration lifecycle;
- link modules still use MikroORM entity generation and PostgreSQL
  introspection/diff logic; and
- Link uniqueness uses an application precheck that storage must close under
  concurrency.

The exact audit has now regenerated these findings at fork commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The checked-in command
reproducibly measures a 65-input real Currency model/service graph with zero
checked Worker blockers. The observed 76-input static-manifest and 130-input
eager Drizzle graphs remain exploratory snapshots without a frozen reproducible
tool policy; their exact counts are not accepted receipts. Source evidence still
rejects the eager Drizzle graph as an unchanged Currency closure. The first
later promotion therefore separates Currency semantics/static bootstrap from a
translated persistence seam.

## Ownership Boundary

FlarexDB owns:

- scope-qualified physical lowering;
- schema artifact, installation, migration receipt, readiness, and binding;
- columns, indexes, checks, constraints, and transaction enforcement;
- transaction settlement and commit publication;
- optional derived adjacency and storage observability; and
- backup, restore, repair, and operator mechanics.

Medusa owns:

- DML authoring and normalization;
- static module manifests and dependency injection;
- complete module-set coordination;
- Joiner aliases, linkable keys, and Module Link meaning;
- repository and custom-repository behavior;
- query-option, Query, RemoteJoiner, GraphQL, and index planning;
- Link attach/dismiss and lifecycle;
- workflows, locks, idempotency, and commerce events; and
- semantic migration and data-backfill intent.

## Module-Scoped Persistence Preparation

Replace process-global prepared-model state with an immutable module-scoped
binding:

```text
prepareModule(module identity, normalized models, repositories, capabilities)
  -> PreparedModulePersistence
```

The result captures the exact module schema subset and authorized relational
handles. Loading another module cannot change it.

All module preparations and resolved links then feed one coordinator. Here,
"complete" means the complete configured supported module/link set for that
candidate, not every module in the commerce universe:

```text
static manifests
  -> normalize actual DML
  -> collect module ownership and capabilities
  -> resolve Joiner and Module Links
  -> finalize complete configured candidate set
  -> compile one owner-qualified artifact whose payload is RelationalSchema
```

Do not create a third DML grammar. Normalize the mature Medusa model once and
compile its value output into Flarex `RelationalSchema`.

## Initial Compatibility Profile

The first supported environment is deliberately narrow:

- one admitted clean snapshot of the primary Medusa fork with its official
  upstream provenance baseline recorded;
- one homogeneous configured supported module/link set per candidate; the
  first candidate may contain Currency alone;
- one shared physical relational installation;
- scope-qualified reserved tables and constraints;
- static manifests rather than runtime filesystem discovery; and
- no per-scope custom schema or staggered module generation.

Unsupported modules, repository capabilities, link shapes, triggers, or
migration requirements fail admission before serving traffic.

## Implementation Sequence

### Source-island admission

- Completed without adding a root package, adapter, runtime import, route, or
  deployment binding.
- The clean committed fork pin, independent workspace, lockfile, patches,
  package graph, provenance, licenses, exact bytes/modes, and selected
  regression commands are preserved and mechanically verified.
- The root boundary derives active Flarex package names from root manifests and
  rejects package/import edges, relative or absolute file and workspace path
  dependencies, manifest/TypeScript/bundler aliases, static code and JSDoc
  references, symlinks, broad workspace membership, and implicit root-script
  entry. Island manifests, sources, configs, and symlinks are checked in the
  reverse direction. A dedicated path-filtered CI job enforces admission.

### Source maps and contract audit

- Completed at the exact admitted pin without importing the island into Flarex
  code.
- Mature DML remains the schema-normalization authority; standalone
  `@medusajs/dml` is rejected as a relationship-capable replacement.
- Repository, transaction, Query, Joiner/Link, migration, workflow, lock,
  idempotency, and event capabilities are classified with exact sources.
- Currency model/service/static inputs, initial data, legacy migrations, test
  evidence, graph measurements, and package direction are frozen as audit
  constraints.
- The current process-global prepared-model/module registries are rejected as
  Flarex scope authority.

### Schema admission

- Completed privately in
  [`preflight/08-relational-schema-value-contract.md`](./preflight/08-relational-schema-value-contract.md):
  the canonical value-only `RelationalSchema`, deterministic normalization,
  framework-artifact digest/provenance composition, and unsupported-capability
  failures use the source-audited capability matrix and exact representative
  fixtures.
- Accepted in design only in
  [`preflight/09-relational-installation-and-migration-coordination.md`](./preflight/09-relational-installation-and-migration-coordination.md):
  scope-isolated physical lowering, stable collision-domain migration
  coordination, structural readiness, and availability. Every implementation
  and the later binding checkpoint remain pending.
- Keep live fork DML normalization and candidate compilation outside this step;
  those begin only after the connected source closure is promoted.
- Generate no public application schema and expose no raw database handle.

### Shared-core and earlier-lane promotion hold

Do not begin the Currency-connected foundational promotion until all of these
are complete:

- the completed exact Medusa source/capability map and exact Payload contract
  preflight;
- completed value-only `RelationalSchema` admission;
- completed framework installation, readiness, availability, and migration-
  coordinator mechanics, followed by the separate binding checkpoint;
- an owner-scoped relational transaction/store capability;
- transaction-bound mutation receipts and typed common finalization under their
  separately accepted owner preflights;
- a synthetic reserved-relational lifecycle/transaction proof, including
  fail-closed unadmitted-receipt rejection and rollback, in PGlite and genuine
  PostgreSQL;
- the complete existing Flarex Application document/OCC/native-relation/commit
  regression proof;
- Payload scalar CRUD and nested request-transaction proof; and
- Payload's first non-reactive top-level one/many relation proof.

These gates prepare and verify the mechanisms Medusa will later consume. They
do not implement Medusa semantics in shared core. Once they pass, promotion
still begins with unchanged fork compatibility and remains separate from the
later Medusa transaction-propagation and typed commerce receipt adaptations.

### Currency-connected foundational promotion

- Treat the promotion unit as the private, test-only connected Currency
  portability closure, not as one superficially isolated npm package.
- Admit and promote only the actual Currency model, service, static manifest,
  mature DML normalization, and exact portable DAL, modules-sdk, type, utility,
  module-preparation, and repository-adapter closure required to establish the
  unchanged relocation baseline.
- Preserve `@medusajs/*` manifest identities where they are part of the fork's
  internal compatibility graph while using root-owned dependency versions,
  tests, and bundle gates.
- Give every promoted package a source map to the exact fork commit and source
  closure; retain no runtime import or file dependency on the island.
- Establish the unchanged fork compatibility baseline before adapting a Flarex
  host seam.
- Compile the complete configured normalized module/link set for the first
  candidate into canonical `RelationalSchema` values through the promoted
  source closure.
- Before any runtime adaptation, replace mutable prepared-model state with
  instance- or module-scoped ownership and define `MedusaModule` state
  isolation.
- Do not mistake the standalone scalar-oriented portable DML experiment for
  the complete mature relationship-capable module grammar.
- Keep migrations, Link, workflows, locks, events, idempotency, CMS
  interaction, and public commerce APIs outside this first promoted closure.

### Commerce transaction-host admission

- Complete the separate transaction-owner preflight before receipt-family
  implementation or any Currency write.
- Prove Flarex-owned scoped physical transaction acquisition, binding
  revalidation, isolation, timeout, interruption, commit, rollback, and
  settlement.
- Adapt Medusa's transaction-manager contract and nested propagation without
  giving Medusa or a repository the raw physical handle or finalizer.
- Freeze lock order and the point at which the canonical publication lock is
  acquired after lane work.

### Commerce-row commit and event-intent admission

- Complete the separate commit-owner preflight before any Currency write.
- Add typed commerce-row mutation receipts and facts to the common finalizer.
- Add only the pinned typed Medusa event-intent contracts required by the
  Currency behavior under test.
- Persist each admitted event intent with the same commit and common outbox
  wake, then dispatch by stable identity with durable retry and delivery state.
- Introduce no temporary publication path, arbitrary event envelope, second
  feed, or second outbox.

### Currency baseline

- Produce a fresh baseline for the Currency module.
- Install through the migration coordinator.
- Bind a scope-pinned commerce transaction manager.
- Adapt generated repository operations.
- Run unchanged Currency service and relevant integration tests.
- Prove scope isolation, uniqueness, rollback, transaction-local reads, and
  authoritative transaction settlement in genuine PostgreSQL.
- Prove each accepted write publishes its typed commerce-row fact, any admitted
  event intent, and the common outbox wake in the same commit.

### Product event-intent expansion

- Before the first Product create, update, delete, relation replacement, or
  restore proof, inventory the exact events emitted by the unchanged Product
  service behavior.
- Complete the event-intent commit-owner extension and admit those typed
  contracts into the existing durable intent/finalizer path.
- Reject the Product mutation vertical until this admission is active.

### Product relationships

- Normalize the current Drizzle compiler's existing physical foreign-key and
  implicit many-to-many pivot behavior into a Medusa-owned artifact.
- Prove its deterministic Flarex lowering, filtering, population, replacement,
  deletion, and migration behavior.
- Keep Query and cross-module links outside this step.

### First Link endpoint candidate

- Select one real non-read-only Module Link and both exact endpoint modules from
  the pinned supported source set.
- Add, compile, install, and prove the second endpoint module with Product as one
  complete configured candidate before any Link mutation; before event-intent
  admission, its executable proof is limited to schema, startup, and read-only
  repository behavior.
- Inventory every domain event emitted by the unchanged endpoint services and
  Link behavior.

### Commerce-link commit admission

- Complete the separate commit-owner preflight for the commerce-link family.
- Add a transaction-bound commerce-link receipt and typed fact to the common
  finalizer before the first stored Module Link can write.
- Admit the exact typed event-intent contracts emitted by both endpoint modules
  and the Link behavior before executing them.
- Preserve the existing commit order and common outbox authority.

### First Module Link

- Prove any required second-endpoint mutations only after its event-intent
  contracts are admitted.
- Compile one stored resolved link with real cardinality and lifecycle.
- Enforce uniqueness/cardinality atomically in storage.
- Prove attach, dismiss, soft delete, restore, `deleteCascade`, the pinned
  duplicate/retry outcomes, and concurrency.
- Add a derived adjacency projection only if measured query or sync needs
  justify it.

### Custom repositories and Query

- Admit repository-specific relational query capabilities one use case at a
  time.
- Keep custom-query capabilities read-only; add a dedicated receipt-producing
  operation for every admitted custom write.
- Translate Medusa query shapes in the adapter.
- Preserve module-service and Query semantics.
- Do not create a public universal query AST.

### Workflows and locks

- Prove transaction boundaries around workflow steps.
- Do not hold database locks across workflow pauses or remote effects.
- Adapt lock and idempotency stores through their own bounded capabilities.
- Test crash, replay, duplicate delivery, timeout, and lost-response behavior.

## Migration Policy

Fresh installs compile a baseline from the admitted primary-fork snapshot and
the complete configured supported module/link set for the candidate. Later
upgrades combine structural artifact differences with explicit Medusa-owned
semantic transformations.

Historical MikroORM/Postgres migrations remain legacy-backend evidence. They
are translated only when a proven compatibility obligation requires a
particular behavior. Production startup verifies the active commerce digest
and never silently applies DDL.

## Exit Criteria For Private Integration

- The primary fork snapshot, official-upstream provenance baseline, source
  file set, modes, links, lockfile, patches, licenses, and notices reproduce
  exactly.
- The inert island remains outside the root workspace and every active runtime
  import graph.
- Every promoted package or connected capability has an accepted source map,
  bounded dependency closure, reuse classification, and retained test evidence.
- All admitted modules use module-scoped immutable preparation.
- Complete module/link compilation is deterministic.
- Runtime binds to exactly one active commerce digest.
- Unchanged claimed Medusa tests pass against the Flarex adapter.
- Real PostgreSQL proves transaction, constraint, lock, concurrency, and
  migration behavior.
- Commerce writes publish through one Flarex commit/feed/outbox authority.
- No public application API can access reserved commerce rows.
- Unsupported capabilities fail closed before startup.
- Hosted, operator, scale, observability, and production activation remain
  separate gates.
