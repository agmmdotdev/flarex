# Sync And Subscriptions

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

- This is an alternative authority model, not current implementation.
- Range freshness for indexed/list queries remains the hardest part.
- Cache detection of staleness does not automatically provide the fresh row or
  query result; the runtime still needs no-cache fallback, replicated row
  images, or query-cache rebuilds.

Verification:

```sh
git diff --check
```
