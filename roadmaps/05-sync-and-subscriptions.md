# Sync And Subscriptions

## Postgres Authority Pivot

Previous completed checkpoint: `e80e176` Plan Postgres executor package
boundaries.

The forward sync design is Postgres commit/outbox driven. `ConnectionDO` can
remain the WebSocket session owner, but `PartitionDO` read-set registration and
same-partition reruns are now legacy prototype behavior.

New sync work should assume:

```txt
trusted Postgres transaction
  -> commitVersion
  -> outbox/change event
  -> Cloudflare freshness/cache mirrors
  -> affected query reruns with required freshness
  -> ConnectionDO transition fanout
```

Public clients should eventually stop sending `partitionKey`; query and
mutation messages should look Convex-like. The older partition-local sync notes
below remain as implementation history for the current code.

Future Cloudflare cache/freshness layers now have a dedicated roadmap:
`roadmaps/21-cloudflare-freshness-cache.md`.

Verification:

```sh
git diff --check
```

## Read-Set Freshness Checker

Previous completed checkpoint: `3913b02` Add freshness delivery handler.

What changed:

- Added `checkReadSetFreshness(...)` for document/table read dependencies.
- The checker returns:
  - `fresh` when all supported dependencies are still at or before their
    observed timestamps,
  - `stale` when a document/table version is newer than the observed timestamp,
    and
  - `unsupported` when index/range dependencies are present.
- Added durable Postgres-backed checker coverage.

Why it matters for sync:

Live query sync needs to know whether a saved query result is still valid after
new commits arrive. This gives the first concrete dependency check for
document and whole-table reads. A future scheduler can use it before rerunning
queries and publishing new results.

Convex references:

- `crates/database/src/subscription.rs`
  - committed writes invalidate read dependencies.
- `crates/sync/src/worker.rs`
  - sync workers process invalidated queries into client transitions.
- `crates/database/src/write_log.rs`
  - write-log metadata supplies committed freshness.

Flarex differences:

- Convex keeps this logic inside backend subscription state. Flarex needs a
  package-level checker because freshness, query execution, and connection
  fanout are separate pieces.

Known limitations:

- Index/range reads are unsupported.
- No query rerun scheduler uses the checker yet.
- No `ConnectionDO` fanout uses the checker yet.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Durable Live-Query Registry

Previous completed checkpoint: `7eee662` Add executor read-set freshness adapter.

What changed:

- Added a Postgres-backed `live_query_subscriptions` table.
- Added persistence helpers:
  - `upsertLiveQuerySubscription(...)`,
  - `deleteLiveQuerySubscription(...)`,
  - `listLiveQuerySubscriptions(...)`.
- The row key is `{deploymentId, connectionId, queryId}`.
- Each row stores function path, args, query `beginTs`, timestamped read set,
  last result, result hash, and update time.
- Added PGlite tests for migration, upsert/list/update/delete behavior.

Why it matters for sync:

This is the durable representation of an active live query:

```txt
connection + query id
  -> function path + args
  -> last result + result hash
  -> read set + beginTs
```

Future schedulers can list active queries, check their read sets against the
freshness mirror, rerun stale queries, and send transitions to connection owners.

Convex references:

- `crates/sync/src/worker.rs`
  - tracks active client query state and produces transitions.
- `crates/database/src/subscription.rs`
  - stores read dependencies for invalidation.

Flarex differences:

- Convex keeps active query state inside its backend/sync machinery. Flarex
  stores this explicitly in Postgres because executor, freshness projection,
  Cloudflare socket ownership, and rerun scheduling are separate components.

Known limitations:

- No scheduler consumes this registry yet.
- No `ConnectionDO` writes or deletes these rows yet.
- No query rerun updates the stored result hash yet.
- Index/range read sets may be stored, but freshness still reports them as
  unsupported.

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

- Added executor methods:
  - `recordLiveQuerySubscription(...)`,
  - `removeLiveQuerySubscription(...)`.
- Recording converts the query read set plus `beginTs` into a timestamped
  freshness read set.
- Recording computes a deterministic result fingerprint before upserting the
  live-query row.
- Added executor tests for record, replace, remove, richer observed timestamps,
  and stable result fingerprints.

