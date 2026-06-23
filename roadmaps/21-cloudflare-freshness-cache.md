# Cloudflare Freshness Cache

## DeliveryDO Wake And Bounded Drain

Previous completed checkpoint: `f12a7d2` Add live query delivery claim ack APIs.

What changed:

- Added Cloudflare `DeliveryDO` in `packages/flarex-backend`.
- Added deterministic DO binding/name:
  - binding: `DELIVERIES`
  - object name: `delivery:{deploymentId}`
- Added backend route:
  `POST /deployments/:deploymentId/sync/wake-delivery`.
- `DeliveryDO` now performs a bounded drain:
  - claim rows from the injected executor endpoint,
  - fanout materialized payloads to `ConnectionDO`,
  - ack row IDs through the injected executor endpoint,
  - stop after `maxBatches` or when `hasMore` is false.
- Executor injection is config-based:
  - `FLAREX_EXECUTOR` service binding when present,
  - otherwise `FLAREX_EXECUTOR_URL`,
  - optional `FLAREX_EXECUTOR_TOKEN` bearer auth.
- Added Miniflare coverage proving wake -> claim -> fanout -> ack with an
  active WebSocket subscription.

Why it changed:

This moves the delivery loop owner to Cloudflare without giving Cloudflare
Postgres access. `DeliveryDO` is the runtime worker close to `ConnectionDO`,
while the executor remains authoritative for claim/ack state.

Convex references inspected:

- `crates/sync/src/worker.rs`
  - sync worker bounds transition production and owns send-side fanout.
- `crates/sync/src/state.rs`
  - sync state owns result-hash transition dedupe.

Flarex differences:

- Convex keeps this inside its backend sync worker. Flarex uses an injected
  executor boundary because the trusted Postgres executor can live on
  Nitro/Vercel while client connections live on Cloudflare.
- This first `DeliveryDO` does not schedule alarms or queues yet. A wake
  request drains only the configured bounded batch budget.

Known limitations:

- No automatic alarm/queue continuation when `hasMore` remains true.
- No claim leases/visibility timeout yet.
- No fallback scanner that wakes deployments with old undelivered rows.
- Error/log/journal delivery payloads are still not implemented.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- sync.test.ts
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend build
```

## DeliveryDO Executor Contract Ready

Previous completed checkpoint: `e4ddeca` Plan DeliveryDO live query fanout.

What changed:

- Added the executor-side claim/ack contract that `DeliveryDO` will consume:
  - `POST /maintenance/live-queries/claim`
  - `POST /maintenance/live-queries/ack`
- The contract is platform-agnostic and available through Nitro/HTTP.

Cloudflare implication:

`DeliveryDO` should be implemented as a Cloudflare-specific consumer of this
contract. It should inject executor URL/token configuration and should not
import executor internals or own Postgres access.

Next Cloudflare step:

1. Add `DeliveryDO` class and `DELIVERIES` binding.
2. Add `POST /deployments/:deploymentId/sync/wake-delivery`.
3. In `DeliveryDO`, call claim -> fanout to `ConnectionDO` -> ack.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http test -- http.test.ts
corepack pnpm --filter @flarex/executor-nitro test -- health.test.ts
```

## DeliveryDO Fanout Worker

Previous completed checkpoint: `3288183` Wire live query delivery callback
bridge.

Decision:

Add a Cloudflare `DeliveryDO` per deployment:

```txt
delivery:{deploymentId}
```

Role:

- receive wake-up notifications from the executor after mutation commits,
- serialize delivery draining for one deployment,
- claim pending `live_query_deliveries` rows from the trusted executor,
- forward materialized query results to named `ConnectionDO` instances,
- ack successfully fanned-out rows through the executor,
- schedule/requeue bounded continuation when `hasMore` remains true.

`DeliveryDO` is not a cache and is not the source of truth. It is the
Cloudflare-side delivery worker that connects durable Postgres outbox state to
active client sessions.

Target flow:

```txt
Postgres commit
  -> live_query_deliveries rows
  -> executor sends wake-up
  -> DeliveryDO claims batch
  -> ConnectionDO emits Transition(QueryUpdated)
  -> DeliveryDO acks batch
```

Why it belongs on Cloudflare:

- fanout is close to active WebSocket/SSE connections,
- per-deployment serialized DO state prevents duplicate concurrent drains,
- Vercel/Nitro avoids loops and high-frequency polling,
- retry work can be bounded and requeued without blocking user requests.

Convex references inspected:

- `crates/sync/src/worker.rs`
  - sync worker owns transition production and send-side backpressure.
- `crates/sync/src/state.rs`
  - result hashes dedupe transition modifications.

Flarex differences:

- Convex does not need a separate `DeliveryDO`; the sync worker is already
  part of the backend. Flarex uses `DeliveryDO` because sync connections live in
  Cloudflare while the trusted executor may live on Vercel/Nitro.

Known limitations:

- No Cloudflare queue/alarm continuation policy has been chosen yet.
- No claim lease/visibility timeout exists yet; v1 can rely on per-deployment
  `DeliveryDO` serialization, but production should add leasing.
