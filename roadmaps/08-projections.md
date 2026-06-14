# Projections

## Current Decision

`defineProjection(...)` is the read model for cross-shard/global views.
Projections are derived data, not authoritative data.

Use projections for:

- leaderboards
- feeds
- admin dashboards
- global search display
- denormalized product display data

Do not use projections for authoritative checkout, payment, inventory, or
security-sensitive validation.

## Convex References

- `crates/database/src/subscription.rs`
  Read-set invalidation inspiration.
- `crates/database/src/write_log.rs`
  Write log as the source for detecting changed reads.
- `crates/database/src/committer.rs`
  Document and index writes are computed together at commit.

## Cloudflare Difference

Convex can query live deployment data through its database and indexes. Flarex
uses projections to avoid live fan-out across many `PartitionDO` shards.

This is an intentional Cloudflare-native tradeoff: fast global reads in exchange
for derived data and explicit authoritative validation paths.

## Known Limitations

- Projection storage location is not implemented.
- Projection update workers are not implemented.
- No API exists yet for declaring projection consistency requirements.
- No live update path exists for projection subscribers.

## Last Update

Recorded projections as the required cross-shard read strategy and the
authoritative-data warning for ecommerce-style cases.
