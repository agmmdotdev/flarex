# Dynamic Worker Execution

## Current Decision

Developer modules should run in Flarex-managed dynamic execution isolates and
receive only restricted syscall APIs. Developers write ordinary TypeScript
functions under `flarex/`, not Worker entrypoints. Flarex converts the uploaded
source package into an internal execution artifact. Developer code must not
receive raw Durable Object stubs, SQLite handles, or environment bindings.

## Intended Flow

```txt
Worker router
  -> resolve deployment and partition
  -> begin transaction in PartitionDO
  -> load active Flarex-managed execution artifact
  -> run developer function in dynamic execution isolate
  -> syscalls collect reads and staged writes
  -> commit through PartitionDO
```

## Implemented So Far

`apps/backend/src/transaction.ts` defines `SingleShardTransaction`, the first
backend syscall-facing transaction layer. It is not a Dynamic Worker executor
yet, but it is the object the executor should use to service future `ctx.db`
syscalls:

- `get(tableId, id)`
- `queryIndex({ indexId, lower, upper, limit })`
- `insert(tableId, value, id?)`
- `replace(tableId, id, value)`
- `patch(tableId, id, value)`
- `delete(tableId, id)`
- `commit({ source, idempotencyKey })`

The Dynamic Worker should receive a restricted API backed by this wrapper, not
raw Durable Object bindings, raw SQLite handles, or the Cloudflare `env`.

`apps/backend/src/invoke.ts` defines the first backend invoke boundary:

- `executeInvoke(env, deploymentId, request, functions)`
- `BackendFunctionRegistry`
- query and mutation contexts backed by `SingleShardTransaction`
- table-name resolution through `DeploymentDO` for
  `ctx.db.insert("tableName", value)`
- per-invoke schema cache sync from `DeploymentDO` to target `PartitionDO`
  before transaction begin
- `ctx.db.get(id)` returns a developer-facing document value with `_id`
- `/deployments/:deploymentId/invoke`
- top-level `/invoke` with `deploymentId` in the body or
  `x-flarex-deployment` header

The Worker route currently uses an empty backend function registry. This is
intentional until the Dynamic Worker bridge or deployed function registry is
implemented.

`apps/backend/src/executionDO.ts` adds the first backend execution-session
syscall protocol:

- `POST /deployments/:deploymentId/executions/start`
- `POST /deployments/:deploymentId/executions/:sessionId/syscall`
- `POST /deployments/:deploymentId/executions/:sessionId/finish`
- `POST /deployments/:deploymentId/executions/:sessionId/abort`

`ExecutionDO` owns one active `SingleShardTransaction` session. It validates
deployed function args at `/start`, services restricted `ctx.db` operations
through `/syscall`, validates returns at `/finish`, and only then commits
mutations through `PartitionDO`.

The generated Worker now runs user handlers with a scoped syscall-backed
`ctx.db` client. It no longer stores documents in its own generated
`PartitionDO`; it calls the authoritative backend service binding instead.

## Convex References

- `crates/isolate/src/environment/udf/syscall.rs`
  Inspiration for syscall boundary.
- `crates/function_runner/src/lib.rs`
  `FunctionFinalTransaction`, `FunctionReads`, and `FunctionWrites`.
- `crates/function_runner/src/server.rs`
  Function runner interface.
- `crates/application/src/application_function_runner/mod.rs`
  Application-level function execution and transaction merge.

## Terminology And Cloudflare Difference

Convex isolates user code with its own Rust/V8 infrastructure. Flarex should
use Cloudflare runtime isolation, but must still enforce the same architectural
boundary: user code sees `ctx.db`, not storage.

Cloudflare calls dynamically dispatched scripts "User Workers." In Flarex,
those scripts are internal execution artifacts generated and managed by Flarex.
The developer does not write Worker code, a `fetch` handler, Wrangler
configuration, or bindings.

See `roadmaps/17-deployment-analysis-and-push.md` for the source-bundle,
analysis, candidate push, and activation lifecycle.

## Generated Postgres Invoke Optional Fields

Previous completed checkpoint: `5526aa2` Add outbox dispatcher core.

What changed:

- Updated generated Worker codegen and the local runtime materializer template
  to omit optional Postgres executor fields when they are `undefined`.
- The affected fields are `projectId`, `executorToken`, `partitionKey`, and
  `idempotencyKey` on `/invoke/start`, `/invoke/finish`, and `/invoke/abort`
  helper calls.
- This keeps generated artifacts compatible with
  `exactOptionalPropertyTypes`.

Why it changed:

The workspace typecheck runs `apps/example` generation before TypeScript
validation. Generated invoke code was passing optional fields as explicit
`undefined`, which is invalid for helper input types declared with optional
properties. The runtime behavior was unchanged, but the generated TypeScript
gate failed.

Convex references:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated artifacts should typecheck as first-class source.
- `npm-packages/convex/src/cli/codegen_templates`
  - optional generated runtime fields should preserve TypeScript semantics.

Flarex differences:

- Convex generated workers do not carry Flarex's executor transport fields.
  Flarex must handle these optional hosted/local executor fields explicitly.

Known limitations:

- This only fixes optional property emission. It does not remove legacy
  `partitionKey` transport fields from generated artifacts.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm typecheck