- `ConnectionDO` hibernation recovery remains separate work.

First implementation plan:

1. Add executor claim/ack APIs first so `DeliveryDO` does not need the old
   callback-style maintenance route.
2. Add `DeliveryDO` and `DELIVERIES` binding in the Cloudflare backend package.
3. Add `POST /deployments/:deploymentId/sync/wake-delivery`.
4. Implement a bounded drain method with `maxBatches`, `limit`, and has-more
   continuation metadata.
5. Keep fallback manual maintenance route for recovery until alarms/queues are
   wired.

Verification:

```sh
git diff --check
```

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

## Stale Live-Query Scanner

Previous completed checkpoint: `d438453` Add executor live query registry writer.

What changed:

- Added `findStaleLiveQuerySubscriptions(...)`.
- The scanner compares durable live-query rows with a supplied freshness mirror.
- It groups rows as `fresh`, `stale`, or `unsupported`.

Cache impact:

The future cache scheduler can now start from this read-only flow:

```txt
live_query_subscriptions
  -> findStaleLiveQuerySubscriptions(...)
  -> stale rows to rerun later
```

This proves the freshness mirror is usable for subscription invalidation before
we implement query reruns or connection fanout.

Convex references:

- `crates/sync/src/worker.rs`
  - stale query work is driven from active sync state.
- `crates/database/src/subscription.rs`
  - read dependencies are compared against committed writes.

Flarex differences:

- Convex's sync worker owns stale-query discovery internally. Flarex separates
  it because freshness mirrors and live-query registry rows may be consumed by
  Nitro, Cloudflare workers, or tests.

Known limitations:

- No query rerun is performed.
- No result-hash comparison is performed after rerun.
- No Cloudflare `ConnectionDO` notification is performed.
- Index/range reads are still unsupported.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Single Live-Query Rerun Primitive

Previous completed checkpoint: `47bd722` Add stale live query scanner.

What changed:

- Added a single-subscription rerun primitive.
- Rerun refreshes the registry row with the new result and timestamped read set.
- Rerun returns whether the stable result fingerprint changed.

Cache impact:

The future cache scheduler can now use this shape:

```txt
stale row
  -> rerunLiveQuerySubscription(...)
  -> changed | unchanged
```

`changed: false` still matters because the row's read-set freshness is refreshed
even when the client-visible result is identical. `changed: true` is the future
fanout signal.

Convex references:

- `crates/sync/src/worker.rs`
  - reruns stale queries and only emits client-visible updates when needed.
- `crates/database/src/subscription.rs`
  - refreshed query execution updates dependency state.

Flarex differences:

- Convex's rerun worker is integrated with the backend. Flarex keeps execution
  injected so Cloudflare, Nitro, and local test runtimes can share the same
  registry refresh behavior.

Known limitations:

- No scheduler loops over stale rows yet.
- No result fanout is implemented yet.
- No cache layer stores materialized query output outside Postgres yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Batch Stale Live-Query Rerun

Previous completed checkpoint: `d69a73e` Add live query rerun primitive.

What changed:

- Added a batch helper that scans the registry, reruns stale rows, and returns
  changed/unchanged/unsupported buckets.
- Added batch limit support for scheduler-friendly slices.

Cache impact:

The freshness/cache path now has the core loop:

```txt
freshness mirror + live_query_subscriptions
  -> rerun stale rows
  -> changed rows for future fanout
```

`unchanged` rows still refresh their stored read sets and timestamps. `changed`
rows are the future transition/fanout input.

Convex references:

- `crates/sync/src/worker.rs`
  - sync workers process invalidated active queries and emit updates.
- `crates/database/src/subscription.rs`
  - read dependency state drives invalidation.

Flarex differences:

- Convex owns this loop inside the backend. Flarex keeps it as executor core so
  Cloudflare, Nitro, and tests share one implementation while fanout remains
  separate.

Known limitations:

- No fanout or socket delivery exists yet.
- No scheduler invokes the helper yet.
- Index/range subscriptions remain unsupported.

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

## Executor Wake Notification Hook

Previous completed checkpoint: `bd74849` Add DeliveryDO live query fanout.

What changed:

- Added the HTTP/Nitro adapter hook that lets the trusted executor notify
  Cloudflare after durable live-query delivery rows are written.
- Added a reusable backend wake notifier that calls
  `/deployments/:deploymentId/sync/wake-delivery`.
- The wake notifier carries optional `limit` and `maxBatches` controls for the
  DeliveryDO bounded drain.

Freshness/cache impact:

```txt
Postgres freshness marks subscriptions stale
  -> executor reruns stale subscriptions
  -> changed results become durable delivery rows
  -> executor notifies Cloudflare wake route
  -> DeliveryDO drains and fans out
```

This makes the freshness pipeline event-driven for the normal case. The
delivery row remains the source of truth, so a failed wake notification does not
lose the client update.

Convex references:

- `crates/sync/src/worker.rs`
  - backend worker owns query rerun and transition send work.
- `crates/sync/src/state.rs`
  - active query state moves forward after rerun completion.

