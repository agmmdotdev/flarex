# Backend Data Model And Durable Object Shape

## Freeze One Semantic Table-Definition Source

Previous completed checkpoint: `00e15c7` Require evidence-first design review.

What changed:

- Added a strict, versioned `tableDefinitions` protocol section for stable
  app-document table bindings and required object validators.
- Required positive branded table IDs in ascending numeric order and unique
  logical identity bindings. Unknown legacy, physical, index, relation, and
  lifecycle fields fail decoding.
- Ported Convex's 64-byte ASCII identifier rules for app table names, nested
  object fields, and `v.id(...)` targets before append-only catalog allocation;
  app table names cannot enter the reserved `_` system namespace.
- Pinned the definition to immutable `ObjectValidatorJsonV1`; the existing
  unversioned validator exports remain compatibility aliases, so later
  validator growth cannot silently change definition v1.
- Kept each versioned table definition only in the existing
  `fx_control_schema_version.manifest_json` artifact. Explicitly removed the
  proposed `fx_control_table_definition`, `physical_name`, and duplicate
  `definition_json` from the accepted v1 design; no DDL changed.

Why it changed:

A per-table JSON projection would create a second schema authority and a new
drift invariant without helping the first trusted app-row slice. The stable
`fx_control_table` row needs only identity; the immutable artifact owns the
versioned definition.

Convex references inspected:

- `crates/common/src/bootstrap_model/schema_metadata.rs`
- `crates/common/src/bootstrap_model/tables.rs`
- `crates/common/src/schemas/mod.rs`
- `crates/common/src/schemas/json.rs`

How Flarex differs:

- Convex persists one typed schema string and a separate table mapping. Flarex
  follows that split, adding a stable numeric ID plus namespace/name assertion
  because its deployment catalog reserves app, Payload, Medusa, and system
  identity domains.
- Convex uses name-ordered maps. Flarex requires numeric-ID ordering before its
  array-preserving canonical manifest codec hashes the section.

Known limitations and follow-up:

- Section v1 proves only app-document definitions. Payload and Medusa require
  later source-derived variants; indexes, relation/constraint semantics,
  catalog binding/persistence, activation, rows, and OCC remain deferred.
- S03-D still owns target-existence and cross-reference validation after the
  section's identifier-level checks.
- The current analyzer's sorted-name ordinal IDs are not stable catalog IDs and
  cannot be written into this section. S03-B2b owns trusted resolution.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol exec vitest run test/schema-manifest-table-definitions.test.ts
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-dev typecheck
corepack pnpm check:effect-boundaries
git diff --check
```

## Persist Immutable Deployment-Owned Schema Artifacts

Previous completed checkpoint: `54f0022` Persist stable table identities.

What changed:

- Added strict branded schema-version, codec-version, canonical-byte, and
  SHA-256 contracts plus deterministic manifest codec v1. It hashes the
  codec's domain-separated UTF-8 bytes rather than PostgreSQL `jsonb`.
- Added `fx_control_schema_version` as an additive deployment-owned artifact
  table. It stores the semantic manifest JSON, exact canonical bytes, codec
  version, 32-byte checksum, and creation time under deployment-qualified
  identity and version uniqueness.
- Added only transaction-scoped ensure and deployment-qualified point-read
  functions. Exact replay is idempotent; identity/version conflicts, checksum
  collisions, and stored evidence mismatches fail closed. Full point reads
  re-encode JSON and detect stored JSON/byte/digest drift.
- Added an opaque repository-prepared token: strict validation, canonical
  encoding, and hashing finish before SQL begins, while the short transaction
  receives no caller-controlled bytes or checksum. Invalid input and
  operational preparation failure remain distinct errors.
- Rejected array subclasses/replaced prototypes and encoded arrays by indexed
  values so input-owned methods cannot alter canonical bytes after validation.
- Returned defensive byte/digest copies so mutating a created result cannot
  mutate its hidden prepared token across rollback or replay. The deployment
  lock performs no canonicalization or Web Crypto work.
- Proved the codec contract, PGlite migration/rollback/immutability behavior,
  and concurrent real-Postgres replay and conflict behavior.
- Updated the internal-schema and v1-cutline sketches so they no longer imply
  a text checksum, omitted canonical bytes, or mutable artifact status.

Why it changed:

Stable table IDs need an immutable version artifact before later normalized
table definitions can bind them. Keeping semantic JSON and canonical bytes
together preserves both inspectability and exact checksum provenance without
letting database JSON normalization define identity.

Convex references inspected:

- `crates/common/src/bootstrap_model/schema_metadata.rs`
- `crates/database/src/bootstrap_model/schema/mod.rs`
- `crates/common/src/bootstrap_model/schema_state.rs`
- `crates/application/src/schema_worker/mod.rs`

How Flarex differs:

- Convex compares typed schema values in its metadata model. Flarex adds an
  explicit canonical codec and SHA-256 boundary for a shared PostgreSQL
  control catalog.
- The artifact is deployment-owned and append-only through the repository.
  Lifecycle status and the sole future scope active pointer remain separate;
  this checkpoint changes neither.

Known limitations and follow-up:

- S03-B2 still owns versioned table definitions; indexes, lifecycle,
  compilation, validation, and activation remain later S03 slices.
- Privileged SQL can coherently rewrite the three stored representations; a
  trigger/role policy is unresolved. Codec depth is bounded at 128, while a
  maximum canonical byte size remains to be fixed before untrusted routing.
- No analyzer/executor route, OCC, row storage, commit compiler, sync, Payload,
  Medusa, or Cloudflare behavior changed.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/schemaVersionArtifacts.test.ts test/stableTableCatalog.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter @flarex/persistence-postgres db:check
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/schemaVersionArtifacts.postgres.test.ts --no-file-parallelism
corepack pnpm check:effect-boundaries
git diff --check
```

## Persist Stable Deployment-Scoped Table Identities

Previous completed checkpoint: `9b924dd` Resolve trusted scope authority.

What changed:

- Added the first S03 replacement catalog row, `fx_control_table`, with a
  compact positive integer `table_id`, explicit `app | payload | medusa |
  system` namespace, logical name, creation time, restrictive deployment
  ownership, and deployment-qualified primary/unique keys.
- Added branded `CatalogTableId` protocol decoding bounded to PostgreSQL
  `integer`, plus a closed namespace contract. The table-allocation input
  forbids `tableId` structurally and rejects it at runtime, so the analyzer's
  current sort-order ordinal cannot become catalog authority.
- Added a transaction-only idempotent allocator. It locks the owning deployment,
  replays an existing namespace/name mapping, or appends `max(table_id) + 1`.
  Rollback consumes no identity, and a missing deployment fails closed.
- Added deployment-qualified reads by table ID and namespace/name. No allocator
  was added to the general runtime persistence interface.
- Added migration `0020_open_mysterio` without backfill or legacy-table changes,
  plus PGlite upgrade/constraint tests and a real PostgreSQL concurrency proof.

Why it changed:

The current analyzer sorts table names and assigns `index + 1`; inserting an
earlier name can renumber every later table. S03 needs an authoritative stable
mapping before immutable schema versions, app rows, OCC, or adapter compilation
can safely refer to compact table identities.

Convex references inspected:

- `crates/database/src/bootstrap_model/table.rs`
- `crates/value/src/table_mapping.rs`
- `crates/value/src/document_id.rs`

How Flarex differs:

- Convex owns table-number and tablet mappings inside one backend metadata
  model. Flarex serializes deployment-local allocation with a short PostgreSQL
  transaction because distributed Workers must not hold a transaction across
  analyzer or user-code execution.
- Flarex records the accepted adapter namespaces explicitly. This reserves
  identity domains for Payload and Medusa but does not implement either
  adapter's schema or behavior.

Known limitations and follow-up:

- S03 remains open. Schema versions/manifests, stable index identities,
  immutable definitions, build state, relation/constraint IDs, compilation,
  checksum verification, and activation readiness are later slices.
- The catalog API is append-only by ownership and exposes no update/delete
  operation; this checkpoint does not add database triggers against privileged
  manual mutation.