git diff --check
```

## Known Limitations

- The Dynamic Worker path is still generated Worker code, not Cloudflare's
  production Dynamic Worker upload/deployment flow.
- Execution sessions currently keep transaction state in one `ExecutionDO`
  instance's memory. If a session DO is evicted mid-execution, the session is
  lost and must be retried by a future executor layer.
- The production Worker route has no deployed function registry yet, so it
  reports unknown functions until the Dynamic Worker bridge is connected.
- There is no executor retry loop around `OCC_CONFLICT` yet.
- Index reads through the wrapper do not yet overlay staged writes.
- Cross-shard calls remain intentionally out of scope for normal mutations.

## Local Live-Query Execution Host

Previous completed checkpoint: `92c38cf` Wire live query rerun route to invoke
bridge.

What changed:

- Added an optional `executeQuerySession(...)` method to materialized execution
  artifacts.
- Added a local Miniflare internal route:
  `/__flarex_internal/query-session`.
- Added `createMaterializedArtifactLiveQueryExecutionHost(...)` in
  `flarex-dev`.
- The helper adapts the executor's
  `RunLiveQuerySubscriptionWithInvokeInput["executeQuery"]` callback to a
  materialized user-code artifact.
- Query reruns now execute user query code against an existing backend-owned
  Postgres invoke session. The artifact calls `/invoke/syscall`; it does not
  call `/invoke/start`, `/invoke/finish`, or `/invoke/abort`.

Why it changed:

Live-query reruns need the same Convex-style boundary as normal invokes:
trusted backend creates the transaction/session, user code runs in an isolate,
and all `ctx.db.*` operations go back through restricted syscalls. The previous
HTTP maintenance route accepted an `executeQuery` callback, but there was no
concrete local execution host to run the stored query function.

Convex references:

- `crates/isolate/src/environment/udf/syscall.rs`
  - user code reaches storage through a syscall boundary.
- `crates/application/src/application_function_runner/mod.rs`
  - backend application execution owns function/session coordination.
- `crates/sync/src/worker.rs`
  - sync workers rerun subscribed queries and publish transitions.

Flarex differences:

- Convex reruns queries inside its integrated backend runtime. Flarex's current
  local path materializes the uploaded `flarex/` source package into Miniflare
  and talks to the trusted Postgres executor over internal HTTP-style syscalls.
- This is a local/dev host over materialized artifacts. The production
  Cloudflare Dynamic Worker artifact loader is still future work.
- The query-session route only supports the Postgres executor transport because
  the legacy Durable Object execution path owns its own session lifecycle.

Known limitations:

- The executor HTTP maintenance route still needs to be wired to this helper by
  the dev/server adapter.
- Hosted Dynamic Worker artifact loading is not implemented.
- Query-session execution currently returns only the user query value; the
  executor remains responsible for finishing the session and collecting the
  final read set.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts
corepack pnpm --filter flarex-backend typecheck
```

## Postgres Executor Transport Bridge

Previous completed checkpoint: `6c7c80a` Harden generated indexed query API.

What changed:

- Generated execution Workers now support an explicit executor transport:
  - `legacy` keeps the existing `/deployments/:id/executions/*` route shape.
  - `postgres` calls the new trusted executor routes:
    `/invoke/start`, `/invoke/syscall`, and `/invoke/finish`.
- The generated Worker accepts `FLAREX_EXECUTOR_TRANSPORT`,
  `x-flarex-executor-transport`, `FLAREX_PROJECT_ID`, `x-flarex-project`, and
  `projectId` for the Postgres executor route.
- The local Miniflare execution-artifact materializer has the same transport
  bindings so dev/runtime tests can execute the hosted-shape contract.
- Postgres syscall responses are unwrapped from `{ value, readSet? }` before
  being returned to user `ctx.db` helpers.
- Postgres start responses can return the function kind as
  `function.kind`; legacy start responses can still return top-level `kind`.
- The legacy transport remains the default until the public backend path is
  fully migrated off the Durable Object execution session prototype.

Why it changed:

The Postgres executor now owns the forward authoritative transaction protocol,
but generated/materialized user-code artifacts still spoke only to the older
Cloudflare Durable Object execution-session routes. This bridge lets the same
restricted `ctx.db` user-code runtime target the new executor without changing
developer function code.

Convex references:

- `crates/function_runner/src/lib.rs`
  - user function execution talks to a backend-owned transaction context.
- `crates/isolate/src/environment/udf/syscall.rs`
  - isolate code reaches storage through a syscall boundary.
- `crates/application/src/application_function_runner/mod.rs`
  - application execution resolves deployment/function metadata before running
    user code.

Flarex differences:

- Convex's runner and database transaction engine are inside the same backend
  system. Flarex runs user code in a managed Cloudflare runtime and calls a
  trusted executor over a transport boundary.
- The legacy DO route remains as a compatibility/default path while the
  Postgres executor matures. The Postgres route requires `projectId` because
  the new executor is explicitly multitenant at the platform/project level.

Known limitations:

- This is an opt-in transport bridge, not a full migration of backend public
  invoke to the Postgres executor.
- Runtime authorization between Cloudflare execution artifacts and the trusted
  Postgres executor still needs a capability-token design.
- The generated public `/invoke` path still exists; hosted Flarex should route
  real platform invocations through managed execution artifacts.
- The Postgres executor must still gain live sync/outbox integration before it
  replaces the DO prototype end to end.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-backend typecheck
git diff --check
```

## Materialized Artifact To Postgres Executor Integration

Previous completed checkpoint: `3e705f4` Add postgres executor transport
bridge.

What changed:

- Added an integration test where a local Miniflare execution artifact runs
  real user-code handlers through the Postgres executor transport.
- The test registers and activates a deployment package in
  `@flarex/executor`, backed by PGlite persistence.
- The materialized artifact calls:
  - `/invoke/start`,
  - `/invoke/syscall`,
  - `/invoke/finish`.
- The mutation handler uses `ctx.db.insert(...)`; the query handler uses the
  Convex-style `ctx.db.query(...).withIndex(...).collect()` API.
- The test verifies committed document writes and indexed query read-set
  output from the trusted executor.

Why it changed:

The previous bridge proved the materialized runtime could call the Postgres
route shape with a fake backend. This checkpoint proves the actual forward
architecture works through real layers:

```txt
materialized execution artifact
  -> restricted ctx.db syscall client
  -> @flarex/executor-nitro HTTP adapter
  -> @flarex/executor session/syscall/finish methods
  -> @flarex/persistence-postgres PGlite transaction path
