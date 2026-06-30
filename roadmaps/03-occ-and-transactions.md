# OCC And Transactions

## PartitionDO Route Dispatch Effect Boundary

Previous completed checkpoint: `d198dd0` Type scheduler maintenance route
boundary.

What changed:

- PartitionDO now routes its Durable Object entrypoint through
  `Effect.fn("PartitionDO.route")`.
- Health, schema-cache, begin, commit, subscription register, subscription
  unregister, connection unregister, document read, index read, and not-found
  responses share one route dispatcher and one partition route adapter runner.
- Schema-cache, commit, and subscription body branches continue to use the
  existing typed request decoders and preserved `HttpError` mapping.

What did not change:

- PartitionDO SQL table layout, OCC validation, idempotency replay,
  document/index history, current document/index state, owner-field validation,
  subscription invalidation scanning, and transaction response shapes are
  unchanged.
- This checkpoint is not the service-extraction step for PartitionDO
  transaction logic.
- Public Worker partition routing, scheduler/sync/execution routes,
  executor-http, protocol schemas, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/transaction.test.ts -t "rejects malformed partition schema-cache JSON at the route boundary|rejects non-object partition schema-cache JSON at the route boundary|rejects malformed partition subscription registration JSON at the route boundary|rejects invalid partition subscription unregister-connection envelopes at the route boundary|rejects invalid partition subscription unregister targets at the route boundary|rejects malformed partition commit JSON at the route boundary|commits through the public partition route boundary|generates ids, exposes read-your-writes, and coalesces document writes|surfaces OCC conflicts from the partition commit path|rejects colocated writes at the partition commit boundary|rejects partitionBy field writes at the partition commit boundary|enforces partitionBy field owner uniqueness at the partition commit boundary" --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionFlow.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Public Worker Partition Route Effect Boundary

Previous completed checkpoint: `b351f13` Type public execution route
boundary.

What changed:

- Public Worker partition routing now runs through
  `Effect.fn("Worker.routePartition")` with a single `Effect.runPromise(...)`
  adapter edge.
- Begin, commit, schema-cache, document-read, and index-read branches reuse
  the existing typed forwarding helpers instead of running branch-local
  runtime boundaries.
- Commit and schema-cache body failures remain typed `PartitionRouteError`
  values until the Worker adapter maps them to the preserved HTTP response.
- Public dispatch-source coverage now includes partition commit and
  schema-cache forwarding failures alongside begin/document/index.

What did not change:

- PartitionDO SQL/OCC behavior, idempotency replay, document/index storage,
  subscription invalidation, schema-cache semantics, and transaction response
  shapes are unchanged.
- Public partition-key parsing still happens at the existing public path
  boundary before the partition router is called.
- Public deployment push, invoke, execution, scheduler, sync, delivery,
  executor-http, generated HttpApi routes, protocol schemas, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts packages/flarex-backend/test/transaction.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Partition Response Effect Boundary

Previous completed checkpoint: `e726ae8` Type dev backend responses with
Effect.

What changed:

- `SingleShardTransaction` now reads PartitionDO responses through
  `decodePartitionJsonResponse(...)`, a named Effect decoder.
- Non-OK partition responses become typed `PartitionResponseError` values
  before the transaction adapter maps them to the existing
  `PartitionRequestError` shape.
- Added direct typed success/failure coverage for partition response decoding.

What did not change:

- OCC conflict semantics, schema-version checks, write staging, id generation,
  SQL behavior, and PartitionDO route handling remain unchanged.
- Successful partition payloads are still trusted by the existing transaction
  call sites.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntime.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/push.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## PartitionDO Adapter-Only Effect Checkpoint

Previous completed checkpoint: `e014550` Route execution fetch edges through
Effect.

What changed:

- `PartitionDO.fetch()` now routes schema-cache, commit, and subscription body
  reads through named Effect helpers backed by typed partition route decoders.
- The commit route keeps the existing status contract: `201` for new commits,
  `200` for idempotency replay, and fetch-level `409` for OCC conflicts.

What did not change:

- SQL table layout, write-log persistence, idempotency-key replay, read-set
  validation, document/index history writes, partition-owner enforcement, and
  subscription invalidation scanning remain inside `PartitionDO`.
- This is not the service-extraction step for `PartitionDO` transaction logic.
  OCC behavior still needs separate parity coverage before it moves behind a
  fuller Effect service boundary.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
