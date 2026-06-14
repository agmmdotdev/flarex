# Sync And Subscriptions

## Current Decision

Subscriptions should be read-set based, inspired by Convex. A query result
should be accompanied by a read token. Later writes invalidate subscriptions
whose read set overlaps the write log.

## Implemented So Far

`ConnectionDO` exists as a WebSocket-capable Durable Object stub. It currently
only accepts a WebSocket and sends a connected message.

## Convex References

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

- No query execution pipeline returns read tokens yet.
- `ConnectionDO` does not subscribe to partition invalidations.
- No protocol-compatible `/sync` implementation exists yet.
- No cross-shard subscription aggregation exists yet.

## Last Update

Recorded that sync must be read-set based and that the current backend only has
the connection topology stub.