```

Convex references:

- `crates/isolate/src/environment/udf/syscall.rs`
  - user code talks to storage through syscalls, not direct database handles.
- `crates/function_runner/src/lib.rs`
  - function execution receives a backend-owned transaction context.
- `crates/application/src/application_function_runner/mod.rs`
  - application execution combines active deployment metadata with executor
    invocation.

Flarex differences:

- Convex runs the function runner near its database engine. Flarex's target
  keeps the user-code runtime in Cloudflare and the trusted transaction
  executor near Postgres.
- This integration uses local Miniflare and PGlite. Production still needs the
  hosted Dynamic Worker materializer and real Postgres lane.
- Legacy DO execution remains available as the default compatibility transport;
  this test explicitly selects `postgres`.

Known limitations:

- The local dev server still uses the legacy backend for push/artifact storage
  and public invoke routing.
- The test covers mutation insert and indexed query, but not patch/delete,
  actions, sync fanout, or retry-on-OCC-conflict behavior through user code.

Verification:

```sh
corepack pnpm test:integration
corepack pnpm --filter flarex-dev typecheck
git diff --check
```

## Postgres Executor Capability Token Bridge

Previous completed checkpoint: `1a58000` Test execution artifacts against
postgres executor.

What changed:

- Generated execution Workers now accept `FLAREX_EXECUTOR_TOKEN`.
- Local materialized execution artifacts accept `executorToken` and bind it as
  `FLAREX_EXECUTOR_TOKEN`.
- When `executorTransport` is `postgres`, generated/materialized artifacts add
  `Authorization: Bearer <token>` to `/invoke/start`, `/invoke/syscall`, and
  `/invoke/finish`.
- Legacy execution-session routes do not receive this executor token.
- Runtime materializer tests now assert the Authorization header on all three
  Postgres executor calls.
- The real execution-artifact-to-Postgres integration now runs with a protected
  executor route.

Why it changed:

The user-code runtime is an internal Flarex-managed artifact. Once it calls the
trusted Postgres executor over HTTP, that route needs an explicit capability
boundary. This mirrors the existing artifact-runtime internal token pattern
while keeping the developer-facing API unchanged.

Convex references:

- `crates/node_executor/src/executor.rs`
  - executor requests carry backend-controlled callback/auth material.
- `crates/application/src/application_function_runner/mod.rs`
  - application code execution is initiated by the backend, not by arbitrary
    public callers.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code can only perform storage work through the authorized syscall
    channel.

Flarex differences:

- Convex does not need a separate HTTP bearer token between Cloudflare user
  code and a Nitro/Postgres executor. Flarex does because those are separate
  deployment/runtime boundaries.
- This is a shared capability token for the executor route. Per-session syscall
  tokens and token rotation are still future work.

Known limitations:

- Token generation, rotation, and tenant/project-specific secret management
  are not implemented.
- No per-session syscall capability is enforced yet; the token protects the
  executor route as a whole.
- The local dev server still defaults to the legacy execution route.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm test:integration
git diff --check
```

## Postgres Executor Abort Bridge

Previous completed checkpoint: `34cae26` Protect postgres executor invoke
routes.

What changed:

- Generated execution Workers now call `POST /invoke/abort` for the Postgres
  transport when user code or local return validation throws after session
  start.
- Local Miniflare materialized execution artifacts use the same abort route.
- Legacy transport still calls the existing
  `/deployments/:id/executions/:sessionId/abort` route.
- Abort calls include the same `Authorization: Bearer <executorToken>` header
  as start/syscall/finish.
- Added materializer coverage proving a failing user-code handler sends
  `/invoke/abort` with `deploymentId`, `projectId`, and `sessionId`.

Why it changed:

The Postgres transport previously skipped abort because the executor had no
abort endpoint. That left failed user-code sessions active in the trusted
executor. Convex-style execution needs an explicit terminal path for failed
function execution, even when no commit happens.

Convex references:

- `crates/function_runner/src/lib.rs`
  - user execution has a final transaction outcome; failed execution does not
    publish staged writes.
- `crates/application/src/application_function_runner/mod.rs`
  - function execution result handling is backend-owned.
- `crates/isolate/src/environment/udf/syscall.rs`
  - storage effects remain behind the backend syscall/session boundary.

Flarex differences:

- Convex failure cleanup is internal to its backend/executor process. Flarex
  must represent failure over an HTTP transport between Cloudflare user-code
  artifacts and the trusted Postgres executor.
- Abort currently marks the session terminal and prevents further syscalls or
  finish. It does not yet delete staged reads/writes or run retention cleanup.

Known limitations:

- Abort is best-effort from generated/materialized artifacts; if the runtime is
  killed before the abort request, a future session TTL/reaper is still needed.
- There is no per-session capability token yet.
- Abort does not publish sync invalidations, because no commit happened.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm test:integration
git diff --check
```

## Real Artifact Abort After Staged Write

Previous completed checkpoint: `ae4575d` Add postgres invoke abort sessions.

What changed:

- Extended the real execution-artifact-to-Postgres integration test.
- The materialized user-code artifact now includes a mutation that:
  1. calls `ctx.db.insert("messages", ...)`,
  2. throws an error before returning.
- The test verifies:
  - the artifact invoke rejects with the user-code error,
  - the trusted executor session is marked `aborted`,
  - the staged write is not committed to PGlite,
  - the previously committed document remains the only visible row.

Why it changed:

The previous abort slice proved the raw executor abort route and a fake
materializer abort call. This checkpoint proves the actual combined runtime
behavior we care about: Convex-style user code can stage writes through
`ctx.db`, fail, and the Postgres executor will not publish those writes.

Convex references:

- `crates/function_runner/src/lib.rs`
  - failed function execution must not publish a transaction.
- `crates/database/src/transaction.rs`
  - writes are staged until successful commit.
- `crates/application/src/application_function_runner/mod.rs`
  - backend-owned execution result controls final transaction outcome.

Flarex differences:

- Flarex represents the failed outcome through `/invoke/abort` over the
  Cloudflare-to-executor transport. Convex handles this inside its backend
  runtime boundary.

Known limitations:

- This still uses local Miniflare and PGlite, not hosted Dynamic Workers and
  real Postgres.
- There is still no retry loop around OCC conflicts from user-code execution.
- A session sweeper is still needed for runtime crashes that happen before the
  abort request reaches the executor.

Verification:

```sh
corepack pnpm test:integration
corepack pnpm --filter flarex-dev typecheck
git diff --check
```

## Partition Scope Runtime Update

## Required Partition Scope Update

Checkpoint title: `Require partition metadata for execution`

Previous completed checkpoint: `7673d45` Bind execution sessions to partition
metadata.

`ExecutionDO` sessions now require partition metadata before user-code syscalls
can run.

What changed:

- Removed the route-only and explicit `partitionKey` fallback execution scopes.
- `ExecutionDO.start()` fails with `PartitionValidationError` if the active
  function metadata has no `partition`.
- Session tests now declare `partition: users.byId("userId")` and pass the
  owner argument, matching the future generated handler model.

Convex references:

- `crates/isolate/src/environment/udf/syscall.rs`
  - user code gets syscalls after the backend establishes its execution
    context.
- `crates/function_runner/src/server.rs`
  - execution is created by the backend runner, not by user-selected storage.
- `crates/application/src/application_function_runner/mod.rs`
  - active deployment metadata is part of the execution boundary.

Cloudflare difference:

- The dynamic execution session must know the exact `PartitionDO` before any
  syscall can touch storage. Raw client-provided partition keys are transport
  data only.

Remaining limitations:

- Generated Worker transport still includes `partitionKey`; the backend now
  verifies it from partition metadata.
- There is no explicit non-partition execution policy yet for future global,
  projection, or workflow functions.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Partition Scope Runtime Update

Bound `ExecutionDO` sessions to function partition metadata before user-code
syscalls can run.

Checkpoint title: `Bind execution sessions to partition metadata`

Previous completed checkpoint: `231447a` Preserve partition selector metadata.

What changed:

- `ExecutionDO.start()` now resolves a `FunctionExecutionScope` from active
  deployment metadata.
- Partition metadata is preferred over route metadata and must match the
  request args and supplied partition key before a `SingleShardTransaction`
  begins.
- The active execution session stores the resolved scope alongside metadata,
  schema, and transaction state.
- Added an execution-session regression test where
  `partition: model.teams.bySlug("teamSlug")` rejects `partitionKey: "wrong"`
  before any syscalls run.

Convex references:

- `crates/isolate/src/environment/udf/syscall.rs`
  - syscalls run after the backend creates the function execution context.
- `crates/function_runner/src/server.rs`
  - the function runner receives a backend-controlled transaction context.
- `crates/application/src/application_function_runner/mod.rs`
  - deployment metadata and function runner state are joined by the backend.

Cloudflare difference:

- Flarex's execution session must hold a concrete `PartitionDO` key because
  Durable Object routing is outside the isolate. Convex's function runner does
  not expose that shard selection problem to user code.

Remaining limitations:

- The generated Worker still sends a `partitionKey` transport field; the
  backend now validates it, but the client transport has not been simplified.
- The scope is runtime metadata only. It does not yet narrow generated handler
  `ctx.db` types.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Last Update

Added the backend invoke boundary on top of `SingleShardTransaction`.
`executeInvoke` executes registered query or mutation handlers against a safe
`ctx.db` wrapper, commits mutations through `PartitionDO`, returns read sets for
queries, and maps partition commit errors back to HTTP responses. It now loads
schema from `DeploymentDO`, syncs the target partition cache before begin,
resolves table names for inserts, and returns developer-facing documents with
`_id` from `ctx.db.get`. The Worker has `/deployments/:deploymentId/invoke` and
top-level `/invoke` routes.

Convex inspiration:

- `crates/isolate/src/environment/udf/syscall.rs`
- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`
- `crates/application/src/api.rs`