git diff --check
```

## Real Postgres Retry Coordination

Previous completed checkpoint: `df4e8ad` Serialize Postgres commit timestamps.

What changed:

- Added optional real Postgres executor retry tests gated by
  `FLAREX_POSTGRES_DATABASE_URL`.
- The tests drive `@flarex/executor.runInvokeWithRetries(...)` through the real
  `@flarex/persistence-postgres/postgres` adapter:
  - first attempt reads a document and stages a patch,
  - a concurrent mutation commits before finish,
  - finish detects the OCC conflict,
  - the executor aborts the failed attempt,
  - the second attempt reruns against the fresh snapshot and commits.
- Added retry exhaustion coverage where every attempt conflicts and both
  attempts end as aborted sessions.
- Added an executor-local temporary Postgres harness with isolated schemas and
  best-effort cleanup.

Why it changed:

The previous checkpoint proved the lower persistence commit boundary on real
Postgres. User-facing mutation behavior, however, goes through the executor's
retry coordinator. This closes the next gap between durable OCC conflicts and
Convex-style automatic mutation retry behavior.

Convex references inspected:

- `crates/database/src/database.rs`
  - `execute_with_occ_retries` reruns retryable transactions.
- `crates/database/src/committer.rs`
  - stale reads are detected at commit validation.
- `crates/application/src/application_function_runner/mod.rs`
  - backend-owned execution coordinates user function attempts and commit.

Flarex differences:

- Convex retries inside its integrated Rust backend. Flarex retries by opening
  a fresh durable invoke session for each attempt while user code runs across
  the Cloudflare/trusted-executor boundary.
- Failed attempts are explicitly aborted through invoke-session metadata.
  Convex does not expose that as a separate HTTP-style session state.

Known limitations:

- The real Postgres retry tests are skipped unless
  `FLAREX_POSTGRES_DATABASE_URL` is set.
- This still exercises executor core directly. The Dynamic Worker HTTP/syscall
  bridge needs a later hosted integration test to prove the same behavior over
  the internal network boundary.
- Retried mutation bodies must be deterministic and side-effect free, matching
  Convex's mutation expectations. Side effects still belong in actions.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test:postgres -- --testTimeout=30000
```

## Real Postgres Commit Serialization

Previous completed checkpoint: `e7c3065` Add real Postgres indexed freshness
lane.

What changed:

- Changed Postgres commit timestamp allocation to lock the deployment's
  `leases` row with `for update` inside the short commit transaction.
- The allocator now advances from the maximum of:
  - the locked lease timestamp,
  - latest committed row,
  - latest document revision, and
  - the caller's `minimumTs`.
- Added optional real Postgres OCC concurrency tests gated by
  `FLAREX_POSTGRES_DATABASE_URL`:
  - concurrent commits against the same observed document produce exactly one
    committed write and one `InvokeSessionOccConflictError`;
  - concurrent non-conflicting commits both succeed with unique commit
    timestamps.
- Extracted shared real Postgres test harness code for temporary schemas,
  isolated migration metadata, migration, and cleanup.

Why it changed:

Convex's committer is single-threaded for commit validation and timestamp
assignment, and it checks pending writes before publishing. Flarex's Postgres
executor does not have that process-local committer, so the storage layer needs
a per-deployment row lock to serialize the critical timestamp/validation/write
section without holding a database transaction open during user code execution.

Convex references inspected:

- `crates/database/src/committer.rs`
  - `validate_commit`, `next_commit_ts`, and pending write append happen inside
    the committer's serialized path.
- `crates/database/src/write_log.rs`
  - `PendingWrites` catches conflicts with commits that started but have not
    finished publishing yet.
- `crates/database/src/reads.rs`
  - read sets detect stale document/index/table dependencies against writes
    after the transaction begin timestamp.

Flarex differences:

- Flarex serializes the final Postgres commit section with a deployment-scoped
  row lock in `leases`; Convex serializes in the backend committer and pending
  write log.
- Flarex still does not hold Postgres locks while Cloudflare Dynamic Worker
  user code runs. User code accumulates durable invoke-session reads/writes,
  then the trusted executor performs a short locked commit.
- Pending-write false conflicts are not modeled yet. The row lock makes
  commits wait for the current commit transaction instead of detecting a
  conflict against in-flight pending writes before persistence finishes.

Known limitations:

- The real Postgres tests are skipped unless `FLAREX_POSTGRES_DATABASE_URL` is
  set.
- Retry behavior is already covered in executor unit tests, but it is not yet
  proven end-to-end against real Postgres executor sessions.
- This is per-deployment serialization. Future high-throughput work may need a
  more granular allocator or explicit partition/shard commit lanes, but the
  current design favors correctness first.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/postgres.test.ts test/postgresConcurrency.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts --testTimeout=30000
```

## Postgres Authority Pivot

Previous completed checkpoint: `e80e176` Plan Postgres executor package
boundaries.

The forward OCC boundary is the trusted Postgres executor:

```txt
Cloudflare user-code runtime
  -> restricted ctx.db syscalls / read dependencies / write intent
  -> trusted executor near Postgres
  -> short Postgres transaction
  -> read-set and predicate revalidation
  -> document/index writes + commit row + outbox row
