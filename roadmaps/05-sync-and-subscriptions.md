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
`QueryFailed`, and `QueryRemoved`, and stores query read sets in connection
state for future invalidation work.

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

## Known Limitations

- Query execution returns read sets and a query read timestamp, but those read
  sets are not registered with `PartitionDO` yet.
- `ConnectionDO` does not subscribe to partition invalidations.
- Mutation and action execution over `/sync` is not implemented yet.
- No cross-shard subscription aggregation exists yet.
- `partitionKey` is still required in `AddQuery` until routing inference exists.

## Last Update

Implemented the first backend sync protocol slice. The backend now has
`syncProtocol.ts`, a stateful `ConnectionDO` query-set handler, and Miniflare
WebSocket tests proving `ModifyQuerySet/Add`, `Remove`, query failure, and stale
base-version behavior.

Previous completed checkpoint: `f0af86b` Document sync protocol implementation
plan.

Validation:

- `corepack pnpm --filter flarex-backend typecheck`
- `corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts`
- `corepack pnpm --filter flarex-backend test`
- `corepack pnpm --filter flarex-backend build`
- `corepack pnpm --filter @flarex/backend typecheck`
- `corepack pnpm --filter @flarex/backend build`