Why it matters for sync:

The durable registry is now populated through executor behavior instead of only
being a low-level table. A future `ConnectionDO` or HTTP sync layer can call the
executor after a successful query run:

```txt
query execution result
  -> recordLiveQuerySubscription(...)
  -> durable live_query_subscriptions row
```

Convex references:

- `crates/sync/src/worker.rs`
  - active query results are tracked and compared before publishing
    transitions.
- `crates/database/src/subscription.rs`
  - query dependencies are registered after execution.

Flarex differences:

- Convex keeps this inside the integrated sync worker. Flarex exposes explicit
  executor helpers because Cloudflare connection ownership and the trusted
  executor are split.

Known limitations:

- No `ConnectionDO` or sync HTTP route calls these methods yet.
- No stale-query scheduler consumes the registry yet.
- Result fingerprints suppress nothing yet; they are only stored for the future
  rerun path.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Stale Live-Query Scanner

Previous completed checkpoint: `d438453` Add executor live query registry writer.

What changed:

- Added `findStaleLiveQuerySubscriptions(...)` to `@flarex/executor`.
- The scanner lists live-query subscription rows for a deployment and checks
  each stored read set against a supplied freshness mirror.
- The result is grouped into `fresh`, `stale`, and `unsupported` entries.
- Added executor tests for fresh, stale document/table, and unsupported
  index/range subscriptions.

Why it matters for sync:

This is the first read-only scheduler primitive:

```txt
live_query_subscriptions
  -> freshness mirror
  -> fresh | stale | unsupported
```

The next scheduler/rerun step can consume the `stale` list without needing to
know how registry rows map to freshness validation.

Convex references:

- `crates/sync/src/worker.rs`
  - sync workers identify query updates before emitting transitions.
- `crates/database/src/subscription.rs`
  - dependency invalidation determines whether a query is stale.

Flarex differences:

- Convex keeps stale-query discovery inside its backend worker. Flarex exposes a
  framework-neutral executor helper because persistence, freshness projection,
  and Cloudflare connection fanout are separate runtime pieces.

Known limitations:

- The scanner does not rerun queries.
- The scanner does not update stored results or result hashes.
- The scanner does not notify `ConnectionDO`.
- Index/range dependencies are classified as `unsupported`.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Executor Read-Set Freshness Adapter

Previous completed checkpoint: `bd78a7b` Add read-set freshness checker.

What changed:

- Added `readSetToFreshnessReadSet(...)` in `@flarex/freshness`.
- The adapter accepts executor-shaped read sets and applies a session snapshot
  timestamp as the default `observedTs`.
- If a richer internal read already has `observedTs`, the adapter preserves it.
- Index/range reads are carried through with timestamps, but still evaluate as
  `unsupported` until range freshness exists.

Why it matters for sync:

The executor can already return query read sets. The freshness checker requires
timestamps. This adapter gives the future live-query registry a simple bridge:

```txt
finished query readSet + query beginTs
  -> freshness readSet
  -> checkReadSetFreshness(...)
```

Convex references:

- `crates/database/src/subscription.rs`
  - read dependencies are stored with the query/subscription.
- `crates/sync/src/worker.rs`
  - stale queries are rerun from their stored dependency state.

Flarex differences:

- Convex keeps the read dependency and timestamp metadata inside the backend
  transaction/subscription machinery. Flarex exposes a small adapter because
  the executor and Cloudflare sync/cache layers are separate packages.

Known limitations:

- This is only a conversion helper; no live-query registry consumes it yet.
- Public executor read sets currently do not expose per-document `observedTs`,
  so callers using that shape should pass the query `beginTs`.
- Index/range freshness still returns `unsupported`.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Reusable Freshness Delivery Handler

Previous completed checkpoint: `f0fd56f` Add durable freshness store.

What changed:

- Added reusable delivery-handler helpers in `@flarex/freshness`.
- The Postgres helper creates the durable mirror store and applies outbox
  events through the existing projector.
- Executor tests now use the helper for normal outbox-to-freshness projection.

Why it matters for sync:

This gives future sync schedulers a single handler to plug into
`runOutboxDeliveryBatch(...)`. It keeps replay/idempotency in the freshness
store and acknowledgement in the executor dispatcher.

