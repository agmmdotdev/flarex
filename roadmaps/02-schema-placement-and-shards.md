# Schema Placement And Shards

## Current Decision

Redesign the v1 schema placement API around explicit table kinds instead of
chainable placement methods.

The v1 public API target is:

- `definePartitionTable(...)` defines a root shard table. Its shard key is
  always the document `_id`.
- `defineColocatedTable(rootTable, ownerField, ...)` stores child records in
  the same shard as a root partition table.
- `defineGlobalTable(...)` is allowed only for small, low-write
  deployment-level tables and lookup/projection support.
- `defineProjection(...)` is used for cross-shard read models.

The v1 API should not support arbitrary root partition fields such as
`partitionBy("slug")`. Natural-key lookups should be modeled with global lookup
tables, projections, or a future unique-index service, then routed by root ID.

Do not add `relation()` as a storage primitive yet. It may be added later as a
type and developer-experience helper, but physical placement must remain
explicit.

## Example

```ts
documents: definePartitionTable({
  title: v.string(),
})

comments: defineColocatedTable("documents", "documentId", {
  documentId: v.id("documents"),
  body: v.string(),
}).index("by_document", ["documentId"])

appSettings: defineGlobalTable({
  key: v.string(),
  value: v.string(),
})
```

The runtime maps a document ID to:

```txt
partition:{deploymentId}:{documentId}
```

Legacy prototype syntax remains in older checkpoints and may remain temporarily
for migration tests:

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

## Convex References

- `crates/value/src/table_mapping.rs`
  Table mapping and active/hidden table handling.
- `crates/common/src/schemas/mod.rs`
  Database schema and table definitions.
- `npm-packages/convex/src/server/schema.ts`
  Developer-facing schema authoring inspiration. Flarex keeps Convex-like table
  definition ergonomics but must add explicit physical placement table kinds.

## Cloudflare Difference

Convex lets a mutation read/write across the deployment's database and uses OCC
to reject conflicts. Flarex cannot provide cheap global atomic writes across
many Durable Objects. Developers must model authoritative write ownership.

For common apps, the owner is usually a document, room, cart, order, course,
team, workspace, store, user, or tenant. The owner is not required to be a
user.

## Known Limitations

- Tables without an obvious root owner need explicit design.
- Unique constraints across shards need a dedicated unique-index DO later.
- Global tables can become bottlenecks and must be limited.
- Generated type-level enforcement now narrows mutation writes for functions
  that declare `partition: model.<table>.by<Field>(...)`.
- The current implementation still contains legacy
  `defineTable(...).partitionBy(...)`, `.colocateWith(...)`, and `.global()`.
  These should become compatibility shims after the new constructors are added.
- `partitionBy("_id")` root-record creation/allocation is now implemented for
  create-root function declarations. Legacy constructor cleanup remains.
- Legacy `partitionBy(field)` owner-field uniqueness exists for `field !==
  "_id"`, but arbitrary partition fields are no longer the v1 product target.
- Owner-scoped index queries must include an equality on the placement field
  that matches the current partition key.
- Document IDs currently use a placeholder numeric table ID prefix
  (`{tableId}:{uuid}`) instead of Convex's encoded `DeveloperDocumentId`.
- Schema cache sync is per-invoke/per-partition and coarse-grained: if the
  partition schema version differs, the full schema cache is replaced.

## Explicit Table Kind Redesign

Checkpoint title: `Plan explicit partition table API`

Previous completed checkpoint: `ff5dae0` Generate partition-scoped mutation
types.

What changed:

- The roadmap now makes explicit table constructors the v1 target:
  `definePartitionTable`, `defineColocatedTable`, and `defineGlobalTable`.
- Root partition tables are `_id` owned only in v1. This removes the earlier
  arbitrary `partitionBy(field)` surface from the product target.
- `defineColocatedTable(rootTable, ownerField, ...)` remains the way to model
  child tables inside the same root partition.
- Natural-key routing such as slug-based teams should use lookup/projection
  design, not slug as the physical shard key in v1.

Convex references:

- `npm-packages/convex/src/server/schema.ts`
  - Convex keeps schema authoring compact and generated-data-model friendly.
    Flarex should keep that feel while naming physical placement directly.
- `crates/common/src/schemas/mod.rs`
  - backend schema metadata is the source for validation and table state.
- `crates/value/src/table_mapping.rs`
  - active table mapping remains separate from user-facing schema shape.

Cloudflare difference:

- Convex table definitions do not expose physical shard placement because one
  logical database owns transactions. Flarex must expose root/colocated/global
  placement because it determines the `PartitionDO` transaction boundary.

