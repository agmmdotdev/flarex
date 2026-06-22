# Indexes

## Current Decision

Indexes are part of the shard-local authoritative database. A document write
must produce index delete entries for the previous value and index insert
entries for the new value.

## Implemented So Far

`PartitionDO` stores:

- `indexes`
- `index_entries`
- `current_index_entries`

On write:

- old index entries are tombstoned in `index_entries`
- old current entries are removed
- new index entries are inserted
- new current entries are upserted
- index writes are copied into `write_log` for OCC checks

Invoke now syncs the target `PartitionDO` schema cache before transaction
begin, so index definitions from `DeploymentDO` are present when mutation
writes commit.

## Convex References

- `crates/common/src/types/index.rs`
  Index definitions and index update shape.
- `crates/database/src/committer.rs`
  `compute_writes` calculates document and index writes together.
- `crates/database/src/reads.rs`
  Indexed read intervals are used for OCC overlap checks.
- `crates/database/src/write_log.rs`
  Write log stores writes by index for efficient stale-read detection.

## Cloudflare Difference

Convex stores binary ordered index keys. Flarex encodes ordered bytes as
lowercase hexadecimal text so SQLite's binary `TEXT` collation preserves byte
ordering while DO requests and write logs remain easy to serialize.

## Known Limitations

- Need reactive pagination page-splitting semantics and query planner behavior.
- Need staged/backfilled index states before production schema changes.
- The codec currently covers JSON-compatible values. Convex `int64`, binary
  bytes, and exact cross-runtime value compatibility still need work.
- Index codec changes require rebuilding existing index entries. Schema
  deployment does not automate that migration yet.
- The generated standalone Worker currently evaluates index predicates through
  a table scan; it preserves API semantics for the prototype but is not the
  authoritative indexed/OCC execution path.

## Last Update

Added Convex-style named index queries:

```ts
await ctx.db
  .query("lessonProgress")
  .withIndex("by_user_lesson", q =>
    q.eq("userId", userId).eq("lessonId", lessonId),
  )
  .collect();
```

The SDK types index names, index field order, equality values, and returned
documents from the generated data model. It provides `collect`, `take`,
`first`, and `unique` consumers.

The authoritative invoke layer now resolves `{tableName, indexName}` through
`DeploymentDO` schema metadata, converts the range into ordered half-open
bounds, and calls `SingleShardTransaction.queryIndex`.
That preserves index read-set recording and OCC overlap validation. Tests now
assert the named query produces the expected `IndexRead`.

Supported in this slice:

- whole-index reads using `.withIndex(name)`
- equality prefixes in index-field order
- `gt`, `gte`, `lt`, and `lte` on the field after the equality prefix
- `collect`, `take`, `first`, and `unique`

Intentionally rejected for now:

- table scans on the authoritative backend
- staged or disabled indexes

Convex references:

- `npm-packages/convex/src/server/database.ts`
- `npm-packages/convex/src/server/query.ts`
- `npm-packages/convex/src/server/index_range_builder.ts`
- `crates/database/src/reads.rs`
- `crates/database/src/transaction.rs`

## Colocated Query Placement Update

Root tables using `partitionBy(field)` now follow the same owner-field query
rule as colocated tables when `field !== "_id"`.

Checkpoint title: `Enforce partitionBy field ownership`

Previous completed checkpoint: `9e60c33` Require colocated query placement
equality.

For a table declared as:

```ts
cartItems: defineTable({
  cartId: v.string(),
  sku: v.string(),
}).partitionBy("cartId")
```

index reads must constrain the owner field:

```ts
ctx.db
  .query("cartItems")
  .withIndex("by_cart_sku", q => q.eq("cartId", cartId).eq("sku", sku))
```

Reads that use only a secondary field are rejected:

```ts
ctx.db.query("cartItems").withIndex("by_sku", q => q.eq("sku", sku));
```

Convex references:

- `npm-packages/convex/src/server/index_range_builder.ts`
- `crates/common/src/query.rs`
- `crates/database/src/reads.rs`

Cloudflare difference:

- Convex indexes are deployment-wide. Flarex owner-field indexes must be
  queried through the selected shard owner because the backend talks to one
  `PartitionDO`.

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

Colocated table index reads now require a placement-field equality before the
query reaches `PartitionDO`.

Checkpoint title: `Require colocated query placement equality`

Previous completed checkpoint: `3326e3f` Enforce colocated placement at
commit.

For a table declared as:

```ts
scores: defineTable({
  userId: v.id("users"),
  score: v.number(),
}).colocateWith("users", "userId")
```

this is valid inside a transaction routed to `partitionKey === userId`:

```ts
ctx.db
  .query("scores")
  .withIndex("by_user_score", q => q.eq("userId", userId).eq("score", 10))
  .collect();
```

These are rejected:

```ts
ctx.db.query("scores").withIndex("by_score", q => q.eq("score", 10));
ctx.db.query("scores").withIndex("by_user_score", q => q.eq("userId", otherUserId));
```

Convex references:

- `npm-packages/convex/src/server/index_range_builder.ts`
  - range builders preserve equality/inequality expression structure.
- `crates/common/src/query.rs`
  - index ranges are compiled from structured equality prefixes.
- `crates/database/src/reads.rs`
  - read sets track indexed intervals for transaction validation.

Cloudflare difference:

- Convex index reads are deployment-wide. Flarex colocated index reads must be
  owner-scoped because the target `PartitionDO` represents only one shard.

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

Cloudflare difference: Flarex resolves names at the Worker/invoke boundary,
then sends the numeric index ID and encoded range to the target `PartitionDO`.
The generated standalone Worker currently scans its local SQLite table as a
prototype fallback. Production execution must use the authoritative invoke/OCC
path rather than treating that scan implementation as the final index engine.

## Ordered Tuple And Range Update

Replaced JSON-string keys with an ordered tuple codec inspired by
`crates/value/src/sorting.rs`:

- ordered value type tags
- sortable IEEE-754 float encoding
- UTF-8 strings with escaped null terminators
- self-delimiting arrays and objects
- a distinct missing-field value
- lowercase hexadecimal storage preserving byte order

Authoritative reads now use half-open intervals, `[lower, upper)`. The range
compiler follows `crates/common/src/query.rs`: equalities form a prefix and an
optional inequality on the next field becomes lower and upper bounds.
`PartitionDO` SQL and OCC write-log checks use the same bounds.

Tests prove numeric and compound tuple ordering, prefix and inequality range
behavior, named invoke range execution, and an OCC conflict when a concurrent
insert enters a mutation's previously read index prefix.

## Stable Cursor Pagination Update

Authoritative index keys now append the document ID after declared index
fields, matching Convex's `IndexKey` shape in `crates/common/src/index.rs`:

```txt
(indexedField1, indexedField2, ..., documentId)
```

This gives every index row a unique total order even when many documents have
identical indexed values.

Added:

- `.order("asc" | "desc")`
- `.paginate({ numItems, cursor })`
- `paginationOptsValidator`
- opaque hexadecimal index-key cursors
- strict cursor advancement after the last returned key
- `numItems + 1` reads to compute `isDone`
- ascending and descending duplicate-key pagination tests

`PartitionDO` returns each document with its authoritative index key, and
`SingleShardTransaction.queryIndexPage` exposes the page plus
`continueCursor`. Paginated reads conservatively record the full requested
index interval in the OCC read set, preserving correctness at the cost of
potentially more conflicts.

This follows Convex references:

- `crates/common/src/index.rs`
- `crates/common/src/query.rs`
- `crates/database/src/query/index_range.rs`
- `npm-packages/convex/src/server/pagination.ts`

Known differences:

- Flarex cursors currently contain only the ordered key and are not signed or
  bound to a query fingerprint. Reusing a cursor with a different query is not
  yet rejected.
- Reactive page splitting, `endCursor`, `splitCursor`, and page status are not
  implemented.
- Existing indexes must be rebuilt when the key codec changes.

Verified with:

```sh
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend test
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## Postgres Index Freshness Update

Previous completed checkpoint: `ccc5dea` Harden executor sync integration.

What changed:

- Added a Postgres persistence helper that checks whether any durable index
  entry changed after a subscription's observed timestamp.
- Reused the existing ordered index key range bounds instead of introducing a
  parallel freshness key codec.
- Indexed query syscalls now also record returned documents with exact
  `observedTs` values so non-index-field updates to returned rows invalidate
  live queries and mutation read sets.
- Added durable PGlite coverage proving an indexed read set becomes stale only
  when a changed index entry falls inside the subscribed range.

Why it changed:

The local `/sync` executor integration was previously forced through a
table-scan query because index/range freshness was still unsupported. Real
Convex-style apps use `.withIndex(...)` for ordinary list queries, so the
Postgres executor must classify those subscriptions precisely.

Convex references inspected:

- `crates/database/src/reads.rs`
  - `ReadSet` tracks indexed intervals and checks whether committed index
    writes overlap those intervals.
- `crates/database/src/query/index_range.rs`
  - range query execution records the consumed index interval into the
    transaction read set.

Flarex differences:

- Convex keeps subscription invalidation inside the integrated backend read-set
  and write-log machinery. Flarex's Postgres path persists index history and
  asks that history whether an index range changed after the subscription's
  observed timestamp.
- Flarex explicitly combines an index range dependency for membership changes
  with document dependencies for returned-row content changes.
- Memory-only freshness stores still report index reads as unsupported because
  they do not hold durable index-write history.

Known limitations:

- The Postgres helper currently scans candidate index rows in process after a
  timestamp/index filter. It is correct for PGlite and early Postgres work, but
  production needs a tighter SQL range predicate over encoded key bytes.
- Search/vector freshness is still not implemented.
- Paginated query subscriptions conservatively depend on the requested range,
  not a narrower page-specific invalidation model.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor exec vitest run test/sessions.test.ts test/liveQueries.test.ts --testTimeout=30000
```