Convex references:

- `crates/sync/src/worker.rs`
  - sync worker code owns the committed-change processing loop.
- `crates/database/src/subscription.rs`
  - committed write metadata drives dependency invalidation.

Flarex differences:

- Flarex needs this exported handler because the scheduler/dispatcher and
  freshness projection are separate deployable/runtime concerns.

Known limitations:

- No live query rerun or `ConnectionDO` fanout uses the handler yet.
- No range/index freshness exists yet.
- No scheduler invokes the handler yet.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Durable Document And Table Freshness

Previous completed checkpoint: `0f896fd` Test outbox freshness pipeline.

What changed:

- Added durable Postgres/PGlite storage for processed freshness event keys,
  document freshness versions, and table freshness versions.
- Added a durable freshness store adapter that satisfies the same
  `FreshnessMirrorStore` interface used by the in-memory projector tests.
- Added tests proving replay idempotency survives a new store instance over the
  same PGlite persistence.

Why it matters for sync:

Live query reruns need a durable source for "what changed since this query read
its dependencies?" Document and whole-table dependencies now have that source.
This is still not full sync, but it is the first durable invalidation state.

Convex references:

- `crates/database/src/write_log.rs`
  - committed writes are durable and replayable.
- `crates/database/src/subscription.rs`
  - subscriptions compare read dependencies against committed writes.
- `crates/sync/src/worker.rs`
  - sync workers consume committed changes to produce client transitions.

Flarex differences:

- Convex stores this in its integrated database/subscription machinery. Flarex
  stores explicit freshness projection rows because execution and Cloudflare
  sync/cache are separate runtime pieces.

Known limitations:

- No live query rerun or `ConnectionDO` fanout consumes the durable freshness
  rows yet.
- No range/index freshness exists yet.
- No minimum-freshness protocol exists for cached query responses yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Outbox To Freshness Pipeline Test

Previous completed checkpoint: `97d0f0f` Add freshness mirror projector.

What changed:

- Added executor tests that run the outbox dispatcher with
  `applyOutboxEventsToFreshnessMirror(...)` as the delivery handler.
- Proved dispatch updates document/table freshness versions before marking the
  outbox event delivered.
- Proved a crash after projection but before acknowledgement is safe: replay
  skips the already processed freshness event and then acknowledges the outbox
  row.

Why it matters for sync:

This validates the first full internal sync invalidation handoff:

```txt
committed outbox event
  -> dispatcher
  -> freshness mirror
  -> delivered acknowledgement
```

Future live query reruns can build on this mirror knowing replay does not
double-apply document/table versions.

Convex references:

- `crates/sync/src/worker.rs`
  - committed changes are processed by worker logic before clients observe
    transitions.
- `crates/database/src/subscription.rs`
  - read dependency invalidation depends on committed write metadata.
- `crates/database/src/write_log.rs`
  - write-log entries are the durability source.

Flarex differences:

- Convex's worker and write-log are internal. Flarex crosses package/runtime
  boundaries, so it tests the dispatcher/projector handoff explicitly.

Known limitations:

- No live query rerun or `ConnectionDO` fanout consumes the mirror yet.
- No range/index freshness exists yet.
- The mirror used here is in-memory only.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Freshness Projector Core

Previous completed checkpoint: `5526aa2` Add outbox dispatcher core.

What changed:

- Added `@flarex/freshness` with
  `applyOutboxEventsToFreshnessMirror(...)`.
- The projector turns commit outbox events into document/table freshness
  versions.
- The mirror store owns event idempotency by `(deploymentId, ts, sequence)`.

Why it matters for sync:

Subscriptions and live queries need a compact way to ask "did anything I read
change since my last result?" This package starts that path for document and
whole-table dependencies. Future query rerun code can compare recorded read
dependencies against the freshness mirror before publishing client transitions.

Convex references:

- `crates/database/src/subscription.rs`
  - read dependencies are invalidated by committed writes.
- `crates/sync/src/worker.rs`
  - committed changes drive client sync transitions.
- `crates/database/src/write_log.rs`
  - write-log entries provide committed freshness.

Flarex differences:

- Convex can directly use backend write-log/subscription internals. Flarex
  needs a separate projector because outbox dispatch and Cloudflare connection
  ownership are separate components.

Known limitations:

- No `ConnectionDO` or query rerun logic consumes the mirror yet.
- No range/index freshness is implemented.
- No durable mirror store exists yet.

Verification:

```sh
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/freshness test
git diff --check
```

## Outbox Dispatcher Core

Previous completed checkpoint: `2683fe0` Add outbox delivery primitives.

What changed:

- Added executor-core `runOutboxDeliveryBatch(...)`, which wraps the
  undelivered outbox list, injected delivery handler, and delivered
  acknowledgement into one framework-neutral operation.
- The handler is only acknowledged after it succeeds. If it throws, events
  remain undelivered for retry.
- Added tests proving successful delivery, failure preservation, empty batches,
  and invalid limit rejection.

Why it matters for sync:

Sync now has a concrete internal extension point:

```txt
runOutboxDeliveryBatch({
  deliver(events) {
    // update freshness mirrors and notify connection owners
  }
})
```

That keeps WebSocket/Cloudflare-specific fanout out of the trusted executor
core while still centralizing the at-least-once delivery semantics.

Convex references:

- `crates/sync/src/worker.rs`
  - committed database changes are processed by sync worker logic.
- `crates/database/src/subscription.rs`
  - committed write metadata drives subscription invalidation.

Flarex differences:

- Convex can keep sync worker delivery close to its backend internals. Flarex
  must let the delivery target be injected because the consumer can be a
  Cloudflare DO, scheduled worker, or test sink.
- This requires idempotent consumers. A replay is possible if the process
  crashes after applying a batch but before acknowledging it.

Known limitations:

- No connection fanout or query rerun consumer exists yet.
- No multi-dispatcher claim/lease semantics exist yet.
- Query-range invalidation is still not encoded precisely.

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

## Outbox Delivery Boundary

Previous completed checkpoint: `b4f98a4` Write commit outbox events.

What changed:

- Added executor-accessible primitives for sync workers to page undelivered
  commit outbox events and mark them delivered after applying them.
- The delivery marker uses `outbox.delivered_at`; no new schema is required for
  the first single-dispatcher implementation.
- Tests now prove undelivered events can be listed, acknowledged, hidden from
  future undelivered batches, and still visible in the full outbox history.

Why it matters for sync:

This is the first concrete bridge from the trusted Postgres executor toward
Cloudflare live sync. The future sync worker can now be shaped around:

```txt
read undelivered Postgres outbox events
  -> update freshness/subscription state
  -> mark events delivered
```

Convex references:

- `crates/sync/src/worker.rs`
  - sync workers consume committed changes and publish client transitions.
- `crates/database/src/write_log.rs`
  - committed write-log entries are the durable source of sync invalidation.
- `crates/database/src/subscription.rs`
  - subscriptions are invalidated from committed write metadata.

Flarex differences:

- Convex keeps sync workers close to the write log. Flarex must explicitly
  acknowledge delivered outbox events because the producer is Postgres and the
  consumer will run separately in Cloudflare/Nitro infrastructure.

Known limitations:

- No dispatcher loop or `ConnectionDO` consumer exists yet.
- This is not a multi-dispatcher lease protocol. Concurrent dispatchers can
  still race until claim/lease semantics are added.
- Query-range invalidation is still coarse and needs a dependency encoding
  layer.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Postgres Commit Outbox Source

Previous completed checkpoint: `c71110d` Expose ctx db replace.

What changed:

- The Postgres executor commit path now writes a durable outbox event for each
  successful mutation commit.
- The event includes commit timestamp, source, changed table ids, changed
  document ids, and write summary.
- Failed commits do not create outbox rows.

Why it matters for sync:

The forward sync design is Postgres-authoritative. `ConnectionDO` and future
sync workers should consume committed outbox events rather than relying on the
legacy `PartitionDO` subscription state. This gives Cloudflare sync/freshness
components a replayable commit stream.

Convex references:

- `crates/database/src/write_log.rs`
  - Convex's committed write log is the freshness source.
- `crates/sync/src/worker.rs`
  - sync workers process committed changes into client transitions.
