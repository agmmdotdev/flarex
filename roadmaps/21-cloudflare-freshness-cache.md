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

## Read-Set Freshness Checker

Previous completed checkpoint: `3913b02` Add freshness delivery handler.

What changed:

- Added `checkReadSetFreshness(...)` to `@flarex/freshness`.
- The checker compares document and table read dependencies against the
  freshness mirror:
  - document reads are fresh when the document version is `<= observedTs`,
  - table reads are fresh when the table version is `<= observedTs`, and
  - missing-document reads with `observedTs: null` become stale after a later
    document freshness version exists.
- Index/range dependencies return explicit `unsupported` results for now.
- Added tests for fresh read sets, stale document/table read sets,
  missing-document reads, unsupported index reads, and durable Postgres-backed
  checks.

Cache impact:

This is the first reusable invalidation primitive for live query reruns:

```txt
query readSet
  -> durable freshness mirror
  -> fresh | stale | unsupported
```

Cached/live query code can now decide whether a document/table read set needs a
rerun. Index/range reads still require a future freshness representation.

Convex references:

- `crates/database/src/subscription.rs`
  - subscription invalidation compares read dependencies with committed writes.
- `crates/sync/src/worker.rs`
  - sync workers rerun or update queries after dependency invalidation.
- `crates/database/src/write_log.rs`
  - write-log entries provide committed freshness.

Flarex differences:

- Convex's dependency invalidation is internal to its database/sync machinery.
  Flarex exposes a package-level checker because cached query execution and
  sync fanout will run across separate components.

Known limitations:

- Index/range freshness is unsupported.
- No live query scheduler or `ConnectionDO` consumes the checker yet.
- This checker reports invalidation state; it does not rerun user queries.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Executor Read-Set Freshness Adapter

Previous completed checkpoint: `bd78a7b` Add read-set freshness checker.

What changed:

- Added `readSetToFreshnessReadSet(...)` to `@flarex/freshness`.
- The adapter turns executor-shaped read dependencies into freshness read
  dependencies by attaching a default observed timestamp.
- It preserves per-read `observedTs` when present, including `null` for
  missing-document reads.
- Added tests proving conversion and freshness checking of converted read sets.

Cache impact:

Cloudflare cache/live-query code can now store this compact state for a query:

```txt
function path + args + result + readSet + beginTs
```

Then it can convert the read set and ask the freshness mirror whether the saved
result is still usable. This is still a validity check only; cache code must
rerun user queries before publishing stale results.

Convex references:

- `crates/database/src/subscription.rs`
  - read dependencies drive invalidation.
- `crates/sync/src/worker.rs`
  - invalidated queries are rerun before client transitions are published.

Flarex differences:

- Convex stores read dependency freshness inside one backend. Flarex exposes a
  conversion helper because Cloudflare cache/fanout code will consume executor
  output across package/runtime boundaries.

Known limitations:

- No `QueryCacheDO`, scheduler, or `ConnectionDO` consumes the helper yet.
- Index/range reads still convert to an unsupported freshness dependency.
- Public executor read sets need the query `beginTs` attached by the future
  live-query registry.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Durable Live-Query Registry

Previous completed checkpoint: `7eee662` Add executor read-set freshness adapter.

What changed:

- Added durable `live_query_subscriptions` rows in Postgres.
- Each subscription records:
  - deployment id,
  - connection id,
  - query id,
  - function path and args,
  - query begin timestamp,
  - timestamped read set,
  - last result and result hash.
- Added persistence helpers and PGlite tests.

Cache impact:

The freshness/cache path now has durable query state to inspect:

```txt
live query registry
  -> readSetToFreshnessReadSet(...)
  -> checkReadSetFreshness(...)
  -> rerun stale query later
```

This does not make the cache live yet, but it gives the future scheduler a
durable source of subscriptions to evaluate.

Convex references:

- `crates/sync/src/worker.rs`
  - active query state drives client transitions.
- `crates/database/src/subscription.rs`
  - read dependency state drives invalidation.

Flarex differences:

- Convex stores this inside its integrated sync backend. Flarex persists it in
  Postgres because Cloudflare `ConnectionDO`/future cache workers and the
  trusted executor are split.

Known limitations:

- No Cloudflare `ConnectionDO` writes registry rows yet.
- No scheduler checks registry rows against freshness yet.
- Result hashes are stored, but no rerun path uses them for transition
  suppression yet.
- Index/range freshness remains unsupported.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
git diff --check
```

## Executor Live-Query Registry Writer

Previous completed checkpoint: `f32cc4f` Add durable live query registry.

What changed:

- Added executor helpers to record and remove live-query subscription rows.
- Recording stores a timestamped freshness read set, last result, and stable
  result fingerprint.
- The result fingerprint uses stable JSON key ordering, matching the legacy
  Cloudflare sync prototype.

Cache impact:

The future freshness scheduler now has the expected write-side API:

```txt
query finished
  -> recordLiveQuerySubscription(...)
  -> live_query_subscriptions
  -> future freshness scan and rerun
```

This keeps the cache/sync layer from needing to know how to normalize read sets
or fingerprint results.

Convex references:

- `crates/sync/src/worker.rs`
  - active query state is updated after query execution and rerun.
- `crates/database/src/subscription.rs`
  - read dependency state is tied to query validity.

Flarex differences:

- Convex keeps active query state internal. Flarex writes explicit durable rows
  so Cloudflare connection/session owners and the trusted executor can hand off
  sync work cleanly.

Known limitations:

- No cache scheduler scans `live_query_subscriptions` yet.
- No `ConnectionDO` calls the writer yet.
- No result-hash comparison is used to suppress future transitions yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Durable Freshness Delivery Handler

Previous completed checkpoint: `f0fd56f` Add durable freshness store.

What changed:

- Added `createFreshnessDeliveryHandler(store)` in `@flarex/freshness`.
- Added `createPostgresFreshnessDeliveryHandler(persistence)` for the durable
  Postgres/PGlite-backed freshness store.
- Updated executor pipeline tests to use the reusable handler for the normal
  projection path.
- Added freshness package tests for memory and Postgres delivery handlers.

Cache impact:

The production composition is now a reusable function:

```ts
await executor.runOutboxDeliveryBatch({
  deploymentId,
  deliver: async (events) => {
    await createPostgresFreshnessDeliveryHandler(persistence)(events);
  },
});
```

The executor still owns outbox acknowledgement. The freshness package owns
projection into the durable mirror. This keeps the boundary explicit while
removing duplicated handler code from future schedulers.

Convex references:

- `crates/sync/src/worker.rs`
  - worker logic composes committed changes with downstream update handling.
- `crates/database/src/write_log.rs`
  - committed write metadata is the durable input.

Flarex differences:

- Convex does not need an exported delivery handler because its worker runs
  inside the backend. Flarex exposes this composition helper because schedulers,
  Nitro routes, or Cloudflare workers may invoke the dispatcher.

Known limitations:

- No scheduler/Nitro route calls this helper yet.
- No range/index freshness is represented.
- No query rerun or `ConnectionDO` fanout consumes the durable versions yet.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Durable Postgres Freshness Store

Previous completed checkpoint: `0f896fd` Test outbox freshness pipeline.

What changed:

- Added Postgres/PGlite freshness tables through Drizzle migration
  `0007_moaning_whizzer.sql`:
  - `freshness_processed_events`,
  - `document_freshness_versions`, and
  - `table_freshness_versions`.
- Added `applyFreshnessCommit(...)` to `@flarex/persistence-postgres`.
  It inserts the processed outbox event key and updates document/table versions
  inside one transaction.
- Added getters for processed event, document freshness, and table freshness.
- Added `PostgresFreshnessMirrorStore` in `@flarex/freshness`, implementing
  the existing `FreshnessMirrorStore` interface over the durable persistence
  API.
- Added PGlite tests proving durable idempotency and non-regression.
- Added freshness package tests proving the projector works against durable
  PGlite-backed storage and skips replays across store instances.

Cache impact:

The freshness mirror is no longer memory-only. The correctness reference path
is now:

```txt
outbox event
  -> runOutboxDeliveryBatch(...)
  -> applyOutboxEventsToFreshnessMirror(...)
  -> PostgresFreshnessMirrorStore
  -> durable document/table freshness versions