Flarex differences:

- Convex can call directly across in-process backend components. Flarex uses an
  explicit wake notification because Postgres execution and Cloudflare
  WebSocket fanout are separate deployments.
- The wake notification does not include result payloads. It only asks
  DeliveryDO to claim durable rows from the executor.

Known limitations:

- No Cloudflare Queue, alarm, or background continuation exists yet for
  `hasMore`.
- No periodic reconciler scans undelivered rows if every wake notification
  fails.
- The direct `/deliver-live-query` callback path still exists as a legacy/local
  helper until tests and examples fully move to durable wake delivery.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Stale Rerun Fanout Consumer

Previous completed checkpoint: `0139e0d` Wire live query dead-letter
reconnects.

What changed:

- Cloudflare `SchedulerDO` can now call executor
  `/maintenance/live-queries/rerun`.
- When the executor reports changed stale subscriptions, `SchedulerDO` wakes
  the deployment's `DeliveryDO`.
- `DeliveryDO` uses the existing claim/fanout/ack loop, so changed rerun
  results move through durable delivery rows before reaching WebSocket clients.
- A backend sync test proves the maintenance route produces a `ConnectionDO`
  `Transition` for an active subscribed query.

Freshness impact:

```txt
freshness mirror marks subscription stale
  -> executor reruns stale subscription
  -> executor records changed result as durable live-query delivery
  -> SchedulerDO wakes DeliveryDO
  -> DeliveryDO claims and fans out rows
  -> ConnectionDO sends QueryUpdated Transition
```

This checkpoint closes the previous "changed result fanout is missing" gap for
the manual maintenance path.

Convex references:

- `crates/sync/src/worker.rs`
  - server-side sync schedules query updates and emits transitions.
- `crates/sync/src/state.rs`
  - state tracks invalidated queries, subscriptions, and result hashes.
- `npm-packages/convex/src/browser/sync/client.ts`
  - client sync applies transitions to active query observers.
- `npm-packages/convex/src/browser/sync/remote_query_set.ts`
  - `QueryUpdated` writes the remote query result map.

Flarex differences:

- Convex does not need a separate freshness-cache scheduler route because stale
  reruns happen inside its backend sync worker. Flarex uses an explicit
  executor route and Cloudflare DO drain because storage authority and
  WebSocket fanout are split.
- The Cloudflare consumer does not trust cache revalidation; it trusts executor
  rerun output and durable delivery rows.

Known limitations:

- Automatic cron/alarm scheduling is still not implemented for rerun
  continuation.
- The first consumer handles one bounded call and returns `hasMoreStale`;
  platform automation must call it again later.
- Real Dynamic Worker-hosted query execution is still outside this checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "reruns stale live query subscriptions"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Bounded Stale Rerun Continuation

Previous completed checkpoint: `0386055` Fan out stale live query reruns.

What changed:

- `SchedulerDO` now persists pending rerun state when
  `/maintenance/live-queries/rerun` reports `hasMoreStale`.
- The pending state keeps deployment, project, rerun limit, delivery limit,
  max delivery batches, and retry attempt.
- An alarm and internal continuation route resume the same bounded rerun flow.
- The continuation test proves two bounded stale rerun passes can produce two
  separate WebSocket `Transition` updates without a long-running Worker loop.

Freshness impact:

```txt
stale rerun page reports hasMoreStale
  -> SchedulerDO stores pending rerun
  -> SchedulerDO alarm or internal continue resumes rerun
  -> executor persists changed rows
  -> DeliveryDO drains rows
  -> ConnectionDO sends Transition
```

Convex references:

- `crates/sync/src/worker.rs`
  - Convex schedules query updates after invalidation and query-set changes.
- `crates/sync/src/state.rs`
  - state tracks invalidated queries until rerun/refill completes.
- `npm-packages/convex/src/browser/sync/client.ts`
  - clients receive the resulting transitions through the same sync channel.

Flarex differences:

- Convex's sync worker can keep backend scheduling state in process. Flarex
  must store bounded continuation in Durable Object storage because the
  Cloudflare runtime should not rely on unbounded loops.
- The continuation is still manual/alarm-local. It is not yet triggered by
  freshness projection or commit outbox processing.

Known limitations:

- No commit/freshness trigger automatically wakes this scheduler yet.
- Only one pending stale-rerun continuation is stored per scheduler DO.
- No metrics or operator view exposes retry attempts yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "continues stale live query reruns"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Freshness Trigger Boundary

Previous completed checkpoint: `986442c` Continue stale live query reruns.

What changed:

- Added Cloudflare Worker route
  `POST /scheduler/live-query-subscriptions/trigger`.
- The trigger route accepts the same deployment/project/bounds input as rerun
  maintenance and wakes the bounded `SchedulerDO` stale-rerun flow.
- The focused sync test now proves this trigger route reaches durable delivery
  fanout and produces a WebSocket `Transition`.

Freshness impact:

```txt
future freshness producer sees deployment may be stale
  -> POST /scheduler/live-query-subscriptions/trigger
  -> SchedulerDO bounded rerun
  -> executor records changed delivery rows
  -> DeliveryDO drains rows
  -> ConnectionDO sends Transition
```