- `crates/database/src/subscription.rs`
  - subscriptions depend on committed write information.

Flarex differences:

- Convex keeps write-log and sync workers in its backend. Flarex uses a
  Postgres outbox because trusted execution, WebSocket connection DOs, and
  cache/freshness DOs are separate runtime components.

Known limitations:

- No outbox dispatcher or `ConnectionDO` consumer is wired yet.
- Outbox events are coarse document/table summaries. Query-range invalidation
  still needs a dependency encoding layer.
- No retention, delivery claim, or retry policy exists yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
git diff --check
```

## Current Decision

Subscriptions should be read-set based, inspired by Convex. A query result
should be accompanied by a read token. Later writes invalidate subscriptions
whose read set overlaps the write log.

## Implemented So Far

`ConnectionDO` accepts WebSocket connections for `/deployments/:deploymentId/sync`.
It now parses a Convex-style `ModifyQuerySet` message, enforces query-set base
versions, executes `Add` query modifications through the active backend
deployment invoke path, emits `Transition` messages with `QueryUpdated`,
`QueryFailed`, and `QueryRemoved`, and registers successful query read sets with
the owning `PartitionDO`.

`PartitionDO` stores partition-local sync subscription registrations, checks
new commits against registered read sets with the same overlap logic used by
OCC, and notifies the owning `ConnectionDO` to rerun invalidated queries.
`ConnectionDO` fingerprints query results, refreshes read-set registrations on
unchanged reruns, and suppresses `QueryUpdated` when the query result did not
change.
It also accepts Convex-style `Mutation` messages over `/sync`, executes them
sequentially per connection, emits `MutationResponse`, and reruns active
queries on the same partition after successful mutations.

A detailed implementation plan now lives in
[`05-sync-protocol-implementation.md`](./05-sync-protocol-implementation.md).
Future sync work should keep implementation records in this domain instead of
spreading live-sync decisions across unrelated roadmap files.

## Convex References

- `npm-packages/convex/src/browser/sync/protocol.ts`
  Defines the client and server wire message names Flarex should keep where
  practical.
- `npm-packages/convex/src/browser/sync/local_state.ts`
  Maintains query-set versions and produces `ModifyQuerySet` messages.
- `npm-packages/convex/src/browser/sync/client.ts`
  Connects public client subscribe/mutation/action operations to the sync
  WebSocket.
- `crates/local_backend/src/subs/mod.rs`
  Owns Convex's WebSocket upgrade and socket worker split.
- `crates/sync/src/worker.rs`
  Runs query-set modification handling, mutation queueing, query execution,
  and transition emission.
- `crates/sync/src/state.rs`
  Documents the state model of query-set version plus timestamp plus active
  subscriptions.
- `crates/database/src/subscription.rs`
  Tracks subscribers to read sets and invalidates them from write-log updates.
- `crates/application/src/api.rs`
  `SubscriptionClient`, `ApplicationSubscription`, and token handling.
- `crates/database/src/write_log.rs`
  Token refresh and stale-read checks.

## Cloudflare Difference

Convex can keep subscription managers close to the process-local write log.
Flarex needs subscription routing across `ConnectionDO` and one or more
`PartitionDO` instances. Cross-shard queries must subscribe to all partitions or
projections they read.

The client package must also adapt Convex's hosted sync assumptions. Convex's
browser client connects to `/api/{version}/sync`, uses Convex auth/component
metadata, and does not expose a shard route in query subscriptions. Flarex's
first client must connect to the Flarex backend `/sync` route and include
`partitionKey` in query and mutation messages until generated routing can infer
it.

## Client Sync Fork Plan

The next sync implementation step is client-side. It should closely port the
Convex browser sync client layering instead of creating an unrelated Flarex
WebSocket wrapper.

### Files To Mirror In `packages/flarex`

```txt
packages/flarex/src/sync/protocol.ts
packages/flarex/src/sync/localState.ts
packages/flarex/src/sync/baseClient.ts
packages/flarex/src/sync/simpleClient.ts
```

These files should be derived from these Convex references:

- `npm-packages/convex/src/browser/sync/protocol.ts`
- `npm-packages/convex/src/browser/sync/local_state.ts`
- `npm-packages/convex/src/browser/sync/client.ts`
- `npm-packages/convex/src/browser/simple_client.ts`

### Required First Behavior

- `LocalSyncState`-style query-set state:
  - stable query IDs
  - query tokens based on function path, args, and Flarex partition route
  - query-set version increments for `Add` and `Remove`
  - subscriber deduplication for identical query subscriptions
  - `Remove` only when the final subscriber unsubscribes
- `BaseFlarexClient`-style transport:
  - open WebSocket against the Flarex sync URL
  - send `ModifyQuerySet` for subscribe/unsubscribe
  - send `Mutation` for live mutation calls
  - ingest `Transition`, `MutationResponse`, and `FatalError`
  - maintain local query results and failed query errors
- public `FlarexClient` live API:

```ts
const unsubscribe = client.onUpdate(
  api.lessons.list,
  args,
  result => {
    // result changed
  },
  error => {
    // query failed
  },
  { partitionKey: userId },
);