```

The existing `PartitionDO` OCC implementation remains prototype scaffolding and
a source of useful tests/semantics. Do not extend normal public mutations as
single-shard DO transactions unless maintaining the legacy path explicitly.

The important semantics to preserve from the DO prototype are:

- user code never gets a raw database connection,
- reads are recorded as document/table/index dependencies,
- writes are staged until return validation succeeds,
- commit validates dependencies against later writes,
- document history and index history are versioned,
- deterministic validation errors stay separate from retryable OCC conflicts.

Verification:

```sh
git diff --check
```

## Dynamic Worker Transport Retry

Current checkpoint: pending commit for materialized artifact retry.

What changed:

- Added bounded OCC retry semantics to the Dynamic Worker/materialized artifact
  invoke path.
- The artifact now reruns the user handler after a retryable Postgres mutation
  `/invoke/finish` conflict by starting a fresh invoke session and replaying
  the handler's normal `ctx.db.*` syscalls.
- Retry applies only to Postgres mutation transport. Queries and legacy
  transport still run once.
- The default retry budget matches the executor core default: 8 attempts.
  Runtime deployments can override this with `FLAREX_INVOKE_MAX_ATTEMPTS`.
- Exhausted retry budget raises `InvokeRetryExhaustedError` instead of
  surfacing the last raw OCC conflict directly.

Execution shape:

```txt
artifact invoke
  -> /invoke/start
  -> user handler uses ctx.db syscalls
  -> /invoke/finish
  -> retryable OCC conflict
  -> /invoke/abort best effort
  -> restart from /invoke/start
  -> after final attempt, throw InvokeRetryExhaustedError
```

Convex references:

- `crates/database/src/committer.rs`
  - commit validates read dependencies before writes become visible.
- `crates/database/src/transaction.rs`
  - transaction state accumulates reads and pending writes for one attempt.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user functions interact with storage through syscalls, not direct DB
    handles.

Flarex differences:

- Convex runs isolate syscalls and commit close to the Rust backend transaction
  machinery. Flarex runs user code in a Cloudflare-style artifact and retries
  by rerunning the handler across the artifact/executor HTTP boundary.
- Long-running user code still increases conflict probability. Retry improves
  the common short-conflict case but does not make arbitrary slow mutations
  conflict-free.

Verification:

```sh
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/execution-artifact-postgres.integration.test.ts
corepack pnpm --filter flarex-dev typecheck
```

## Full-Document Replace In Invoke OCC

Previous completed checkpoint: `f59e6e9` Rename invoke write staging API.

What changed:

- Added `replace` to the invoke session write set.
- `replace` requires the executor to observe the target document first, record
  that document read, and commit the full replacement only if OCC validation
  still sees the same document revision.
- The commit path validates the replacement document against the active
  package schema before inserting the new revision.
- The read-your-writes transaction view now overlays replacement values for
  direct document reads, table scans, and index scans.

Why this matters:

This keeps `replace` in the same transaction model as `patch` and `delete`:
user code can branch on the current document, stage a full replacement, keep
reading the transaction-local replacement, and have the backend reject or retry
if another writer changed that document before commit.

Convex references:

- `crates/database/src/transaction.rs`
  - pending writes and transaction-local reads.
- `crates/database/src/committer.rs`
  - final validation and commit semantics.
- `crates/isolate/src/environment/udf/syscall.rs`
  - storage calls cross a controlled syscall boundary.

Flarex differences:

- Convex can keep transaction state process-local. Flarex keeps invoke session
  state durable in Postgres because user code runs in a separate Cloudflare
  Dynamic Worker.
- The replacement does not open a long Postgres transaction while user code
  continues. OCC validation happens at commit.

Known limitations:

- Cross-partition replacement remains outside normal mutation semantics. This
  is still a single executor transaction-session model, not a multi-shard
  all-or-nothing protocol.
- Conflict retries only work for deterministic mutation bodies; side effects
  still belong outside mutations.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Invoke OCC Retry Coordinator

Previous completed checkpoint: `3c81156` Document interactive invoke
transactions.

What changed:

- Implemented a framework-neutral executor retry coordinator for full mutation
  attempts.
- A retry attempt creates a new invoke session and reruns the supplied attempt
  callback from the beginning.
- Commit-time document/table/index OCC errors are treated as retryable for
  mutations.
- Exhausting the retry budget now produces `InvokeRetryExhaustedError` instead
  of leaking an arbitrary internal OCC error.

Convex references:

- `crates/database/src/transaction.rs`
  - retryable work must be attempt-local and unpublished until commit.
- `crates/database/src/committer.rs`
  - OCC conflict is detected during commit validation.
- `crates/application/src/application_function_runner/mod.rs`
  - the backend owns the function execution boundary.

Flarex differences:

- Flarex retry is currently exposed as executor-core API
  `runInvokeWithRetries(...)`; the Dynamic Worker bridge still needs to use it
  for hosted user code.
- Aborted failed attempts remain as session metadata for now; retention cleanup
  is handled by the existing stale-session maintenance path.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test -- sessions.test.ts
git diff --check
```

