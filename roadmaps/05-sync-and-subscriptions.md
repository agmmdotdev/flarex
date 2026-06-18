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

Keep the existing HTTP `query()` and `mutation()` invoke path while adding this
live path, because early examples and tests still use direct `/invoke`.

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
- `partitionKey` is still required in `AddQuery` and Flarex `Mutation` messages
  until routing inference exists.
- The client-side sync stack does not exist yet in `packages/flarex`; current
  client calls still use direct HTTP `/invoke`.

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
  - opt-in `mutation(..., { transport: "sync" })` path while the existing
    HTTP `/invoke` mutation default remains in place

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
- Public `mutation()` still defaults to HTTP `/invoke`; sync mutation is
  currently opt-in with `transport: "sync"` until the SDK migration can switch
  defaults without breaking existing examples.

Verification:

- `corepack pnpm --filter flarex typecheck`
- `corepack pnpm --filter flarex test`
- `corepack pnpm --filter flarex build`

## Last Update

Implemented the first client-side sync SDK slice. The backend `/sync` protocol
now has a package-level client counterpart that can subscribe to live queries,
dedupe identical subscriptions, handle query updates/failures, send removes,
and execute opt-in sync mutations.

Previous completed checkpoint: `6ca1454` Plan Convex-style sync client port.

Validation:

- `corepack pnpm --filter flarex typecheck`
- `corepack pnpm --filter flarex test`
- `corepack pnpm --filter flarex build`
