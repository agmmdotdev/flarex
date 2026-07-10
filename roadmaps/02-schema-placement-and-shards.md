# Schema Placement And Shards

## Inventory One Fixed Shared Placement Without Claiming A Router

Previous completed checkpoint: `7793ed9` Add shared scope authority
provisioning.

What changed:

- Added a C2 bootstrap factory closed over one copied, validated
  `shared_database` locator. No per-page or per-item input can choose a locator,
  database key, schema, scope ID, epoch, generation, fence, or counter.
- Scanned the indexed `deployment_id` primary key through a captured maximum
  instead of reusing the unindexed `(created_at, deployment_id)` metadata cursor.
- Compared every existing scope with the complete fixed locator before treating
  its clock as provisioned. A topology/locator mismatch is typed conflict and
  never rewritten.
- Added point-in-time parity categories for missing scope, missing clock,
  locator conflict, complete pair, and globally orphaned clock authority.

Why it changed:

C2 migrates only the placement the current adapter can actually address. A
callback returning arbitrary locators would pretend C3's located data-plane
capability already exists and could turn stored routing metadata into a
caller-selected database target.

Convex references inspected:

- `crates/model/src/lib.rs`
- `crates/model/src/database_globals/mod.rs`
- `crates/database/src/bootstrap_model/index_backfills/types.rs`
- `crates/database/src/table_iteration.rs`

How Flarex differs:

- Convex bootstraps one configured persistence instance. Flarex records a
  control-plane locator even in the co-located lane, so exact locator equality
  is part of bootstrap validity.
- The C2 frontier is a resumable inventory boundary, not a shard router and not
  a durable Postgres snapshot.

Known limitations:

- C2 makes only a `complete_through_frontier` point-in-time claim. C3 must
  fence/quiesce legacy creation, rerun the inventory, and keep future authority
  creation from reopening a gap.
- `schema_per_scope` and `database_per_scope` still require target capabilities,
  readiness recovery, and per-locator verification in C3.
- No schema-qualified adapter, database resolver, RLS, pooled-scope proof, or
  physical resource provisioning is introduced.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/scopeAuthorityBootstrap.test.ts
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/scopeAuthorityBootstrap.postgres.test.ts
corepack pnpm --filter @flarex/persistence-postgres test:postgres
git diff --check
```

## Prove Only The Co-Located Provisioning Topology

Previous completed checkpoint: `05d10f5` Add the FlarexDB scope clock.

What changed:

- Added an initial-authority provisioner whose accepted locator is statically
  and dynamically restricted to `shared_database`.
- Copied the trusted locator into the provisioner at construction so later
  caller mutation cannot redirect an in-flight ensure operation.
- Created deployment, locator, and clock rows in one database transaction and
  returned typed `created`, `created_scope_and_clock`, or
  `already_provisioned` outcomes.
- Rejected immutable locator mismatches and skipped both control-scope and
  orphan-clock ID collisions before publishing a new locator.

Why it changed:

The current Drizzle adapter has one unqualified schema and one pool. It can
prove ACID creation only when all three rows are co-located. The stored
`schema_per_scope` and `database_per_scope` locator variants are contracts,
not implemented routers; C1 must not use a shared-schema test as evidence for
those topologies.

Convex references inspected:

- `crates/model/src/lib.rs`
- `crates/model/src/database_globals/mod.rs`
- `crates/common/src/bootstrap_model/schema_state.rs`

How Flarex differs:

- Convex starts from one configured nominal persistence instance. Flarex must
  eventually publish control location and reconcile a separately located
  clock before declaring a split-topology scope ready.

Known limitations:

- S02-C2 bootstrap is shared-database-only until a trusted placement provider
  and located data-plane inventory exist. It must use a separate explicit
  repair capability for an inventoried locator missing its initial clock.
- S02-C3 must define atomic readiness for split topologies: a missing clock is
  incomplete and fail-closed, not silently legacy authority.
- No schema-qualified adapter, database resolver, RLS, or pooled-scope proof is
  included here.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/scopeAuthorityProvisioning.test.ts
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/scopeAuthorityProvisioning.postgres.test.ts --reporter verbose
git diff --check
```

## Keep Clock Authority In The Located Data Plane

Previous completed checkpoint: `7b18427` Target the Cloudflare executor
Worker.

What changed:

- Added `fx_system_scope_clock` as a scope-keyed data-plane table with no
  unconditional foreign key to the control-plane `fx_control_scope` locator.
- Kept every read and lock predicate explicitly scoped by `scope_id`; the
  primary key prevents collisions between two colocated scopes.
- Required explicit storage generation and epoch while retaining only safe
  initial defaults for fence `1` and commit/outbox counters `0`.
- Added an upgrade proof showing pre-existing scope locator rows survive the
  additive migration and receive no implicit clock row.

Why it changed:

Shared-database, schema-per-scope, and database-per-scope placement cannot all
support a physical foreign key from the data plane back to the control plane.
The provisioning protocol must establish locator/clock parity explicitly
without turning one co-located development topology into the universal design.

Convex references inspected:

- `crates/postgres/src/lib.rs`
- `crates/postgres/src/sql.rs`
- `crates/common/src/persistence.rs`

How Flarex differs:

- Convex receives a configured nominal Postgres instance and does not resolve
  a scope across multiple physical placement modes. Flarex locates the target
  first, then reads authoritative generation/fence state inside that data
  plane.

Known limitations:

- S02-C owns locator/clock parity and topology-specific provisioning recovery.
- S02-E still owns transaction scope guards, shared-pool leak rejection, and
  real-Postgres cross-scope access tests.
- No RLS or runtime database locator is introduced by S02-B.
- The S02-B PID-scoped lock proof passed on PostgreSQL 18. The broader package
  Postgres lane has one unchanged catalog-test SQLSTATE mismatch: it expects
  `23503`, while PostgreSQL 18 reports `23001` for `ON DELETE RESTRICT`.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/scopeClock.postgres.test.ts --reporter verbose
corepack pnpm --filter @flarex/persistence-postgres test:postgres
git diff --check
```

## Define The Scope Physical-Locator Contract

Previous completed checkpoint: `7f4ce29` Resolve trusted app-data generation.

What changed:

- Added one checked `fx_control_scope.isolation_kind` with the accepted
  `shared_database`, `schema_per_scope`, and `database_per_scope` modes.
- Defined `physical_locator_json` as the exact non-null object
  `{ kind, databaseKey, schemaName }`; `kind` must equal `isolation_kind`, and
  unknown keys or whitespace-only locator values fail before or at the
  database boundary.
- Kept database routing indirect: `databaseKey` names trusted server
  configuration and cannot be a caller-provided connection contract.
- Added PGlite coverage for all three modes and an environment-gated real
  Postgres constraint test.

Why it changed:

The accepted design named a physical locator but left its JSON shape open. An
untyped JSON record would let credentials, mismatched topology modes, or
unreadable routing state enter the authority catalog before the resolver is
built. S02-A fixes the smallest locator that works across all three declared
Postgres placements.

Convex references inspected:

- `crates/postgres/src/lib.rs`
- `crates/postgres/src/sql.rs`
- `crates/value/src/table_mapping.rs`
- `crates/common/src/bootstrap_model/tables.rs`

How Flarex differs:

- Convex's multitenant Postgres path uses one configured instance name and
  qualifies persistence rows and joins with it. Flarex must also describe
  whether a scope shares a database/schema or owns one, because deployment
  routing crosses Cloudflare and independently configured Postgres targets.
- The locator is internal routing metadata, not a public shard or partition
  API. The developer model remains Convex-like.

Known limitations:

- S02-A stores but does not resolve or provision a locator. S02-C/S02-D own
  those operations.
- The strict three-key v1 object will require an additive contract/migration if
  future routing needs region, replica, or table-family metadata.
- RLS and transaction-local scope binding remain S02-E work.
- The real-Postgres test was skipped because
  `FLAREX_POSTGRES_DATABASE_URL` was unset.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres build
git diff --check
```

## Add The FlarexDB Schema And Migration Turn Plan

Previous completed checkpoint: `478be74` Correct FlarexDB transaction and sync
design.

What changed:

- Added the turn-by-turn
  [FlarexDB schema and migration plan](./flarexdb-foundation/01-schema-and-migrations.md).
- Fixed trusted per-scope storage-generation pinning, namespaced
  `fx_control_*`/`fx_app_*`/`fx_system_*` physical ownership, bigint protocol
  boundaries, and rollback-safe scope-clock counter semantics.
