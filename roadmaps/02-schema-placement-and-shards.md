# Schema Placement And Shards

## Current Decision

The v1 schema model is good enough to proceed:

- `partitionBy(field)` defines a root shard owner.
- `colocateWith(table, field)` stores child records in the same shard as the
  owner table.
- `global()` is allowed only for small, low-write deployment-level tables.
- `defineProjection(...)` is used for cross-shard read models.

Do not add `relation()` as a storage primitive yet. It may be added later as a
type and developer-experience helper, but physical placement must remain
explicit.

## Example

```ts
users: defineTable({
  name: v.string(),
}).partitionBy("_id")

lessonProgress: defineTable({
  userId: v.id("users"),
  lessonId: v.string(),
  completed: v.boolean(),
}).colocateWith("users", "userId")
```

The runtime maps a user ID to:

```txt
partition:{deploymentId}:{userId}
```

## Convex References

- `crates/value/src/table_mapping.rs`
  Table mapping and active/hidden table handling.
- `crates/common/src/schemas/mod.rs`
  Database schema and table definitions.
- `npm-packages/convex/src/server/schema.ts`
  Developer-facing schema authoring inspiration.

## Cloudflare Difference

Convex lets a mutation read/write across the deployment's database and uses OCC
to reject conflicts. Flarex cannot provide cheap global atomic writes across
many Durable Objects. Developers must model authoritative write ownership.

For common apps, the owner is usually a user, team, workspace, org, store,
cart, order, chat room, course, or tenant.

## Known Limitations

- Tables without an obvious owner need explicit design.
- Unique constraints across shards need a dedicated unique-index DO later.
- Global tables can become bottlenecks and must be limited.
- Generated type-level enforcement is not implemented yet.
- `colocateWith` is enforced at the backend user-code DB boundary for
  document reads and writes, but `partitionBy("_id")` root-record enforcement
  is not implemented yet.
- Index queries validate returned colocated documents, but Flarex does not yet
  statically require colocated index ranges to include the placement field.
- Document IDs currently use a placeholder numeric table ID prefix
  (`{tableId}:{uuid}`) instead of Convex's encoded `DeveloperDocumentId`.
- Schema cache sync is per-invoke/per-partition and coarse-grained: if the
  partition schema version differs, the full schema cache is replaced.

## Last Update

Implemented first backend `colocateWith` placement enforcement.

Checkpoint title: `Enforce colocated document placement`

Previous completed checkpoint: `c7f8f7d` Add route-aware generated client
inference.

What changed:

- `SingleShardTransaction` now records the concrete `partitionKey`.
- Backend `ctx.db` read paths validate colocated documents before returning
  them to user code.
- Backend `ctx.db` write paths validate colocated inserts, replaces, patches,
  and deletes against the current transaction partition.
- Mutations cannot insert a colocated child record whose placement field points
  at a different shard.
- Patches cannot move a colocated document to another owner by changing its
  placement field.
- Tests now cover wrong-owner inserts, owner-moving patches, and reads of
  misplaced colocated data.

Enforced invariant:

```txt
table.placement = colocateWith("users", "userId")
session.partitionKey = "2:u1"
document.userId = "2:u1"
  -> allowed

document.userId = "2:u2"
  -> PlacementValidationError
```

Convex references:

- `crates/database/src/transaction.rs`
  - transaction reads and writes are validated at the backend transaction
    boundary before commit.
- `crates/common/src/schemas/mod.rs`
  - schema metadata is part of backend validation, not only SDK typing.
- `crates/value/src/document_id.rs`
  - document identity carries table information used by backend validation.

Cloudflare difference:

- Convex does not need `colocateWith`; one logical database plus OCC can
  validate global read/write conflicts. Flarex must enforce child-record
  ownership because a `PartitionDO` is only one shard's authoritative database.

Remaining limitations:

- Root `partitionBy("_id")` enforcement is still not implemented because
  create-time root IDs need a dedicated owner allocation story.
- Direct low-level `SingleShardTransaction` test helpers can still seed
  malformed data; user-code DB syscalls reject it when read or written.
- Index queries validate returned documents but do not yet require the query
  range to constrain the colocated field.

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

Added invoke-time schema cache sync from `DeploymentDO` to the target
`PartitionDO`. `DeploymentDO` remains the source of truth for table and index
metadata, while `PartitionDO` keeps a shard-local cache used for commit-time
index maintenance. `executeInvoke` now loads schema, syncs the target partition
if its version is stale, and only then begins the transaction.

Convex reference:

- `crates/value/src/table_mapping.rs`
  Convex maps active table names and table numbers through `TableMapping`.
- `crates/value/src/document_id.rs`
  Convex developer IDs encode table numbers separately from resolved internal
  tablet IDs.
- `crates/database/src/transaction.rs`
  Transaction execution has access to metadata/table mapping during reads and
  writes.

Cloudflare difference: Flarex keeps the mapping in `DeploymentDO` and resolves
names before calling a tenant-scoped `PartitionDO`; each shard also needs a
local schema cache so document writes can maintain local indexes.

Verified with:

```sh
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend test
```