Convex references:

- `crates/sync/src/worker.rs`
  - Convex keeps invalidation scheduling inside the backend sync worker.
- `crates/sync/src/state.rs`
  - query invalidation state is internal to the sync runtime.
- `npm-packages/convex/src/browser/sync/client.ts`
  - browser clients only see the resulting transition stream.

Flarex differences:

- Flarex exposes a Cloudflare trigger route because freshness projection,
  executor rerun, and WebSocket fanout are split across runtime boundaries.
- The route does not compute freshness or inspect cache rows. It only starts
  the existing bounded stale-rerun flow.

Known limitations:

- No freshness projector calls this trigger automatically yet.
- The route is still protected by the live-query delivery token, not a separate
  producer-scoped token.
- Per-deployment scheduler naming is still a future scaling concern.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "triggers stale live query reruns"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Trigger Ownership And Recovery Routes

Previous completed checkpoint: `48d7261` Add live query trigger route.

What changed:

- Recorded which Cloudflare freshness/sync routes are hot-path triggers and
  which are recovery/maintenance boundaries.
- Clarified that Cloudflare receives trigger notifications but does not decide
  whether a mutation committed or which writes are authoritative.
- Defined mutation-owned invalidation as the next production wiring step.

Cloudflare route roles:

| Route or worker | Hot path or recovery | Owner | When it fires |
| --- | --- | --- | --- |
| `/scheduler/live-query-subscriptions/trigger` | Hot path | Trusted executor or freshness producer | After post-commit stale subscription state exists |
| `/scheduler/live-query-subscriptions/rerun` | Recovery/manual | Operator/test scheduler | Manual bounded rerun with explicit bounds |
| `SchedulerDO /rerun/live-query-subscriptions` | Internal hot path | Backend Worker | Forwarded from trigger/rerun route |
| `SchedulerDO /continue-live-query-reruns` and alarm | Hot path continuation | `SchedulerDO` | Previous rerun page reported more stale work or retry is needed |
| `/deployments/:deploymentId/sync/wake-delivery` | Hot path | Executor delivery notifier | After durable delivery rows exist |
| `DeliveryDO /wake` | Internal hot path | Backend Worker | Forwarded from wake route |
| `DeliveryDO /continue` and alarm | Hot path continuation | `DeliveryDO` | Previous delivery drain had more rows or retry is needed |
| `/scheduler/live-query-deliveries/reconcile` | Recovery | Cloudflare cron/operator | Pending delivery rows exist but wake notification was lost |
| `/scheduler/live-query-deliveries/dead-letter` | Recovery | Operator/cron policy | Delivery rows are stuck past retry policy |
| `ConnectionDO /deliver/live-query` | Internal fanout | `DeliveryDO` | Claimed delivery rows need to reach active sockets |

Cloudflare must treat trigger notifications as hints backed by durable executor
state:

```txt
trigger can be duplicated
trigger can be delayed
trigger can be lost
durable Postgres subscription/delivery state decides what work exists
```

Why it changed:

The route layer is now broad enough that unclear ownership would create bugs:
premature transitions, lost updates, duplicate fanout, or serverless polling.
The freshness/cache roadmap needs an explicit separation between normal
post-commit triggers and recovery sweeps.

Convex references inspected:

- `crates/sync/src/worker.rs`
  - the backend sync worker owns invalidation and transition scheduling.
- `crates/sync/src/state.rs`
  - sync state tracks invalidated queries and result-hash dedupe.
- `crates/database/src/committer.rs`
  - write publication and subscription-visible write-log data happen after
    commit validation.

Flarex differences:

- Convex has no Cloudflare trigger route because backend sync is integrated.
  Flarex uses explicit Cloudflare boundaries, but durable state remains in the
  trusted executor/Postgres path.
- Cloudflare DOs own scheduling, bounded continuation, and WebSocket proximity;
  they do not own mutation correctness.

Known limitations:

- The trigger route exists, but no freshness projector or mutation commit path
  calls it automatically.
- Cloudflare freshness mirror DOs are still future work; current correctness
  uses executor/Postgres state.
- Reconcile and dead-letter are available, but policy cadence and operator
  controls are still minimal.

First implementation plan:

1. Implement executor-owned stale subscription marking after successful
   mutation commit.
2. Inject a Cloudflare trigger notifier from the host into executor commit
   completion.
3. Keep `SchedulerDO` and `DeliveryDO` duplicate-safe by relying on durable
   stale/delivery rows.
4. Add a no-manual-scheduler integration test for mutation-to-transition.

Verification:

```sh
git diff --check
```

## Executor-Owned Freshness Trigger Hook

Previous completed checkpoint: `5437ca8` Document live query route ownership.

What changed:

- The executor can now apply committed mutation writes to a supplied freshness
  mirror immediately after commit.
- The executor can then call an injected Cloudflare trigger notifier, allowing
  hosts to wake `SchedulerDO` through
  `POST /scheduler/live-query-subscriptions/trigger`.