- Kept all new migrations additive and placed backfill, invariant comparison,
  scoped cutover, rollback, and retirement behind explicit gates.

Why it changed:

The accepted schema inventory was intentionally broad and used both short and
namespaced example table names. Implementation needs one physical naming rule,
one dense scope-counter invariant, and small vertical checkpoints.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/database/src/reads.rs`

How Flarex differs:

- Shared Postgres tables require explicit scope-qualified keys and trusted
  scope binding, while Cloudflare routing and storage-generation fencing span
  processes that Convex keeps inside one backend.

Known limitations:

- Exact DDL, Drizzle migrations, RLS policy, codecs, backfill tooling, and real
  Postgres query-plan evidence are not implemented.

Verification:

```sh
git diff --check
```

## Define Scope-Safe Physical Topologies

Previous completed checkpoint: `01c11ab` Clarify SessionDO cache read bridge.

What changed:

- Made `scope_id` the mandatory data-plane authority in shared-table mode.
- Required scope-qualified primary keys, unique constraints, and intra-scope
  foreign keys, with RLS or equivalent transaction-local scope defense.
- Allowed redundant scope columns to disappear only in schema-per-scope or
  database-per-scope physical layouts.
- Limited shared Medusa tables to homogeneous platform schema/module versions;
  custom or staggered Medusa projects use per-scope schemas/databases until a
  safe compiled strategy is proven.

Why it changed:

The long-form schema declared scope authority but used global primary keys and
unqualified relationships in several Payload/Medusa examples. It also allowed
multiple physical topologies without explaining how generated constraints
change between them.

Convex references:

- `crates/database/src/committer.rs`
  - authority and transaction ordering remain deployment-local.

How Flarex differs:

- Cloudflare routing identifies the scope, while Postgres must still enforce
  the scope in shared physical tables. Per-scope schemas/databases are an
  operational isolation option, not a public shard API.

Known limitations:

- The exact shared-table RLS policy, schema promotion tooling, Medusa version
  compatibility checks, and tenant migration path remain unimplemented.

Verification:

```sh
git diff --check
```

## Superseded By Postgres Authority

Previous completed checkpoint: `e80e176` Plan Postgres executor package
boundaries.

The table-kind/shard API in this file is now historical DO-authoritative design
work. For the Postgres-authoritative path, public schema should move back
toward Convex-style `defineTable(...)` for normal app tables:

```ts
export default defineSchema({
  users: defineTable({
    name: v.string(),
  }),
});
```

Do not continue expanding `definePartitionTable`, `defineColocatedTable`,
`defineGlobalTable`, generated `model`, or `partition: model.table` as the
default developer model. Any remaining placement metadata should become
internal cache/routing/projection policy, not the authoritative transaction
API.

Implementation history below is retained because it explains the current code
and migration debt.

Verification:

```sh
git diff --check
```

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

## Explicit Placement Constructor Cleanup

Previous completed checkpoint: `75b84c8` Remove direct deployment metadata
routes.

The schema placement API is now centered on explicit constructors:

```ts
definePartitionTable({ name: v.string() });
defineColocatedTable("users", "userId", { userId: v.id("users") });
defineGlobalTable({ message: v.string() });
```

The old public chain placement methods were removed from `TableDefinition`:

- `.partitionBy(...)`
- `.colocateWith(...)`
- `.global()`

This records the current design choice: partition roots are `_id` roots for
now. Natural-key partition roots such as `partitionBy("slug")` stay out of the
public API until we have a stronger uniqueness and routing story.

Convex references:

- `crates/common/src/schemas/mod.rs`
  schema metadata is authoritative backend validation input.
- `crates/value/src/document_id.rs`
  document ids carry table identity.
- `crates/database/src/transaction.rs`
  writes are validated against active schema and transaction state.

Cloudflare difference: Convex can preserve a simpler `defineTable(...)`
mental model because one logical database owns OCC. Flarex needs table
placement to be explicit because it decides which `PartitionDO` owns writes.

Remaining limitations:

- Backend deployment metadata still has a compatibility `route` field that is
  now always emitted as `null` by dev analysis.
- Cross-shard mutation ergonomics remain a separate roadmap item; this cleanup
  only hardens the single-shard/root-placement public API.
- Plain unplaced `defineTable(...)` remains available as a low-level schema
  building block, but app-facing placement examples should use the explicit
  constructors.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
```