Cloudflare difference: Convex's syscall machinery is inside its V8/Rust
function runner and is reached through `ApplicationApi`. Flarex starts with a
TypeScript invoke executor that calls a tenant-scoped `PartitionDO`; the Dynamic
Worker bridge still needs to provide the actual deployed function registry.

Verified with:

```sh
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend test
corepack pnpm --filter @flarex/backend build
```

## Execution Session Update

Added the first backend syscall session bridge. The generated Worker now:

1. Validates local function args with generated metadata.
2. Calls backend `/executions/start` with deployment, partition, path, kind,
   args, and idempotency key.
3. Builds `ctx.db` as a scoped syscall client.
4. Sends each `ctx.db.get/query/insert/patch/delete` to backend `/syscall`.
5. Validates the return locally for fast failure.
6. Calls backend `/finish`; backend validates the return again and commits
   mutations through `PartitionDO`.
7. Calls `/abort` if user code or local validation fails.

Convex inspiration:

- `crates/isolate/src/environment/udf/syscall.rs`
- `crates/function_runner/src/lib.rs`
- `crates/udf/src/validation.rs`
- `crates/application/src/application_function_runner/mod.rs`

Cloudflare difference: Convex keeps the function runner and transaction
machinery inside Rust/V8 process boundaries. Flarex uses a Worker service
binding and a per-session Durable Object to preserve the same separation while
letting user code run in Cloudflare's runtime.

Verified with:

```sh
corepack pnpm typecheck
corepack pnpm test
```

## Generated Worker E2E Update

Added an end-to-end generated Worker test in the example app. The test runs:

```txt
generated app Worker /invoke
  -> FLAREX_BACKEND service binding
  -> backend /executions/start
  -> backend /executions/:sessionId/syscall
  -> backend /executions/:sessionId/finish
  -> PartitionDO commit
```

The test deploys schema and generated function metadata to the backend harness,
invokes `lessons:complete`, then invokes `lessons:list` through the generated
Worker and verifies the write is read back through the backend index path.

Fixed the query syscall result contract while adding this test. Query syscalls
now return the SDK runtime envelope:

```ts
{ page, isDone, continueCursor }
```

instead of a raw document array. This matches `createQueryInitializer`, whose
`collect`, `paginate`, `first`, and `unique` helpers expect a paginated result
shape.

Convex inspiration remains the syscall boundary in:

- `crates/isolate/src/environment/udf/syscall.rs`
- `crates/function_runner/src/lib.rs`

Cloudflare difference: this test uses a Miniflare service binding function to
connect the generated Worker harness to the backend harness. Production should
use the real Worker service binding configured in generated Wrangler output.

Verified with:

```sh
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
```

## Implementation Checkpoints

### Architecture Terminology Cleanup

Previous completed checkpoint: `da42b4a` Add analysis import phase prelude.

Updated the Dynamic Worker roadmap to say Flarex loads the uploaded `flarex/`
source package through a Flarex-managed execution artifact. The developer does
not write Worker code, and Flarex does not bundle the developer's whole app.

Convex reference: Convex executes uploaded backend function modules behind its
own function runner boundary, while clients and application hosting remain
separate.

Verification:

```sh
git diff --check
```

### `a973c3a` Add backend execution sessions

Added backend-owned execution sessions and syscall routing so generated user
code can access scoped `ctx.db` operations without receiving database
connections or storage bindings.

### `36b021e` Test generated Worker backend invoke path

Added an end-to-end test proving that generated execution code invokes the
backend session and syscall path.

## Immutable Execution Artifact Input Update

Flarex development tooling now produces a self-contained internal execution
entrypoint inside a deterministic source package. Local analysis executes that
entrypoint directly.

This is not a deployed Dynamic Worker yet. It establishes the immutable input
that future local Miniflare and hosted Dynamic Worker adapters must consume,
without giving either adapter access to the developer filesystem.

## Local Execution Artifact Analysis Update

Previous completed checkpoint: `7abaa43` Use backend push lifecycle in local
dev.

Added `LocalMiniflareExecutionArtifactAdapter` as the first concrete
execution-artifact boundary. It takes the immutable `SourcePackage`, creates a
temporary Miniflare module graph, imports the bundled execution and schema
entrypoints inside that Worker-shaped isolate, and returns
`DeploymentAnalysis`.

This moves local analysis away from direct Node dynamic import for the normal
generation and dev paths. The developer still writes ordinary Flarex
TypeScript modules; the Worker entrypoint is generated internally by Flarex.

Convex inspiration:

- `crates/isolate/src/environment/analyze.rs`
  - authoritative metadata comes from evaluating runtime module exports.
- `crates/application/src/deploy_config.rs`
  - analysis is a deployment step that precedes activation.