## Invoke Read-Your-Writes Overlay

Previous completed checkpoint: `0273eb8` Add invoke OCC retry coordinator.

What changed:

- Implemented transaction-view reads for `db.get` and table query syscalls in
  the executor.
- Reads now combine the persisted snapshot at `beginTs` with the active
  invoke session's staged inserts, patches, and deletes.
- Added tests proving staged writes are visible before commit.

Convex references:

- `crates/database/src/transaction.rs`
  - pending writes participate in the transaction's read view.
- `crates/database/src/committer.rs`
  - pending writes are still unpublished until commit validation succeeds.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code sees transaction results through syscall responses.

Flarex differences:

- Flarex persists staged writes in invoke-session tables and rebuilds the
  transaction view per syscall. Convex keeps the transaction view in backend
  memory during function execution.

Known limitations:

- Indexed query overlay is still pending.
- Multiple writes to the same document are not coalesced yet.
- Large table queries need a storage-level overlay plan before this is
  production efficient.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Invoke Same-Document Write Coalescing

Previous completed checkpoint: `0d6431e` Add indexed read-your-writes overlay.

What changed:

- Added same-document staged write coalescing for invoke sessions.
- Executor patch/delete syscalls now validate against the transaction view, so
  `insert -> patch` and `insert -> delete` work before commit.
- Added tests for repeated patch, insert then patch, insert then delete, patch
  then delete, and invalid delete then patch.

Convex references:

- `crates/database/src/transaction.rs`
  - transaction state owns pending writes and presents their effective document
    view to later reads.
- `crates/database/src/committer.rs`
  - the committer validates and persists the final write set.
- `crates/isolate/src/environment/udf/syscall.rs`
  - multiple user syscalls can target the same document in one mutation.

Flarex differences:

- Flarex stores and coalesces the effective staged write in Postgres invoke
  session rows instead of keeping it only in process memory.

Known limitations:

- No replace syscall yet.
- Patch merging is shallow.
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

- Renamed the staged document write API to
  `stageInvokeSessionDocumentWrite(...)`.
- Renamed the input type to `StageInvokeSessionDocumentWriteInput`.
- Updated persistence, executor, and test helpers to use stage/coalesce
  terminology.

Convex references:

- `crates/database/src/transaction.rs`
  - pending writes are transaction state, not insert-only rows.
- `crates/database/src/committer.rs`
  - commit consumes the final staged write set.

Flarex differences:

- Flarex still stores staged writes in durable invoke-session rows because the
  Dynamic Worker and trusted executor are split.

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

- Added read-your-writes overlay for indexed query syscalls.
- Indexed reads now use persisted index state plus staged write overlay for the
  active invoke session.
- Staged index keys use the same ordered encoded key shape as commit-time index
  maintenance.
- Added tests for staged insert, patch into range, patch out of range, and
  delete.

Convex references:

- `crates/database/src/transaction.rs`
  - pending writes participate in transaction reads.
- `crates/common/src/index.rs`
  - index ordering is derived from indexed fields plus document ID.
- `crates/database/src/committer.rs`
  - index changes are part of the atomic document commit.

Flarex differences:

- Flarex rebuilds this view from persisted invoke-session rows per syscall.
  Convex keeps transaction state process-local.

Known limitations:

- Pagination/read interval precision is still not Convex-exact.
- Large range efficiency needs a storage-level overlay.
- Same-document write coalescing is still pending.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Current Decision

Normal `mutation` is single-shard. Inside one `PartitionDO`, Flarex should copy
Convex's core OCC idea:

1. Begin with a logical timestamp.
2. Run user code through restricted syscalls.
3. Collect read set and staged writes.
4. At commit, compare reads against write-log entries after `beginTs`.
5. If a read overlaps with a later write, return structured OCC conflict.
6. Otherwise, write document history, current rows, index rows, and write log in
   one Durable Object storage transaction.

## Implemented So Far

`PartitionDO` supports:

- `POST /begin`
- `POST /commit`
- `GET /document`, returning a document plus a document read-set entry
- `GET /index`, returning snapshot index results plus an index read-set entry
- `idempotency_keys`
- structured `OCC_CONFLICT` responses

`SingleShardTransaction` in `apps/backend/src/transaction.ts` now provides the
executor-facing transaction wrapper over those endpoints:

- begins against one `PartitionDO`
- collects and deduplicates read-set entries
- stages writes without exposing storage handles
- generates document IDs before commit
- provides read-your-writes for document `get`
- coalesces repeated writes to the same document before commit
- surfaces partition commit failures as `PartitionRequestError`

`executeInvoke` in `apps/backend/src/invoke.ts` now uses
`SingleShardTransaction` to run registered query and mutation handlers:

- queries begin a transaction, execute reads, and return the accumulated read
  set without committing
- mutations begin a transaction, execute staged writes, and commit with source
  `invoke:{path}`