Remaining limitations:

- This is a planning checkpoint only. The implementation still uses the old
  chainable placement methods.
- Root partition creation needs a backend preallocation path before
  `partition: model.table` can support create mutations.
- Existing tests and examples still need migration from
  `partition: model.table.byId("field")` to `partition: model.table`.

Verification:

```sh
Documentation-only change; no runtime validation required.
```

## Explicit Table Constructor Update

Checkpoint title: `Add explicit schema table constructors`

Previous completed checkpoint: `ebf431a` Plan explicit partition table API.

What changed:

- Added the v1 public constructor names in `packages/flarex/src/schema.ts`:
  - `definePartitionTable(...)`
  - `defineColocatedTable(rootTable, ownerField, ...)`
  - `defineGlobalTable(...)`
- The new constructors are compatibility wrappers over the existing placement
  metadata:
  - `definePartitionTable(...)` records `{ kind: "partitionBy", field: "_id" }`
  - `defineColocatedTable(...)` records `{ kind: "colocateWith", ... }`
  - `defineGlobalTable(...)` records `{ kind: "global" }`
- Existing chain APIs remain available for legacy tests and migration while the
  rest of codegen/backend moves to the simpler v1 model.

Convex references:

- `npm-packages/convex/src/server/schema.ts`
  - kept the compact table-constructor style and type inference pattern.
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - generated data model typing depends on schema definitions retaining precise
    validator/index information.

Cloudflare difference:

- Convex's `defineTable` does not encode physical shard placement. Flarex's new
  constructor names make placement explicit because it determines the
  `PartitionDO` transaction boundary.

Remaining limitations:

- The internal serialized placement shape is still the legacy
  `partitionBy`/`colocateWith`/`global` shape.
- Codegen still emits `model.table.byId(...)`; `model.table` root objects are
  the next slice.
- Backend create-mode root preallocation is not implemented yet.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
```

## Partition Scope Type Update

Checkpoint title: `Generate partition-scoped mutation types`

Previous completed checkpoint: `d3ef699` Infer client partition keys from
partition metadata.

What changed:

- Schema placement now feeds generated mutation types.
- `flarex-dev` walks `partitionBy(...)` roots and `colocateWith(...)` chains to
  emit a `PartitionScopes` type in `_generated/server.ts`.
- A partitioned mutation handler receives write methods limited to the root
  table and colocated child tables for that root.
- `global()` tables are intentionally excluded from normal single-partition
  mutation write scopes.

Example:

```ts
users.partitionBy("_id")
lessonProgress.colocateWith("users", "userId")

// generated:
export type PartitionScopes = {
  users: "lessonProgress" | "users";
};
```

Convex references:

- `npm-packages/convex/src/server/schema.ts`
  - developer-facing schema authoring remains the source for generated data
    model types.
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
  - generated server files bind app-specific schema knowledge into function
    builders.
- `npm-packages/convex/src/server/registration.ts`
  - mutation context typing is specialized through generated builders.

Cloudflare difference:

- Convex schema placement is not developer-visible shard placement. Flarex
  placement determines the `PartitionDO` transaction boundary, so generated
  types must expose enough of that boundary to prevent obvious cross-shard
  writes during development.

Remaining limitations:

- Runtime placement checks remain authoritative.
- Reads are not narrowed yet.
- `partitionBy("_id")` root-record creation/allocation is still future backend
  work.
- Cross-shard writes still require future workflow or `atomicMutation`
  semantics.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- --run packages/flarex-dev/test/generate.test.ts
corepack pnpm --filter @flarex/example typecheck
```

## Last Update

Implemented root-owner uniqueness for `partitionBy(field)`.

Checkpoint title: `Enforce partition owner uniqueness`

Previous completed checkpoint: `b39f3bc` Plan partition owner uniqueness.

What changed:

- Added a shard-local `partition_owners` table inside `PartitionDO`.
- `PartitionDO` commit validation now rejects a root table write when
  `(table, partition field, partition value)` is already claimed by another
  current document.
- Root owner updates to the same document remain valid.
- Deleting a root owner releases the owner mapping so a later root document can
  claim the same partition value.
- `colocateWith(table, field)` records remain non-unique; multiple child
  records can share the same owner field inside the partition.

Enforced invariant:

```txt
teams.partitionBy("slug")
partitionKey = "acme"

first write:
  id = "1:team-a"
  slug = "acme"
  -> allowed

second write:
  id = "1:team-b"
  slug = "acme"
  -> UniquePartitionOwnerError
```

Convex references:

- `crates/database/src/committer.rs`
  - final write-set validation is the authoritative place to reject invalid
    writes.