Cloudflare difference: this is a local Miniflare execution artifact, not the
hosted Flarex Dynamic Worker runtime. Hosted source-package loading,
import-phase restrictions, and backend-owned analysis remain future work.

Verified with:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Active Deployment Session Start Update

Previous completed checkpoint: `b08269e` Record active deployment pointer on
finish.

Backend execution sessions now start from active deployment metadata.
`ExecutionDO.start` calls `loadActiveFunctionMetadata`, receives the active
deployment schema and function metadata from `DeploymentDO`, validates
arguments from that active analysis, syncs the partition schema cache, and only
then begins the shard transaction.

This keeps the generated Worker syscall path aligned with the hosted Dynamic
Worker target:

```txt
generated execution artifact /invoke
  -> backend /executions/start
  -> active deployment analysis lookup
  -> active schema and function validators
  -> backend-owned transaction session
```

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - query and mutation execution receives validated path/argument metadata
    before isolate execution.
- `crates/application/src/lib.rs`
  - functions are executed through the application runner after module
    metadata has been analyzed and stored.

Cloudflare difference: Flarex's execution session is still a Durable Object
memory session backed by syscalls. Convex keeps the transaction and function
runner inside its backend runtime. The important matching behavior is that
user code does not choose its own schema or validator metadata at invocation
time.

Tests now activate execution-session metadata through the push lifecycle and
prove a stale mutable `/functions` table entry cannot start a session when it
is not part of active analysis.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Runtime `ctx.db.replace` Syscall

Previous completed checkpoint: `0e3b118` Add invoke replace syscall.

What changed:

- The generated Worker runtime and local execution artifact materializer now
  expose `ctx.db.replace(id, value)`.
- Materialized mutation artifacts emit backend syscalls shaped as
  `{ op: "replace", id, value }`.
- The full stored-source-package runtime test now performs
  `insert -> patch -> replace` in user code and verifies the committed final
  document.
- The legacy `ExecutionDO` syscall route now accepts `replace` so the retained
  DO prototype does not break while Postgres remains the forward path.

Convex references:

- `npm-packages/convex/src/server/impl/database_impl.ts`
  - Convex's user-code writer forwards `replace` to the backend syscall layer.
- `crates/isolate/src/environment/udf/syscall.rs`
  - storage operations remain behind a controlled syscall boundary.

Flarex differences:

- Convex executes this syscall inside its backend isolate/runtime stack.
  Flarex emits it from Cloudflare-hosted user code to either the legacy
  `ExecutionDO` route or the trusted Postgres executor route.
- The DO route is compatibility scaffolding. The Postgres executor remains the
  target authoritative path.

Known limitations:

- The generated runtime still has no table-scoped writer object.
- Per-session syscall capability tokens remain future hardening.

Verification:

```sh
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

## Maintenance Policy Boundary

Previous completed checkpoint: `5358924` Add invoke session maintenance route.

What changed:

- Added the executor maintenance API for invoke sessions.
- Added `POST /maintenance/invoke-sessions` as the route a scheduler should
  call instead of manually calculating `olderThan`.
- Added optional `maxSessions` and `hasMore` so the scheduler can process stale
  sessions in bounded batches.
- Kept the operation outside generated user code and outside Dynamic Worker
  execution modules.

Why it matters:

The Dynamic Worker should run user functions and call executor syscalls. It
should not own platform maintenance policy. The trusted executor now has the
small policy wrapper needed for a future Vercel/Nitro cron job:

```txt
scheduled job
  -> /maintenance/invoke-sessions { staleAfterMs, maxSessions }
  -> executor computes olderThan
  -> abort oldest stale active session batch
  -> repeat while hasMore
```

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - backend-side orchestration owns execution lifecycle decisions.
- `crates/database/src/transaction.rs`
  - abandoned transaction work remains unpublished.

Flarex differences:

- Flarex exposes an explicit maintenance route because the executor is
  framework-neutral and can be hosted behind Nitro/Vercel.
- This is a hosted-platform operation, not a Convex-style user function.
- The batch loop belongs to platform scheduling, not user code or generated
  Dynamic Worker modules.

Known limitations:

- Cron wiring is still pending.
- Per-deployment TTL configuration is still pending.
- Batched stale abort is implemented; batched retention deletion of old aborted
  session rows is still pending.

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

## Maintenance Deployment Discovery

Previous completed checkpoint: `69b1d73` Batch invoke session maintenance.

What changed:

- Added platform-wide deployment listing to the trusted executor core.
- Listing is cursor based and stable across deployments with equal timestamps.
- No generated user code or Dynamic Worker module changed.

Why it matters:

A future scheduled job needs two loops:

```txt
list deployment batch
  -> for each deployment, run invoke-session maintenance batch
  -> repeat by deployment cursor
```

The Dynamic Worker should not discover deployments or own platform maintenance.
That belongs to the trusted executor side.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - backend orchestration owns runtime lifecycle decisions.

Flarex differences:

- Flarex needs explicit deployment discovery because the scheduler will live in
  the Nitro/Vercel executor side, not inside Cloudflare user-code execution.
- This is executor-core only; no HTTP route or cron binding is added yet.

Known limitations:

- Cron wiring is still pending.
- No project-level filter exists yet.
- Per-deployment TTL policy is still pending.

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

## Maintenance Sweep Core Loop

Previous completed checkpoint: `a0ac1fe` List deployments for maintenance.

What changed:

- Added the trusted executor core sweep that combines deployment discovery with
  per-deployment invoke-session maintenance.
- The sweep returns both deployment pagination state and per-deployment
  `hasMoreSessions` state.
- No generated user code, Dynamic Worker module, HTTP route, or cron binding
  changed.

Why it matters:

The future scheduler shape is now a single core call:

```txt
runMaintenanceSweep
  -> list one deployment page
  -> abort one stale session batch per deployment
  -> return deployment cursor and hot deployment flags
```

This keeps platform maintenance outside Cloudflare user execution and makes the
Nitro/Vercel cron adapter a thin host integration.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - backend orchestration owns runtime lifecycle decisions.

Flarex differences:

- Flarex needs this explicit core loop because the trusted executor may run as
  a Nitro/Vercel service while user code runs elsewhere.
- Convex keeps equivalent lifecycle behavior internal to the backend service.

Known limitations:

- Cron wiring is still pending.
- Hot deployments are reported but not looped until drained in one call.
- Per-deployment TTL policy is still pending.

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

## Runtime Failure Cleanup Boundary

Previous completed checkpoint: `a08eddd` Verify artifact abort after staged
writes.

What changed:

- Recorded and implemented the executor-side stale invoke-session cleanup path.
- `POST /invoke/abort-stale` is now available through the shared HTTP adapter
  and therefore through the Nitro adapter.
- The operation is intentionally not part of generated user modules. It is a
  trusted backend/scheduler operation that marks old active sessions aborted.

Why it matters for Dynamic Worker execution:

The Flarex runtime split is:

```txt
Cloudflare Dynamic Worker user code
  -> executor invoke session
  -> syscalls staged in Postgres
  -> finish commits, abort abandons