- `@flarex/executor-http` now exposes
  `createFlarexBackendLiveQueryTriggerNotifier(...)` to build that notifier
  without coupling executor core to Cloudflare.
- Tests prove the freshness mirror marks a table read stale after commit and
  the trigger request carries deployment/project plus bounded rerun controls.

Freshness impact:

```txt
mutation commit writes documents
  -> executor applies document/table freshness versions
  -> executor notifies Cloudflare trigger route
  -> SchedulerDO scans stale subscriptions against freshness
  -> changed reruns become delivery rows
  -> DeliveryDO sends ConnectionDO transitions
```

Convex references inspected:

- `crates/database/src/committer.rs`
  - write-log/subscription-visible metadata is part of successful commit
    publication.
- `crates/sync/src/worker.rs`
  - invalidated queries are backend-scheduled work.
- `crates/sync/src/state.rs`
  - unchanged rerun results are suppressed through result hashes.

Flarex differences:

- Convex does not need a trigger notifier because the sync worker is integrated
  with the backend. Flarex must cross from executor-hosted freshness state to
  Cloudflare-hosted `SchedulerDO`.
- The v1 freshness mark is document/table-level. Range/index freshness is still
  a future cache correctness layer.

Known limitations:

- Trigger notification is best-effort in this checkpoint. If Cloudflare is down
  after commit, the mutation remains committed and the host receives `onError`;
  a durable retry path is still needed.
- This does not build VersionDO, DocCacheDO, or QueryCacheDO. The supplied
  freshness store can be memory/PGlite/Postgres-backed depending on host setup.
- Full mutation-to-WebSocket proof awaits the hosted Dynamic Worker executor
  path. Existing tests cover post-commit trigger ownership and trigger-to-
  WebSocket fanout separately.

Verification:

```sh
corepack pnpm --filter @flarex/executor exec vitest run test/sessions.test.ts test/liveQueries.test.ts
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
```

## Local Durable Freshness Trigger Wiring

Previous completed checkpoint: `730d284` Trigger live query invalidation after
commit.

What changed:

- Local PGlite executor runtime now uses `PostgresFreshnessMirrorStore` backed
  by the same persistence object as the executor.
- Mutation finish through real executor HTTP routes updates durable freshness
  and posts the Cloudflare scheduler trigger route through the injected
  notifier.
- Test coverage proves a missing-document live-query read becomes stale after
  the mutation inserts that document.

Freshness impact:

```txt
PGlite mutation commit
  -> durable document/table freshness rows
  -> Cloudflare trigger notification
  -> later SchedulerDO rerun can classify stale subscriptions
```

Convex references inspected:

- `crates/database/src/committer.rs`
  - commit write metadata is the freshness source.
- `crates/sync/src/worker.rs`
  - scheduler work follows invalidation.
- `crates/sync/src/state.rs`
  - transition emission remains downstream of rerun.

Flarex differences:

- Convex does not expose a PGlite freshness mirror or Cloudflare trigger URL.
  Flarex uses them to preserve the same semantic order across separate
  runtimes.

Known limitations:

- Cloudflare `VersionDO`, `DocCacheDO`, and `QueryCacheDO` are still future
  cache layers.
- Durable retry of failed trigger notification is not implemented.
- Index/range freshness remains future work.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/executorHttpRuntime.test.ts
```

## Stuck Delivery Reconnect Consumer

Previous completed checkpoint: `038649e` Add live query delivery dead
lettering.

What changed:

- The Cloudflare scheduler can now call the executor
  `/maintenance/live-queries/dead-letter-stuck` policy route.
- For each returned `reconnectConnectionIds` entry, the scheduler calls the
  named `ConnectionDO` and asks it to force a reconnect.
- `ConnectionDO` unregisters active partition subscriptions before closing its
  WebSockets, so a reconnected client must resubscribe through the normal
  `ModifyQuerySet` path.
- The scheduler result reports scanned rows, dead-lettered rows, reconnect
  targets, successful reconnect calls, failed reconnect calls, `nextCursor`, and
  `hasMore`.

Cache and freshness impact:

```txt
executor finds stuck delivery rows
  -> executor dead-letters the rows
  -> executor returns affected connection ids
  -> SchedulerDO calls each ConnectionDO
  -> ConnectionDO closes the socket
  -> client reconnects and reissues active query set