- `crates/database/src/transaction.rs`
  - user execution stages writes before final validation and commit.
- `crates/common/src/schemas/mod.rs`
  - schema metadata participates in backend validation.

Cloudflare difference:

- Convex does not need a `partitionBy(field)` uniqueness primitive because it
  owns one logical transactional database. Flarex enforces this inside the
  selected `PartitionDO` so generated partition selectors can later identify a
  single root owner.

Remaining limitations:

- `partitionBy("_id")` root-record ownership remains separate future work.
- Generated `model.<table>.by<Field>(...)` selectors are still not implemented.
- Existing malformed data created before this enforcement is not backfilled by
  schema-cache installation.

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

Planned root-owner uniqueness for `partitionBy(field)`.

Checkpoint title: `Plan partition owner uniqueness`

Previous completed checkpoint: `ea69fc5` Enforce partitionBy field ownership.

What changed:

- Clarified that `partitionBy(field)` means the field is not only placement
  metadata; it is the root owner identity for that table.
- Documented that root tables using `partitionBy(field)` need an authoritative
  uniqueness guarantee for `(table, field, value)`.
- Kept `colocateWith(table, field)` non-unique. Child records may share the
  same owner field.
- Established that generated selectors such as `model.teams.bySlug("teamSlug")`
  depend on this uniqueness guarantee before they can be trusted as a safe DX
  layer.

Planned invariant:

```txt
teams.partitionBy("slug")
partitionKey = "acme"

Allowed:
  one current teams document with slug = "acme"

Rejected:
  a second current teams document with slug = "acme"
```

First implementation step:

1. Add a `partition_owners` table inside `PartitionDO` with a uniqueness
   constraint over `(table_id, owner_field, owner_value)`.
2. During commit validation, for `partitionBy(field)` where `field !== "_id"`,
   ensure the owner value matches the partition key and is either unclaimed or
   already claimed by the same document.
3. During commit application, update the owner mapping atomically with document
   history/current rows and index rows.
4. Reject duplicate owners with a structured `UniquePartitionOwnerError`.

Convex references:

- `crates/database/src/committer.rs`
  - final commit validation is the authoritative place to reject invalid write
    sets.
- `crates/common/src/schemas/mod.rs`
  - schema metadata participates in database validation.
- `npm-packages/convex/src/server/schema.ts`
  - developer-facing schema API remains the inspiration, even though
    `partitionBy` is Flarex-specific.

Cloudflare difference:

- Convex does not need a `partitionBy(field)` owner uniqueness rule because it
  stores documents in one logical transactional database. Flarex needs it so a
  generated partition selector like `model.teams.bySlug(...)` identifies one
  root owner inside one `PartitionDO`.

Verification:

```sh
git diff --check
```

## Previous Update

Implemented `partitionBy(field)` owner-field placement enforcement for
`field !== "_id"`.

Checkpoint title: `Enforce partitionBy field ownership`

Previous completed checkpoint: `9e60c33` Require colocated query placement
equality.

What changed:

- Placement validation now treats `partitionBy(field)` with `field !== "_id"`
  as an owner-field placement rule, like `colocateWith(..., field)`.
- Backend `ctx.db` reads and writes reject documents whose owner field does not
  match the current partition key.
- `PartitionDO` commit validation rejects direct writes whose owner field does
  not match the cached partition key.
- Indexed queries on these root tables must include
  `q.eq(field, partitionKey)`.
- Added tests for wrong-owner insert, owner-moving patch/replace,
  missing-owner query, wrong-owner query, and valid owner-scoped query.

Example:

```ts
cartItems: defineTable({
  cartId: v.string(),
  sku: v.string(),
}).partitionBy("cartId")
```

Required query shape:

```ts
ctx.db
  .query("cartItems")
  .withIndex("by_cart_sku", q => q.eq("cartId", cartId).eq("sku", sku))
```

Convex references:

- `crates/database/src/committer.rs`
  - final write-set validation happens at commit.
- `crates/database/src/transaction.rs`
  - backend transaction context mediates reads and writes.
- `crates/database/src/reads.rs`
  - indexed reads are structured ranges.

Cloudflare difference:

- Convex has no explicit per-table shard owner field because the database is
  one logical transactional system. Flarex must validate owner fields because
  a `PartitionDO` is only one shard.

Remaining limitations:

- `partitionBy("_id")` remains deferred until ID allocation/ownership is
  designed.
- Enforcement is runtime-only; generated query-builder types do not yet force
  the owner equality.
- Route inference still depends on function route metadata, not table
  placement alone.

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

Implemented query-time placement range enforcement for colocated tables.

