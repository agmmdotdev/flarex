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
- Root `partitionBy("_id")` ownership is not enforced yet.
- Root `partitionBy(field)` owner uniqueness is not enforced yet.
- Bounded multi-shard `atomicMutation` is documented as future work, but there
  is no coordinator, prepare protocol, or recovery path yet.

## Last Update

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