- `OCC_CONFLICT` from `PartitionDO` is preserved as the HTTP status/body

Current read-set types:

- document reads
- table reads
- index range reads

## Convex References

- `crates/database/src/transaction.rs`
  `Transaction`, `apply_function_runner_tx`, and `FinalTransaction`.
- `crates/database/src/committer.rs`
  `validate_commit`, `commit_has_conflict`, and `compute_writes`.
- `crates/database/src/reads.rs`
  `ReadSet`, `TransactionReadSet`, document reads, and indexed range reads.
- `crates/database/src/write_log.rs`
  `WriteLog::is_stale`, `PendingWrites`, and token refresh.
- `crates/database/src/database.rs`
  `execute_with_occ_retries` and `commit_with_write_source`.

## Cloudflare Difference

Convex's committer can validate against a process-local write log and persist to
Postgres under a lease. Flarex's validation happens inside one `PartitionDO`;
the DO itself is the local serialization and storage boundary.

Cross-shard OCC cannot be made equivalent to Convex mutation semantics without
a different coordinator. Flarex should not pretend otherwise.

Future bounded cross-shard atomicity belongs in a separate `atomicMutation`
layer with a `TransactionCoordinatorDO` and participant prepare/commit/abort
protocol. It must not change the meaning of normal `mutation`, which remains
single-shard.

## Known Limitations

- There is no executor retry loop yet.
- No read tokens are emitted for query subscriptions yet.
- OCC validation remains conservative for table scans and future query forms.
- No retention window or out-of-retention error exists yet.
- Transaction index reads do not yet overlay staged writes.
- `PartitionDO` commit validates `colocateWith` and `partitionBy(field)`
  owner-field placement for cached schemas when `field !== "_id"`.
- Root `_id` partition creation requires backend preallocation before user code
  starts; this is planned but not implemented yet.
- Root `partitionBy(field)` owner uniqueness is enforced at commit for
  `field !== "_id"`.
- Bounded multi-shard `atomicMutation` is documented as future work, but there
  is no coordinator, prepare protocol, or recovery path yet.

## Root Partition Creation Plan

Checkpoint title: `Consume preallocated root ids`

Previous completed checkpoint: `1a8a8ff` Plan create-root id preallocation.

What changed:

- `SingleShardTransaction.begin(...)` now accepts create-root context:

  ```ts
  {
    createRoot: {
      rootTableId,
      preallocatedRootId,
    },
  }
  ```

- The transaction consumes `preallocatedRootId` when the handler inserts into
  the root table without an explicit id.
- Explicit root insert ids must match the preallocated id.
- A second root insert in the same create-root transaction is rejected.
- Commit requires the preallocated root id to be consumed exactly once.
- Direct backend invoke can now execute create-root functions internally, while
  final SDK codegen still rejects them.

Why this belongs in OCC:

- Root creation is now part of the transaction contract, not an ad hoc handler
  convention.
- The commit boundary enforces that a create-root mutation cannot complete
  without producing the root document for the preallocated partition.
- Colocated child writes can use the returned root id and commit atomically in
  the same `PartitionDO`.

Convex references:

- `crates/database/src/transaction.rs`
  - transaction state tracks writes before final commit.
- `crates/database/src/committer.rs`
  - commit validation rejects invalid write sets.
- `crates/database/src/database.rs`
  - Convex id allocation participates in the same logical transaction.

Cloudflare difference:

- Convex does not need a preallocated root id because it does not route user
  code to a Durable Object by document id before execution. Flarex must bind
  the root id to the transaction before the handler starts.

Remaining limitations:

- Historical note: later checkpoints enabled ExecutionDO/syscall create-root
  sessions, generated `partitionCreateRoot` references, and public invoke/sync
  paths that omit `partitionKey` for create-root functions.
- Create-root remains limited to `_id` partition roots and single-shard
  colocated writes.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Previous Root Id Preallocation Plan

Checkpoint title: `Plan create-root id preallocation`

Previous completed checkpoint: `601256a` Classify create-root partition
analysis.

What changed:

- Backend function metadata now accepts both selector partitions and
  `partitionCreateRoot` policies.
- `resolveFunctionExecutionScope` can plan a create-root execution by
  allocating a root id before transaction begin.
- The planned scope carries:

  ```ts
  {
    kind: "partitionCreateRoot",
    table: "users",
    partitionField: "_id",
    partitionKey: preallocatedRootId,
    preallocatedRootId,
  }
  ```

- `executeInvoke` still rejects create-root scopes before user code runs
  because `ctx.db.insert` cannot consume the preallocated id yet.

Why this belongs in OCC:

- The preallocated root id is now explicitly the partition key for the future
  transaction.
- The next OCC slice must pass that id into `SingleShardTransaction` and require
  exactly one matching root insert before commit.

Convex references:

- `crates/database/src/transaction.rs`
  - transaction state owns writes accumulated during execution.
- `crates/database/src/committer.rs`
  - commit validation rejects invalid write sets.