const result = await client.mutation(api.lessons.complete, args, {
  partitionKey: userId,
});
```

Keep the existing HTTP `query()` invoke path and an explicit HTTP mutation
escape hatch while adding this live path.

### Tests For The First Slice

- subscribing to a query sends one `ModifyQuerySet` `Add`
- subscribing twice to the same path/args/partition dedupes into one backend
  query and two callbacks
- unsubscribing once keeps the query active; unsubscribing the final listener
  sends `Remove`
- receiving `Transition.QueryUpdated` stores the local result and calls
  listeners
- receiving `Transition.QueryFailed` stores a local error and calls error
  listeners
- calling `mutation()` sends a sync `Mutation` and resolves/rejects from
  `MutationResponse`
- `partitionKey` is present in `AddQuery` and `Mutation`

## Known Limitations

- Subscription invalidation is partition-local only.
- Subscription state is still in `ConnectionDO` memory; durable WebSocket
  hibernation/recovery is not implemented.
- Action execution over `/sync` is not implemented yet.
- No cross-shard subscription aggregation exists yet.
- `partitionKey` is still required in `AddQuery` and existing-root Flarex
  `Mutation` messages. Create-root mutation references are the exception: they
  omit `partitionKey` and the backend validates `partitionCreateRoot` metadata
  before execution.
- The client-side sync stack exists and has real example-app E2E coverage, but
  production reconnect/backoff, auth refresh, transition chunks, action-over-sync,
  and paginated reactive sync are still missing.

## Client Sync SDK Update

Previous completed checkpoint: `6ca1454` Plan Convex-style sync client port.

Implemented the first client-side live sync slice in `packages/flarex`:

- `src/sync/protocol.ts`
  - client-side mirror of Flarex `/sync` messages using Convex names:
    `ModifyQuerySet`, `Add`, `Remove`, `Transition`, `QueryUpdated`,
    `QueryFailed`, `QueryRemoved`, `Mutation`, and `MutationResponse`
- `src/sync/localState.ts`
  - Convex-style local query-set state with query IDs, query tokens,
    query-set version increments, subscription deduplication, and final
    subscriber `Remove`
- `src/sync/baseClient.ts`
  - minimal WebSocket base client that sends query-set modifications and sync
    mutations, ingests transitions, stores local query results/errors, and
    resolves mutation responses
- `src/sync/simpleClient.ts`
  - public live-query option and unsubscribe shapes
- `src/client.ts`
  - `FlarexClient.onUpdate(...)` live query API
  - initial opt-in `mutation(..., { transport: "sync" })` path, later promoted
    to the default mutation transport in the next checkpoint

Convex references used:

- `npm-packages/convex/src/browser/sync/protocol.ts`
- `npm-packages/convex/src/browser/sync/local_state.ts`
- `npm-packages/convex/src/browser/sync/client.ts`
- `npm-packages/convex/src/browser/simple_client.ts`

Cloudflare and Flarex differences:

- Query tokens include `partitionKey` because Flarex subscriptions are
  partition-routed for now.
- The live client connects to the Flarex deployment sync URL, not Convex's
  `/api/{version}/sync`.
- `packages/flarex` mirrors protocol types locally instead of importing
  backend-only `packages/flarex-backend` code.
- The base client intentionally does not yet port Convex auth refresh,
  component paths, reconnect/backoff, transition chunks, optimistic updates,
  or paginated reactive sync.
- Public `mutation()` now defaults to sync transport. HTTP `/invoke` remains
  available through `transport: "http"` for direct one-shot tests and
  compatibility paths.

Verification:

- `corepack pnpm --filter flarex typecheck`
- `corepack pnpm --filter flarex test`
- `corepack pnpm --filter flarex build`

## Real App Sync E2E Update

Previous completed checkpoint: `be78189` Add Convex-style sync client slice.

Added real app sync coverage through `apps/example/flarex/sync-e2e.test.ts`.
The test runs against `flarex-test`, which now provides a Miniflare-backed
WebSocket constructor and `t.client()` helper.

Tested path:

```txt
generated api.lessons.list
  -> FlarexClient.onUpdate
  -> /__flarex_dev/sync
  -> backend /deployments/:deploymentId/sync
  -> ConnectionDO
  -> active execution artifact
  -> PartitionDO read set registration