```

Generated runtime abort is necessary but not sufficient. A Dynamic Worker can
fail before it sends `/invoke/abort`. The backend must be able to recover those
sessions later so staged writes remain non-published and active-session tables
do not grow forever.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - the backend owns execution coordination.
- `crates/database/src/transaction.rs`
  - uncommitted transaction state is not visible as committed database state.

Flarex differences:

- Convex does not need an HTTP stale-abort route between a Dynamic Worker and
  transaction executor. Flarex does because runtime execution and trusted
  transaction ownership are separate deployable units.
- This is cleanup, not retry. It never commits user writes.

Known limitations:

- No actual scheduled sweeper is configured yet.
- No deployment-level TTL configuration yet.
- No cleanup of abandoned read/write rows yet.

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

## Active Deployment Required For Invoke

Previous completed checkpoint: `63637f9` Harden create-root sync docs and
tests.

Backend invoke no longer falls back to directly replaced schema/function
metadata when no active deployment exists. The execution boundary now starts
from active push analysis:

```txt
/invoke or /deployments/:id/invoke
  -> load active deployment
  -> validate active function metadata
  -> artifact runtime or backend execution session
```

This aligns the dynamic-worker plan with the source-package bundle model: user
code is not a Worker app and runtime metadata comes from the pushed `flarex/`
package analysis.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - execution resolves deployment/package metadata before invoking user code.
- `crates/model/src/source_packages/mod.rs`
  - code identity is durable source-package metadata.

Cloudflare difference: Flarex may still run direct in-memory handlers in unit
tests, but those handlers now require an active deployment schema created by
push activation. The public runtime path no longer has direct schema/functions
metadata replacement routes.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/invoke.test.ts test/executionDO.test.ts --maxWorkers=1
```

## Generated Create-Root Artifact Execution

Previous completed checkpoint: `10c02a4` Run create-root execution sessions.

The generated and materialized execution workers now start backend execution
sessions with optional partition keys. This lets create-root functions execute
through the same syscall path as existing-root functions:

```txt
generated/artifact worker invoke
  -> start execution session without partitionKey
  -> backend active metadata says partitionCreateRoot
  -> ExecutionDO preallocates root id
  -> ctx.db.insert(rootTable, value) syscall returns that id
  -> finish commits staged writes
```

The integration test now materializes a stored source package containing:

```ts
export const create = mutation({
  partition: model.users,
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await ctx.db.insert("users", { name: args.name });
    const profileId = await ctx.db.insert("profiles", { userId, bio: "Hello" });
    return { userId, profileId };
  },
});
```

Convex references:

- `crates/function_runner/src/lib.rs`
  - user function execution is mediated by the backend runner.
- `crates/isolate/src/environment/udf/syscall.rs`
  - storage access crosses the syscall boundary.
- `crates/database/src/transaction.rs`
  - generated ids are transaction-local state until commit.

Cloudflare difference: Flarex's materialized source-package runtime runs in
Miniflare/Dynamic Worker style and calls the backend over internal fetch. It
does not own transaction state; `ExecutionDO` and `PartitionDO` do.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/executionDO.test.ts --maxWorkers=1
```

## Create-Root Execution Sessions

Previous completed checkpoint: `2e6dc68` Consume preallocated root ids.

Execution sessions can now run create-root mutations through backend-owned
syscalls. `ExecutionDO.start` accepts active function metadata with
`partitionCreateRoot`, preallocates the root document id during partition
resolution, begins `SingleShardTransaction` with the create-root context, and
keeps that context in the session transaction.

Runtime shape:

```txt
/deployments/:deploymentId/executions/start
  -> active function metadata
  -> partitionCreateRoot preallocates root id
  -> ExecutionDO owns SingleShardTransaction(partitionKey = root id)
  -> generated worker calls /syscall insert(root table)
  -> transaction returns the preallocated id
  -> /finish validates return and commits
```

The generated user-code worker still does not receive a raw database
connection. It only talks to the backend session through syscalls, which keeps
commit authority inside the backend `PartitionDO` path.

Convex references:

- `crates/function_runner/src/lib.rs`
  - function execution gets a backend-controlled context instead of direct
    database access.
- `crates/isolate/src/environment/udf/syscall.rs`
  - isolate code reaches storage through syscalls.
- `crates/database/src/transaction.rs`
  - generated ids and staged writes are transaction state.
- `crates/database/src/committer.rs`
  - invalid mutation state is rejected before/during commit.

Cloudflare difference: Flarex must choose a `PartitionDO` before user code
runs. For create-root functions, the backend preallocates the `_id` partition
key first, then `ctx.db.insert(rootTable, value)` consumes that same id through
the syscall path. Convex does not expose this routing concern because its
runtime presents one logical transactional database.

Remaining limitations:

- Final generated code still rejects create-root declarations, so this is a
  backend capability but not yet a supported app-authoring flow.
- Public `/invoke` request construction still expects caller-supplied partition
  keys; hosted artifact execution should move create-root app calls through
  execution sessions instead.
- Cross-shard mutation semantics are unchanged; this only hardens single-shard
  root creation.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- --runInBand
```

## Runtime Materializer Cache Update

Previous completed checkpoint: `f88296c` Authorize artifact runtime calls.

The artifact runtime service now has a reusable materialization/cache boundary:

- `ExecutionArtifactMaterializer`
- `MaterializedExecutionArtifact`
- `CachedExecutionArtifactMaterializer`
- `createExecutionArtifactRuntimeService()`

The runtime service:

- authorizes `/invoke` with the internal capability token when configured,
- validates `x-flarex-artifact-id` and `x-flarex-source-package-hash` against
  the invoke payload,
- materializes an artifact on first use,
- reuses the cached artifact for later invokes with the same `artifactId` and
  full source package hash,
- rematerializes if an artifact ID is reused with a different hash.

This is still not the real Cloudflare Dynamic Worker loader. It is the runtime
service contract the loader should implement.

Convex references inspected:

- `crates/application/src/module_cache/mod.rs`
  - module cache keys include module path and sha256.
- `crates/application/src/application_function_runner/mod.rs`
  - execution resolves source package storage metadata before executor invoke.