```

This makes process restarts and replay recovery testable before adding
Cloudflare-specific mirror storage.

Convex references:

- `crates/database/src/write_log.rs`
  - committed write metadata is durable and replayable.
- `crates/database/src/subscription.rs`
  - read dependencies compare against committed write metadata.
- `crates/sync/src/worker.rs`
  - sync workers consume committed changes and update client-visible state.

Flarex differences:

- Convex keeps this inside its backend write-log/subscription machinery.
  Flarex persists explicit freshness projection tables because the Postgres
  executor and Cloudflare freshness/cache layers are separate components.

Known limitations:

- Only document and whole-table freshness are durable.
- Range/index freshness is still not represented.
- No query rerun, minimum-freshness check, or `ConnectionDO` fanout uses these
  durable versions yet.
- No Cloudflare DO/D1 freshness mirror exists yet; Postgres/PGlite is the
  correctness reference.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Outbox To Freshness Pipeline Test

Previous completed checkpoint: `97d0f0f` Add freshness mirror projector.

What changed:

- Added `@flarex/freshness` as a test-time dependency of `@flarex/executor`.
- Added executor tests that compose:

```txt
runOutboxDeliveryBatch(...)
  -> applyOutboxEventsToFreshnessMirror(...)
  -> markOutboxEventsDelivered(...)
```

- Proved a successful dispatch updates the in-memory freshness mirror and then
  hides the event from undelivered outbox batches.
- Proved at-least-once replay safety when projection succeeds but the delivery
  handler crashes before acknowledgement: the event remains undelivered,
  reruns, the projector skips the already processed event key, and the
  dispatcher then marks it delivered.

Cache impact:

The in-process pipeline now proves the intended freshness handoff semantics.
The next cache/freshness step can focus on durable mirror storage instead of
the correctness of dispatcher/projector composition.

Convex references:

- `crates/database/src/write_log.rs`
  - committed write metadata feeds downstream freshness.
- `crates/database/src/subscription.rs`
  - subscription invalidation must tolerate committed changes being processed
    by worker loops.
- `crates/sync/src/worker.rs`
  - sync workers process committed changes into client-visible transitions.

Flarex differences:

- Convex does not need this explicit test seam because the write-log and sync
  worker are internal backend components. Flarex has a runtime handoff from
  Postgres executor to freshness/cache components, so the at-least-once replay
  behavior must be tested explicitly.

Known limitations:

- This is still an in-memory test pipeline, not durable storage.
- No range/index freshness representation exists yet.
- No query rerun, cache minimum-freshness check, or `ConnectionDO` fanout uses
  these versions yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Freshness Mirror Projector Core

Previous completed checkpoint: `5526aa2` Add outbox dispatcher core.

What changed:

- Added a new framework-neutral `@flarex/freshness` package.
- Added `applyOutboxEventsToFreshnessMirror(...)`, which converts committed
  outbox events into document and table freshness versions.
- Added `FreshnessMirrorStore` with one atomic method,
  `applyCommitFreshness(...)`, so idempotency and version updates are owned by
  the mirror store.
- Added `MemoryFreshnessMirrorStore` for tests and local simulation.
- The in-memory store tracks:
  - processed event keys: `(deploymentId, ts, sequence)`,
  - document versions: `(deploymentId, documentId) -> commitTs`, and
  - table versions: `(deploymentId, tableId) -> commitTs`.
- Added event-shape validation through `FreshnessOutboxEventShapeError`.
- Added tests for applying versions, replay idempotency, non-regression when
  older events arrive later, and malformed event rejection.

Cache impact:

This is the first real delivery target for the outbox dispatcher. The intended
composition is now:

```txt
runOutboxDeliveryBatch({
  deliver(events) {
    return applyOutboxEventsToFreshnessMirror({ store, events });
  }
})
```

That gives Flarex the beginning of a freshness proof source for cached reads
and live-query reruns. The projector currently records document/table versions
only; range/index freshness still needs its own representation.

Convex references:

- `crates/database/src/write_log.rs`
  - committed write metadata is the durable source for freshness.
- `crates/database/src/subscription.rs`
  - subscriptions compare read dependencies against committed writes.
- `crates/sync/src/worker.rs`
  - sync workers consume committed changes and publish updates.

Flarex differences:

- Convex keeps write-log, freshness, and sync machinery inside its backend.
  Flarex splits them: Postgres commits write outbox events, executor dispatches
  those events, and `@flarex/freshness` projects them into a mirror that can
  later live in Cloudflare DO/D1/SQLite storage.
- The first store is in-memory only. It proves semantics, not durability.
- At-least-once delivery means store implementations must treat
  `(deploymentId, ts, sequence)` as the idempotency key.

Known limitations:

- No durable freshness store exists yet.
- No range/index freshness representation exists yet.
- No query rerun, cache minimum-freshness check, or `ConnectionDO` fanout uses
  these versions yet.
- No integration test wires `runOutboxDeliveryBatch(...)` to the projector yet.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Outbox Dispatcher Prerequisite

Previous completed checkpoint: `2683fe0` Add outbox delivery primitives.

What changed:

- Added `runOutboxDeliveryBatch(...)` in `@flarex/executor`.
- The batch runner accepts an injected delivery handler so cache/freshness code
  can apply outbox events without owning acknowledgement details.
- Events are marked delivered only after the handler succeeds.

Cache impact:

The future freshness mirror can now be implemented as the injected handler:

```txt
outbox batch
  -> update document/table/range version mirror
  -> acknowledge batch
