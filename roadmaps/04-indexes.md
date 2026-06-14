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
