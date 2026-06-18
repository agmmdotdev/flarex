# OCC And Transactions

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

## Known Limitations

- There is no executor retry loop yet.
- No read tokens are emitted for query subscriptions yet.
- OCC validation remains conservative for table scans and future query forms.
- No retention window or out-of-retention error exists yet.
- Transaction index reads do not yet overlay staged writes.
- `PartitionDO` commit validates `colocateWith` placement for cached schemas,
  but root `partitionBy("_id")` ownership is not enforced yet.

## Last Update

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
