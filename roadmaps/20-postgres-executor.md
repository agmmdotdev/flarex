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
