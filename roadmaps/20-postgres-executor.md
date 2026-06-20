# Postgres Executor

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
- Added `commitInvokeSessionInserts(...)` to the persistence interface and
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
- `commitInvokeSessionInserts(...)` now validates persisted document reads
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
- `commitInvokeSessionInserts(...)` now applies staged `patch` writes after
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
- The persistence API is still named `commitInvokeSessionInserts(...)`; it now
  commits inserts and patches. Rename this to `commitInvokeSessionWrites(...)`
  before treating the persistence interface as stable.
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