generated api.lessons.complete
  -> FlarexClient.mutation(...)
  -> ConnectionDO mutation queue
  -> active execution artifact mutation
  -> PartitionDO commit
  -> same-partition subscribed query rerun
  -> Transition.QueryUpdated
```

Convex references:

- `npm-packages/convex/src/browser/sync/client_node_test_helpers.ts`
  - SDK sync tests use a real Node WebSocket bridge and transition queue.
- `npm-packages/convex/src/cli/lib/networkTest.ts`
  - Convex validates real deployment WebSocket connectivity by constructing a
    `BaseConvexClient` and subscribing to a system query.
- `crates/sync/src/worker.rs`
  - mutations over sync are queued and followed by transition generation.

Cloudflare difference:

- The Flarex example test uses Miniflare Durable Objects and the active
  execution artifact, so it covers Cloudflare routing and source-package
  execution instead of only protocol messages.
- The Vite dev server middleware still needs explicit WebSocket upgrade
  support before browser dev apps can connect through Vite itself.

Verification:

- `corepack pnpm --filter flarex-dev typecheck`
- `corepack pnpm --filter flarex-test typecheck`
- `corepack pnpm --filter @flarex/example test`
- `corepack pnpm --filter flarex-dev test`
- `corepack pnpm --filter flarex-dev build`
- `corepack pnpm --filter flarex-test test`
- `corepack pnpm --filter flarex-test build`
- `corepack pnpm --filter @flarex/example typecheck`
- `corepack pnpm --filter @flarex/example build`

## Sync Mutation Default Update

Previous completed checkpoint: `8d500ed` Add real app sync E2E coverage.

`FlarexClient.mutation()` now follows Convex's public client behavior more
closely: mutations go through the sync client by default.

```ts
await client.mutation(api.lessons.complete, args, {
  partitionKey,
});
```

The direct HTTP invoke path is still available as an explicit escape hatch:

```ts
await client.mutation(api.lessons.complete, args, {
  partitionKey,
  transport: "http",
});
```

`query()` remains HTTP one-shot for now. Live queries continue to use
`onUpdate(...)`.

Convex reference:

- `npm-packages/convex/src/browser/simple_client.ts`
  - `ConvexClient.mutation()` delegates to the base sync client.
- `npm-packages/convex/src/browser/sync/client.ts`
  - `BaseConvexClient.mutation()` enqueues a sync `Mutation` message.

Cloudflare difference:

- Flarex still requires explicit/generated `partitionKey` for existing-root
  mutation routing.
- Create-root mutation references omit `partitionKey`; the backend resolves
  the new partition after active metadata validation and root id allocation.
- The HTTP mutation path remains public because it is useful for tests,
  tooling, and compatibility while sync reconnect/auth semantics are still
  incomplete.

Verification:

- `corepack pnpm --filter flarex typecheck`
- `corepack pnpm --filter flarex test`
- `corepack pnpm --filter @flarex/example test`
- `corepack pnpm --filter flarex build`
- `corepack pnpm --filter @flarex/example typecheck`
- `corepack pnpm --filter @flarex/example build`

## Watch Query API Update

Previous completed checkpoint: `04fc3cb` Default client mutations to sync
transport.

`FlarexClient` now exposes a Convex-style `watchQuery()` primitive:

```ts
const watch = client.watchQuery(api.lessons.list, { userId }, { partitionKey });