- `crates/application/src/application_function_runner/mod.rs`
  - backend prepares execution context before user code.

Cloudflare difference:

- Convex can allocate document ids inside the database transaction. Flarex must
  allocate the root id before selecting a `PartitionDO`, so the id becomes part
  of execution planning.

Remaining limitations:

- Preallocated ids are not exposed to the handler yet.
- Root insert consumption is not validated at commit.
- Final SDK codegen still rejects create-root functions.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Previous Root Partition Classification

Checkpoint title: `Classify create-root partitions`

Previous completed checkpoint: `14c303e` Prefer root model partitions in
example.

What changed:

- Deployment analysis now has an explicit create-root partition policy:
  `partitionCreateRoot`.
- The policy is emitted only for mutation/workflow mutation functions that
  declare `partition: model.<rootTable>` and have no required
  `v.id("<rootTable>")` argument.
- Final codegen rejects this policy because transaction execution still lacks
  the backend preallocated root id required to name the `PartitionDO`.

Why this belongs in OCC:

- The future preallocated id must become part of the transaction context before
  user code runs.
- Commit validation must eventually prove the mutation consumed that id with
  exactly one root-table insert, while colocated child writes remain in the same
  partition.
- Until that exists, classifying create-root without executing it prevents
  accidental cross-layer hacks.

Convex references:

- `crates/database/src/transaction.rs`
  - transaction state owns writes accumulated during function execution.
- `crates/database/src/committer.rs`
  - commit validation is where invalid write sets are rejected.
- `crates/application/src/application_function_runner/mod.rs`
  - backend execution prepares the function context before user code runs.

Cloudflare difference:

- Convex can allocate ids inside the logical database transaction. Flarex must
  allocate the root id before choosing the `PartitionDO`, so id preallocation is
  part of the transaction entry contract.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Previous Root Creation Plan

Checkpoint title: `Plan explicit partition table API`

Previous completed checkpoint: `ff5dae0` Generate partition-scoped mutation
types.

What changed:

- Normal `mutation` remains single-shard.
- The v1 root table API is `_id` partitioned only through
  `definePartitionTable(...)`.
- `partition: model.<rootTable>` needs two backend execution modes:
  - existing mode: one required `v.id(rootTable)` arg routes to that partition,
  - create mode: zero required root IDs in a mutation causes backend to
    preallocate a new root ID and start execution in that new partition.
- During create mode, the first `ctx.db.insert(rootTable, value)` must consume
  the preallocated root ID. The mutation must not create multiple root
  documents for the same root table.
- Colocated child writes can then use the returned root ID and commit
  atomically in the same `PartitionDO`.

Convex references:

- `crates/database/src/transaction.rs`
  - user execution accumulates writes before commit.
- `crates/database/src/committer.rs`
  - commit validation is the authoritative place to reject invalid write sets.
- `crates/database/src/database.rs`
  - Convex has ID allocation and OCC inside one logical database execution
    path.

Cloudflare difference:

- Convex can generate an `_id` during user code and still commit into one
  logical database. Flarex must know the `PartitionDO` before user code runs,
  so create-mode root IDs must be allocated before transaction begin.

Remaining limitations:

- `SingleShardTransaction` currently generates document IDs at write staging
  time without a root preallocation contract.
- Backend execution metadata does not yet represent create-mode partition
  scope.
- Commit validation does not yet require exactly one root insert for
  create-mode root partitions.

Verification:

```sh
Documentation-only change; no runtime validation required.
```

## Last Update

Implemented commit-boundary uniqueness for root owner fields.

Checkpoint title: `Enforce partition owner uniqueness`

Previous completed checkpoint: `b39f3bc` Plan partition owner uniqueness.

What changed:

- Added `partition_owners` to `PartitionDO` as the current owner map for
  `partitionBy(field)` root tables.
- Commit now resolves document IDs before validation so owner claims are
  checked against the same IDs that will be persisted.
- Commit validation computes owner claims and releases before applying writes.
- Commit application updates owner mappings in the same Durable Object storage
  transaction as document history, current rows, index rows, and write log.
- Duplicate root owners fail deterministically with
  `UniquePartitionOwnerError`, separate from retryable OCC conflicts.

Convex references:

- `crates/database/src/committer.rs`
  - final validation and persistence happen at one authoritative boundary.
- `crates/database/src/transaction.rs`
  - function execution accumulates a write set before commit validation.
- `crates/database/src/database.rs`
  - retryable OCC conflicts stay distinct from deterministic validation
    failures.

Cloudflare difference:

- Convex can enforce uniqueness against one logical database. Flarex enforces
  this owner uniqueness inside one `PartitionDO` because all contenders for the
  same `partitionBy(field)` value route to that same partition.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/transaction.test.ts
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Previous Update

Planned commit-boundary uniqueness for root owner fields.

Checkpoint title: `Plan partition owner uniqueness`