Checkpoint title: `Require colocated query placement equality`

Previous completed checkpoint: `3326e3f` Enforce colocated placement at
commit.

What changed:

- Backend indexed query execution now inspects table placement before querying
  `PartitionDO`.
- For `colocateWith("users", "userId")`, the index range must include
  `q.eq("userId", partitionKey)`.
- Missing placement equality and wrong-owner equality fail with
  `PlacementValidationError`.
- Valid colocated equality queries continue to read the target partition and
  return normal results.

Enforced query invariant:

```txt
session.partitionKey = "2:u1"
lessonProgress.colocateWith("users", "userId")

q.eq("userId", "2:u1")
  -> allowed

q.eq("lessonId", "intro")
  -> rejected

q.eq("userId", "2:u2")
  -> rejected
```

Convex references:

- `npm-packages/convex/src/server/query.ts`
  - query builders preserve structured range expressions.
- `crates/database/src/reads.rs`
  - indexed reads become structured read-set intervals.
- `crates/database/src/transaction.rs`
  - backend transaction reads are mediated before execution continues.

Cloudflare difference:

- Convex can query any indexed slice inside one logical database and rely on
  global OCC. Flarex must restrict colocated table reads to the current
  partition-owned slice because each `PartitionDO` only stores one shard.

Remaining limitations:

- This is runtime enforcement, not TypeScript-level query-builder enforcement
  yet.
- Root `partitionBy("_id")` read/write enforcement remains future work.
- Route inference still depends on function route metadata, not schema
  placement alone.

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

Implemented commit-time `colocateWith` placement validation inside
`PartitionDO`.

Checkpoint title: `Enforce colocated placement at commit`

Previous completed checkpoint: `51d840a` Enforce colocated document placement.

What changed:

- `PartitionDO` now stores the concrete `partitionKey` alongside its schema
  cache.
- `SingleShardTransaction.ensureSchema()` and raw partition `schema-cache`
  routing pass the partition key when installing schema metadata.
- `PartitionDO.validateWrites()` validates each non-null colocated write
  against the cached partition key before persistence/index maintenance.
- Delete writes validate the existing document placement when a current
  document exists.
- Direct low-level `SingleShardTransaction.commit()` can no longer bypass
  colocated placement after schema cache is installed.
- Added tests for wrong-owner direct insert and owner-moving direct replace at
  commit time.

Authoritative invariant:

```txt
PartitionDO.partitionKey = "2:u1"
write.table = lessonProgress
table.placement = colocateWith("users", "userId")
write.value.userId = "2:u2"
  -> commit rejects before storing documents or indexes
```

Convex references:

- `crates/database/src/committer.rs`
  - commit validation is the authoritative storage boundary.
- `crates/database/src/transaction.rs`
  - function execution produces a final write set that is validated before
    commit.
- `crates/common/src/schemas/mod.rs`
  - schema metadata constrains persisted documents.

Cloudflare difference:

- Convex has no colocated-shard placement rule. Flarex uses commit-time
  placement validation because each `PartitionDO` owns only one shard, and the
  shard database must reject writes for another owner even if they bypass the
  normal `ctx.db` syscall layer.

Remaining limitations:

- Placement validation only runs after schema cache is installed. Partitions
  with schema version `0` remain unrestricted test/bootstrap storage.
- Root `partitionBy("_id")` enforcement remains separate follow-up work.
- Index queries still validate returned colocated documents but do not
  statically require the range to include the placement field.

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

- Historical note: later create-root checkpoints added backend-owned root id
  preallocation and transaction enforcement for `_id` partition roots.
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

## Create-Root Placement Status

Previous completed checkpoint: `1d239b1` Run create-root mutations over sync.

Current root placement status:

- `_id` partition roots can be created through `partitionCreateRoot` function
  metadata.
- The backend preallocates the root id, starts execution in that partition, and
  requires the root table insert to consume that id.
- Existing-root functions still route by generated metadata such as
  `argField: "userId"`.
- Legacy `defineTable(...).partitionBy(...)` compatibility still exists and
  should be cleaned up after the explicit table constructors are fully migrated.

Convex references:

- `crates/value/src/document_id.rs`
  document ids encode table identity.
- `crates/database/src/transaction.rs`
  generated ids and staged writes participate in the transaction.
- `crates/database/src/committer.rs`
  invalid write sets are rejected before commit.

Cloudflare difference: Flarex root placement is a Durable Object routing
decision. Convex can allocate ids inside one logical database transaction;
Flarex must allocate the root id early enough to choose the target
`PartitionDO`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --maxWorkers=1
corepack pnpm --filter flarex-backend build
```