```

This gives the cache layer at-least-once event application. Mirror updates must
therefore be idempotent by event key: `(deploymentId, ts, sequence)`.

Convex references:

- `crates/database/src/write_log.rs`
  - durable committed write information is the source of freshness.
- `crates/database/src/subscription.rs`
  - committed write metadata invalidates subscriptions.

Flarex differences:

- Convex's backend can apply freshness invalidation directly from its internal
  write log. Flarex needs an explicit dispatcher because the freshness mirror
  will live outside the trusted Postgres transaction executor.

Known limitations:

- No freshness mirror tables/DOs exist yet.
- No query-result minimum freshness protocol is implemented yet.
- No multi-dispatcher claim/lease protocol exists yet.
- Coarse event payloads still need conversion into precise range/table/document
  versions.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Outbox Delivery Prerequisite

Previous completed checkpoint: `b4f98a4` Write commit outbox events.

What changed:

- The executor can now list undelivered Postgres outbox events and mark them
  delivered after a consumer applies them.
- The implementation uses the existing `outbox.delivered_at` field and keeps
  full outbox history visible through `listOutboxEvents(...)`.
- The delivery API is exposed through the executor, not only the raw Postgres
  persistence package.

Cache impact:

This gives a future Cloudflare freshness/cache updater a minimal durable loop:

```txt
page undelivered commit events
  -> update document/table/range version mirrors
  -> mark delivered
```

The updater itself is not implemented yet. Cached query freshness is still not
proved until events are applied into version mirrors and query reruns require a
minimum freshness token.

Convex references:

- `crates/database/src/write_log.rs`
  - committed write metadata is the durable freshness source.
- `crates/database/src/subscription.rs`
  - subscription invalidation uses committed write information.

Flarex differences:

- Convex does not need a separate `delivered_at` acknowledgement for cache
  freshness because the write-log and sync/cache invalidation workers are part
  of the backend. Flarex needs an explicit handoff between Postgres executor
  and Cloudflare freshness/cache workers.

Known limitations:

- No freshness mirror or dispatcher exists yet.
- No multi-worker claim/lease protocol exists yet.
- Query-range freshness still needs compact invalidation metadata.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
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