Previous completed checkpoint: `88c0535` Document atomicMutation as future
layer.

What changed:

- Added `partitionBy(field)` owner uniqueness as a single-shard hardening
  requirement.
- Defined the authoritative enforcement point as `PartitionDO` commit, not
  generated TypeScript alone.
- Planned a shard-local `partition_owners` table so concurrent creates for the
  same owner value serialize in the same `PartitionDO`.
- Kept this separate from global unique constraints. `partitionBy(field)` is
  local to the owner partition because the owner value is the partition key.

Planned commit algorithm:

```txt
for each non-delete write:
  if table.placement = partitionBy(field) and field != "_id":
    require document[field] == current partitionKey
    require partition_owners(table_id, field, document[field]) is empty
      or points at this document id

after validation succeeds:
  apply document history/current rows
  apply index rows
  upsert partition_owners entry for root owner writes
  append write_log
```

Convex references:

- `crates/database/src/committer.rs`
  - commit validation is the final authority before persistence.
- `crates/database/src/transaction.rs`
  - user execution stages writes before final validation.
- `crates/database/src/database.rs`
  - OCC retry behavior remains separate from deterministic validation errors.

Cloudflare difference:

- Convex can validate application-level uniqueness against a single logical
  database/index. Flarex can enforce `partitionBy(field)` owner uniqueness
  inside one `PartitionDO` because all contenders for the same owner value
  route to the same partition.

Verification:

```sh
git diff --check
```

## Previous Update

Recorded the boundary between current single-shard OCC and a future bounded
multi-shard `atomicMutation` layer.

Checkpoint title: `Document atomicMutation as future layer`

Previous completed checkpoint: `ea69fc5` Enforce partitionBy field ownership.

What changed:

- Clarified that normal `mutation` remains the only implemented atomic path,
  and it is still single-shard.
- Documented that any future all-or-nothing multi-shard operation needs a
  separate coordinator protocol instead of extending `SingleShardTransaction`
  silently.
- Cross-linked the transaction model to the future `atomicMutation` design in
  `roadmaps/07-cross-shard-workflows.md`.

Convex references:

- `crates/database/src/committer.rs`
  - all-or-nothing commit semantics remain the target.
- `crates/database/src/database.rs`
  - OCC retry behavior remains the inspiration for conflict retries.

Cloudflare difference:

- Convex commits against one logical deployment database. Flarex single-shard
  OCC commits inside one `PartitionDO`; any multi-shard atomic path needs an
  explicit coordinator.

Verification:

```sh
git diff --check
```

## Previous Update

Added commit-time `partitionBy(field)` owner-field validation for
`field !== "_id"`.

Checkpoint title: `Enforce partitionBy field ownership`

Previous completed checkpoint: `9e60c33` Require colocated query placement
equality.

What changed:

- `PartitionDO.validateWrites()` now treats `partitionBy(field)` as an owner
  field when `field !== "_id"`.
- Direct commits cannot insert or replace root records whose owner field points
  outside the current partition.
- Existing colocated commit validation is generalized through one owner-field
  helper.

Convex references:

- `crates/database/src/committer.rs`
  - commit validation remains the final storage authority.
- `crates/database/src/transaction.rs`
  - staged writes are validated before they become persisted documents and
    index rows.

Cloudflare difference:

- Flarex's commit boundary is shard-local. Owner-field validation is required
  so a root table record cannot be persisted into the wrong `PartitionDO`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Previous Update

Added commit-time `colocateWith` placement validation to the transaction
commit boundary.

Checkpoint title: `Enforce colocated placement at commit`

Previous completed checkpoint: `51d840a` Enforce colocated document placement.

What changed:

- `PartitionDO` stores the selected shard key in local metadata during schema
  cache installation.
- `PartitionDO.validateWrites()` now checks colocated document placement before
  read-set validation proceeds to persistence.
- Direct `SingleShardTransaction.commit()` attempts with a wrong colocated
  owner fail with `PlacementValidationError`.
- Existing OCC behavior remains intact; the new validation runs as another
  commit precondition before document/index rows are written.

Convex references:

- `crates/database/src/committer.rs`
  - final commit validation is authoritative and rejects invalid write sets.
- `crates/database/src/transaction.rs`
  - function execution accumulates writes before final validation/commit.

Cloudflare difference:

- Convex validates against a global transactional database. Flarex validates
  against the selected `PartitionDO`, so placement is part of the local commit
  precondition.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Previous Update

Added `SingleShardTransaction`, an executor-facing wrapper that turns future
`ctx.db` syscalls into `PartitionDO` begin/read/commit calls. It records read
sets, stages writes, coalesces same-document writes, and preserves
read-your-writes for document reads before commit.

Added `executeInvoke`, which places that wrapper behind a query/mutation handler
registry. This matches Convex's function-runner shape more closely: function
execution accumulates reads/writes first, then mutation execution commits the
final transaction.