```

This does not make a stale cached result fresh by itself. It removes trust in
the old sync session and forces the client back through normal subscription
setup, where future query rerun/freshness logic can produce an authoritative
result.

Convex references:

- `npm-packages/convex/src/browser/sync/web_socket_manager.ts`
  - socket closure is a recoverable reconnect path.
- `npm-packages/convex/src/browser/sync/client.ts`
  - reconnect rebuilds remote query state and resends query-set modifications.
- `crates/sync/src/worker.rs`
  - sync workers own active query-set transitions.

Flarex differences:

- Convex live-query freshness does not depend on a Cloudflare delivery outbox.
  Flarex must bridge executor-owned stuck-row policy back to Cloudflare-owned
  WebSocket sessions.
- Flarex uses deterministic connection DO names as reconnect targets.

Known limitations:

- This checkpoint exposes the manual maintenance route. A recurring cron/alarm
  that continues draining when `hasMore` is true remains future work.
- The route does not rerun queries directly; it reconnects clients so they
  resubscribe through the normal sync protocol.
- ConnectionDO force reconnect is per active DO instance. If the DO is inactive,
  the call is a no-op that still proves no active socket was available to close.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "dead-letters stuck live query deliveries"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## DeliveryDO Failure Reporting

Previous completed checkpoint: `d1bc1fe` Add live query delivery reconciler.

What changed:

- `DeliveryDO` now reports claimed delivery IDs back to the executor when
  `ConnectionDO` fanout fails.
- `DeliveryDO` also reports claimed delivery IDs when executor ack fails.
- Failure reporting is best-effort and never masks the original delivery error.
- Existing retry behavior remains unchanged: the DO schedules retry/alarm work
  and the delivery row remains unacked.

Runtime flow:

```text
claim pending delivery rows
  -> fanout to ConnectionDO
  -> fanout or ack fails
  -> POST /maintenance/live-queries/failure
  -> executor increments attempt metadata
  -> DeliveryDO rethrows and schedules retry
```

Convex references:

- `crates/sync/src/worker.rs`
  - Convex sync workers own transition processing without a Cloudflare edge
    handoff.

Flarex differences:

- Flarex must observe failures across Cloudflare DO and executor boundaries.
- Reporting is not an acknowledgement; it only records retry diagnostics.

Known limitations:

- Claim failures cannot report delivery IDs because no rows have been claimed.
- No automatic dead-letter threshold is implemented yet.
- No metrics exporter or dashboard exists yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "records DeliveryDO fanout failures"
```

## Stuck Delivery Candidate Endpoint

Previous completed checkpoint: `b35e2ca` Record live query delivery failures.

What changed:

- Added an executor HTTP maintenance endpoint for stuck live-query delivery
  candidates:
  `/maintenance/live-queries/stuck-deliveries`.
- The endpoint is read-only and returns rows that still need delivery but have
  an old recorded failure attempt.
- This is the safe precursor to any future Cloudflare scheduler/dead-letter
  policy.

Cloudflare implication:

```text
DeliveryDO records failures
  -> executor stores attempt metadata
  -> maintenance endpoint lists stuck candidates
  -> future policy can decide reconnect/dead-letter behavior
```

Convex reference:

- `crates/sync/src/worker.rs`
  - sync retry and transition work remains backend-internal in Convex.

Flarex difference:

- Flarex exposes the candidate listing at the executor HTTP boundary because
  the Cloudflare runtime cannot query Postgres internals directly.

Known limitations:

- No Cloudflare consumer calls this endpoint yet.
- No automatic dead-letter/reconnect policy exists yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
```

## Dead-Letter Policy Precursor

Previous completed checkpoint: `14925e0` List stuck live query deliveries.

What changed:

- Added executor HTTP routes for explicit dead-lettering:
  - `/maintenance/live-queries/dead-letter`
  - `/maintenance/live-queries/dead-letter-stuck`
- The stuck policy returns `reconnectConnectionIds`, giving a future
  Cloudflare consumer the exact connection names that should be forced to
  reconnect/resubscribe after their pending delivery rows are abandoned.
- No Cloudflare `DeliveryDO` or `SchedulerDO` behavior changes in this
  checkpoint.

Future Cloudflare flow:

```text
SchedulerDO lists stuck candidates
  -> executor dead-letters selected rows
  -> executor returns reconnectConnectionIds
  -> ConnectionDO forces reconnect/resubscribe
```

Convex files inspected:

- `crates/sync/src/worker.rs`
  - backend sync worker owns retries and transitions internally.
- `npm-packages/convex/src/browser/sync/web_socket_manager.ts`
  - reconnect behavior is client sync-runtime behavior.

Flarex difference:

- Flarex must bridge a Postgres executor maintenance decision into Cloudflare
  connection handling. Returning connection IDs keeps that boundary explicit.

Known limitations:

- `ConnectionDO` does not yet expose a force-reconnect endpoint.
- `SchedulerDO` does not yet call the dead-letter policy endpoint.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
```

## DeliveryDO Alarm Continuation For Pending Rows

Previous completed checkpoint: `9c160d8` Notify DeliveryDO after live query
reruns.

What changed:

- `DeliveryDO` persists pending drain config when a wake drain still has more
  rows.
- `DeliveryDO.alarm()` resumes claim/fanout/ack work from Durable Object
  storage.
- Failed alarm drains persist retry attempt state and schedule exponential
  backoff.
- Tests cover the persisted continuation path through an internal DO endpoint.

Freshness/cache impact:

```txt
executor writes durable delivery rows
  -> wake DeliveryDO once
  -> DeliveryDO drains bounded work
  -> if hasMore, alarm repeats from durable pending state
  -> rows are acked only after ConnectionDO fanout
```

This is the first version of Cloudflare-owned fanout continuation. Nitro/Vercel
does not need a loop, queue worker, or cron for the common `hasMore` case.