- `crates/node_executor/src/executor.rs`
  - executor responses track download and import timing, reflecting the
    package materialization/import boundary.

Cloudflare difference: Flarex caches a materialized artifact object by
`artifactId` plus full source package hash. Convex caches module source by
module path and sha256 and delegates Node package loading/import to its
executor path.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Local Source Package Materializer Update

Previous completed checkpoint: `0447832` Add artifact runtime materializer cache.

Added the first concrete execution artifact materializer for development:
`LocalMiniflareExecutionArtifactMaterializer`.

It consumes the stored `flarex/` source package, builds a Worker-shaped module
graph in Miniflare, generates a small internal runtime wrapper, imports the
package's `_flarex/execution.js` entrypoint, resolves `module:export`
functions, and runs query/mutation handlers with only a syscall-backed
`ctx.db`.

The materialized runtime calls:

```txt
developer function
  -> ctx.db syscall client
  -> backend /executions/:sessionId/syscall
  -> backend /executions/:sessionId/finish
  -> PartitionDO commit for mutations
```

The developer still uploads only the `flarex/` source package. This is not a
developer Worker and not a whole-app bundle.

Convex references inspected:

- `crates/application/src/module_cache/mod.rs`
  - module cache identity includes module path and sha256.
- `crates/application/src/application_function_runner/mod.rs`
  - execution resolves source package identity before invoking an executor.
- `crates/node_executor/src/executor.rs`
  - executor requests carry source package identity/hash and report import
    timing.

Cloudflare difference: Convex materializes modules inside its Rust/V8 or Node
executor path. Flarex currently materializes the source package in a local
Miniflare isolate; the hosted replacement should be the Flarex-managed Dynamic
Worker loader with the same `ExecutionArtifactMaterializer` contract.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- artifactRuntimeRoute.test.ts
```

## Dev Invoke Uses Materialized Source Package Update

Previous completed checkpoint: `c8c16bb` Materialize stored source packages
locally.

Local dev now exercises the backend artifact runtime path for normal invoke.
`/__flarex_dev/invoke` no longer reads an in-memory local artifact store and no
longer calls the generated app Worker as the execution artifact. It forwards to
backend `/deployments/:deploymentId/invoke`, which loads the active source
package from R2 and invokes the materialized artifact runtime.

This keeps the execution boundary aligned with the target architecture:

```txt
active deployment
  -> stored source package
  -> materialized execution artifact
  -> restricted ctx.db syscalls
  -> backend-owned transaction session
```

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - function execution is rooted in active deployment metadata and package
    identity.

Cloudflare difference: the local materializer is Miniflare. Hosted Flarex
still needs the real Cloudflare Dynamic Worker loader, but the call contract is
now the same in local dev.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- dev.test.ts
```

## Runtime Store Loading Update

Previous completed checkpoint: `ef50030` Use artifact runtime for local dev
invoke.

The execution artifact runtime no longer has to receive raw source package JSON
from backend invoke. In runtime-store mode, the backend sends only:

```txt
deploymentId
executionArtifactRef
invoke request
```

The runtime service loads the source package from its own artifact store before
materializing. Materializers still receive a fully resolved source package, so
the sandbox/runtime implementation stays simple while the transport contract
moves closer to the hosted Dynamic Worker target.

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - function execution carries source-package identity to the executor
    boundary.
- `crates/model/src/source_packages/mod.rs`
  - source-package bytes are loaded through backend-owned storage metadata.

Cloudflare difference: local dev uses Miniflare R2 and a service binding as
the runtime store. Hosted Flarex should make the Dynamic Worker runtime load
the artifact from the platform-owned store.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- artifactRuntime.test.ts
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts dev.test.ts
```

## Materialized Artifact Disposal Update

Previous completed checkpoint: `e1ccf14` Let artifact runtime load source
packages.

The artifact runtime cache now owns the lifecycle of materialized execution
artifacts:

- replacing an artifact with the same `artifactId` but a different
  `sourcePackageHash` disposes the old artifact,
- `delete(artifactId)` removes and disposes one artifact,
- `clear()` disposes all cached artifacts,
- `createExecutionArtifactRuntimeService()` exposes `dispose()` and
  `cacheSize()` for local-dev/test cleanup.

This matters for the Dynamic Worker target because materialized artifacts may
own nested Worker isolates, module caches, timers, or future runtime resources.
Dropping references without disposal is not an acceptable long-running runtime
contract.

Convex reference:

- `crates/application/src/module_cache/mod.rs`
  - cached module state has explicit runtime ownership and identity.
- `crates/node_executor/src/executor.rs`
  - executor/module loading is a long-lived runtime boundary that must be
    managed separately from request execution.

Cloudflare difference: local dev currently disposes nested Miniflare
materializations. Hosted Flarex should map the same lifecycle contract to
Dynamic Worker eviction or artifact runtime teardown.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- artifactRuntime.test.ts
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- dev.test.ts runtimeMaterializer.test.ts
```

## Runtime Capability Authorization Update

Previous completed checkpoint: `c623476` Route invoke through artifact
runtime.

Generated execution artifacts now support optional internal-route
authorization:

- `FLAREX_INTERNAL_TOKEN` on the generated artifact side.
- `FLAREX_ARTIFACT_RUNTIME_TOKEN` on the backend side.
- backend artifact runtime calls include `Authorization: Bearer <token>`.
- generated `/__flarex_internal/invoke` and `/__flarex_internal/metadata`
  reject unauthorized calls when a token is configured.

This protects the future managed Dynamic Worker internal routes from becoming
public application API surfaces. Public `/invoke` remains separate; internal
routes become guarded once the managed runtime is configured with a token.

Still not implemented:

- real Dynamic Worker materialization/cache,
- token rotation,
- per-session syscall capability tokens,
- runtime-side validation that artifact headers match the loaded artifact.

Convex reference:

- `crates/node_executor/src/executor.rs`
  - executor requests carry backend callback/auth material alongside source
    package identity.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Backend Artifact Runtime Invoke Update

Previous completed checkpoint: `804a055` Add backend artifact storage binding.

The backend now has the first invoke-side hosted artifact runtime boundary.
When both `ARTIFACTS` and `FLAREX_ARTIFACT_RUNTIME` are configured, public
backend invoke loads the active source package from R2 and forwards an
`ExecutionArtifactInvokePayload` to the runtime service binding.

This is the first backend-hosted equivalent of the local dev flow:

```txt
active deployment
  -> executionArtifactRef
  -> artifact store get(ref)
  -> execution artifact runtime invoke
  -> generated internal invoke route
  -> execution session syscalls
```

Still not implemented:

- actual Cloudflare Dynamic Worker upload/loading,
- runtime-side materialization from R2 without the backend passing source JSON,
- capability-token authorization for internal runtime calls,
- runtime cache/eviction keyed by `artifactId`,
- hosted source-map/runtime diagnostics.

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - executor requests are built after resolving source package storage identity
    and package hashes from backend state.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Backend Artifact Storage Binding Update

Previous completed checkpoint: `873fee7` Add R2 execution artifact store
adapter.

The hosted backend now has an optional R2-backed artifact store binding:
`Env.ARTIFACTS`. Public push start stores successfully analyzed source packages
through `R2BackendExecutionArtifactStore`, and public push finish verifies the
stored manifest/source package before activation.

This moves the hosted path from "active deployment has an artifact pointer" to
"active deployment can only be publicly finished after the artifact pointer is
backed by durable storage" when R2 is configured.

Still not implemented:

- hosted Dynamic Worker artifact materialization,
- internal Dynamic Worker `/__flarex_internal/invoke` loading from R2,
- runtime authorization between backend and the managed execution artifact,
- GC for old `artifacts/{artifactId}` objects.

Convex reference:

- `crates/application/src/deploy_config.rs`
  - `finish_push` validates and downloads package storage before committing the
    deployment.
- `crates/application/src/application_function_runner/mod.rs`
  - executor requests carry package storage identity/hash when code runs
    outside the main backend process.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Local Execution Artifact Runtime Boundary Update

Previous completed checkpoint: `d5e13dd` Store active execution artifact
reference.

`flarex-dev` now has the first invoke-side execution artifact runtime
boundary:

```ts
interface ExecutionArtifactRuntime {
  invoke(ref: ExecutionArtifactRef, request: ExecutionArtifactInvokeRequest): Promise<unknown>;
}
```

`LocalMiniflareExecutionArtifactRuntime` calls:

```txt
POST /__flarex_internal/invoke
```

on the generated execution artifact and sends artifact identity headers:

```txt
x-flarex-artifact-id
x-flarex-source-package-hash
```

The generated Worker now serves `/__flarex_internal/invoke` with the same
backend execution-session/syscall behavior as `/invoke`. Local dev resolves
the active deployment through the backend, reads `executionArtifactRef`, and
invokes through the runtime adapter.

This creates the contract needed for the hosted path:

```txt
active deployment
  -> executionArtifactRef
  -> ExecutionArtifactRuntime.invoke
  -> internal execution artifact invoke
  -> backend execution sessions/syscalls
```

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - executor requests carry source package identity/hash information when code
    is loaded outside the main runtime.
- `crates/model/src/source_packages/mod.rs`
  - source packages are durable metadata looked up by ID before execution.

Cloudflare difference: this checkpoint is still local Miniflare execution
artifact plumbing. The hosted Dynamic Worker runtime adapter, artifact upload,
and runtime authorization are not implemented yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Execution Artifact Store Boundary Update

Previous completed checkpoint: `363d7e0` Add local execution artifact runtime
invoke.

Added the first source-package store boundary for execution artifacts.

New shared runtime-neutral helpers live in `flarex/artifacts`:

```ts
executionArtifactRefForSourcePackage(sourcePackage)
stableSourcePackageManifest(sourcePackage)
validateExecutionArtifactRef(value)
```

`flarex-dev` now exposes:

```ts
interface ExecutionArtifactStore {
  put(sourcePackage): Promise<ExecutionArtifactRef>;
  get(ref): Promise<SourcePackage>;
}
```

with `LocalInMemoryExecutionArtifactStore` as the local implementation. Local
dev stores the bundled source package before finishing a push, then validates
that the active `executionArtifactRef` can retrieve an artifact before invoking
through `LocalMiniflareExecutionArtifactRuntime`.

Convex references inspected:

- `crates/model/src/source_packages/mod.rs`
  - `SourcePackageModel::put` and `get` are the durable source package store
    boundary.
- `crates/model/src/modules/types.rs`
  - module metadata links active analyzed modules to source package identity
    and module `sha256`.
- `crates/application/src/application_function_runner/mod.rs`
  - execution can retrieve source package metadata before calling an executor.

Cloudflare difference: this checkpoint stores packages in local memory only.
The hosted Dynamic Worker runtime still needs an R2/KV-backed store and a
loader that materializes an internal execution artifact from the stored source
package.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Hosted Artifact Store Contract Update

Previous completed checkpoint: `bccc7cd` Add execution artifact store
boundary.

Added the first Cloudflare-oriented artifact store contract without wiring it
to production runtime yet.

`flarex-dev` now exposes:

```ts
interface DurableExecutionArtifactStore {
  put(ref, sourcePackage): Promise<void>;
  get(ref): Promise<SourcePackage>;
  delete(ref): Promise<void>;
}
```

and `R2ExecutionArtifactStore`, which stores:

```txt
artifacts/{artifactId}/manifest.json
artifacts/{artifactId}/source-package.json
```

`get(ref)` loads the manifest and source package, validates that the manifest
matches the requested ref, then recomputes the source package ref before
returning the package.

Convex references inspected:

- `crates/model/src/source_packages/mod.rs`
  - `SourcePackageModel::put` and `get` define the durable package store
    boundary.
- `crates/model/src/source_packages/types.rs`
  - source package metadata carries `storage_key` and `sha256`.
- `crates/application/src/application_function_runner/mod.rs`
  - execution resolves source package storage metadata before invoking an
    executor.

Cloudflare difference: this is an R2-shaped adapter tested with a fake bucket.
It is not yet bound to a Worker environment and does not yet create/load the
hosted Dynamic Worker artifact.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Active Execution Artifact Pointer Update

Previous completed checkpoint: `4a6e66f` Resolve execution sessions from active
deployment.

The active deployment record now exposes `executionArtifactRef`, a deterministic
pointer for the Flarex-managed Dynamic Worker runtime to load later.

Current flow:

```txt
finish_push
  -> compute source package manifest hash
  -> store active_execution_artifact_ref
  -> /deployment returns executionArtifactRef
```

Target hosted invoke flow:

```txt
active deployment
  -> executionArtifactRef
  -> Flarex-managed Dynamic Worker runtime
  -> internal execution artifact invoke
  -> backend execution session syscalls
```

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - executor requests can carry source package identity and package hashes
    when code is loaded outside the main Rust runtime.
- `crates/model/src/source_packages/mod.rs`
  - source package metadata is durable and retrieved by ID.

Cloudflare difference: this is still only a pointer. The hosted Dynamic Worker
adapter, artifact upload/storage, and internal `/__flarex_internal/invoke`
loader are not implemented yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```