Added Miniflare integration tests for:

- generated IDs and read-your-writes
- write coalescing before commit
- structured OCC conflict propagation through `commit`
- registered mutation execution through `executeInvoke`
- query execution through `executeInvoke` without commit
- the existing Worker route-level stale-read OCC flow

The previous route-level flow remains:

1. Route through the Worker to a tenant-scoped `PartitionDO`.
2. Seed a document.
3. Begin a stale transaction.
4. Read the document and capture the returned document read set.
5. Commit a concurrent update.
6. Verify the stale commit returns `409 OCC_CONFLICT`.

Convex inspiration is still `crates/database/src/transaction.rs`,
`crates/database/src/committer.rs`, `crates/function_runner/src/lib.rs`,
`crates/application/src/api.rs`, and `crates/database/src/database.rs`: user
function execution accumulates reads and writes, then the committer validates
the read set against writes that landed after the transaction began.

Cloudflare difference: Flarex's transaction wrapper calls a tenant-scoped
`PartitionDO` over request-style syscalls. It does not share a process-local
Rust transaction object with the committer.

Index read sets now use ordered half-open intervals generated from equality
prefixes and inequality bounds. Added an integration test where a mutation
reads an index prefix, a concurrent transaction inserts a document inside that
prefix, and the original mutation fails with `409 OCC_CONFLICT`. This verifies
that named query-builder ranges, `PartitionDO` SQL reads, and write-log OCC
overlap checks share the same interval semantics.

Paginated index reads continue to record the original full query interval,
rather than only the returned page. This is conservative but correct: a
concurrent write anywhere in the requested interval can invalidate the
mutation. Future reactive pagination may narrow this with Convex-style page
interval tracking and split cursors.

Verified with:

```sh
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend test
corepack pnpm --filter @flarex/backend build
```

## Create-Root Transaction Sessions

Previous completed checkpoint: `2e6dc68` Consume preallocated root ids.

`SingleShardTransaction` create-root enforcement is now exercised through
`ExecutionDO`, not only direct in-process backend invoke. This matters because
the hosted Dynamic Worker path will run user code outside the backend object
and every `ctx.db.*` operation must arrive as a syscall against a backend-owned
transaction.

The same OCC/write-set invariant applies:

- root id is chosen before transaction begin,
- the root table insert must consume that exact id,
- child colocated writes validate against the same partition key,
- finish cannot commit unless the root document exists in the staged writes,
  and
- commit still goes through `PartitionDO` with the accumulated read/write set.

Convex references:

- `crates/database/src/transaction.rs`
  - transaction state owns generated document ids and pending writes.
- `crates/database/src/committer.rs`
  - mutation validity is enforced before persisted commit state advances.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user function storage operations cross a syscall boundary.

Cloudflare difference: Flarex's transaction object lives in an `ExecutionDO`
session and talks to the partition over internal fetches. Convex keeps the
transaction and committer in the Rust backend process.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- --runInBand
```

## Interactive Transaction Syscall Clarification

Previous completed checkpoint: `fd4a4f4` Add maintenance sweep core.

What changed:

- Documented that Dynamic Worker execution must use immediate transaction
  syscalls, not a delayed collect-and-replay operation log.
- Clarified that the trusted executor owns the invoke session, `begin_ts`, read
  set, staged writes, return validation, OCC validation, and commit.
- Clarified that reads during a mutation must use a transaction view composed of
  the persisted snapshot plus this session's staged write overlay.
- Added the first implementation gate: executor tests for insert/get,
  patch/get, delete/get, table-query overlay, and a realistic parent-read,
  child-insert, child-query, parent-patch mutation shape.

Why it changed:

A Convex-style mutation can branch on earlier query results and issue later
reads or writes based on those results. Flarex therefore cannot ask the Dynamic
Worker to collect database operations locally and replay them after user code
returns. Each `ctx.db.*` call must synchronously cross into the trusted executor
and receive the current transaction-view result.

Convex references:

- `crates/database/src/transaction.rs`
  - transaction state owns reads, pending writes, and read-your-writes behavior.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code reaches backend capabilities through syscalls.
- `crates/application/src/application_function_runner/mod.rs`
  - function execution is coordinated by the backend application layer before
    commit is published.

Flarex differences:

- Convex keeps the isolate syscall layer and transaction object inside the Rust
  backend process. Flarex intentionally runs user TypeScript in a Cloudflare
  Dynamic Worker and persists the transaction session in the trusted executor.
- A long Flarex mutation does not hold a Postgres transaction open while user
  code runs, but its older `begin_ts` can make OCC conflicts more likely.

Known limitations:

- This checkpoint is documentation only.
- The current Postgres executor still needs authoritative staged read overlay
  implementation for table and index query syscalls.
- Index-query overlay can start conservative; exact Convex-style index/page
  interval behavior can be tightened after table-query overlay is correct.

Verification:

```sh
git diff --check
```