Convex references:

- `crates/sync/src/worker.rs`
  - sync worker keeps processing active query updates.
- `crates/sync/src/state.rs`
  - active query state advances with completed transitions.

Flarex differences:

- Convex does this inside the backend sync worker. Flarex uses DO storage plus
  alarms because WebSocket fanout lives in Cloudflare while trusted execution
  and Postgres ownership may live elsewhere.

Known limitations:

- There is still no global reconciler for wake notifications that never reach
  Cloudflare.
- There is no queue/dead-letter mechanism for repeatedly failing deployments.
- Miniflare does not reliably auto-dispatch alarms in the current harness, so
  tests use an internal DO continuation endpoint that calls the same persisted
  drain logic.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "continues DeliveryDO"
git diff --check
```

## SchedulerDO Lost-Wake Reconciler

Previous completed checkpoint: `c8f2f93` Continue DeliveryDO drains with
alarms.

What changed:

- Added `SchedulerDO` live-query delivery reconciliation endpoint:
  `/reconcile/live-query-deliveries`.
- Added Worker route for manual/internal maintenance:
  `POST /scheduler/live-query-deliveries/reconcile`.
- Added Worker `scheduled(...)` handler that calls the same SchedulerDO.
- Added Wrangler cron trigger for the deployable backend wrapper.
- SchedulerDO calls executor
  `/maintenance/live-queries/pending-deployments`, then wakes each matching
  `DeliveryDO`.
- Added backend sync coverage proving SchedulerDO recovers a lost wake by
  waking DeliveryDO, which then claims, fans out, and acks.

Freshness/cache impact:

```txt
lost executor wake
  -> delivery row remains durable and undelivered
  -> SchedulerDO scan finds deployment
  -> SchedulerDO wakes DeliveryDO
  -> DeliveryDO drains and acks after ConnectionDO fanout
```

Convex references:

- `crates/sync/src/worker.rs`
  - sync worker owns active query update processing.
- `crates/sync/src/state.rs`
  - query transitions are applied as backend state advances.

Flarex differences:

- Convex does not expose this fallback boundary because wakeup and processing
  are internal to one backend.
- Flarex needs an explicit Cloudflare reconciler because the trusted executor
  can run on Nitro/Vercel and wake notifications are not durable.

Known limitations:

- SchedulerDO scans one bounded page per run and reports `hasMore`; it does not
  yet persist cursor continuation across cron runs.
- No dead-letter/observability table tracks repeatedly failing deployments.
- The manual route uses the existing live-query delivery capability token when
  configured; platform-level auth/ops scoping is still future work.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "reconciles lost live query"
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

## Live-Query Rerun Maintenance Route

Previous completed checkpoint: `2b91699` Add batch stale live query rerun.

What changed:

- Added `POST /maintenance/live-queries/rerun` to the HTTP adapter and Nitro
  handler path.
- The route delegates to the executor's
  `rerunStaleLiveQuerySubscriptions(...)` operation.
- The route uses configured `freshnessStore` and `runQuery` dependencies. The
  request body only supplies `deploymentId` and optional `limit`.

Cache impact:

```txt
scheduler / cron
  -> maintenance route
  -> batch stale live-query rerun
  -> changed rows for future WebSocket fanout
```

This is the first hosted boundary for stale-query refresh work. It does not
perform Cloudflare cache invalidation yet, but it gives a scheduler or platform
job a stable place to ask the trusted executor to re-evaluate stale
subscriptions.

Convex references:

- `crates/sync/src/worker.rs`
  - backend sync workers process active-query refresh work.
- `crates/application/src/api.rs`
  - trusted backend APIs expose runtime operations behind service boundaries.

Flarex differences:

- Convex keeps this work internal to the backend service. Flarex exposes a
  portable route because scheduler hosting, Nitro executor hosting, and
  Cloudflare WebSocket/cache hosting are separate deployment concerns.

Known limitations:

- No WebSocket fanout is implemented yet.
- The real Dynamic Worker query bridge is not wired into `runQuery` yet.
- The route returns `501` until the host configures `liveQueryRerun`.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Live-Query Partition Routing Metadata

Previous completed checkpoint: `196cef9` Add live query rerun maintenance
route.

What changed:

- Durable live-query subscriptions now have nullable `partition_key`.
- Executor subscription recording accepts and preserves `partitionKey`.
- Rerun updates keep the same `partitionKey` when replacing the stored
  subscription result/read set.

Cache impact:

Cloudflare freshness/cache workers can identify stale subscriptions from
freshness mirrors, but the trusted executor must rerun the query in the same
partition scope as the original watch. Persisting `partition_key` is the
handoff field between Cloudflare-side subscription state and Postgres executor
query execution.

Convex references:

- `npm-packages/convex/src/browser/sync/client.ts`
  - query subscriptions are part of the sync protocol query set.
- `crates/sync/src/worker.rs`
  - the backend reruns active queries without exposing routing as a public
    subscription column.

Flarex differences:

- Flarex currently has an explicit partition routing model, so the cache/sync
  handoff must keep the partition key durable.

Known limitations:

- Existing rows with `partition_key = null` cannot safely use the future
  invoke-backed rerun bridge.
- No WebSocket fanout is wired to changed rerun results yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Invoke-Backed Live-Query Rerun Bridge

Previous completed checkpoint: `21de98d` Persist live query partition keys.

What changed:

- Added executor bridge `runLiveQuerySubscriptionWithInvoke(...)`.
- The bridge converts a stale subscription row into a query invoke session and
  returns a fresh result/read-set snapshot.
- The Dynamic Worker/user-code execution call remains injected through
  `executeQuery(...)`.

Cache impact:

```txt
freshness mirror says subscription is stale
  -> executor bridge starts query session
  -> Dynamic Worker executes user query with syscall client
  -> executor finishes query session and returns new read set
  -> future fanout publishes changed result