const unsubscribe = watch.onUpdate(() => {
  const result = watch.localQueryResult();
});
```

`watchQuery()` is inert until `watch.onUpdate()` is called, matching Convex's
public watch semantics. The existing value-callback `client.onUpdate(...)`
method now wraps `watchQuery()` instead of managing its own subscription state.

The SDK tests now cover:

- watch creation does not open a WebSocket or subscribe
- `watch.onUpdate()` sends `ModifyQuerySet Add`
- `watch.localQueryResult()` reads the cached result after `QueryUpdated`
- watch unsubscribe sends `Remove`
- duplicate watch subscriptions dedupe into one backend query

Convex references:

- `npm-packages/convex/src/react/client.ts`
  - `watchQuery()` returns a stateless watch with `onUpdate()` and
    `localQueryResult()`.
- `npm-packages/convex/src/browser/sync/client.ts`
  - the base sync client owns subscribe and local query result lookup.

Cloudflare difference:

- `partitionKey` remains required on `watchQuery()` options until routing can
  be inferred from generated schema placement metadata.
- `localQueryLogs()` is not implemented yet because the first Flarex sync
  client stores result/error state but not query logs.

Verification:

- `corepack pnpm --filter flarex typecheck`
- `corepack pnpm --filter flarex test`
- `corepack pnpm --filter flarex build`
- `corepack pnpm --filter @flarex/example test`
- `corepack pnpm --filter @flarex/example typecheck`
- `corepack pnpm --filter @flarex/example build`

## Last Update

Added Convex-style `watchQuery()` as the primitive live-query API and refactored
`FlarexClient.onUpdate(...)` to wrap it. This prepares the SDK for React hooks
without adding a separate subscription model.

Previous completed checkpoint: `04fc3cb` Default client mutations to sync
transport.

Validation:

- `corepack pnpm --filter flarex typecheck`
- `corepack pnpm --filter flarex test`
- `corepack pnpm --filter flarex build`
- `corepack pnpm --filter @flarex/example test`
- `corepack pnpm --filter @flarex/example typecheck`
- `corepack pnpm --filter @flarex/example build`

## Postgres-Authoritative Sync Design Note

Previous completed checkpoint: `d40b5ba` Remove legacy SDK route APIs.

Created a non-roadmap design note for the Postgres-authoritative sync/cache
alternative:

- [postgres-authoritative-sync.md](../design-notes/postgres-authoritative-sync.md)

The finding recorded there is that Hyperdrive can reduce ordinary read load,
but it cannot prove live-query freshness by itself. A Postgres-authoritative
Flarex mode would need a committed outbox/CDC stream and Cloudflare-side
freshness mirrors such as `VersionDO`, `DocCacheDO`, and eventually
`QueryCacheDO`.

Convex references:

- `npm-packages/convex/src/react/client.ts`
  - `useQuery` and `watchQuery` subscribe through the sync client.
- `npm-packages/convex/src/browser/simple_client.ts`
  - one-shot `query()` can be implemented as subscribe, receive first result,
    and unsubscribe.
- `npm-packages/convex/src/browser/sync/client.ts`
  - active query subscriptions are tracked through the client query-set
    protocol.

Cloudflare difference: Flarex may use Hyperdrive and replicated Cloudflare
SQLite caches for read performance, but live-query correctness must come from
versioned commit/outbox metadata, not cache revalidation. A cached result can
only be published as a live update when its observed version satisfies the
subscription's required freshness.

Known limitations:

- This was originally recorded as an alternative authority model. After the
  Postgres executor pivot, it is the forward sync authority model, but the
  implementation is still not built.
- Range freshness for indexed/list queries remains the hardest part.
- Cache detection of staleness does not automatically provide the fresh row or
  query result; the runtime still needs no-cache fallback, replicated row
  images, or query-cache rebuilds.

Verification:

```sh
git diff --check
```
