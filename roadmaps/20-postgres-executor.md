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
packages/flarex-postgres
  status: new
  role: generic document/index persistence, migrations, PGlite adapter,
        real Postgres adapter

packages/flarex-executor
  status: new
  role: framework-neutral trusted executor core

packages/flarex-executor-nitro
  status: new
  role: thin Nitro/Vercel adapter over flarex-executor
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
packages/flarex-postgres
  Convex-style generic document/index persistence
  schema migrations
  OCC read validation
  commit/write-log/outbox transaction helpers
  adapters for real Postgres and PGlite

packages/flarex-executor
  trusted executor core
  createFlarexExecutor()
  stable fetch/request protocol
  auth and deployment scoping
  query/mutation execution-session endpoints
  no Nitro, Vercel, Cloudflare, or UI imports

packages/flarex-executor-nitro
  Nitro adapter only
  maps Nitro events/routes to flarex-executor fetch handlers
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
  -> in-process flarex-executor core
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
  add flarex-postgres persistence interfaces and PGlite adapter
  port generic document/index schema into SQL migrations

Phase 3:
  add flarex-executor core using the persistence interface
  tests call executor core directly with PGlite

Phase 4:
  add flarex-executor-nitro adapter
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

- No `flarex-postgres`, `flarex-executor`, or `flarex-executor-nitro` package
  exists yet.
- Existing backend code still commits through `PartitionDO`.
- Existing generated server code still emits partition model helpers.
- Existing example schema still uses partition/colocation helpers.
- PGlite can keep local and test loops fast, but it cannot replace real
  Postgres correctness testing.

## First Implementation Step

Create package boundaries and tests before writing full SQL behavior:

1. Add `packages/flarex-postgres` with a tiny persistence interface and PGlite
   adapter scaffold.
2. Add `packages/flarex-executor` with `createFlarexExecutor(...)` and a
   framework-agnostic health function.
3. Add `packages/flarex-executor-nitro` as adapter-only.
4. Add one `flarex-test` in-process executor harness test using PGlite.
5. Do not wire the main SDK/client path to it yet.

This keeps the next code change small and proves the new package direction
without mixing it with the large SDK/codegen partition API removal.

## Health Endpoint Package Shell

Previous completed checkpoint: `af85c26` Record executor package migration and
cache layers.

What changed:

- Added `packages/flarex-executor` as the framework-neutral trusted executor
  core package.
- Added `createFlarexExecutor()` with a direct `health()` method.
- Added `packages/flarex-executor-nitro` as an adapter-only package that
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
corepack pnpm --filter flarex-executor typecheck
corepack pnpm --filter flarex-executor test
corepack pnpm --filter flarex-executor-nitro typecheck
corepack pnpm --filter flarex-executor-nitro test
git diff --check
```

## Framework-Agnostic Core Correction

Previous completed checkpoint: `2107439` Add executor health endpoint packages.

What changed:

- Removed `fetch(request)` and `healthPath` from `packages/flarex-executor`.
- Kept `packages/flarex-executor` as direct core functions only:
  `createFlarexExecutor().health()`.
- Moved HTTP route matching, JSON response creation, and 404 handling into
  `packages/flarex-executor-nitro`.
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
  `flarex-executor-nitro`; direct executor methods remain the source of
  behavior.

Known limitations:

- The Nitro adapter is still a minimal web-standard adapter, not a real Nitro
  route module.
- No session/syscall/OCC methods exist yet.

Verification:

```sh
corepack pnpm --filter flarex-executor typecheck
corepack pnpm --filter flarex-executor test
corepack pnpm --filter flarex-executor-nitro typecheck
corepack pnpm --filter flarex-executor-nitro test
git diff --check
```

## Convex-Style Postgres Persistence Package

Previous completed checkpoint: `39b9555` Keep executor core transport
agnostic.

What changed:

- Added `packages/flarex-postgres`.
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
corepack pnpm --filter flarex-postgres typecheck
corepack pnpm --filter flarex-postgres test
corepack pnpm --filter flarex-executor typecheck
corepack pnpm --filter flarex-executor-nitro typecheck
git diff --check
```

## Drizzle Schema And Metadata Boundary

Previous completed checkpoint: `5874332` Add Convex-style Postgres
persistence package.

What changed:

- Added Drizzle ORM to `packages/flarex-postgres`.
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
corepack pnpm --filter flarex-postgres typecheck
corepack pnpm --filter flarex-postgres test
git diff --check
```

## Package-Local Drizzle Kit Migrations

Previous completed checkpoint: `a3692cf` Add Drizzle schema for Postgres
persistence.

What changed:

- Added `packages/flarex-postgres/drizzle.config.ts`.
- Added package-local scripts:
  - `db:generate`
  - `db:check`
- Added `drizzle-kit` as a `flarex-postgres` dev dependency.
- Generated the first package-local migration under
  `packages/flarex-postgres/drizzle/`.
- Replaced the custom in-source migration runner with
  `drizzle-orm/pglite/migrator`.
- Removed the custom `flarex_schema_migrations` app table and switched to
  Drizzle's own migration log table under the `drizzle` schema.
- Changed `FlarexPersistence.migrate()` to return `Promise<void>` because the
  Drizzle migrator applies migrations but does not report an applied list.

Why it changed:

The Postgres package owns persistence schema and migration history. Drizzle Kit
should live package-locally instead of at the workspace root, so schema changes,
generated SQL, and migration metadata stay with `flarex-postgres`.

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
- Re-exported Drizzle's `sql` helper from `flarex-postgres`.
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

- Added `flarex-postgres` as a dependency of `flarex-executor`.
- Made `createFlarexExecutor({ persistence })` require a persistence
  dependency.
- Changed `executor.health()` from synchronous to async.
- Added persistence dependency health to the executor health payload.
- Added degraded health reporting when `persistence.check()` fails.
- Updated `flarex-executor-nitro` so the adapter requires an injected executor
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
  `flarex-executor-nitro` concern.

Known limitations:

- Health only checks persistence connectivity.
- No migrations are run by executor startup yet.
- No execution session, syscall, read-set, or OCC commit methods exist yet.

Verification:

```sh
corepack pnpm --filter flarex-executor typecheck
corepack pnpm --filter flarex-executor test
corepack pnpm --filter flarex-executor-nitro typecheck
corepack pnpm --filter flarex-executor-nitro test
corepack pnpm --filter flarex-postgres typecheck
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
