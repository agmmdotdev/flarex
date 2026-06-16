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