- The analyzer and executor still use their legacy representations. No row
  storage, OCC, commit compiler, sync, Payload, Medusa, or Cloudflare routing
  behavior changed.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts test/stableTableCatalog.test.ts --no-file-parallelism
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/stableTableCatalog.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm check:effect-boundaries
git diff --check
```

## Resolve Trusted Scope Authority Without Routing Execution

Previous completed checkpoint: `d0ab976` Compile hosted proof bundle.

What changed:

- Added the read-only S02-D1 resolver over three narrow capabilities:
  deployment scope metadata, split provisioning receipts, and one
  locator-bound clock-target resolver for every topology.
- Every placement now resolves only through its defensively captured persisted
  locator. Split placement additionally requires an exact `ready` receipt
  before target resolution and rejects receipt, target-locator, or
  returned-clock identity drift.
- Deployment identity, scope ID, and topology are captured into immutable
  intent before any receipt or target await, so reader-owned objects cannot be
  mutated into a different authority mid-resolution.
- Returned authority preserves the actual storage generation, generation
  fence, epoch, commit/outbox counters, and physical placement. Missing
  metadata or clocks never imply `legacy_v1`.
- The result is a frozen scalar/branded projection with a frozen locator, not
  an alias to reader-owned scope, clock, or mutable timestamp objects.
- Added a PGlite-backed shared-authority proof plus a pure failure matrix for
  missing metadata, cross-deployment scope confusion, reserved/mismatched
  receipts, both split topologies, wrong shared/split targets, scope/locator
  mutation, typed malformed target output, missing clocks, and cross-scope
  clocks.

Why it changed:

S02-C made scope location and clock readiness durable, but current executor
code still derives a temporary scope alias from the deployment ID. Catalog,
snapshot, and OCC work need one fail-closed authority input before that legacy
alias can eventually be removed.

Convex references inspected:

- `crates/database/src/database.rs`
- `crates/database/src/transaction.rs`
- `crates/application/src/application_function_runner/mod.rs`

How Flarex differs:

- Convex constructs one transaction from its owned database snapshot and
  carries that begin timestamp into function execution. Flarex must first join
  a control-plane scope locator to a possibly separate data-plane clock, then
  later pin and revalidate the returned epoch/generation fence.
- The split `ready` receipt and locator resolver are Flarex topology concerns;
  they do not exist in Convex's single backend authority domain.

Known limitations:

- This is resolve-only S02-D1. It does not wire `createFlarexExecutor`, alter
  `/invoke/*`, remove the legacy session alias, issue a snapshot, or route any
  application read/write.
- Resolution is intentionally read-only and cannot make the control/target
  reads one distributed snapshot. O02/O03 must pin the returned authority and
  O06 must revalidate its epoch/generation fence inside the final transaction.
- Live Cloudflare/Hyperdrive activation is deferred. H05-B remains required
  before production executor routing is enabled, but is not required for this
  host-neutral resolver or the next additive core schema turns.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/scopeAuthorityResolution.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Reconcile Split Authority Across Control And Located Target Stores

Previous completed checkpoint: `b320ab2` Add split scope provisioning
receipts.

What changed:

- Added a host-neutral split authority provisioner. A genuinely absent
  deployment now receives one generated scope ID, one generated initial epoch,
  one trusted split locator, and one `reserved` receipt in the same short
  control transaction.
- Added a located target capability that owns its own transaction and inserts
  or reads back exactly `legacy_v1`, fence `1`, commit/outbox sequence `0`, and
  the receipt epoch. A different existing clock is preserved and rejected.
- Reopened control only after target completion and published `ready` through
  the exact receipt CAS. Replay reuses persisted intent; once ready, it checks
  current located-clock existence without requiring the historical initial
  tuple or resetting legitimately advanced authority.
- Proved reservation rollback, resolver failure, target rollback, lost target
  response, final control drift, ready replay, stale-reserved races, conflicting
  target preservation, and concurrent convergence on PGlite.
- Added paired real-Postgres schemas/pools and a deterministic advisory-lock
  proof. Two reconcilers overlap at target insertion while a `NOWAIT` probe
  acquires deployment, scope, and receipt control locks, proving no control
  transaction spans target I/O.

Why it changed:

C3b1 made partial split provisioning recoverable but did not create target
authority. C3b2 completes the monotonic `reserved -> target ready -> control
ready` protocol without claiming a distributed transaction.

Convex references inspected:

- `crates/model/src/database_globals/mod.rs`
- `crates/application/src/lib.rs`
- `crates/common/src/bootstrap_model/index/database_index/index_state.rs`
- `crates/database/src/database_index_workers/mod.rs`
- `crates/common/src/bootstrap_model/schema_state.rs`
- `crates/application/src/schema_worker/mod.rs`
- `crates/model/src/migrations.rs`

How Flarex differs:

- Convex persists intent, completes background work, and publishes state inside
  one backend/OCC domain. Flarex repeats that monotonic pattern with an exact
  receipt because control and located Postgres targets are independent SQL
  domains.

Known limitations:

- This remains host-neutral S02-C. No schema/database creator, credential or
  Hyperdrive mapping, production Worker composition, runtime generation
  routing, sequence allocation, OCC, compiler, sync, Payload, or Medusa work
  is included.
- The trusted synchronous planner is pure and may be evaluated by concurrent
  absent-deployment contenders; only the transaction winner persists its
  locator and generated authority.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres test:postgres
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm typecheck
corepack pnpm check:effect-boundaries
git diff --check
```

## Persist Split Provisioning Intent Before Publishing Readiness

Previous completed checkpoint: `a4c290f` Fence executor deployment creation.

What changed:

- Added additive migration `0019` and the one-to-one
  `fx_control_scope_provisioning` receipt. It stores only exact split-placement
  intent, protocol `split_scope_authority_v1`, the winning initial epoch,
  `reserved | ready`, and ordered reservation/readiness timestamps.
- Kept the stable `fx_control_scope` locator separate from lifecycle state.
  Existing shared and split scopes receive no synthetic receipt because their
  original epoch/protocol intent cannot be reconstructed safely.
- Added strict receipt decoding plus transaction-composable reservation and
  exact `reserved -> ready` CAS primitives. They lock the canonical scope row,
  reject locator drift, adopt the persisted epoch after a reservation race,
  and expose no reverse/delete operation.
- Proved atomic scope/receipt rollback, replay, constraints, corruption,
  monotonic publication, concurrent convergence, receipt-row locking, and
  scope-locator locking on PGlite and an isolated PostgreSQL 18 cluster.
- Corrected the existing real-Postgres `ON DELETE RESTRICT` assertion to its
  PostgreSQL SQLSTATE `23001`; ordinary missing-parent foreign keys remain
  `23503`.

Why it changed:

A split locator with no clock is ambiguous after a crash. Durable immutable
intent distinguishes unfinished target preparation from already-published
authority without treating a partial locator row as usable.

Convex references inspected:

- `crates/model/src/database_globals/mod.rs`
- `crates/application/src/lib.rs`
- `crates/common/src/bootstrap_model/index/database_index/index_state.rs`
- `crates/database/src/database_index_workers/mod.rs`
- `crates/common/src/bootstrap_model/schema_state.rs`
- `crates/application/src/schema_worker/mod.rs`
- `crates/model/src/migrations.rs`

How Flarex differs:

- Convex persists configuration and publishes completed background work inside
  one OCC/backend domain. Flarex needs a separate control receipt because a
  located Postgres target cannot commit atomically with the control database.
- A `ready` receipt is historical publication evidence, not current clock
  authority. Later runtime resolution must still read the located
  `fx_system_scope_clock`.

Known limitations:

- This is S02-C3b1 only. C3b2 still must resolve the persisted locator outside
  the control transaction, initialize/verify the exact target clock, and call
  the final CAS. Split topology is not available to executor composition.
- C2 parity remains intentionally shared-database-only; it is not mixed-
  topology readiness evidence. No runtime generation routing, allocator, OCC,
  compiler, sync, Payload, or Medusa behavior changed.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres test:postgres
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm typecheck
git diff --check
```

## Fence Future Shared Deployment Creation Behind Ready Authority

Previous completed checkpoint: `5f377e9` Add resumable scope authority
bootstrap.

What changed:

- Replaced the executor-owned bare deployment insert with one narrow
  `ensureDeploymentAuthority(...)` capability. Direct ensure, package
  registration/activation, and live-query mutators now stop before side effects
  unless deployment, `fx_control_scope`, and `fx_system_scope_clock` authority
  are ready.
- Added an executor-facing persistence facade that removes the raw metadata
  writer while retaining it on the underlying persistence object for explicit
  bootstrap, migration, and fixture ownership.
- Wired current local PGlite and real-Postgres test compositions to the C1
  shared-database transaction and preserved public created/existing and project
  mismatch behavior.
- Held a shared lock on existing deployment identity/project metadata through
  scope/clock commit, preventing privileged replacement or project mutation
  from changing the row after authority validation.
- Proved the operational cutover sequence: bootstrap a pre-fence deployment,
  switch to authority-only creation, create a later deployment, then capture
  and verify a fresh C2 frontier with no missing locator or clock.

Why it changed:

C2 could inventory a point in time but the executor could immediately reopen a
gap. The executor now consumes only a ready-authority result; creation policy
and topology remain trusted persistence composition concerns.

Convex references inspected:

- `crates/model/src/lib.rs`
- `crates/model/src/database_globals/mod.rs`
- `crates/model/src/migrations.rs`
- `crates/common/src/bootstrap_model/index/database_index/index_state.rs`
- `crates/database/src/database_index_workers/mod.rs`

How Flarex differs:

- Convex initializes its system tables in one configured database before use.
  Flarex also records a control-plane physical locator, so its current shared
  lane adapts one atomic locator/clock transaction into the executor's narrower
  ready-deployment capability.
- A code commit cannot prove that old deployed writers are quiesced. The final
  fresh C2 rerun is an explicit operational cutover step, not an automatic
  production migration claim.

Known limitations:

- This is S02-C3a. S02-C3b still owns durable `reserved` versus `ready`
  receipts and located-target recovery for `schema_per_scope` and
  `database_per_scope`; the parent S02-C checkpoint remains open.
- Hosted DeploymentDO push does not provision Postgres today, and no executor
  Worker/Hyperdrive host, HTTP deployment bridge, or cross-DO/Postgres
  atomicity is claimed.
- No runtime generation resolution, allocator, OCC, compiler, sync, Payload,
  or Medusa behavior changed.
- Focused PGlite and local-runtime tests pass, and all four executor
  PostgreSQL tests pass against an isolated PostgreSQL 18 cluster. Workspace
  typecheck and changed-package builds pass; the unchanged broad Vitest hang,
  example extensionless-import build failure, and two stale integration
  expectations remain recorded in `roadmaps/20-postgres-executor.md`.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor exec vitest run test/deployments.test.ts test/appDataBoundary.test.ts test/deploymentAuthority.test.ts test/liveQueries.test.ts
corepack pnpm --filter @flarex/executor exec vitest run test/deploymentAuthority.postgres.test.ts --reporter verbose
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/scopeAuthorityProvisioning.postgres.test.ts --reporter verbose
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/executorHttpRuntime.test.ts
git diff --check
```

## Bootstrap Existing Shared Authority Through A Captured Frontier

Previous completed checkpoint: `7793ed9` Add shared scope authority
provisioning.

What changed:

- Added a server-only C2 bootstrapper that captures the greatest committed
  deployment ID as a stable lexical frontier, scans only through that frontier
  in validated batches of `1..1000`, and commits one deployment at a time.
- Added an existing-deployment-only transaction path. It creates a missing
  scope/clock pair or explicitly repairs an inventoried scope missing its clock,
  but it never recreates a disappeared/replaced deployment and never weakens
  normal C1 provisioning's fail-closed missing-clock behavior.
- Initialized every newly inserted bootstrap clock explicitly as `legacy_v1`,
  fence `1`, commit/outbox sequence `0`, and a server-generated epoch. Existing
  valid clocks, including advanced clocks, are returned byte-for-byte unchanged.
- Added one relational parity statement that classifies deployments through the
  frontier as complete, missing scope, missing clock, or locator conflict and
  counts orphan clocks separately so equal totals cannot hide opposite gaps.

Why it changed:

Existing deployments need a resumable migration that survives page replay and
partial process failure without holding one large transaction. A cursor is
returned only after every item in the page succeeds; if item N fails, prior
item transactions remain idempotently complete and the caller retries the same
page.

Convex references inspected:

- `crates/model/src/lib.rs`
- `crates/model/src/database_globals/mod.rs`
- `crates/database/src/bootstrap_model/index_backfills/types.rs`
- `crates/database/src/database_index_workers/mod.rs`
- `crates/database/src/table_iteration.rs`
- `crates/model/src/migrations.rs`

How Flarex differs:

- Convex can bind a resumable backfill cursor to its repeatable database
  snapshot. PostgreSQL cannot preserve an MVCC snapshot across process restarts,
  so C2 uses an indexed deployment-ID frontier plus an anti-join verification
  statement and makes the weaker claim `complete_through_frontier`.
- C2 remains co-located `shared_database` work with one fixed trusted locator.
  It does not introduce a general placement provider or located data-plane
  resolver.

Known limitations:

- A legacy deployment transaction can commit behind an advanced cursor. C2
  detects such a row if it is visible at verification time, but global zero-gap
  readiness requires C3 to fence/quiesce legacy creation and rerun C2.
- C3 still owns future creation wiring and split-topology recovery/readiness.
- No runtime generation routing, sequence allocation, OCC, compiler, sync,
  Payload, Medusa, physical database creation, or scope-pool guard is included.
- The focused PostgreSQL 18 C2 file passes five tests. The complete PostgreSQL
  lane passes sixteen of seventeen and retains the pre-existing `ON DELETE
  RESTRICT` SQLSTATE mismatch (`23503` expected, `23001` received).
- The ordinary package lane passes 115 tests with 17 environment-gated tests
  skipped. Package build/schema check, workspace typecheck, both backend
  typecheck/build lanes, and the Effect-boundary check pass.
- Workspace test reaches the unchanged `flarex-backend` Vitest command and
  again times out without output after five minutes; its verified leftover
  process tree exited. Workspace build passes every changed package and then
  fails in the unchanged example Vite build on the extensionless
  `artifactRuntime/RouteBoundary.ts` import of `../http`.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/scopeAuthorityBootstrap.test.ts
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/scopeAuthorityBootstrap.postgres.test.ts
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres test:postgres
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm check:effect-boundaries
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Add The Shared-Database Initial Authority Primitive

Previous completed checkpoint: `05d10f5` Add the FlarexDB scope clock.

What changed:

- Added a server-only shared-database provisioner that creates a transitional
  deployment row, `fx_control_scope` locator, and `fx_system_scope_clock` in
  one Drizzle transaction.
- Fixed new production authority identifiers as lowercase RFC 4122 UUID-v4
  text with `scope_` and `epoch_` prefixes. Per-call input contains only the
  expected deployment/project; the trusted provisioner owns the locator and
  UUID source.
- Wrote `legacy_v1`, generation fence `1`, commit sequence `0`, and outbox
  sequence `0` explicitly. No caller can select or advance those facts.
- Made retries converge on persisted authority, reject project/locator
  conflicts, avoid scope/clock ID collisions, preserve an already advanced
  valid clock unchanged, and fail closed when an existing scope has lost its
  clock. Only C2's explicit bootstrap repair may fill that partial state.

Why it changed:

S02-C needs one proven creation primitive before it can scan existing
deployments or replace all future creation paths. Starting with the one
topology the current adapter actually supports gives C2 a safe row-level
operation without pretending separate Postgres databases share an ACID
transaction.

Convex references inspected:

- `crates/model/src/lib.rs`
- `crates/model/src/database_globals/mod.rs`
- `crates/application/src/lib.rs`
- `crates/common/src/bootstrap_model/schema_state.rs`

How Flarex differs:

- Convex initializes system tables and immutable storage configuration in one
  configured persistence transaction. Flarex must additionally mint a stable
  scope/epoch and pair control-plane location with data-plane clock authority.
- C1 supports only co-located `shared_database` rows. Schema-per-scope and
  database-per-scope require explicit topology composition and recovery state,
  not a false cross-database transaction.

Known limitations:

- S02-C2 owns bounded existing-deployment bootstrap and parity inventory.
- C3a has since wired shared executor creation; S02-C3b still owns
  cross-topology recovery.
- No runtime generation resolution, sequence allocation, OCC, schema catalog,
  physical database creation, or scope-pool guard is introduced.
- The focused PostgreSQL 18 provisioning tests pass. The broader twelve-test
  Postgres lane passes eleven tests and retains the pre-existing `ON DELETE
  RESTRICT` SQLSTATE mismatch (`23503` expected, `23001` received).
- `flarex-backend` and `@flarex/backend` typecheck/build pass. The unchanged
  broad `flarex-backend` test lane again produced no output and timed out at
  five minutes; its verified leftover Vitest process tree was stopped.
- Workspace typecheck passes. Workspace build reaches every changed package
  and then fails in the unchanged example Vite build on the extensionless
  `artifactRuntime/RouteBoundary.ts` import of `../http`.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/scopeAuthorityProvisioning.test.ts
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/scopeAuthorityProvisioning.postgres.test.ts --reporter verbose
corepack pnpm --filter @flarex/persistence-postgres test:postgres
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm build
git diff --check
```

## Add The Authoritative Data-Plane Scope Clock

Previous completed checkpoint: `7b18427` Target the Cloudflare executor
Worker.

What changed:

- Added `fx_system_scope_clock` with one `scope_id` primary-key row, explicit
  storage generation and epoch, a positive generation fence, nonnegative
  bigint commit/outbox counters, and update metadata.
- Added database checks for the exact storage-generation set, positive fence,
  nonnegative counters, and ECMAScript-compatible nonblank scope/epoch text.
- Kept `storage_generation` without a SQL default. S02-C must deliberately
  bootstrap existing scopes as `legacy_v1`; missing authority cannot silently
  select a generation.
- Added no control-plane foreign key, backfill, retention floor, commit table,
  or production counter writer. `oldest_available_commit_seq` remains S08.
- Added validated reads plus a package-internal, transaction-typed
  `SELECT ... FOR UPDATE` helper used only inside explicit transaction tests.

Why it changed:

S02-B needs the smallest authoritative data-plane state from which later exact
snapshots and fenced commits can be derived. Adding allocation, bootstrap, or
runtime routing in the same checkpoint would make a partial clock usable
before commit publication and recovery metadata are atomic.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/database/src/write_log.rs`
- `crates/common/src/types/timestamp.rs`
- `crates/postgres/src/lib.rs`
- `crates/postgres/src/sql.rs`

How Flarex differs:

- Convex assigns unique non-dense timestamps in one in-process committer and
  fences Postgres writers with an instance lease. Flarex needs a scope-local
  persisted row because executor Workers are distributed and the later commit
  feed must be dense with no sequence consumed on rollback.
- The clock deliberately has no foreign key to `fx_control_scope`: the locator
  is control-plane data while the authoritative clock may live in a separate
  schema or database.

Known limitations:

- S02-C still must bootstrap existing scopes and atomically provision future
  locator/clock authority. No migration DML creates clock rows.
- S02-D/E still own fail-closed runtime resolution, stale-fence checks, trusted
  scope guards, and pooled-connection isolation.
- O06/O07 still own sequence advancement with OCC, commit/change publication,
  outcomes, idempotency, and outbox in one final transaction.
- The focused real-Postgres test passed against an isolated PostgreSQL 18
  cluster, proving exact same-scope blocking, independent-scope progress, and
  rollback visibility. The broader seven-test Postgres lane ran six tests
  successfully but its unchanged scope-catalog delete test expects SQLSTATE
  `23503` while PostgreSQL 18 reports `23001` for `ON DELETE RESTRICT`.
- Workspace typecheck passes. Workspace test and a controlled one-worker
  `flarex-backend` retry both time out in the unchanged backend test lane;
  workspace build reaches every changed package and then fails on the existing
  extensionless `../http` import in `artifactRuntime/RouteBoundary.ts` during
  the example Vite build.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/scopeClock.postgres.test.ts --reporter verbose
corepack pnpm --filter @flarex/persistence-postgres test:postgres
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Add The Minimal FlarexDB Scope Locator

Previous completed checkpoint: `7f4ce29` Resolve trusted app-data generation.

What changed:

- Added additive `fx_control_scope` metadata allowing at most one opaque branded
  scope row for each parent `deployments` row, a restrictive foreign key, a
  unique deployment mapping, and the intentional `(id, deployment_id)` unique
  key needed by later scope-safe catalog relationships.
- Kept `active_schema_version_id` nullable and inactive. There is no activation
  writer or schema-version foreign key until S03/S04 owns the target catalog.
- Made the physical locator non-null and exact:
  `{ kind, databaseKey, schemaName }`. Write, read, and database checks require
  non-whitespace values, reject extra keys, and require the locator kind to
  match one of the three declared isolation modes.
- Fixed the future production bootstrap convention as opaque
  `scope_<uuid-v4>` IDs issued by the trusted control plane. S02-A neither
  generates nor backfills them.

Why it changed:

S01 deliberately used deployment IDs only as temporary scope aliases. The
first S02 slice needs a permanent deployment-to-data-plane location without
also introducing the scope clock, full tenant/project/deployment hierarchy,
schema catalog, runtime cutover, or provisioning workflow.

Convex references inspected:

- `crates/common/src/types/mod.rs`
- `crates/postgres/src/lib.rs`
- `crates/postgres/src/sql.rs`
- `crates/value/src/table_mapping.rs`
- `crates/common/src/bootstrap_model/schema_state.rs`

How Flarex differs:

- Convex uses nominal deployment/project identities and a configured
  `PgInstanceName` directly throughout its multitenant persistence queries.
  Flarex needs an explicit catalog hop from control-plane deployment identity
  to an independently stable scope and Cloudflare/Postgres physical topology.
- Convex namespaces tables/components inside one backend and enforces at most
  one active schema state. Flarex stores one future active pointer on the scope,
  but deliberately leaves it unwritable until the versioned catalog exists.
- The `databaseKey`/`schemaName` locator is Flarex-specific. `databaseKey`
  resolves only through trusted server configuration and stores no DSN or
  credential.

Known limitations:

- Existing deployments remain unmapped; S02-C owns backfill and provisioning.
- There is no scope clock, epoch, storage generation/fence, runtime resolver,
  transaction scope guard, RLS policy, or pooled-connection proof in S02-A.
- The full `fx_control_tenant`/project/deployment hierarchy from the long-form
  design is not copied. The current `deployments` table remains the
  transitional parent to avoid a second authority.
- The real-Postgres constraint test is implemented but was skipped because
  `FLAREX_POSTGRES_DATABASE_URL` was not configured in this run.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Resolve Existing Scopes To The Legacy App-Data Generation

Previous completed checkpoint: `969c174` Isolate the legacy app-data engine.

What changed:

- Added an executor-internal app-data storage authority containing branded
  `scopeId` and `storageGeneration` values.
- Derived the transitional authority only from persisted, active invoke-session
  metadata after deployment/project ownership checks. Existing deployment IDs
  are temporary scope aliases and resolve to exact `legacy_v1` authority.
- Added a legacy-only engine registry with an immutable list of registered
  generations. A valid but unavailable generation throws the typed terminal
  `AppDataStorageGenerationUnavailableError` before an app-data method runs.
- Routed syscall and finish operations through that resolver while retaining
  the same legacy engine across retries and invoke-backed live-query reruns.

Why it changed:

The S01 compatibility seam needs a trusted routing decision before later schema
and OCC work can depend on generation identity. Resolution must follow persisted
server state; treating a missing deployment/session, request field, header, or
function partition key as storage authority would make migration unsafe.

Convex references inspected:

- `crates/database/src/database.rs`
- `crates/database/src/transaction.rs`
- `crates/application/src/application_function_runner/mod.rs`
- `crates/database/src/committer.rs`

How Flarex differs:

- Convex's trusted backend creates a transaction from backend-owned identity and
  snapshot state, then applies function-runner reads and writes back to that
  transaction. It has no portable dual-storage-generation router to copy.
- Flarex needs a migration-specific generation resolver because user code and
  the trusted Postgres executor are separated and the legacy/new engines must
  coexist temporarily.

Known limitations:

- This is not the S02 scope-location or scope-clock authority. It adds no table,
  migration, generation fence, or permanent deployment-to-scope mapping.
- Generation is re-derived per validated session operation. This is safe only
  while `legacy_v1` is the sole derivable and registered engine; S02 and later
  session/OCC turns own authoritative fences and durable pins.
- No `flarexdb_v1` engine, storage schema, or production route exists.

Verification:

```sh
corepack pnpm --filter flarex-protocol exec vitest run test/storage-authority.test.ts
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/legacyV1AppDataEngine.test.ts test/pglite.test.ts
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter @flarex/executor exec vitest run test/appDataEngines.test.ts test/appDataBoundary.test.ts test/sessions.test.ts test/liveQueries.test.ts
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor build
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts -t "maps invoke syscalls without forwarding storage selection"
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-http build
corepack pnpm check:effect-boundaries
git diff --check
```

## Isolate The Legacy V1 App-Data Engine

Previous completed checkpoint: `9de97f1` Define FlarexDB storage authority
contracts.

What changed:

- Added a persistence-owned `LegacyV1AppDataStore` containing only the current
  snapshot reads, invoke read/write journal, and atomic legacy commit methods.
- Added a branded `LegacyV1AppDataEngine` adapter fixed to `legacy_v1` and
  exported it only through an explicit internal package subpath.
- Refined the shared generation union into exact branded `legacy_v1` and
  `flarexdb_v1` constituent schemas so an engine cannot claim a broad or
  unvalidated generation tag.
- Routed executor syscall reads/writes, query finish, mutation commit, retries,
  and invoke-backed live-query reruns through one adapter instance.
- Split executor control persistence from the composition-root persistence
  input, making all legacy app-data methods unavailable to downstream
  orchestration except through the selected engine.
- Kept deployment/package metadata, session lifecycle metadata, direct revision
  insertion, raw SQL, freshness, delivery, and outbox consumption outside the
  engine.

Why it changed:

The compatibility schema needs one named boundary before generation resolution
is added. This prevents later routing from becoming a conditional inside every
legacy document/index method and preserves the current implementation as the
migration oracle.

Convex references inspected:

- `crates/database/src/transaction.rs`
- `crates/database/src/reads.rs`
- `crates/database/src/committer.rs`

How Flarex differs:

- Convex already composes transaction reads, read-set recording, and commit
  publication behind mature Rust database boundaries. Flarex first isolates its
  existing Postgres invoke-session implementation as an explicit compatibility
  engine.
- The legacy engine retains wall-clock `ts: number` and current journal records;
  it does not pretend they are the future `SnapshotToken` or OCC contracts.

Known limitations:

- This is not the O01 snapshot/OCC port or C01 compiler API.
- No generation resolver or `flarexdb_v1` implementation exists yet; S01-C
  remains open and production behavior is still entirely legacy.

Verification:

```sh
corepack pnpm --filter flarex-protocol exec vitest run test/storage-authority.test.ts
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/legacyV1AppDataEngine.test.ts
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts
corepack pnpm --filter @flarex/executor exec vitest run test/appDataBoundary.test.ts test/sessions.test.ts test/liveQueries.test.ts
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor build
corepack pnpm check:effect-boundaries
git diff --check
```

## Add Shared FlarexDB Storage Authority Contracts

Previous completed checkpoint: `cdb1e52` Plan FlarexDB foundation turns.

What changed:

- Added an explicit `flarex-protocol/storage-authority` boundary for branded
  `ScopeId`, `ScopeEpoch`, `CommitSeq`, `OutboxSeq`, `StorageGeneration`, and
  `SnapshotToken` contracts.
- Encoded commit and outbox sequences as canonical unsigned decimal strings at
  the protocol edge and branded `bigint` values internally, preserving values
  above JavaScript's safe-integer limit.
- Kept the snapshot token strict and limited to
  `(scopeId, epoch, commitSeq)`; generation and fence authority are not accepted
  as token fields.

Why it changed:

The legacy/new engine split needs one nominal identity and snapshot vocabulary
before an adapter or resolver can be introduced. Freezing the pure contracts
first prevents persistence, OCC, compiler, and sync layers from inventing
incompatible primitive aliases.

Convex references inspected:

- `crates/common/src/types/timestamp.rs`
- `crates/convex/sync_types/src/timestamp.rs`
- `crates/value/src/document_id.rs`

How Flarex differs:

- Convex keeps validated timestamps and distinct document identities in Rust
  newtypes. Flarex mirrors nominal separation with Effect Schema brands and
  uses canonical decimal strings across JavaScript boundaries.
- Flarex adds explicit scope epoch and storage-generation identities because
  the trusted executor spans Postgres and Cloudflare runtime boundaries.

Known limitations:

- This checkpoint changes no storage behavior. The named `legacy_v1` adapter,
  trusted generation resolver, scope metadata, and `flarexdb_v1` engine remain
  later S01/S02 work.
- Token decoding validates syntax and shape only; authority membership and
  stale-epoch checks require trusted scope metadata.

Verification:

```sh
corepack pnpm --filter flarex-protocol exec vitest run test/storage-authority.test.ts
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor build
corepack pnpm check:effect-boundaries
git diff --check
```

## Add The FlarexDB Foundation Execution Plans

Previous completed checkpoint: `478be74` Correct FlarexDB transaction and sync
design.

What changed:

- Added the low-level master order and focused schema, OCC, and commit-compiler
  plans under [`flarexdb-foundation/`](./flarexdb-foundation/README.md).
- Made one vertical Flarex app point-mutation proof the first milestone instead
  of building the entire proposed physical schema before exercising it.
- Reserved trusted adapter-facing capabilities for later Payload and Medusa
  work without treating either system as generic app-row journal traffic.

Why it changed:

The accepted architecture needed an executor-ready sequence that preserves the
legacy storage oracle, interleaves physical schema with transaction semantics,
and states exactly where high-level adapter work stops.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/database/src/transaction.rs`
- `crates/database/src/reads.rs`

How Flarex differs:

- Flarex pins trusted scope and storage generation across Dynamic Worker,
  Cloudflare coordination, and Postgres boundaries. Durable Objects may later
  hold temporary journals but never committed row authority.

Known limitations:

- The plans are not implementation. The new schema generation, OCC lane,
  compiler, backfill, cutover, Payload adapter, and Medusa adapter remain open.

Verification:

```sh
git diff --check
```

## Accept Staged FlarexDB Data Model

Previous completed checkpoint: `01c11ab` Clarify SessionDO cache read bridge.

What changed:

- Accepted typed app row JSON plus derived index, stable edge-occurrence, and
  unique-key sidecars as the target app/CMS storage shape.
- Kept Payload lifecycle as reserved logical collections for the first adapter
  slices and Medusa commerce as real relational tables behind Medusa adapters.
- Separated stable catalog identities from immutable versioned definitions and
  added storage-generation backfill/dual-read/cutover/rollback requirements.
- Kept the current document/index schema as an implemented compatibility
  baseline instead of describing the proposal as already implemented.

Why it changed:

The previous schema examples could collide repeated/localized relation edges,
mutate catalog identity across schema versions, and implied dedicated Payload
tables and DML-only Medusa generation before their adapter contracts were
proven.

Convex references:

- `crates/database/src/committer.rs`
  - revisions and derived write metadata share one authoritative commit.
- `crates/database/src/reads.rs`
  - typed row/range dependencies are part of correctness.

How Flarex differs:

- Hosted shared app storage uses stable logical table IDs over fixed physical
  row/sidecar tables, while Medusa requires relational adapter-owned tables.
- Durable Objects coordinate sessions and sync but do not own committed rows.

Known limitations:

- The proposed storage generation, tagged Flarex value codec, retention/GC,
  Payload parity, and Medusa parity are unimplemented.

Verification:

```sh
git diff --check
```

## Partition Route Request Effects

Previous completed checkpoint: `e752f33` Type registry create request boundary.

What changed:

- PartitionDO schema-cache, commit, subscription registration, subscription
  target, and connection unregister request bodies now expose only the
  Effect-returning route request decoders.
- Removed Promise/throwing compatibility wrappers that converted typed
  partition route failures before the Durable Object adapter edge.
- Public Worker partition schema-cache request decoding now exposes only the
  Effect-returning decoder for the forwarding boundary.

Why it changed:

PartitionDO route request validation already lived behind typed Effect
decoders. This checkpoint removes obsolete wrapper surfaces without changing
the Durable Object's storage, OCC, subscription, or transaction logic.

Convex references:

- No Convex source files were inspected for this slice. This is a Flarex
  PartitionDO route-boundary cleanup around existing decoders.

How Flarex differs:

- Flarex hosts colocated partition state in Cloudflare Durable Objects and
  forwards some public partition routes through the Worker. This checkpoint
  keeps that DO/Worker shape while narrowing request decoding to typed Effect
  paths.

Known limitations:

- PartitionDO SQL/OCC behavior, idempotency replay, subscription invalidation,
  transaction response shapes, DeploymentDO, RegistryDO, executor-http,
  protocol package parser compatibility, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/partitionRouteBoundary.test.ts test/publicPartitionSchemaCacheRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/partitionRouteBoundary.test.ts test/publicPartitionSchemaCacheRouteBoundary.test.ts test/transaction.test.ts test/sync.test.ts -t "schema-cache|commit|subscription|connection unregister|PartitionDO" --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Registry Create Request Effects

Previous completed checkpoint: `9f81903` Type public invoke request boundary.

What changed:

- Removed the throwing `parseRegistryCreateDeploymentPayload(...)`
  compatibility wrapper from `registry/Requests.ts`.
- Removed the Promise-returning `registryApiRequestForRoute(...)` route
  compatibility runner.
- Removed the Promise-returning `readRegistryCreateDeploymentRouteRequest(...)`
  compatibility wrapper.
- Kept RegistryDO production routing on `decodeRegistryApiRequestForRoute(...)`
  and `decodeRegistryCreateDeploymentRouteRequest(...)`.

Why it changed:

RegistryDO already routes through Effect request decoders before forwarding to
the generated Registry HttpApi web handler. The removed wrappers were legacy
compatibility surfaces that converted typed route/payload failures too early.

Convex references:

- No Convex source files were inspected for this slice. This is a Flarex
  RegistryDO route/source boundary cleanup around existing decoders.

How Flarex differs:

- Flarex hosts registry create/list through a Cloudflare Durable Object and a
  generated Effect HttpApi web handler. This checkpoint preserves that host
  shape while narrowing request decoding to typed Effect paths.

Known limitations:

- RegistryService, RegistryStore, RegistryDO generated web handler behavior,
  DeploymentDO, PartitionDO SQL/OCC, executor-http, protocol package parser
  compatibility, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/registryRequests.test.ts test/registryHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/registryRequests.test.ts test/registryHttpApiRouteBoundary.test.ts test/registryHttpApiHandlers.test.ts test/registryService.test.ts test/registryDO.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Registry Adapter Response Effects

Previous completed checkpoint: `a72b6f2` Remove deployment HttpError adapter
bridge.

What changed:

- Removed the legacy `registry/HttpBoundary.ts` adapter module.
- Removed `registryFailureToHttpError(...)`.
- Removed the matching `registryHttpBoundary.test.ts` compatibility test.
- Kept generated Registry HttpApi handler storage/protocol failures on typed
  response mappers.

Why it changed:

RegistryDO already hosts generated Registry HttpApi handlers that map
`RegistrySqlError` and registry protocol response failures to the declared
`RegistryStorageErrorResponse`. The removed helper kept an older `HttpError`
adapter in parallel with the typed generated-handler path.

Convex references:

- No Convex source files were inspected for this slice. This is a Flarex
  RegistryDO adapter cleanup around existing generated HttpApi handlers.

How Flarex differs:

- Flarex hosts the deployment registry in a Cloudflare Durable Object with a
  generated Effect HttpApi web handler. This checkpoint preserves that host
  shape and removes only obsolete `HttpError` compatibility mapping.

Known limitations:

- RegistryService, RegistryStore, RegistryDO routing, generated Registry
  HttpApi web handler behavior, DeploymentDO, PartitionDO SQL/OCC,
  executor-http, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/registryHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/registryHttpApiHandlers.test.ts test/registryHttpApiRouteBoundary.test.ts test/registryService.test.ts test/registryDO.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Partition Route Decoder Ownership

Previous completed checkpoint: `36dce15` Own scheduler route decoders.

What changed:

- Internal PartitionDO schema-cache, commit, subscription registration,
  subscription target, and connection unregister routes now expose decode-named
  route payload boundaries.
- The public Worker partition schema-cache route now also exposes a
  decode-named route payload wrapper that injects the route partition key.
- Partition request decoders call `decode*RoutePayload(...)` functions directly
  after the shared JSON body Effect boundary succeeds.
- Parse-named Effect helpers remain as compatibility wrappers, but newly
  migrated partition request paths prefer the decode-named route payload
  functions.

Why it changed:

Partition route payload validation already lived in `partition/Requests.ts`,
but the request decoders still flowed through parse-named compatibility
helpers. This checkpoint makes route payload ownership explicit across the
PartitionDO route family and the public schema-cache adapter while keeping
PartitionDO's correctness-sensitive transaction logic untouched.

Convex source files inspected:

- None for this checkpoint. This is Cloudflare-specific route adapter wiring
  around Flarex shard-local PartitionDO requests.

How Flarex differs from Convex:

- Flarex sends shard-local schema-cache, commit, and subscription maintenance
  payloads through Cloudflare Worker/Durable Object fetch routes before they
  enter the authoritative PartitionDO. This checkpoint tightens that HTTP/JSON
  boundary without changing the shard ownership model.

Known limitations:

- PartitionDO SQL/OCC, idempotency replay, schema-cache persistence,
  subscription invalidation, public Worker partition routing, executor-http,
  protocol schemas, and `ValidatorJson` are unchanged.
- These route payload functions still delegate to the existing manual payload
  decoders; the payload shapes are not moved into the protocol package yet.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/partitionDO.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Partition Route Payload Validation Boundary

Previous completed checkpoint: `f77949c` Share scheduler maintenance payload
validation.

What changed:

- Partition route request payload validation now lives in the shared
  `partition/Requests.ts` source boundary.
- Schema-cache, public schema-cache wrapping, commit, subscription
  registration, subscription target, and connection unregister request shapes
  now emit `PartitionRoutePayloadError` from named Effect decoders at the
  payload source.
- Internal PartitionDO routes and public Worker schema-cache routes continue to
  share the same request validation path, while malformed JSON remains
  `RequestJsonError`.
- Partition route adapters still map typed payload failures to the same HTTP
  400 response shape at the adapter edge.

Why it changed:

Partition route validation had already moved to typed Effect decoders, but the
payload validation and route error tag still lived in `partition/RouteBoundary`.
This checkpoint moves the payload ownership to the Partition request source
boundary while keeping route files responsible for JSON reads and HTTP
conversion.

Preserved behavior:

- PartitionDO SQL/OCC, idempotency, schema-cache persistence, document writes,
  index reads, and subscription invalidation are unchanged.
- Public Worker schema-cache routing still keeps the route `partitionKey`
  authoritative over any body field.
- `ValidatorJson`, protocol schemas, deployment routes, invoke routes,
  scheduler routes, execution routes, delivery routes, and executor-http routes
  are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/partitionDO.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Partition Route Effect Boundary

Previous completed checkpoint: `083fae0` Route public execution through Effect.

What changed:

- `partition/RouteBoundary.ts` now exposes Effect-returning decoders for
  schema-cache, commit, subscription registration, subscription target, and
  connection unregister request bodies.
- Partition route-body validation now originates as
  `PartitionRouteValidationError`; malformed JSON remains the shared
  `RequestJsonError`.
- Existing throwing parsers and Promise `read*` wrappers remain as compatibility
  adapters, but they now delegate through the typed validation implementation
  and `partitionRouteErrorToHttpError(...)`.
- The public schema-cache boundary now has an Effect decoder that keeps the
  route `partitionKey` authoritative over any body field.
- Public Worker partition `commit` and `schema-cache` forwarding now run through
  `Effect.fn` helpers and convert typed failures at the Worker adapter edge.

Why it changed:

Partition request parsing was one of the remaining hand-written `readJson` plus
`HttpError` validation clusters. Moving it to typed Effect decoders advances the
larger migration without changing the correctness-sensitive PartitionDO
transaction, OCC, schema-cache, or subscription logic.

Preserved behavior:

- PartitionDO still owns SQL initialization, commit conflict detection,
  idempotency keys, schema-cache persistence, document/index reads, and
  subscription invalidation.
- Public Worker partition route behavior still forwards canonical JSON to the
  internal Durable Object routes and keeps the route partition key authoritative
  for schema-cache updates.
- `ValidatorJson`, protocol schemas, deployment routes, invoke routes,
  scheduler routes, execution routes, delivery routes, and executor-http routes
  are unchanged in this checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/partitionDO.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## RegistryDO Effect Host Shape

Previous completed checkpoint: `14930c4` Extract deployment HttpApi route boundary.

What changed:

- `RegistryDO` remains the Cloudflare Durable Object host and still owns table
  initialization plus fallback handling for non-GET `/health` and unknown
  routes.
- Registry persistence and behavior moved behind per-instance Effect services:
  `RegistryStore`, `RegistryService`, `RegistryClock`, and `RegistryIds`.
- `RegistryDO` composes the registry layer from its own `ctx.storage.sql`, then
  owns a generated Registry HttpApi web handler for `GET /health`,
  `GET /deployments`, and `POST /deployments`.
- A small route-boundary helper pre-parses create-deployment bodies with the
  existing `readJson` and protocol parser before forwarding canonical JSON to
  the generated handler, preserving the public invalid-body messages.

Why it changed:

This keeps the DO lifecycle and object-local SQLite state explicit while
proving that a Durable Object can route a complete small API through Effect
HttpApi without giving up compatibility fallbacks or per-instance state.

Convex references inspected:

- No new Convex source files were needed. RegistryDO is deployment metadata
  coordination, not the authoritative document/OCC data path.

Cloudflare difference:

- Unlike Convex backend components, Cloudflare Durable Object state is attached
  to each object instance. The SQL-backed Effect layer must therefore be built
  from the object instance, not as a global package singleton.

Known limitations:

- RegistryDO still owns outer fetch fallback behavior. Typed DO clients and
  Alchemy Durable Object resources are deferred.
- DeploymentDO, PartitionDO, ExecutionDO, DeliveryDO, SchedulerDO, and
  ConnectionDO still use their existing hand-written shapes.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryHttpApiRouteBoundary.test.ts packages/flarex-backend/test/registryHttpApiHandlers.test.ts packages/flarex-backend/test/registryDO.test.ts
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## Authority Pivot

Previous completed checkpoint: `e80e176` Plan Postgres executor package
boundaries.

The forward authoritative data model is now Postgres-backed generic
multitenant document/index persistence, not Durable Object shard storage. The
existing `PartitionDO` implementation remains a useful prototype and temporary
bridge, but new data-model work should target:

- `design-notes/postgres-multitenant-persistence-schema.md`
- `design-notes/postgres-authoritative-sync.md`
- `roadmaps/20-postgres-executor.md`

Durable Objects should remain in the architecture for deployment coordination,
WebSocket sessions, schedulers, and future freshness/cache mirrors. They should
not remain the long-term authoritative document database.

Verification:

```sh
git diff --check
```

## Postgres Multitenant Persistence Schema Direction

Previous completed checkpoint: `4538f4a` Document Postgres authoritative sync
cache design.

What changed:

- Added `design-notes/postgres-multitenant-persistence-schema.md`.
- Recorded the storage-shape decision for the Postgres-authoritative Flarex
  track:
  - keep public `defineSchema` / `defineTable` APIs Convex-style,
  - do not create one physical SQL table per developer table,
  - store app data in generic multitenant `documents` and `index_entries`
    tables,
  - scope every authoritative physical row by deployment/project identity,
  - keep table names, table IDs, index IDs, document history, current-document
    optimization, commits, and outbox as backend metadata/state.

Why it changed:

- The user clarified that "same schema as Convex" means the same internal
  multitenant persistence model, not SQL DDL per developer table.
- This is the correct fit for Convex-style generated APIs, dynamic schema push,
  logical document IDs, OCC, and live-query invalidation.

Convex references:

- `crates/clusters/src/lib.rs`
  - `DbDriverTag::PostgresMultitenant` resolves schema/search path and sets
    `multitenant: true`.
- `crates/db_connection/src/lib.rs`
  - `PostgresOptions` carries `schema`, `instance_name`, and `multitenant`.
- `crates/postgres/src/sql.rs`
  - `documents` and `indexes` are generic physical persistence tables with
    optional `instance_name` tenancy columns and filters.
- `crates/value/src/table_mapping.rs`
  - logical table names are separated from internal table numbers/tablets.

Cloudflare / Flarex difference:

- Existing Flarex implementation remains Durable Object authoritative. The new
  note defines the intended physical Postgres schema for the
  Postgres-authoritative track.
- Convex uses `instance_name`; Flarex should use platform terminology such as
  `deployment_id`, while preserving the same tenant-discriminator invariant.
- Flarex's trusted executor near Postgres must own authoritative commits; user
  code running in Cloudflare Dynamic Workers must not receive a raw database
  connection.

Known limitations / follow-up:

- No Postgres DDL or executor implementation exists yet.
- We still need to decide whether the first implementation includes
  `current_documents` as a table or derives current state from history.
- Range freshness, outbox delivery, and Cloudflare cache repair remain covered
  by `design-notes/postgres-authoritative-sync.md`.
- The older DO shard placement model should become optional cache/routing
  policy if Postgres authority becomes the default.

Verification:

```sh
git diff --check
```

## Source-Package Schema Analysis Update

Local deployment analysis now evaluates the separately bundled immutable schema
module and normalizes it into the existing backend `DeploymentSchema` contract:
tables, document validators, placement, indexes, stable table IDs, and stable
index IDs.

Final codegen and the generated Worker consume this analyzed schema as static
data. They no longer re-evaluate the developer schema for runtime metadata.

This remains a prototype schema model. Backend push state must later own schema
version progression, schema diff validation, index lifecycle, and activation.
Projections are not yet part of authoritative storage schema analysis.

## Candidate Push State Update

`DeploymentDO` now owns candidate push state in addition to active schema and
function metadata.

It stores source package metadata, analyzed schema, analyzed functions, state,
failure errors, and timestamps. `finish` activates a candidate by applying its
schema/functions in one Durable Object storage transaction through the same
validation path that used to back the now-removed legacy direct replacement
routes.

This is the first step toward a Convex-style deployment activation boundary.
The current prototype still stores source package contents inline and does not
yet persist an active execution-artifact pointer, push race token, schema diff,
or index backfill status.

Convex references:

- `crates/application/src/lib.rs` schema evaluation path
- `npm-packages/convex/src/cli/lib/deployApi/componentDefinition.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`

Verification:

```sh
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## Current Decision

The backend server runtime lives in `packages/flarex-backend`. `apps/backend`
is the thin Wrangler deployable wrapper for that runtime.

Durable Object shape:

```txt
RegistryDO       global deployment registry
DeploymentDO     authoritative deployment metadata and schema
PartitionDO      authoritative shard database
ConnectionDO     realtime connection endpoint, currently a stub
SchedulerDO      scheduled function endpoint, currently a stub
```

DO names are deterministic and tenant-scoped:

```txt
registry:v1
deployment:{deploymentId}
partition:{deploymentId}:{partitionKey}
connection:{deploymentId}:{sessionId}
scheduler:{deploymentId}
```

`PartitionDO` is the shard. A user-owned app can map one user to one
`PartitionDO` instance.

## Implemented So Far

Created the backend runtime, now located in `packages/flarex-backend`, with:

- `wrangler.jsonc`
- `src/worker.ts`
- `src/registryDO.ts`
- `src/deploymentDO.ts`
- `src/partitionDO.ts`
- `src/connectionDO.ts`
- `src/schedulerDO.ts`
- shared helpers in `src/http.ts`, `src/routing.ts`, `src/types.ts`
- Miniflare-backed Worker/DO integration test harness in
  `test/partitionFlow.test.ts`
- backend invoke routes:
  - `POST /deployments/:deploymentId/invoke`
  - `POST /invoke` with `deploymentId` in the body or
    `x-flarex-deployment` header

`PartitionDO` currently owns:

- `meta`
- `tables`
- `indexes`
- `documents`
- `current_documents`
- `index_entries`
- `current_index_entries`
- `write_log`
- `idempotency_keys`

`DeploymentDO` now owns:

- `tables`
- `indexes`
- `functions`

The next deployment-model change is versioned push state. Directly replacing
the current schema and functions is not sufficient for Convex-style
`start_push` analysis and atomic `finish_push` activation. `DeploymentDO`
should eventually own:

- active push/execution-artifact pointer,
- candidate push state,
- authoritative analyzed modules and functions per candidate,
- candidate schema and schema-change state,
- push race/superseded detection,
- atomic activation after schema validation.

Large source packages and source maps should live outside Durable Object SQLite;
`DeploymentDO` should store references, hashes, authoritative metadata, and
state transitions.

Detailed design: `roadmaps/17-deployment-analysis-and-push.md`.

## Convex References

- `crates/postgres/src/sql.rs`
  Convex stores versioned `documents` and `indexes`, with optional
  `instance_name` in multitenant Postgres mode.
- `crates/postgres/src/lib.rs`
  Convex persistence writes documents and indexes through a lease-protected
  Postgres transaction.
- `crates/value/src/table_mapping.rs`
  Convex separates table names, table numbers, and tablets.
- `crates/value/src/document_id.rs`
  Convex separates developer IDs from resolved document IDs.

## Cloudflare Difference

Convex uses shared persistence with an `instance_name` column in multitenant
mode. Flarex uses the Durable Object name as the tenancy and shard boundary.
Rows inside a `PartitionDO` SQLite database do not need a `deployment_id`
column because the object name already provides isolation.

This means Flarex should not copy Convex's Postgres schema row-for-row. It
should copy the semantics: versioned documents, current snapshot optimization,
write log, indexes, and table metadata.

## Known Limitations

- `DeploymentDO` schema metadata is not yet automatically pushed to
  `PartitionDO` schema caches.
- `ConnectionDO` and `SchedulerDO` are topology stubs.
- A first generated Worker execution path is connected through backend
  execution sessions and syscalls. Cloudflare Dynamic Worker deployment is not
  connected yet.
- No retention or compaction exists for document history or write logs.

## Last Update

Added backend invoke routes while keeping the Worker route thin. The route
parses deployment, partition, function path, args, kind, and idempotency key,
then delegates to `executeInvoke`. The deployed registry is still empty until
the Dynamic Worker bridge or function registry is connected.

Added deployment-owned function metadata:

- `PUT /deployments/:deploymentId/functions`
- `GET /deployments/:deploymentId/functions`
- internal `GET /function?path=...`

Each function metadata row stores:

- path
- kind
- visibility
- args validator JSON
- returns validator JSON

`executeInvoke` now loads this metadata and uses it as the function contract.
The in-memory handler registry remains only the execution source for the
current prototype.

Return validators are enforced before mutation commit, matching Convex's
ordering where a validated UDF outcome is produced before commit. This means a
mutation that writes documents and returns a value that fails the declared
validator does not persist those writes.

`v.id("table")` validation now uses deployment table mappings. For the
authoritative backend, Flarex IDs are currently encoded as:

```txt
{tableId}:{documentId}
```

The backend resolves `tableId` through `DeploymentSchema.tables` during
argument, document, return, and direct commit validation.

Convex reference remains the same topology boundary:
`crates/application/src/api.rs` keeps HTTP/API entrypoints thin, while database
components such as `crates/database/src/committer.rs` validate and commit the
transaction.

Additional Convex references:

- `crates/model/src/modules/module_versions.rs`
  - `AnalyzedFunction` stores function type, visibility, args, and returns
    validator strings.
- `crates/model/src/modules/mod.rs`
  - `ModuleModel::get_analyzed_function_by_id` resolves deployed function
    metadata before execution validation.
- `crates/udf/src/validation.rs`
  - `ValidatedPathAndArgs` uses analyzed metadata for kind and argument checks.
  - `ValidatedUdfOutcome::new` applies `ReturnsValidator` before the mutation
    commit path consumes the outcome.
- `crates/common/src/schemas/validator.rs`
  - `Validator::Id` decodes `DeveloperDocumentId` and checks that the ID's table
    matches the validator table.

Verified with:

```sh
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend test
```

## Canonical ID Codec Update

Added a canonical Flarex document ID codec with this format:

```txt
{tableId}:{documentId}
```

The authoritative backend now uses codec helpers instead of ad hoc string
splitting in:

- `SingleShardTransaction.insert`
- `PartitionDO.applyDocumentWrite`
- `PartitionDO` direct commit validation
- `/invoke` document lookup, write validation, and `v.id("table")`
  validation

This keeps the storage model aligned with the table metadata already owned by
`DeploymentSchema.tables`.

Convex reference:

- `crates/common/src/schemas/validator.rs`
  - `Validator::Id` decodes the developer document ID and resolves the table
    before accepting a value for `v.id("table")`.

Cloudflare difference:

- Flarex currently uses a small TypeScript codec in both the backend and SDK
  packages. This duplication exists because `@flarex/backend` is still kept as
  an isolated Cloudflare backend package. The likely future shape is a
  runtime-neutral `flarex-core` package shared by the backend, SDK, generator,
  and Dynamic Worker bridge.

Verified with:

```sh
corepack pnpm typecheck
corepack pnpm test
```

## Execution Session Data Path

Added `ExecutionDO` as a backend-owned transaction session coordinator. It
keeps the authoritative data path inside backend Durable Objects:

```txt
generated Worker user handler
  -> service binding to backend /executions/:sessionId/syscall
  -> ExecutionDO
  -> SingleShardTransaction
  -> PartitionDO
```

Document writes remain staged until `/finish`, and only `PartitionDO.commit`
persists them. This preserves the intended Convex-like rule that user code
does not receive a raw database connection or Durable Object storage handle.

Known limitation: session state is currently in `ExecutionDO` memory. A future
executor must add retry semantics for eviction, restart, and `OCC_CONFLICT`.

## Architecture Terminology Cleanup

Previous completed checkpoint: `da42b4a` Add analysis import phase prelude.

Normalized storage wording to `source package`. Large uploaded `flarex/`
source packages and source maps should live outside Durable Object SQLite; the
developer's whole app is not part of deployment metadata.

Verification:

```sh
git diff --check
```

## Active Deployment Pointer Update

Previous completed checkpoint: `6db912b` Preserve analyzed function source
positions.

`DeploymentDO` now records the first active deployment pointer in its `meta`
table:

```txt
active_push_id
active_activated_at
```

`finish_push` sets those values only after applying the candidate schema and
function metadata. `GET /deployments/:deploymentId/deployment` reads the active
push row and returns active source package, analysis, codegen analysis, schema
version, and activation timestamp.

Convex reference:

- `crates/application/src/deploy_config.rs`
  - deployment activation is a distinct finish step after candidate analysis.
- `crates/model/src/modules/mod.rs`
  - active module metadata is durable deployment state used for function
    resolution.

Cloudflare difference: Flarex currently uses the activated push row as the
source package reference and stores source package JSON inline in Durable
Object SQLite. Large source package storage and the active Dynamic Worker
artifact pointer remain future work.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## ExecutionDO Create-Root Session Shape

Previous completed checkpoint: `2e6dc68` Consume preallocated root ids.

`ExecutionDO` now stores create-root scope in the active session indirectly
through its `SingleShardTransaction`. The session still records the resolved
scope, active schema, active function metadata, deployment id, and path, but
the authoritative create-root enforcement lives in the transaction object so
all syscalls share the same preallocated root state.

DO shape after this step:

```txt
ExecutionDO session
  deploymentId
  active schema/functions metadata
  resolved FunctionExecutionScope
  SingleShardTransaction
    partitionKey
    optional createRoot(rootTableId, preallocatedRootId, consumed)
```

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - active deployment analysis is the runtime input to function execution.
- `crates/database/src/transaction.rs`
  - transaction-local mutation state owns generated ids and staged writes.

Cloudflare difference: this session is per execution Durable Object instance,
not an in-process Rust isolate transaction. That makes explicit session
lifetime and HTTP syscall validation part of the backend data model.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- --runInBand
```

## Create-Root Transaction Context

Previous completed checkpoint: `1a8a8ff` Plan create-root id preallocation.

`SingleShardTransaction` now carries optional create-root state:

```ts
{
  rootTableId: number,
  preallocatedRootId: string,
  consumed: boolean,
}
```

This state is not persisted as a separate table. It is request-local execution
context that controls which document id can be used for the first root insert.
The durable data model remains the normal document history/current rows/index
rows written by `PartitionDO` commit.

Convex references:

- `crates/database/src/transaction.rs`
  - transaction-local state accumulates writes before commit.
- `crates/database/src/committer.rs`
  - commit applies validated writes to durable tables.

Cloudflare difference:

- The preallocated id is a Durable Object routing concern, so Flarex keeps it
  in transaction context until the root document write is staged.

Remaining limitations:

- No durable marker records that a transaction was create-root after commit;
  the created document is the durable result.
- Active deployment/client layers still cannot expose create-root until
  generated code and execution sessions carry the new request shape.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Create-Root Metadata Shape Update

Previous completed checkpoint: `601256a` Classify create-root partition
analysis.

Backend deployment/function metadata now accepts the create-root partition
shape:

```ts
{
  type: "partitionCreateRoot",
  table: string,
  partitionField: "_id",
}
```

`DeploymentDO` validates this shape during push/start metadata normalization,
and backend invoke planning turns it into a future `PartitionDO` object name by
preallocating the root id.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - function metadata is modeled as backend-owned deployment state.
- `crates/model/src/source_packages/mod.rs`
  - source/deployment state is stored durably before execution.

Cloudflare difference:

- Flarex stores routing intent in deployment metadata because Durable Objects
  need a concrete object name before execution. Convex does not expose this
  distinction in function metadata.

Remaining limitations:

- This is a metadata/runtime planning shape only.
- No active deployment can safely expose create-root functions to clients until
  the execution session consumes `preallocatedRootId`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Shared Artifact Ref Computation Update

Previous completed checkpoint: `363d7e0` Add local execution artifact runtime
invoke.

`DeploymentDO` now computes `active_execution_artifact_ref` through the shared
`flarex/artifacts` helper instead of an inline helper in the Durable Object.
This keeps active deployment metadata aligned with the local artifact store and
future hosted artifact storage.

Convex reference:

- `crates/model/src/source_packages/mod.rs`
  - package identity is shared between deployment metadata and execution.

Cloudflare difference: the backend still stores only the active ref and source
package JSON inline. Durable hosted storage remains future work.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Active Execution Artifact Reference Update

Previous completed checkpoint: `4a6e66f` Resolve execution sessions from active
deployment.

`DeploymentDO` now stores the first active execution artifact reference with
the active deployment pointer:

```txt
active_push_id
active_activated_at
active_execution_artifact_ref
```

The reference is content-addressed from the normalized source package manifest
and returned by `GET /deployments/:deploymentId/deployment` as:

```ts
executionArtifactRef: {
  runtime: "dynamic-worker";
  artifactId: string;
  sourcePackageHash: string;
  executionModule: string;
}
```

This gives the backend data model the missing pointer between active analyzed
deployment metadata and the future Flarex-managed Dynamic Worker runtime.

Convex reference:

- `crates/model/src/source_packages/mod.rs`
  - source packages are stored as durable metadata and addressed by
    `SourcePackageId`.
- `crates/model/src/modules/types.rs`
  - module metadata links analyzed modules to source package identity and
    module hash.

Cloudflare difference: Flarex has not built the artifact storage service yet,
so the reference is a deterministic manifest-derived pointer rather than a
database document ID for an uploaded package. R2-backed package storage and
hosted Dynamic Worker loading remain follow-up work.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Active Deployment Invoke Resolution Update

Previous completed checkpoint: `b08269e` Record active deployment pointer on
finish.

The backend data model now has its first runtime consumer of
`active_push_id`. Execution sessions resolve schema and function metadata from
the active push's analyzed deployment payload instead of trusting the mutable
`functions` table alone.

`DeploymentDO` still materializes the active schema/functions into tables for
partition schema sync, but the execution start path now treats the active push
analysis as authoritative:

```txt
active_push_id -> pushes.analysis -> schema/functions -> ExecutionDO.start
```

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - function execution receives validated metadata derived from stored module
    analysis.
- `crates/model/src/modules/mod.rs`
  - analyzed module metadata is durable deployment state used for later
    function resolution.

Cloudflare difference: Flarex still stores active source package and analysis
inline in Durable Object SQLite. Convex has richer module/config models and a
separate isolate runner. Future Flarex storage should move large source
packages and execution artifact references out of this row.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Direct Metadata Route Removal

Previous completed checkpoint: `63637f9` Harden create-root sync docs and
tests.

The backend data model no longer exposes direct public schema/function
replacement routes. `DeploymentDO` still stores normalized tables, indexes, and
functions after `finish_push`, but the only public activation path is analyzed
push state.

Current authority chain:

```txt
source package
  -> analyzed push
  -> finish_push
  -> active_push_id
  -> active deployment analysis
  -> invoke/sync/execution session
```

Convex reference:

- `crates/application/src/deploy_config.rs`
  - push/finish owns deployment activation.
- `crates/model/src/modules/mod.rs`
  - module/function metadata belongs to deployment state.

Cloudflare difference: Flarex still has materialized SQLite tables inside the
DeploymentDO because partitions need compact schema sync. Those tables are no
longer publicly writable metadata authority.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run --maxWorkers=1
```
