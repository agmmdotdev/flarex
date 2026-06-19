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
