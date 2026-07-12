# Postgres Executor

## Ensure Intrinsic Definitions In The Caller Transaction

Previous completed checkpoint: `478137e` Broaden standing code reviewers.

Previous completed FlarexDB checkpoint: `268cc83` Prepare app schema catalog
publication.

What changed:

- Added a host-neutral, package-internal D2b writer that consumes only opaque
  child tokens derived from D2a and never opens or commits its own transaction.
- Moved developer/intrinsic owner storage through one private C3 definition
  kernel, deployment lock, high-water allocator, and exact prepared-row checker.
- Made that kernel generic over the access-kind discriminant so owner and SQL
  storage identity cannot diverge at compile time.
- Verified the exact planned app namespace/logical name before definition reads
  or allocation. PostgreSQL 18.3 proved two blocked Worker-style transactions
  converge on one intrinsic definition ID; existing C3 lock/rollback tests
  remain green.

Why it changed:

The future Worker executor needs a short SQL primitive that can participate in
D2c's larger control transaction without redoing Web Crypto or exposing raw
canonical evidence. Exact parent verification prevents optimistic C2 IDs from
being used after another publisher assigns the number differently.

Convex references inspected:

- `crates/database/src/bootstrap_model/table.rs`
- `crates/database/src/bootstrap_model/index.rs`
- `crates/indexing/src/index_registry.rs`
- `crates/application/src/deploy_config.rs`
- `crates/model/src/components/config.rs`

How Flarex differs:

Convex creates system index metadata in its integrated table-creation
transaction. Flarex keeps this framework-neutral Postgres operation separate
until D2c composes it; no Worker, service binding, HTTP, Nitro/Vercel, or
Hyperdrive adapter participates.

Known limitations and follow-up:

- D2c still owns full control-transaction composition/verification; D2d owns
  whole-attempt retry, facade/quota, and whole-publication concurrency proof.
- No host routing, build-state mutation, readiness, adapter generation, or
  deployment changed.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol exec vitest run test/index-definition.test.ts --no-file-parallelism
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appCreationTimeIndexDefinitions.test.ts test/appIndexDefinitions.test.ts --no-file-parallelism
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appIndexDefinitions.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Prepare Full Catalog Publication Outside The Write Transaction

Previous completed checkpoint: `423ba8a` Compile app schema catalog
requirements.

What changed:

- Added a host-neutral persistence-package D2a preparer. It strictly snapshots
  the unbound full app schema, performs the C2 catalog observations, runs the D1
  compiler, and hashes the exact bound artifact before any future write
  transaction.
- Retained the coupled state behind a frozen WeakMap-authenticated token and an
  unexported package state type. There is no root `FlarexPersistence` method,
  SQL apply, transaction, commit, retry loop, Fetch route, or executor-host
  adapter.
- PGlite row-count proofs show successful and failed preparation perform no
  writes; typed child errors propagate instead of being flattened into a
  transport error.

Why it changed:

Canonicalization and semantic validation must not lengthen the future
deployment lock, but separately prepared child plans would permit mixed schema
evidence. One process-local preparation token gives D2c a coherent unit to
revalidate in its short caller-owned control transaction.

Convex references inspected:

- `crates/isolate/src/environment/schema.rs`
- `crates/application/src/lib.rs`
- `crates/model/src/components/config.rs`
- `crates/database/src/bootstrap_model/schema/mod.rs`

How Flarex differs:

Convex's schema evaluation and metadata submission live in one backend and
transactional document store. Flarex's executor core remains framework-neutral
and prepares Postgres control evidence before a later transaction; the private
Worker, service binding, HTTP adapter, Nitro/Vercel adapter, and Hyperdrive do
not participate in this core slice.

Known limitations and follow-up:

- At the D2a checkpoint, D2b/D2c still owned the intrinsic writer and
  transactional apply/verification. D2d owns whole-preparation stale retry,
  the routed facade, quota, and whole-publication concurrency/rollback lane.
- No host routing, Worker deployment, definition or binding write, located
  build mutation, readiness, Payload/Medusa, or legacy cleanup changed.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appSchemaCatalogPublicationV2.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Read Located Index Builds Through The Scope Clock

Previous completed checkpoint: `37c522b` Persist immutable index definitions.

What changed:

- Added migration `0024` for search-path-relative
  `fx_system_index_build_state` beside the authoritative scope clock. Its only
  foreign key is local to that clock; control-plane deployment/definition
  identity is intentionally not copied or cross-database constrained.
- Added a strict host-neutral read that selects the clock and optional physical
  build in one Postgres statement. It returns `absent`, exact-authority
  `current`, or `stale` with mismatch fields; it does not expose readiness.
- Preserved bigint fence/sequence precision, bounded the new attempt token to
  PostgreSQL's positive signed-int64 range, and made pre-backfill cursor state
  unrepresentable in the public read type. Immutable hex cursor evidence is
  preserved.
  PostgreSQL 18.3 proved non-public search-path migration, no-control-row target
  operation, the clock FK, exact bigint reads, stale-after-commit behavior,
  uncommitted-clock snapshot consistency, and the two primary-key plan paths.

Why it changed:

The executor Worker will eventually run builders against the located data-plane
database, not the central catalog connection. Reading the build without the
same statement's clock would permit a torn authority decision; foreign-keying
the historical pin to mutable clock columns would instead block legitimate
cutover.

Convex references inspected:

- `crates/common/src/bootstrap_model/index/database_index/index_state.rs`
- `crates/database/src/bootstrap_model/index_backfills/types.rs`
- `crates/database/src/database_index_workers/index_writer.rs`
- `crates/database/src/database_index_workers/mod.rs`
- `crates/indexing/src/index_registry.rs`

How Flarex differs:

Convex can rely on one integrated database snapshot and database-worker lease.
Flarex uses one located Postgres statement plus explicit generation, fence,
epoch, start sequence, and attempt fence because distributed Worker attempts
must be rejected after authority changes.

Known limitations and follow-up:

- There is no executor consumer or build mutation. S03-D must define durable
  control/data reconciliation; S10 and later worker slices must commit entry
  writes and cursor advancement atomically under the attempt fence.
- No Worker/Hyperdrive route, service-binding adapter, HTTP/Nitro bridge,
  Cloudflare deployment, or legacy cleanup changed.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/indexBuildStates.test.ts test/pglite.test.ts --no-file-parallelism
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/indexBuildStates.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Persist Physical Index Definitions At The Trusted Boundary

Previous completed checkpoint: `6ac7286` Freeze ordered index key codec.

What changed:

- Added additive migration `0023` for immutable physical definitions and
  developer schema-version bindings. It is search-path-relative and orders the
  new logical-owner unique constraint before dependent composite foreign keys.
- Added a host-neutral internal prepare/apply operation: expensive lowering,
  canonical encoding, and SHA-256 happen before SQL; the caller-owned
  transaction locks the deployment, validates exact parents, allocates/reuses a
  compact physical ID, and inserts definition plus binding without committing.
  Existing-binding conflicts are classified before insertion, and locked replay
  compares the prepared evidence without Web Crypto.
- Added read-only root contracts that fully decode canonical JSON/bytes/digest
  evidence and fail closed on corruption. They return immutable branded hex;
  SQL rejects nullable/missing or oversized spec JSON and false activation
  requirements. Per-logical definition reads reuse the checked developer owner
  identity predicate supported by the existing owner/spec index. Allocation,
  raw definition creation, and schema publication remain absent from the
  runtime persistence facade.
- PostgreSQL 18.3 proved concurrent exact replay, one-winner competing binding,
  no orphan definition on failure, rollback identity reuse, isolated-schema
  composite foreign keys, and rejection of logically oversized JSON from a
  TOAST-compressed source. PGlite proved the complete additive migration and
  contract matrix.

Why it changed:

The Worker executor will eventually reference one exact physical definition at
commit/query/build boundaries. That identity must already be durable and
transaction-safe, without holding a database transaction across analyzer/user
code or routing through a Node/Nitro HTTP bridge.

Convex references inspected:

- `crates/common/src/types/index.rs`
- `crates/common/src/bootstrap_model/index/index_config.rs`
- `crates/database/src/bootstrap_model/index.rs`
- `crates/indexing/src/index_registry.rs`

How Flarex differs:

Convex keeps index metadata in its own transactional document model. Flarex
uses immutable, deployment-qualified Postgres definition rows and later
per-scope build rows. The core operation is framework-neutral; no Worker,
service-binding, HTTP, Nitro, Vercel, or Hyperdrive adapter participates here.

Known limitations and follow-up:

- C4 owns build-state reads/DDL, and S03-D owns full artifact verification and
  publication. Entry writes, backfill, query plans, readiness, and activation
  are deliberately absent.
- No Cloudflare provisioning/deployment, Payload/Medusa compilation, analyzer
  integration, or legacy executor cleanup changed.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appIndexDefinitions.test.ts test/pglite.test.ts --no-file-parallelism
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appIndexDefinitions.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Prove Ordered Index Bytes At The Postgres Boundary

Previous completed checkpoint:
`8c9b3ba` Define generated relations and managed schema deploys.

Previous completed index-foundation checkpoint:
`9fe45b5153e1917c6375aff980081cb68acc188a` Persist stable logical index catalog.

What changed:

- Added no migration or production repository method. Temporary PGlite and
  real-Postgres tables exercised the future composite order
  `(scope_id, index_definition_id, encoded_key, row_id)`.
- Both lanes proved half-open bytea scans, escaped-prefix exclusion, and
  duplicate encoded-key ordering by separate row identity.
- PostgreSQL 18.3 accepted an exact 2,048-byte encoded key in that composite
  B-tree plus the separately constrained exact 16-byte row identity.

Why it changed:

The fail-closed ceiling must be proven against the representative Postgres
B-tree shape before C3 embeds it in immutable physical definitions. PGlite
proves fast semantic parity; real Postgres proves the actual tuple-size and
byte-order boundary.

Convex references inspected:

- `crates/postgres/src/sql.rs`
- `crates/common/src/index.rs`
- `crates/common/src/query.rs`
- `crates/common/src/interval/key.rs`
- `crates/value/src/sorting.rs`

How Flarex differs:

Convex stores a 2,500-byte prefix plus suffix/hash support for larger keys.
Flarex uses a smaller complete 2,048-byte field-tuple ceiling, no suffix for
app-index v1, and a separate 16-byte row identity. The focused proof table is
not production DDL or a query-plan claim.

Known limitations and follow-up:

- C3/C4 still own physical definitions and build state. S10 owns entry tables,
  exact pagination/read-dependency formats, plans, and production range reads.
- No Worker, Hyperdrive, HTTP/Nitro bridge, Payload/Medusa, analyzer, backfill,
  activation, or legacy behavior changed.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol exec vitest run test/ordered-index.test.ts --no-file-parallelism
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/orderedIndexKeyCodec.test.ts --no-file-parallelism
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/orderedIndexKeyCodec.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Add The Trusted Logical Index Catalog Boundary

Previous completed checkpoint: `3104aa1` Freeze logical index manifest
contracts.

What changed:

- Added migration `0022` for `fx_control_index`, with Postgres-enforced logical
  ID bounds, unique logical names, and same-deployment stable-table ownership.
  Its composite foreign key remains search-path-relative; real Postgres caught
  and rejected Drizzle's generated `public` qualifier for isolated schemas.
- Added safe reads and a host-neutral combined optimistic table/index plan.
  The authenticated token contains one frozen app-schema manifest; callers
  cannot supply IDs, split child plans, or invoke a standalone allocator.
- Added one caller-owned Drizzle transaction primitive. It holds only the short
  deployment lock, revalidates exact catalog observations, inserts tables then
  indexes, and leaves commit/rollback to the future publication coordinator.
- Proved the schema and planner in PGlite and proved lock serialization,
  concurrent exact convergence, competing-frontier stale failure/replan, and
  transaction rollback against real Postgres.

Why it changed:

Stable numeric IDs are part of the future canonical full-schema artifact, so
they must be prepared before SQL. Exact Postgres revalidation preserves an
atomic trusted boundary without holding a transaction across analyzer code,
hashing, user code, or a network host.

Convex references inspected:

- `crates/application/src/deploy_config.rs`
- `crates/model/src/components/config.rs`
- `crates/database/src/bootstrap_model/schema/mod.rs`
- `crates/database/src/bootstrap_model/index.rs`
- `crates/database/src/transaction.rs`
- `crates/database/src/committer.rs`
- `crates/database/src/database.rs`

How Flarex differs:

- Convex uses its OCC read-set/retry loop over table and `_index` metadata.
  Flarex uses a Postgres deployment-row lock plus exact binding/high-water
  revalidation and exposes typed stale results for a later fresh-plan retry.
- The Promise/Drizzle package boundary remains deliberate. No Effect runtime,
  Fetch/HTTP adapter, Nitro host, Worker binding, or Hyperdrive path was added.

Known limitations and follow-up:

- C2 has no public full-schema persistence method and does not canonicalize or
  insert a V2 artifact. S03-D must compose those operations atomically.
- S05-A now owns the frozen physical codec. C3 and C4 still own immutable
  definitions and build state. Analyzer, Payload/Medusa, OCC rows, sync,
  Cloudflare deployment, and legacy cleanup are excluded.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/schemaManifestAppSchemaBindings.test.ts test/pglite.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/schemaManifestAppSchemaBindings.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Freeze The Full App-Schema Contract Before Index Persistence

Previous completed checkpoint: `636fa50` Register app schema artifacts
atomically.

What changed:

- Added branded stable logical index identity plus strict unbound declaration,
  bound `indexBindings`, and composite `appSchema` protocol contracts.
- Left `ensureAppSchemaVersionArtifactV1` exact: it still publishes only the
  table-definition section. The new semantic envelope is not yet routed to any
  persistence or executor facade.
- Required a separate physical definition/build identity before Postgres index
  entries or build state are added, and required future build rows to carry
  storage-generation/fence, epoch, starting commit sequence, and cursor version.

Why it changed:

The executor must resolve active logical index names to one enabled physical
definition. Convex proves a changed spec receives a new pending physical ID
while the old enabled ID remains readable; persisting both under one stable
logical `index_id` would be corrupt.

Convex references inspected:

- `crates/common/src/bootstrap_model/index/index_config.rs`
- `crates/common/src/bootstrap_model/index/index_metadata.rs`
- `crates/common/src/bootstrap_model/index/database_index/index_state.rs`
- `crates/database/src/bootstrap_model/index.rs`
- `crates/application/src/deploy_config.rs`
- `crates/model/src/components/config.rs`
- `crates/indexing/src/index_registry.rs`

How Flarex differs:

- Flarex retains a compact deployment-scoped logical numeric ID in canonical
  artifacts. Physical identity, ordered-key bytes, and per-scope lifecycle are
  separate trusted Postgres contracts.
- No HTTP/Nitro bridge or Cloudflare host participates. The eventual private
  Worker will call the host-neutral facade only after V2 atomic publication is
  implemented.

Known limitations and follow-up:

- No migration, Drizzle table, Postgres query, facade method, analyzer caller,
  retry path, index entry, backfill, activation, Payload/Medusa, or deployment
  behavior changed.
- S03-C2 will add only the logical catalog/planner. The codec and physical
  definition identity are separate correctness gates before DDL/publication.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm check:effect-boundaries
git diff --check
```

## Compose Mapping And Artifact Registration Behind One Facade

Previous completed checkpoint: `4ef6f0c` Prepare stable schema table bindings.

What changed:

- Added `ensureAppSchemaVersionArtifactV1` to the host-neutral persistence
  facade. PGlite, pooled Postgres, and connected-client drivers inject a trusted
  Drizzle transaction repository without widening the public SQL transaction
  callback.
- Built the B1 artifact only from the frozen B2b1 section and retained both
  child tokens inside one private combined token. Callers cannot swap a valid
  plan and valid artifact from different schema attempts.
- Narrowed root exports to remove the B1 write helper and stable-table allocator.
  Concrete adapter Drizzle/schema access remains a privileged backend escape
  hatch for migrations/tests, not a supported publication API.
- Added a three-total-attempt stale-only coordinator. A stale attempt rolls
  back, then repeats plan preparation, canonical encoding, SHA-256, and the
  short transaction; terminal errors are not remapped or retried.
- Consolidated the Postgres lock barrier around the exact blocker backend and
  its transitive wait queue instead of globally counting matching query text.

Why it changed:

The executor-facing persistence boundary needs one safe registration call, not
separate mapping and artifact calls whose successful commits could diverge.
Hashing stays outside SQL while the final cross-table invariant remains atomic.

Convex references inspected:

- `crates/application/src/deploy_config.rs`
- `crates/model/src/components/config.rs`
- `crates/database/src/bootstrap_model/schema/mod.rs`
- `crates/database/src/database.rs`
- `crates/database/src/committer.rs`

How Flarex differs:

- Convex retries selected database OCC failures around its whole schema
  callback. This Flarex slice retries only its typed stale binding plan and
  keeps SQL failures terminal; immutable registration does not port Convex's
  Pending-schema overwrite lifecycle.

Known limitations and follow-up:

- No analyzer/compiler caller, HTTP/Nitro/Worker route, Hyperdrive behavior,
  activation, index build, row/OCC path, Payload, Medusa, sync, or Cloudflare
  deployment behavior changed.
- Real-Postgres co-publication, stale-rehash, and conflict-rollback pass against
  a disposable PostgreSQL 18.3 cluster; all eight focused B1/B2b1/B2b2 tests
  pass and the cluster is removed after the run.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appSchemaVersionArtifacts.test.ts test/schemaManifestTableBindings.test.ts test/schemaVersionArtifacts.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/appSchemaVersionArtifacts.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter @flarex/executor-worker typecheck
corepack pnpm check:effect-boundaries
git diff --check
```

## Prepare Stable-ID Plans Outside The Locked Publication Transaction

Previous completed checkpoint: `cd7cec2` Freeze semantic table definition
contracts.

What changed:

- Added a framework-neutral, internal optimistic plan over current stable table
  bindings and the catalog high-water mark. The plan exposes a recursively
  frozen semantic section that a later slice can hash outside SQL.
- Added a short transaction primitive that locks/revalidates and applies exact
  planned IDs or returns a typed stale-plan failure. It performs no hashing,
  analyzer execution, host routing, artifact insertion, or commit.
- Shared the stable catalog's internal high-water/next-ID allocation policy and
  added environment-gated real-Postgres contention cases for exact replay,
  competing plans, and post-lock allocator visibility.
- Kept the Promise/Drizzle repository boundary; the package has no Effect
  runtime and no new runtime bridge was introduced.

Why it changed:

B1 preparation must remain outside SQL, but stable IDs are not known until the
catalog is observed. Optimistic revalidation is the narrow seam that lets B2b2
compose mapping and artifact publication atomically without holding Postgres
open across Web Crypto.

Convex references inspected:

- `crates/application/src/deploy_config.rs`
- `crates/database/src/bootstrap_model/schema/mod.rs`
- `crates/database/src/database.rs`
- `crates/common/src/bootstrap_model/schema_metadata.rs`

How Flarex differs:

- Convex's schema JSON is name-keyed and can be written with mappings in one
  transaction directly. Flarex's artifact hash includes stable IDs, so it uses
  an optimistic plan and stale retry before the equivalent atomic commit.

Known limitations and follow-up:

- Resolved by the B2b2 checkpoint above: the combined trusted facade now owns
  preparation/transaction composition while the apply primitive stays hidden.
- The real-Postgres binding suite was added but skipped locally because
  `FLAREX_POSTGRES_DATABASE_URL` is unset; B2b2 added the combined
  mapping/artifact proof to the same gated lane.
- No Fetch/Nitro/Worker route, Hyperdrive, artifact persistence, OCC, row,
  compiler, sync, Payload, Medusa, or Cloudflare deployment behavior changed.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/schemaManifestTableBindings.test.ts test/stableTableCatalog.test.ts test/schemaVersionArtifacts.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/schemaManifestTableBindings.postgres.test.ts --no-file-parallelism
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
git diff --check
```

## Freeze Host-Neutral Semantic Table Definitions

Previous completed checkpoint: `00e15c7` Require evidence-first design review.

What changed:

- Added the strict semantic app-document table-definition section to
  `flarex-protocol`, including stable IDs, exact versioned discriminants,
  object-validator requirements, Convex-compatible app identifiers, ordering,
  and uniqueness.
- Extracted the existing `ValidatorJson` codec from the HTTP deployment module
  into a focused protocol subpath as immutable `ValidatorJsonV1` while
  preserving the old names as compatibility re-exports.
- Kept semantic decoding separate from the generic B1 canonical codec. No
  executor, Fetch, Nitro, Worker, SQL repository, or migration code changed.

Why it changed:

The future trusted binder/compiler needs a host-neutral semantic input before
it can safely register an immutable artifact. Importing the HTTP API module or
adding a normalized definition table would couple that contract to a runtime
host or persistence projection.

Convex references inspected:

- `crates/common/src/bootstrap_model/schema_metadata.rs`
- `crates/common/src/bootstrap_model/tables.rs`
- `crates/common/src/schemas/mod.rs`
- `npm-packages/convex/src/server/schema.ts`

How Flarex differs:

- Convex reconstructs a typed schema through name-keyed maps. Flarex's trusted
  B2b binder must first resolve stable deployment catalog IDs, sort numerically,
  then pass the decoded section to the B1 canonical hasher.
- Section v1 does not pretend app validators describe Medusa relational DML or
  Payload adapter schemas; those need new explicit variants.

Known limitations and follow-up:

- No analyzer/compiler route consumes the section yet. S03-B2b owns stable-ID
  resolution and artifact persistence; S03-D owns trusted cross-reference
  validation/readiness.
- No transaction, OCC, row, commit compiler, sync, Hyperdrive, or Cloudflare
  deployment behavior changed.

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

## Persist Schema Artifacts Behind Framework-Neutral Transaction APIs

Previous completed checkpoint: `54f0022` Persist stable table identities.

What changed:

- Added a host-neutral canonical manifest codec and immutable schema-version
  artifact repository in `flarex-protocol` and
  `@flarex/persistence-postgres`; no HTTP, Nitro, Worker, or backend host owns
  the logic.
- A trusted preparation function validates, canonicalizes, and hashes before
  opening SQL, then returns an opaque repository-owned token. The
  transaction-only ensure phase accepts only that token and performs the short
  deployment lock, conflict resolution, replay verification, and insert. It
  accepts no caller-provided codec, bytes, digest, JSON copy, timestamp, or
  active state.
- Exact registration replays the stored artifact. ID/version conflicts fail
  typed and checksum collision is distinct from mismatch. Under the deployment
  lock, replay compares only validated scalar, canonical-byte, and digest
  evidence; full point reads re-canonicalize JSON and verify stored bytes and
  digest outside that locked write phase.
- Final review rejected exotic array prototypes, removed input-owned method
  dispatch from encoding, and separated invalid manifest input from
  canonicalization/hash infrastructure failure. It also made returned byte
  arrays defensive copies and removed canonicalization/Web Crypto awaits from
  the deployment-lock phase.
- PGlite covers local contracts and upgrades; PostgreSQL 18 covers concurrent
  exact replay and competing version claims in a non-public schema.

Why it changed:

The future trusted compiler and executor need a stable schema input, but user
analysis and runtime execution cannot hold or receive a database transaction.
This slice persists only the trusted artifact and keeps all host composition,
catalog compilation, and activation outside the transaction.

Convex references inspected:

- `crates/database/src/bootstrap_model/schema/mod.rs`
- `crates/common/src/bootstrap_model/schema_metadata.rs`
- `crates/application/src/schema_worker/mod.rs`
- `crates/database/src/transaction.rs`

How Flarex differs:

- Convex reuses equal typed schemas. Flarex additionally compares frozen
  canonical bytes and verifies SHA-256 because PostgreSQL JSON encoding is not
  a stable hash boundary.
- Distributed hosts converge through a short deployment-row lock. Neither the
  private Worker nor the compatibility Fetch/Nitro adapters participate in
  artifact semantics.

Known limitations and follow-up:

- The executor does not consume the artifact. S03-B2 table definitions and
  S03-D trusted compilation/validation must land before any routing decision.
- No active pointer, lifecycle transition, analyzer call, user code, OCC, app
  row, commit compiler, sync, Payload, Medusa, Hyperdrive, or deployment work
  is included.
- A canonical byte-size limit and privileged-SQL immutability hardening remain
  explicit follow-up decisions.

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

## Establish The Framework-Neutral Stable Table Catalog

Previous completed checkpoint: `9b924dd` Resolve trusted scope authority.

What changed:

- Added stable deployment-scoped table identity contracts and the additive
  `fx_control_table` mapping inside `flarex-protocol` and
  `@flarex/persistence-postgres`, not in a Nitro, HTTP, Worker, or backend host.
- Added a short transaction-only allocator that locks the deployment parent,
  returns an exact existing mapping on retry, and otherwise appends a compact
  positive table ID. Point reads remain deployment-qualified.
- Proved rollback and migration behavior in PGlite and concurrent replay in an
  isolated PostgreSQL 18 cluster. The real-Postgres lane also proves the
  migration works under a non-public test schema.

Why it changed:

The trusted executor will eventually consume stable table identities for
snapshots, OCC, commits, and adapter syscalls. Persisting the mapping first
prevents the analyzer's order-derived table ordinal from becoming authority and
keeps that core independent of every runtime host.

Convex references inspected:

- `crates/database/src/bootstrap_model/table.rs`
- `crates/value/src/table_mapping.rs`
- `crates/database/src/transaction.rs`

How Flarex differs:

- Convex allocates and resolves table metadata within one backend. Flarex uses
  a deployment-row lock in PostgreSQL so distributed Workers converge through
  one short trusted transaction.
- No HTTP bridge or Cloudflare Worker behavior participates in this allocator;
  those hosts remain adapters around the future executor composition.

Known limitations and follow-up:

- The executor does not consume this catalog yet. S03 schema versions and the
  trusted compiler must exist before analyzer/runtime routing can switch.
- This checkpoint adds no OCC, codecs, row storage, commit compiler, sync,
  Payload, Medusa, Hyperdrive, or deployment behavior.

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

## Derive Hosted PostgreSQL Proof From Canonical Sidecars

Previous completed checkpoint: `7f282b2` (`Prove hosted probe teardown`).

What changed:

- Replaced the final receipt's embedded data-plane copy and arbitrary section
  hashes with a compact receipt-v2 that cites the exact data-plane sidecar hash,
  invocation hash, execution window, and zero-row cleanup fact. The containing
  bundle embeds and rehashes the full data-plane artifact.
- Corrected Hyperdrive provenance from the unused Wrangler label to the REST
  API actually queried by the control-plane collector. Receipt-v2 retains exact
  origin host/database hashes, scheme, port, TLS mode, resource identity, and
  cache-disabled state from the fenced control evidence.
- Split cleanup provenance: PostgreSQL cleanup cites the canonical data-plane
  artifact, while disposable-probe absence cites the canonical teardown
  artifact. Neither sidecar pretends to have observed the other's boundary.
- The bundle compiler now refuses mixed runs, commits, configurations, Worker
  versions, paths, or hashes before deriving the receipt and outer bundle hash.

Why it changed:

The former receipt's `cloudflare-api-and-postgres` cleanup label and component
hashes described evidence that did not exist as one source. The final gate now
preserves two independently authoritative facts and joins them only inside the
self-contained bundle for the same source and run.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`

How Flarex differs:

- Convex owns persistence publication and execution evidence in one backend.
  Flarex's hosted compatibility lane reaches real PostgreSQL through an
  externally configured Hyperdrive binding, so the final gate explicitly joins
  its data-plane cleanup to Cloudflare lifecycle and trace evidence.

Known limitations:

- This checkpoint opens no database connection and changes no persistence,
  migration, schema, isolation, lock, transaction, or OCC behavior.
- The real-Postgres/Hyperdrive claims remain unproven until the credentialed
  sidecars and bundle are collected from one clean source commit. H05 remains
  open.
- The receipt is not a substitute for its embedded data-plane sidecar; only the
  verified bundle is activation authority.
- S02-D routing and all FlarexDB sequence, OCC, commit-compiler, sync, Payload,
  Medusa, and schema work remain outside this slice.

Verification:

```sh
corepack pnpm --filter @flarex/executor-worker typecheck # passed
corepack pnpm --filter @flarex/executor-worker test # 20 files, 171 tests passed
corepack pnpm --filter @flarex/executor-worker build # passed
corepack pnpm --filter @flarex/executor-worker check:bundle # passed; production graph remained 401 inputs
corepack pnpm --filter @flarex/executor-worker deploy:h05-probe:dry-run # passed; 7.66 KiB proof Worker
corepack pnpm --filter @flarex/executor-worker compile:h05-hosted-proof-bundle # expected exit 1; usage guard rejected missing sidecars before filesystem access
corepack pnpm --filter @flarex/executor-worker check:h05-hosted-proof-bundle package.json # expected exit 1; non-bundle JSON rejected
corepack pnpm check:effect-boundaries # passed
git diff --check # passed
```

## Bind Probe Teardown To Verified PostgreSQL Cleanup

Previous completed checkpoint: `13d79d6` (`Compile hosted executor trace
evidence`).

What changed:

- Added a teardown dependency fence that accepts only the canonical hosted
  data-plane artifact and canonical post-run control-plane artifact for the same
  commit and run, with data-plane completion ordered before the post-run fence
  and teardown ordered after it.
- Kept PostgreSQL cleanup authoritative in the data-plane artifact. The new
  Cloudflare teardown sidecar references its exact evidence hash but does not
  copy `proofRowsRemaining: 0` or claim that a second database query occurred.
  The final compiler must project that fact from the verified data plane and
  project probe absence from the verified teardown sidecar.

Why it changed:

The final receipt currently describes one combined Cloudflare-and-Postgres
cleanup source that does not exist. Separating the two facts preserves honest
provenance while still binding them to one run: PostgreSQL rows are removed by
the hosted proof runner, and the disposable caller is subsequently removed by
the Cloudflare teardown boundary.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`

How Flarex differs:

- Convex publishes transaction completion inside its owned backend. Flarex's
  temporary hosted compatibility lane must join a PostgreSQL cleanup artifact
  to an independently collected Cloudflare lifecycle artifact.

Known limitations:

- This checkpoint opened no PostgreSQL connection and changed no executor,
  persistence, schema, migration, isolation, lock, or OCC behavior.
- No hosted credentials were available, so the zero-row data-plane claim and
  Cloudflare teardown have not yet been observed together. H05 remains open.
- Final bundle derivation must repair the standalone receipt's misleading
  cleanup source/hash fields; no hash-shaped receipt assertion is accepted as
  proof in this checkpoint.
- S02-D routing and the FlarexDB sequence, OCC, commit compiler, sync, Payload,
  Medusa, and schema redesign remain outside this slice.

Verification:

```sh
corepack pnpm --filter @flarex/executor-worker typecheck # passed
corepack pnpm --filter @flarex/executor-worker exec vitest run test/probeTeardownEvidence.test.ts test/cloudflareProbeTeardownApi.test.ts test/h05ProbeTeardownCollector.test.ts # 3 files, 19 tests passed
corepack pnpm --filter @flarex/executor-worker test # 18 files, 172 tests passed
corepack pnpm --filter @flarex/executor-worker build # passed
corepack pnpm --filter @flarex/executor-worker check:bundle # passed; production graph remained 401 inputs
corepack pnpm --filter @flarex/executor-worker deploy:h05-probe:dry-run # passed; 7.66 KiB proof Worker
corepack pnpm --filter @flarex/executor-worker collect:h05-probe-teardown-evidence # expected exit 1; usage guard rejected missing evidence paths before mutation
corepack pnpm check:effect-boundaries # passed
git diff --check # passed
```

## Bind Hosted PostgreSQL Results To Stable Worker Traces

Previous completed checkpoint: `e98d9fa` (`Collect hosted executor control-plane
evidence`).

What changed:

- Added a canonical trace sidecar compiler that accepts the existing hosted
  PostgreSQL data-plane artifact only between matching pre-run and post-run
  control-plane fences. Its input hashes, source commit, run identity, exact
  executor/probe versions, and data-plane window are all inside the outer hash.
- Cross-checks the data-plane oracle's one unauthorized and fourteen authorized
  calls against fifteen exact run-path traces. The fourteen executor roots must
  descend from their probe roots and reproduce the oracle's twelve successful
  and two OCC-conflict HTTP statuses while both Worker outcomes remain `ok`.
- Keeps PostgreSQL and Hyperdrive secrets out of telemetry collection. The
  collector reads only already-redacted control/data artifacts and Cloudflare
  event metadata, uses a separate telemetry capability, and publishes only
  domain-hashed provider identifiers outside the worktree.

Why it changed:

The SQL artifact proves the expected transaction and cleanup result, but on its
own it cannot prove which active Worker version executed those private Fetch
calls. The new join closes that offline evidence gap without altering the
executor, persistence schema, transaction engine, or Hyperdrive adapter.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`

Cloudflare references inspected:

- [Workers Observability telemetry query](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/)
- [Trace spans and attributes](https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/)

How Flarex differs:

- Convex's function runner returns one final transaction to its trusted
  committer. The current Flarex H05 lane performs fourteen request-scoped
  compatibility calls through another Worker, so temporary external evidence
  must correlate the PostgreSQL oracle with both Cloudflare execution versions.

Known limitations:

- No real PostgreSQL, Hyperdrive, or telemetry endpoint was contacted in this
  checkpoint. The trace sidecar contract and collector are validated offline;
  the credentialed hosted proof remains required.
- `trace.evidenceSha256` is not yet projected into the final hosted receipt.
  Probe teardown and the final compiler remain later H05 checkpoints.
- Persistence schema, timestamp allocation, OCC behavior, commit compilation,
  sync, Payload, and Medusa integration are unchanged.

Verification:

```sh
corepack pnpm --filter @flarex/executor-worker typecheck # passed
corepack pnpm --filter @flarex/executor-worker test # 15 files, 153 tests passed
corepack pnpm --filter @flarex/executor-worker build # passed
corepack pnpm --filter @flarex/executor-worker check:bundle # passed; production graph remained 401 inputs
corepack pnpm --filter @flarex/executor-worker deploy:h05-probe:dry-run # passed; 7.66 KiB proof Worker
corepack pnpm check:effect-boundaries # passed
git diff --check # passed
```

## Bind Hosted Hyperdrive To The Exact Staging Target

Previous completed checkpoint: `2bd5b99` (`Capture hosted executor data-plane
evidence`).

What changed:

- Added a read-only Hyperdrive proof projection that requires the deployed
  binding's exact 32-hex ID and expected resource name, explicit
  `caching.disabled === true`, PostgreSQL scheme/port, and TLS mode `require`,
  `verify-ca`, or `verify-full`. Matching opening and closing captures fence
  the mutable Hyperdrive resource around the Worker and privacy reads.
- Parses the dedicated H05 PostgreSQL URL without echoing it, rejects local or
  unspecified hosts, default databases, extra URL parameters, missing/weak TLS,
  and mismatched expected database names. Host, database, port, scheme, TLS,
  and PostgreSQL role are compared transiently against fresh Hyperdrive output;
  only domain-separated host/database hashes and non-secret settings persist.
- Recursively rejects unexpected credential/key fields in Hyperdrive and
  secret-binding responses. Raw origin host, database, username, password,
  database URL, secret values, and provider response envelopes are discarded.
- Cross-checks the active executor version's exact Hyperdrive binding against
  the independently read Hyperdrive resource. Cache-disabled configuration is
  therefore tied to the Worker version that the later data-plane proof will
  invoke, rather than inferred from checked-in Wrangler JSON.

Why it changed:

The hosted OCC artifact proves PostgreSQL results but not that production used
the intended Hyperdrive resource, target database role, TLS policy, or disabled
query cache. This preflight closes that evidence gap without opening a database
connection or changing transaction behavior.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`

Cloudflare references inspected:

- [Hyperdrive configuration GET](https://developers.cloudflare.com/api/go/resources/hyperdrive/subresources/configs/methods/get/)
- [Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)
- [Worker version bindings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/)

How Flarex differs:

- Convex owns its database connection identity inside one trusted backend.
  Flarex's hosted compatibility path reaches PostgreSQL through a separately
  configured Cloudflare Hyperdrive binding, so the preflight compares that
  external resource to the operator-declared staging target in memory and
  retains only redacted proof.

Known limitations:

- No live Hyperdrive or PostgreSQL target was inspected in this checkpoint;
  credentials remain absent and H05 is not complete.
- This proves configuration only. Real PostgreSQL remains required for the
  hosted isolation/OCC/cleanup run, and later trace evidence must prove that the
  same active Worker version executed through the service binding.
- The current final receipt calls its Hyperdrive source
  `wrangler-hyperdrive-get`, while this sidecar uses the underlying REST API.
  The final compiler must resolve that provenance label explicitly rather than
  silently treating a hash-shaped field as proof.
- Persistence schema, commit timestamps, OCC behavior, and FlarexDB generation
  routing are unchanged.

Verification:

```sh
corepack pnpm --filter @flarex/executor-worker typecheck # passed
corepack pnpm --filter @flarex/executor-worker test # 12 files, 128 tests passed
corepack pnpm --filter @flarex/executor-worker build # passed
corepack pnpm --filter @flarex/executor-worker check:bundle # passed; production graph remained 401 inputs
corepack pnpm --filter @flarex/executor-worker deploy:h05-probe:dry-run # passed; 7.66 KiB proof Worker
corepack pnpm check:effect-boundaries # passed
git diff --check # passed
```

## Capture Hosted OCC And Cleanup As One Data-Plane Artifact

Previous completed checkpoint: `708b234` (`Gate hosted executor activation
receipts`).

What changed:

- Removed Vitest from the reusable H04/H05 OCC oracle and hosted PostgreSQL
  runner. Node assertions now enforce response bodies, commit ordering,
  session/read/write state, direct SQL counts, and the private-hop marker, so a
  standalone collector can run the exact same proof.
- Made the hosted transport count its unauthorized, authorized, hop-marked,
  and `no-store` responses and refuse evidence unless they equal the declared
  `1/14/14/15` scenario.
- Delayed the successful return until deployment-scoped rows, captured scope
  clock/provisioning rows, the advisory claim, and database clients are all
  cleaned. Only then is `{ proofRowsRemaining: 0 }` joined with the canonical
  invocation receipt in `flarex-h05-data-plane-evidence-v1`.
- Made cleanup coverage fail closed on schema drift for both `deployment_id`
  and `scope_id` base tables, so a newly introduced scope-owned table cannot be
  silently omitted from the zero-row proof.
- Added shared verifiers that recompute the invocation SHA-256 and an outer
  SHA-256 over format, source commit, collection window, run identity,
  invocation, and cleanup before the collector atomically publishes the bundle
  outside the Git worktree.
- Bound final trace timestamps inside that hashed collection window and ordered
  disposable-probe teardown after PostgreSQL cleanup completes.

Why it changed:

An in-memory Vitest result and a `finally` block are not durable H05 evidence.
The final hosted receipt needs one artifact that proves both the current OCC/SQL
oracle and successful run-owned PostgreSQL cleanup. The run, source, time
window, and cleanup must be inside the same checked hash boundary as the
invocation rather than accepted beside a hash-shaped string.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`

How Flarex differs:

- Convex returns one final transaction directly to its committer. The current
  Flarex host journals one compatibility session over private Fetch calls, so
  its temporary proof artifact also records transport counts and explicit row
  cleanup.

Known limitations:

- This artifact has not been produced against hosted PostgreSQL. The current
  environment has no H05 database URL or Cloudflare credentials.
- Control-plane, privacy, trace, and disposable-probe teardown evidence are not
  synthesized here and must still be joined before the existing full receipt
  checker can pass.
- Persistence schema and future FlarexDB transaction semantics are unchanged.

Verification:

```sh
corepack pnpm --filter @flarex/executor-worker typecheck # passed
corepack pnpm --filter @flarex/executor-worker test # 8 files, 98 tests passed
corepack pnpm --filter @flarex/executor-worker build # passed
corepack pnpm --filter @flarex/executor-worker collect:h05-data-plane-evidence data-plane.json # expected exit 1; rejected in-worktree output without writing
corepack pnpm check:effect-boundaries # passed
git diff --check # passed
```

## Bind Hosted OCC And SQL Evidence Into One Receipt

Previous completed checkpoint: `dcf64dc` (`Prepare hosted executor activation
proof`).

What changed:

- Added a strict redacted H05 receipt boundary for the existing hosted
  PostgreSQL runner. The decoder cross-checks the run ID against its derived
  deployment/project, the executor's active version against its bound
  cache-disabled Hyperdrive, and the probe's active version against the named
  executor service binding. Both version binding inventories must be complete,
  and the correlated Observability query must be complete and untruncated.
- Fixed the data-plane evidence at the same H04 oracle rather than inventing a
  second hosted scenario: one unauthorized request, fourteen authenticated
  no-store service-binding responses, a winner above seed timestamp `10`, a
  stale `409` against that winner followed by abort, and a fresh commit whose
  read and `prev_ts` both reference the winner.
- Required the direct SQL receipt to show three sessions, zero active sessions,
  three document revisions, two commits, two outbox events, the winner as the
  final `prev_ts`, and the fresh commit as the final timestamp. Post-proof
  evidence must independently show zero run-owned rows before H05 can close.
- Added a package-local `check:h05-hosted-receipt` command. It reads at most a
  1 MiB JSON artifact, validates it as unknown input, emits only run/commit
  identity on success, and fails without printing bearer-capability or
  database-origin material. A structurally valid receipt must also match local
  `HEAD`, a clean
  worktree, the installed Wrangler version, and their recomputed evidence hash.
- Classified the run ID as non-sensitive proof identity even though it is
  uploaded through a secret binding to avoid persistent config. Only the two
  bearer capability values are omitted. Cloudflare deployment/version IDs stay
  opaque rather than being constrained to a specific UUID version and variant.
- Canonical serialization makes duplicate JSON keys and alternate byte
  representations fail closed before a receipt can become a durable H05
  checkpoint. The all-zero checked-in Hyperdrive placeholder and evidence that
  places privacy/config checks after execution or cleanup before the last trace
  are also rejected.

Why it changed:

The hosted Vitest lane proves transaction behavior only while it is running;
Wrangler control-plane output proves resource configuration only. H05 needs a
single fail-closed boundary that rejects a receipt unless those independent
claims agree on the run, Hyperdrive, Worker versions, traces, OCC timestamps,
SQL state, and cleanup.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`

How Flarex differs:

- Convex's hosted runner hands a final transaction directly to its committer.
  This temporary Flarex compatibility path persists a session over fourteen
  private Fetch calls, so H05 additionally proves the service-binding hop and
  correlates both Worker versions through Cloudflare tracing.

Known limitations:

- This is still H05-B preparation, not hosted PostgreSQL evidence. The current
  environment has neither confirmed Cloudflare authentication nor a dedicated
  Internet-reachable staging PostgreSQL URL, so no live receipt was generated.
- The receipt validates a sanitized summary and hashes of its source evidence;
  the next collector slice must create those summaries from fresh command/API
  output and retain the redacted evidence set for audit.
- This checkpoint changes no persistence schema, timestamp source, sequence
  allocator, OCC model, commit compiler, sync protocol, Payload, or Medusa
  integration.

Verification:

```sh
corepack pnpm --filter @flarex/executor-worker typecheck # passed
corepack pnpm --filter @flarex/executor-worker test # 7 files, 85 tests passed
corepack pnpm --filter @flarex/executor-worker check:bundle # passed
corepack pnpm --filter @flarex/executor-worker deploy:h05-probe:dry-run # passed
corepack pnpm --filter @flarex/executor-worker check:h05-hosted-receipt package.json # expected exit 1; rejected non-receipt JSON
corepack pnpm --filter @flarex/executor-worker exec node --no-warnings node_modules/wrangler/wrangler-dist/cli.js --version # passed on Windows; 4.100.0
corepack pnpm check:effect-boundaries # passed
corepack pnpm typecheck # passed across 15 workspace projects
corepack pnpm test # bounded at 244s in the unrelated flarex-backend Vitest process; verified residual PIDs were stopped
corepack pnpm build # executor built; unrelated apps/example Vite build failed on the existing extensionless flarex-backend/src/http import
git diff --check # passed
```

## Prepare The Hosted Service-Binding PostgreSQL Lane

Previous completed checkpoint: `e2921b5` (`Prove executor Worker service
binding`).

What changed:

- Extracted H04's exact winner/stale-conflict/abort/fresh-convergence scenario
  into one shared proof helper without changing executor or persistence
  behavior. It returns typed runtime evidence and validates authoritative SQL
  state for both local and hosted transports.
- Added a hosted transport that can reach the executor only through the
  authenticated H05 probe. The Node runner never receives the executor token;
  setup, migration, seeding, SQL assertions, and scoped cleanup stay outside
  Cloudflare user execution.
- Added deployment-scoped cleanup covering every current persistence table,
  captured scope provisioning/clock metadata, the scope locator, and the
  deployment. Information-schema comparison makes a future deployment-keyed
  table fail closed until the cleanup inventory is updated.
- Added an exclusive session advisory claim for the run ID without holding a
  database transaction across hosted Fetch. The runner also requires encrypted
  PostgreSQL, validates the effective remote authority, rejects connection
  target overrides, and bounds pool, statement, lock, query, and probe-request
  waits.
- H04 reran against a fresh PostgreSQL 18 cluster and proved no proof rows
  remained, scope-owned rows were checked, a second claim was excluded, and
  the claim became reusable before the disposable database was dropped.
- Kept the hosted lane outside ordinary tests and made its explicit command
  rebuild both production and probe bundles before any staging mutation.

Why it changed:

H05 needs the same existing OCC oracle as H04, not a similar hand-written
scenario. Sharing the proof makes the later hosted result comparable while the
strict staging configuration and cleanup guard against accidental mutation of
an unnamed or local database.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`

How Flarex differs:

- Convex moves final reads and writes from the function runner directly into
  its committer. Flarex's compatibility executor persists an invoke session
  across four private HTTP operations, but the executor Worker still owns the
  database capability and final commit.

Known limitations:

- The hosted test is prepared but has not run. It does not prove Hyperdrive
  caching state, Worker placement/privacy, or Cloudflare deployment identity;
  H05-B must pair those control-plane receipts with this data-plane result.
- The shared helper validates legacy point-OCC only and changes no FlarexDB
  schema, clock, fence, sequence, or compiler semantics.

Verification:

```sh
corepack pnpm --filter @flarex/executor-worker typecheck
corepack pnpm --filter @flarex/executor-worker test
corepack pnpm --filter @flarex/executor-worker check:bundle
corepack pnpm --filter @flarex/executor-worker deploy:h05-probe:dry-run
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/executor-worker test:service-binding:postgres
git diff --check
```

## Prove Request-Scoped Worker Transactions Through A Named Binding

Previous completed checkpoint: `f0ec41b` (`Add private executor Worker bundle
gate`).

What changed:

- Added the H04 real-PostgreSQL lane around the exact emitted executor Worker,
  a caller Worker with a string-valued named service binding, and a disposable
  database migrated and seeded by the Node fixture rather than the Worker.
- Proved authorization, start/get/patch/finish, stale OCC rejection, explicit
  abort, inactive-session rejection, fresh reread, and convergent finish through
  the private Fetch protocol.
- Polled PostgreSQL for zero target-database clients while workerd remained
  alive, then disposed workerd and reopened PostgreSQL to assert the final
  revision, `prev_ts` chain, session states, observed read timestamps, retained
  stale staged write, commit count, and outbox count. A second zero-client poll
  precedes normal database drop.
- Replaced only the production Worker's Elysia edge with the Worker-safe Fetch
  subpath after authorized workerd execution exposed forbidden string code
  generation. Static bundle verification now prevents that dependency from
  returning.

Why it changed:

The trusted executor's PostgreSQL behavior was previously proven through Node
and direct adapters, not the actual Cloudflare Worker graph. H04 closes the
local runtime gap and challenges the bundle with an authorized database path,
while preserving the current transaction implementation as the oracle for the
later redesign.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`
- `crates/isolate/src/environment/udf/syscall.rs`

How Flarex differs:

- Convex owns execution, read/write collection, commit validation, and
  publication in one backend process. Flarex's current executor persists an
  invoke session between service-bound requests, but the Worker still owns the
  trusted persistence object and final commit.

Known limitations:

- H04 uses a local direct-PostgreSQL Hyperdrive binding. H05 must still prove a
  deployed cache-disabled Hyperdrive and hosted service-binding call.
- This validates existing timestamp/OCC semantics only; it does not implement
  the future scope clock, generation fence, exact snapshot token, or commit
  compiler.
- The fixture uses the fixed shared `primary/public` locator and creates a
  disposable database for isolation. Split data-plane runtime resolution is
  still S02-D work.
- Workspace build retained the existing example-app extensionless-`../http`
  resolution failure after all changed packages built. Workspace and isolated
  backend tests retained only the three existing `identityFingerprint`
  expectation failures; 729 of 732 backend tests passed.

Verification:

```sh
corepack pnpm --filter @flarex/executor-worker typecheck
corepack pnpm --filter @flarex/executor-worker test
corepack pnpm --filter @flarex/executor-worker check:bundle
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/executor-worker test:service-binding:postgres
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http test
corepack pnpm typecheck
corepack pnpm check:effect-boundaries
corepack pnpm build # existing example-app extensionless-import failure
corepack pnpm test # existing three-test identityFingerprint expectation drift
git diff --check
```

## Host The Existing Executor In A Request-Scoped Worker

Previous completed checkpoint: `402eef7` (`Add Worker-safe Postgres client
persistence`).

What changed:

- Added the dedicated executor Worker that constructs exactly one
  `pg.Client` from `HYPERDRIVE_CACHE_DISABLED.connectionString` inside each
  authorized Fetch. It does not create a pool, run migrations, or retain a
  database object at module scope.
- Connected H02's runtime-only persistence and client-taking shared authority
  provisioner to the existing trusted executor and HTTP protocol. The current
  shared `primary/public` authority remains unchanged.
- Added deterministic tests for missing configuration, unauthorized requests
  allocating no client, one client per Fetch, connect failure, handler failure,
  cleanup-only failure, primary-plus-cleanup failure, non-2xx response plus
  cleanup failure, and both synchronously throwing and asynchronously rejecting
  cleanup reporters.
- Added an executable Wrangler metafile gate. The 717-input production graph
  includes node-postgres and the client adapter but excludes PGlite,
  ElectricSQL, Drizzle migrators, and the Node pool/migration adapter.
- Kept `noUncheckedIndexedAccess` enabled for the new app. That exposed and
  corrected one bounds-unsafe index-key byte lookup without changing its
  encoded-key behavior.

Why it changed:

The authoritative Postgres executor can only replace the old Node/Nitro-hosted
shape after its concrete Cloudflare host proves request-scoped connection
ownership and a Worker-safe dependency graph. H03 establishes that host; H04
will prove its actual service-binding path and transaction behavior.

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
- `crates/function_runner/src/lib.rs`
- `crates/isolate/src/environment/udf/syscall.rs`

How Flarex differs:

- Convex applies the `FunctionFinalTransaction` back to the application
  transaction in-process. Flarex persists invocation state across private
  `/invoke/*` Fetches, but the trusted executor and database adapter remain
  co-located inside this Worker.

Known limitations:

- No real PostgreSQL request was sent through a named workerd service binding
  in H03. That exact proof, including stale-session OCC convergence and
  authoritative SQL assertions, belongs to H04.
- The placeholder Hyperdrive ID and binding name do not prove a cache-disabled
  hosted resource. H05 remains required.
- No migration, schema redesign, generation routing, new OCC, commit compiler,
  sync, Payload, or Medusa behavior changed.
- The workspace build passed H03 and all libraries before the existing example
  app extensionless-`../http` resolution failure.
- The workspace test passed the 148-test persistence lane, then reproduced the
  existing three-test `flarex-backend` `identityFingerprint` expectation drift
  in files untouched by H03.

Verification:

```sh
corepack pnpm --filter @flarex/executor-worker typecheck
corepack pnpm --filter @flarex/executor-worker test
corepack pnpm --filter @flarex/executor-worker check:bundle
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http test
corepack pnpm typecheck
corepack pnpm check:effect-boundaries
corepack pnpm build # existing example-app extensionless-import failure
corepack pnpm test # existing three-test identityFingerprint expectation drift
git diff --check
```

## Add Request-Scoped Postgres Client Persistence

Previous completed checkpoint: `3155884` (`Define hosted executor proof
gates`).

What changed:

- Added a synchronous adapter for an already-connected `pg.Client`. It owns
  BEGIN/COMMIT/ROLLBACK on that one connection but never connects, ends,
  releases, migrates, discovers files, or creates a pool.
- Routed the existing PGlite and pooled Postgres adapters through the same
  runtime repository composer while retaining their migration and lifecycle
  wrappers. The ordinary lane passed 148 tests, and a disposable PostgreSQL 18
  cluster passed all 25 real-Postgres tests.
- Added a real-Postgres client case proving direct SQL, typed Drizzle execute,
  repository insert/read, shared authority provisioning, exact backend-PID
  reuse across a committed transaction, rollback with primary error identity,
  and successful queries afterward. The fixture—not the adapter—connects and
  ends the client.
- Added compile-time and runtime assertions that the connected-client result
  has no `client`, `drizzle`, `pool`, `migrate`, `connect`, `end`, or `close`
  surface. Shared authority is composed from a separate client-taking helper.
- Preserved callback/domain and COMMIT failures when a secondary rollback also
  fails, with deterministic unit tests for both precedence paths. The pooled
  adapter records that secondary failure when releasing the poisoned client.

Why it changed:

Existing PostgreSQL evidence used `pg.Pool`, and the PGlite lane could not prove
the concrete Worker database driver. H02 establishes the exact persistence
object H03 can create inside each Fetch invocation without broadening the
executor protocol or moving connection lifecycle into the framework-neutral
core.

Convex references inspected:

- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`
- `crates/isolate/src/environment/udf/syscall.rs`

How Flarex differs:

- Convex owns transaction construction inside one hosted backend. Flarex's
  private Worker will receive a Hyperdrive connection string per invocation,
  construct one client, and inject this adapter into the same trusted executor
  core while the untrusted Dynamic Worker sees only serialized syscalls.

Known limitations:

- This is H02, not a Worker/Hyperdrive proof. No Fetch handler, Wrangler bundle,
  capability-token gate, request cleanup, service binding, or hosted resource
  exists yet.
- Only shared-database authority composition is exposed on the client subpath.
  Split-locator runtime resolution remains explicitly outside this goal.
- H03 must prove the Worker bundle excludes `/postgres`, `/pglite`, Drizzle
  migrators, and filesystem path/URL helpers. H04 and H05 still own local named
  service-binding and hosted Hyperdrive receipts respectively.
- The workspace build completed the changed package and every other library,
  then retained the existing example-only failure: Vite cannot resolve the
  extensionless `../http` import from
  `packages/flarex-backend/src/artifactRuntime/RouteBoundary.ts`.
- The workspace test reached and passed the changed persistence package (148
  ordinary tests), then failed in three untouched `flarex-backend` delivery
  decoder expectations. The decoded values now include the committed
  `identityFingerprint` field, while
  `connectionRequests.test.ts`, `liveQueryDelivery.test.ts`, and
  `publicLiveQueryDeliveryRouteBoundary.test.ts` still expect the older shape.
  This existing backend expectation drift is outside H02.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres test:postgres
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm typecheck
corepack pnpm check:effect-boundaries
corepack pnpm build # existing example-only module-resolution failure
corepack pnpm test # existing three-test identityFingerprint expectation drift
git diff --check
```

## Freeze Local And Hosted Executor Proof Evidence

Previous completed checkpoint: `0f4874d` (`Complete split scope authority
reconciliation`).

What changed:

- Defined H02 through H05 as the only work allowed inside the pre-S02-D host
  proof and kept the existing schema, authority, executor protocol, and legacy
  OCC semantics unchanged.
- Made H04 use the emitted H03 Worker bundle in one named multi-Worker workerd
  graph. A probe caller binds `FLAREX_EXECUTOR` by service name; only the
  executor receives the local Hyperdrive binding and executor capability
  secret. Function-valued service-binding fakes do not satisfy this gate.
- Required the H04 real-PostgreSQL case to migrate and seed outside the Worker,
  then drive authenticated `/invoke/start`, `/invoke/syscall`,
  `/invoke/finish`, and error/abort paths through the named binding. Two stale
  sessions must produce one committed winner and one OCC conflict; a fresh
  attempt must reread and converge, and Node-side assertions must verify the
  final authoritative row/session state.
- Required request-lifecycle tests for success, primary failure, connect
  failure, and cleanup failure. Cleanup is attempted in `finally`; a cleanup
  error is reported only when no primary error already exists.
- Reserved H05 for a hosted staging receipt that proves the bound Hyperdrive
  resource is cache-disabled and that the executor is unreachable through a
  public Worker URL while the same transaction/OCC case succeeds through its
  caller's service binding.

Why it changed:

The real-Postgres suites currently prove the executor through Node-owned
`pg.Pool`, while Worker service-binding tests use callbacks/fakes. Both are
valuable but neither proves the new boundary. The two-tier gate prevents the
local direct-connection lane from being mistaken for deployed Hyperdrive
correctness.

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
- `crates/function_runner/src/lib.rs`
- `crates/isolate/src/environment/udf/syscall.rs`

How Flarex differs:

- Convex's application runner receives transaction state directly from its
  function runner. Flarex serializes restricted syscalls over private Fetch,
  persists the session between requests, and commits only in the trusted
  executor Worker.

Known limitations:

- H04 may be skipped without `FLAREX_POSTGRES_DATABASE_URL`, but it cannot be
  marked complete from unit/PGlite evidence. H05 additionally needs Cloudflare
  credentials and a staging database/Hyperdrive resource.
- Local `localConnectionString` evidence bypasses Hyperdrive pooling and query
  caching. It proves workerd compatibility and real SQL only.
- No hosted parity claim includes live-query delivery or split-locator runtime
  resolution in this proof. Those remain later explicit composition work.

Verification:

```sh
corepack pnpm --filter @flarex/backend exec wrangler hyperdrive get --help
corepack pnpm --filter @flarex/backend exec wrangler deploy --help
rg -n "invoke/start|invoke/syscall|invoke/finish|OCC|conflict|retry" packages/executor-http packages/executor/test packages/persistence-postgres/test apps
git diff --check
```

## Add The Host-Neutral Split Authority Reconciler

Previous completed checkpoint: `b320ab2` Add split scope provisioning
receipts.

What changed:

- Added node-postgres and PGlite factories for one framework-neutral split
  authority coordinator and a narrow located clock target.
- Implemented fresh control reservation, persisted-intent replay, exact
  target-local initialization, final ready CAS, and current-clock validation
  after ready. Production executor/runtime wiring remains unchanged.
- Added 17 focused PGlite cases covering both locator kinds, invalid placement,
  replay after advanced authority, every injected failure window, legacy-state
  rejection, ID exhaustion, metadata drift, inexact target results, and
  concurrent reconciliation.
- Added two paired-store PostgreSQL cases for publish/replay/conflict and
  deterministic concurrent recovery. The ordinary PGlite and seven-file
  PostgreSQL lanes now run files serially to prevent independent
  migration-heavy fixtures from exhausting Vitest's five-second per-test
  budget; all 23 correctness-lane tests pass on PostgreSQL 18.

Why it changed:

The receipt alone was not ready authority. The executor foundation now has a
reusable two-store recovery kernel that production Worker composition can
adopt later without putting Node/Nitro transport assumptions into the core.

Convex references inspected:

- `crates/model/src/database_globals/mod.rs`
- `crates/application/src/lib.rs`
- `crates/database/src/database_index_workers/mod.rs`
- `crates/application/src/schema_worker/mod.rs`
- `crates/model/src/migrations.rs`

How Flarex differs:

- Convex runs initialization against its configured backend. Flarex's
  coordinator resolves an opaque persisted locator into another trusted SQL
  capability and uses durable recovery rather than a distributed transaction.

Known limitations:

- The dedicated private Cloudflare Worker, cache-disabled Hyperdrive adapter,
  bundle proof, and service-binding real-Postgres smoke remain prerequisites
  before S02-D production generation routing.
- `/invoke/*` Fetch and Nitro compatibility adapters are neither expanded nor
  retired. No allocator, OCC, compiler, sync, Payload, or Medusa behavior is
  part of this checkpoint.
- The broad workspace test produced no output and hit its bounded ten-minute
  timeout, matching the pre-existing workspace Vitest stall. The changed
  persistence lane completed 145 ordinary tests and 23 PostgreSQL tests.
- The workspace build completed the changed package and every other package,
  then retained the existing example-only failure: Vite cannot resolve the
  extensionless `../http` import from
  `packages/flarex-backend/src/artifactRuntime/RouteBoundary.ts`.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres test:postgres
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm typecheck
corepack pnpm check:effect-boundaries
corepack pnpm test # bounded timeout with no output
corepack pnpm build # existing example-only module-resolution failure
git diff --check
```

## Add Split Control Receipts Without Widening Executor Readiness

Previous completed checkpoint: `a4c290f` Fence executor deployment creation.

What changed:

- Added PostgreSQL/PGlite migration and repository primitives for durable
  split-scope reservation and exact readiness CAS in
  `@flarex/persistence-postgres` only.
- Added focused PGlite coverage and three isolated PostgreSQL 18 cases for
  concurrent reservation winner adoption, exact ready-CAS/locator locks, and
  recovery of a committed reserved receipt after external target failure. The
  complete real-Postgres persistence lane passes all 21 tests.
- Aligned the existing PostgreSQL 18 `ON DELETE RESTRICT` test with SQLSTATE
  `23001` while retaining `23503` for missing-parent foreign-key inserts.
- Left `withReadyDeploymentAuthority(...)`, executor persistence ports, local
  runtime composition, and shared C1 creation unchanged. A reserved split
  locator cannot be returned as executor-ready authority.

Why it changed:

The executor must eventually receive only fully reconciled located authority.
This checkpoint establishes durable control evidence first, without fabricating
a resolver or treating receipt persistence as target-clock readiness.

Convex references inspected:

- `crates/model/src/database_globals/mod.rs`
- `crates/application/src/lib.rs`
- `crates/database/src/database_index_workers/mod.rs`
- `crates/application/src/schema_worker/mod.rs`
- `crates/model/src/migrations.rs`

How Flarex differs:

- Convex initializes and publishes within one backend. Flarex's future Worker
  executor may locate another Postgres schema/database, so it needs a durable
  control receipt and later two-store recovery loop.

Known limitations:

- This is C3b1, not production split execution. C3b2 must supply the trusted
  resolver, exact target-clock initializer/verifier, failure-window recovery,
  and final ready projection. Worker/Hyperdrive composition remains separate.
- No HTTP executor bridge was restored, and no runtime generation routing,
  sequence allocation, OCC, compiler, sync, Payload, or Medusa work is present.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres test:postgres
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm typecheck
git diff --check
```

## Replace Bare Executor Creation With Shared Ready Authority

Previous completed checkpoint: `5f377e9` Add resumable scope authority
bootstrap.

What changed:

- Made `FlarexExecutorPersistence` require a ready-authority capability instead
  of raw deployment insertion, then delegated every executor ensure to that
  capability even when deployment metadata already exists.
- Added a composition facade over PGlite/node-postgres persistence and the C1
  provisioner. The facade strips the bare writer and maps C1's
  `createdDeployment` fact into an exact two-field runtime result without
  coupling executor logic to provisioning status, scope, or clock fields.
- Wired `createLocalPGliteExecutorHttpRuntime(...)` with a fixed default shared
  locator and an optional trusted override for supplied persistence.
- Added PGlite tests for direct creation, registration/activation, missing-clock
  fail-closed behavior, downstream side-effect fencing, and fresh C2 parity.
  Added PostgreSQL 18 tests for concurrent convergence and the complete
  cutover/parity sequence.
- Added a shared deployment-row lock for existing authority creation plus an
  exact-PID PostgreSQL contention test proving project mutation waits until
  scope/clock authority commits.

Why it changed:

The previous executor `ensureDeployment(...)` created a legacy metadata row
without locator/clock authority. That was the last executor-owned production
Postgres writer able to reopen C2's inventory gap.

Convex references inspected:

- `crates/model/src/lib.rs`
- `crates/model/src/database_globals/mod.rs`
- `crates/model/src/migrations.rs`
- `crates/database/src/database_index_workers/mod.rs`
- `crates/application/src/deploy_config.rs`

How Flarex differs:

- Convex performs idempotent system-table setup and deployment publication
  within its backend. Flarex has a narrow executor port and a separate
  topology-aware authority owner because Postgres may later be reached through
  Worker/Hyperdrive and split placement capabilities.

Known limitations:

- This closes current shared Postgres creation only. Hosted push still writes
  DeploymentDO state and has no Postgres executor deployment route; no
  cross-system atomicity is claimed.
- Split receipt schema, target preparation, target resolution, and monotonic
  `reserved -> ready` publication remain S02-C3b.
- The two existing integration files compile and reach their normal runtime
  assertions, but the focused integration command retains two unrelated stale
  expectations: one omits current query `readTs`, and one source fixture lacks
  exactly-one public/internal visibility.
- The executor package passes 152 tests with four PostgreSQL-gated tests
  skipped in the ordinary lane; all four pass against the temporary PostgreSQL
  18 correctness cluster. Persistence passes 115 tests with 17 environment
  gates skipped, its focused authority PostgreSQL file passes six tests, Nitro
  passes 16 tests, and the changed `flarex-dev` runtime file passes five tests.
- Workspace typecheck, Effect-boundary check, schema check, and every changed
  package build pass. The broad `flarex-dev` and workspace test commands retain
  a Vitest process without output and were stopped after bounded three- and
  five-minute timeouts. Workspace build reaches the unchanged example and
  fails on its existing extensionless `RouteBoundary.ts` import of `../http`.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor exec vitest run test/deployments.test.ts test/appDataBoundary.test.ts test/deploymentAuthority.test.ts test/liveQueries.test.ts
corepack pnpm --filter @flarex/executor exec vitest run test/deploymentAuthority.postgres.test.ts --reporter verbose
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/scopeAuthorityProvisioning.postgres.test.ts --reporter verbose
corepack pnpm --filter flarex-dev exec vitest run test/executorHttpRuntime.test.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/invoke.integration.test.ts integration/execution-artifact-postgres.integration.test.ts
git diff --check
```

## Add The Resumable Existing-Authority Bootstrap Lane

Previous completed checkpoint: `7793ed9` Add shared scope authority
provisioning.

What changed:

- Added framework-neutral C2 bootstrap composition over both PGlite and
  node-postgres Drizzle databases without adding an executor/runtime consumer.
- Added explicit `captureFrontier`, `runBatch`, and `verifyFrontier` operations.
  The cursor is deployment-ID-only, serializable, versioned by its frontier,
  primary-key indexed, and returned only after the full page succeeds.
- Added typed rejection for invalid limits, malformed frontiers, disappeared or
  replaced deployments, and immutable project/locator conflicts.
- Added bootstrap-only missing-clock repair with explicit `legacy_v1`, fence
  `1`, zero counters, and server epoch. Response-loss replay and concurrent
  repair preserve the persisted winner.
- Added sixteen PGlite cases and five focused PostgreSQL 18 cases covering
  paging, replay, rollback, late commits behind the cursor, concurrent
  provisioning/repair, fixed-locator conflicts, advanced-clock preservation,
  relational parity, and exact PID-scoped deployment-lock blocking.

Why it changed:

C1 supplied the atomic row-level primitive. C2 now makes it usable for existing
committed deployments while keeping migration progress restartable and proving
that missing and orphan authority cannot cancel in a simple count comparison.

Convex references inspected:

- `crates/model/src/lib.rs`
- `crates/model/src/database_globals/mod.rs`
- `crates/database/src/bootstrap_model/index_backfills/types.rs`
- `crates/database/src/database_index_workers/mod.rs`
- `crates/database/src/table_iteration.rs`
- `crates/model/src/migrations.rs`

How Flarex differs:

- Convex can persist repeatable snapshot identity with a backfill cursor. The
  Postgres bootstrap cannot resume an MVCC snapshot, so it captures a lexical
  frontier and verifies one relational snapshot after replayable batches.
- The result is point-in-time `complete_through_frontier`, not a production
  creation fence. C3 must wire future provisioning and rerun the final pass.

Known limitations:

- At the C2 checkpoint, executor `ensureDeployment` still created bare legacy
  deployment rows. C3a now closes that executor path; hosted rollout still
  requires the documented quiesce and final fresh parity rerun.
- Split topology provisioning, Worker-safe persistence, and runtime
  fail-closed generation resolution remain C3b/S02-D work.
- The focused C2 PostgreSQL file passes five of five. The combined PostgreSQL
  lane passes sixteen of seventeen with only the pre-existing PostgreSQL 18
  `23001` versus expected `23503` assertion in unchanged scope-catalog coverage.
- The package lane passes 115 tests with 17 environment-gated tests skipped;
  package build/schema check, workspace typecheck, both backend typecheck/build
  lanes, and the Effect-boundary check pass.
- Workspace test again times out in the unchanged `flarex-backend` Vitest lane
  without output. Workspace build passes the changed persistence package and
  fails later in the unchanged example Vite build on the extensionless
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

## Add The Shared-Database Scope Provisioner

Previous completed checkpoint: `05d10f5` Add the FlarexDB scope clock.

What changed:

- Added framework-neutral shared-database provisioning over concrete PGlite
  and node-postgres Drizzle transactions.
- Added production `scope_<uuid-v4>` and `epoch_<uuid-v4>` generation while
  keeping the general `ScopeId`/`ScopeEpoch` brands compatible with controlled
  imports and tests.
- Added typed idempotent outcomes and conflicts, bounded generated scope-ID
  collision retries, orphan-clock collision avoidance, fail-closed detection
  of existing scopes missing clocks, and immutable advanced-clock preservation.
- Added 13 PGlite cases plus five focused PostgreSQL 18 concurrency,
  response-loss, rollback, and conflict cases.

Why it changed:

The first S02-C slice establishes the exact per-deployment operation that a
later resumable bootstrap and future-creation integration can reuse. It remains
outside `/invoke/*` and storage-generation routing until the full S02-C
inventory and hosted Worker gates close.

Convex references inspected:

- `crates/model/src/lib.rs`
- `crates/model/src/database_globals/mod.rs`
- `crates/application/src/lib.rs`
- `crates/common/src/bootstrap_model/schema_state.rs`

How Flarex differs:

- Convex's initialization transaction does not resolve a control-plane
  physical locator. Flarex C1 deliberately supports only the current
  co-located shared database and defers readiness reconciliation across
  schemas/databases.

Known limitations:

- This is a factory on `/postgres` and `/pglite`, not a runtime executor port.
- Existing deployments are not scanned yet and current `ensureDeployment`
  still creates legacy deployment metadata without calling this primitive.
- Split topology provisioning, Worker-safe persistence, and runtime
  fail-closed resolution remain C3/S02-D work.
- The focused real-Postgres file passes; the full lane remains at the existing
  PostgreSQL 18 `23001` versus expected `23503` catalog assertion.
- Both backend packages typecheck and build. The unchanged broad
  `flarex-backend` test command again timed out after five minutes without
  output; its verified stale Vitest process tree was stopped.
- Workspace typecheck passes. Workspace build reaches the changed persistence
  package and fails later in the unchanged example Vite build on the existing
  extensionless `artifactRuntime/RouteBoundary.ts` import of `../http`.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/scopeAuthorityProvisioning.test.ts
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/scopeAuthorityProvisioning.postgres.test.ts --reporter verbose
corepack pnpm --filter @flarex/persistence-postgres test:postgres
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm build
git diff --check
```

## Add The Scope-Clock Read And Lock Proof

Previous completed checkpoint: `7b18427` Target the Cloudflare executor
Worker.

What changed:

- Added branded positive storage-generation fences and the seven-column
  `fx_system_scope_clock` Drizzle schema with true bigint counters.
- Generated additive migration `0018_sleepy_jimmy_woo.sql`; it contains no
  backfill, control-plane foreign key, generation default, retention floor, or
  allocator.
- Added validated clock decoding and a root persistence read to both PGlite and
  node-postgres. Unsupported generations, nonpositive fences, negative
  counters, blank epochs, and invalid timestamps fail as typed corruption.
- Added a package-internal, transaction-typed `SELECT ... FOR UPDATE` helper
  for explicit transaction tests only; the ordinary database handle fails a
  compile-time assignability assertion.
- Added fresh/repeated migration inventory, a pinned through-0017 upgrade
  fixture proving existing scopes receive no clock, exact bigint and SQL
  constraint coverage, PGlite rollback proof, and a real-Postgres blocking
  test.

Why it changed:

The trusted executor will eventually derive exact snapshots and commit
authority from this row. S02-B establishes storage and locking behavior first
while preventing any caller from advancing a counter before OCC, outcome,
commit/change, and outbox publication can be atomic.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/database/src/write_log.rs`
- `crates/common/src/persistence.rs`
- `crates/common/src/types/timestamp.rs`
- `crates/postgres/src/lib.rs`
- `crates/postgres/src/sql.rs`

How Flarex differs:

- Convex's leader committer assigns unique, non-dense timestamps and tracks
  pending writes in memory. Flarex persists one scope-local clock because
  Cloudflare executor Workers are distributed and the planned sync feed needs
  dense sequences with rollback consuming nothing.
- Convex uses one nominal Postgres instance and an instance lease. Flarex's
  data-plane clock has no control-plane FK so database-per-scope placement
  remains possible.

Known limitations:

- Existing scopes have no clock until S02-C backfills them. Missing reads still
  return `null`; S02-D owns fail-closed runtime resolution.
- There is no production epoch format, allocator, counter update, generation
  switch, rollover, stale-fence validator, retained-history floor, or runtime
  consumer.
- PGlite proves rollback but not concurrent lock exclusion. The focused
  PID-scoped blocking test passed against an isolated PostgreSQL 18 cluster,
  proving same-scope exclusion, independent-scope progress, and visibility of
  the original clock after rollback. The broader seven-test Postgres lane ran
  six tests successfully; its unchanged catalog test expects SQLSTATE `23503`
  while PostgreSQL 18 returns `23001` for `ON DELETE RESTRICT`.
- The Worker/Hyperdrive host remains a separate proof required before S02-D;
  this checkpoint is host-neutral.
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
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Target A Dedicated Cloudflare Executor Worker

Previous completed checkpoint: `b581f1a` Add the FlarexDB scope locator.

What changed:

- Made a dedicated private `flarex-executor` Cloudflare Worker the hosted
  production target for the existing framework-neutral executor core and the
  future FlarexDB commit compiler.
- Kept the generated `/invoke/start`, `/invoke/syscall`, `/invoke/finish`, and
  `/invoke/abort` Fetch protocol as the first internal service-binding
  transport. It is no longer a public Cloudflare-to-Nitro/Vercel bridge.
- Made cache-disabled Hyperdrive mandatory for authoritative snapshot, OCC,
  lock, idempotency, and commit reads. The Worker adapter will use a
  request-scoped `pg.Client` and will not retain the current Node-style pool.
- Kept migrations and unbounded maintenance outside Worker request handling.
  PGlite stays local/test; Nitro/Vercel becomes an optional compatibility host.
- Preserved all older Nitro/Vercel entries below as implementation history;
  they no longer control the forward hosted topology.

Why it changed:

The accepted FlarexDB design places sandboxed execution and coordination on
Cloudflare while keeping Postgres authoritative. Cloudflare now supports the
required `pg`/Drizzle path through Hyperdrive, so a separate Node deployment is
no longer required. The isolate-to-executor boundary must remain because
developer code cannot receive database or transaction authority.

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
- `crates/function_runner/src/lib.rs`
- `crates/isolate/src/environment/udf/syscall.rs`

How Flarex differs:

- Convex colocates its trusted function runner, transaction state, and database
  backend. Flarex runs developer code in a Cloudflare Dynamic Worker and
  therefore keeps an explicit private syscall boundary to a trusted executor
  Worker.
- The first Flarex transport remains Web-standard Fetch because generated
  workers and compatibility tests already implement it. Workers RPC is a
  possible later transport migration, not a database semantic.

Known limitations:

- No deployable `apps/executor` Worker or Worker-safe Hyperdrive persistence
  adapter exists yet. Existing Wrangler configs reference `flarex-executor`,
  but the target app is still missing.
- `packages/persistence-postgres/src/postgres.ts` still combines a `pg.Pool`,
  runtime persistence, and filesystem-oriented migration setup. The Worker
  spike must split those responsibilities without rewriting executor core.
- This decision does not claim hosted parity. Wrangler bundle/workerd checks,
  cache-disabled Hyperdrive, request cleanup, placement, and real-Postgres OCC
  tests remain required before S02-D production routing.
- S02-B remains the next implementation checkpoint because its scope-clock
  row and private lock/rollback proof are host-neutral.

Verification:

```sh
rg -n "Nitro|Vercel|FLAREX_EXECUTOR|Hyperdrive|S02-D" AGENTS.md design-notes roadmaps apps packages
git diff --check
```

## Add The Scope Locator Repository And Migration

Previous completed checkpoint: `7f4ce29` Resolve trusted app-data generation.

What changed:

- Added typed insert, get-by-scope, get-by-deployment, and exact scope-ID
  cursor-list repositories for `fx_control_scope` to both PGlite and
  node-postgres persistence adapters. Page limits must be integers from 1 to
  1000.
- Reused the protocol `ScopeId` brand, derived `isolation_kind` from the
  discriminated locator input, and decoded unknown JSON rows back into a
  correlated locator record. Duplicate scope/deployment ownership is a typed
  domain failure; an invalid persisted locator is a typed corruption failure.
- Generated additive migration `0017_wooden_morlun.sql`. Its deployment
  foreign key is intentionally search-path relative so existing isolated
  Postgres schemas and the temporary real-Postgres harness reference the same
  migrated `deployments` table.
- Added fresh-install/repeat migration inventory coverage, a pinned
  through-0016 upgrade harness proving legacy deployments survive without
  implicit scope backfill, PGlite repository/constraint/corruption coverage,
  and an environment-gated real-Postgres SQLSTATE/constraint test.
- Aligned repository input checks, row decoding, and database constraints on
  the ECMAScript whitespace set so a rejected value cannot commit a row and
  claim the deployment mapping before decode fails.

Why it changed:

The first S02 checkpoint needs a small trusted persistence API that can later
bootstrap and resolve locations. Wiring the scope clock or executor routing in
the same change would make rollback and authority failures difficult to isolate.

Convex references inspected:

- `crates/common/src/types/mod.rs`
- `crates/postgres/src/lib.rs`
- `crates/postgres/src/sql.rs`
- `crates/common/src/bootstrap_model/schema_state.rs`

How Flarex differs:

- Convex's Postgres persistence object is constructed with one nominal
  `PgInstanceName`. Flarex persists the deployment-to-scope/topology mapping
  first because later requests may route across shared, schema-per-scope, and
  database-per-scope targets.
- The repository exposes no locator update, active-schema update, generation
  update, or raw database handle. Those authority transitions belong to later
  fenced workflows.

Known limitations:

- No scope rows are generated or backfilled, and the executor still uses the
  S01 deployment-ID compatibility alias.
- No clock, generation, fence, epoch, counters, OCC, commit compiler, Payload,
  Medusa, sync, or public API behavior is present.
- The real-Postgres constraint lane is implemented but skipped when
  `FLAREX_POSTGRES_DATABASE_URL` is unset; it was unset for this checkpoint.
- Workspace typecheck passes. Workspace test remains blocked outside this diff
  by three `flarex-backend` expectations that omit the decoded
  `identityFingerprint` field (729 backend tests pass), and workspace build
  remains blocked outside this diff by the existing extensionless `../http`
  import in `artifactRuntime/RouteBoundary.ts` during the example Vite bundle.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm check:effect-boundaries
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Resolve App-Data Generation From Persisted Session State

Previous completed checkpoint: `969c174` Isolate the legacy app-data engine.

What changed:

- Replaced direct legacy-engine injection into syscall, finish, retry, and
  invoke-backed live-query orchestration with one internal legacy-only registry.
- After `requireActiveSession` validates persisted ownership and active state,
  syscall and finish derive storage authority from that record and resolve one
  engine for the complete operation.
- Preserved the retry loop, attempt count, abort path, OCC classification,
  commit transaction wrapper, invalidation hook, and public invoke contracts.
- Added regression coverage proving caller body/header fields cannot select a
  generation and project mismatch fails before resolution.

Why it changed:

Generation routing must be a trusted executor decision, not a property of the
Dynamic Worker request. The persisted session is the earliest server-owned
context common to point reads, staged writes, query finish, and mutation commit,
so it is the narrow S01-C authority source.

Convex references inspected:

- `crates/database/src/database.rs`
- `crates/database/src/transaction.rs`
- `crates/application/src/application_function_runner/mod.rs`
- `crates/database/src/committer.rs`

How Flarex differs:

- Convex's database creates and retains the authoritative transaction snapshot
  inside one trusted backend. Flarex persists invoke-session state because user
  execution crosses a network/runtime boundary.
- Flarex's legacy-only resolver is a compatibility mechanism, not a claim that
  generation is permanently stored on invoke-session or deployment metadata.

Known limitations:

- Missing deployment/session metadata retains its current typed failure and
  never defaults to legacy. S02 later bootstraps scope-clock rows and makes
  missing generation/fence metadata fail closed.
- `AppDataStorageGenerationUnavailableError` is terminal and is not classified
  as an OCC retry. It is currently unreachable through production inputs because
  only `legacy_v1` can be derived.
- No retry lifecycle, snapshot, OCC, compiler, sync, or public endpoint behavior
  changed in this checkpoint.

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

## Route App Data Through The Legacy V1 Engine

Previous completed checkpoint: `9de97f1` Define FlarexDB storage authority
contracts.

What changed:

- Constructed one `legacy_v1` app-data adapter inside `createFlarexExecutor`;
  callers cannot inject or select an engine.
- Threaded that adapter through syscall snapshot/overlay operations, query and
  mutation finish, the existing retry coordinator, and invoke-backed live-query
  reruns.
- Restricted all downstream orchestration to a control persistence port that
  cannot compile a direct call to any of the twelve legacy app-data methods.
- Left begin/abort session metadata, deployment/package lookup, maintenance,
  outbox delivery, live-query registry/delivery, and post-commit invalidation
  behavior on their existing owners.
- Preserved the existing Postgres/PGlite transaction wrappers around
  `commitInvokeSessionWrites` instead of calling its raw implementation.

Why it changed:

S01 needs a single compatibility seam before trusted per-scope generation
resolution can be wired. Selecting one adapter and reusing it across retries
also prevents future OCC attempts from silently changing storage generation.

Convex references inspected:

- `crates/database/src/transaction.rs`
- `crates/database/src/reads.rs`
- `crates/database/src/committer.rs`

How Flarex differs:

- Flarex currently stages invoke reads/writes in Postgres and uses wall-clock
  timestamps. Those semantics remain intact only inside the named legacy
  adapter while the exact-snapshot engine is built beside it.
- Cloudflare/Nitro/public invoke contracts remain unchanged; this is internal
  dependency routing only.

Known limitations:

- `storageGeneration` is an implementation tag, not trusted scope authority.
- S01-C still must resolve only server-derived scope context to this adapter and
  fail closed for any unavailable `flarexdb_v1` selection.

Verification:

```sh
corepack pnpm --filter flarex-protocol exec vitest run test/storage-authority.test.ts
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/legacyV1AppDataEngine.test.ts test/pglite.test.ts
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

## Establish The FlarexDB Storage Authority Vocabulary

Previous completed checkpoint: `cdb1e52` Plan FlarexDB foundation turns.

What changed:

- Added shared schema-derived brands for scope, epoch, commit sequence, outbox
  sequence, storage generation, and snapshot token.
- Made the token shape strict and made sequence serialization lossless and
  canonical before introducing any generation-aware engine behavior.
- Kept this checkpoint contract-only: executor routes, invoke sessions,
  persistence repositories, SQL, and production generation routing are
  unchanged.

Why it changed:

The executor cannot safely wrap legacy behavior or pin a trusted generation if
each layer represents scope and snapshot identity with unrelated strings and
numbers. This creates the common vocabulary without prematurely routing data.

Convex references inspected:

- `crates/common/src/types/timestamp.rs`
- `crates/convex/sync_types/src/timestamp.rs`
- `crates/value/src/document_id.rs`

How Flarex differs:

- Flarex serializes nonnegative sequences as strings and decodes them to
  branded `bigint` because its trusted path crosses TypeScript package and
  runtime boundaries.
- Scope epoch and storage generation are explicit Flarex fencing concepts for
  the Postgres/Cloudflare split and are not selectable by callers.

Known limitations:

- The `legacy_v1` adapter and trusted resolver are still absent, so this commit
  intentionally has no behavioral integration.
- `flarexdb_v1` is only a decoded name; no production path can route to it.

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

## Add The Interleaved FlarexDB Foundation Roadmap

Previous completed checkpoint: `478be74` Correct FlarexDB transaction and sync
design.

What changed:

- Added [`flarexdb-foundation/README.md`](./flarexdb-foundation/README.md) as the
  master turn order for the schema, OCC, and compiler plans.
- Kept stable SDK, deployment, analysis, protocol, HTTP/Nitro, Postgres/PGlite,
  and test infrastructure while placing the new correctness kernel beside the
  legacy generation behind narrow ports.
- Required one vertical point-CRUD proof before sidecars, migration cutover,
  SessionDO journal movement, Payload, Medusa, sync replacement, or cache work.

Why it changed:

Sequentially completing a large schema or mutating the all-in-one legacy commit
path would hide integration failures. The new order interleaves immutable
storage facts, exact OCC, pure planning, and one atomic publication path.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/database/src/transaction.rs`
- `crates/database/src/reads.rs`
- `crates/model/src/session_requests/types.rs`
- `crates/application/src/application_function_runner/mod.rs`

How Flarex differs:

- The trusted executor pins scope/generation and exposes stable remote
  `/invoke/*` boundaries; a future SessionDO is a journal optimization, while
  Postgres remains the only committed authority.

Known limitations:

- The new narrow ports, physical generation, compiler, migration router, and
  real-Postgres correctness proof remain unimplemented.

Verification:

```sh
git diff --check
```

## Correct FlarexDB Commit And Adapter Boundaries

Previous completed checkpoint: `01c11ab` Clarify SessionDO cache read bridge.

What changed:

- Corrected the focused commit-compiler roadmap so a SessionDO journal is a
  bounded app-data optimization, not the authority for scope, schema, locks,
  constraints, freshness, outbox, Payload, or Medusa.
- Standardized the transaction snapshot on
  `(scope_id, epoch, commit_seq)` instead of wall-clock `beginTs`.
- Kept a small Postgres session/grant anchor for fencing, authority, snapshot
  retention, idempotent finish, and uncertain-outcome recovery.
- Separated generic Flarex app OCC, Payload adapter transactions, and
  Medusa-owned trusted Postgres transactions.
- Required physical sidecars, change atoms, system outbox, and result-bearing
  idempotency to be derived and written by the trusted executor.

Why it changed:

The earlier design let a logical commit intent describe physical/system work,
treated a newer cache value as valid for an older mutation snapshot, and used a
Postgres fallback for query overlays that Postgres cannot see. It also implied
that full Payload and Medusa transactions could use the generic journal before
their read-your-writes and repository contracts were proven.

Convex references:

- `crates/database/src/committer.rs`
  - read validation and ordered publication remain backend authority.
- `crates/database/src/transaction.rs`
  - read-your-writes is transaction semantics, not a conservative dependency.
- `crates/application/src/application_function_runner/mod.rs`
  - durable session-request outcome checks and result replay.
- `crates/model/src/session_requests/types.rs`
  - result-bearing session request state.

How Flarex differs:

- Flarex crosses Dynamic Worker, Durable Object, and Postgres boundaries, so it
  requires an explicit protocol version, attempt fence, journal digest,
  authoritative grant, and lost-response lookup.
- Payload and Medusa preserve their own adapter transaction boundaries while
  participating in the same scope-local commit/change/outbox protocol.

Known limitations:

- Current code still uses Postgres invoke-session staging and wall-clock
  `beginTs`; this checkpoint corrects the target design only.
- Exact index/range/relation overlays and conflict checks remain unproven.
- The per-scope commit lane is safe but needs real Postgres throughput and
  deadlock/serialization tests.

Verification:

```sh
git diff --check
```

## Superseded Commit Compiler And Session Intent Direction

Previous completed checkpoint: `523a006` Refactor FlarexDB schema to enhance
app data storage and indexing.

What changed:

- Added the focused design record
  [35-commit-compiler-and-session-intent.md](./35-commit-compiler-and-session-intent.md).
- Recorded the historical executor direction: user-code execution should keep
  read-set and staged-write intent in SessionDO/ExecutionDO SQLite where
  possible, then send a compact `CommitIntent` to Postgres for final
  OCC validation and publication.
- Preserved Postgres/PGlite as the authoritative source for committed data,
  read validation, commit timestamps, commit log, freshness, and outbox rows.

Why it changed:

The current Postgres executor path is a correctness foundation, but staging
read-set and write-set rows in Postgres during user-code execution creates
avoidable round trips. The optimized design keeps authoritative reads in
Postgres, records temporary invocation intent near the Dynamic Worker in Durable
Object SQLite, then opens a short Postgres transaction only for final
set-based validation and bulk publication.

Convex references:

- `crates/database/src/committer.rs`
  - final read validation, write computation, and commit publication.
- `crates/database/src/transaction.rs`
  - transaction-local read/write state and read-your-writes behavior.
- `crates/sync/src/worker.rs`
  - committed write metadata drives subscription invalidation.

How Flarex differs:

- Convex can keep user execution and transaction state close to its Rust
  backend. Flarex splits Dynamic Worker execution, SessionDO intent, and
  Postgres authority across Cloudflare/runtime boundaries.
- Durable Object SQLite may own temporary session intent, but it must not become
  a second authoritative data store.
- KV is not acceptable for correctness-critical mutation intent.

Known limitations:

- No implementation exists yet for a general `CommitIntent`/`CommitPlan`
  compiler.
- Overlay-aware query behavior is straightforward for `get(id)` but still needs
  precise design for indexes, relations, Medusa filters, Payload nested fields,
  and table scans.
- Real Postgres validation remains required for lock ordering, isolation,
  deadlock, and production query-plan behavior.

Verification:

```sh
git diff --check
```

## Live Query Callback Protocol Contracts

Previous completed checkpoint: `b3badab` Decide executor HTTP adapter
direction.

What changed:

- Added shared `flarex-protocol/live-query` Effect decoders for the backend
  callback payloads produced by executor HTTP live-query helper code:
  delivery fanout bodies and DeliveryDO wake bodies.
- Kept `@flarex/executor-http` callback POST behavior unchanged.
- Switched backend callback route payload validation to the shared protocol
  decoder module.

Why it changed:

The executor HTTP adapter posts live-query callback transport bodies into the
backend Worker/DO sync routes. C-1a gives those callback payloads a protocol
home before the next protocol cleanup slices move more migrated route contracts
out of backend-local modules.

Convex references:

- `crates/convex/sync_types/src/types/mod.rs` for shared sync transport types.
- `crates/convex/sync_types/src/types/json.rs` for sync JSON conversion.
- `crates/local_backend/src/router.rs` for keeping HTTP route wiring outside
  transport type definitions.

How Flarex differs:

- Convex sync transport is primarily websocket protocol state. Flarex's
  Postgres/executor lane still uses backend HTTP callbacks for live-query
  delivery and wake coordination, so the protocol contract starts with those
  callback bodies.

Known limitations:

- Executor HTTP callback helpers still construct JSON bodies directly.
- C-1 remains open for scheduler, connection, partition, artifact runtime, and
  executor HTTP body contract exports.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-protocol exec vitest run test/live-query.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend exec vitest run test/liveQueryDelivery.test.ts test/publicLiveQueryDeliveryRouteBoundary.test.ts test/deliveryRouteBoundary.test.ts test/publicDeliveryWakeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
```

## Executor HTTP Elysia Adapter Decision

Previous completed checkpoint: `72127aa` Centralize executor live query helper
bridge.

What changed:

- Audited `@flarex/executor-http` after E-1, E-2, and E-3 to decide whether
  Elysia should be replaced before protocol cleanup begins.
- Kept Elysia as the current adapter and made the next checkpoint C-1:
  exporting shared Effect decoders from `flarex-protocol`.
- Recorded the replacement trigger: revisit Elysia only after protocol
  contracts or generated route definitions prove the adapter is blocking the
  target schema-first shape.

Why it changed:

The executor HTTP migration has already moved the correctness-sensitive pieces
below Elysia. `routes.ts` registers paths and adapter-only method/not-found
responses. `routeEffects.ts` runs one `Effect.runPromise(...)` route boundary,
authorizes before JSON parsing, decodes bodies through typed Effect decoders,
and maps route failures once through `executorHttpRouteErrorBody(...)`.
`liveQueryDelivery.ts` now keeps backend callback helper failures typed until a
single Promise compatibility edge. Replacing Elysia now would be a router
mechanics diff rather than an Effect migration step.

Convex references:

- `crates/local_backend/src/router.rs` for route registration as adapter
  composition around focused handlers.
- `crates/local_backend/src/public_api.rs` for HTTP extractors, request
  structs, parse helpers, and response conversion staying at the HTTP boundary.
- `crates/application/src/application_function_runner/http_routing.rs` for
  keeping HTTP action routing separate from execution behavior.

How Flarex differs:

- Convex uses Rust Axum and Serde; Flarex uses TypeScript, Elysia, and Effect.
  The equivalent boundary is not "same router library", it is keeping the HTTP
  adapter thin while transport contracts and executor behavior stay outside the
  router implementation.

Known limitations:

- Elysia remains a dependency of `@flarex/executor-http`.
- The route table still manually lists non-POST 405 responses and the catch-all
  404 body.
- The next real migration pressure is shared protocol decoding and hoisted
  schema compiler ownership, not router replacement.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http test -- --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http build
git diff --check
```

## Executor HTTP Live Query Helper Runtime Bridge

Previous completed checkpoint: `9c25517` Type executor HTTP body validation.

What changed:

- Centralized the promise compatibility bridge for backend live-query helper
  wrappers in `runFlarexBackendLiveQueryPromise(...)`.
- Replaced three wrapper-local `Effect.runPromise(...)` calls with the shared
  adapter edge while preserving compatibility error mapping.
- Made the backend live-query POST context an explicit local type and routed
  delivery, wake, and trigger Effect entrypoints directly through the named
  `postFlarexBackendLiveQueryEffect(...)`.

Why it changed:

E-3 keeps `liveQueryDelivery.ts` on the same migration path as the executor
HTTP route adapter: reusable helpers expose typed Effect errors, and
Promise-returning compatibility functions cross one adapter edge. Fetch
failures and non-OK backend responses remain typed until that edge.

Convex references:

- `crates/local_backend/src/router.rs` for keeping HTTP route/callback adapter
  concerns separate from backend behavior.
- `crates/convex/sync_types/src/types/mod.rs` and
  `crates/convex/sync_types/src/types/json.rs` for typed sync message and JSON
  conversion boundaries.
- `npm-packages/convex/src/browser/sync/protocol.ts` for TypeScript-side sync
  wire message typing.

How Flarex differs:

- Convex owns a canonical sync protocol and hosted routing stack. Flarex uses
  backend Worker/DO HTTP callback routes for delivery fanout, wake, and trigger
  notifications, so this package keeps those callbacks as executor HTTP helper
  adapters with typed Effect failures.

Known limitations:

- The helper still accepts arbitrary backend response text for non-OK response
  bodies to preserve current compatibility messages.
- This checkpoint does not change executor HTTP route body decoders, Elysia
  route registration, backend Worker/DO callback routes, or live-query
  scheduling behavior.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts -t "backend live query|live query delivery callbacks|live query trigger notifications|compatibility wrapper fetch rejection|fails live query" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http test -- --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http build
git diff --check
```

## Executor HTTP Body Validation Effects

Previous completed checkpoint: `91c0d67` Split executor HTTP adapter modules.

What changed:

- Executor HTTP exported body decoders now call per-route Effect validation
  functions directly instead of sharing one generic parse-result adapter.
- Body validation failures are emitted as tagged
  `ExecutorHttpBodyValidationError` values at each route body decoder boundary.
- Narrow HTTP-only body types were added for live-query rerun and delivery
  maintenance routes because route configuration supplies `freshnessStore`,
  `runQuery`, and `deliver` after body validation.
- Private `*Result` helpers remain only as a compatibility layer for preserving
  exact legacy `bad_request` messages during this checkpoint.

Why it changed:

E-2 moves executor HTTP route body decoding closer to the backend Effect
boundary pattern: reusable route decoders return Effects, and adapter response
mapping sees tagged validation errors instead of raw parse-result values.
Preserving existing bad-request bodies keeps the E-1 route split behavior
locked while the validation internals move toward Effect.

Convex references:

- `crates/local_backend/src/public_api.rs` for deserialized public API request
  structs and bad-request conversion at the HTTP boundary.
- `crates/local_backend/src/args_structs.rs` for request body structs that keep
  function-call payload shape separate from execution behavior.
- `crates/local_backend/src/parse.rs` for small parse helpers that convert
  invalid identifiers into bad-request metadata.

How Flarex differs:

- Convex relies on Rust/Serde request extraction and `ErrorMetadata` for bad
  requests. Flarex's TypeScript executor adapter keeps Elysia and manual JSON
  body validation for now, but route-facing validation now returns typed Effect
  failures.

Known limitations:

- The compatibility `*Result` helpers still assemble exact legacy messages; E-2
  does not yet replace every field-level helper with Effect Schema.
- `liveQueryDelivery.ts` remains unchanged until E-3.
- Public route paths, status codes, response bodies, authorization behavior,
  and executor method calls are unchanged.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http test -- --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http build
git diff --check
```

## Executor HTTP Adapter Module Split

Previous completed checkpoint: `63d9429` Type scheduler connection JSON
bridges.

What changed:

- Split `packages/executor-http/src/index.ts` into focused adapter modules:
  `config.ts`, `routes.ts`, `routeEffects.ts`, `requestDecoders.ts`,
  `responses.ts`, and `errors.ts`.
- Kept `index.ts` as the package public barrel, preserving existing exports for
  `createFlarexHttpApp(...)`, `createFlarexHttpHandler(...)`, body decoders,
  error classes, and backend live-query helpers.
- Kept Elysia route registration in `routes.ts`.
- Kept request JSON/body parsing and parse-result compatibility validators in
  `requestDecoders.ts`.
- Kept route Effect orchestration, authorization, preflight configuration, and
  executor method calls in `routeEffects.ts`.
- Kept executor error-to-HTTP response mapping in `responses.ts`.

Why it changed:

E-1 locks the executor HTTP adapter shape before replacing the remaining local
parse-result validators in E-2. The public Elysia routes and response bodies
stay unchanged, but route registration, request decoding, route effects, error
mapping, and response helpers are now separated enough to migrate each concern
without another giant `index.ts` diff.

Convex references:

- `crates/local_backend/src/router.rs` for keeping HTTP route registration thin
  and delegating route handlers to focused modules.
- `crates/application/src/api.rs` for the `ApplicationApi` trait boundary that
  keeps HTTP routes separate from execution/application behavior.
- `crates/application/src/application_function_runner/http_routing.rs` for
  routing HTTP action requests separately from the function-runner execution
  path.

How Flarex differs:

- Convex uses Rust `axum` routers and an `ApplicationApi` trait boundary.
  Flarex's executor adapter uses Elysia, Effect route effects, and an injected
  `FlarexExecutor`, so this checkpoint keeps Elysia as the adapter and only
  separates TypeScript module ownership.

Known limitations:

- E-1 intentionally does not replace parse-result validators with Effect
  Schema contracts; that remains E-2.
- E-1 does not change `liveQueryDelivery.ts`; typed fetch/response bridges for
  that helper remain E-3.
- No public route paths, status codes, response bodies, authorization behavior,
  or executor method calls are intended to change in this slice.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http build
```

## Executor HTTP Authorization Route Effect Boundary

Previous completed checkpoint: `b40230e` Type partition route dispatch
boundary.

What changed:

- Executor HTTP capability authorization now runs inside
  `Effect.fn("ExecutorHttp.routeDecodedBody")`.
- Unauthorized requests fail through typed `ExecutorHttpUnauthorizedError`
  values before JSON parsing or route preflight checks.
- Live-query rerun and delivery maintenance configuration checks now run as
  typed route preflight failures before body parsing, preserving their existing
  `501 not_implemented` responses when authorized.
- The shared executor HTTP route adapter now owns authorization, optional
  route preflight, JSON reading, body decoding, executor operation execution,
  and adapter-edge response mapping.

Why it changed:

Executor HTTP already had typed body decoders and operation errors, but
capability authorization still happened imperatively before the Effect route
pipeline. Moving it into the same named route boundary makes the adapter shape
more consistent without replacing Elysia or changing executor semantics.

Preserved behavior:

- Authorization still happens before malformed JSON parsing.
- Live-query rerun/delivery not-configured responses still happen before body
  parsing for authorized requests.
- Malformed JSON `400`, body validation `400`, executor error mappings, route
  paths, Elysia app shape, backend live-query callback helpers, protocol
  schemas, and `ValidatorJson` are unchanged.
- Backend Worker/DO routes, PartitionDO SQL/OCC, SchedulerDO, DeliveryDO,
  ConnectionDO, and DeploymentDO are unchanged.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
node ./node_modules/vitest/vitest.mjs run packages/executor-http/test/http.test.ts -t "requires the configured capability token for invoke routes|rejects unauthorized invoke requests before parsing malformed JSON|rejects unauthorized live query maintenance before config and body parsing|requires live query rerun maintenance configuration|validates live query rerun maintenance requests before calling the executor|requires live query delivery maintenance configuration|validates live query delivery maintenance requests before calling the executor|maps live query rerun maintenance requests to the executor core|maps live query delivery maintenance requests to the executor core" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http test -- --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Executor HTTP Backend Live Query Integration Boundary

Previous completed checkpoint: `6250aa2 Type artifact runtime route edge`.

What changed:

- Backend live-query delivery, wake, and trigger helper calls now have
  Effect-returning integration functions.
- Non-OK backend responses fail as typed
  `FlarexBackendLiveQueryResponseError` values, and fetch/text failures fail
  as typed `FlarexBackendLiveQueryFetchError` values.
- Existing `createFlarexBackendLiveQueryDelivery(...)`,
  `createFlarexBackendLiveQueryWakeNotifier(...)`, and
  `createFlarexBackendLiveQueryTriggerNotifier(...)` promise APIs remain as
  compatibility wrappers with preserved rejection message strings.

Why it changed:

The executor HTTP route adapter already has typed body decoders and operation
errors. The backend live-query integration helpers were still throwing plain
`Error` values at the integration boundary. This checkpoint makes those
backend callback failures typed while keeping the public callback factory
ergonomics unchanged for executor runtime callers.

Preserved behavior:

- Delivery grouping, backend URL construction, authorization headers,
  notification request bodies, Elysia executor routes, executor method
  mappings, backend Worker routes, protocol schemas, and `ValidatorJson` are
  unchanged.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
node ./node_modules/vitest/vitest.mjs run packages/executor-http/test/http.test.ts -t "backend live query|live query delivery callbacks|live query trigger notifications" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Executor HTTP Live Query Body Effect Decoders

Previous completed checkpoint: `8d99add` Decode executor invoke bodies with
Effect.

What changed:

- The remaining executor HTTP live-query and maintenance POST bodies now have
  exported Effect-returning body decoders.
- Live-query rerun/delivery maintenance, subscription record/remove, connection
  touch/remove/cleanup, delivery claim/ack/failure/dead-letter, pending
  deployment scans, expired connection deployment scans, and stuck delivery
  scans now use the decoder-based route adapter.
- Direct decoder tests cover typed success and typed validation failure
  channels for the migrated live-query/maintenance body group.

Why it changed:

The previous checkpoint moved invoke lifecycle bodies to typed Effect decoders.
This checkpoint finishes the same executor HTTP request-body migration for the
remaining trusted-executor POST routes without replacing Elysia or changing
executor semantics.

Preserved behavior:

- Authorization ordering, not-configured maintenance responses, malformed JSON
  `400`, validation `400`, executor error mappings, route paths, Elysia app
  shape, protocol schemas, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test -- --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Executor HTTP Invoke Body Effect Decoders

Previous completed checkpoint: `3675397` Name generated worker JSON failures.

What changed:

- `@flarex/executor-http` now exposes Effect-returning decoders for the invoke
  lifecycle POST bodies: prepare, begin session, syscall, finish, abort, abort
  stale, and invoke-session maintenance.
- The invoke lifecycle handlers now use a decoder-based Effect route adapter
  after the shared JSON read boundary.
- The parser-backed adapter path remains for routes outside this slice, so the
  remaining live-query and maintenance routes can migrate in the next coherent
  batch.
- Direct tests cover typed decoder success and typed validation failure
  channels separately from HTTP adapter mapping.

Why it changed:

The previous executor HTTP checkpoint typed the shared JSON read and executor
operation boundary, but route body validation still flowed through
`{ value } | { error }` parser results inside the shared route adapter. Moving
the invoke lifecycle routes to Effect-returning decoders aligns this package
with the migration quality bar without replacing Elysia or changing executor
semantics.

Preserved behavior:

- Authorization ordering, malformed JSON `400`, validation `400`, executor
  error mappings, route paths, Elysia app shape, live-query routes, protocol
  schemas, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test -- --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Executor HTTP Effect Body Adapter

Previous completed checkpoint: `1e98c94` Route artifact runtime through Effect.

What changed:

- `@flarex/executor-http` now has a shared typed Effect body adapter for all
  POST routes.
- `ExecutorHttp.routeBody` owns JSON reading, existing parser invocation,
  executor method invocation, and adapter-edge response mapping for malformed
  JSON, body validation, and executor failures.
- The route-specific handlers now pass parser/executor pairs into the shared
  adapter instead of duplicating `request.json()` and executor `try/catch`
  blocks.

Why it changed:

The trusted executor HTTP adapter is one of the main non-Worker entrypoints for
the Postgres-authoritative track. Moving its body handling to a typed Effect
adapter makes the migration broader than backend Worker routes while preserving
the existing Elysia API surface.

Preserved behavior:

- Authorization ordering, not-configured maintenance responses, parser
  messages, executor error mappings, route paths, Elysia app shape, and Nitro
  inheritance are unchanged.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-http build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Test SDK Reset For Postgres Runtime

Previous completed checkpoint: `d94ef92` Cover packed test SDK Postgres
subscriptions.

What changed:

- The public `flarex-test.reset()` helper now recreates the local dev runtime,
  including the Postgres/PGlite executor runtime when `executorTransport:
  "postgres"` is selected.
- The packed consumer Postgres script verifies that a document written through
  the trusted executor disappears after reset.
- The packed consumer Postgres script uses a string `persistDir`, so reset also
  proves explicit persisted PGlite/dev-runtime state is removed.
- The string persist directory is under `.flarex/`, matching the resettable
  path guard.

Why it changed:

The trusted executor path needs the same test isolation ergonomics as the
legacy local runtime. Without this, app tests using the forward Postgres path
would need to manually reconstruct Flarex internals or tolerate state leakage
between test cases.

Convex references inspected:

- Convex test helper ergonomics recorded in the Test SDK roadmap.
- `crates/database/src/transaction.rs`
  - transaction state is backend-owned; tests should reset the backend harness
    rather than manipulate user-visible documents directly.

Flarex differences:

- Flarex reset recreates the local Miniflare backend and PGlite executor
  instead of clearing a single in-process mock store.
- The persistence directory path is resolved by `flarex-dev`, not by a separate
  `flarex-test` convention.
- Reset deletion is rejected for paths outside the app `.flarex/` directory,
  avoiding accidental deletion of app or parent directories.
- Valid and invalid absolute path cases are covered in the shared `flarex-dev`
  resettable path tests.
- Harness lifecycle serialization also applies to Postgres/PGlite runtimes
  because `reset()` recreates the whole dev runtime through the shared queue.
- This remains a local PGlite reset proof, not a real Postgres truncation or
  tenant cleanup API.

Known limitations:

- Real Postgres test database lifecycle management remains future work.
- Lifecycle calls on one harness are serialized, but database operations issued
  while reset or dispose is in progress remain the test author's
  responsibility.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- dev.test.ts
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-test typecheck
corepack pnpm --filter flarex-test build
corepack pnpm --dir apps/example exec vitest run flarex/invoke-e2e.test.ts --hookTimeout=60000 --testTimeout=60000
corepack pnpm --filter @flarex/example typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Test SDK Postgres Subscription

Previous completed checkpoint: `9b0486f` Cover packed test SDK Postgres invoke
flow.

What changed:

- Extended the packed fresh-consumer Postgres test to exercise live query
  delivery through `flarex-test`'s public `client()` API.
- The Postgres script now shares the generated live-query assertion helper used
  by the legacy packed script.
- The installed consumer now proves a Postgres-backed subscription receives the
  initial query result, a sync mutation writes through the trusted executor,
  and the live query callback receives the updated result.

Why it changed:

Postgres invoke is not enough for the platform target. The forward executor
path also owns mutation-triggered invalidation, durable delivery rows, and sync
fanout. A packed consumer gate now verifies that those pieces are reachable
through the developer test SDK surface.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/client.ts`
  - Convex's client treats query subscriptions as the normal frontend path.
- `crates/sync/src/state.rs`
  - backend query state suppresses unchanged results and emits updates when
    reruns change.

Flarex differences:

- Flarex splits trusted Postgres execution from Cloudflare-shaped connection
  delivery. Convex keeps these responsibilities inside its backend runtime.
- This is still the PGlite/local test lane, not the real Postgres lock/isolation
  lane.

Known limitations:

- No hosted Nitro/Vercel plus Cloudflare Worker deployment smoke exists yet.
- Real Postgres delivery/concurrency remains covered by lower-level lanes, not
  this packed consumer fixture.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Test SDK Postgres Invoke

Previous completed checkpoint: `d133982` Cover packed test SDK live query
flow.

What changed:

- Added a fresh-consumer packed test that runs `flarex-test` with
  `executorTransport: "postgres"`.
- The test exercises generated query and mutation references over the
  Postgres/PGlite executor path from an installed package graph.
- It verifies direct read-after-write persistence through the trusted executor
  path, not the legacy Durable Object runtime.

Why it changed:

The Postgres executor is the forward path for OCC, documents, indexes, and sync
freshness. A clean consumer package gate should prove that app tests can reach
that executor through the same public `flarex-test` API developers will use.

Convex references inspected:

- Convex's test-helper model remains the ergonomic target: generated
  references plus a compact harness API.
- `crates/database/src/transaction.rs`
  - read and write operations belong to a transaction view before commit.

Flarex differences:

- Flarex has a transport selector because the project is migrating from the
  legacy DO runtime to the trusted Postgres executor. Convex keeps this behind
  one backend runtime boundary.
- The packed test uses local PGlite. Real Postgres latency, lock, and isolation
  behavior are intentionally tested elsewhere.

Known limitations:

- No packed Postgres live-query delivery assertion yet.
- This does not add new executor semantics; it hardens the installed test SDK
  path that reaches existing semantics.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Nitro Adapter Fresh-Consumer Smoke

Previous completed checkpoint: `fad789f` Add test SDK and Nitro package
boundaries.

What changed:

- Added `@flarex/executor-nitro` to the packed fresh-consumer install fixture.
- The packed override matrix now includes every internal tarball so Nitro's
  transitive executor dependencies resolve from the same packed graph.
- The internal package metadata is shared with the tarball-shape test, avoiding
  a second hand-maintained package list for the Nitro adapter.
- The temp consumer imports `createFlarexNitroHandler` and
  `FlarexNitroEventLike` from the installed tarball.
- The fixture runs consumer `tsc` and runtime `tsx` smokes after package
  install.

Why it changed:

The Nitro adapter is the Vercel/Nitro-facing package boundary for the trusted
executor. It should be proven installable from a clean consumer graph before
more framework adapter behavior is built on top.

Convex references inspected:

- `npm-packages/convex/package.json`
  - Convex keeps public package imports behind package exports instead of
    source-path imports.

Flarex differences:

- Convex owns its hosted backend runtime and does not need this adapter.
- Flarex keeps Nitro adapter validation separate from executor-core validation
  so the framework-neutral core remains reusable.

Known limitations:

- The smoke proves install/import/runtime resolution, not deployment on Nitro or
  Vercel.
- Route behavior remains covered by `@flarex/executor-nitro` package tests and
  `@flarex/executor-http` tests.
- The consumer typecheck uses source-package Vite/Bundler-style resolution.
  Built artifact validation remains a future package-output checkpoint.

Verification:

```sh
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Nitro Adapter Tarball Boundary

Previous completed checkpoint: `339e671` Add packed consumer generated
typecheck gate.

What changed:

- Added `files: ["src"]` to `packages/executor-nitro/package.json`.
- Added `@flarex/executor-nitro` to the shared internal package packability
  matrix.

Why it changed:

The Nitro adapter should remain a thin host adapter over the framework-neutral
executor HTTP core. Its packed artifact should not leak local tests or
TypeScript config, and its manifest should not retain workspace-only dependency
protocols.

Convex references inspected:

- `npm-packages/convex/package.json`
  - public package boundaries are explicit in package metadata.

Flarex differences:

- Convex does not need a Nitro/Vercel adapter because Convex owns the hosted
  backend runtime. Flarex keeps this adapter separate so the trusted executor
  core remains framework-neutral.

Known limitations:

- This does not install or execute `@flarex/executor-nitro` from a fresh
  consumer yet.
- The adapter remains a thin package boundary; Nitro route coverage remains in
  package-level tests.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Post-Commit Live-Query Invalidation Audit

Previous completed checkpoint: `a1fea7f` Cover Postgres delivery claim cursor
race.

What changed:

- Audited the executor mutation finish path and corrected this roadmap's stale
  implementation note.
- Current `finishInvokeSession(...)` already commits mutation writes, applies
  freshness metadata through the injected `freshnessStore`, and invokes the
  injected `notifyTrigger(...)` only after a successful commit.
- Existing executor tests already cover:
  - successful mutation commit updates freshness metadata and notifies,
  - OCC failure does not notify and does not advance freshness metadata,
  - synchronous and asynchronous trigger failures are reported through
    `onError(...)` without failing an already committed mutation.
- The older "Mutation-Owned Live-Query Trigger Plan" remains as historical
  design context, but its "current mutation finish does not yet drive stale
  subscription marking" limitation is no longer true.

Why it changed:

The next implementation scan found that the code had advanced beyond this
roadmap section. Leaving the stale limitation in place would push future work
toward reimplementing behavior that is already present and tested. Recording
the audit keeps the Convex-style ownership boundary clear: the trusted executor
owns post-commit freshness publication, and host adapters only provide the
notification transport.

Convex references inspected:

- `crates/database/src/committer.rs`
  - commit validates reads and publishes committed write metadata after the
    transaction succeeds.
- `crates/sync/src/worker.rs`
  - sync workers react to committed backend state rather than speculative
    mutation attempts.
- `crates/sync/src/state.rs`
  - query state is updated after backend-owned invalidation/rerun work.

Flarex differences:

- Convex keeps commit publication and sync scheduling inside one backend
  runtime. Flarex persists commit state in Postgres, updates an injected
  freshness mirror, then calls an injected notifier so Nitro, local tests, or a
  Cloudflare adapter can wake the sync scheduler.
- A trigger failure is host-observable through `onError(...)` but does not roll
  back committed writes. Durable recovery depends on the already persisted
  commit/outbox/live-query state.

Known limitations:

- The notifier is still best-effort; durable retry/alerting for notifier
  failures remains a host/scheduler responsibility.
- The current freshness mirror is injected. A production Postgres-backed or
  Cloudflare-backed mirror still needs operational hardening.
- Range/index invalidation precision remains limited by the read-set and
  freshness primitives already documented in the sync roadmaps.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor exec vitest run test/sessions.test.ts -t "marks live query subscriptions stale|does not notify live query invalidation|reports async live query trigger failures" --testTimeout=30000 --hookTimeout=30000
git diff --check
```

## Async Live-Query Trigger Failure Coverage

Previous completed checkpoint: `921a079` Deliver failed live query reruns.

What changed:

- Added executor session coverage for an asynchronous rejected
  `liveQueryInvalidation.notifyTrigger(...)`.
- The test proves a mutation whose writes already committed still resolves
  successfully, the invoke session remains `finished`, and the rejected
  notifier promise is surfaced through `liveQueryInvalidation.onError(...)`.

Why it changed:

Flarex's trusted executor commits writes and freshness metadata before asking a
host-specific notifier to wake Cloudflare sync work. That notifier will usually
be an async HTTP call, so rejected promises must be observable without turning a
successful commit into a user-visible mutation failure.

Convex references inspected:

- `crates/database/src/committer.rs`
  - commits validate reads, persist writes, then publish write-log state for
    subscribers.
- `crates/sync/src/worker.rs`
  - sync query update work is a separate worker responsibility after backend
    state advances.
- `crates/sync/src/state.rs`
  - active query state records result hashes/subscriptions and is repaired by
    later worker transitions.

Flarex differences:

- Convex keeps commit publication and sync worker scheduling inside its backend
  runtime. Flarex splits them: the executor commits durable state, then invokes
  an injected notifier that may cross to Cloudflare.
- Because the notifier is outside the commit transaction, notifier failure is
  reported to the host through `onError` instead of rolling back the mutation.

Known limitations:

- This does not add retry, alerting, or durable notifier-failure persistence.
  Those belong to the delivery/wake reliability layer.
- The hook remains best-effort after commit; if a host ignores `onError`, the
  durable rows still exist but wake recovery depends on later maintenance.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor exec vitest run test/sessions.test.ts -t "async live query trigger failures" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Real Postgres Executor Retry Lane

Previous completed checkpoint: `df4e8ad` Serialize Postgres commit timestamps.

What changed:

- Added `packages/executor/test/postgresRetry.test.ts`, an optional real
  Postgres test lane for `runInvokeWithRetries(...)`.
- Added `packages/executor/test/postgresHelpers.ts` so executor-level real
  Postgres tests can create temporary app/migration schemas, run migrations,
  and clean up independently.
- Added `@flarex/executor` script:

```sh
corepack pnpm --filter @flarex/executor test:postgres
```

- Added dev-only `pg` and `@types/pg` dependencies to the executor package for
  this optional test harness.

Why it changed:

The Postgres persistence package now serializes commit timestamps and exposes
real Postgres correctness lanes, but the hosted user-code path depends on the
executor retry coordinator. This test proves the executor can translate a real
Postgres OCC failure into a fresh mutation attempt and can abort exhausted
attempts.

Convex references inspected:

- `crates/database/src/database.rs`
  - transaction execution can retry after OCC conflicts.
- `crates/database/src/committer.rs`
  - commit validation is the source of stale-read conflicts.
- `crates/application/src/application_function_runner/mod.rs`
  - backend function execution owns attempt lifecycle.

Flarex differences:

- Flarex retry attempts are durable invoke sessions. A failed attempt is
  marked aborted before the next attempt starts.
- The optional lane runs executor core directly against Node Postgres. It does
  not yet include the Dynamic Worker HTTP syscall transport.

Known limitations:

- The lane skips unless `FLAREX_POSTGRES_DATABASE_URL` is set.
- Real Postgres executor retry is proven only for document-read conflicts in
  this checkpoint. Table/index retry over the same adapter can be added after
  SQL-pushed index execution is hardened.
- The executor-local helper duplicates the temp-schema harness shape from the
  persistence package because test utilities are not currently exported as a
  shared package.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test:postgres -- --testTimeout=30000
```

## Real Postgres OCC Concurrency Lane

Previous completed checkpoint: `e7c3065` Add real Postgres indexed freshness
lane.

What changed:

- Added `test/postgresConcurrency.test.ts`, an optional real Postgres
  correctness lane gated by `FLAREX_POSTGRES_DATABASE_URL`.
- Added `test/postgresHelpers.ts` so real Postgres tests share temporary schema
  setup, isolated Drizzle migration metadata, migration, and cleanup.
- Updated `test:postgres` to run both real Postgres indexed freshness and OCC
  concurrency files.
- The commit path now uses the existing `leases` table as a deployment-scoped
  row lock for commit timestamp allocation.

Why it changed:

The trusted executor is intended to run on real Postgres in Nitro/Vercel or a
similar Node host. The previous PGlite lane proved commit semantics locally,
but production correctness depends on real Postgres transaction behavior under
overlapping commits.

Convex references inspected:

- `crates/database/src/committer.rs`
  - serialized commit validation, timestamp assignment, and publish.
- `crates/database/src/write_log.rs`
  - pending writes protect against conflicts with in-flight commits.
- `crates/database/src/reads.rs`
  - read-set dependencies determine OCC conflicts.

Flarex differences:

- Convex runs a backend committer that serializes and tracks pending writes in
  memory. Flarex uses a short Postgres transaction plus a row-level lock on
  `leases(deployment_id)` to serialize the critical section.
- The optional test lane is external-service gated. Default local validation
  still uses PGlite and skip checks so contributors do not need Postgres for
  every edit.

Known limitations:

- Real Postgres retry coordination through `@flarex/executor.runInvokeWithRetries`
  remains a follow-up. This checkpoint proves the lower persistence commit
  boundary.
- Commit serialization is deployment-wide. It is correct but may become a
  throughput bottleneck for very high write deployments; later work can split
  allocator lanes after semantics are stable.
- The row-lock path does not yet expose contention metrics.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/postgres.test.ts test/postgresConcurrency.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts --testTimeout=30000
```

## Real Postgres Indexed Freshness Lane

Previous completed checkpoint: `51911da` Harden indexed freshness range checks.

What changed:

- Added a real `pg`/Drizzle Node Postgres adapter entrypoint at
  `@flarex/persistence-postgres/postgres`.
- The adapter reuses the same framework-neutral persistence interface as the
  PGlite local lane, including migrations, invoke sessions, OCC commit,
  index history, freshness, outbox, live-query subscriptions, and durable
  delivery rows.
- Added isolated migration metadata options so real Postgres tests and hosted
  smoke checks can use temporary schemas without colliding with a database's
  existing Drizzle migration history.
- Added an optional real Postgres test lane gated by
  `FLAREX_POSTGRES_DATABASE_URL`. The test creates temporary schemas, runs
  migrations, commits an indexed mutation, checks
  `hasIndexEntryAfterTs(...)`, and verifies the planner can use
  `indexes_by_index_id_key_prefix_ts`.

Why it changed:

PGlite proves the local semantics quickly, but the hosted executor will run on
real Postgres. Index freshness and OCC checks are latency-sensitive and
planner-sensitive, so the persistence package needs a real database lane before
more sync behavior depends on those predicates.

Convex references inspected:

- `crates/database/src/reads.rs`
  - read-set index intervals are checked against writes for the same index.
- `crates/database/src/query/index_range.rs`
  - indexed query execution records the consumed interval.
- `crates/database/src/committer.rs`
  - index writes are part of the committed transaction state.

Flarex differences:

- Convex keeps the read-set and write-log machinery inside its Rust backend.
  Flarex persists the same semantic boundary in Postgres and validates it
  through storage predicates.
- Convex does not need a separate optional Node Postgres adapter package
  entrypoint. Flarex does because local PGlite, hosted Nitro/Vercel, and tests
  need to compose the same executor core with different storage clients.

Known limitations:

- The optional test only runs when `FLAREX_POSTGRES_DATABASE_URL` is provided.
  This environment currently verifies compile/skip behavior plus PGlite
  semantics.
- `listDocumentsInIndexAtTs(...)` still does snapshot visibility grouping in
  TypeScript. The production query executor path still needs SQL-pushed-down
  index pagination.
- The adapter currently exposes `pg` only for Node-style trusted executors, not
  Cloudflare Workers.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/postgres.test.ts --testTimeout=30000
```

## DeliveryDO Claim/Ack Consumer

Previous completed checkpoint: `f12a7d2` Add live query delivery claim ack
APIs.

What changed:

- Added Cloudflare `DeliveryDO` consumer for executor claim/ack routes.
- The executor remains platform-agnostic; `DeliveryDO` calls the existing HTTP
  routes instead of importing executor code.
- The direct callback delivery bridge remains available, but the preferred
  production path is now:

```txt
executor writes live_query_deliveries
  -> executor notifies Cloudflare wake route
  -> DeliveryDO claims rows through executor HTTP
  -> DeliveryDO fans out to ConnectionDO
  -> DeliveryDO acks rows through executor HTTP
```

Convex references inspected:

- `crates/sync/src/state.rs`
- `crates/sync/src/worker.rs`

Flarex differences:

- Convex does not need an HTTP claim/ack consumer. Flarex does because
  transaction durability and Cloudflare fanout are separate runtimes.

Known limitations:

- Executor post-commit notification to Cloudflare is still not wired.
- No delivery leases or retry metadata yet.

Verification:

```sh
corepack pnpm --filter flarex-backend test -- sync.test.ts
```

## Platform-Agnostic Delivery Claim/Ack APIs

Previous completed checkpoint: `e4ddeca` Plan DeliveryDO live query fanout.

What changed:

- Added framework-neutral executor methods:
  - `claimLiveQueryDeliveryBatch({ deploymentId, limit, cursor })`
  - `ackLiveQueryDeliveries({ deploymentId, deliveryIds, deliveredAt })`
- `claimLiveQueryDeliveryBatch` maps to the existing durable
  `listUndeliveredLiveQueryDeliveries` persistence operation and validates the
  batch limit.
- `ackLiveQueryDeliveries` maps to
  `markLiveQueryDeliveriesDelivered` and fills `deliveredAt` from the executor
  clock when callers omit it.
- Refactored `runLiveQueryDeliveryBatch({ deliver })` to use claim/ack
  internally, preserving the old callback path as compatibility/fallback.
- Added authenticated HTTP/Nitro routes:
  - `POST /maintenance/live-queries/claim`
  - `POST /maintenance/live-queries/ack`
- Added executor, HTTP, and Nitro tests for claim/ack behavior and request
  validation.

Why it changed:

`DeliveryDO` must be injected with an executor API instead of importing
Postgres or platform-specific executor code. Claim/ack is the minimal
platform-agnostic contract that lets Cloudflare own fanout while the trusted
executor remains authoritative for durable delivery rows.

Convex references inspected:

- `crates/sync/src/state.rs`
  - `SyncState::complete_fetch` owns result-hash state for query transition
    dedupe.
- `crates/sync/src/worker.rs`
  - transition send-side work is bounded by transition count/backpressure and
    emits `ServerMessage::Transition`.

Flarex differences:

- Convex does not need claim/ack APIs because its sync worker and backend state
  are colocated. Flarex needs claim/ack because `DeliveryDO` will run in
  Cloudflare and the trusted executor may run on Nitro/Vercel.
- The first claim implementation does not lease rows. It lists undelivered
  rows and relies on future per-deployment `DeliveryDO` serialization. A later
  production pass should add leases/visibility timeouts.

Known limitations:

- `DeliveryDO` is not implemented yet.
- No wake-notification route exists yet.
- No claim lease, retry count, or poison-row handling yet.
- Project/deployment authorization for claim/ack still relies on the executor
  adapter capability token.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test -- liveQueries.test.ts
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test -- health.test.ts
```

## DeliveryDO Claim/Ack Direction

Previous completed checkpoint: `3288183` Wire live query delivery callback
bridge.

Decision:

The Vercel/Nitro executor should not own the live-query delivery drain loop in
production. It should:

```txt
1. commit mutation,
2. write durable live_query_deliveries rows,
3. notify Cloudflare that a deployment has pending rows,
4. expose internal claim/ack APIs for Cloudflare DeliveryDO.
```

Cloudflare `DeliveryDO` should then claim rows, fan them out to `ConnectionDO`,
and ack them through the executor.

Target executor API shape:

```ts
executor.claimLiveQueryDeliveryBatch({
  deploymentId,
  limit,
  cursor,
});

executor.ackLiveQueryDeliveries({
  deploymentId,
  deliveryIds,
  deliveredAt,
});
```

Target HTTP routes:

```txt
POST /maintenance/live-queries/claim
POST /maintenance/live-queries/ack
```

The existing `runLiveQueryDeliveryBatch({ deliver })` remains a compatibility
helper while the `DeliveryDO` path is introduced, but it is not the preferred
production owner for fanout.

Why it changed:

Serverless executor hosts such as Vercel should not be responsible for
unbounded drain loops or high-frequency polling. Delivery work scales with open
connections and should run close to Cloudflare `ConnectionDO` instances.

Convex references inspected:

- `crates/sync/src/state.rs`
  - result-hash state belongs to sync transition ownership.
- `crates/sync/src/worker.rs`
  - transition production is single-flighted and sent from the sync worker.

Flarex differences:

- Convex does not need claim/ack over HTTP because its sync worker and backend
  state are colocated. Flarex needs claim/ack because Postgres durability and
  Cloudflare fanout live in different runtimes.
- The executor stays authoritative for delivery-row state; Cloudflare gets
  only bounded batches and ack authority for rows it successfully fans out.

Known limitations:

- Claim semantics are not implemented yet. The first version can list
  undelivered rows without leasing because `DeliveryDO` serializes per
  deployment; a later production version should add leases or visibility
  timeouts.
- Ack is currently available through persistence and executor internals but not
  as a first-class HTTP route.
- There is no Postgres-side metric for repeated delivery failure or poison
  rows yet.

First implementation plan:

1. Add framework-neutral executor methods:
   - `claimLiveQueryDeliveryBatch`
   - `ackLiveQueryDeliveries`
2. Map them to existing persistence functions first:
   - `listUndeliveredLiveQueryDeliveries`
   - `markLiveQueryDeliveriesDelivered`
3. Add authenticated HTTP/Nitro routes and tests.
4. After that, implement Cloudflare `DeliveryDO` against these routes.

Verification:

```sh
git diff --check
```

## Query Finish Read Timestamp For Indexed Live Queries

Previous completed checkpoint: `07b0e38` Harden invoke write-shape
invalidation.

What changed:

- Added `readTs` to `FinishInvokeSessionResult`.
- Query `finishInvokeSession(...)` now returns `readTs: session.beginTs`
  alongside `value` and `readSet`.
- Tightened `FinishInvokeSessionResult` into query and mutation result arms so
  query results must carry `readSet` and `readTs`.
- Re-exported the query and mutation result arm types from `@flarex/executor`.
- Made `ConnectionDO` fail closed when a query response has a `readSet` but no
  `readTs`, and removed the old live-query registration fallback to `0`.
- Made `ConnectionDO` require query responses to include both `readSet` and
  `readTs` before updating active-query metadata, preventing malformed reruns
  from reusing stale dependency state.
- Added local query-response validation in `ConnectionDO` so executor transport
  responses are checked before being narrowed to the query-specific shape.
- Updated the retained Cloudflare `ExecutionDO` query finish path to return
  `readTs: session.tx.beginTs`, matching the newer trusted executor contract
  while the legacy worker-session route remains in the repo.
- Updated the executor query-session finish unit test to assert the returned
  `readTs`.
- Added a `/sync` regression proving artifact-runtime query responses with a
  `readSet` but no `readTs` become `QueryFailed` transitions.
- Added a `/sync` rerun regression proving a previously registered query fails
  closed when the next executor response omits read metadata entirely.
- Added query/mutation-specific `runInvokeWithRetries(...)` overloads on both
  the standalone helper and public executor interface so live-query rerun code
  receives a typed query result with required `readSet` instead of falling back
  to an empty dependency set.
- The hosted generated sync integration now depends on that timestamp when
  registering indexed live-query subscriptions through the Cloudflare
  `ConnectionDO`.

Why it changed:

Postgres executor query sessions already have a logical snapshot timestamp at
`beginTs`. Direct document reads carry observed document timestamps in the read
set, but indexed range reads are registered as range dependencies and use the
subscription begin timestamp when converted to freshness metadata. Without
returning `readTs`, the Cloudflare connection layer fell back to `0`, making a
fresh indexed subscription appear stale immediately.

Convex references:

- `crates/database/src/transaction.rs`
  - query execution is tied to a transaction/snapshot timestamp.
- `crates/database/src/committer.rs`
  - read-set validation compares read timestamps against later committed
    writes.
- `crates/sync/src/worker.rs`
  - sync query reruns depend on preserving the backend's query read timestamp.

Flarex differences:

- Convex does not cross an HTTP executor boundary for query finish. Flarex must
  explicitly return the query snapshot timestamp from the trusted executor to
  Cloudflare so live-query freshness rows are durable and correct.

Known limitations:

- This records the timestamp for the PGlite/Postgres executor session path.
  Real Postgres concurrency and planner behavior remain covered by the separate
  optional real-Postgres lanes.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor build
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/executionDO.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-dev exec vitest run test/backendSyncRuntime.test.ts --testTimeout=30000 --hookTimeout=30000
```

## Invoke Finish Live-Query Trigger Integration

Previous completed checkpoint: `b5b82f4` Add artifact OCC retry boundary.

What changed:

- Added integration coverage proving real Nitro `/invoke/finish` calls through
  the trusted Postgres executor update the freshness mirror and invoke the
  configured live-query trigger hook after a successful mutation commit.
- Added the missing integration alias for `@flarex/freshness` so integration
  tests can use the same freshness mirror implementation as executor core.
- Re-exported `createFlarexBackendLiveQueryTriggerNotifier` and its public
  types from `@flarex/executor-nitro`, so Nitro/Vercel hosts can wire the
  framework-neutral executor hook without importing HTTP adapter internals.
- Added Nitro adapter coverage for that trigger notifier export and its
  backend route payload.

Current ownership flow:

```txt
/invoke/finish
  -> trusted executor validates OCC
  -> Postgres commit publishes writes
  -> executor updates configured freshness mirror
  -> executor calls injected trigger notifier
  -> hosted trigger route schedules live-query reruns
```

Convex references inspected:

- `crates/database/src/committer.rs`
  - commit is the publication boundary for write-log/invalidation state.
- `crates/sync/src/worker.rs`
  - backend-owned invalidation wakes sync work after committed writes.
- `crates/sync/src/state.rs`
  - active query state is refreshed from backend invalidation state.

Flarex differences:

- Convex keeps invalidation scheduling inside the backend runtime. Flarex keeps
  executor core framework-neutral and requires hosts to inject a trigger
  notifier, typically created with
  `createFlarexBackendLiveQueryTriggerNotifier`.
- Freshness is still mirror-backed. The subscription row itself is not mutated
  to a durable `stale` state; stale classification is computed from recorded
  read sets and mirror versions when rerun maintenance scans.

Known limitations:

- Trigger notification is best effort. If the backend trigger route is
  unavailable, the commit still succeeds and the configured `onError` receives
  the failure.
- Range/index invalidation precision is still conservative and should be
  tightened separately.
- Hosted platform wiring still needs a concrete Nitro/Vercel executor app that
  supplies the trigger notifier config from deployment environment.

Verification:

```sh
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/invoke.integration.test.ts
corepack pnpm --filter @flarex/executor-nitro test
corepack pnpm --filter @flarex/executor-nitro typecheck
```

## Invoke Write-Shape Invalidation Hardening

Previous completed checkpoint: `ab62339` Wire invoke commits to live query
triggers.

What changed:

- Added real Nitro/PGlite invoke integration coverage proving live-query
  invalidation triggers for committed insert, patch, replace, delete, and
  multi-write mutation sessions.
- Added a no-write mutation session assertion proving empty commits do not call
  the live-query trigger hook.
- The write-shape integration caught that `/invoke/syscall` accepted `patch`
  and `delete` but rejected `replace` even though executor core and generated
  materialized artifacts already support `ctx.db.replace`.
- Added `replace` parsing to the HTTP invoke syscall route and unit coverage in
  `@flarex/executor-http`.

Convex references inspected:

- `crates/database/src/transaction.rs`
  - staged writes include insert, patch, replace, and delete mutations in one
    transaction attempt.
- `crates/database/src/committer.rs`
  - every committed document version change is published through the commit
    boundary, regardless of write shape.
- `crates/sync/src/worker.rs`
  - sync invalidation is driven by committed writes, not by the specific user
    operation that produced them.

Flarex differences:

- Convex's syscall parser, transaction state, committer, and sync worker are
  process-local Rust boundaries. Flarex has to keep the HTTP/Nitro syscall
  route in sync with executor-core supported operations and generated
  Dynamic Worker `ctx.db` methods.
- No-write mutation sessions can still finish, but because they publish no
  writes they do not update freshness mirrors or wake live-query rerun work.

Known limitations:

- This hardens the trigger boundary, but it does not yet prove the downstream
  scheduler route reruns and delivers all changed query results end-to-end.
- Range/index invalidation precision remains conservative.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/invoke.integration.test.ts --testNamePattern "write shape"
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:integration
corepack pnpm build
git diff --check
```

## Invoke Finish OCC Retry Boundary

Current checkpoint: pending commit for artifact transport retry.

What changed:

- The Postgres executor `/invoke/finish` route is now consumed by a
  metadata-preserving artifact client, so retryable OCC failures remain visible
  as structured backend request errors inside the Dynamic Worker runtime.
- The executor still owns the authoritative commit decision. The artifact only
  decides whether to rerun the handler after the executor rejects a mutation
  attempt as retryable.

Boundary rule:

```txt
trusted executor:
  validate begin_ts read set
  commit or reject

execution artifact:
  rerun whole mutation handler only when executor returns retryable OCC
```

Convex references:

- `crates/database/src/committer.rs`
  - OCC rejection is part of commit, not user-code execution.
- `crates/application/src/application_function_runner/mod.rs`
  - application execution coordinates attempts around backend-owned commit.

Flarex difference:

The retry loop crosses an internal HTTP/service-binding boundary because user
code is in the Dynamic Worker artifact and transaction state is in the
trusted Postgres executor.

Verification:

```sh
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/execution-artifact-postgres.integration.test.ts
```

## Postgres Index Freshness Boundary Update

Previous completed checkpoint: `ccc5dea` Harden executor sync integration.

What changed:

- Added `hasIndexEntryAfterTs(...)` to the Postgres persistence surface.
- Wired the PGlite adapter to the same helper so local and test executor runs
  use the real durable index history.
- `createPostgresFreshnessMirrorStore(...)` now exposes that helper to
  `@flarex/freshness`, allowing indexed subscriptions to be classified as
  stale.
- Indexed query sessions record returned documents with exact observed
  revisions so same-index-key content updates are caught by OCC and live-query
  freshness.

Why it changed:

The trusted Postgres executor is the authoritative OCC and live-query
freshness boundary. Since the executor already writes ordered index history at
commit time and validates index reads for mutation OCC, the same persisted
history should drive live-query staleness instead of adding a separate
Cloudflare-only freshness table first.

Convex references inspected:

- `crates/database/src/reads.rs`
  - one read-set model is reused for mutation conflicts and subscriptions.
- `crates/database/src/committer.rs`
  - commit computes index writes before publication.

Flarex differences:

- Convex holds the relevant snapshots, subscriptions, and index write maps in
  backend-managed Rust structures. Flarex stores the authoritative index
  history in Postgres/PGlite and lets the framework-neutral executor ask
  storage whether a read range changed.
- Convex's transaction read set covers both index intervals and read
  documents. Flarex stores those as separate invoke-session read rows and
  recombines them for commit validation and subscription freshness.
- This preserves the current Cloudflare split: user code still calls syscalls,
  while the trusted executor owns persistence and freshness.

Known limitations:

- The helper is correct but not yet optimized for production SQL query plans.
- Real Postgres isolation/lock behavior still needs a non-PGlite correctness
  lane.
- This does not change cross-shard or workflow mutation semantics.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor exec vitest run test/sessions.test.ts test/liveQueries.test.ts --testTimeout=30000
```

## Index Freshness Persistence Hardening

Previous completed checkpoint: `120dcaa` Implement indexed live query freshness.

What changed:

- Added migration `0012_sudden_king_bedlam.sql` for
  `indexes_by_index_id_key_prefix_ts`.
- Updated Postgres/PGlite persistence so index freshness/OCC existence checks
  use deployment, index, encoded key-range, and timestamp predicates in SQL.
- Added PGlite tests for index membership changes across inserts, deletes, and
  same-key patches.

Why it changed:

The trusted executor owns the authoritative persistence path. After indexed
live-query freshness became semantically correct, the next risk was letting
hot index subscriptions force broad in-process scans. This keeps the
framework-neutral executor on a storage shape closer to the eventual hosted
Postgres runtime.

Convex references inspected:

- `crates/database/src/reads.rs`
  - indexed read sets are checked against index writes by interval overlap.
- `crates/database/src/query/index_range.rs`
  - range reads record intervals that later commits can compare against.

Flarex differences:

- Convex can compare intervals against process-local structures. Flarex uses
  persisted ordered key bytes and timestamp predicates through Drizzle.
- The migration is Postgres-owned in `@flarex/persistence-postgres`; executor
  packages consume the persistence interface and do not own SQL migrations.

Known limitations:

- PGlite proves behavior, but real Postgres plan validation remains required.
- The index read execution path is still not fully SQL-pushed-down for
  snapshot pagination.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts --testTimeout=30000
```

## Executor Subscription Registry HTTP Boundary

Previous completed checkpoint: `09eb59c` feat: enhance live query subscription
handling and executor integration.

What changed:

- Recorded the executor HTTP endpoints added in `09eb59c`:
  `/live-query-subscriptions/record` and
  `/live-query-subscriptions/remove`.
- These endpoints map directly to `FlarexExecutor.recordLiveQuerySubscription`
  and `FlarexExecutor.removeLiveQuerySubscription`.
- The record endpoint accepts the query function path, args JSON, partition
  key, begin timestamp, read set, and result JSON produced by the query
  execution boundary.
- The remove endpoint deletes the durable subscription by deployment,
  connection, and query id.
- Record/remove inputs carry `projectId`; executor core validates deployment
  ownership before subscription rows are inserted or deleted.
- The HTTP boundary validates supported freshness read-set shapes before
  calling executor core, so malformed internal requests return `400`.
- HTTP tests now validate auth, request parsing, method handling, and executor
  delegation for these subscription routes.

Why it changed:

The executor owns committed write freshness and stale subscription scans. It
therefore also needs the durable active-subscription registry populated by
WebSocket connections, without importing Cloudflare backend code or PGlite into
`ConnectionDO`.

Convex references inspected:

- `crates/database/src/committer.rs`
  - commit state drives query invalidation after OCC success.
- `crates/sync/src/worker.rs`
  - sync worker processes active subscriptions from backend-owned state.
- `crates/sync/src/state.rs`
  - query result hashes are part of unchanged-result suppression.

Flarex differences:

- Convex does not expose an HTTP subscription registry route because its sync
  and database runtimes are colocated. Flarex exposes this as a trusted
  internal executor boundary for Cloudflare ConnectionDOs and other hosts.
- The route is framework-neutral in `@flarex/executor-http`; Nitro/Vercel and
  local dev can reuse it without owning persistence logic.

Known limitations:

- The route shape is internal and not yet wrapped by the Nitro adapter.
- Index/range freshness still needs precise Postgres metadata before all query
  shapes can safely use this registry for live updates.

Verification:

```sh
pnpm --filter @flarex/executor-http test
pnpm --filter flarex-backend test -- sync.test.ts
```

## Post-Commit Live-Query Invalidation Hook

Previous completed checkpoint: `5437ca8` Document live query route ownership.

What changed:

- Added `LiveQueryInvalidationConfig` to `FlarexExecutorConfig`.
- `finishInvokeSession(...)` now runs the hook only after
  `commitInvokeSessionWrites(...)` succeeds for mutations with committed
  writes.
- When a `freshnessStore` is supplied, the executor applies document/table
  freshness versions using the commit timestamp and committed write set.
- When `notifyTrigger` is supplied, the executor calls it with deployment,
  project, session, function path, commit timestamp, and committed writes.
- Hook failures are caught and reported through optional `onError` so an
  already committed mutation is not turned into a false client-visible failure.
- `runInvokeWithRetries(...)` threads the same hook through the final successful
  finish path, so aborted OCC attempts do not notify.

Why it changed:

The executor is the only component that knows a mutation actually committed.
Cloudflare routes can schedule reruns, but they must not decide commit
success. This checkpoint puts invalidation ownership at the same boundary as
OCC commit.

Convex references inspected:

- `crates/database/src/committer.rs`
  - commit conflict checks happen before writes and write-log metadata publish.
- `crates/sync/src/worker.rs`
  - sync scheduling follows backend invalidation, not client requests.
- `crates/sync/src/state.rs`
  - rerun results are deduped before transitions are emitted.

Flarex differences:

- Convex's commit and sync worker are in the same backend. Flarex uses an
  injected hook because the executor must stay framework-neutral and may run
  under Nitro/Vercel while the scheduler route lives on Cloudflare.
- Freshness marking is represented as document/table freshness mirror updates,
  not a `stale` boolean on `live_query_subscriptions`.

Known limitations:

- The hook is best-effort after commit. A future durable post-commit trigger
  outbox should retry Cloudflare notification failures.
- The current hook updates document/table freshness only. Index/range
  freshness still needs a precise representation.
- The deployable host still needs to pass a real durable freshness store and
  Cloudflare trigger notifier when constructing the executor.

Verification:

```sh
corepack pnpm --filter @flarex/executor exec vitest run test/sessions.test.ts test/liveQueries.test.ts
corepack pnpm --filter @flarex/executor typecheck
```

## Local Host Wires Post-Commit Trigger

Previous completed checkpoint: `730d284` Trigger live query invalidation after
commit.

What changed:

- Added a local PGlite host factory that constructs `createFlarexExecutor(...)`
  with:
  - PGlite persistence,
  - `createPostgresFreshnessMirrorStore(...)`, and
  - `createFlarexBackendLiveQueryTriggerNotifier(...)`.
- Added coverage that drives the executor through HTTP `/invoke/start`,
  `/invoke/syscall`, and `/invoke/finish`, proving the trigger notifier fires
  from the successful commit path.

Why it changed:

The previous executor hook was callable but not wired by a host. This checkpoint
turns the hook into a real local executor runtime behavior without manually
calling scheduler routes.

Convex references inspected:

- `crates/database/src/committer.rs`
  - publish after commit validation.
- `crates/sync/src/worker.rs`
  - trigger query work from backend invalidation.
- `crates/sync/src/state.rs`
  - client-visible transitions come after rerun and dedupe.

Flarex differences:

- Convex local backend is integrated. Flarex local host composes PGlite,
  freshness, executor HTTP, and Cloudflare trigger notification explicitly.

Known limitations:

- The host factory is local/PGlite-specific. Production real Postgres and Nitro
  environment config still need a deployment-facing constructor.
- This test proves trigger notification, not full WebSocket delivery. The
  existing backend sync tests still cover trigger-to-WebSocket fanout.
- Failed trigger notifications are still best-effort and require a durable
  retry design.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/executorHttpRuntime.test.ts
```

## Live-Query Delivery Failure Metadata

Previous completed checkpoint: `d1bc1fe` Add live query delivery reconciler.

What changed:

- Extended `live_query_deliveries` with retry/failure metadata:
  `attempt_count`, `last_attempted_at`, `last_error_stage`, `last_error`,
  `dead_lettered_at`, and `dead_letter_reason`.
- Added Drizzle migration `0011_pretty_shaman.sql`.
- Added low-level Postgres persistence API
  `recordLiveQueryDeliveryFailure(...)`.
- Updated undelivered and pending-deployment scans so retryable pending rows
  mean `delivered_at is null` and `dead_lettered_at is null`.
- Preserved the core safety rule: reporting a failure does not ack the row.

Convex references:

- `crates/sync/src/worker.rs`
  - backend sync work processes query transitions from durable backend state.
- `crates/database/src/committer.rs`
  - durable commits advance before subscribers are notified.

Flarex differences:

- Convex keeps this inside one backend. Flarex has a network boundary between
  the trusted executor, `DeliveryDO`, and `ConnectionDO`, so failure attempts
  need durable metadata.
- This is a runtime maintenance primitive, not a user-facing Convex API.

Known limitations:

- No automatic dead-letter policy yet.
- No stuck-delivery listing endpoint yet.
- Failure errors are bounded text, not structured error codes.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test -- pglite.test.ts
corepack pnpm --filter @flarex/persistence-postgres db:check
```

## Stuck Live-Query Delivery Listing

Previous completed checkpoint: `b35e2ca` Record live query delivery failures.

What changed:

- Added `listStuckLiveQueryDeliveries(...)` to the Postgres persistence
  package.
- The query returns retryable delivery rows that have recorded a failure
  attempt older than a caller-provided `olderThan` timestamp.
- Pagination is deterministic by `last_attempted_at`, `deployment_id`, and
  `delivery_id`.
- Optional filters:
  - `deploymentId`
  - `minAttempts`
  - cursor
  - limit

Selection rule:

```text
delivered_at is null
and dead_lettered_at is null
and last_attempted_at <= olderThan
and attempt_count >= minAttempts
```

Convex reference:

- `crates/sync/src/worker.rs`
  - backend sync workers own query transition processing and retry visibility
    internally.

Flarex difference:

- Flarex exposes this as executor maintenance state because delivery crosses
  the Postgres executor and Cloudflare Durable Object boundary.
- This is read-only. It does not ack, retry, or dead-letter rows.

Known limitations:

- This is only candidate listing; automatic dead-letter policy remains future
  work.
- No deployment-level aggregation is included beyond the existing pending
  deployment scan.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test -- pglite.test.ts
```

## Live-Query Delivery Dead-Letter Primitive

Previous completed checkpoint: `14925e0` List stuck live query deliveries.

What changed:

- Added `markLiveQueryDeliveriesDeadLettered(...)` to the Postgres
  persistence package.
- The operation updates only retryable rows:
  `delivered_at is null` and `dead_lettered_at is null`.
- It records `dead_lettered_at` and `dead_letter_reason`, returns the affected
  delivery rows, and leaves already delivered/dead-lettered rows unchanged.
- Dead-lettered rows disappear from undelivered and stuck-delivery scans.

Convex files inspected:

- `crates/sync/src/worker.rs`
  - Convex sync workers own retry/query transition processing inside the
    backend.
- `crates/sync/src/state.rs`
  - query subscription state is owned by the sync worker state machine.

Flarex difference:

- Convex does not need a Postgres-visible dead-letter row for live-query
  delivery because the sync worker and websocket delivery boundary are
  colocated.
- Flarex stores the dead-letter marker in the trusted executor because delivery
  state crosses from Postgres to Cloudflare Durable Objects.

Known limitations:

- This primitive does not itself close or reconnect Cloudflare connections.
- Retention/deletion of dead-lettered rows is not implemented yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test -- pglite.test.ts
```

## Live-Query Delivery Callback Bridge

Previous completed checkpoint: `4e4d736` Add ConnectionDO live query delivery
consumer.

What changed:

- Added a Cloudflare backend Worker callback route for materialized delivery
  rows:
  `POST /deployments/:deploymentId/sync/deliver-live-query`.
- Added `createFlarexBackendLiveQueryDelivery(...)` to
  `@flarex/executor-http` and re-exported it from `@flarex/executor-nitro`.
- The helper is intended to be passed into the Nitro executor adapter as:

```ts
createFlarexNitroHandler({
  executor,
  liveQueryDelivery: {
    deliver: createFlarexBackendLiveQueryDelivery({
      backendUrl: process.env.FLAREX_BACKEND_URL!,
      capabilityToken: process.env.FLAREX_DELIVERY_TOKEN,
    }),
  },
});
```

- The executor core still owns the durable ack rule:
  `runLiveQueryDeliveryBatch(...)` calls `deliver(rows)` first and only then
  marks `live_query_deliveries.delivered_at`.

Why it changed:

Nitro/Vercel cannot directly access a Cloudflare Durable Object namespace. The
executor therefore needs an HTTP fanout callback into the Cloudflare backend
Worker, and that Worker performs the actual `CONNECTIONS.getByName(...)` call.

Convex references inspected:

- `crates/sync/src/state.rs`
  - result hashes are the sync state dedupe guard.
- `crates/sync/src/worker.rs`
  - transition emission belongs to the sync connection worker after result
    computation.

Flarex differences:

- Convex's backend is process-local around sync state and execution. Flarex's
  Postgres executor can be deployed separately from Cloudflare, so fanout is an
  authenticated HTTP callback.
- A successful callback may report skipped rows for inactive/stale socket
  state. Those rows are still safe to ack because there is no active connection
  state left to update or the connection has already moved past the row.

Known limitations:

- No queue/cron owns repeated delivery batches yet.
- No retry backoff or poison-row visibility for repeated callback failure yet.
- The callback route currently validates deterministic connection-name scope
  but does not verify project ownership; it relies on the maintenance executor
  path plus bearer token.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- sync.test.ts
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm --filter @flarex/executor-nitro typecheck
```

## Current Package Fate And Migration Map

Previous completed checkpoint: `74d8b74` Align docs with Postgres executor
pivot.

Current packages are not all deleted. They split into keep, refactor, legacy
bridge, and new packages:

```txt
packages/flarex
  status: keep and refactor
  role: public SDK, validators, query builder, client, generated API types
  change: remove partition/model APIs and move back toward Convex-style APIs

packages/flarex-dev
  status: keep and refactor
  role: source-package bundling, analyzer, codegen, Vite/local dev
  change: generate Convex-style _generated files without partition metadata

packages/flarex-test
  status: keep and refactor
  role: test SDK and examples harness
  change: add in-process executor core + PGlite path

packages/flarex-backend
  status: legacy/prototype bridge
  role: current Cloudflare Worker/DO backend with DeploymentDO, PartitionDO,
        ExecutionDO, ConnectionDO
  change: do not grow new authoritative DB logic here; port useful contracts
        and tests to the Postgres executor path

apps/backend
  status: legacy/prototype wrapper
  role: thin Wrangler wrapper around packages/flarex-backend
  change: keep until tests no longer depend on the DO-authoritative backend

apps/example
  status: keep and migrate
  role: real example app and E2E target
  change: migrate schema/functions back to defineTable/query/mutation without
        partition selectors
```

New packages:

```txt
packages/persistence-postgres
  status: new
  role: generic document/index persistence, migrations, PGlite adapter,
        real Postgres adapter

packages/executor
  status: new
  role: framework-neutral trusted executor core

packages/executor-nitro
  status: new
  role: thin Nitro/Vercel adapter over @flarex/executor
```

Migration order:

1. Add package shells and PGlite smoke tests.
2. Add in-process executor harness in `flarex-test`.
3. Refactor SDK/codegen away from public partition APIs.
4. Migrate `apps/example`.
5. Port behavior tests from Miniflare/PartitionDO to executor/PGlite.
6. Add real Postgres correctness lane.
7. Retire or archive `PartitionDO`-specific authoritative storage code.

Verification:

```sh
git diff --check
```

## Query-Session Artifact Bridge

Previous completed checkpoint: `92c38cf` Wire live query rerun route to invoke
bridge.

What changed:

- Materialized execution artifacts can now run a query against an existing
  Postgres invoke session through `executeQuerySession(...)`.
- The local runtime materializer exposes an internal query-session route that
  resolves the query function, creates a read-only syscall-backed `ctx.db`, and
  forwards all database reads to `/invoke/syscall`.
- `flarex-dev` exports a helper that adapts this to the executor's
  live-query rerun callback shape.

Why it changed:

The Postgres executor owns transaction/session state, retry, OCC validation,
and read-set capture. Live-query reruns still need to execute arbitrary
developer query code. This bridge lets the executor own the session while the
materialized artifact owns only untrusted user-code execution.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - trusted backend coordinates function execution and transaction state.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code database access is mediated by syscalls.
- `crates/function_runner/src/lib.rs`
  - function execution returns values while backend transaction state remains
    separate.

Flarex differences:

- Convex does not need an HTTP/service-boundary query-session route for local
  reruns. Flarex does because Dynamic Worker execution and the trusted
  Postgres executor are separate runtime components.
- This bridge deliberately does not expose a database connection or transaction
  handle to user code.

Known limitations:

- Only local Miniflare materialized artifacts implement the method today.
- The hosted executor adapter still needs to provide the same callback for
  deployed source packages.
- The bridge supports read-only query sessions; mutations still use the normal
  invoke start/syscall/finish flow.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts
corepack pnpm --filter flarex-backend typecheck
```

## Local Executor HTTP Runtime For Reruns

Previous completed checkpoint: `3f441a8` Add local live query execution host.

What changed:

- Added `createLocalExecutorHttpRuntime(...)` to assemble a local
  Postgres-executor HTTP handler with live-query rerun execution configured.
- The runtime reuses the same `FlarexExecutor` instance for:
  - maintenance route handling,
  - active package lookup,
  - query-session begin/finish through `runLiveQuerySubscriptionWithInvoke`,
  - and artifact `ctx.db` syscalls through `/invoke/syscall`.
- Added test coverage for the complete local HTTP path.

Why it changed:

The trusted executor is the authoritative Postgres transaction owner. The HTTP
adapter already exposed the maintenance route, but local/dev had no default way
to provide the user-code execution callback. This helper gives tests and future
dev servers a concrete assembly point without making Nitro or Elysia own Flarex
platform behavior.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - backend execution owns session/function coordination.
- `crates/function_runner/src/lib.rs`
  - function execution returns values while backend transaction state remains
    authoritative.
- `crates/isolate/src/environment/udf/syscall.rs`
  - database operations are mediated through syscalls.

Flarex differences:

- Convex's executor and function runner are colocated. Flarex deliberately
  composes an HTTP adapter, trusted executor, and Cloudflare-shaped artifact
  runtime for local/dev.
- Nitro remains only an adapter; this helper lives in `flarex-dev` because it
  is local orchestration.

Known limitations:

- Production hosted Dynamic Worker execution still needs its own runtime
  assembly.
- The helper assumes one local `projectId`.
- Manifest-only package metadata cannot be materialized; local/test packages
  must retain module source text.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- executorHttpRuntime.test.ts
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor typecheck
git diff --check
```

## PGlite Rerun Integration

Previous completed checkpoint: `3efd2a0` Wire local executor live query
reruns.

What changed:

- Extended `flarex-dev` runtime tests with a real PGlite executor integration.
- The test uses `createPGlitePersistence()`, `createFlarexExecutor()`,
  `createPostgresFreshnessMirrorStore()`, and
  `createLocalExecutorHttpRuntime()`.
- The document is inserted through executor invoke/session syscalls, not raw
  SQL.
- The stale subscription is rerun through the executor HTTP maintenance route
  and persists the fresh query result back to `live_query_subscriptions`.

Why it changed:

The previous local runtime test used a fake executor to prove route wiring.
This checkpoint proves the local runtime against the actual forward executor
stack and PGlite persistence lane.

Convex references:

- `crates/database/src/transaction.rs`
  - reads happen against a transaction snapshot and are recorded.
- `crates/database/src/write_log.rs`
  - committed writes feed freshness/invalidation.
- `crates/sync/src/worker.rs`
  - stale subscriptions are rerun through backend-owned query execution.

Flarex differences:

- Flarex explicitly persists live-query subscriptions in Postgres and projects
  freshness from outbox events. Convex keeps more of this as integrated backend
  state.
- The local integration uses PGlite as a fast lane; real Postgres remains the
  production correctness target for locks and isolation behavior.

Known limitations:

- JSON null storage in `live_query_subscriptions.result_json` was fixed in the
  next checkpoint. Other JSONB/not-null columns should get equivalent handling
  when they accept JSON null.
- The test uses a document `get` query. Indexed query freshness still needs
  range/version support.
- Hosted Dynamic Worker execution still needs a production runtime equivalent.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- executorHttpRuntime.test.ts
git diff --check
```

## Live-Query JSON Null Persistence

Previous completed checkpoint: `170a4a0` Add PGlite live query rerun
integration.

What changed:

- Added a JSONB value helper for live-query subscription persistence.
- `argsJson: null` and `resultJson: null` now write JSONB `null` instead of
  SQL `NULL`.
- Added PGlite coverage proving live-query rows round-trip JSON null and do
  not store SQL NULL in those not-null columns.

Why it changed:

The PGlite live-query integration exposed a correctness bug in the persistence
boundary. A query result of `null` is a valid JSON result. The registry schema
uses `not null` because every subscription row must have a stored result value,
so the persistence layer must encode JSON null explicitly.

Convex references:

- `npm-packages/convex/src/values/value.ts`
  - null is a valid public value.
- `crates/database/src/value.rs`
  - Convex distinguishes stored value null from absent storage state.

Flarex differences:

- Flarex relies on Postgres JSONB for registry values. The JavaScript database
  adapter can otherwise collapse JSON null into SQL NULL, so the persistence
  package owns that encoding rule.

Known limitations:

- This patch covers `live_query_subscriptions`. Audit other JSONB/not-null
  columns before exposing API paths that intentionally store JSON null there.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter flarex-dev test -- executorHttpRuntime.test.ts
git diff --check
```

## ConnectionDO Materialized Delivery Consumer

Previous completed checkpoint: `3c9952e` Add live query delivery maintenance
route.

What changed:

- Added `ConnectionDO` internal fanout endpoint `POST /deliver/live-query`.
- The endpoint consumes the same `LiveQueryChange` shape stored in
  `live_query_deliveries.payload_json`.
- Accepted deliveries are emitted as public sync `Transition` messages with
  `QueryUpdated` modifications.
- The active connection's `resultHash` is used to skip duplicate and stale
  deliveries.

Why it changed:

The trusted Postgres executor now materializes changed live-query results and
stores durable delivery rows. A Cloudflare socket owner must publish those rows
without rerunning user code and without exposing Postgres state to the client.

Convex references:

- `crates/sync/src/state.rs`
  - result hashes dedupe query transitions.
- `crates/sync/src/worker.rs`
  - transition emission is owned by sync worker state after result computation.

Flarex differences:

- Convex's sync worker owns both result computation and socket transition
  emission. Flarex splits result computation into the trusted executor and
  socket transition emission into `ConnectionDO`.

Known limitations:

- No executor/Nitro delivery callback routes rows to `ConnectionDO` yet.
- `ConnectionDO` active query state is not durable across DO eviction.
- Delivery payloads still do not include logs, journals, or error results.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- sync.test.ts
```

## Live-Query Delivery Maintenance Route

Previous completed checkpoint: `3f96fa6` Add durable live query delivery outbox.

What changed:

- Added `maintenanceLiveQueryDeliveryPath` to `FlarexHttpAppConfig`.
- Added `FlarexLiveQueryDeliveryConfig` with an injected
  `deliver(deliveries)` callback.
- Added `POST /maintenance/live-queries/deliver`, mapping request JSON to
  `executor.runLiveQueryDeliveryBatch(...)`.
- Added stable HTTP behavior:
  - `501` when delivery maintenance is not configured,
  - `400` for invalid limit/body,
  - `405` for non-POST route access,
  - mapped `LiveQueryDeliveryPolicyError` to `400`.
- Added HTTP and Nitro tests for the new route.

Why it changed:

The Postgres executor now has durable changed-query delivery rows. A hosted
executor needs a small maintenance endpoint so a scheduler, cron job, or future
Cloudflare connection fanout service can drain those rows without depending on
Nitro internals.

Convex references:

- `crates/sync/src/worker.rs`
  - owns transition emission after query result changes.
- `crates/sync/src/state.rs`
  - owns query result dedupe before emitting modifications.

Flarex differences:

- Convex does not need an HTTP delivery maintenance route because its sync
  worker owns both query rerun and transition fanout. Flarex uses an adapter
  route because execution and socket delivery can be deployed separately.

Known limitations:

- The route does not itself know how to deliver to WebSockets; the host must
  inject `deliver(deliveries)`.
- No durable lease/claim/visibility timeout exists yet.
- No route-level project ownership validation exists; this remains protected
  by executor capability token.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test -- health.test.ts
```

## Durable Live-Query Delivery Rows

Previous completed checkpoint: `99ed29d` Add live query change delivery payload.

What changed:

- Added Drizzle schema and migration `0010_sparkling_umar.sql` for
  `live_query_deliveries`.
- Added `liveQueryDeliveries` to `flarexSchema`.
- Added Postgres/PGlite row helpers:
  - `insertLiveQueryDelivery(...)`
  - `listUndeliveredLiveQueryDeliveries(...)`
  - `markLiveQueryDeliveriesDelivered(...)`
- Added `recordLiveQueryRerunResult(...)` to persist the refreshed
  `live_query_subscriptions` result and optional delivery row through one
  adapter transaction.
- Extended the framework-neutral executor with delivery batch helpers while
  keeping Nitro/HTTP as adapters.
- Updated PGlite tests to cover migration, delivery row persistence, JSONB
  payload round-trip, and delivered acknowledgement.

Why it changed:

Changed live-query results need a durable handoff between the trusted Postgres
executor and the future Cloudflare socket owner. The executor cannot rely only
on an in-memory callback because the refreshed subscription result is already
persisted by the time fanout happens.

Convex references:

- `crates/sync/src/state.rs`
  - stores query result hashes and returns no modification when a rerun result
    is unchanged.
- `crates/sync/src/worker.rs`
  - owns the loop that reruns invalidated queries and produces transitions.

Flarex differences:

- Convex does not need a separate SQL delivery table for changed query results
  because its sync worker owns the transition channel. Flarex uses Postgres as
  the durable bridge between trusted execution and Cloudflare `ConnectionDO`
  fanout.
- This table is not authoritative document state. It is a retryable delivery
  queue for already-materialized live-query results.

Known limitations:

- No worker leases, `skip locked`, retry counters, or dead-letter state exist
  yet for `live_query_deliveries`.
- No HTTP endpoint exposes the delivery queue directly yet.
- No WebSocket/`ConnectionDO` consumer marks rows delivered.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/persistence-postgres test -- pglite.test.ts
corepack pnpm --filter @flarex/executor test -- liveQueries.test.ts
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm --filter @flarex/executor-nitro test -- health.test.ts
corepack pnpm --filter flarex-dev test -- executorHttpRuntime.test.ts
```

## Live-Query Change Delivery Shape

Previous completed checkpoint: `84b9422` Preserve JSON null live query values.

What changed:

- Added `LiveQueryChange` to the executor public type surface.
- `rerunStaleLiveQuerySubscriptions(...)` now computes stable change payloads
  from changed rerun results and exposes them as `result.changes`.
- Added optional `deliverChanges(...)` support to executor core and the HTTP
  adapter config.
- Verified the PGlite local executor runtime returns the new `changes` shape
  through `/maintenance/live-queries/rerun`.

Why it changed:

The Postgres executor now owns enough state to know which live-query results
changed. The next layer needs a small, stable payload to fan out to connection
owners, but the executor should not know about Cloudflare `ConnectionDO` yet.

Convex references:

- `crates/sync/src/worker.rs`
  - changed query results become client transitions.
- `crates/database/src/subscription.rs`
  - subscription invalidation is separate from result publication.

Flarex differences:

- Convex does rerun and fanout inside backend sync machinery. Flarex exposes
  the delivery shape from the trusted executor so Cloudflare connection owners
  can consume it later.

Known limitations:

- No durable delivery queue exists yet.
- No `ConnectionDO` or WebSocket transition writer consumes the payload yet.
- If `deliverChanges` throws, the maintenance request fails after rerun rows
  have been updated. Production delivery likely needs an outbox-style handoff.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test -- liveQueries.test.ts
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test -- health.test.ts
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- executorHttpRuntime.test.ts
git diff --check
```

## Invoke Replace Syscall

Previous completed checkpoint: `f59e6e9` Rename invoke write staging API.

What changed:

- Added `replace` as a first-class invoke session document write op.
- Added executor syscall shape `{ op: "replace", id, value }`.
- `replace` records the target document read for OCC, stages a full document
  value, and commits only when the document still exists.
- Read-your-writes overlays now treat `replace` as the full transaction-local
  value for `get`, table queries, and indexed queries.
- Staged write coalescing now supports:
  - `insert -> replace` as one final insert,
  - `patch -> replace` as replace,
  - `replace -> patch` as replace with the patch merged into the replacement,
  - `replace -> replace` as the latest replacement,
  - `replace -> delete` as delete,
  - `delete -> replace` as a conflict.
- PGlite and executor tests cover commit, missing targets, coalescing, and
  indexed query movement.

Why it changed:

Convex's `ctx.db.replace(id, value)` is an important part of the database API
surface. It is not just syntactic sugar over patch, because it replaces the
whole document and can remove old fields. Flarex needs this behavior at the
syscall/session layer before generated `ctx.db` can be Convex-compatible.

Convex references:

- `npm-packages/convex/src/server/database.ts`
  - public `DatabaseWriter.replace` API shape.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code reaches database operations through a syscall boundary.
- `crates/database/src/transaction.rs`
  - transaction-local pending writes and read-your-writes behavior.
- `crates/database/src/committer.rs`
  - staged writes validate and commit atomically after OCC checks.

Flarex differences:

- Convex keeps the transaction object in the backend process. Flarex persists
  the invoke session read/write state in the trusted executor so a Cloudflare
  Dynamic Worker can call into it one syscall at a time.
- Replacement is stored as a staged write row and validated only at final
  commit. That keeps Postgres transactions short while preserving OCC
  semantics.

Known limitations:

- Generated `ctx.db.replace` wiring is still separate work; this checkpoint
  only adds the executor/persistence boundary.
- Return validators and generated client API ergonomics still need to expose
  this through the Convex-style user API.
- Like Convex mutations, long-running user logic can still lose an OCC race;
  retry handling remains the mitigation for deterministic mutation bodies.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Generated Replace API Over Executor Syscalls

Previous completed checkpoint: `0e3b118` Add invoke replace syscall.

What changed:

- The SDK/runtime layer now exposes the Postgres executor's `replace` syscall
  through `ctx.db.replace(id, value)`.
- Generated Worker and materialized artifact runtime both forward replacement
  writes to `/invoke/syscall` when using the Postgres executor transport.
- Added a materialized runtime test that pins the emitted `replace` syscall
  body and a full backend runtime test that commits a replacement from user
  code.

Why it changed:

The executor already understood staged replacement writes. Without the
generated/user-code surface, developers still could not use the Convex-style
API. This closes the API-to-executor path for full-document updates.

Convex references:

- `npm-packages/convex/src/server/database.ts`
  - mutation writer includes `replace`.
- `npm-packages/convex/src/server/impl/database_impl.ts`
  - user code forwards replacement operations to the backend.

Flarex differences:

- Flarex keeps Postgres executor calls over HTTP/service-boundary style
  syscalls. Convex keeps the equivalent syscall inside its backend runtime.
- This checkpoint also updates the retained `ExecutionDO` prototype so local
  artifact tests continue to prove behavior while the Postgres path matures.

Known limitations:

- The replace API is still method-level only; generated table writer objects
  are not implemented.
- Replacement values use Flarex's `WithoutSystemFields` typing for now.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
git diff --check
```

## Read-Set Freshness Helper

Previous completed checkpoint: `3913b02` Add freshness delivery handler.

What changed:

- Added `checkReadSetFreshness(...)` in `@flarex/freshness`.
- It checks document and table read dependencies against memory or durable
  Postgres freshness stores.
- It returns explicit `unsupported` for index/range reads.

Why it changed:

The Postgres executor now records read sets and the freshness layer stores
document/table versions. This helper connects those two concepts so future
query rerun and cache code can decide whether a read set is stale.

Convex references:

- `crates/database/src/subscription.rs`
  - read dependency invalidation is a core backend concept.
- `crates/sync/src/worker.rs`
  - stale subscriptions are processed by sync workers.

Flarex differences:

- Convex does not expose this as a separate package helper. Flarex does because
  read-set production, freshness projection, and live sync will be separated.

Known limitations:

- No scheduler or query rerun path uses the helper yet.
- Index/range dependencies remain unsupported.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Executor Live-Query Registry Writer

Previous completed checkpoint: `f32cc4f` Add durable live query registry.

What changed:

- Added `recordLiveQuerySubscription(...)` and
  `removeLiveQuerySubscription(...)` to `@flarex/executor`.
- Moved `@flarex/freshness` to an executor runtime dependency because the
  executor now converts read sets before persisting query state.
- Added `fingerprintJson(...)`, matching the stable JSON fingerprint shape used
  by the legacy Cloudflare sync prototype.
- Extended test persistence with live-query subscription storage.

Why it changed:

Finished query execution has the pieces needed to create durable sync state:
function path, args, begin timestamp, read set, and result. Persisting that at
the executor boundary gives future sync transports a framework-neutral operation
instead of duplicating registry writes in Nitro, tests, and Cloudflare code.

Convex references:

- `crates/sync/src/worker.rs`
  - active query results and transitions are tracked inside the sync worker.
- `crates/database/src/subscription.rs`
  - read dependencies are registered after query execution.

Flarex differences:

- Convex does not expose a separate registry writer because sync and execution
  share backend machinery. Flarex exposes this helper because execution,
  registry persistence, and connection fanout are separate runtime concerns.

Known limitations:

- The helper must be called by future sync code; `finishInvokeSession(...)` does
  not automatically record live subscriptions.
- No scheduler scans the rows yet.
- No rerun path compares the stored `resultHash` yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Stale Live-Query Scanner

Previous completed checkpoint: `d438453` Add executor live query registry writer.

What changed:

- Added `findStaleLiveQuerySubscriptions(...)` to `@flarex/executor`.
- It lists live-query registry rows by deployment and validates each stored
  read set with `checkReadSetFreshness(...)`.
- It returns three explicit groups: `fresh`, `stale`, and `unsupported`.
- Added executor tests for all three classifications.

Why it changed:

The executor now has the read-only primitive a future scheduler needs before it
can rerun stale queries. This keeps stale-query discovery in framework-neutral
core code instead of embedding it first in Nitro, Cloudflare, or tests.

Convex references:

- `crates/sync/src/worker.rs`
  - stale active queries are processed before client transitions are emitted.
- `crates/database/src/subscription.rs`
  - read-set invalidation is the source of staleness.

Flarex differences:

- Convex does this inside the integrated backend worker. Flarex exposes a
  scanner because registry persistence and freshness mirrors are explicit
  package/runtime boundaries.

Known limitations:

- No rerun operation is implemented yet.
- The scanner does not mutate registry rows.
- The scanner does not fan out to connections.
- Index/range reads remain `unsupported`.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Single Live-Query Rerun Primitive

Previous completed checkpoint: `47bd722` Add stale live query scanner.

What changed:

- Added `rerunLiveQuerySubscription(...)` to `@flarex/executor`.
- The primitive calls an injected `runQuery(subscription)` callback.
- It upserts the same live-query registry row with the new query value,
  timestamped read set, begin timestamp, and result hash.
- It reports both the previous and new result hash plus a boolean `changed`
  flag.

Why it changed:

The executor now owns the registry refresh semantics after a rerun, while the
actual query execution remains injectable. This keeps the Postgres executor
framework-neutral and avoids forcing Nitro, Cloudflare, or tests to duplicate
the read-set conversion and hash comparison logic.

Convex references:

- `crates/sync/src/worker.rs`
  - sync workers rerun stale active queries and compare query outputs.
- `crates/database/src/subscription.rs`
  - rerun updates the stored read dependencies.

Flarex differences:

- Convex performs query reruns in the integrated backend/isolate path. Flarex
  exposes a callback because user code execution may be hosted by Dynamic
  Worker, Nitro, or local test harnesses.

Known limitations:

- No batch operation scans and reruns multiple rows yet.
- No HTTP/Nitro route exposes rerun yet.
- No connection fanout uses the `changed` flag yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Batch Stale Live-Query Rerun

Previous completed checkpoint: `d69a73e` Add live query rerun primitive.

What changed:

- Added `rerunStaleLiveQuerySubscriptions(...)`.
- It composes stale-row scanning with single-row rerun.
- It supports an optional positive integer `limit`.
- It returns:
  - the full scan result,
  - changed rerun results,
  - unchanged rerun results,
  - unsupported rows, and
  - whether more stale rows remain.

Why it changed:

The executor now exposes the scheduler's core unit of work without owning the
actual timer, HTTP route, or Cloudflare runtime. This keeps query rerun
semantics close to registry/freshness logic while leaving execution transport
injected through the existing `runQuery` callback.

Convex references:

- `crates/sync/src/worker.rs`
  - worker processing turns invalidated subscriptions into rerun results.
- `crates/database/src/subscription.rs`
  - read dependencies identify stale subscriptions.

Flarex differences:

- Convex's worker owns scheduling and fanout. Flarex currently exposes only the
  framework-neutral batch primitive; Nitro/Cloudflare scheduling and fanout will
  be layered on top.

Known limitations:

- No Nitro or HTTP endpoint calls this helper yet.
- No changed-result fanout is implemented yet.
- Unsupported index/range subscriptions are not rerun.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Live-Query Rerun Maintenance Route

Previous completed checkpoint: `2b91699` Add batch stale live query rerun.

What changed:

- Added an HTTP adapter route for batch stale live-query reruns:
  `POST /maintenance/live-queries/rerun`.
- Added `liveQueryRerun` adapter config carrying:
  - `freshnessStore`, and
  - `runQuery`.
- Added `maintenanceLiveQueryRerunPath` so hosts can customize the route.
- Nitro inherits the route through `createFlarexNitroHandler(...)`.

Why it changed:

The Postgres executor now has framework-neutral batch rerun logic, but
schedulers need a callable boundary. The HTTP/Nitro adapter exposes that
operation without baking in cron, Dynamic Worker execution, or WebSocket fanout.

Convex references:

- `crates/sync/src/worker.rs`
  - worker processing owns stale-query rerun work.
- `crates/application/src/api.rs`
  - backend APIs expose trusted runtime operations.

Flarex differences:

- Convex runs this inside its backend service. Flarex keeps a portable route so
  Nitro on Vercel, local tests, or another host can trigger the same executor
  operation.

Known limitations:

- `runQuery` remains injected; the real invoke/session query bridge is next.
- No changed-result fanout is implemented.
- No scheduler/cron wiring is implemented.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## DeliveryDO HasMore Continuation

Previous completed checkpoint: `9c160d8` Notify DeliveryDO after live query
reruns.

What changed:

- Cloudflare `DeliveryDO` now schedules itself when executor claim responses
  indicate `hasMore: true`.
- The executor remains the source of durable delivery rows and acknowledgement
  state.
- Continuation claims from the beginning of undelivered rows instead of
  persisting a cursor across alarms.

Why no cursor is persisted:

```txt
batch claimed
  -> fanout succeeds
  -> ack succeeds
  -> later alarm claims currently-undelivered rows
```

This is safer than storing `nextCursor` because retry, partial ack, or newly
inserted rows cannot make the DeliveryDO skip an undelivered row. The executor's
`delivered_at` field remains the durable filter.

Convex references:

- `crates/sync/src/worker.rs`
  - backend worker keeps processing active query transitions.
- `crates/database/src/committer.rs`
  - committed state is the source for downstream work.

Flarex differences:

- Convex does not need a Postgres claim/ack boundary. Flarex uses
  `live_query_deliveries.delivered_at` because executor durability and
  Cloudflare fanout are separate runtimes.

Known limitations:

- No lease protocol exists yet for multiple DeliveryDO-style consumers. The
  current safety model depends on one named `DeliveryDO` per deployment.
- No dead-letter handling exists for rows that repeatedly fail fanout.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "continues DeliveryDO"
git diff --check
```

## Pending Live-Query Delivery Deployment Scan

Previous completed checkpoint: `c8f2f93` Continue DeliveryDO drains with
alarms.

What changed:

- Added persistence query
  `listPendingLiveQueryDeliveryDeployments({ limit, cursor })`.
- The query groups undelivered `live_query_deliveries` by `deployment_id`,
  orders deployments by oldest pending row, and returns pending counts.
- Added executor core method
  `executor.listPendingLiveQueryDeliveryDeployments(...)`.
- Added authenticated HTTP adapter route
  `POST /maintenance/live-queries/pending-deployments`.
- Added PGlite, executor, and HTTP adapter coverage.

Why it changed:

Wake notifications are best-effort. If the executor writes durable delivery
rows but the wake request never reaches Cloudflare, the rows must still become
discoverable without Vercel/Nitro running a polling loop.

Flow:

```txt
live_query_deliveries.delivered_at is null
  -> pending-deployments lists affected deployments
  -> Cloudflare SchedulerDO wakes each deployment's DeliveryDO
  -> DeliveryDO claim/fanout/ack remains the only delivery path
```

Convex references:

- `crates/sync/src/worker.rs`
  - backend sync worker can find and process active query work internally.
- `crates/database/src/committer.rs`
  - committed durable metadata drives downstream work.

Flarex differences:

- Convex does not need a pending-deployment endpoint because its sync worker and
  storage live together.
- Flarex exposes a maintenance endpoint because the trusted executor and
  Cloudflare WebSocket runtime are separate deployments.

Known limitations:

- This is a scan/list API, not a lease. Safety still depends on one
  `DeliveryDO` per deployment performing claim/fanout/ack.
- It does not dead-letter permanently failing deployments.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test -- pglite.test.ts
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test -- liveQueries.test.ts
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
git diff --check
```

## Delivery Wake Notification After Rerun

Previous completed checkpoint: `bd74849` Add DeliveryDO live query fanout.

What changed:

- Added a framework-neutral HTTP/Nitro adapter hook
  `liveQueryRerun.notifyDelivery(...)`.
- After the executor reruns stale live queries and writes durable
  `live_query_deliveries` rows, the rerun route now calls this hook only when
  the rerun result contains changed subscriptions.
- Added `createFlarexBackendLiveQueryWakeNotifier(...)` in
  `@flarex/executor-http`.
- The notifier posts to
  `/deployments/:deploymentId/sync/wake-delivery` with the existing capability
  token model.
- Nitro re-exports the wake notifier through `@flarex/executor-nitro`.

Intended production flow:

```txt
executor rerun route
  -> rerun stale query through invoke bridge
  -> persist updated subscription + live_query_deliveries row
  -> notify Cloudflare backend wake route
  -> DeliveryDO claims rows from executor
  -> ConnectionDO fanout
  -> executor ack after successful fanout
```

Convex references:

- `crates/sync/src/worker.rs`
  - sync worker reruns queries and pushes transitions inside the backend.
- `crates/sync/src/state.rs`
  - active query state is advanced after completed fetches.

Flarex differences:

- Convex does not need a wake callback because the sync worker and database
  live in the same backend runtime.
- Flarex splits this into a durable Postgres executor and a Cloudflare
  DeliveryDO. The executor only notifies; Cloudflare owns fanout and must ack
  through the executor.
- The old direct delivery callback helper remains for tests/local compatibility,
  but the preferred durable production path is wake-notify plus claim/ack.

Known limitations:

- The rerun route waits for the wake notification. If notification fails, the
  route fails but durable delivery rows remain for retry.
- No queue/alarm continuation is wired yet when DeliveryDO reports `hasMore`.
- No scheduler is wired yet for retrying deployments that still have pending
  delivery rows after notification failure.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Live-Query Partition Routing Metadata

Previous completed checkpoint: `196cef9` Add live query rerun maintenance
route.

What changed:

- Added nullable `partition_key` to Postgres `live_query_subscriptions`.
- Generated Drizzle migration `0009_smiling_shriek.sql`.
- Added `partitionKey` to `UpsertLiveQuerySubscriptionInput`.
- Added `partitionKey` to executor `RecordLiveQuerySubscriptionInput`.
- Preserved `partitionKey` when `rerunLiveQuerySubscription(...)` updates a
  stored subscription after a rerun.
- Updated PGlite and executor memory tests for insert/update/list/rerun
  behavior.

Why it changed:

The Postgres executor cannot rerun a stored live query through
`beginInvokeSession(...)` unless it knows the route that was used by the
original subscription. Function path and args are not enough for the current
explicit partition-routing API because `prepareInvoke(...)` validates the
request `partitionKey`.

Convex references:

- `crates/sync/src/worker.rs`
  - sync workers rerun queries inside the same backend routing authority.
- `crates/application/src/api.rs`
  - application APIs keep query execution behind trusted backend boundaries.

Flarex differences:

- Convex does not persist an explicit `partitionKey` field for query
  subscriptions. Flarex does because routing is currently explicit and
  subscription rerun will cross from Cloudflare/WebSocket state into the
  trusted Postgres executor.

Known limitations:

- The column is nullable for compatibility with existing test/dev rows.
- The invoke-backed `runQuery` bridge is not implemented yet.
- Client sync registration must pass the live-query partition key into the
  backend registry path before this can be used end to end.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Invoke-Backed Live-Query Rerun Bridge

Previous completed checkpoint: `21de98d` Persist live query partition keys.

What changed:

- Added framework-neutral executor method
  `runLiveQuerySubscriptionWithInvoke(...)`.
- The method validates the stored subscription has a non-empty `partitionKey`.
- It loads deployment metadata and optionally validates project ownership.
- It calls `runInvokeWithRetries(...)` as a query with the stored function path,
  args, and partition key.
- It returns the rerun output needed by
  `rerunLiveQuerySubscription(...)`: `{ value, beginTs, readSet }`.
- `RunInvokeWithRetriesResult` now includes the session `beginTs`.

Why it changed:

The executor already had stale subscription scanning and a maintenance route,
but the route still depended on a completely injected `runQuery` function. This
bridge makes rerun execution use the same backend-owned invoke session and
syscall path as normal query execution.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - backend runner coordinates function execution.
- `crates/isolate/src/environment/udf/syscall.rs`
  - database access goes through syscalls.
- `crates/sync/src/worker.rs`
  - sync worker reruns active queries from backend state.

Flarex differences:

- Flarex does not run bundled user code inside this package. The bridge accepts
  `executeQuery(attempt, subscription)` so a Dynamic Worker host can execute the
  app query while Postgres executor owns the query session.

Known limitations:

- This is an executor-core bridge only. HTTP/Nitro route config still needs to
  provide an execution host that calls it.
- No fanout of changed rerun results is implemented.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
git diff --check
```

## Live-Query Rerun Route Uses Invoke Bridge

Previous completed checkpoint: `895e221` Add invoke backed live query rerun
bridge.

What changed:

- Changed HTTP/Nitro live-query rerun configuration from injected
  `runQuery(subscription)` to injected `executeQuery(attempt, subscription)`.
- Added required `projectId` to the route body so the invoke-backed bridge can
  validate deployment ownership.
- The route now builds `runQuery` by calling
  `executor.runLiveQuerySubscriptionWithInvoke(...)`.
- Added adapter tests that prove `projectId`, `executeQuery`, and stale rerun
  limits cross the correct boundaries.

Why it changed:

The executor core now owns live-query rerun sessions. The HTTP adapter should
not bypass that by accepting a fully formed query result callback. It should
only receive the host's user-code execution function and let executor core own
session lifecycle and read-set capture.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - application function execution is backend-coordinated.
- `crates/sync/src/worker.rs`
  - stale query reruns are backend worker work.

Flarex differences:

- Flarex still has a deployment-host callback because user code executes in the
  Cloudflare Dynamic Worker side, not inside the Nitro/Postgres executor
  package.

Known limitations:

- The concrete Dynamic Worker execution host still needs to be implemented.
- No scheduler invokes this route automatically yet.
- No WebSocket fanout exists for changed rerun results.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Durable Live-Query Registry

Previous completed checkpoint: `7eee662` Add executor read-set freshness adapter.

What changed:

- Added `live_query_subscriptions` to `@flarex/persistence-postgres`.
- Generated Drizzle migration `0008_awesome_susan_delgado.sql`.
- Added low-level persistence helpers for live-query subscription upsert, delete,
  and listing.
- Added the PGlite adapter methods and durable tests.

Why it changed:

The executor/freshness path can now produce and validate timestamped read sets,
but a live-query system also needs a durable place to remember which query a
connection is subscribed to and what result/read-set it last observed. This
registry is that persistence primitive.

Convex references:

- `crates/sync/src/worker.rs`
  - owns active query state and sync transitions.
- `crates/database/src/subscription.rs`
  - stores read dependencies for invalidation decisions.

Flarex differences:

- Convex can keep this state inside the sync/database backend. Flarex persists
  it explicitly because the Postgres executor, Cloudflare connection owner, and
  freshness/cache scheduler are separate runtime pieces.

Known limitations:

- The executor does not write registry rows yet.
- No scheduler scans the registry yet.
- No HTTP/Nitro route exposes registry maintenance yet.
- Registry rows can store index/range read sets before Flarex can validate them.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
git diff --check
```

## Executor Read-Set Freshness Adapter

Previous completed checkpoint: `bd78a7b` Add read-set freshness checker.

What changed:

- Added `readSetToFreshnessReadSet(...)` in `@flarex/freshness`.
- The adapter converts the executor's `InvokeReadSet` shape into
  `FreshnessReadSet` by applying the query session `beginTs` as the default
  observed timestamp.
- If a future/internal read-set entry already includes `observedTs`, the helper
  keeps that value instead of overwriting it.

Why it changed:

Executor query sessions collect reads while user code runs through syscalls.
The freshness checker needs timestamps to decide whether a saved query is
stale. This helper bridges those two shapes without making the executor package
depend on the freshness package in production.

Convex references:

- `crates/database/src/subscription.rs`
  - query read dependencies are stored with subscription state.
- `crates/database/src/transaction.rs`
  - transaction read tracking keeps the timestamp semantics inside the backend.

Flarex differences:

- Convex does not need a public conversion helper because its database,
  transaction, and sync layers live together. Flarex keeps them package-separated
  so the bridge is explicit.

Known limitations:

- Finished executor query responses still expose the timestamp-free
  `InvokeReadSet`; a durable live-query registry must store `beginTs` alongside
  it or use richer internal read rows.
- Index/range read dependencies are converted but remain unsupported by
  freshness validation.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Durable Freshness Delivery Handler

Previous completed checkpoint: `f0fd56f` Add durable freshness store.

What changed:

- Added reusable freshness delivery handler helpers:
  - `createFreshnessDeliveryHandler(store)`, and
  - `createPostgresFreshnessDeliveryHandler(persistence)`.
- The helpers compose `applyOutboxEventsToFreshnessMirror(...)` with the
  selected mirror store.
- Executor tests now use the reusable handler for the normal outbox-to-
  freshness path.

Why it changed:

Future Nitro cron, scheduled workers, or test harnesses should not repeat the
projector wiring. The executor continues to own outbox delivery and
acknowledgement; the freshness package now owns the reusable projection
handler.

Convex references:

- `crates/sync/src/worker.rs`
  - worker code composes committed changes with downstream sync processing.
- `crates/database/src/write_log.rs`
  - committed write metadata is the durable input stream.

Flarex differences:

- Convex's composition is internal to the backend. Flarex exports a helper
  because execution, scheduling, and freshness projection are split packages.

Known limitations:

- The helper is not yet called by Nitro, cron, or a Cloudflare scheduler.
- No query rerun or cache protocol consumes durable freshness rows yet.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Durable Freshness Persistence

Previous completed checkpoint: `0f896fd` Test outbox freshness pipeline.

What changed:

- Added Drizzle schema and migration for durable freshness projection state:
  `freshness_processed_events`, `document_freshness_versions`, and
  `table_freshness_versions`.
- Added transactional `applyFreshnessCommit(...)` to the Postgres persistence
  package.
- Added PGlite adapter methods for applying and reading freshness state.
- Added `PostgresFreshnessMirrorStore` in `@flarex/freshness` so the
  freshness projector can use the durable persistence implementation.

Why it changed:

The outbox dispatcher/projector pipeline was previously correct only against an
in-memory mirror. The Postgres executor path now has a durable correctness
reference for freshness projection and replay idempotency.

Convex references:

- `crates/database/src/write_log.rs`
  - durable committed write metadata is the source of downstream freshness.
- `crates/database/src/subscription.rs`
  - invalidation compares read dependencies with committed write metadata.

Flarex differences:

- Convex does not need separate Postgres freshness tables. Flarex does because
  the trusted transaction executor and Cloudflare sync/cache components are
  separated by a durable handoff.

Known limitations:

- The executor dispatcher is not automatically wired to this durable store yet;
  it remains an injected handler composition.
- No range/index freshness exists.
- No live query rerun or cache protocol consumes these rows yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Executor Freshness Pipeline Test

Previous completed checkpoint: `97d0f0f` Add freshness mirror projector.

What changed:

- Added `@flarex/freshness` as a dev/test dependency of `@flarex/executor`.
- Added executor tests that run `runOutboxDeliveryBatch(...)` with
  `applyOutboxEventsToFreshnessMirror(...)` as the delivery handler.
- Proved successful dispatch marks outbox rows delivered only after freshness
  projection.
- Proved replay after a delivery crash is safe because the freshness mirror
  skips an already processed `(deploymentId, ts, sequence)` event key.

Why it changed:

The executor dispatcher and freshness projector were separate verified pieces.
This checkpoint proves their handoff semantics without introducing a durable
store, Cloudflare DO, or WebSocket fanout.

Convex references:

- `crates/database/src/write_log.rs`
  - committed write metadata is the downstream freshness source.
- `crates/sync/src/worker.rs`
  - backend worker logic consumes committed changes.
- `crates/database/src/subscription.rs`
  - invalidation uses committed dependency metadata.

Flarex differences:

- Convex does not need an explicit package-level dispatcher/projector seam.
  Flarex needs it because the trusted Postgres executor dispatches to separate
  freshness/cache/sync components.

Known limitations:

- No durable freshness store is implemented yet.
- No query rerun or cache minimum-freshness protocol uses the mirror yet.
- No multi-dispatcher outbox lease protocol exists yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Freshness Projector Package Boundary

Previous completed checkpoint: `5526aa2` Add outbox dispatcher core.

What changed:

- Added `@flarex/freshness` as a separate package from
  `@flarex/executor`.
- The executor still owns transaction sessions, outbox dispatch, and
  acknowledgement. Freshness owns projection of committed outbox events into
  document/table version state.
- The first store is in-memory and intended for unit tests and local
  simulation.

Why it changed:

This keeps the trusted executor from growing into a sync/cache implementation.
The executor can call an injected delivery handler, while freshness owns the
idempotent mirror logic that future Cloudflare or Postgres-backed stores will
implement.

Convex references:

- `crates/database/src/write_log.rs`
  - committed write metadata is the durable source.
- `crates/sync/src/worker.rs`
  - backend sync consumes committed changes.

Flarex differences:

- Convex's backend does not need this package split. Flarex uses it because the
  trusted Postgres executor and Cloudflare freshness/cache layers are separate
  runtime boundaries.

Known limitations:

- The freshness package is not wired into the executor dispatcher yet.
- The store is not durable yet.
- Range/index freshness and query rerun logic remain unimplemented.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Outbox Dispatcher Core

Previous completed checkpoint: `2683fe0` Add outbox delivery primitives.

What changed:

- Added `runOutboxDeliveryBatch(...)` to the framework-neutral
  `@flarex/executor` package.
- The batch function:
  - lists undelivered outbox events,
  - calls an injected async `deliver(events)` handler,
  - marks the batch delivered only after the handler succeeds,
  - leaves events undelivered if the handler throws, and
  - returns delivered count, events, `nextCursor`, and `hasMore`.
- Added `OutboxDeliveryPolicyError` for invalid delivery batch options.
- Exposed the dispatcher through `createFlarexExecutor(...)`.
- Updated HTTP/Nitro test fakes to satisfy the expanded executor contract.
- Added executor tests for success, handler failure, empty batches, and invalid
  limits.

Why it changed:

The previous checkpoint made outbox rows consumable, but still required each
future adapter to manually glue together list, deliver, and mark-delivered
steps. The dispatcher core centralizes the reliability boundary:

```txt
read undelivered events
  -> external delivery handler applies them
  -> mark delivered only after success
```

This is the point future Nitro cron, Cloudflare scheduled workers, or DO-based
sync/cache workers should call.

Convex references:

- `crates/sync/src/worker.rs`
  - sync workers process committed database changes and publish transitions.
- `crates/database/src/write_log.rs`
  - durable committed writes drive downstream freshness.
- `crates/database/src/subscription.rs`
  - invalidation is based on committed write metadata.

Flarex differences:

- Convex's sync worker runs against its integrated write-log/backend. Flarex
  needs an injected delivery handler because the target may be a Cloudflare
  freshness mirror, WebSocket connection owner, cache updater, or test sink.
- This dispatcher is at-least-once. Consumers must be idempotent because a
  crash after `deliver(events)` but before `markOutboxEventsDelivered(...)`
  can replay the same events.

Known limitations:

- No real freshness mirror or `ConnectionDO` consumer is implemented yet.
- No claim/lease protocol exists, so this is still intended for a single active
  dispatcher per deployment.
- No retry/backoff scheduling or retention policy exists yet.
- Events remain coarse document/table summaries.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Outbox Delivery Primitives

Previous completed checkpoint: `b4f98a4` Write commit outbox events.

What changed:

- Added `listUndeliveredOutboxEvents(...)` and
  `markOutboxEventsDelivered(...)` to `@flarex/persistence-postgres`.
- Reused the existing `outbox.delivered_at` column, so this checkpoint does
  not require a migration.
- Exposed the delivery lifecycle through the PGlite adapter, executor
  persistence interface, and `createFlarexExecutor(...)`.
- Added a small `packages/executor/src/outbox.ts` facade so future dispatcher
  code can depend on executor behavior instead of raw persistence helpers.
- Updated in-memory and HTTP/Nitro test fakes to satisfy the expanded executor
  contract.
- Added PGlite tests for undelivered listing, cursor ordering, delivery
  marking, and idempotent already-delivered marks.
- Added an executor test proving the public executor facade lists and marks
  undelivered events.

Why it changed:

The previous checkpoint made mutation commits write durable outbox rows. This
checkpoint makes those rows consumable. A sync/cache dispatcher needs a stable
loop:

```txt
list undelivered events -> apply to sync/cache mirror -> mark delivered
```

Without this boundary, the next live-sync layer would either poll all outbox
rows forever or couple itself directly to Postgres table details.

Convex references:

- `crates/database/src/write_log.rs`
  - committed write-log entries are the durable freshness source.
- `crates/sync/src/worker.rs`
  - sync workers consume committed database changes and publish client
    transitions.
- `crates/database/src/subscription.rs`
  - subscriptions are invalidated from committed write metadata.

Flarex differences:

- Convex does not expose a Postgres-style delivery acknowledgement table
  because its write-log and sync workers are integrated inside the backend.
  Flarex needs an explicit `delivered_at` acknowledgement because the trusted
  executor, Cloudflare cache/freshness mirrors, and WebSocket connection DOs
  are separate runtime components.
- This is a single-dispatcher primitive. It does not yet claim or lease events
  for multiple concurrent dispatchers.

Known limitations:

- No outbox dispatcher loop exists yet.
- No `ConnectionDO`, freshness DO, or cache mirror consumes these events yet.
- No claim/lease columns exist, so two independent dispatchers could read the
  same undelivered events before either marks them delivered.
- Event payloads are still coarse document/table summaries, not precise
  query-range invalidation records.
- Real Postgres concurrency and retention behavior still need the non-PGlite
  correctness lane.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Commit Outbox Events

Previous completed checkpoint: `c71110d` Expose ctx db replace.

What changed:

- Added a `packages/persistence-postgres/src/outbox.ts` helper module over the
  existing `outbox` table.
- `commitInvokeSessionWrites(...)` now writes one durable commit event with
  `sequence = 0` after the commit row and before finishing the invoke session.
- The event carries:
  - `type: "commit"`,
  - `deploymentId`,
  - `commitTs`,
  - `source`,
  - sorted `changedTableIds`,
  - sorted `changedDocumentIds`, and
  - the commit `writeSummary`.
- Exposed `insertOutboxEvent(...)` and `listOutboxEvents(...)` through the
  PGlite persistence adapter and executor persistence interface.
- Updated in-memory executor test persistence so successful commits append the
  same outbox event shape.
- Added PGlite and executor tests proving successful mutation commits create
  outbox rows and failed commits do not.

Why it changed:

Postgres is now the authoritative mutation path. Live sync and Cloudflare
freshness mirrors need a durable committed change stream they can replay. A
commit row alone is useful for audit, but sync workers need a narrow, ordered
outbox feed with the changed document/table ids.

Convex references:

- `crates/database/src/write_log.rs`
  - committed write-log entries are the durable freshness source.
- `crates/database/src/subscription.rs`
  - subscriptions are invalidated from committed write information.
- `crates/sync/src/worker.rs`
  - sync workers turn committed database changes into client transitions.

Flarex differences:

- Convex does not need a separate Postgres transactional outbox table because
  its database/write-log/sync worker stack is integrated. Flarex needs an
  explicit outbox because Postgres, trusted executor, and Cloudflare sync
  workers are separate runtime pieces.
- This checkpoint only writes one commit event per mutation. It does not yet
  dispatch, acknowledge, retain, or shard outbox events.

Known limitations:

- No outbox dispatcher exists yet.
- `delivered_at` is still unused.
- Event payloads are coarse document/table changes, not precise query-range
  invalidation records.
- Real Postgres concurrency and retention behavior still need a non-PGlite
  correctness lane.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Invoke OCC Retry Coordinator

Previous completed checkpoint: `3c81156` Document interactive invoke
transactions.

What changed:

- Added `runInvokeWithRetries(...)` to `@flarex/executor`.
- The coordinator begins a fresh invoke session for each attempt, runs a
  framework-provided attempt callback, finishes the session, and retries the
  whole mutation when commit-time OCC rejects the attempt.
- Failed attempts are aborted so staged writes do not remain active until the
  stale-session cleanup sweep.
- Added `InvokeRetryExhaustedError` and `InvokeRetryPolicyError`.
- Added executor tests proving:
  - the first stale attempt can hit OCC internally,
  - the second attempt sees the newer snapshot and succeeds,
  - the client-visible result is success with `attempts: 2`, and
  - repeated OCC conflicts produce a retry-exhausted error after the configured
    budget.

Why it changed:

The client should not see the first OCC conflict for a deterministic mutation.
Convex-style behavior is to rerun the whole mutation against a newer snapshot.
Retrying only `/invoke/finish` would be incorrect because user code decisions
can change when the first read changes.

Convex references:

- `crates/database/src/committer.rs`
  - commit-time conflicts are part of the transaction path.
- `crates/database/src/transaction.rs`
  - mutation state is attempt-local and unpublished until commit.
- `crates/application/src/application_function_runner/mod.rs`
  - application function execution owns the retry boundary, not the client.

Flarex differences:

- Convex reruns inside the trusted Rust backend/isolate integration. Flarex's
  retry coordinator is framework-neutral executor core and receives an attempt
  callback so the future Dynamic Worker bridge can rerun user TypeScript.
- This does not expose retry attempts over HTTP yet. HTTP/Nitro routes still
  expose the primitive begin/syscall/finish API.

Known limitations:

- No exponential backoff or jitter yet.
- No retry telemetry beyond returning `attempts`.
- No integration with the generated Dynamic Worker runtime yet.
- Read-your-own-writes overlay is still the next missing correctness piece for
  reads inside a single open attempt.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test -- sessions.test.ts
git diff --check
```

## Invoke Read-Your-Writes Overlay

Previous completed checkpoint: `0273eb8` Add invoke OCC retry coordinator.

What changed:

- Added an executor transaction-view helper for open invoke sessions.
- `db.get` now reads from the persisted `beginTs` snapshot plus the current
  session's staged document write for that ID.
- Table query syscalls now overlay staged inserts, patches, and deletes before
  returning a page.
- Added executor tests for:
  - insert then get,
  - patch then get,
  - delete then get, and
  - table query after staged insert/patch/delete.

Why it changed:

Convex mutations can write and then read again in the same function. The
executor must therefore answer each syscall from the mutation's transaction
view, not only from the persisted snapshot.

Convex references:

- `crates/database/src/transaction.rs`
  - transaction state exposes reads over pending writes.
- `crates/database/src/bootstrap_model/index/mod.rs`
  - database reads flow through indexed/table access paths that share
    transaction state.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code receives database results through syscalls.

Flarex differences:

- Flarex computes the staged overlay in executor TypeScript against persisted
  invoke-session writes. Convex keeps this state in the Rust transaction object.
- Table query overlay fetches the full table snapshot before applying the limit
  for correctness. A later storage-level overlay should avoid that for large
  tables.

Known limitations:

- Indexed query overlay is not implemented yet.
- Multiple staged writes to the same document are still rejected by the
  persistence layer; Convex-style write coalescing remains future work.
- Table query pagination is still conservative and does not expose exact
  Convex page interval behavior.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Invoke Same-Document Write Coalescing

Previous completed checkpoint: `0d6431e` Add indexed read-your-writes overlay.

What changed:

- Changed the invoke document write staging path from insert-only semantics to
  stage-or-coalesce semantics.
- Coalescing now supports:
  - `insert -> patch` as one final insert,
  - `patch -> patch` as one merged patch,
  - `insert -> delete` as no staged write,
  - `patch -> delete` as one delete, and
  - duplicate `insert -> insert` as the existing duplicate-insert error.
- Added `InvokeSessionDocumentWriteConflictError` for invalid sequences such as
  `delete -> patch`.
- Updated executor `patch` and `delete` syscalls to validate against the
  transaction view, not only the persisted `beginTs` snapshot.
- Added PGlite and executor tests for coalescing and Convex-style
  `insert -> patch`, repeated patch, and `insert -> delete` mutation flows.

Why it changed:

Convex mutations allow helpers, loops, and sequential writes to touch the same
document inside one mutation. Flarex needs the same effective behavior inside a
single invoke session so ordinary mutation code does not fail because an
earlier helper already staged a write.

Convex references:

- `crates/database/src/transaction.rs`
  - pending writes live in transaction state and are collapsed into effective
    document changes before commit.
- `crates/database/src/committer.rs`
  - commit consumes final document writes, not every intermediate user-level
    operation.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code can issue multiple database syscalls during one mutation.

Flarex differences:

- Convex coalesces in memory inside the Rust transaction object. Flarex
  coalesces persisted invoke-session rows so the Dynamic Worker/executor split
  can survive process boundaries.
- `insert -> delete` removes the staged row; the commit still finishes the
  invoke session but writes no document revision for that document.

Known limitations:

- `replace` is still not exposed or coalesced.
- Coalescing is shallow object merge for patches, matching current patch
  semantics.
- Public API naming was cleaned up in the following checkpoint.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Invoke Staged-Write API Naming Cleanup

Previous completed checkpoint: `d31f7cf` Coalesce invoke document writes.

What changed:

- Renamed persistence and executor interface methods from
  `insertInvokeSessionDocumentWrite(...)` to
  `stageInvokeSessionDocumentWrite(...)`.
- Renamed `InsertInvokeSessionDocumentWriteInput` to
  `StageInvokeSessionDocumentWriteInput`.
- Updated PGlite, executor, Nitro test helpers, and executor syscalls to use
  the stage/coalesce name.
- Kept database table names unchanged; this is an API naming cleanup only.

Why it changed:

The previous method name became misleading after same-document coalescing. The
operation now means "record the effective staged write for this invoke session,"
not "insert a new row and fail on duplicates."

Convex references:

- `crates/database/src/transaction.rs`
  - transaction state accumulates pending writes rather than exposing an
    insert-only staging primitive.
- `crates/database/src/committer.rs`
  - commit receives final transaction writes after earlier staging/coalescing.

Flarex differences:

- Flarex still persists staged writes in Postgres rows because user execution
  can be separated from the trusted executor. The rename clarifies that the row
  is an effective staged write, not an append-only operation log.

Known limitations:

- Physical table name `invoke_session_document_writes` remains correct and was
  not migrated.
- Existing helper names for session metadata/read insertion still use
  `insert...` because they are true insert-or-dedupe operations.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Invoke Indexed Read-Your-Writes Overlay

Previous completed checkpoint: `3ddfc33` Add invoke read-your-writes overlay.

What changed:

- Extended executor transaction-view reads to indexed query syscalls.
- Indexed queries now merge persisted index results at `beginTs` with staged
  inserts, patches, and deletes for the indexed table.
- Staged index keys use the same `encodeIndexValues(...)` codec as
  `@flarex/persistence-postgres` commit-time index maintenance.
- Updated the executor memory persistence helper to model index keys and range
  filtering instead of returning table-order placeholders.
- Added executor coverage for:
  - staged delete removing a document from the indexed result,
  - staged patch moving a document into the indexed result,
  - staged insert appearing in the indexed result, and
  - staged patch moving a document out of the indexed result.

Why it changed:

Convex-style mutations commonly write and then query via
`ctx.db.query(table).withIndex(...)`. Those indexed reads must observe the same
transaction view as `db.get` and table scans.

Convex references:

- `crates/database/src/transaction.rs`
  - transaction reads are evaluated against pending writes.
- `crates/common/src/index.rs`
  - index keys include indexed fields plus the document ID for total order.
- `crates/database/src/committer.rs`
  - document writes and index writes are computed together at commit.

Flarex differences:

- Flarex computes staged index overlay in executor TypeScript from persisted
  session writes. Convex keeps this in the Rust transaction/database layer.
- The overlay asks persistence for a conservative base index page and then
  merges staged writes in memory.

Known limitations:

- Pagination is still conservative; exact Convex page interval behavior remains
  future work.
- The base persistence call still has its own page cap, so a storage-level
  overlay path is needed before this is production-ready for very large ranges.
- Multiple writes to the same document are still rejected instead of coalesced.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Documentation Synchronization Update

Previous completed checkpoint: `e80e176` Plan Postgres executor package
boundaries.

Aligned design notes and older DO-shard roadmaps with this executor pivot:

- Postgres-authoritative sync is now the forward path, not an optional
  alternative.
- `PartitionDO` authoritative storage is documented as prototype/legacy
  scaffolding.
- Schema placement, function routing, sync protocol, and OCC roadmaps now start
  with superseded/pivot notices.
- `AGENTS.md` now points new authoritative storage and transaction work at the
  Postgres executor packages and PGlite local/test lane.

Verification:

```sh
git diff --check
```

## Decision

The trusted Postgres transaction executor should be framework-neutral core
first, with Nitro/Vercel as a thin deployment adapter.

```txt
packages/persistence-postgres
  Convex-style generic document/index persistence
  schema migrations
  OCC read validation
  commit/write-log/outbox transaction helpers
  adapters for real Postgres and PGlite

packages/executor
  trusted executor core
  createFlarexExecutor()
  stable fetch/request protocol
  auth and deployment scoping
  query/mutation execution-session endpoints
  no Nitro, Vercel, Cloudflare, or UI imports

packages/executor-nitro
  Nitro adapter only
  maps Nitro events/routes to @flarex/executor fetch handlers
  Vercel deployment configuration helpers

packages/flarex-test
  in-process executor harness
  PGlite-backed local/test persistence
  app/client helpers for E2E without booting a Nitro app
```

Production shape:

```txt
Cloudflare Dynamic Worker
  runs untrusted user function code
  emits ctx.db syscalls / read-set / write intent

Cloudflare ConnectionDO
  owns WebSocket sync sessions and fanout

Nitro on Vercel
  thin HTTP adapter
  calls framework-neutral trusted executor core

Trusted executor core
  opens short Postgres transactions
  validates read sets and predicates
  applies document/index writes
  writes commits and outbox events
  returns commitVersion

Postgres
  authoritative multitenant document/index store
```

Local/test shape:

```txt
Vite plugin or test harness
  -> in-process @flarex/executor core
  -> PGlite persistence adapter
  -> same generated client/server APIs
```

The executor protocol must be stable while the host remains replaceable.
Nitro is a deployment adapter, not the core architecture.

## Why

The current repo started with a Cloudflare Durable Object authoritative path:

```txt
ExecutionDO -> SingleShardTransaction -> PartitionDO
```

That was useful for proving Convex-like syscall sessions, read sets,
return-validation-before-commit, index reads, and `/sync` behavior. But it also
forced public API concepts that no longer fit the Postgres-authoritative plan:

- `definePartitionTable`
- `defineColocatedTable`
- `defineGlobalTable`
- generated `model`
- `partition: model.table`
- caller-supplied `partitionKey`
- partition-local sync invalidation

With Postgres as the source of truth, the public API should move back closer to
Convex:

```ts
export default defineSchema({
  users: defineTable({
    name: v.string(),
  }),
});

export const update = mutation({
  args: { userId: v.id("users"), name: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { name: args.name });
  },
});
```

No partition API should be required for normal `query` and `mutation`.

## Current Repo Refactor Approach

Refactor by preserving the useful boundaries and deleting the wrong public
model.

Keep and adapt:

- source-package bundling from `packages/flarex-dev`
- authoritative backend push/analyze/finish flow
- generated `_generated/api`, `_generated/server`, and `_generated/dataModel`
- execution-session/syscall mental model
- return validation before commit
- read-set collection and OCC conflict shape
- `/invoke` and `/sync` compatibility targets
- example app and E2E structure

Replace:

- `PartitionDO` as authoritative database
- single-shard transaction core
- generated `model` partition selectors
- partition-scoped mutation type enforcement
- partition-local subscription invalidation
- app-facing `partitionKey` requirements

Transitional bridge:

```txt
Phase 1:
  remove public partition API from SDK/codegen
  keep existing backend tests passing through a temporary global legacy route
  do not expose the bridge to app developers

Phase 2:
  add @flarex/persistence-postgres persistence interfaces and PGlite adapter
  port generic document/index schema into SQL migrations

Phase 3:
  add @flarex/executor core using the persistence interface
  tests call executor core directly with PGlite

Phase 4:
  add @flarex/executor-nitro adapter
  production deploys Nitro on Vercel near Postgres

Phase 5:
  retire PartitionDO commit path
  keep Cloudflare DOs for sync, connection/session state, and cache/freshness
```

## PGlite Policy

Use PGlite for local development and fast tests.

PGlite is suitable for this lane because official docs describe:

- Node/Bun/Deno and browser usage,
- in-memory Postgres with `new PGlite()` or `PGlite.create(...)`,
- filesystem persistence for local development,
- parameterized `.query(...)`,
- multi-statement `.exec(...)` for migrations,
- `.transaction(...)` callback semantics with automatic commit/rollback.

PGlite is not the only correctness gate. Real Postgres remains required for:

- isolation-level behavior,
- lock and advisory-lock behavior,
- connection pool behavior,
- production query plans and indexes,
- outbox dispatcher behavior under concurrent writes,
- any feature that depends on real Postgres extensions or server settings.

Testing lanes:

```txt
fast default lane:
  PGlite
  executor core in-process
  no Nitro app
  no Vercel
  used by package tests, examples, and local dev

real database lane:
  real Postgres
  executor core in-process or over HTTP
  validates transaction isolation, locks, migrations, and outbox

adapter smoke lane:
  Nitro adapter
  small HTTP tests only
  proves route mapping and auth, not transaction semantics
```

## Executor Core Contract

The first executor core should expose a Fetch-like interface and direct methods:

```ts
export function createFlarexExecutor(config: {
  persistence: FlarexPersistence;
  auth: ExecutorAuth;
  clock?: Clock;
  ids?: IdGenerator;
}): FlarexExecutor;

export interface FlarexExecutor {
  fetch(request: Request): Promise<Response>;
  executeMutation(input: ExecuteMutationInput): Promise<ExecuteMutationResult>;
  executeQuery(input: ExecuteQueryInput): Promise<ExecuteQueryResult>;
}
```

Persistence should be injected:

```ts
export interface FlarexPersistence {
  migrate(): Promise<void>;
  beginTransaction<T>(fn: (tx: FlarexPersistenceTx) => Promise<T>): Promise<T>;
}
```

The Nitro adapter should only wrap this:

```ts
export default defineEventHandler(event => {
  return handleFlarexNitroEvent(event, executor);
});
```

## Convex References

- `crates/database/src/transaction.rs`
  - user execution accumulates reads and writes before final commit.
- `crates/database/src/committer.rs`
  - commit validation is the authoritative boundary.
- `crates/postgres/src/sql.rs`
  - documents and indexes use generic physical tables with multitenant
    `instance_name` support.
- `crates/application/src/application_function_runner/mod.rs`
  - function execution is routed through a backend-owned runner.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev orchestrates backend, codegen, and push rather than turning the
    app into the backend.

## Flarex Differences

- Convex's executor and database are close in one backend runtime. Flarex runs
  user code in Cloudflare and commits in a trusted Nitro/Vercel executor near
  Postgres.
- Convex does not need a Nitro adapter. Flarex needs framework-neutral core so
  Nitro, tests, and local dev all reuse the same transaction implementation.
- Convex's public API does not expose shard placement for normal app tables.
  Flarex's previous DO prototype did; the Postgres path should remove that
  public API.

## Known Limitations

- No `@flarex/persistence-postgres`, `@flarex/executor`, or `@flarex/executor-nitro` package
  exists yet.
- Existing backend code still commits through `PartitionDO`.
- Existing generated server code still emits partition model helpers.
- Existing example schema still uses partition/colocation helpers.
- PGlite can keep local and test loops fast, but it cannot replace real
  Postgres correctness testing.

## First Implementation Step

Create package boundaries and tests before writing full SQL behavior:

1. Add `packages/persistence-postgres` with a tiny persistence interface and PGlite
   adapter scaffold.
2. Add `packages/executor` with `createFlarexExecutor(...)` and a
   framework-agnostic health function.
3. Add `packages/executor-nitro` as adapter-only.
4. Add one `flarex-test` in-process executor harness test using PGlite.
5. Do not wire the main SDK/client path to it yet.

This keeps the next code change small and proves the new package direction
without mixing it with the large SDK/codegen partition API removal.

## Health Endpoint Package Shell

Previous completed checkpoint: `af85c26` Record executor package migration and
cache layers.

What changed:

- Added `packages/executor` as the framework-neutral trusted executor
  core package.
- Added `createFlarexExecutor()` with a direct `health()` method.
- Added `packages/executor-nitro` as an adapter-only package that
  maps `GET /health` from an incoming web `Request` to the executor core.
- Added focused health tests for both packages.

Why it changed:

The old Cloudflare DO prototype uses `stub.fetch()` because Durable Objects are
separate actors. The Postgres executor path should not keep that internal
shape. The executor core should be callable directly by tests, local dev, and
framework adapters. HTTP/fetch routing should exist only in adapters and real
network boundaries, such as Cloudflare Dynamic Worker to trusted executor, or
Nitro/Vercel route to core.

Convex references:

- `crates/function_runner/src/lib.rs`
  - Convex keeps function execution behind a backend-owned trait boundary.
- `crates/function_runner/src/in_process_function_runner.rs`
  - Convex has an in-process runner path for local/backend execution.
- `crates/application/src/application_function_runner/mod.rs`
  - application routing calls the backend function runner rather than exposing
    storage directly to user code.

Flarex differences:

- Convex does not need a Nitro adapter. Flarex does because the trusted
  Postgres executor may be deployed as Nitro/Vercel while Cloudflare runs user
  code and sync connections.
- Convex's function runner executes user code near the database transaction.
  Flarex's first executor core only exposes a direct health function; the
  future syscall/session API will keep a logical transaction session and avoid
  holding a Postgres transaction open while Cloudflare user code runs.
- The Nitro package intentionally imports no Nitro runtime yet. It is currently
  a minimal adapter seam over web-standard `Request`/`Response`; concrete Nitro
  route helpers can be added once the executor protocol exists.

Known limitations:

- No Postgres or PGlite persistence package exists yet.
- No execution session, syscall API, commit path, or OCC validation exists in
  the new executor packages yet.
- Existing DO prototype packages still own the old invoke/sync behavior.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Framework-Agnostic Core Correction

Previous completed checkpoint: `2107439` Add executor health endpoint packages.

What changed:

- Removed `fetch(request)` and `healthPath` from `packages/executor`.
- Kept `packages/executor` as direct core functions only:
  `createFlarexExecutor().health()`.
- Moved HTTP route matching, JSON response creation, and 404 handling into
  `packages/executor-nitro`.
- Updated tests so the core package verifies direct function behavior and the
  adapter package verifies endpoint behavior.

Why it changed:

The trusted executor core must stay framework-agnostic. It should not own API
endpoint names, path matching, `Request`, or `Response` behavior. Those are
adapter concerns. This keeps local tests, future PGlite harnesses, Nitro, and
any other host able to reuse the same executor core without inheriting a
transport contract.

Convex references:

- `crates/function_runner/src/lib.rs`
  - Convex's function runner is a backend interface, not an HTTP router.
- `crates/function_runner/src/in_process_function_runner.rs`
  - local/backend execution can call runner logic in process.
- `crates/application/src/application_function_runner/mod.rs`
  - request routing is outside the function runner itself.

Flarex differences:

- Flarex still needs deployed HTTP adapters because Cloudflare user-code
  runtime will call the trusted executor over a network boundary.
- The endpoint contract belongs to adapter packages such as
  `@flarex/executor-nitro`; direct executor methods remain the source of
  behavior.

Known limitations:

- The Nitro adapter is still a minimal web-standard adapter, not a real Nitro
  route module.
- No session/syscall/OCC methods exist yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Convex-Style Postgres Persistence Package

Previous completed checkpoint: `39b9555` Keep executor core transport
agnostic.

What changed:

- Added `packages/persistence-postgres`.
- Added framework-neutral persistence interfaces:
  `FlarexPersistence`, `FlarexPersistenceTx`, `check()`, `migrate()`, and
  `transaction()`.
- Added a PGlite adapter for local and fast test lanes.
- Added a first migration named `convex_style_multitenant_persistence`.
- Added tests for connectivity, idempotent migration, expected table shape, and
  transaction rollback.

Convex schema copied:

- `documents`
  - Convex-like columns: tenant, `id`, `ts`, `table_id`, `json_value`,
    `deleted`, `prev_ts`.
  - Primary key follows Convex's multitenant order:
    `(deployment_id, ts, table_id, id)`.
  - Added Convex-style table/id and table/ts indexes.
- `indexes`
  - Convex-like columns: tenant, `index_id`, `ts`, `key_prefix`,
    `key_suffix`, `key_sha256`, `deleted`, `table_id`, `document_id`.
  - Primary key follows Convex's multitenant shape:
    `(deployment_id, index_id, key_sha256, ts)`.
- `leases`
- `read_only`
- `persistence_globals`

Flarex-owned additions:

- `flarex_schema_migrations`
  - local migration tracking.
- `deployments`
  - hosted platform deployment metadata.
- `commits`
  - explicit commit record for future OCC, sync, idempotency, and audit.
- `outbox`
  - durable live sync/cache invalidation stream.

Why it changed:

The earlier rough design used names like `document_revisions`,
`index_entries`, and JSONB document values. Copying Convex more closely is the
better base. Convex's current Postgres persistence stores generic document and
index history as byte-encoded rows, not one SQL table per developer table.
Flarex should keep that shape and layer platform metadata beside it.

Convex references:

- `crates/postgres/src/sql.rs`
  - source for `documents`, `indexes`, `leases`, `read_only`, and
    `persistence_globals` DDL.
- `crates/postgres/src/lib.rs`
  - source for multitenant `instance_name` option and persistence init flow.
- `crates/postgres/src/connection.rs`
  - source for schema/pool boundary and why persistence init must be
    idempotent.

Flarex differences:

- Convex calls the tenant discriminator `instance_name`; Flarex uses
  `deployment_id`.
- Convex uses Rust/tokio-postgres and its own pool, timeout, lease, and
  retention machinery. Flarex starts with a TypeScript interface and PGlite
  adapter, then will add real Postgres separately.
- Convex does not need Flarex's `deployments`, `commits`, or `outbox` tables in
  this exact form. They support the hosted executor and Cloudflare sync/cache
  architecture.

Known limitations:

- No real Postgres adapter yet.
- No document codec yet, so the `bytea` value fields are schema-ready but not
  used by executor sessions.
- No OCC commit implementation yet.
- No lease/read-only behavior beyond table creation yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
git diff --check
```

## Drizzle Schema And Metadata Boundary

Previous completed checkpoint: `5874332` Add Convex-style Postgres
persistence package.

What changed:

- Added Drizzle ORM to `packages/persistence-postgres`.
- Added `src/schema.ts` with Drizzle `pgTable` definitions for all current
  persistence tables.
- Added a custom Drizzle `bytea` column helper so Convex-style binary document
  and index values stay represented in the typed schema.
- Updated the PGlite adapter to create and expose a Drizzle database handle.
- Moved migration tracking in the PGlite path to Drizzle
  `select`/`insert` calls.
- Added a typed metadata test that inserts and reads `deployments` through
  Drizzle.

Why it changed:

Using only raw SQL would make the TypeScript persistence layer drift quickly as
platform metadata grows. Drizzle gives us typed table definitions and normal
metadata queries while still allowing exact SQL for Convex's hot document/index
paths.

Convex references:

- `crates/postgres/src/sql.rs`
  - still the source for the exact `documents` and `indexes` physical shape.
- `crates/postgres/src/lib.rs`
  - still the reference for multitenant persistence initialization.

Drizzle references:

- Official Drizzle PGlite docs show wrapping a PGlite client with
  `drizzle({ client })`.
- Official PGlite ORM support docs list Drizzle as a supported ORM with
  schema/query/migration support.

Flarex differences:

- Convex is Rust and hand-written SQL. Flarex is TypeScript, so Drizzle is a
  good fit for schema definitions, local PGlite wiring, and platform metadata.
- We are not replacing Convex's hand-tuned engine SQL with ORM query builder
  calls. The engine paths remain explicit SQL until proven safe to abstract.

Known limitations:

- No drizzle-kit generated migration files yet.
- The first migration still uses explicit SQL strings.
- The real Postgres adapter is not implemented yet.
- Drizzle is only exercised for migration tracking and deployment metadata so
  far.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
git diff --check
```

## Package-Local Drizzle Kit Migrations

Previous completed checkpoint: `a3692cf` Add Drizzle schema for Postgres
persistence.

What changed:

- Added `packages/persistence-postgres/drizzle.config.ts`.
- Added package-local scripts:
  - `db:generate`
  - `db:check`
- Added `drizzle-kit` as a `@flarex/persistence-postgres` dev dependency.
- Generated the first package-local migration under
  `packages/persistence-postgres/drizzle/`.
- Replaced the custom in-source migration runner with
  `drizzle-orm/pglite/migrator`.
- Removed the custom `flarex_schema_migrations` app table and switched to
  Drizzle's own migration log table under the `drizzle` schema.
- Changed `FlarexPersistence.migrate()` to return `Promise<void>` because the
  Drizzle migrator applies migrations but does not report an applied list.

Why it changed:

The Postgres package owns persistence schema and migration history. Drizzle Kit
should live package-locally instead of at the workspace root, so schema changes,
generated SQL, and migration metadata stay with `@flarex/persistence-postgres`.

Convex references:

- `crates/postgres/src/sql.rs`
  - remains the reference for the exact document/index physical schema.
- `crates/postgres/src/lib.rs`
  - remains the reference for idempotent persistence initialization.

Drizzle references:

- Drizzle Kit `generate` creates SQL migration files from Drizzle schema.
- Drizzle Kit `check` validates migration history.
- `drizzle-orm/pglite/migrator` applies generated migrations to PGlite.

Flarex differences:

- Convex does not use Drizzle Kit; Flarex does because the persistence layer is
  TypeScript.
- The generated initial migration was manually adjusted from `"bytea"` to
  `bytea` because Drizzle Kit quotes custom types. This is intentional for the
  Convex-compatible binary storage columns.

Known limitations:

- The real Postgres adapter still is not implemented.
- The `bytea` custom type workaround means generated migrations must be
  reviewed before commit whenever binary engine columns change.
- No full document/index read/write API exists yet.

Verification:

```sh
corepack pnpm db:check
corepack pnpm typecheck
corepack pnpm test
git diff --check
```

## Drizzle Raw SQL Persistence Interface

Previous completed checkpoint: `481dd5d` Use package-local Drizzle Kit
migrations.

What changed:

- Updated `FlarexSqlClient` so persistence and transaction clients expose:
  `execute(query: SQLWrapper | string)`.
- Re-exported Drizzle's `sql` helper from `@flarex/persistence-postgres`.
- Added PGlite adapter support for executing Drizzle raw SQL on both the root
  persistence client and transaction client.
- Added a test proving `persistence.execute(sql``...``)` and
  `tx.execute(sql``...``)` both work.

Why it changed:

The engine paths should use Drizzle's typed SQL objects instead of ad hoc
string-only interfaces. This gives us a consistent raw SQL contract for
Convex-style hot paths while keeping Drizzle as the schema/query framework.

Convex references:

- `crates/postgres/src/sql.rs`
  - Convex keeps hot document/index SQL explicit and deliberate.
- `crates/database/src/committer.rs`
  - future OCC checks need explicit read/write validation queries.

Flarex differences:

- Convex's SQL is Rust string constants. Flarex should express equivalent hot
  SQL through Drizzle `sql``...`` objects where possible.
- Plain string `exec/query` remains in the interface for adapter plumbing and
  PGlite compatibility, but new engine code should prefer `execute(sql``...``)`.

Known limitations:

- The interface currently returns a Postgres-like `QueryResult<Row>` instead of
  the exact Drizzle driver result type because future PGlite and real Postgres
  adapters should share a stable persistence contract.
- No actual document/index hot-path query methods exist yet.

Verification:

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm db:check
git diff --check
```

## Executor Health Uses Persistence Injection

Previous completed checkpoint: `11c82e0` Expose Drizzle raw SQL persistence
interface.

What changed:

- Added `@flarex/persistence-postgres` as a dependency of `@flarex/executor`.
- Made `createFlarexExecutor({ persistence })` require a persistence
  dependency.
- Changed `executor.health()` from synchronous to async.
- Added persistence dependency health to the executor health payload.
- Added degraded health reporting when `persistence.check()` fails.
- Updated `@flarex/executor-nitro` so the adapter requires an injected executor
  and awaits async health.
- Added tests for healthy persistence, degraded persistence, adapter health
  serialization, and adapter 404 behavior.

Why it changed:

This creates the first real boundary between the framework-agnostic trusted
executor core and the Postgres persistence package. Health is intentionally the
first integration point because it proves dependency injection and adapter
behavior without starting execution sessions, syscalls, or OCC commit logic.

Convex references:

- `crates/function_runner/src/lib.rs`
  - backend execution is behind explicit injected interfaces.
- `crates/function_runner/src/in_process_function_runner.rs`
  - local/in-process execution wires backend dependencies directly.
- `crates/application/src/application_function_runner/mod.rs`
  - request routing sits outside the runner and calls injected backend
    execution logic.

Flarex differences:

- Convex does not expose a Nitro health adapter. Flarex has an adapter because
  the trusted executor may run as Nitro/Vercel.
- The executor core still owns no route paths. `GET /health` remains a
  `@flarex/executor-nitro` concern.

Known limitations:

- Health only checks persistence connectivity.
- No migrations are run by executor startup yet.
- No execution session, syscall, read-set, or OCC commit methods exist yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
corepack pnpm --filter @flarex/persistence-postgres typecheck
git diff --check
```

## Deployment Metadata Helpers

Previous completed checkpoint: `20d5de3` Wire executor health to persistence.

What changed:

- Added typed deployment metadata helpers in `@flarex/persistence-postgres`:
  `insertDeploymentMetadata(...)` and `getDeploymentMetadata(...)`.
- Added `DeploymentMetadataRecord`, `InsertDeploymentMetadataInput`, and
  `DeploymentMetadataAlreadyExistsError`.
- Exposed deployment helpers through the framework-neutral
  `FlarexPersistence` interface.
- Wired the PGlite adapter to use the same Drizzle-backed helper functions.
- Added tests for create/read, missing deployment lookup, and duplicate
  deployment metadata rejection.

Why it changed:

Deployment metadata is platform state. It should move into the Postgres
persistence package instead of living in the legacy `DeploymentDO` prototype or
being accessed through unstructured Drizzle calls from executor code.

The insert path uses the database primary key with `onConflictDoNothing(...)`
and converts the empty insert result into a Flarex-specific duplicate error.
That is the right first storage shape for hosted metadata under concurrent
project or deployment creation.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - backend-owned deployment/function routing stays outside user code.
- `crates/function_runner/src/lib.rs`
  - execution depends on injected backend interfaces rather than direct user
    access to persistence internals.
- `crates/postgres/src/lib.rs`
  - persistence is initialized per backend instance and hides the database
    implementation behind a backend-owned abstraction.

Flarex differences:

- Convex does not store this exact hosted-platform `deployments` table in the
  Postgres schema copied here. Flarex needs it because the platform has
  projects, deployed source packages, and Cloudflare execution artifacts.
- The old Flarex Cloudflare prototype kept deployment metadata near
  `DeploymentDO`. The Postgres executor path keeps authoritative deployment
  metadata in Postgres and may later mirror/cache it in Cloudflare DOs only for
  routing and freshness.

Known limitations:

- `active_package_id` and `active_schema_version` are stored but not yet driven
  by the deployment push/analyze/activate flow.
- No project creation API exists yet.
- No real Postgres adapter exists yet; the helper is currently verified through
  PGlite.
- Executor startup does not yet ensure deployments or run migrations.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
```

## Scoped Internal Package Names

Previous completed checkpoint: `4d84f7e` Add deployment metadata helpers.

What changed:

- Renamed the new internal package directories:
  - `packages/flarex-postgres` -> `packages/persistence-postgres`
  - `packages/flarex-executor` -> `packages/executor`
  - `packages/flarex-executor-nitro` -> `packages/executor-nitro`
- Renamed package names to scoped imports:
  - `@flarex/persistence-postgres`
  - `@flarex/executor`
  - `@flarex/executor-nitro`
- Kept Drizzle Kit config, generated migrations, schema definitions, PGlite,
  and future real Postgres adapters inside `@flarex/persistence-postgres`.
- Changed persistence deployment APIs from platform-behavior names to
  storage-row names:
  - `createDeployment(...)` -> `insertDeploymentMetadata(...)`
  - `getDeployment(...)` -> `getDeploymentMetadata(...)`
- Kept the executor health payload service name as plain `executor` because it
  is runtime identity, not a package import specifier.

Why it changed:

The repeated `flarex-` prefix made the package boundary harder to read. Inside
this repo, the scope already says these packages belong to Flarex. Scoped names
avoid npm naming collisions while keeping the internal mental model clean:

```txt
@flarex/persistence-postgres
  storage implementation, Drizzle schema, migrations, adapters

@flarex/executor
  framework-neutral platform behavior and transaction execution

@flarex/executor-nitro
  Nitro/Vercel adapter only
```

Convex references:

- `npm-packages/convex`
  - public developer SDK keeps the short package name.
- `crates/postgres`
  - storage-specific implementation is named by responsibility, not by
    repeating the product name.
- `crates/application` and `crates/function_runner`
  - backend behavior is separate from storage implementation.

Flarex differences:

- Flarex uses scoped internal npm packages because these packages may later be
  published or consumed independently by examples/tests.
- The public SDK package remains `flarex`, similar to Convex's public `convex`
  package. This checkpoint only renames the new internal executor/persistence
  packages to avoid unnecessary churn in the older SDK/dev/test packages.

Known limitations:

- Older packages still use names like `flarex-dev`, `flarex-test`, and
  `flarex-backend`. Those can be revisited separately if we decide to move all
  non-public packages under `@flarex/*`.
- `@flarex/executor` still only exposes health behavior. Deployment creation
  behavior has not been moved there yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
```

## Executor Ensure Deployment Behavior

Previous completed checkpoint: `d1405d1` Use scoped executor package names.

What changed:

- Added `ensureDeployment(...)` to `@flarex/executor`.
- Added executor-level types:
  - `EnsureDeploymentInput`
  - `EnsureDeploymentResult`
  - `DeploymentProjectMismatchError`
- Extended the executor's injected persistence interface with only the
  deployment metadata methods it needs:
  - `getDeploymentMetadata(...)`
  - `insertDeploymentMetadata(...)`
- Implemented idempotent deployment ensure semantics:
  - read existing deployment metadata first,
  - insert metadata if missing,
  - if insertion loses a concurrent race, re-read and return the existing row,
  - reject if the deployment already belongs to a different project.
- Added executor tests for creation, idempotent existing reads, duplicate-race
  recovery, and project mismatch rejection.
- Updated Nitro adapter tests to satisfy the wider executor persistence
  contract without importing `@flarex/persistence-postgres` directly.

Why it changed:

This proves the boundary between persistence and platform behavior. The
Postgres persistence package inserts and reads metadata rows. The executor
decides what it means to ensure a deployment, including idempotency and
project ownership validation.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - deployment/function routing is backend-owned behavior, not user code.
- `crates/function_runner/src/lib.rs`
  - execution depends on backend-provided interfaces.
- `crates/database/src/committer.rs`
  - backend commit paths validate state before accepting writes; this same
    pattern will later apply to package activation and OCC commits.

Flarex differences:

- Convex does not expose this exact `ensureDeployment(...)` API because hosted
  deployment provisioning is part of Convex's own backend. Flarex needs the API
  in the framework-neutral executor so Nitro, local tests, and future platform
  control-plane code can share the same behavior.
- The Nitro adapter still only exposes health routes. It receives an executor
  instance and should not import Postgres persistence directly.

Known limitations:

- `ensureDeployment(...)` is a direct executor method only; no HTTP/Nitro route
  exists yet.
- It creates deployment metadata only. It does not create projects, activate
  source packages, run migrations, or validate auth.
- The race recovery depends on the persistence adapter converting primary-key
  conflicts into `DeploymentMetadataAlreadyExistsError`.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Invoke Session Maintenance Runner API

Previous completed checkpoint: `5358924` Add invoke session maintenance route.

What changed:

- Added `packages/executor/src/maintenance.ts`.
- Added executor API:
  `runInvokeSessionMaintenance({ deploymentId, projectId, staleAfterMs, maxSessions })`.
- The maintenance API computes `olderThan` from the executor clock and delegates
  to `abortStaleInvokeSessions`.
- `abortStaleInvokeSessionsMetadata` now supports bounded oldest-first batches
  ordered by `created_at, session_id`.
- Maintenance defaults `maxSessions` to `100` and returns `hasMore` so cron can
  call repeatedly without one large update transaction.
- Added stable `MaintenancePolicyError` for invalid maintenance TTLs.
- Added authenticated HTTP adapter route:
  `POST /maintenance/invoke-sessions`.
- The HTTP route accepts optional `maxSessions`.
- Nitro inherits the route through `@flarex/executor-http`.
- Added PGlite, executor, and HTTP tests for TTL handling, batch order,
  `hasMore`, and route validation.

Why it changed:

`POST /invoke/abort-stale` is a low-level control-plane primitive. A production
scheduler should not have to calculate timestamps manually. This maintenance
API makes the scheduled operation policy-driven while keeping the durable state
transition in the trusted Postgres executor.

The batch limit is required before cron wiring. A stalled deployment could have
many active sessions, and a single unbounded update would be the wrong
production shape for a shared Postgres executor.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - backend-owned function execution coordination remains the reference shape.
- `crates/database/src/transaction.rs`
  - uncommitted transaction state never becomes committed database state.

Flarex differences:

- Convex does not expose this as an HTTP maintenance route because execution and
  transaction ownership live inside the same backend service. Flarex needs the
  route because Dynamic Worker execution and the trusted executor are separate
  deployable boundaries.
- This route computes stale policy only. It still does not retry or commit user
  code work.
- Batch order is explicit in Flarex because the maintenance API is externalized
  over HTTP. Convex keeps transaction cleanup inside backend runtime ownership.

Known limitations:

- No actual Vercel/Nitro cron binding is configured yet.
- No persisted per-deployment maintenance policy yet.
- Batching is implemented, but there is no cursor because the next batch can be
  found by rerunning the same stale policy while `hasMore` is true.
- No retention deletion for aborted session read/write rows yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Maintenance Deployment Discovery

Previous completed checkpoint: `69b1d73` Batch invoke session maintenance.

What changed:

- Added `listDeploymentMetadata({ limit, cursor })` in
  `@flarex/persistence-postgres`.
- Deployment listing is ordered by `created_at, deployment_id` and returns
  `{ deployments, nextCursor, hasMore }`.
- Added `executor.listMaintenanceDeployments({ limit, cursor })` as the
  framework-neutral core API.
- Added in-memory executor persistence support and PGlite coverage for stable
  cursor batches.
- Updated Nitro and HTTP adapter fakes to satisfy the wider executor contract.

Why it changed:

The maintenance route can now process one deployment, but a platform cron needs
to discover deployments without hardcoding IDs. Listing deployments in stable
batches is the next prerequisite before wiring a Vercel/Nitro scheduled job.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - backend-owned orchestration remains the reference for platform lifecycle
    work.
- `crates/database/src/transaction.rs`
  - transaction cleanup remains backend-owned and unpublished until committed.

Flarex differences:

- Convex does not need to expose deployment discovery through a TypeScript
  executor package. Flarex keeps this as framework-neutral core behavior so
  Nitro, local tests, and future schedulers can share the same logic.
- This slice does not add an HTTP route. It intentionally keeps deployment
  discovery internal until the scheduled runner shape is clearer.

Known limitations:

- No cron loop is wired yet.
- No project-level filter exists yet; this is platform-wide deployment listing.
- No persisted per-deployment maintenance policy yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Maintenance Sweep Core Loop

Previous completed checkpoint: `a0ac1fe` List deployments for maintenance.

What changed:

- Added executor API:
  `runMaintenanceSweep({ deploymentLimit, deploymentCursor, staleAfterMs, maxSessionsPerDeployment })`.
- The sweep lists one deployment page and runs one bounded invoke-session
  maintenance batch for each deployment in that page.
- The result returns:
  - per-deployment stale abort counts,
  - per-deployment `hasMoreSessions`,
  - `nextDeploymentCursor`,
  - `hasMoreDeployments`.
- Added executor tests for deployment paging, per-deployment batching, and
  cursor resume behavior.
- Updated HTTP/Nitro test fakes for the wider executor contract.

Why it changed:

The scheduler should call one framework-neutral executor operation, not
manually coordinate deployment paging and invoke-session cleanup. This keeps the
future Nitro/Vercel cron adapter thin and keeps maintenance behavior testable
without a host framework.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - backend-owned orchestration remains the reference for platform lifecycle
    work.
- `crates/database/src/transaction.rs`
  - abandoned transaction state stays unpublished unless committed.

Flarex differences:

- Convex does not need a TypeScript maintenance sweep API because backend
  lifecycle work is internal to the Rust service. Flarex exposes this through
  executor core so Nitro, tests, and future platform adapters share behavior.
- This is still not an HTTP route and not a cron binding.

Known limitations:

- The sweep processes one deployment page per call.
- Hot deployments with `hasMoreSessions` are reported but not revisited inside
  the same call.
- No persisted per-deployment TTL policy yet.
- No retention deletion for aborted session read/write rows yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Executor Module Layout

Previous completed checkpoint: `a86d1ff` Add executor deployment ensure
behavior.

What changed:

- Split `@flarex/executor/src/index.ts` into focused modules:
  - `types.ts`
    - shared public executor contracts and result shapes.
  - `errors.ts`
    - domain errors such as `DeploymentProjectMismatchError`.
  - `deployments.ts`
    - deployment ensure behavior and project ownership validation.
  - `health.ts`
    - health dependency checks and response construction.
  - `index.ts`
    - public package entrypoint and executor factory wiring only.

Why it changed:

`index.ts` should not become the executor implementation. It should expose the
public API and compose domain modules. This matters now because deployment
provisioning, package activation, execution sessions, syscall handling, OCC
commit, auth, and eventually sync-facing behavior will each grow their own
types and errors.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - application-level behavior is grouped by domain module instead of living in
    a single crate entrypoint.
- `crates/function_runner/src/lib.rs`
  - crate entrypoints define traits/contracts and route to focused
    implementations.
- `crates/database/src/committer.rs`
  - transaction/commit behavior is isolated in its own module instead of being
    mixed into generic entrypoint code.

Flarex differences:

- Flarex's TypeScript package still exports a single public npm entrypoint,
  but implementation modules stay private unless a direct helper becomes part
  of the public executor API.
- Shared types live in `types.ts` for now. A separate `@flarex/core` package
  should only be added later if types must be shared across packages without
  depending on executor behavior.

Known limitations:

- Tests still live in one `health.test.ts` file even though they now cover
  health and deployment behavior. They should be split once the next executor
  domain test file is added.
- `ensureDeployment(...)` remains direct-method only. No Nitro route or auth
  boundary exists yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Executor Test Layout

Previous completed checkpoint: `7029b9b` Split executor entrypoint into domain
modules.

What changed:

- Split executor tests to match executor source domains:
  - `test/health.test.ts`
    - health behavior only.
  - `test/deployments.test.ts`
    - `ensureDeployment(...)` behavior.
  - `test/helpers/persistence.ts`
    - shared in-memory persistence fake and deployment metadata fixture.

Why it changed:

After splitting `@flarex/executor/src/index.ts`, leaving all tests in
`health.test.ts` would recreate the same growth problem in the test suite. The
executor package should add one focused test file per behavior domain so package
activation, execution sessions, syscall handling, and OCC tests can be added
without turning a single test file into an implementation log.

Convex references:

- `crates/application` and `crates/database`
  - behavior tests are grouped around the domain being exercised, not around a
    crate entrypoint.
- `crates/function_runner`
  - runner tests keep dependency fakes close to the runner boundary rather than
    mixing them into unrelated behavior checks.

Flarex differences:

- Flarex uses TypeScript/Vitest and small in-memory persistence fakes for
  executor behavior tests. PGlite remains the persistence package's local
  adapter test lane.
- The Nitro adapter tests keep their own minimal fake because
  `@flarex/executor-nitro` should depend on `@flarex/executor`, not directly on
  `@flarex/persistence-postgres`.

Known limitations:

- The in-memory fake currently models only the metadata methods needed by
  health and `ensureDeployment(...)`.
- Future executor domains may need a richer helper or domain-specific fakes
  instead of continuing to extend one generic fake indefinitely.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Deployment Package Activation

Previous completed checkpoint: `29dfb4b` Split executor tests by domain.

What changed:

- Added low-level activation metadata storage to
  `@flarex/persistence-postgres`:
  - `UpdateDeploymentMetadataActivationInput`
  - `updateDeploymentMetadataActivation(...)`
- Wired the PGlite adapter to the new Drizzle-backed update helper.
- Added PGlite tests proving activation metadata updates existing deployment
  rows and returns `null` for missing deployment rows.
- Added executor-level package activation behavior:
  - `ActivateDeploymentPackageInput`
  - `ActivateDeploymentPackageResult`
  - `executor.activateDeploymentPackage(...)`
- `activateDeploymentPackage(...)` ensures the deployment exists, validates
  project ownership through `ensureDeployment(...)`, then updates
  `activePackageId` and `activeSchemaVersion`.
- Added executor tests for:
  - activating a package for a missing deployment,
  - activating a package for an existing deployment,
  - rejecting activation when the deployment belongs to another project.
- Updated Nitro adapter test fakes to satisfy the wider executor persistence
  contract without importing `@flarex/persistence-postgres` directly.

Why it changed:

This is the first real deployment lifecycle transition after metadata creation.
The persistence package still only updates storage columns. The executor owns
the platform action: ensure deployment, validate project ownership, decide
whether a deployment was created, and return the activated deployment metadata.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - deployment/function state is backend-owned and used to route future
    execution.
- `crates/function_runner/src/lib.rs`
  - backend execution works through stable interfaces rather than exposing
    storage internals.
- `crates/database/src/committer.rs`
  - state transitions should be validated by the backend boundary before they
    become authoritative.

Flarex differences:

- Convex's hosted control plane owns deployment activation internally. Flarex
  exposes this as executor behavior because Nitro/local tests/future platform
  APIs need a reusable framework-neutral method.
- This checkpoint only activates package IDs and schema versions already known
  to the caller. It does not yet store source packages or backend analysis
  results.

Known limitations:

- No source package table or package artifact store exists yet.
- No auth or project creation API exists yet.
- Activation is a direct executor method only; no Nitro route exists yet.
- There is no compare-and-swap guard for activation order yet. Later push flow
  may need package status checks or monotonic activation rules.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Source Package Registry

Previous completed checkpoint: `5b8b197` Add deployment package activation.

What changed:

- Added a package-local Drizzle migration for `deployment_packages`.
- Added `deploymentPackages` to the Postgres Drizzle schema.
- Added low-level package metadata helpers in `@flarex/persistence-postgres`:
  - `insertDeploymentPackageMetadata(...)`
  - `getDeploymentPackageMetadata(...)`
  - `DeploymentPackageMetadataAlreadyExistsError`
- Wired the PGlite adapter to the new package metadata helpers.
- Added PGlite tests for package table migration, insert/get, missing lookup,
  and duplicate package metadata rejection.
- Added executor-level source package registration:
  - `registerDeploymentPackage(...)`
  - `RegisterDeploymentPackageInput`
  - `RegisterDeploymentPackageResult`
  - `DeploymentPackageMismatchError`
- Changed `activateDeploymentPackage(...)` to require a registered package
  before updating `activePackageId`.
- Added executor tests for package registration, idempotent registration,
  mismatch rejection, registered package activation, and missing package
  activation rejection.

Why it changed:

Activation should not point to an arbitrary caller-supplied package ID. Convex
keeps source package metadata as backend-owned durable state, and execution
resolves package metadata from that state. Flarex now has the first equivalent
Postgres-backed registry so activation can refer to known immutable package
metadata.

Convex references inspected:

- `crates/model/src/source_packages/mod.rs`
  - `SourcePackageModel::put(...)` and `get(...)` store and retrieve source
    package metadata through backend model code.
- `crates/model/src/source_packages/types.rs`
  - `SourcePackage` stores durable package identity metadata such as
    `storage_key`, `sha256`, package size, dependency package ID, and runtime
    version.
- `crates/model/src/modules/types.rs`
  - `ModuleMetadata` references `source_package_id`, so module/function
    metadata is tied back to immutable package identity.
- `crates/application/src/deploy_config.rs`
  - `finish_push(...)` downloads source packages by storage key/hash before
    committing deployment state.
- `crates/application/src/application_function_runner/mod.rs`
  - execution resolves the latest source package before invoking user code.

Flarex differences:

- Convex stores source package metadata in system tables and package bytes in
  module storage. This first Flarex Postgres version stores package metadata,
  source package JSON, and analysis JSON in `deployment_packages`.
- The current `packageId` is expected to line up with Flarex's execution
  artifact identity, but the executor does not yet derive it from
  `executionArtifactRefForSourcePackage(...)`.
- `sourcePackageJson` and `analysisJson` are JSONB placeholders for the
  Postgres executor path. Large source packages should eventually move to
  object storage with Postgres retaining storage keys and hashes, closer to
  Convex's `storage_key` plus `sha256` model.

Known limitations:

- No real object store abstraction exists in the Postgres executor path yet.
- No module-level metadata table exists yet, so package registration is not
  connected to function routing or analyzed module records.
- Package registration validates hash and execution module on duplicate
  registration, but it does not deeply compare the full source package JSON.
- There is no package status machine yet, so packages are not distinguished as
  uploaded, analyzed, failed, or activated.
- Activation is still a direct executor method only; no Nitro route or auth
  boundary exists yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Source Package Artifact Identity

Previous completed checkpoint: `aa50827` Add source package registry.

What changed:

- Added `flarex` as a dependency of `@flarex/executor`.
- Changed `RegisterDeploymentPackageInput` so callers pass a typed
  `ArtifactSourcePackage` instead of caller-supplied package identity fields.
- `registerDeploymentPackage(...)` now derives package identity with
  `executionArtifactRefForSourcePackage(...)`:
  - `packageId = artifactId`
  - `sourcePackageHash = sourcePackageHash`
  - `executionModule = executionModule`
- Stored `sourcePackageJson` is now built from the immutable source package
  passed to the executor.
- Updated activation tests so activation uses the derived artifact ID returned
  by package registration.
- Kept mismatch protection for corrupted/stale package rows that already exist
  under the derived artifact ID but do not match the derived hash/module.

Why it changed:

Package registration should not trust arbitrary caller-supplied IDs and hashes.
Convex derives source package identity from backend-owned package metadata and
then ties module/function state back to that identity. Flarex already had a
content-addressed artifact identity helper in `flarex/artifacts`; the executor
now reuses that instead of duplicating or bypassing it.

Convex references:

- `crates/model/src/source_packages/types.rs`
  - source package identity is durable metadata with `sha256` and storage
    identity, not a loose caller-provided string.
- `crates/model/src/source_packages/mod.rs`
  - backend model code owns package storage and lookup.
- `crates/model/src/modules/types.rs`
  - active module metadata references source package identity.
- `crates/application/src/deploy_config.rs`
  - finish push validates downloaded source packages by storage key/hash before
    committing deployment state.

Flarex references:

- `packages/flarex/src/artifacts.ts`
  - `executionArtifactRefForSourcePackage(...)` derives the stable
    `artifactId`, `sourcePackageHash`, and `executionModule`.
- `packages/flarex-backend/src/artifactStore.ts`
  - the legacy Cloudflare backend already stores and validates source packages
    by this derived artifact identity.

Flarex differences:

- Convex's production backend stores source package metadata in system tables
  and package bytes in storage. Flarex still stores source package JSON in
  Postgres for this first executor slice.
- The derived `artifactId` is currently used as `packageId`. Later object-store
  backed packages may also store a separate storage key, but activation should
  continue to reference the derived immutable package identity.

Known limitations:

- `sourcePackageJson` is still inline JSONB instead of object storage.
- Registration does not yet validate package size limits or deep-compare JSON
  when an existing package row matches hash and execution module.
- No module metadata/function routing table exists yet, so the package identity
  is not yet connected to execution.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Active Package Resolution

Previous completed checkpoint: `221642f` Derive package identity from source
packages.

What changed:

- Added `executor.getActiveDeploymentPackage({ deploymentId, projectId })`.
- The resolver loads deployment metadata, validates project ownership, requires
  an active package ID, loads the matching immutable package row, and returns
  both records.
- Added explicit executor errors for read-side activation failures:
  - `DeploymentNotFoundError`
  - `DeploymentPackageNotActivatedError`
  - existing `DeploymentPackageNotFoundError` for a dangling active package
    pointer.
- Reused the same project ownership guard as `ensureDeployment(...)` and
  `activateDeploymentPackage(...)`.
- Added executor tests for successful resolution, missing deployment, project
  mismatch, missing activation, and missing active package row.

Why it changed:

Invoke routing needs a single backend-owned answer to "what code is active for
this deployment?" before it can load module/function metadata. Activation
already writes `deployments.activePackageId`; this slice makes that state
consumable without letting adapters inspect persistence details directly.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - execution resolves the current application/function metadata before
    running user code.
- `crates/model/src/source_packages/mod.rs`
  - package lookup is backend model behavior, not caller-owned identity.
- `crates/model/src/modules/types.rs`
  - module metadata references source package identity and ties active code to
    durable package state.

Flarex differences:

- Convex has richer module/function tables and deployment config state. Flarex
  currently resolves only the active source package row.
- Flarex keeps package JSON in Postgres for this slice. Convex production code
  separates durable metadata from source package storage.
- Flarex exposes the resolver as framework-neutral executor core behavior so
  Nitro, tests, and local adapters can share it.

Known limitations:

- No function route table exists yet, so invoke cannot resolve
  `api.file.function` after loading the active package.
- No package status machine exists yet, so resolution does not distinguish
  analyzed, failed, uploaded, or ready packages.
- No auth boundary exists yet. The current ownership check is project ID based
  and assumes the caller is already trusted.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Active Function Resolution

Previous completed checkpoint: `509f488` Resolve active deployment packages.

What changed:

- Added `executor.getActiveFunction({ deploymentId, projectId, path })`.
- The resolver first resolves the active deployment package, then reads
  `analysisJson.functions.functions` from the active package and returns the
  matching function metadata.
- Added executor-owned function metadata types for path, kind, visibility,
  validators, route, partition, and source position.
- Added explicit errors:
  - `FunctionNotFoundError` when the active package does not declare the
    requested function path.
  - `DeploymentFunctionMetadataUnavailableError` when active package analysis
    is missing or malformed.
- Added focused tests for successful function lookup, missing function path,
  missing analysis metadata, and malformed function metadata.

Why it changed:

The executor can now answer the next invoke-routing question after package
activation: "Which active function metadata should this request use?" This keeps
future Nitro and Dynamic Worker adapters thin. They should ask executor core for
the active function instead of inspecting package JSON themselves.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - `FunctionRouter` resolves function metadata before execution and passes
    validated path/args into the runner.
- `crates/model/src/modules/types.rs`
  - active module metadata carries analysis results and source package identity.
- `crates/model/src/source_packages/mod.rs`
  - source package lookup remains backend model behavior.

Flarex references:

- `packages/flarex-backend/src/invoke.ts`
  - legacy `loadActiveFunctionMetadata(...)` resolves an active deployment and
    returns the requested function metadata or a 404-style error.
- `packages/flarex-dev/src/backendPush.ts`
  - `backendAnalysisFromCodegenAnalysis(...)` flattens codegen analysis into
    `analysis.functions.functions`, which is the shape consumed by the new
    executor resolver.

Flarex differences:

- Convex stores rich module and function metadata in backend model tables.
  Flarex still reads function metadata from package `analysisJson` until the
  Postgres module/function tables exist.
- Convex has component-aware public function paths. Flarex currently resolves a
  flat string path such as `messages:list`.
- The executor keeps validator, route, partition, and position payloads typed as
  `unknown` for this slice. Runtime validation will narrow those when invoke
  session execution is ported.

Known limitations:

- No dedicated Postgres `functions` or `modules` table exists yet.
- Function path normalization is not implemented; callers must pass the exact
  active analysis path.
- The resolver does not yet enforce public/internal visibility.
- The resolver does not yet check whether `action` or `workflowMutation`
  functions are invokable by a given route.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Invoke Target Preparation

Previous completed checkpoint: `7319758` Resolve active functions.

What changed:

- Added `executor.prepareInvoke({ deploymentId, projectId, path, kind? })`.
- The prepare step resolves the active function, verifies it is invokable by
  `/invoke`, validates optional caller kind expectations, validates schema
  metadata shape, and returns:
  - deployment metadata
  - active package metadata
  - active function metadata
  - schema metadata
  - execution module
- Added executor errors:
  - `DeploymentSchemaMetadataUnavailableError`
  - `FunctionKindMismatchError`
  - `FunctionNotInvokableError`
- Added tests for successful query and mutation preparation, kind mismatch,
  action rejection, missing schema metadata, and malformed schema metadata.

Why it changed:

Nitro and future execution-session adapters need one framework-neutral executor
answer for "what exactly am I about to invoke?" The adapter should not duplicate
active package lookup, function lookup, kind checks, or schema availability
checks. This keeps HTTP routing thin and moves Convex-style execution decisions
into the trusted executor core.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - `FunctionRouter` prepares execution with function metadata and UDF type
    before handing work to the function runner.
- `crates/application/src/cache/mod.rs`
  - cached query execution is keyed around public function path and arguments,
    after route/function resolution.
- `crates/model/src/modules/types.rs`
  - active module metadata carries source package identity and analysis data.

Flarex references:

- `packages/flarex-backend/src/invoke.ts`
  - legacy `executeInvoke(...)` and `loadActiveFunctionMetadata(...)` perform
    active function lookup, kind validation, schema access, and invoke-time
    checks in one path.
- `packages/flarex-backend/src/executionDO.ts`
  - legacy execution sessions call `loadActiveFunctionMetadata(...)` before
    validating args and opening a transaction.

Flarex differences:

- Convex runs function preparation against rich backend model tables. Flarex
  still reads schema and function metadata from active package `analysisJson`.
- Convex supports actions through separate action paths. Flarex
  `prepareInvoke(...)` currently accepts only `query` and `mutation` as
  invokable kinds because this path targets `/invoke` transaction execution.
- Flarex returns `executionModule` from package metadata so future Dynamic
  Worker execution can load the active artifact without HTTP adapters
  inspecting package rows.

Known limitations:

- `prepareInvoke(...)` does not validate arguments or return values yet.
- It does not resolve partition execution scope yet.
- It does not enforce public/internal visibility yet.
- Schema typing is intentionally minimal until the Postgres executor owns the
  full schema model instead of reading JSON analysis blobs.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Nitro Invoke Prepare Adapter

Previous completed checkpoint: `1f6ec62` Prepare executor invokes.

What changed:

- Added a Nitro adapter route:

  ```http
  POST /invoke/prepare
  ```

- The route parses `deploymentId`, `projectId`, `path`, and optional
  `kind`, then calls `executor.prepareInvoke(...)`.
- The route returns a minimal response:
  - `deploymentId`
  - `packageId`
  - `path`
  - `kind`
  - `schemaVersion`
  - `executionModule`
- Added request validation for malformed JSON, missing string fields, invalid
  `kind`, and non-POST method usage.
- Added stable HTTP error mapping for known executor errors:
  - `404` for missing deployment/package/function.
  - `403` for project mismatch.
  - `400` for kind mismatch and non-invokable function kind.
  - `409` for inactive deployment or missing/malformed active metadata.
- Added Nitro adapter tests with a fake executor so adapter behavior stays
  separate from executor persistence behavior.

Why it changed:

This is the first concrete Nitro HTTP route over the new Postgres executor
core. It proves the intended adapter boundary: Nitro owns HTTP parsing,
serialization, and status-code mapping, while executor core owns active package,
function, schema, and invoke semantics.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - function execution enters through application-level routing that resolves
    function metadata before runner execution.
- `crates/local_backend/src/lib.rs`
  - local backend exposes HTTP-ish endpoints as adapter surfaces over backend
    application behavior.

Flarex references:

- `packages/flarex-backend/src/invoke.ts`
  - legacy invoke path maps active function lookup and invoke validation into
    HTTP responses.
- `packages/flarex-backend/src/executionDO.ts`
  - legacy execution session start uses active function metadata before
    opening transaction state.

Flarex differences:

- Convex does not expose a separate `/invoke/prepare` public API in this shape.
  Flarex adds it now as an internal development adapter milestone before real
  execution sessions exist.
- The adapter intentionally does not return raw schema, package JSON, or
  analysis JSON. Those remain executor-owned until the execution layer needs
  them.
- The route accepts `projectId` directly for now. Future platform auth should
  derive project ownership from credentials instead of trusting the body.

Known limitations:

- `/invoke/prepare` does not execute user code.
- It does not begin a transaction or create an execution session.
- It does not validate arguments or resolve partition scope yet.
- It is currently an adapter test route, not a final public client protocol.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Invoke Scope Resolution

Previous completed checkpoint: `9d29a19` Expose invoke prepare in Nitro.

What changed:

- Extended `executor.prepareInvoke(...)` to require `args` and optional
  `partitionKey`.
- Added concrete executor metadata types for:
  - JSON values
  - schema tables/indexes
  - table placement
  - function route policies
  - function partition policies
  - resolved execution scopes
- Ported the legacy single-shard scope resolver into executor core:
  - functions must declare partition metadata
  - partition metadata must match schema table placement
  - route arg metadata must match partition arg metadata
  - partition key is extracted from `args`
  - caller-provided `partitionKey` must match the extracted key
  - create-root partitions preallocate a root ID and reject caller-supplied
    mismatches
- Added `PartitionValidationError`.
- Extended `prepareInvoke(...)` results with `scope`.
- Extended Nitro `/invoke/prepare` to accept `args` and optional
  `partitionKey`, return the resolved scope, validate JSON request shape, and
  map `PartitionValidationError` to `400`.
- Added executor tests for normal partition scope, missing partition metadata,
  partition key mismatch, schema placement mismatch, and create-root scope.
- Updated Nitro adapter tests for args forwarding, scope serialization, args
  validation, and partition validation error mapping.

Why it changed:

Before any real transaction/session begin, the trusted executor must know which
single shard/partition the invocation is allowed to touch. This is the core of
Flarex's current correctness model: user code should not decide the partition
after it starts running, and HTTP adapters should not implement partition
semantics.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - Convex resolves function metadata and execution type before handing work to
    the runner.
- `crates/database`
  - Convex transaction correctness depends on a backend-owned transaction
    boundary and read/write tracking, not user-code-owned storage handles.
- `crates/model/src/modules/types.rs`
  - active module metadata carries analyzed function data used by execution.

Flarex references:

- `packages/flarex-backend/src/invoke.ts`
  - `resolveFunctionExecutionScope(...)` was ported closely into executor core.
- `packages/flarex-backend/src/executionDO.ts`
  - legacy sessions resolve active function metadata and partition scope before
    opening transaction state.
- `packages/flarex-backend/test/invoke.test.ts`
  - legacy tests cover missing partition metadata, stored partition metadata as
    authoritative scope, and create-root partition behavior.

Flarex differences:

- Convex does not expose partition selection to developers this way because its
  database architecture is not Cloudflare single-shard Durable Object routing.
  Flarex keeps this explicit to preserve correctness in a sharded/serverless
  runtime.
- The Postgres executor still reads schema/function metadata from package
  `analysisJson`; dedicated module/function/schema tables are still pending.
- Create-root IDs are preallocated in executor core with the current Flarex ID
  format. Later persistence/session code must consume that ID when inserting
  the root document.

Known limitations:

- Scope resolution does not begin a transaction yet.
- It does not validate argument validators or return validators yet.
- It does not enforce user-code reads/writes against the resolved scope yet;
  that belongs in the transaction/session syscall layer.
- Nitro currently returns the full resolved scope for development visibility.
  The final public protocol may hide or reduce that payload.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Invoke Session Persistence

Previous completed checkpoint: `681a2ef` Resolve invoke scopes.

What changed:

- Added a Postgres `invoke_sessions` table to
  `@flarex/persistence-postgres`.
- Stored session metadata includes:
  - deployment/project/package identity
  - session ID
  - function path/kind
  - partition key and resolved scope JSON
  - invoke args JSON
  - optional idempotency key
  - lifecycle state
  - begin timestamp
  - schema version
  - execution module
  - created/finished timestamps
- Added indexes for:
  - deployment/state/created-at session scans
  - deployment/idempotency-key lookup
- Added low-level persistence helpers:
  - `insertInvokeSessionMetadata(...)`
  - `getInvokeSessionMetadata(...)`
- Added `InvokeSessionMetadataAlreadyExistsError`.
- Wired the helpers through `FlarexPersistence` and
  `createPGlitePersistence(...)`.
- Added Drizzle migration `0002_fuzzy_lenny_balinger.sql`.
- Added PGlite tests for insert/read, missing rows, duplicate rows, and
  migration table coverage.

Why it changed:

The next executor API needs a durable session anchor before user code can make
restricted syscalls. This table is the bridge between `prepareInvoke(...)` and
future session operations like begin/syscall/finish/abort. It records the
already-resolved function and partition scope so Dynamic Worker user code never
receives a raw database handle or gets to redefine the transaction target after
execution starts.

Convex references:

- `crates/model/src/session_requests/mod.rs`
  - Convex keeps system-owned session request records with an index by session
    ID and request ID for idempotent sync protocol mutation requests.
- `crates/model/src/session_requests/types.rs`
  - Convex records session request identity and mutation outcome as durable
    system metadata.
- `crates/application/src/application_function_runner/mod.rs`
  - Convex application execution routes through backend-owned metadata and
    transaction boundaries rather than user-owned database handles.

Flarex references:

- `packages/flarex-backend/src/executionDO.ts`
  - legacy execution sessions keep active in-memory session state containing
    deployment, scope, schema, metadata, and transaction.
- `packages/flarex-backend/src/invoke.ts`
  - legacy invoke prepares function metadata and partition scope before
    transaction execution.

Flarex differences:

- Convex `_session_requests` records idempotent request outcomes inside the
  database transaction. Flarex `invoke_sessions` is a first execution-session
  anchor; outcome/idempotency replay semantics are not complete yet.
- The current table stores `scopeJson` and `argsJson` as JSONB. Later
  transaction/OCC tables may normalize read/write sets separately.
- No foreign keys are added yet because deployment/package metadata still needs
  a more complete platform ownership model.

Known limitations:

- `invoke_sessions` does not store read sets, write sets, return values, or log
  lines yet.
- There is no executor `beginInvokeSession(...)` method yet.
- Session state transitions are not implemented yet.
- Idempotency key lookup is indexed but no helper or replay behavior exists
  yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
git diff --check
```

## Begin Invoke Session Core

Previous completed checkpoint: `f744897` Add invoke session persistence.

What changed:

- Added `executor.beginInvokeSession(...)`.
- Added executor config support for an injectable ID generator.
- The begin flow now:
  - calls `prepareInvoke(...)`
  - allocates a session ID
  - uses the executor clock for an initial `beginTs`
  - inserts an `invoke_sessions` row through persistence
  - returns session ID, begin timestamp, schema version, function path/kind,
    resolved scope, and execution module
- Extended `FlarexExecutorPersistence` with invoke session insert/read methods.
- Added test in-memory persistence support for invoke sessions.
- Added executor tests for successful session begin and duplicate generated
  session ID handling.
- Updated Nitro test fakes to satisfy the expanded executor/persistence
  interfaces.

Why it changed:

This creates the first durable, backend-owned execution-session anchor. User
code still does not run here, and no database transaction is open yet. The
session row records the already-authoritative prepared invoke target so future
Dynamic Worker syscalls can attach to a backend-owned session ID instead of
receiving database access.

Convex references:

- `crates/model/src/session_requests/mod.rs`
  - Convex records framework-owned session request metadata for idempotent
    mutation handling.
- `crates/model/src/session_requests/types.rs`
  - Convex stores session/request identity and outcome as durable system
    metadata.
- `crates/application/src/application_function_runner/mod.rs`
  - function execution is mediated by backend-owned routing and transaction
    state.

Flarex references:

- `packages/flarex-backend/src/executionDO.ts`
  - legacy execution sessions keep deployment/function/scope/schema metadata
    before serving syscalls.
- `packages/flarex-backend/src/invoke.ts`
  - legacy invoke prepares function metadata and scope before transaction work.

Flarex differences:

- Convex session request records are tied to idempotent mutation outcomes.
  Flarex `beginInvokeSession(...)` currently creates an active session anchor
  before syscalls/finish exist.
- `beginTs` currently comes from the injected clock as a placeholder. The final
  OCC transaction engine should allocate begin timestamps from the authoritative
  Postgres transaction/timestamp service.
- The session ID is generated by an executor ID generator. Retry/idempotency
  replay by idempotency key is indexed in persistence but not implemented yet.

Known limitations:

- No syscall API exists yet.
- No transaction read/write set is attached yet.
- No finish/abort state transition exists yet.
- No idempotency replay behavior exists yet.
- `beginTs` is not the final Convex-style database timestamp source.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Elysia HTTP API Adapter

Previous completed checkpoint: `b4a2518` Begin invoke sessions.

What changed:

- Added `@flarex/executor-http` as the real HTTP API adapter package.
- Implemented `createFlarexHttpApp({ executor })` with Elysia.
- Implemented `createFlarexHttpHandler({ executor })` as a fetch-style handler.
- Moved the existing HTTP behavior into the Elysia app:
  - `GET /health`
  - `POST /invoke/prepare`
  - method rejection for `/invoke/prepare`
  - JSON `404` for unknown routes
  - executor error-to-status mapping
- Added direct Elysia tests using `app.handle(request)`.
- Refactored `@flarex/executor-nitro` into a thin wrapper over
  `@flarex/executor-http`.
- Updated the workspace lockfile with Elysia.

Why it changed:

The HTTP API should be explicit and directly testable. Nitro is still useful as
a deployment shell, but file routing should not own Flarex platform semantics.
Elysia gives Flarex a single concrete router for `/invoke`, future session
routes, sync routes, and health checks, while Nitro can mount or delegate to
that router.

Convex references:

- `crates/local_backend/src/lib.rs`
  - local/backend HTTP surfaces adapt requests into backend application
    behavior instead of owning database semantics.
- `crates/application/src/application_function_runner/mod.rs`
  - execution routing decisions stay in backend/application logic, not the HTTP
    adapter.

Flarex references:

- `packages/executor/src/invoke.ts`
  - executor core still owns prepare-invoke semantics.
- `packages/executor/src/sessions.ts`
  - executor core owns session creation semantics.
- `packages/executor-http/src/index.ts`
  - Elysia now owns HTTP route parsing and response mapping.
- `packages/executor-nitro/src/index.ts`
  - Nitro now delegates to the HTTP handler.

External reference:

- Nitro Elysia example: `https://nitro.build/examples/elysia`
  - Nitro can use a server entry that exports `app.compile()`, allowing a
    framework router to handle all incoming requests.

Flarex differences:

- Convex has its own backend HTTP protocol and local backend. Flarex is using
  Elysia as a framework-neutral HTTP adapter that can run under Nitro/Vercel or
  other fetch-compatible hosts.
- `@flarex/executor-nitro` remains a compatibility/deployment wrapper, not the
  source of API route behavior.

Known limitations:

- `@flarex/executor-http` currently exposes only health and invoke prepare.
- There is no Nitro `server.ts` app package yet; this slice only makes the
  reusable Elysia app and wrapper.
- `/invoke/start`, syscall, finish, and abort routes still need to be added to
  the Elysia app.
- The Elysia app uses manual request validation for now. We can move to Elysia
  schemas once the API shape stabilizes.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Invoke Start HTTP Route

Previous completed checkpoint: `36f572e` Move executor HTTP routes to Elysia.

What changed:

- Added `POST /invoke/start` to `@flarex/executor-http`.
- The route validates the same invoke body as `/invoke/prepare` plus optional
  `idempotencyKey`.
- The route calls `executor.beginInvokeSession(...)` and returns the durable
  session start response:
  - `sessionId`
  - `beginTs`
  - `schemaVersion`
  - function path/kind
  - resolved scope
  - `executionModule`
- Added method rejection for non-POST `/invoke/start`.
- Added HTTP tests for successful session begin, idempotency-key validation,
  method rejection, and executor error mapping.
- Kept `@flarex/executor-nitro` unchanged as a thin wrapper over the Elysia
  app.

Why it changed:

This exposes the framework-neutral session core over the real HTTP adapter.
The next syscall and finish routes can now target a backend-owned session ID
instead of giving Cloudflare user code any direct database connection.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - backend-owned function execution routing prepares and controls user
    function execution.
- `crates/model/src/session_requests/mod.rs`
  - Convex stores framework-owned session request metadata for idempotent
    mutation handling.
- `crates/model/src/session_requests/types.rs`
  - session/request identity and outcome are model-level system data.

Flarex references:

- `packages/executor/src/sessions.ts`
  - owns `beginInvokeSession(...)` and durable session insertion.
- `packages/executor-http/src/index.ts`
  - owns Elysia route parsing and error/status mapping.
- `packages/flarex-backend/src/executionDO.ts`
  - legacy execution sessions provide the behavior reference for backend-owned
    session state before syscalls.

Flarex differences:

- Convex session requests are tied to its sync/mutation protocol. Flarex
  currently exposes `/invoke/start` as an internal executor HTTP milestone for
  Dynamic Worker execution.
- `beginTs` is still executor-clock based. Final OCC should use an
  authoritative Postgres timestamp/version source.
- `idempotencyKey` is accepted and persisted by the core path, but replay
  semantics are not implemented yet.

Known limitations:

- `/invoke/start` does not execute user code.
- No syscall, finish, abort, read-set, write-set, return validation, or commit
  route exists yet.
- The route returns the resolved scope for development visibility. The final
  internal protocol may reduce that response once the runtime contract settles.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Invoke Syscall Boundary

Previous completed checkpoint: `97fa850` Expose invoke start in HTTP.

What changed:

- Added `executor.invokeSyscall(...)` to the framework-neutral executor core.
- Added explicit executor errors for session/syscall validation:
  - `InvokeSessionNotFoundError`
  - `InvokeSessionProjectMismatchError`
  - `InvokeSessionNotActiveError`
  - `InvokeSyscallNotAllowedError`
  - `InvokeSyscallNotImplementedError`
- The core syscall path now verifies:
  - the session row exists,
  - the caller project matches the session project,
  - the session state is `active`,
  - write syscalls are only allowed for mutation sessions.
- Added `POST /invoke/syscall` to `@flarex/executor-http`.
- The HTTP route accepts the current legacy syscall operation vocabulary:
  - `get`
  - `query`
  - `insert`
  - `patch`
  - `delete`
- Added HTTP status mapping:
  - missing session -> `404`
  - project mismatch -> `403`
  - invalid write during query -> `400`
  - inactive session -> `409`
  - document transaction layer not implemented -> `501`
- Updated tests in executor, HTTP, and Nitro wrapper packages.

Why it changed:

This creates the backend-owned syscall API boundary that the Cloudflare Dynamic
Worker can call from `ctx.db`. User function code still does not receive a raw
database connection. The trusted executor validates session identity and basic
operation legality before any future Postgres document read/write work.

Convex references:

- `crates/database/src/transaction.rs`
  - user function database operations are tracked through a backend-owned
    transaction object.
- `crates/database/src/committer.rs`
  - writes become durable only after backend validation and commit.
- `crates/application/src/application_function_runner/mod.rs`
  - function execution is mediated by backend-owned runner state instead of
    exposing database internals to user code.

Flarex references:

- `packages/flarex-backend/src/executionDO.ts`
  - legacy `ExecutionDO.syscall(...)` provides the operation vocabulary and
    query-vs-mutation enforcement reference.
- `packages/executor/src/sessions.ts`
  - new Postgres executor session/syscall boundary.
- `packages/executor-http/src/index.ts`
  - Elysia HTTP route for Dynamic Worker -> trusted executor calls.

Flarex differences:

- Convex executes user code close to its transaction engine. Flarex will run
  user code in Cloudflare and route `ctx.db` calls over this session/syscall
  API to a trusted Postgres executor.
- The current syscall boundary does not yet perform document reads/writes. It
  deliberately returns `InvokeSyscallNotImplementedError` after validation so
  we do not fake transaction semantics.
- The request shape is flat for now, matching the old `ExecutionDO` route. It
  may later move to a nested `{ session, syscall }` envelope if auth/session
  credentials become more complex.

Known limitations:

- No Postgres document repository exists yet.
- No read-set, predicate-set, write-set, OCC validation, or commit protocol is
  implemented in this path.
- No finish/abort route exists in the new executor packages yet.
- `query` request validation only checks JSON shape today; index/range/order
  validation belongs with the document query implementation.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Document Get Syscall

Previous completed checkpoint: `422ac15` Add invoke syscall boundary.

What changed:

- Added `packages/persistence-postgres/src/documents.ts`.
- Added low-level document persistence helpers:
  - `insertDocumentRevision(...)`
  - `getDocumentRevisionAtTs(...)`
  - `parseFlarexDocumentId(...)`
- The helper stores documents in the existing Convex-style `documents` table:
  - `deployment_id`
  - bytea document id suffix
  - timestamp
  - bytea table id
  - bytea JSON value
  - deletion flag
  - previous timestamp
- Wired the helpers through `FlarexPersistence` and the PGlite adapter.
- Wired `executor.invokeSyscall({ op: "get" })` to:
  - validate the Flarex document id,
  - read the latest document revision at the session `beginTs`,
  - return `null` for missing or deleted documents,
  - add `_id` to object documents like the legacy backend reader,
  - return the first read-set shape:

  ```ts
  {
    documents: [{ tableId, id }]
  }
  ```

- Re-exported `FlarexDocumentIdFormatError` through `@flarex/executor` and
  mapped it to HTTP `400`.
- Added PGlite, executor, HTTP, and Nitro fixture coverage.

Why it changed:

This is the first real document read through the trusted Postgres executor
path. Dynamic Worker user code can now call a backend-owned `get` syscall and
receive a snapshot read at the session timestamp without receiving a database
connection. Returning the read-set with the syscall result creates the shape
future `finish`/commit validation will use.

Convex references:

- `crates/database/src/transaction.rs`
  - transaction reads are recorded by the backend-owned transaction state.
- `crates/database/src/committer.rs`
  - commit validates accumulated reads/writes at the authoritative boundary.
- `crates/postgres/src/sql.rs`
  - generic multitenant document history lives in `documents` rather than one
    SQL table per developer table.

Flarex references:

- `packages/flarex-backend/src/transaction.ts`
  - legacy `SingleShardTransaction.get(...)` reads at `beginTs` and merges a
    document read-set.
- `packages/flarex-backend/src/invoke.ts`
  - legacy `readerFor(...).get(...)` adds `_id` to object documents before
    returning them to user code.
- `packages/persistence-postgres/src/schema.ts`
  - existing Convex-style `documents` table.

Flarex differences:

- Convex stores values with its Rust value codec. Flarex currently stores JSON
  bytes encoded with `JSON.stringify(...)`; a future codec can replace this
  without changing the high-level repository contract.
- Convex keeps read-set state inside the transaction object. Flarex currently
  returns the read-set from the syscall response because durable session
  read-set accumulation is not implemented yet.
- The current document id encoding keeps the table id as text bytes and the id
  suffix as text bytes inside bytea columns. This preserves the generic bytea
  table shape while keeping the first TypeScript implementation simple.

Known limitations:

- `query`, `insert`, `patch`, `delete`, `finish`, and `abort` remain pending
  in the new executor packages.
- Read-sets are returned per syscall but not yet accumulated in
  `invoke_sessions` or a separate session read table.
- No OCC validation uses the read-set yet.
- No document validator, placement validator, or index maintenance runs in the
  new Postgres path yet.
- No real Postgres adapter lane has been added; PGlite covers the fast local
  lane only.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Durable Document Read-Set Accumulation

Previous completed checkpoint: `ff7210c` Implement document get syscall.

What changed:

- Added a new Postgres table:

  ```txt
  invoke_session_document_reads
  ```

- Added Drizzle migration `0003_confused_raza.sql` and snapshot metadata.
- Added low-level persistence helpers:
  - `insertInvokeSessionDocumentRead(...)`
  - `listInvokeSessionDocumentReads(...)`
- The table dedupes document reads by:
  - deployment id
  - session id
  - table id
  - full document id
- Each read stores `observedTs`, which is:
  - the document revision timestamp read by the session, or
  - `null` when the document was missing at the session snapshot.
- `executor.invokeSyscall({ op: "get" })` now persists a document read after
  reading the snapshot revision.
- PGlite tests cover migration presence, insert/list behavior, and dedupe.
- Executor tests cover persisted reads for found, missing, deleted, and
  repeated document gets.

Why it changed:

Flarex user code runs outside the trusted Postgres transaction executor. That
means the backend cannot rely on an in-memory transaction object to remember
reads across many remote `ctx.db` syscalls. The session read-set must be
durable and backend-owned so a later `finish` route can validate OCC conflicts
before returning or committing.

Convex references:

- `crates/database/src/transaction.rs`
  - Convex transaction state records reads during user code execution.
- `crates/database/src/committer.rs`
  - commit-time validation compares accumulated reads against current
    database state.
- `crates/model/src/session_requests/mod.rs`
  - system-owned session/request metadata is persisted for protocol
    correctness and idempotency.

Flarex references:

- `packages/flarex-backend/src/transaction.ts`
  - legacy `SingleShardTransaction` keeps read-set state in memory while the
    Durable Object owns the execution session.
- `packages/executor/src/sessions.ts`
  - Postgres executor now persists reads during `get` syscalls.
- `packages/persistence-postgres/src/invokeSessionReads.ts`
  - persistence boundary for durable document read records.

Flarex differences:

- Convex can keep read-set state inside a local transaction object because user
  code and the database transaction engine are colocated. Flarex has a network
  boundary between Cloudflare user code and the trusted executor, so read-set
  state is persisted per syscall.
- This table stores only document reads. Predicate/table/index reads for
  queries will need separate tables or a generalized read-set table.
- `observedTs` is stored for future OCC diagnostics and validation. The exact
  validation algorithm is still pending.

Known limitations:

- Only `get` syscalls persist reads.
- No `finish` route consumes the read-set yet.
- No OCC validation exists yet.
- Query predicate/index reads are not represented yet.
- There is no cleanup/retention policy for abandoned session read rows yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Query Invoke Finish Route

Previous completed checkpoint: `5bec2af` Persist invoke document read sets.

What changed:

- Added `finishInvokeSessionMetadata(...)` to persistence and PGlite.
- Added `executor.finishInvokeSession(...)`.
- Added `POST /invoke/finish` to `@flarex/executor-http`.
- Query session finish now:
  - validates the session exists,
  - validates project ownership,
  - validates the session is still `active`,
  - loads accumulated document reads,
  - returns `{ value, readSet }`,
  - marks the session `finished` with the executor clock.
- Mutation session finish returns `501 InvokeFinishNotImplementedError` until
  write-set, return validation, OCC validation, and commit exist.
- Added persistence, executor, HTTP, and Nitro fixture coverage.

Why it changed:

This closes the first read-only execution session loop:

```txt
/invoke/start
  -> /invoke/syscall get
  -> persisted document reads
  -> /invoke/finish
  -> value + readSet + finished session state
```

That mirrors the part of Convex where query execution returns a value and the
read dependencies needed by the sync/cache layer, without pretending mutation
commit semantics exist yet.

Convex references:

- `crates/database/src/transaction.rs`
  - query execution accumulates reads through a backend-owned transaction.
- `crates/application/src/application_function_runner/mod.rs`
  - function execution returns through backend application logic after user
    code runs.
- `crates/application/src/cache/mod.rs`
  - query results are tied to read dependencies for cache invalidation.

Flarex references:

- `packages/flarex-backend/src/executionDO.ts`
  - legacy query finish returns `{ value, readSet }` and clears the in-memory
    execution session.
- `packages/executor/src/sessions.ts`
  - Postgres executor query finish now returns accumulated durable reads and
    marks the session finished.
- `packages/executor-http/src/index.ts`
  - Elysia route exposes the internal finish endpoint.

Flarex differences:

- Convex keeps query transaction state in memory during execution. Flarex
  persists reads because user code is separated from the trusted executor by a
  Cloudflare-to-executor network boundary.
- Flarex currently marks the session finished but does not clean up session
  read rows.
- Return validation is not implemented yet; `/invoke/finish` accepts a JSON
  value and returns it as-is.

Known limitations:

- Mutation finish/commit is still intentionally unimplemented.
- No return validator is applied.
- No OCC validation is applied.
- No sync invalidation or cache update is emitted.
- Query/index/table read dependencies are still missing.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Mutation Insert Write Staging

Previous completed checkpoint: `06af844` Finish query invoke sessions.

What changed:

- Added a new Postgres table:

  ```txt
  invoke_session_document_writes
  ```

- Added Drizzle migration `0004_cute_mentallo.sql` and snapshot metadata.
- Added low-level persistence helpers:
  - `insertInvokeSessionDocumentWrite(...)`
  - `listInvokeSessionDocumentWrites(...)`
- Added duplicate staged-write detection via
  `InvokeSessionDocumentWriteAlreadyExistsError`.
- Exported executor/schema helpers already used by prepare:
  - `deploymentSchemaFromAnalysis(...)`
  - `tableForName(...)`
  - `encodeFlarexId(...)`
- `executor.invokeSyscall({ op: "insert" })` now:
  - requires a mutation session,
  - loads the session package analysis,
  - resolves the target table id,
  - validates caller-supplied ids against the target table id,
  - generates a Flarex id when the syscall omits one,
  - stores a durable staged write row,
  - returns the document id as the syscall value.
- Added HTTP error mapping for duplicate staged writes and insert id/table
  mismatches.
- Added PGlite, executor, HTTP error mapping, and Nitro fixture coverage.

Why it changed:

Convex lets mutation user code call `ctx.db.insert(...)` multiple times before
the backend transaction commits. Flarex needs the same developer behavior, but
Cloudflare user code is separated from the trusted executor. The first safe
step is to persist write intents inside the backend-owned session, then let a
later mutation finish/commit path validate and apply them atomically.

Convex references:

- `crates/database/src/transaction.rs`
  - mutation writes are accumulated in the transaction before commit.
- `crates/database/src/committer.rs`
  - accumulated writes become durable only after validation and commit.
- `crates/application/src/application_function_runner/mod.rs`
  - user code invokes backend-owned database APIs rather than holding storage
    handles directly.

Flarex references:

- `packages/flarex-backend/src/transaction.ts`
  - legacy `SingleShardTransaction.insert(...)` stages writes before commit.
- `packages/flarex-backend/src/invoke.ts`
  - legacy writer resolves table ids and returns the inserted document id.
- `packages/persistence-postgres/src/invokeSessionWrites.ts`
  - Postgres executor write-intent persistence boundary.

Flarex differences:

- Convex keeps staged writes in a local transaction object. Flarex persists
  staged writes per syscall because user code runs in Cloudflare and the
  trusted executor may be a separate Nitro/Vercel service near Postgres.
- This slice stages insert writes only. It does not write to `documents`,
  update indexes, emit commits, or publish outbox events.
- Document validators and placement validators are not applied yet. They need
  to run before mutation commit.

Known limitations:

- `patch`, `delete`, mutation finish, OCC validation, and commit remain
  pending.
- Staged writes are not cleaned up after abandoned sessions.
- Staged write order is only approximate via `staged_at`; final commit may
  need an explicit monotonic sequence.
- No index maintenance or outbox/sync invalidation is implemented yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Mutation Insert Commit

Previous completed checkpoint: `007fda1` Stage mutation insert writes.

What changed:

- Added `packages/persistence-postgres/src/commits.ts`.
- Added `commitInvokeSessionWrites(...)` to the persistence interface and
  PGlite adapter.
- The PGlite adapter wraps commit in a Drizzle transaction.
- Mutation `finishInvokeSession(...)` now:
  - validates the session is active,
  - loads staged insert writes,
  - allocates a commit timestamp greater than the session `beginTs` and latest
    deployment commit,
  - inserts document revisions into the Convex-style `documents` table,
  - inserts a `commits` row with a write summary,
  - marks the invoke session `finished`,
  - returns `{ value, committedTs, writes }`.
- Added persistence tests for successful insert commit and rollback on insert
  conflict.
- Updated executor tests so mutation finish now commits staged inserts instead
  of returning `501`.

Why it changed:

This is the first real mutation commit path in the Postgres executor. It moves
Flarex from durable write-intent staging to actual document history writes,
while keeping the scope narrow enough to verify:

```txt
/invoke/start
  -> /invoke/syscall insert
  -> durable staged write
  -> /invoke/finish
  -> commits row + documents rows + finished session
```

Convex references:

- `crates/database/src/transaction.rs`
  - mutation writes accumulate before commit.
- `crates/database/src/committer.rs`
  - commit applies writes atomically after validation.
- `crates/postgres/src/sql.rs`
  - document history is stored in generic multitenant `documents` rows.

Flarex references:

- `packages/flarex-backend/src/transaction.ts`
  - legacy `SingleShardTransaction.commit(...)` applies staged writes and
    returns committed write metadata.
- `packages/executor/src/sessions.ts`
  - mutation finish now calls persistence commit.
- `packages/persistence-postgres/src/commits.ts`
  - owns the atomic staged-insert commit implementation.

Flarex differences:

- Convex validates the full read set and write predicates during commit. Flarex
  currently only detects insert conflicts for existing document ids.
- Convex updates indexes and sync invalidation as part of the full backend
  commit path. Flarex currently writes `documents` and `commits` only.
- Commit timestamp allocation is currently package-level logic based on latest
  commit and session begin timestamp. A production Postgres lane should harden
  this with transaction isolation/advisory locking or a dedicated timestamp
  allocator.

Known limitations:

- No read-set OCC validation yet.
- No `patch` or `delete` commit path yet.
- No index maintenance.
- No outbox/sync invalidation.
- No return validator or document validator is applied before commit.
- No cleanup of staged writes/read rows after finish.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Mutation Document Read OCC Validation

Previous completed checkpoint: `824daa5` Commit mutation insert writes.

What changed:

- Added `InvokeSessionOccConflictError`.
- `commitInvokeSessionWrites(...)` now validates persisted document reads
  before applying staged inserts.
- Validation checks each document read:
  - if the session observed `null`, the document must still be missing,
  - if the session observed timestamp `N`, the latest visible revision must
    still be `N`.
- OCC validation runs inside the same PGlite/Postgres transaction as staged
  insert application, commit row insertion, and session finish.
- Commit timestamp allocation now considers:
  - latest `commits.ts`,
  - latest `documents.ts`,
  - session `beginTs`.
- Added persistence tests for:
  - existing read document changed after session begin,
  - missing read document appearing after session begin,
  - rollback leaving session active and no commit/document write.
- Added executor test coverage and HTTP `409` mapping.

Why it changed:

This is the first Convex-critical correctness guard in the Postgres executor
commit path. Mutation user code may perform reads before writes. If another
mutation changes a read document before this mutation commits, Flarex must
reject the commit instead of applying writes based on a stale snapshot.

Convex references:

- `crates/database/src/transaction.rs`
  - document reads are recorded during user execution.
- `crates/database/src/committer.rs`
  - commit validates accumulated reads against current database state before
    applying writes.
- `crates/sync`
  - live query correctness depends on precise read dependencies and commit
    ordering.

Flarex references:

- `packages/persistence-postgres/src/commits.ts`
  - OCC validation runs before staged insert application.
- `packages/persistence-postgres/src/invokeSessionReads.ts`
  - durable document reads are the validation source.
- `packages/executor/src/sessions.ts`
  - mutation finish delegates to the validated persistence commit path.

Flarex differences:

- Convex validates richer read/predicate/index state. Flarex currently only
  validates point document reads from `get`.
- Convex has a hardened timestamp/commit allocator. Flarex currently computes
  the next timestamp from latest commits/documents within the transaction; real
  Postgres needs isolation/advisory-lock hardening before this is production
  grade.
- Flarex read sets are persisted because user code runs across a
  Cloudflare-to-executor boundary.

Known limitations:

- No predicate/index/table read validation yet.
- No `patch` or `delete` write validation/commit yet.
- No index maintenance or outbox/sync invalidation.
- No retry/idempotency replay behavior.
- No real Postgres concurrency stress lane yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Mutation Document Patch Commit

Previous completed checkpoint: `32ae925` Validate mutation document reads.

What changed:

- Added executor syscall support for `patch`.
- `patch` now:
  - validates that the patch value is a non-null JSON object,
  - reads the target document at the invoke session snapshot timestamp,
  - rejects missing/deleted targets before staging,
  - rejects non-object target documents before staging,
  - persists a document read for OCC validation,
  - persists a staged document write with op `patch`.
- `commitInvokeSessionWrites(...)` now applies staged `patch` writes after
  persisted read validation succeeds.
- Patch commit merges the patch object into the latest validated document
  revision, inserts a new revision with `prevTs`, records the committed write,
  writes the commit row, and finishes the invoke session in the same
  PGlite/Postgres transaction.
- Added deterministic HTTP mapping for patch validation and patch target
  failures.
- Updated the in-memory executor persistence test double to match the real
  PGlite/Postgres commit behavior for inserts, patches, OCC conflicts, and
  unsupported staged ops.

Why it changed:

This is the next Convex-style mutation syscall after insert. Convex `patch`
does not blindly overwrite a row; it is a transactional document update that
participates in the same optimistic concurrency validation as reads and other
writes. Flarex must stage the user-code intent and let the trusted executor
commit path own the final merge.

Convex references:

- `crates/database/src/transaction.rs`
  - user execution accumulates document reads and writes against a transaction
    snapshot.
- `crates/database/src/committer.rs`
  - commit validates the transaction read set before applying writes.
- Convex JS server API shape:
  - `ctx.db.patch(id, value)` is a mutation write API, not a direct user-code DB
    connection.

Flarex references:

- `packages/executor/src/sessions.ts`
  - `patch` syscall validates the target at `session.beginTs`, records the read,
    and stages the write.
- `packages/persistence-postgres/src/commits.ts`
  - staged patches merge and insert a new document revision only after OCC
    validation.
- `packages/executor-http/src/index.ts`
  - HTTP remains a thin adapter over executor errors.

Flarex differences:

- Convex keeps execution and commit inside its Rust backend transaction model.
  Flarex persists syscall reads/writes because user code runs through an
  executor syscall boundary.
- The persistence API is now named `commitInvokeSessionWrites(...)` because it
  commits multiple staged write ops, not just inserts.
- Flarex currently supports point-document patch semantics only. Predicate
  query invalidation, index updates, and sync outbox generation are not wired
  yet.

Known limitations:

- No `delete` syscall/commit path yet.
- No validator enforcement for patched documents yet.
- No index maintenance.
- No outbox/sync invalidation.
- No cleanup of staged reads/writes after finish.
- No real Postgres concurrency stress lane yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Invoke Session Commit API Naming Cleanup

Previous completed checkpoint: `94d2636` Commit mutation patch writes.

What changed:

- Renamed the persistence commit API from insert-specific naming to
  write-generic naming:
  - `CommitInvokeSessionInsertsInput` to `CommitInvokeSessionWritesInput`,
  - `CommitInvokeSessionInsertsResult` to `CommitInvokeSessionWritesResult`,
  - `commitInvokeSessionInserts(...)` to `commitInvokeSessionWrites(...)`.
- Updated the PGlite adapter, executor persistence interface, executor finish
  path, executor test persistence fake, Nitro test fake, and PGlite tests.
- Updated earlier implementation notes to reference the new API name.

Why it changed:

The commit API now handles staged `insert` and `patch` writes. Keeping the old
insert-only name would make the next `delete`, validator, index, and outbox
slices harder to reason about. Convex treats transaction commit as applying a
set of accumulated writes, so Flarex should use write-generic naming at this
boundary.

Convex references:

- `crates/database/src/transaction.rs`
  - transactions accumulate reads and writes, not insert-only operations.
- `crates/database/src/committer.rs`
  - commit owns validation and application of the full transaction write set.

Flarex references:

- `packages/persistence-postgres/src/commits.ts`
  - owns `commitInvokeSessionWrites(...)`.
- `packages/executor/src/types.ts`
  - exposes the persistence boundary used by executor core and adapters.
- `packages/executor/src/sessions.ts`
  - mutation finish now calls the write-generic commit API.

Flarex differences:

- Convex's write set is in-process backend state. Flarex's write set is
  persisted through syscall rows because user code executes across a runtime
  boundary.

Known limitations:

- This is a naming/boundary cleanup only.
- At this checkpoint, no `delete` syscall/commit path changed yet.
- No validator, index, outbox, or cleanup behavior changed in this slice.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Mutation Document Delete Commit

Previous completed checkpoint: `c68f587` Rename invoke session commit writes
API.

What changed:

- Added executor syscall support for `delete`.
- `delete` now:
  - parses the table id from the Flarex document id,
  - reads the target document at the invoke session snapshot timestamp,
  - rejects missing/deleted targets before staging,
  - persists a document read for OCC validation,
  - persists a staged document write with op `delete` and `valueJson: null`.
- `commitInvokeSessionWrites(...)` now applies staged `delete` writes after
  persisted read validation succeeds.
- Delete commit inserts a tombstone document revision with:
  - `deleted: true`,
  - `value: null`,
  - `prevTs` pointing at the validated current revision.
- Added deterministic HTTP mapping for delete target failures.
- Updated the in-memory executor persistence test double to match real
  PGlite/Postgres delete commit behavior.
- Added tests for:
  - executor delete staging,
  - executor mutation finish returning the tombstone write summary,
  - missing delete targets rejected at syscall time,
  - PGlite tombstone commit,
  - PGlite rollback for missing delete target,
  - PGlite OCC rejection when the delete target changed.

Why it changed:

This completes the basic Convex-style document write trio for mutation
execution: insert, patch, and delete. Like patch, delete is not a direct user
code database operation. User code stages the intent, and the trusted executor
commit path validates reads and writes the final revision.

Convex references:

- `crates/database/src/transaction.rs`
  - mutation execution accumulates document reads and writes against a snapshot.
- `crates/database/src/committer.rs`
  - commit validates the transaction read set before applying writes.
- Convex JS server API shape:
  - `ctx.db.delete(id)` is part of mutation `ctx.db` and participates in the
    same transactional commit as other writes.

Flarex references:

- `packages/executor/src/sessions.ts`
  - `delete` syscall validates the target at `session.beginTs`, records the
    read, and stages the delete write.
- `packages/persistence-postgres/src/commits.ts`
  - staged deletes insert tombstone document revisions after OCC validation.
- `packages/persistence-postgres/src/documents.ts`
  - document history already supports `deleted` revisions and returns them to
    callers so reads can record the exact observed revision.

Flarex differences:

- Convex keeps the transaction write set in backend memory during execution.
  Flarex persists staged syscall writes because user code executes across an
  executor boundary.
- Tombstones are currently only written to the document history table. Index
  cleanup and sync invalidation are not wired yet.

Known limitations:

- Document validators are now enforced for insert/patch writes when package
  analysis metadata is available.
- No index maintenance or tombstone index cleanup.
- No outbox/sync invalidation.
- No cleanup of staged reads/writes after finish.
- No real Postgres concurrency stress lane yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Mutation Document Validator Enforcement

Previous completed checkpoint: `6ec14de` Commit mutation delete writes.

What changed:

- Added a persistence-local validator module for serialized schema validator
  metadata.
- `commitInvokeSessionWrites(...)` now loads the invoke session package
  analysis, extracts `analysisJson.schema.tables[].validator`, and validates
  final document values before inserting revisions.
- Validation applies to:
  - `insert`: validates the inserted document value,
  - `patch`: validates the merged final document, not only the patch object.
- `delete` still validates the target/read state but does not validate a
  document value because the committed revision is a tombstone.
- Commit now builds a planned write set first, validates the final values, then
  inserts document revisions and the commit row.
- Added public errors:
  - `InvokeSessionDocumentValidationError`,
  - `DeploymentValidatorMetadataError`.
- HTTP maps document validation failures as request/user data errors and
  malformed deployment validator metadata as deployment-state conflicts.
- The executor in-memory persistence test double now validates staged writes
  using the same package analysis metadata when available.
- Added PGlite tests for:
  - valid schema-checked insert,
  - invalid schema-checked insert rollback,
  - valid schema-checked patch after final merge,
  - invalid schema-checked patch rollback.

Why it changed:

Convex validates written documents against the active schema before transaction
commit. After Flarex gained insert, patch, delete, and point-read OCC, the next
correctness gap was allowing invalid table documents into authoritative
storage. This slice moves validation into the trusted Postgres commit path,
where it cannot be bypassed by user code running through the syscall boundary.

Convex references:

- `crates/common/src/schemas/validator.rs`
  - schema validator metadata defines the backend validation contract.
- `crates/database/src/bootstrap_model/import_facing.rs`
  - documents are constructed and checked before validated writes are applied.
- `crates/database/src/committer.rs`
  - commit applies an already validated transaction write set.
- `npm-packages/convex/src/server/schema.ts`
  - developer-facing schema/table validators are the public API inspiration.

Flarex references:

- `packages/persistence-postgres/src/validation.ts`
  - parses and enforces serialized validator metadata.
- `packages/persistence-postgres/src/commits.ts`
  - loads active package analysis and validates final planned writes before
    inserting revisions.
- `packages/executor/test/helpers/persistence.ts`
  - mirrors validation in the in-memory executor test double.

Flarex differences:

- Convex uses its richer Rust validator/value model. Flarex currently supports
  the serialized validator JSON already used by the Flarex analysis pipeline.
- Low-level persistence tests may still create invoke sessions without package
  metadata. In that corrupted/bootstrap state, validation is skipped. Real
  executor-created sessions carry package metadata from deployment activation.
- ID validation currently checks table id prefixes only when the referenced
  table name exists in the analyzed schema.

Known limitations:

- Validator support is still JSON-only: `bigint` and `bytes` validators are
  recognized but rejected because their transport encoding is not implemented.
- No document size limit enforcement yet.
- No placement validator in the Postgres commit path yet.
- No index maintenance or outbox/sync invalidation.
- Missing package metadata should become a hard commit error once all low-level
  tests use realistic package/session setup.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Nitro Adapter Test Utilities Split

Previous completed checkpoint: `e9c0dc4` Validate mutation document writes.

What changed:

- Kept the Nitro adapter test entrypoint as
  `packages/executor-nitro/test/health.test.ts`.
- Moved reusable test helpers into
  `packages/executor-nitro/test/helpers.ts`:
  - `healthyPersistence()`,
  - `fakeExecutor(...)`,
  - `preparedInvokeResult(...)`,
  - `jsonRequest(...)`,
  - `expectPrepareError(...)`.
- `health.test.ts` now contains the adapter behavior tests only and imports the
  shared helpers.

Why it changed:

Nitro adapter tests should remain adapter-focused: route dispatch, JSON
responses, request validation, and executor error mapping. The fake executor is
appropriate at this layer, but keeping a large fake inline in `health.test.ts`
made the file harder to scan and harder to reuse. Splitting helpers keeps the
test entrypoint stable while making future Nitro adapter cases smaller.

Convex references:

- `crates/local_backend` and `crates/application`
  - Convex separates HTTP/application boundary tests from lower-level database
    transaction correctness.
- `npm-packages/convex/src/cli/lib/localDeployment`
  - local adapter code keeps runtime wiring separate from test fixtures.

Flarex references:

- `packages/executor-nitro/test/health.test.ts`
  - remains the Nitro adapter test entrypoint.
- `packages/executor-nitro/test/helpers.ts`
  - owns reusable fakes and request helpers.
- `packages/persistence-postgres/test/pglite.test.ts`
  - remains the real persistence correctness lane.

Flarex differences:

- The Nitro adapter still uses fakes for unit-style route tests. Real
  HTTP/Nitro-to-PGlite integration should be a separate test lane, not folded
  into the adapter unit test file.

Known limitations:

- HTTP adapter tests still have their own inline fake executor. If the same
  fake grows further, extract a shared adapter-test helper package or duplicate
  only the minimal HTTP-specific utility intentionally.
- No new end-to-end `/invoke/start -> /invoke/syscall -> /invoke/finish` test
  was added in this cleanup.

Verification:

```sh
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Nitro Invoke Integration Lane

Previous completed checkpoint: `9e1a7b1` Extract Nitro adapter test helpers.

What changed:

- Added a separate root `integration/` test lane instead of putting real
  route-to-persistence checks inside package unit tests.
- Added `integration/vitest.config.ts` with source aliases for workspace
  packages.
- Added `integration/invoke.integration.test.ts`.
- Added root script:
  - `pnpm test:integration`
- The integration test wires real components:
  - `createPGlitePersistence()`,
  - `createFlarexExecutor(...)`,
  - `createFlarexNitroHandler(...)`.
- The test drives real HTTP/Nitro routes:
  - `POST /invoke/start`,
  - `POST /invoke/syscall`,
  - `POST /invoke/finish`.
- Covered real mutation syscall flows:
  - insert commits a document revision,
  - patch reads the committed insert from a later snapshot and commits a merged
    revision,
  - delete reads the committed patch from a later snapshot and commits a
    tombstone,
  - invalid insert value fails document validator enforcement before commit.

Why it changed:

Adapter unit tests intentionally use fakes to prove route parsing and error
mapping. The platform still needs a real integration lane where the HTTP/Nitro
adapter, executor core, PGlite persistence, invoke sessions, OCC snapshots, and
document validators run together. Keeping this under `integration/` preserves
the rule that package test files remain unit-focused.

Convex references:

- `crates/local_backend`
  - local backend tests exercise API boundaries against real backend behavior.
- `crates/application`
  - application API tests sit above lower-level database tests.
- `crates/database/src/committer.rs`
  - commit behavior remains the correctness boundary validated indirectly by
    route-level mutation flows.

Flarex references:

- `integration/invoke.integration.test.ts`
  - real Nitro invoke route-to-PGlite coverage.
- `integration/vitest.config.ts`
  - integration-only Vitest configuration and workspace source aliases.
- `packages/executor-nitro/test/health.test.ts`
  - remains unit-style adapter coverage with fakes.

Flarex differences:

- This is not full user-code execution. It tests the backend syscall protocol
  directly over HTTP/Nitro routes.
- PGlite is the local reduced integration lane. Real PostgreSQL concurrency and
  advisory-lock behavior still need a separate production-grade lane.

Known limitations:

- No dynamic worker/user bundle execution is covered.
- No query syscall or live `/sync` coverage is included.
- No index maintenance or outbox/sync invalidation is covered.
- The integration test uses source aliases instead of installed package
  artifacts.

Verification:

```sh
corepack pnpm test:integration
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Query Syscall Table Scan And Table Read OCC

Previous completed checkpoint: `34361f7` Add Nitro invoke integration lane.

What changed:

- Added `invoke_session_table_reads` to the Postgres/PGlite schema.
- Added persistence helpers for:
  - inserting/listing invoke session table reads,
  - listing latest visible documents in a table at a snapshot timestamp,
  - detecting table document revisions between a read timestamp and commit.
- Added `invokeSyscall({ op: "query" })` support for a v1 full table scan:
  - request shape: `{ table: string, limit?: number }`,
  - reads visible non-deleted documents at `session.beginTs`,
  - returns the legacy Flarex page shape `{ page, isDone, continueCursor }`,
  - adds `_id` to object documents,
  - persists a table read for OCC and returns `{ readSet: { tables } }`.
- Query session finish now returns both document and table read sets.
- Mutation commit now validates persisted table reads before applying writes.
  If any document revision in a scanned table appears after the observed
  snapshot and before commit, the commit fails with
  `InvokeSessionTableOccConflictError`.
- Added `InvokeQueryRequestError` for malformed query syscall requests.
- Updated the in-memory executor persistence helper and Nitro test helper to
  implement the new persistence methods.
- Extended the integration lane to run:
  - insert,
  - query table scan over Nitro routes,
  - patch,
  - delete.

Why it changed:

Convex-style apps rely on `ctx.db.query(table).collect()` as heavily as
`ctx.db.get(id)`. The backend already supported point reads and mutation
writes, but query syscalls were still blocked. This slice adds the first query
read path and, more importantly, records a durable table read so mutation OCC
does not commit based on a stale table scan.

Convex references:

- `crates/database/src/transaction.rs`
  - query execution records reads into `TransactionReadSet`.
- `crates/database/src/committer.rs`
  - `validate_commit` checks transaction reads against the write log and
    pending writes before applying writes.
- Convex JS server API shape:
  - `ctx.db.query("table").collect()` returns documents and participates in
    live/OCC read tracking.

Legacy Flarex references:

- `packages/flarex-backend/src/executionDO.ts`
  - query syscalls use a request object with `table`, optional index/range,
    cursor, and limit, and return `{ page, isDone, continueCursor }`.
- `packages/flarex-backend/src/transaction.ts`
  - transactions maintain a `ReadSet` with documents, tables, and indexes.
- `packages/flarex-backend/src/occ.ts`
  - read-set overlap checks include table reads.

Flarex differences:

- Legacy Cloudflare Flarex table scans were blocked in favor of indexes. The
  Postgres executor now supports a v1 table scan because it is the simplest
  Convex-compatible query surface and gives us table-read OCC before index
  maintenance.
- This is not yet the full Convex query builder. It only supports table scans
  with an optional limit; index/range/order/pagination come later.
- Table-read OCC is conservative: any document revision in the scanned table
  after the observed snapshot conflicts, even if a future predicate would not
  match that document.

Known limitations:

- No `withIndex`, range, order, cursor pagination, `first`, `unique`, or `take`
  syscall support yet.
- No index maintenance or index-read OCC yet.
- No per-query predicate read validation.
- No live `/sync` invalidation uses these table reads yet.
- Table scans are intentionally v1 and may be expensive without limits on large
  tables.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
corepack pnpm test:integration
git diff --check
```

## Indexed Query Syscall And Index Read OCC

Previous completed checkpoint: `ada19b5` Maintain index entries on mutation
commit.

What changed:

- Added `invoke_session_index_reads` to the Postgres/PGlite schema.
- Added persistence helpers for:
  - inserting/listing invoke session index reads,
  - building Convex-style ordered index bounds from range expressions,
  - reading visible documents through the maintained `indexes` history table,
  - checking whether committed index entries overlap a recorded index range.
- Extended `invokeSyscall({ op: "query" })` request shape:
  - existing table scan remains `{ table, limit? }`,
  - indexed query is now `{ table, index, range?, limit?, cursor?, order? }`,
  - `range.expressions` uses the existing legacy/Convex-like expression shape:
    `{ op: "eq" | "gt" | "gte" | "lt" | "lte", field, value }`.
- Query syscalls now resolve named schema indexes from deployment package
  analysis metadata, compute ordered bounds, read through the Postgres index
  table, and persist an index read dependency.
- Query finish now returns persisted index read sets with `{ indexId, lower,
  upper }`.
- Mutation commit now validates persisted index reads before writing:
  if an index entry was written in the recorded range after the query snapshot
  and before commit, it fails with `InvokeSessionIndexOccConflictError`.
- Added PGlite tests for:
  - reading documents through maintained index entries,
  - rejecting mutation commit after a concurrent write enters a recorded index
    range.
- Added Nitro integration coverage for indexed query syscall through HTTP.

Why it changed:

Convex-style `withIndex()` is the first scalable query primitive after table
scans. Table-read OCC is correct but very conservative. Index-read OCC gives us
the same core shape as Convex: query execution records a structured index
interval, and mutation commit checks later writes against that interval.

Convex references:

- `crates/database/src/transaction.rs`
  - indexed searches record read dependencies into transaction reads.
- `crates/database/src/committer.rs`
  - commit validation checks transaction reads against pending and persisted
    writes before publishing.
- `npm-packages/convex/src/server/index_range_builder.ts`
  - client/server query builder shape with `q.eq`, ordered fields, and range
    operators.

Legacy Flarex references:

- `packages/flarex-backend/src/indexKeys.ts`
  - ordered key codec and bound construction.
- `packages/flarex-backend/src/transaction.ts`
  - `queryIndexPage` merges index reads into the transaction read set.
- `packages/flarex-backend/src/partitionDO.ts`
  - index queries read latest non-deleted entries at the transaction snapshot.
- `packages/flarex-backend/src/occ.ts`
  - read-set overlap uses index ranges.

Flarex differences:

- Convex stores and evaluates index reads in the Rust transaction engine.
  Flarex Postgres stores invoke-session index reads in SQL so the
  framework-neutral executor can validate them at commit.
- The v1 Postgres index reader materializes latest rows in application code
  after fetching matching index history. This is correct for the prototype but
  not the final high-volume query plan.
- Range requests are accepted directly by the syscall object. The generated
  runtime/SDK path now hides this behind Convex-style `withIndex("by_x", q =>
  q.eq(...))`; direct syscall JSON remains the lower-level executor contract.

Known limitations:

- No colocated-table placement enforcement on index ranges in the Postgres
  executor path yet.
- No reverse pagination cursor contract beyond opaque ordered key strings.
- No index compaction/current-row table, so range reads are not production
  efficient yet.
- No staged-index backfill lifecycle.
- Index metadata still comes from package analysis lookup per session.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
corepack pnpm test:integration
git diff --check
```

## Execution Artifact Integration Lane

Previous completed checkpoint: `3e705f4` Add postgres executor transport
bridge.

What changed:

- Added `integration/execution-artifact-postgres.integration.test.ts`.
- The integration lane now has a real materialized user-code artifact calling
  the Postgres executor over `/invoke/start`, `/invoke/syscall`, and
  `/invoke/finish`.
- The executor side is real `@flarex/executor` plus the Nitro HTTP adapter and
  PGlite persistence.
- The user-code side is the existing
  `LocalMiniflareExecutionArtifactMaterializer` with `executorTransport:
  "postgres"`.

Why it changed:

Raw syscall integration tests prove the executor protocol. This test proves
the next architecture boundary: Convex-style user code can execute in a
Cloudflare-shaped artifact while the trusted Postgres executor owns session
state, read tracking, writes, OCC, and commit.

Convex references:

- `crates/function_runner/src/lib.rs`
  - backend-owned function runner and transaction context.
- `crates/isolate/src/environment/udf/syscall.rs`
  - syscall boundary between user code and storage.
- `crates/database/src/transaction.rs`
  - reads and writes accumulate before finish/commit.

Flarex differences:

- Flarex's user-code runtime and transaction executor are separated by an HTTP
  transport boundary. Convex keeps this closer inside its backend runtime.
- The test is PGlite/local only; real Postgres latency, locks, pool behavior,
  and concurrency still need a separate correctness lane.

Known limitations:

- No live sync/outbox assertion is included.
- Local dev has not been switched to the Postgres executor by default.

Verification:

```sh
corepack pnpm test:integration
corepack pnpm --filter flarex-dev typecheck
git diff --check
```

## Executor HTTP Capability Token

Previous completed checkpoint: `1a58000` Test execution artifacts against
postgres executor.

What changed:

- Added optional `capabilityToken` to `@flarex/executor-http`.
- `@flarex/executor-nitro` inherits the option through its adapter config.
- Protected invoke routes now require:

```txt
Authorization: Bearer <capabilityToken>
```

- The protected routes are:
  - `POST /invoke/prepare`,
  - `POST /invoke/start`,
  - `POST /invoke/syscall`,
  - `POST /invoke/finish`,
  - `POST /invoke/abort`.
- `GET /health` stays public because health checks should not need the
  user-code execution capability.
- Added HTTP adapter tests for unauthorized and authorized invoke requests.
- Updated the real execution-artifact integration to run through the protected
  Nitro executor route.

Why it changed:

The trusted Postgres executor is a platform-internal authority. Cloudflare
execution artifacts should not be able to call it unless they carry a
backend-issued capability. This is the first route-level protection before
adding per-session syscall capabilities.

Convex references:

- `crates/node_executor/src/executor.rs`
  - executor requests include backend-controlled auth/callback material.
- `crates/application/src/application_function_runner/mod.rs`
  - execution flows originate from backend-controlled application state.
- `crates/database/src/transaction.rs`
  - storage work must be mediated by the authorized transaction layer.

Flarex differences:

- Flarex has a network/runtime boundary between Cloudflare user-code artifacts
  and the trusted Postgres executor. Convex's equivalent boundary is internal
  to its backend/executor deployment.
- This is route-level bearer auth, not the final token lifecycle.

Known limitations:

- No token minting, rotation, revocation, or project-specific secret store yet.
- No per-session syscall token yet.
- Method-not-allowed responses are still route-shape responses, not protected
  capability checks.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm test:integration
git diff --check
```

## Invoke Abort Session Endpoint

Previous completed checkpoint: `34cae26` Protect postgres executor invoke
routes.

What changed:

- Added `abortInvokeSessionMetadata(...)` to `@flarex/persistence-postgres`.
- Added `FlarexExecutor.abortInvokeSession(...)`.
- Added `POST /invoke/abort` to `@flarex/executor-http` and therefore the
  Nitro adapter.
- Abort marks an active session as:

```txt
state = "aborted"
finished_at = now
```

- Later syscalls or finish attempts on that session fail with
  `InvokeSessionNotActiveError`.
- Added executor unit tests, HTTP adapter tests, and PGlite/Nitro integration
  coverage proving staged writes are not committed after abort.

Why it changed:

The Postgres executor session protocol had start, syscall, and finish, but no
terminal failed-execution path. User-code failures in Cloudflare need to tell
the trusted executor that the session is no longer active and must not commit
staged writes.

Convex references:

- `crates/function_runner/src/lib.rs`
  - function execution separates user-code failure from successful transaction
    commit.
- `crates/database/src/transaction.rs`
  - transaction state is only published through successful commit.
- `crates/application/src/application_function_runner/mod.rs`
  - backend-owned execution handling decides final outcome.

Flarex differences:

- Flarex exposes abort over HTTP because user code and the trusted executor are
  separate runtimes. Convex does not need this exact public adapter route
  internally.
- Abort is a state transition, not a database commit and not a sync event.

Known limitations:

- No stale active-session sweeper exists yet.
- Abort does not remove staged read/write rows; retention cleanup remains
  future work.
- Abort does not currently distinguish user-code failure from local validation
  failure or runtime crash reason.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm test:integration
git diff --check
```

## Artifact Failure Abort Integration

Previous completed checkpoint: `ae4575d` Add postgres invoke abort sessions.

What changed:

- Extended `integration/execution-artifact-postgres.integration.test.ts` so a
  real materialized execution artifact stages a mutation write and then throws.
- The test now verifies the executor session becomes `aborted`.
- It also verifies PGlite has no committed row for the failed staged write.

Why it changed:

Executor-level abort tests prove the endpoint. The stronger platform proof is
that user-code execution over the generated `ctx.db` syscall client can fail
after staging writes and still leave the Postgres document history unchanged.

Convex references:

- `crates/database/src/transaction.rs`
  - staged writes are not visible until commit.
- `crates/function_runner/src/lib.rs`
  - failed function execution does not produce a commit.
- `crates/database/src/committer.rs`
  - publishing writes is a distinct final commit step.

Flarex differences:

- Flarex must send an explicit abort over HTTP from the Cloudflare-shaped
  execution artifact to the trusted executor. Convex does not expose that as a
  separate adapter route.

Known limitations:

- This is still the local PGlite integration lane. Real Postgres concurrency
  and connection failure behavior are not covered here.
- Staged rows remain in session tables until future retention cleanup.

Verification:

```sh
corepack pnpm test:integration
corepack pnpm --filter flarex-dev typecheck
git diff --check
```

## Mutation Commit Index Maintenance V1

Previous completed checkpoint: `4096b2b` Add query table scan syscall.

What changed:

- Added `packages/persistence-postgres/src/indexEntries.ts`.
- Added schema-index metadata parsing from deployment package analysis JSON.
- Added a Postgres persistence index-key codec copied from the legacy Flarex
  ordered index-key shape:
  - declared index fields first,
  - document ID last,
  - deterministic byte encoding for missing, null, booleans, numbers, strings,
    arrays, and objects.
- Mutation commit planning now carries the previous document value alongside the
  final value.
- `commitInvokeSessionWrites` now writes enabled index history in the same
  transaction as document revisions and the commit row:
  - insert writes a live index row,
  - patch tombstones the old key and writes the new key when the key changes,
  - delete tombstones the old key,
  - staged and disabled indexes are ignored for now.
- Added PGlite tests for insert, patch, and delete index maintenance.

Why it changed:

The next Convex-style query step is `ctx.db.query(table).withIndex(...)`.
Before reads can use indexes, committed mutations must maintain index history
authoritatively. Keeping this inside `@flarex/persistence-postgres` matches the
Postgres executor design: framework adapters and HTTP routes call executor
behavior, while durable document/index state is written by the persistence
transaction.

Convex references:

- `crates/database/src/committer.rs`
  - `compute_writes` computes document writes and index writes together before
    publishing a commit.
- `crates/database/src/transaction.rs`
  - transaction state updates the index and document views together.
- `crates/common/src/index.rs`
  - Convex index keys include indexed fields plus the document ID to produce a
    stable total order.

Legacy Flarex references:

- `packages/flarex-backend/src/indexKeys.ts`
  - source for the ordered JavaScript index-key codec copied into Postgres
    persistence.
- `packages/flarex-backend/src/partitionDO.ts`
  - `applyDocumentWrite`, `insertIndexEntries`, and `deleteIndexEntries`
    maintain index tombstones inside commit.

Flarex differences:

- Convex's Rust backend computes full `DatabaseIndexUpdate` values from the
  active in-memory snapshot and index registry. Flarex Postgres v1 computes
  index entries from package analysis metadata stored with the invoke session's
  package.
- The physical Postgres table stores byte-encoded keys in the existing
  Convex-like `indexes` table. There is no separate `current_index_entries`
  materialization yet.
- SHA-256 is computed with Web Crypto to avoid leaking Node-only types into
  packages that consume the persistence source.

Known limitations:

- No indexed query syscall reads from this table yet.
- No index read-set OCC validation yet.
- No staged index backfill or schema-diff lifecycle.
- No index compaction/current-row projection.
- Existing document revisions inserted directly through test helpers do not
  backfill index rows; index maintenance only runs through mutation commit.
- Index metadata is read from package analysis each commit. A later deployment
  metadata layer should make active schema/index lookup explicit and cached.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
corepack pnpm test:integration
git diff --check
```

## Checkpoint

Previous completed checkpoint: `beef4d2` Document Postgres multitenant
persistence schema.

What changed:

- Recorded the Nitro/Vercel executor as a thin adapter over a
  framework-neutral trusted executor core.
- Recorded PGlite as the default local/test persistence lane.
- Defined the current DO-first repo refactor path and the public API cleanup
  target.

Verification:

```sh
git diff --check
```

## Stale Invoke Session Abort Sweep

Previous completed checkpoint: `a08eddd` Verify artifact abort after staged
writes.

What changed:

- Added `abortStaleInvokeSessionsMetadata` in
  `@flarex/persistence-postgres`.
- Exposed stale cleanup through the framework-neutral executor as
  `executor.abortStaleInvokeSessions({ deploymentId, projectId, olderThan })`.
- Added deployment/project ownership validation before cleanup.
- Added authenticated HTTP adapter route `POST /invoke/abort-stale`.
- Nitro inherits the route through the shared `@flarex/executor-http` adapter.
- Added PGlite, executor, HTTP, and Nitro fake coverage.

Why it changed:

The generated runtime now calls `/invoke/abort` when user code throws, but that
is best-effort. If the runtime process, request, or network path dies before the
abort request reaches the executor, staged writes remain in an `active` invoke
session. The trusted executor needs a small scheduler/ops operation to mark old
active sessions aborted without committing staged writes.

Convex references:

- `crates/database/src/transaction.rs`
  - transactions are finite objects owned by the backend; uncommitted writes do
    not publish.
- `crates/application/src/application_function_runner/mod.rs`
  - function execution is coordinated by the backend application layer rather
    than by client-visible user code.
- `crates/function_runner/src/lib.rs`
  - execution and backend coordination are separate concerns.

Flarex differences:

- Convex keeps execution and transaction ownership inside one trusted backend
  runtime. Flarex intentionally splits user code into Cloudflare Dynamic Worker
  execution and a Postgres trusted executor, so abort is an HTTP/internal
  control-plane call plus a cleanup sweep.
- Stale cleanup uses `invoke_sessions.created_at` and only updates rows where
  `state = 'active'`. It does not delete reads or staged writes yet.
- The operation is framework-neutral in executor core; HTTP/Nitro only parse
  requests and enforce the capability token.

Known limitations:

- No scheduler/cron runner is wired yet; this only adds the callable operation.
- No retention deletion for aborted session reads/writes yet.
- No per-deployment TTL policy yet; callers provide `olderThan`.
- Batching was added later through the maintenance runner API; callers should
  prefer that scheduler-facing route over manually calling this primitive.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Interactive Invoke Session Semantics

Previous completed checkpoint: `fd4a4f4` Add maintenance sweep core.

What changed:

- Re-centered the Postgres executor around interactive transaction syscalls.
- Recorded that Dynamic Worker user code must call the executor for every
  `ctx.db.*` operation and wait for the result before continuing.
- Rejected the collect-locally-and-replay-later model for mutations.
- Defined the required transaction view as persisted snapshot at `begin_ts` plus
  the invoke session's staged writes.

Implementation plan:

1. Add executor tests that fail until read-your-own-writes is authoritative:
   insert/get, patch/get, delete/get, table query overlay, and a realistic
   parent-read, child-insert, child-query, parent-patch mutation.
2. Implement a shared transaction-view helper in executor core that loads
   persisted documents from `@flarex/persistence-postgres` and overlays staged
   writes for the current invoke session.
3. Use that helper for `db.get` and table query syscalls.
4. Extend the same model to indexed query syscalls after table-query overlay is
   correct.

Convex references:

- `crates/database/src/transaction.rs`
  - read-your-writes and transaction-local state.
- `crates/database/src/committer.rs`
  - staged writes are validated and committed together.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code performs database operations through syscall boundaries.

Flarex differences:

- Convex's trusted backend and isolate integration are process-local Rust
  components. Flarex's Dynamic Worker is remote from the trusted Postgres
  executor, so each DB call is an authenticated internal request tied to an
  invoke session.
- Flarex keeps Postgres locks and transactions short by staging outside the
  final commit transaction.

Known limitations:

- Current docs describe the target behavior; implementation still needs the
  overlay tests and helper.
- Long-running deterministic mutation logic is allowed but increases conflict
  probability because the logical snapshot gets older.
- Expensive side-effectful work still belongs in actions, not mutations.

Verification:

```sh
git diff --check
```

## Mutation-Owned Live-Query Trigger Plan

Previous completed checkpoint: `48d7261` Add live query trigger route.

What changed:

- Recorded that the trusted Postgres executor, not Cloudflare routing, must own
  the production trigger for live-query invalidation.
- Defined the next executor slice as post-commit stale subscription marking
  plus trigger notification.
- Kept the executor framework-neutral: trigger notification must be injected
  by host/adapters, not hard-coded to Nitro, Vercel, or Cloudflare.

Executor ownership rule:

```txt
mutation finish succeeds
  -> OCC validates read set
  -> writes and outbox/freshness metadata commit
  -> executor marks matching live_query_subscriptions stale
  -> executor invokes injected live-query trigger notifier
```

The executor must not notify before commit. Failed OCC validation, failed
schema validation, aborted sessions, and thrown mutation errors must not create
client-visible live-query transitions.

Route ownership from executor point of view:

| Boundary | Executor role |
| --- | --- |
| `/invoke/finish` | Own successful mutation commit, OCC validation, write publication, and post-commit hooks |
| `live_query_subscriptions` | Own durable stale-state updates because the executor owns committed writes and freshness metadata |
| `/scheduler/live-query-subscriptions/trigger` | Call through an injected notifier after stale rows exist |
| `/maintenance/live-queries/rerun` | Serve `SchedulerDO` bounded rerun requests |
| `live_query_deliveries` | Own durable delivery rows produced by changed reruns |
| `/deployments/:deploymentId/sync/wake-delivery` | Notify Cloudflare only after durable delivery rows exist |

Convex references inspected:

- `crates/database/src/committer.rs`
  - commit validates reads before writes become visible and appends write-log
    data for subscriptions.
- `crates/sync/src/worker.rs`
  - sync work is scheduled from backend-owned invalidation state.
- `crates/sync/src/state.rs`
  - active query state suppresses unchanged rerun results through hashes.

Flarex differences:

- Convex can schedule invalidated query work inside the same backend process.
  Flarex must split this into a durable Postgres commit, executor-owned stale
  subscription state, and an injected Cloudflare trigger notifier.
- The executor core should expose hooks/interfaces, while
  `@flarex/executor-http`, `@flarex/executor-nitro`, or deployable hosts decide
  how to call Cloudflare.

Known limitations:

- Mutation finish now drives freshness publication and calls the injected
  trigger notifier after successful commit. This section is retained as the
  historical plan that led to the implemented path.
- Range/index read invalidation is not precise enough yet for all Convex query
  shapes.

First implementation plan:

1. Add failing executor tests around successful mutation commit and failed
   mutation/OCC paths.
2. Implement stale subscription marking from committed write metadata using
   existing live-query registry/freshness primitives.
3. Add a framework-neutral post-commit hook interface, for example
   `notifyLiveQueryInvalidated({ deploymentId, projectId })`.
4. Wire HTTP/Nitro host config to call the Cloudflare trigger route, but keep
   executor core independent from HTTP.
5. Add an integration test through real adapter routes after core behavior is
   proven.

Verification:

```sh
git diff --check
```
