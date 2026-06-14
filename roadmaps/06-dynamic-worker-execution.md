# Dynamic Worker Execution

## Current Decision

User code should run in Dynamic Workers and receive only restricted syscall
APIs. User code must not receive raw Durable Object stubs, SQLite handles, or
environment bindings.

## Intended Flow

```txt
Worker router
  -> resolve deployment and partition
  -> begin transaction in PartitionDO
  -> run user function in Dynamic Worker
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

## Convex References

- `crates/isolate/src/environment/udf/syscall.rs`
  Inspiration for syscall boundary.
- `crates/function_runner/src/lib.rs`
  `FunctionFinalTransaction`, `FunctionReads`, and `FunctionWrites`.
- `crates/function_runner/src/server.rs`
  Function runner interface.
- `crates/application/src/application_function_runner/mod.rs`
  Application-level function execution and transaction merge.

## Cloudflare Difference

Convex isolates user code with its own Rust/V8 infrastructure. Flarex should
use Cloudflare runtime isolation, but must still enforce the same architectural
boundary: user code sees `ctx.db`, not storage.

## Known Limitations

- No Dynamic Worker execution path is implemented yet.
- Current generated example Worker directly invokes handlers and is only a
  prototype.
- The backend invoke executor exists, but there is no network/service protocol
  between a Dynamic Worker and backend yet.
- The production Worker route has no deployed function registry yet, so it
  reports unknown functions until the Dynamic Worker bridge is connected.
- There is no executor retry loop around `OCC_CONFLICT` yet.
- Index reads through the wrapper do not yet overlay staged writes.
- Backend invoke resolves table names for inserts, but document IDs still use
  numeric table ID prefixes for now.
- There is no generated type-level bridge from schema table names to invoke
  `ctx.db` yet.
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