```

This is the trusted rerun primitive a Cloudflare freshness/cache scheduler can
use after stale detection. It keeps the freshness proof tied to the executor's
query-session `beginTs`, not to Hyperdrive cache timing.

Convex references:

- `crates/sync/src/worker.rs`
  - backend sync worker owns stale active-query reruns.
- `crates/application/src/application_function_runner/mod.rs`
  - application execution is coordinated by backend services.

Flarex differences:

- Convex reruns inside one backend runtime. Flarex splits rerun into trusted
  session ownership plus host-supplied Dynamic Worker execution.

Known limitations:

- The Cloudflare worker/DO scheduler is not wired yet.
- Changed result fanout is still missing.
- Rows without `partition_key` are rejected until clients refresh
  subscriptions.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
git diff --check
```

## Live-Query Rerun Route Uses Invoke Bridge

Previous completed checkpoint: `895e221` Add invoke backed live query rerun
bridge.

What changed:

- The maintenance route now delegates stale subscription reruns to the
  invoke-backed executor bridge.
- Route config now carries only the host-side `executeQuery(...)` callback plus
  the freshness store.
- The route body carries `projectId` so reruns validate deployment ownership.

Cache impact:

```txt
stale subscription scan
  -> maintenance route
  -> invoke-backed rerun bridge
  -> host executes Dynamic Worker query
  -> route returns changed/unchanged rows for future fanout
```

This keeps cache freshness tied to executor-owned query sessions while still
leaving Cloudflare-side user-code execution outside the Postgres executor
package.

Convex references:

- `crates/sync/src/worker.rs`
  - sync worker performs stale query processing inside the backend.
- `crates/application/src/application_function_runner/mod.rs`
  - function execution is coordinated by backend services.

Flarex differences:

- Convex does not need a public maintenance route or host callback here.
  Flarex exposes this boundary because scheduler/cache hosting and query
  execution are intentionally split.

Known limitations:

- Changed results are not pushed to WebSocket clients yet.
- The real Dynamic Worker execution host is not implemented yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Live-Query Delivery Claim Leases

Previous completed checkpoint: `da099c6` Prove Postgres live sync through
client.

What changed:

- Added `claimed_at`, `claim_expires_at`, and `claim_owner` to durable
  `live_query_deliveries` rows.
- Replaced delivery claiming with an executor-owned lease operation:
  `claimLiveQueryDeliveries(...)`.
- Delivery rows are claimable only when they are undelivered, not
  dead-lettered, and either unclaimed or past `claim_expires_at`.
- Ack, explicit dead-letter, and delivery failure release the lease metadata.
- `DeliveryDO` now passes a per-drain owner token and a lease duration to the
  executor claim endpoint.
- Ack and failure reports carry the same owner token so an expired old drain
  cannot clear a newer drain's active lease.

Why this exists:

```txt
executor records durable delivery row
  -> DeliveryDO claims row with a short lease
  -> DeliveryDO fans out to ConnectionDO
  -> DeliveryDO acks row after successful fanout
  -> failure clears lease so a later drain can retry
```

This prevents two `DeliveryDO` drains, reconciler wakeups, or retried host
requests from concurrently delivering the same row while still allowing recovery
after a crash or lost callback.

Convex references:

- `crates/sync/src/worker.rs`
  - backend sync workers own active query update processing and retries.
- `crates/sync/src/state.rs`
  - sync state keeps active query transitions inside the backend process.

Flarex differences:

- Convex does not need a Postgres delivery lease because the sync worker and
  transition fanout are backend-internal.
- Flarex splits rerun, durable delivery, and Cloudflare `DeliveryDO` fanout, so
  Postgres must own the at-least-once claim boundary.

Known limitations:

- Explicit operator dead-letter calls can still omit an owner intentionally.
- The lease is implemented in the repository method, but there is no
  multi-process Postgres race test yet.
- Metrics around expired leases and duplicate fanout attempts are still
  missing.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres exec vitest run test/pglite.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor exec vitest run test/liveQueries.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts --testTimeout=30000
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro exec vitest run test/health.test.ts --testTimeout=30000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter @flarex/example exec vitest run flarex/sync-e2e.test.ts --testTimeout=30000 --hookTimeout=30000
git diff --check
```
