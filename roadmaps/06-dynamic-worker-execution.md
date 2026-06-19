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
