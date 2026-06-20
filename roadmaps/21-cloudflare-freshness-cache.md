# Cloudflare Freshness Cache

## Decision

Cloudflare cache layers are part of the future Postgres-authoritative design,
but they are not the source of truth.

```txt
Postgres
  authoritative document/index/commit/outbox storage

Cloudflare
  WebSocket sessions
  freshness mirrors
  hot document caches
  shared query result caches
  fanout
```

The cache layer exists to reduce executor/Postgres read pressure and make
live-query fanout efficient. It must be rebuildable from Postgres commit/outbox
state and must never be used as the authoritative write path.

## Layer Roles

### ConnectionDO

Owns a client WebSocket session:

- query-set version state,
- mapping from client query IDs to canonical query keys,
- sending Convex-style transitions,
- mutation response ordering,
- auth/session state.

`ConnectionDO` should not own authoritative documents.

### VersionDO

Replicates freshness metadata from committed Postgres outbox events:

```txt
document version:
  deploymentId + tableId + documentId -> latestCommitVersion

range version:
  deploymentId + indexId + rangeKey -> latestCommitVersion

table version:
  deploymentId + tableId -> latestCommitVersion
```

Use it to answer:

```txt
Can this cached/query result be published as fresh through commitVersion N?
```

VersionDO detects staleness. It does not repair stale results by itself.

### DocCacheDO

Stores hot replicated row images keyed by deployment/table/document:

```txt
deploymentId + tableId + documentId
  -> { commitVersion, jsonValue, deleted }
```

Use it for:

- hot `ctx.db.get(id)` query reruns,
- fanout after common document writes,
- avoiding Postgres round trips when VersionDO proves the row image is fresh.

The cache must be replayable from Postgres outbox events. Missing or stale rows
fall back to the executor/no-cache query path.

### QueryCacheDO

Stores canonical shared query results:

```txt
deploymentId + functionPath + canonicalArgsHash
  -> {
       result,
       resultHash,
       observedCommitVersion,
       readDependencies
     }
```

Use it to deduplicate reruns when many clients subscribe to the same query.
`ConnectionDO` subscribers should point at a canonical query entry instead of
each running the same query independently.

QueryCacheDO is the hardest layer because range freshness can be invalidated by
documents that are not present in the returned result.

## Hyperdrive Rule

Hyperdrive can accelerate ordinary/cold reads, but it is not a correctness
source for live queries.

For live queries:

```txt
Hyperdrive result + observed versions + VersionDO check
  -> publish only if fresh enough
  -> otherwise retry no-cache, use DocCacheDO, or rebuild QueryCacheDO
```

This rule prevents a stale cached result from being emitted as the latest live
state.

## Outbox Dependency

The cache layer depends on Postgres transactions writing outbox/change rows in
the same transaction as document and index changes:

```txt
BEGIN;
  validate read set;
  write documents;
  write index entries;
  write commit row;
  write outbox rows;
COMMIT;
```

Outbox events must include enough data to update freshness mirrors:

- `deploymentId`,
- `commitVersion`,
- changed table/document IDs,
- index/range dependency hints,
- optional document row images,
- event sequence/idempotency key.

The dispatcher must tolerate duplicate, out-of-order, and delayed events.

## Phasing

Phase 1: no cache correctness dependency.

- Use Postgres executor or no-cache query path for live-query reruns.
- Store commit/outbox rows.
- Keep `ConnectionDO` as socket/session owner.

Phase 2: freshness mirror.

- Add `VersionDO`.
- Apply outbox events into document/table/range version mirrors.
- Live-query reruns publish only when result freshness satisfies the required
  commit version.

Phase 3: hot document cache.

- Add `DocCacheDO`.
- Replicate row images for hot documents.
- Serve simple get-by-id reruns from Cloudflare when version checks pass.

Phase 4: shared query cache.

- Add `QueryCacheDO`.
- Canonicalize query keys.
- Deduplicate reruns and fan out one fresh result to many `ConnectionDO`
  subscribers.

Phase 5: Hyperdrive optimization.

- Allow selected one-shot and cold read paths to use Hyperdrive.
- For live queries, require VersionDO freshness proof before publishing.

## Current Repo Impact

Keep:

- `ConnectionDO` concepts and WebSocket/query-set tests,
- Convex-style sync protocol message names,
- result hashing/dedup ideas.

Replace:

- `PartitionDO` read-set registration,
- same-partition rerun logic,
- client-visible `partitionKey` routing.

Do not build `VersionDO`, `DocCacheDO`, or `QueryCacheDO` before the Postgres
executor can write commit/outbox records. Freshness mirrors need a durable
commit stream first. The first commit outbox writer now exists, but no
Cloudflare-side consumer has been built yet.

## Convex References

- `crates/database/src/subscription.rs`
  - read-set subscription invalidation.
- `crates/database/src/write_log.rs`
  - committed write-log freshness and token refresh.
- `crates/sync/src/worker.rs`
  - query-set modification, mutation queueing, and transition emission.
- `crates/sync/src/state.rs`
  - active subscription state model.

## Flarex Differences

- Convex keeps function execution, database reads, write log, and sync workers
  close together.
- Flarex separates Cloudflare WebSockets/caches from a trusted Postgres
  executor, so live-query freshness must be proven through explicit versions.
- Cloudflare cache DOs reduce load and fanout cost but are not authoritative.

## Known Limitations

- A Postgres commit outbox writer exists, but no dispatcher or Cloudflare cache
  mirror consumes it yet.
- No cache DOs exist yet.
- Range freshness representation is still open.
- QueryCacheDO invalidation can become expensive without careful canonical
  query keys and range dependency encoding.
- Hyperdrive can be useful but cannot by itself prove freshness.

## Checkpoint

Previous completed checkpoint: `74d8b74` Align docs with Postgres executor
pivot.

What changed:

- Promoted the cache/freshness layer from design-note-only to a dedicated
  roadmap domain.
- Defined VersionDO, DocCacheDO, QueryCacheDO, and ConnectionDO roles.
- Recorded that cache work must wait for Postgres commit/outbox support.

Verification:

```sh
git diff --check
```

## Commit Outbox Prerequisite

Previous completed checkpoint: `c71110d` Expose ctx db replace.

What changed:

- The Postgres executor now writes one commit outbox event per successful
  mutation commit.
- The event includes the committed timestamp, changed document ids, changed
  table ids, and write summary needed by future freshness mirrors.

Cache impact:

This unblocks the next cache/freshness implementation step: a worker or DO can
page `outbox` events and update version mirrors. It does not make cached query
results fresh by itself.

Convex references:

- `crates/database/src/write_log.rs`
  - committed freshness tokens come from a durable write log.
- `crates/database/src/subscription.rs`
  - subscription invalidation is driven by committed write metadata.

Flarex differences:

- Flarex needs a replayable Postgres outbox because cache and WebSocket logic
  will live in Cloudflare, away from the trusted executor process.

Known limitations:

- No dispatcher has been implemented.
- `delivered_at` is not used yet.
- Query-range freshness still needs a compact invalidation representation.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```
